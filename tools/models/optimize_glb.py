"""Optimise a Meshy GLB for the museum app.
usage: python3 tools/models/optimize_glb.py SRC.glb OUT.glb [TARGET_TRIANGLES=80000]
1) gltfpack simplification (no quantization, so the iPhone USDZ export keeps working)
2) textures re-encoded: base colour 2048 px JPEG q86, metallic-roughness and normal maps 1024 px
3) gltfpack -cc (meshopt compression) for the final file
"""
import io, json, os, struct, subprocess, sys, tempfile
from PIL import Image
GLTFPACK = os.environ.get('GLTFPACK', '/home/claude/museum/meshopt/build/gltfpack')

def read_glb(p):
    b = open(p, 'rb').read(); l = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + l]); bl = struct.unpack('<I', b[20 + l:24 + l])[0]
    return j, bytearray(b[28 + l:28 + l + bl])

def write_glb(p, j, blob):
    js = json.dumps(j, separators=(',', ':')).encode(); js += b' ' * ((4 - len(js) % 4) % 4)
    blob = bytes(blob) + b'\0' * ((4 - len(blob) % 4) % 4)
    with open(p, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, 28 + len(js) + len(blob)))
        f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack('<II', len(blob), 0x004E4942)); f.write(blob)

def tris(j):
    return sum(j['accessors'][p['indices']]['count'] // 3 for m in j['meshes'] for p in m['primitives'] if 'indices' in p)

def retexture(src, dst):
    j, blob = read_glb(src)
    role = {}
    for m in j.get('materials', []):
        pbr = m.get('pbrMetallicRoughness', {})
        if 'baseColorTexture' in pbr: role[j['textures'][pbr['baseColorTexture']['index']]['source']] = 'color'
        if 'metallicRoughnessTexture' in pbr: role[j['textures'][pbr['metallicRoughnessTexture']['index']]['source']] = 'mr'
        if 'normalTexture' in m: role[j['textures'][m['normalTexture']['index']]['source']] = 'normal'
    # rebuild the binary buffer view by view, replacing image views
    out = bytearray(); newviews = []
    img_view = {im['bufferView']: i for i, im in enumerate(j.get('images', []))}
    for vi, bv in enumerate(j['bufferViews']):
        data = bytes(blob[bv.get('byteOffset', 0): bv.get('byteOffset', 0) + bv['byteLength']])
        if vi in img_view:
            i = img_view[vi]; r = role.get(i, 'color')
            im = Image.open(io.BytesIO(data)).convert('RGB')
            side = 2048 if r == 'color' else 1024
            if max(im.size) > side: im = im.resize((side, side), Image.LANCZOS)
            buf = io.BytesIO(); im.save(buf, 'JPEG', quality={'color': 86, 'mr': 85, 'normal': 92}[r], optimize=True, progressive=False)
            data = buf.getvalue(); j['images'][i]['mimeType'] = 'image/jpeg'
        while len(out) % 4: out.append(0)
        nb = dict(bv); nb['byteOffset'] = len(out); nb['byteLength'] = len(data); out += data; newviews.append(nb)
    j['bufferViews'] = newviews; j['buffers'][0]['byteLength'] = len(out)
    write_glb(dst, j, out)

if __name__ == '__main__':
    src, out = sys.argv[1], sys.argv[2]; target = int(sys.argv[3]) if len(sys.argv) > 3 else 80000
    j, _ = read_glb(src); n = tris(j); ratio = min(1.0, target / max(n, 1))
    with tempfile.TemporaryDirectory() as td:
        a, b = os.path.join(td, 'a.glb'), os.path.join(td, 'b.glb')
        subprocess.run([GLTFPACK, '-i', src, '-o', a, '-noq', '-si', f'{ratio:.5f}'], check=True, stdout=subprocess.DEVNULL)
        retexture(a, b)
        subprocess.run([GLTFPACK, '-i', b, '-o', out, '-noq', '-cc'], check=True, stdout=subprocess.DEVNULL)
    jo, _ = read_glb(out)
    print(f'{os.path.basename(out)}: {n/1e6:.2f}M -> {tris(jo)/1e3:.0f}k triangles, {os.path.getsize(out)/1e6:.2f} MB')
