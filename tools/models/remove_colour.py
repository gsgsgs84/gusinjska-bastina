"""Remove triangles whose base-colour texture matches a colour test (e.g. a display stand Meshy added).
usage: python3 tools/models/remove_colour.py SRC.glb OUT.glb pink   (writes an uncompressed GLB; optimise it afterwards)"""
import io, json, struct, sys
import numpy as np
from PIL import Image
sys.path.insert(0, __file__.rsplit('/', 1)[0]); import optimize_glb as o

TESTS = {  # rgb arrays 0..255 -> bool
    'salmon': lambda c: (c[:, 0] > 140) & (c[:, 2] > 50) & (c[:, 0] - c[:, 1] > 55),   # Meshy's pink display stand (padlock)
    'pink': lambda c: (c[:, 0] > 150) & (c[:, 2] > 95) & (c[:, 0] - c[:, 1] > 45) & (c[:, 2] - c[:, 1] > -25),
}
def acc_array(j, blob, i):
    a = j['accessors'][i]; bv = j['bufferViews'][a['bufferView']]
    n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
    dt = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8}[a['componentType']]
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    return np.frombuffer(bytes(blob[off: off + a['count'] * n * np.dtype(dt).itemsize]), dt).reshape(a['count'], n) if n > 1 else \
           np.frombuffer(bytes(blob[off: off + a['count'] * np.dtype(dt).itemsize]), dt)

src, out, test = sys.argv[1], sys.argv[2], TESTS[sys.argv[3]]
j, blob = o.read_glb(src)
prim = j['meshes'][0]['primitives'][0]
uv = acc_array(j, blob, prim['attributes']['TEXCOORD_0']); idx = acc_array(j, blob, prim['indices']).reshape(-1, 3)
mat = j['materials'][prim['material']]; img_i = j['textures'][mat['pbrMetallicRoughness']['baseColorTexture']['index']]['source']
bv = j['bufferViews'][j['images'][img_i]['bufferView']]
tex = np.asarray(Image.open(io.BytesIO(bytes(blob[bv.get('byteOffset', 0): bv.get('byteOffset', 0) + bv['byteLength']]))).convert('RGB')).astype(int)
H, W = tex.shape[:2]
c = uv[idx].mean(1); px = np.clip((c[:, 0] % 1) * W, 0, W - 1).astype(int); py = np.clip((c[:, 1] % 1) * H, 0, H - 1).astype(int)
drop = test(tex[py, px])
print(f'dropping {drop.sum()} of {len(idx)} triangles ({100 * drop.mean():.1f} %)')
keep = idx[~drop].astype(np.uint32).ravel()
# append new index data at the end of the buffer and point the primitive at it
pad = (4 - len(blob) % 4) % 4; blob += b'\0' * pad
j['bufferViews'].append({'buffer': 0, 'byteOffset': len(blob), 'byteLength': keep.nbytes, 'target': 34963})
blob += keep.tobytes()
j['accessors'].append({'bufferView': len(j['bufferViews']) - 1, 'componentType': 5125, 'count': int(keep.size), 'type': 'SCALAR'})
prim['indices'] = len(j['accessors']) - 1
j['buffers'][0]['byteLength'] = len(blob)
o.write_glb(out, j, blob)
