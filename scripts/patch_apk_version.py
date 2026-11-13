#!/usr/bin/env python3
import sys, os, struct, zipfile, subprocess, tempfile

def patch_manifest(apk_path, version_name="1.0.9", version_code=9):
    if not os.path.exists(apk_path):
        print(f"File not found: {apk_path}")
        return False

    with zipfile.ZipFile(apk_path, 'r') as z:
        manifest_data = bytearray(z.read('AndroidManifest.xml'))

    # 1. Parse string pool
    string_count, style_count, flags, strings_start, styles_start = struct.unpack_from('<IIIII', manifest_data, 16)
    offsets = [struct.unpack_from('<I', manifest_data, 36 + i*4)[0] for i in range(string_count)]
    strings = []
    version_str_idx = -1
    for i, off in enumerate(offsets):
        str_abs = 8 + strings_start + off
        length = struct.unpack_from('<H', manifest_data, str_abs)[0]
        val = manifest_data[str_abs+2 : str_abs+2 + length*2].decode('utf-16le')
        if val in ["1.0", "1.0.4", "1.0.5", "1.0.6", "1.0.7", "1.0.8", "1.0.9"]:
            version_str_idx = i
        strings.append(val)

    if version_str_idx != -1:
        strings[version_str_idx] = version_name
    else:
        # Check if 30 is version
        if len(strings) > 30 and ("1." in strings[30] or "v1." in strings[30]):
            strings[30] = version_name

    # Rebuild string pool chunk:
    new_str_data = bytearray()
    new_offsets = []
    for s in strings:
        new_offsets.append(len(new_str_data))
        new_str_data.extend(struct.pack('<H', len(s)))
        new_str_data.extend(s.encode('utf-16le'))
        new_str_data.extend(b'\x00\x00')

    while len(new_str_data) % 4 != 0:
        new_str_data.extend(b'\x00')

    header_size = 28
    new_strings_start = header_size + len(new_offsets) * 4
    new_chunk_size = new_strings_start + len(new_str_data)

    new_pool = bytearray()
    new_pool.extend(struct.pack('<HHI', 0x0001, header_size, new_chunk_size))
    new_pool.extend(struct.pack('<IIIII', string_count, style_count, flags, new_strings_start, styles_start))
    for off in new_offsets:
        new_pool.extend(struct.pack('<I', off))
    new_pool.extend(new_str_data)

    old_chunk_size = struct.unpack_from('<I', manifest_data, 12)[0]
    new_manifest = bytearray(manifest_data[:8]) + new_pool + bytearray(manifest_data[8+old_chunk_size:])
    struct.pack_into('<I', new_manifest, 4, len(new_manifest))

    # 2. Patch versionCode (attribute name index 14, dataType 0x10)
    for pos in range(0, len(new_manifest)-20, 4):
        ns, name, raw, size, res0, dtype, val = struct.unpack_from('<IIIHBBI', new_manifest, pos)
        if name == 14 and size == 8 and dtype == 0x10 and val in [1, 4, 5, 6, 7, 8, 105, 106]:
            struct.pack_into('<I', new_manifest, pos + 16, version_code)
            break

    # 3. Write back to APK
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_manifest = os.path.join(tmpdir, "AndroidManifest.xml")
        with open(tmp_manifest, "wb") as f:
            f.write(new_manifest)
        subprocess.run(["zip", "-u", os.path.abspath(apk_path), "AndroidManifest.xml"], cwd=tmpdir, check=True)

    print(f"Patched {apk_path} successfully to versionName={version_name}, versionCode={version_code}")
    return True

if __name__ == '__main__':
    target = sys.argv[1] if len(sys.argv) > 1 else ".build-outputs/app-debug.apk"
    ver = sys.argv[2] if len(sys.argv) > 2 else "1.0.9"
    code = int(sys.argv[3]) if len(sys.argv) > 3 else 9
    patch_manifest(target, ver, code)
