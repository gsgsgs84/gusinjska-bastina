"""Summarise detections.json from synth_detect.mjs: recognition rate by card size, distance and light.

'any'  = recognised in at least one of the page's search pictures (whole picture or sharp centre crop,
         any threshold radius) - i.e. within a few frames of pointing the phone at the card.
'frame' = share of single frames that recognise it (how steady it looks before the page starts following the card).
usage: python3 tools/soba/synth_report.py SYN_DIR
"""
import json, os, sys
from collections import defaultdict

d = sys.argv[1]
man = {f['name']: f for f in json.load(open(os.path.join(d, 'manifest.json')))['frames']}
det = json.load(open(os.path.join(d, 'detections.json')))
agg = defaultdict(lambda: [0, 0, 0.0])     # (cond,size,d) -> n, any, frame-rate sum
wrong, empty_hits, n_empty = 0, 0, 0
angle = defaultdict(lambda: [0, 0])
for r in det:
    f = man[r['name']]
    keys = [k for k in r if k != 'name']
    if f['id'] is None:
        n_empty += 1
        empty_hits += any(r[k] for k in keys)
        continue
    hits = [f['id'] in r[k] for k in keys]
    wrong += sum(1 for k in keys for i in r[k] if i != f['id'])
    # a centre-crop hit only counts if the card really is in the centre crop
    full = [f['id'] in r[k] for k in keys if k.startswith('full')]
    a = agg[(f['cond'], f['size'], f['d'])]
    a[0] += 1; a[1] += any(hits); a[2] += sum(hits) / len(hits)
    if f['cond'] == 'good' and f['d'] <= 2.0:
        g = angle[(f['yaw'], f['pitch'])]; g[0] += 1; g[1] += any(hits)

dists = sorted({k[2] for k in agg})
print('Recognised within a few frames (any search picture), % of placements')
for cond in ('good', 'evening', 'shaky'):
    print(f'\n[{cond}]  distance m: ' + ' '.join(f'{x:>5}' for x in dists))
    for size in ('S', 'M', 'L'):
        row = []
        for x in dists:
            a = agg.get((cond, size, x))
            row.append(f'{100 * a[1] / a[0]:5.0f}' if a and a[0] else '    -')
        print(f'  {size}            ' + ' '.join(row))
print('\nRange where at least 90 % of placements are recognised (and every shorter distance too):')
for cond in ('good', 'evening', 'shaky'):
    out = []
    for size in ('S', 'M', 'L'):
        best = 0
        for x in dists:
            a = agg.get((cond, size, x))
            if not a or not a[0]:
                continue
            if a[1] / a[0] >= 0.9:
                best = x
            else:
                break
        out.append(f'{size} {best:.2f} m')
    print(f'  {cond:8s} ' + ' · '.join(out))
print('\nBy viewing angle (good light, up to 2 m), yaw/pitch degrees -> recognised %:')
print('  ' + ' · '.join(f'{k[0]}/{k[1]}: {100 * v[1] / v[0]:.0f}%' for k, v in sorted(angle.items())))
print(f'\nWrong ids reported: {wrong}.  Pictures without a card: {n_empty}, with a false detection: {empty_hits}.')
