"""Repack an unpacked APK directory into a zip with resources.arsc STORED.

Needed because zipalign from build-tools 35 no longer supports the '-0 <ext>'
switch, and .NET's ZipArchive::NoCompression is a no-op on .NET Framework.

usage: python repack_apk.py <unpackDir> <outApk>
"""
import os
import sys
import zipfile

# Android requires these to be stored uncompressed (and 4-byte aligned) on API 30+.
STORED = {"resources.arsc"}


def main() -> int:
    unpack, out = sys.argv[1], sys.argv[2]
    if os.path.exists(out):
        os.remove(out)

    files = []
    for root, _dirs, names in os.walk(unpack):
        for n in names:
            full = os.path.join(root, n)
            rel = os.path.relpath(full, unpack).replace(os.sep, "/")
            files.append((rel, full))
    files.sort(key=lambda p: p[0])

    with zipfile.ZipFile(out, "w", allowZip64=True) as zf:
        for rel, full in files:
            # Fixed timestamp so the archive is byte-stable between runs.
            info = zipfile.ZipInfo(rel, date_time=(2026, 1, 1, 0, 0, 0))
            info.external_attr = 0o644 << 16
            if rel in STORED:
                info.compress_type = zipfile.ZIP_STORED
            else:
                info.compress_type = zipfile.ZIP_DEFLATED
                info._compresslevel = 9  # type: ignore[attr-defined]
            with open(full, "rb") as src, zf.open(info, "w") as dst:
                while True:
                    chunk = src.read(1 << 20)
                    if not chunk:
                        break
                    dst.write(chunk)

    # Report so the caller can assert the invariant held.
    with zipfile.ZipFile(out) as zf:
        for info in zf.infolist():
            if info.filename in STORED:
                stored = info.compress_type == zipfile.ZIP_STORED
                print(f"{info.filename}: compress_type="
                      f"{'STORED' if stored else 'DEFLATED'} size={info.file_size}")
                if not stored:
                    return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())
