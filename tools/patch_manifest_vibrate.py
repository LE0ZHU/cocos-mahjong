"""Inject android.permission.VIBRATE into a compiled (binary) AndroidManifest.xml.

Why this exists:
    The game's vibration feedback (assets/scripts/feedback/Haptics.ts) calls the
    engine's native vibrator. Android silently ignores the call unless the app
    declares android.permission.VIBRATE. The Cocos Android template does not
    declare it, and tools/patch-apk.ps1 repacks a *prebuilt* baseline APK, so the
    native project is never rebuilt during the fast iteration loop.

How it patches:
    AndroidManifest.xml inside an APK is binary AXML: a string pool followed by
    element chunks that reference strings by index. We do NOT re-encode existing
    content. Instead we:
      1. append the string "android.permission.VIBRATE" to the pool (existing
         string indices stay valid; only the pool's offset table grows by 4 bytes);
      2. clone one existing <uses-permission android:name="..."/> element byte for
         byte (so namespace/attribute encodings are exactly what aapt produced)
         and only re-point its value to the new string;
      3. insert the clone right before <application> and fix the root chunk size.
    The result is verified with `aapt2 dump xmltree` in the test workflow.

Idempotent: running it twice is a no-op (checks for the value string first).

usage: python patch_manifest_vibrate.py <unpacked-apk-dir | AndroidManifest.xml>
exit code 0 on success (including "already present"), non-zero on error.
"""
import os
import struct
import sys

PERMISSION = 'android.permission.VIBRATE'

CHUNK_XML = 0x0003
CHUNK_POOL = 0x0001
CHUNK_START_ELEMENT = 0x0102
CHUNK_END_ELEMENT = 0x0103


class PatchError(RuntimeError):
    pass


def read_chunks(data):
    """Yield (chunk_type, offset, header_size, size) for every top-level chunk."""
    if len(data) < 8:
        raise PatchError('file too small to be AXML')
    ctype, _hsize, _size = struct.unpack_from('<HHI', data, 0)
    if ctype != CHUNK_XML:
        raise PatchError('not a binary AndroidManifest.xml (bad root chunk)')
    off = 8
    while off < len(data):
        if off + 8 > len(data):
            raise PatchError('truncated chunk header at %d' % off)
        ctype, hsize, size = struct.unpack_from('<HHI', data, off)
        if size < 8 or off + size > len(data):
            raise PatchError('chunk at %d has invalid size %d' % (off, size))
        yield ctype, off, hsize, size
        off += size


def parse_pool(data, off):
    """Return a dict describing the string pool chunk."""
    ctype, hsize, size = struct.unpack_from('<HHI', data, off)
    if ctype != CHUNK_POOL:
        raise PatchError('expected a string pool right after the root chunk')
    count, style_count, flags, strings_start, styles_start = struct.unpack_from('<IIIII', data, off + 8)
    if style_count != 0:
        raise PatchError('string pool has styles (%d) -- unsupported, extend the patcher' % style_count)
    utf8 = bool(flags & 0x100)
    offsets = list(struct.unpack_from('<%dI' % count, data, off + 28))
    return {
        'off': off, 'size': size, 'count': count, 'flags': flags, 'utf8': utf8,
        'strings_start': strings_start, 'styles_start': styles_start, 'offsets': offsets,
    }


def string_at(data, off, pool, i):
    p = off + pool['strings_start'] + pool['offsets'][i]
    if pool['utf8']:
        n = data[p]
        p += 1
        if n & 0x80:
            n = ((n & 0x7F) << 8) | data[p]
            p += 1
        return data[p:p + n].decode('utf-8', 'replace')
    n = struct.unpack_from('<H', data, p)[0]
    p += 2
    return data[p:p + n * 2].decode('utf-16-le', 'replace')


def element_name_index(data, off):
    """name string index of a StartElement / EndElement chunk

    Layout of ResXMLTree_node + ResXMLTree_attrExt:
        +0  header (8)  | +8 lineNumber | +12 comment
        +16 attrExt.ns  | +20 attrExt.name  <- the one we want
    """
    return struct.unpack_from('<I', data, off + 20)[0]


def encode_utf16_string(text):
    raw = text.encode('utf-16-le')
    out = struct.pack('<H', len(text)) + raw + b'\x00\x00'
    pad = (-len(out)) % 4
    return out + b'\x00' * pad


def encode_utf8_string(text):
    raw = text.encode('utf-8')
    n = len(raw)
    if n < 0x80:
        lead = struct.pack('<B', n)
    else:
        lead = struct.pack('>BB', 0x80 | (n >> 8), n & 0xFF)
    out = lead + raw + b'\x00'
    pad = (-len(out)) % 4
    return out + b'\x00' * pad


def patch(manifest_path):
    data = open(manifest_path, 'rb').read()
    chunks = list(read_chunks(data))

    pool = None
    elements = []          # (name_string_index -> handled later)
    for ctype, off, hsize, size in chunks:
        if ctype == CHUNK_POOL and pool is None:
            pool = parse_pool(data, off)
    if pool is None:
        raise PatchError('no string pool chunk found')

    # resolve element names + collect the info we need
    uses_permission = []   # (start_off, end_off) covering Start+End pair
    application_off = None
    value_index = None     # index of PERMISSION if it already exists
    for i, (ctype, off, hsize, size) in enumerate(chunks):
        if ctype == CHUNK_START_ELEMENT:
            name_idx = element_name_index(data, off)
            if name_idx >= pool['count']:
                continue
            name = string_at(data, pool['off'], pool, name_idx)
            if name == 'application' and application_off is None:
                application_off = off
            if name == 'uses-permission':
                # pair with the next EndElement chunk
                end_off = None
                for ctype2, off2, _h2, size2 in chunks[i + 1:]:
                    if ctype2 == CHUNK_END_ELEMENT:
                        end_off = off2 + size2
                        break
                    if ctype2 == CHUNK_START_ELEMENT:
                        break  # malformed (no close) -- bail on this candidate
                if end_off:
                    uses_permission.append((off, end_off))

    if not uses_permission:
        raise PatchError('no <uses-permission> element to clone')
    if application_off is None:
        raise PatchError('<application> element not found (nothing to insert before)')

    for i in range(pool['count']):
        if string_at(data, pool['off'], pool, i) == PERMISSION:
            value_index = i
            break

    if value_index is not None:
        print('manifest already declares %s -- nothing to do' % PERMISSION)
        return False

    # ---- 1. new string pool: same bytes + one appended entry -----------------
    new_idx = pool['count']
    data_start = pool['off'] + pool['strings_start']
    data_len = pool['size'] - pool['strings_start']
    if pool['styles_start']:
        raise PatchError('pool has a style data area -- unsupported')
    string_data = data[data_start:data_start + data_len]
    new_string = encode_utf8_string(PERMISSION) if pool['utf8'] else encode_utf16_string(PERMISSION)

    if data_len % 4 != 0:
        # aapt pads every string to 4 bytes, so this should not happen; keep sane anyway
        string_data += b'\x00' * ((-data_len) % 4)

    new_offsets = pool['offsets'] + [len(string_data)]
    new_strings_start = 28 + 4 * (new_idx + 1)
    new_pool_size = new_strings_start + len(string_data) + len(new_string)
    new_pool = bytearray()
    new_pool += struct.pack('<HHI', CHUNK_POOL, 28, new_pool_size)
    new_pool += struct.pack('<IIIII', new_idx + 1, 0, pool['flags'], new_strings_start, 0)
    new_pool += struct.pack('<%dI' % len(new_offsets), *new_offsets)
    new_pool += string_data + new_string

    # ---- 2. clone one uses-permission element pair, re-point its value -------
    tmpl_start, tmpl_end = uses_permission[-1]
    elem = bytearray(data[tmpl_start:tmpl_end])
    ctype, hsize, size = struct.unpack_from('<HHI', data, tmpl_start)
    attr_start, attr_size, attr_count = struct.unpack_from('<HHH', data, tmpl_start + 24)
    if ctype != CHUNK_START_ELEMENT or attr_count != 1:
        raise PatchError('unexpected <uses-permission> layout to clone')
    attr_base = 16 + attr_start
    struct.pack_into('<I', elem, attr_base + 8, new_idx)    # rawValue string ref
    struct.pack_into('<I', elem, attr_base + 16, new_idx)   # typedValue.data (TYPE_STRING)

    # ---- 3. splice: [root hdr][new pool][rest .. application)[clone][application ..]
    pool_end = pool['off'] + pool['size']
    inserted_len = len(elem) + (len(new_pool) - pool['size'])
    # pool growth shifts every later offset, but all of them are self-relative,
    # so only the root chunk size needs updating.
    out = bytearray()
    root_type, root_hsize, root_size = struct.unpack_from('<HHI', data, 0)
    out += struct.pack('<HHI', root_type, root_hsize, root_size + inserted_len)
    out += new_pool
    out += data[pool_end:application_off]
    out += elem
    out += data[application_off:]
    assert len(out) == len(data) + inserted_len

    open(manifest_path, 'wb').write(out)
    print('injected %s (+%d bytes: use-permission element + string pool entry)'
          % (PERMISSION, inserted_len))
    return True


def main(argv):
    if len(argv) != 2:
        print(__doc__)
        return 2
    path = argv[1]
    if os.path.isdir(path):
        path = os.path.join(path, 'AndroidManifest.xml')
    if not os.path.isfile(path):
        print('ERROR: manifest not found: %s' % path)
        return 2
    try:
        patch(path)
    except PatchError as e:
        print('ERROR: %s' % e)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
