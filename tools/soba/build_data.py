"""Write data/soba.json: stations, fallback codes and marker cells for Mladina sehara.

Sizes are the edge of the black marker square in mm. Test cards exist in all three sizes; the final
cards will use the ids of the size that wins the room test.  Run: python3 tools/soba/build_data.py
"""
import json
import cv2

ids = sorted(json.load(open('tools/soba/station_ids.json'))['ids'])
SIZES = {'S': 60, 'M': 90, 'L': 120}

# Albanian names follow data/exhibits.json where the object exists there; to be checked by a native speaker.
STATIONS = [
    ('radio', 'radio', '417', {'me': 'Stari radio', 'sq': 'Radioja e vjetër', 'en': 'The old radio'}),
    ('mlada', 'vez', '352', {'me': 'Mlada i vez', 'sq': 'Nusja dhe qëndisja', 'en': 'The bride and the embroidery'}),
    ('sofra', 'dzezva', '268', {'me': 'Kafa na sofri', 'sq': 'Kafeja në sofër', 'en': 'Coffee at the sofra'}),
    ('razboj', 'razboj', '731', {'me': 'Razboj i vuna', 'sq': 'Vegja dhe leshi', 'en': 'The loom and the wool'}),
    ('mlatilica', 'mlatilica', '584', {'me': 'Mlatilica i pegle', 'sq': 'Tundësi dhe hekurat', 'en': 'The churn and the irons'}),
    ('sehara', 'sehara', '916', {'me': 'Mladina sehara', 'sq': 'Sënduku i nuses', 'en': "The bride's dowry chest"}),
]

d = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_ARUCO_MIP_36h12)
cells = lambda i: (cv2.aruco.generateImageMarker(d, i, 8) < 128).astype(int).tolist()   # 8x8, 1 = black

out = {
    'name': 'Mladina sehara',
    'dictionary': 'ARUCO_MIP_36h12',
    'sizes': SIZES,
    'note': 'sizes = edge of the black marker square in mm; marker ids per size; code = 3-digit fallback',
    'stations': [],
    'markers': [],
}
for n, (sid, icon, code, name) in enumerate(STATIONS):
    mk = {k: ids[j * 6 + n] for j, k in enumerate(SIZES)}
    out['stations'].append({'id': sid, 'nr': n + 1, 'icon': icon, 'code': code, 'name': name, 'markers': mk})
for i in ids:
    out['markers'].append({'id': i, 'cells': cells(i)})

s = json.dumps(out, ensure_ascii=False, indent=1)
# keep each 8x8 grid on one line per row so the file stays readable
import re
s = re.sub(r'\[\s+([01]),\s+([01]),\s+([01]),\s+([01]),\s+([01]),\s+([01]),\s+([01]),\s+([01])\s+\]', r'[\1,\2,\3,\4,\5,\6,\7,\8]', s)
open('data/soba.json', 'w', encoding='utf-8').write(s + '\n')
print('stations', [(st['id'], st['code'], st['markers']) for st in out['stations']])
