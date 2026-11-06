#!/bin/sh
# Plate-reconstruction data for the Earth replay study (~/obsidian/brain/projects/geo-sim-earth-replay-study.md), downloaded
# once into tuning/earth/data/raw/ (gitignored, ~40 MB). Source: the GPlates plate-model manager
# (https://repo.gplates.org/webdav/pmm/config/models.json, the index GPlately's PlateModelManager reads), so the URLs are
# the ones the GPlates team keeps current. Licence: EarthByte models are CC BY 4.0 (cite the paper; redistribution allowed
# with attribution) — but they stay out of git anyway: they are inputs, fetched reproducibly, not code.
#   Müller et al. 2019 (Tectonics 38, doi:10.1029/2018TC005462): 0–250 Ma, mantle reference frame, deforming regions.
#     Rotations (.rot), static polygons (plate ids for every piece of crust), continental polygons, coastlines,
#     and its oceanic age grids at 0 / 50 / 100 / 150 / 200 Ma (netCDF, 0.1°).
#   Merdith et al. 2021 (ESR 214, doi:10.1016/j.earscirev.2020.103477): 0–1000 Ma, palaeomagnetic frame. Rotations and
#     static polygons only — for the free-run statistics (mode 2), not the replay.
# Pass --all-ages for every age grid 0–250 Ma in 10 Myr steps (~200 MB more).
set -e
cd "$(dirname "$0")"
mkdir -p data/raw && cd data/raw
get() { [ -s "$2" ] || { curl -fL --retry 3 -o "$2.part" "$1" && mv "$2.part" "$2"; }; }
PMM=https://repo.gplates.org/webdav/pmm
for m in muller2019 merdith2021; do
    mkdir -p "$m"
    for layer in Rotations StaticPolygons ContinentalPolygons Coastlines Topologies; do
        [ "$m" = merdith2021 ] && [ "$layer" != Rotations ] && [ "$layer" != StaticPolygons ] && continue
        get "$PMM/$m/$layer.zip" "$m/$layer.zip"
        unzip -oq "$m/$layer.zip" -d "$m/$layer"
    done
done
AGE=https://repo.gplates.org/webdav/PlateModel_Age_SR_Grids/Muller_etal_2019_Tectonics/v2.0/Muller_etal_2019_Tectonics_v2.0_netCDF
mkdir -p muller2019/agegrid
AGES="0 50 100 150 200"
[ "$1" = --all-ages ] && AGES=$(seq 0 10 250)
for a in $AGES; do get "$AGE/Muller_etal_2019_Tectonics_v2.0_AgeGrid-$a.nc" "muller2019/agegrid/age-$a.nc"; done
du -sh .
# The age grids are netCDF4 (HDF5): the probe reads them with h5wasm, installed here and not into the project's node_modules
cd .. && [ -d node_modules/h5wasm ] || npm install --no-save --no-package-lock --prefix . h5wasm
# Resolving the plate topologies (v2/tools/earth-replay-topologies.py) needs pygplates (PyPI; wheels for Python ≤ 3.12 —
# not 3.14): uv venv -p 3.12 data/venv && VIRTUAL_ENV=$PWD/data/venv uv pip install pygplates
