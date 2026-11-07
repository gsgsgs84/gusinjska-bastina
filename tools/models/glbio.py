"""Read / write a single-mesh, uncompressed GLB as numpy arrays (positions, normals, tangents, uvs, indices)."""
import json, struct
import numpy as np

CT = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}


def read(path):
    b = open(path, 'rb').read(); l = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + l]); bl = struct.unpack('<I', b[20 + l:24 + l])[0]
    blob = b[28 + l:28 + l + bl]

    def acc(i):
        a = j['accessors'][i]; bv = j['bufferViews'][a['bufferView']]
        dt = CT[a['componentType']]; n = NC[a['type']]
        off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        stride = bv.get('byteStride', 0) or np.dtype(dt).itemsize * n
        raw = np.frombuffer(blob, np.uint8, count=stride * (a['count'] - 1) + np.dtype(dt).itemsize * n, offset=off)
        if stride == np.dtype(dt).itemsize * n:
            arr = raw.view(dt).reshape(a['count'], n)
        else:
            arr = np.lib.stride_tricks.as_strided(raw.view(dt), (a['count'], n), (stride, np.dtype(dt).itemsize))
        return np.array(arr)
    p = j['meshes'][0]['primitives'][0]
    m = {k: acc(v) for k, v in p['attributes'].items()}
    m['indices'] = acc(p['indices']).reshape(-1, 3).astype(np.int64)
    images = [bytes(blob[j['bufferViews'][im['bufferView']].get('byteOffset', 0):][:j['bufferViews'][im['bufferView']]['byteLength']]) for im in j['images']]
    return j, m, images


def write(path, j, m, images):
    """Rebuild buffers: one view per attribute, indices, images. Keeps materials/textures/samplers of j."""
    blob = bytearray(); views = []; accs = []

    def add(data, target=None):
        while len(blob) % 4: blob.append(0)
        v = {'buffer': 0, 'byteOffset': len(blob), 'byteLength': len(data)}
        if target: v['target'] = target
        blob.extend(data); views.append(v); return len(views) - 1
    attrs = {}
    for k in ('POSITION', 'NORMAL', 'TANGENT', 'TEXCOORD_0'):
        if k not in m: continue
        a = np.ascontiguousarray(m[k], np.float32)
        vi = add(a.tobytes(), 34962)
        acc = {'bufferView': vi, 'componentType': 5126, 'count': len(a), 'type': {2: 'VEC2', 3: 'VEC3', 4: 'VEC4'}[a.shape[1]]}
        if k == 'POSITION': acc['min'] = a.min(0).tolist(); acc['max'] = a.max(0).tolist()
        accs.append(acc); attrs[k] = len(accs) - 1
    idx = np.ascontiguousarray(m['indices'].reshape(-1), np.uint32)
    vi = add(idx.tobytes(), 34963)
    accs.append({'bufferView': vi, 'componentType': 5125, 'count': len(idx), 'type': 'SCALAR'})
    ii = len(accs) - 1
    imgs = []
    for k, data in enumerate(images):
        vi = add(data); im = dict(j['images'][k]); im['bufferView'] = vi; im.pop('uri', None); imgs.append(im)
    j = dict(j)
    prim = dict(j['meshes'][0]['primitives'][0]); prim['attributes'] = attrs; prim['indices'] = ii
    j['meshes'] = [dict(j['meshes'][0], primitives=[prim])]
    j['accessors'] = accs; j['bufferViews'] = views; j['images'] = imgs
    while len(blob) % 4: blob.append(0)
    j['buffers'] = [{'byteLength': len(blob)}]
    js = json.dumps(j, separators=(',', ':')).encode(); js += b' ' * ((4 - len(js) % 4) % 4)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, 28 + len(js) + len(blob)))
        f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack('<II', len(blob), 0x004E4942)); f.write(bytes(blob))
