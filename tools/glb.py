"""Minimal glTF 2.0 binary writer: one mesh, one material, vertex colours optional."""
import json, struct
import numpy as np

def srgb2lin(c):
    c = np.asarray(c, float) / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)

def write_glb(path, pos, nrm, idx, col=None, name="mesh", base=(1, 1, 1, 1), metal=0.0, rough=0.9):
    pos = np.asarray(pos, np.float32); nrm = np.asarray(nrm, np.float32); idx = np.asarray(idx, np.uint32)
    bufs = [pos.tobytes(), nrm.tobytes()]
    attrs = {"POSITION": 0, "NORMAL": 1}
    acc = [{"bufferView": 0, "componentType": 5126, "count": len(pos), "type": "VEC3", "min": pos.min(0).tolist(), "max": pos.max(0).tolist()},
           {"bufferView": 1, "componentType": 5126, "count": len(nrm), "type": "VEC3"}]
    if col is not None:
        c4 = np.concatenate([np.asarray(col, np.float32), np.ones((len(col), 1), np.float32)], 1)
        bufs.append(c4.tobytes()); attrs["COLOR_0"] = len(acc)
        acc.append({"bufferView": len(acc), "componentType": 5126, "count": len(c4), "type": "VEC4"})
    bufs.append(idx.tobytes())
    acc.append({"bufferView": len(acc), "componentType": 5125, "count": len(idx), "type": "SCALAR"})
    views, blob = [], b""
    for i, b in enumerate(bufs):
        views.append({"buffer": 0, "byteOffset": len(blob), "byteLength": len(b), "target": 34963 if i == len(bufs) - 1 else 34962})
        blob += b + b"\0" * ((4 - len(b) % 4) % 4)
    g = {"asset": {"version": "2.0", "generator": "gusinjska-bastina tools"}, "scene": 0, "scenes": [{"nodes": [0]}],
         "nodes": [{"mesh": 0, "name": name}],
         "meshes": [{"name": name, "primitives": [{"attributes": attrs, "indices": len(acc) - 1, "material": 0}]}],
         "materials": [{"name": name, "pbrMetallicRoughness": {"baseColorFactor": list(base), "metallicFactor": metal, "roughnessFactor": rough}}],
         "buffers": [{"byteLength": len(blob)}], "bufferViews": views, "accessors": acc}
    js = json.dumps(g, separators=(",", ":")).encode(); js += b" " * ((4 - len(js) % 4) % 4)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, 28 + len(js) + len(blob)))
        f.write(struct.pack("<II", len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack("<II", len(blob), 0x004E4942)); f.write(blob)

class Mesh:
    def __init__(self): self.P, self.N, self.C, self.I = [], [], [], []
    def grid(self, P, N, C):
        """P,N: (rows, cols, 3) grid, cols wrap if P[:,0]==P[:,-1] handled by duplicating seam."""
        r, c = P.shape[:2]; b = len(self.P)
        self.P += list(P.reshape(-1, 3)); self.N += list(N.reshape(-1, 3)); self.C += list(np.broadcast_to(C, (r * c, 3)) if np.ndim(C) == 1 else C.reshape(-1, 3))
        for i in range(r - 1):
            for j in range(c - 1):
                a = b + i * c + j
                self.I += [a, a + 1, a + c, a + 1, a + c + 1, a + c]   # outward for profiles traced bottom-centre -> out -> up -> top-centre
    def done(self):
        return np.array(self.P), np.array(self.N), np.array(self.I), np.array(self.C)
