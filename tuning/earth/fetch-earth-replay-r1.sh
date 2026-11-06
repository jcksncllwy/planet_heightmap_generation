#!/bin/sh
# Extra inputs for the Earth replay's R1 start builder (v2/tools/earth-replay-*), on top of fetch-earth-replay.sh: the Müller 2019
# age grids at 65 and 250 Ma (the 0/50/100/150/200 set has no t₀ of 65 or 250) and Merdith 2021's Cratons layer.
set -e
cd "$(dirname "$0")/data/raw"
get() { [ -s "$2" ] || { curl -fL --retry 3 -o "$2.part" "$1" && mv "$2.part" "$2"; }; }
AGE=https://repo.gplates.org/webdav/PlateModel_Age_SR_Grids/Muller_etal_2019_Tectonics/v2.0/Muller_etal_2019_Tectonics_v2.0_netCDF
for a in 65 250; do get "$AGE/Muller_etal_2019_Tectonics_v2.0_AgeGrid-$a.nc" "muller2019/agegrid/age-$a.nc"; done
get https://repo.gplates.org/webdav/pmm/merdith2021/Cratons.zip merdith2021/Cratons.zip
unzip -oq merdith2021/Cratons.zip -d merdith2021/Cratons
