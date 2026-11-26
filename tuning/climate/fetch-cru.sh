#!/bin/sh
# CRU CL 2.0 (New, Lister, Hulme & Makin 2002, Climate Research 21: 1–25): the 1961–90 mean monthly climate at 10′ over land —
# temperature (°C), precipitation (mm a month, then its 12 coefficients of variation) and the grid's elevation (km). The
# observation side of tools/iceage-inception.mjs's sites (lane iceage B2). Into data/cru/ (gitignored, ~15 MB).
set -e
cd "$(dirname "$0")"
mkdir -p data/cru && cd data/cru
for f in grid_10min_tmp.dat.gz grid_10min_pre.dat.gz grid_10min_elv.dat.gz; do
    [ -s "$f" ] || curl -fL --retry 3 -o "$f" "https://crudata.uea.ac.uk/cru/data/hrg/tmc/$f"
done
cat > md5.txt <<'M'
329c5e44908441664d341ff245d8f2c8  grid_10min_tmp.dat.gz
3aac7f77d9380b35673ee3a86f69024e  grid_10min_pre.dat.gz
706488e9f150cc400d7f0c54f14a5b5e  grid_10min_elv.dat.gz
M
for f in grid_10min_tmp.dat.gz grid_10min_pre.dat.gz grid_10min_elv.dat.gz; do
    want=$(grep " $f\$" md5.txt | cut -d' ' -f1); got=$(openssl md5 -r "$f" | cut -d' ' -f1)
    [ "$want" = "$got" ] || { echo "md5 mismatch: $f" >&2; exit 1; }
done
echo "CRU CL 2.0: ok"
