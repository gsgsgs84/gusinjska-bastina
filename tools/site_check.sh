#!/bin/bash
# What the published site really serves (status, size, headers, key markers).
B=https://gsgsgs84.github.io/gusinjska-bastina
date -u
for f in staze.html js/staze.js js/i18n.js sw.js external/xr/xr.js external/xr/xr-slam.js external/xr/LICENSE models/staze/teren_ar.glb models/staze/teren.glb data/staze.json; do
  printf "%-28s " "$f"
  curl -s -o /tmp/f -D /tmp/h -w "%{http_code} %{size_download}B " "$B/$f"
  grep -i -E "^(content-type|cache-control|last-modified|access-control-allow-origin):" /tmp/h | tr -d '\r' | tr '\n' ' '
  echo
done
echo "--- markers in js/staze.js"
curl -s "$B/js/staze.js" | grep -o -E "startSlamAR|showChromeSheet|motionPermissions|loadXR8" | sort | uniq -c
echo "--- sw version"
curl -s "$B/sw.js" | grep -o "gkb-v[0-9.]*"
echo "--- github commit on main"
git ls-remote https://github.com/gsgsgs84/gusinjska-bastina refs/heads/main
