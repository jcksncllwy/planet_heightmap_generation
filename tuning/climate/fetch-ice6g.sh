#!/bin/sh
# ICE-6G_C (Peltier, Argus & Drummond 2015, JGR Solid Earth 120, 450–487; PMIP4's LGM ice sheets: pmip4.lsce.ipsl.fr
# data:ice_ice6g_c) at 0 and 21 ka, 10′ netCDF-3, for v2/tools/make-earth-ice.mjs (check-iceage-earth's artifact). Into
# tuning/climate/data/ice6g/ (gitignored), md5-checked against the PMIP4 page's sums.
set -e
cd "$(dirname "$0")"
mkdir -p data/ice6g && cd data/ice6g
URL='https://sharebox.lsce.ipsl.fr/index.php/s/1RSwVf7afj38cmG/download?path=%2F&files='
get() { [ -s "$1" ] || { curl -fsSL --retry 3 -o "$1.part" "$URL$1" && mv "$1.part" "$1"; }; }
get I6_C.VM5a_10min.0.nc
get I6_C.VM5a_10min.21.nc
sum() { openssl md5 -r "$1" | cut -d' ' -f1; }
[ "$(sum I6_C.VM5a_10min.21.nc)" = 9443668583800099ce9e865be90e4ad6 ] || { echo "I6_C.VM5a_10min.21.nc: md5 mismatch" >&2; exit 1; }
# (0 ka: the sum of the file as fetched 2026-11-25 — the PMIP4 page lists it too)
[ "$(sum I6_C.VM5a_10min.0.nc)" = 5ba8c0df48a12132238ffcbf675578e0 ] || { echo "I6_C.VM5a_10min.0.nc: md5 mismatch" >&2; exit 1; }
echo "ICE-6G_C 0 and 21 ka in $(pwd)"
