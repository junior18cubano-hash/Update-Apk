import com.android.tools.smali.dexlib2.DexFileFactory;
import com.android.tools.smali.dexlib2.Opcode;
import com.android.tools.smali.dexlib2.Opcodes;
import com.android.tools.smali.dexlib2.builder.BuilderInstruction;
import com.android.tools.smali.dexlib2.builder.MutableMethodImplementation;
import com.android.tools.smali.dexlib2.builder.instruction.BuilderInstruction11x;
import com.android.tools.smali.dexlib2.builder.instruction.BuilderInstruction35c;
import com.android.tools.smali.dexlib2.iface.ClassDef;
import com.android.tools.smali.dexlib2.iface.DexFile;
import com.android.tools.smali.dexlib2.iface.Method;
import com.android.tools.smali.dexlib2.iface.MethodImplementation;
import com.android.tools.smali.dexlib2.iface.instruction.Instruction;
import com.android.tools.smali.dexlib2.iface.instruction.ReferenceInstruction;
import com.android.tools.smali.dexlib2.iface.reference.MethodReference;
import com.android.tools.smali.dexlib2.immutable.ImmutableClassDef;
import com.android.tools.smali.dexlib2.immutable.ImmutableDexFile;
import com.android.tools.smali.dexlib2.immutable.ImmutableMethod;
import com.android.tools.smali.dexlib2.immutable.reference.ImmutableMethodReference;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class DexAuthPatcher {
    public static void main(String[] args) throws Exception {
        if (args.length < 2) {
            System.err.println("Usage: DexAuthPatcher <input.dex> <output.dex>");
            System.exit(1);
        }
        String inputPath = args[0];
        String outputPath = args[1];

        DexFile dexFile = DexFileFactory.loadDexFile(inputPath, Opcodes.getDefault());
        List<ClassDef> updatedClasses = new ArrayList<>();

        for (ClassDef cls : dexFile.getClasses()) {
            String type = cls.getType();
            if ("Lcom/example/MainActivityKt$CatalogWebViewScreen$2$1$1$2;".equals(type)) {
                List<Method> cleanVirtuals = deduplicateMethods(cls.getVirtualMethods(), true);
                List<Method> cleanDirects = deduplicateMethods(cls.getDirectMethods(), false);
                updatedClasses.add(new ImmutableClassDef(
                        cls.getType(),
                        cls.getAccessFlags(),
                        cls.getSuperclass(),
                        cls.getInterfaces(),
                        cls.getSourceFile(),
                        cls.getAnnotations(),
                        cls.getStaticFields(),
                        cls.getInstanceFields(),
                        cleanDirects,
                        cleanVirtuals
                ));
                System.out.println("DexAuthPatcher: cleaned WebViewClient virtual methods -> count=" + cleanVirtuals.size());
            } else if ("Lcom/example/MainActivity;".equals(type)) {
                List<Method> cleanVirtuals = deduplicateMethods(cls.getVirtualMethods(), false);
                List<Method> patchedVirtuals = new ArrayList<>();
                for (Method m : cleanVirtuals) {
                    if ("onCreate".equals(m.getName()) && m.getParameterTypes().size() == 1) {
                        patchedVirtuals.add(ensureOnCreateHandlesIntent(m));
                    } else if ("onNewIntent".equals(m.getName()) && m.getParameterTypes().size() == 1) {
                        patchedVirtuals.add(ensureOnNewIntentHandlesIntent(m));
                    } else {
                        patchedVirtuals.add(m);
                    }
                }
                updatedClasses.add(new ImmutableClassDef(
                        cls.getType(),
                        cls.getAccessFlags(),
                        cls.getSuperclass(),
                        cls.getInterfaces(),
                        cls.getSourceFile(),
                        cls.getAnnotations(),
                        cls.getStaticFields(),
                        cls.getInstanceFields(),
                        deduplicateMethods(cls.getDirectMethods(), false),
                        patchedVirtuals
                ));
                System.out.println("DexAuthPatcher: verified MainActivity onCreate/onNewIntent deep-link handling");
            } else if ("Lcom/example/AndroidBridge;".equals(type)) {
                updatedClasses.add(new ImmutableClassDef(
                        cls.getType(),
                        cls.getAccessFlags(),
                        cls.getSuperclass(),
                        cls.getInterfaces(),
                        cls.getSourceFile(),
                        cls.getAnnotations(),
                        cls.getStaticFields(),
                        cls.getInstanceFields(),
                        deduplicateMethods(cls.getDirectMethods(), false),
                        deduplicateMethods(cls.getVirtualMethods(), false)
                ));
            } else {
                updatedClasses.add(cls);
            }
        }

        DexFile outDex = new ImmutableDexFile(dexFile.getOpcodes(), updatedClasses);
        DexFileFactory.writeDexFile(outputPath, outDex);
        System.out.println("DexAuthPatcher: wrote clean DEX to " + outputPath);
    }

    private static String methodKey(Method m) {
        StringBuilder sb = new StringBuilder();
        sb.append(m.getName()).append("(");
        for (CharSequence p : m.getParameterTypes()) {
            sb.append(p);
        }
        sb.append(")").append(m.getReturnType());
        return sb.toString();
    }

    private static boolean referencesJoaAuthHandler(Method m) {
        MethodImplementation impl = m.getImplementation();
        if (impl == null) return false;
        for (Instruction ins : impl.getInstructions()) {
            if (ins instanceof ReferenceInstruction) {
                Object ref = ((ReferenceInstruction) ins).getReference();
                if (ref != null && ref.toString().contains("Lcom/example/JoaAuthHandler;")) {
                    return true;
                }
            }
        }
        return false;
    }

    private static List<Method> deduplicateMethods(Iterable<? extends Method> methods, boolean preferJoaAuth) {
        Map<String, Method> map = new LinkedHashMap<>();
        for (Method m : methods) {
            String key = methodKey(m);
            Method existing = map.get(key);
            if (existing == null) {
                map.put(key, m);
            } else if (preferJoaAuth && !referencesJoaAuthHandler(existing) && referencesJoaAuthHandler(m)) {
                map.put(key, m);
            }
        }
        return new ArrayList<>(map.values());
    }

    private static Method ensureOnCreateHandlesIntent(Method m) {
        MethodImplementation impl = m.getImplementation();
        if (impl == null || referencesJoaAuthHandler(m)) {
            return m;
        }
        MutableMethodImplementation mutable = new MutableMethodImplementation(impl);
        List<BuilderInstruction> insList = mutable.getInstructions();
        int insertIdx = -1;
        for (int i = 0; i < insList.size(); i++) {
            Instruction ins = insList.get(i);
            if (ins.getOpcode() == Opcode.INVOKE_SUPER && ins instanceof ReferenceInstruction) {
                Object ref = ((ReferenceInstruction) ins).getReference();
                if (ref instanceof MethodReference && "onCreate".equals(((MethodReference) ref).getName())) {
                    insertIdx = i + 1;
                    break;
                }
            }
        }
        if (insertIdx == -1) {
            return m;
        }
        int regCount = mutable.getRegisterCount();
        int p0Reg = regCount - 2; // this (non-static, 1 object parameter)
        if (p0Reg < 1) {
            return m;
        }
        ImmutableMethodReference getIntentRef = new ImmutableMethodReference(
                "Lcom/example/MainActivity;",
                "getIntent",
                Collections.<CharSequence>emptyList(),
                "Landroid/content/Intent;"
        );
        ImmutableMethodReference handleIntentRef = new ImmutableMethodReference(
                "Lcom/example/JoaAuthHandler;",
                "handleActivityIntent",
                Arrays.<CharSequence>asList("Landroid/app/Activity;", "Landroid/content/Intent;"),
                "Z"
        );
        mutable.addInstruction(insertIdx, new BuilderInstruction35c(
                Opcode.INVOKE_VIRTUAL, 1, p0Reg, 0, 0, 0, 0, getIntentRef));
        mutable.addInstruction(insertIdx + 1, new BuilderInstruction11x(
                Opcode.MOVE_RESULT_OBJECT, 0));
        mutable.addInstruction(insertIdx + 2, new BuilderInstruction35c(
                Opcode.INVOKE_STATIC, 2, p0Reg, 0, 0, 0, 0, handleIntentRef));

        System.out.println("DexAuthPatcher: injected JoaAuthHandler.handleActivityIntent into MainActivity.onCreate");
        return new ImmutableMethod(
                m.getDefiningClass(),
                m.getName(),
                m.getParameters(),
                m.getReturnType(),
                m.getAccessFlags(),
                m.getAnnotations(),
                m.getHiddenApiRestrictions(),
                mutable
        );
    }

    private static Method ensureOnNewIntentHandlesIntent(Method m) {
        MethodImplementation impl = m.getImplementation();
        if (impl == null || referencesJoaAuthHandler(m)) {
            return m;
        }
        MutableMethodImplementation mutable = new MutableMethodImplementation(impl);
        List<BuilderInstruction> insList = mutable.getInstructions();
        int insertIdx = -1;
        for (int i = 0; i < insList.size(); i++) {
            Instruction ins = insList.get(i);
            if (ins.getOpcode() == Opcode.INVOKE_SUPER && ins instanceof ReferenceInstruction) {
                Object ref = ((ReferenceInstruction) ins).getReference();
                if (ref instanceof MethodReference && "onNewIntent".equals(((MethodReference) ref).getName())) {
                    insertIdx = i + 1;
                    break;
                }
            }
        }
        if (insertIdx == -1) {
            return m;
        }
        int regCount = mutable.getRegisterCount();
        int p0Reg = regCount - 2;
        int p1Reg = regCount - 1;
        ImmutableMethodReference handleIntentRef = new ImmutableMethodReference(
                "Lcom/example/JoaAuthHandler;",
                "handleActivityIntent",
                Arrays.<CharSequence>asList("Landroid/app/Activity;", "Landroid/content/Intent;"),
                "Z"
        );
        mutable.addInstruction(insertIdx, new BuilderInstruction35c(
                Opcode.INVOKE_STATIC, 2, p0Reg, p1Reg, 0, 0, 0, handleIntentRef));
        System.out.println("DexAuthPatcher: injected JoaAuthHandler.handleActivityIntent into MainActivity.onNewIntent");
        return new ImmutableMethod(
                m.getDefiningClass(),
                m.getName(),
                m.getParameters(),
                m.getReturnType(),
                m.getAccessFlags(),
                m.getAnnotations(),
                m.getHiddenApiRestrictions(),
                mutable
        );
    }
}
