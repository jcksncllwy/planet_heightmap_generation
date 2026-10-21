#!/bin/sh
# Earth reference data for the civ layer's Earth test (plans/CIV_PLAN.md §6), downloaded once into tuning/civ/data/raw/
# (gitignored, ~1.3 GB unpacked):
#   WorldClim 2.1 (Fick & Hijmans 2017): monthly temperature and rain, and elevation, at 10′
#   HydroRIVERS v1.0 (Lehner & Grill 2013): rivers with their mean discharge
#   USGS MRDS: mapped mineral deposits
#   ETOPO5 (NOAA NGDC): the sea floor, for the glacial shelves
# The readers need two packages beyond the project's: npm install --no-save geotiff shapefile
set -e
cd "$(dirname "$0")"
mkdir -p data/raw && cd data/raw
get() { [ -s "$2" ] || { curl -fL --retry 3 -o "$2.part" "$1" && mv "$2.part" "$2"; }; }
WC=https://geodata.ucdavis.edu/climate/worldclim/2_1/base
for v in tavg prec elev; do get "$WC/wc2.1_10m_$v.zip" "wc2.1_10m_$v.zip"; unzip -oq "wc2.1_10m_$v.zip" -d wc; done
get https://data.hydrosheds.org/file/HydroRIVERS/HydroRIVERS_v10_shp.zip HydroRIVERS_v10_shp.zip
unzip -oq HydroRIVERS_v10_shp.zip 'HydroRIVERS_v10_shp/HydroRIVERS_v10.shp' 'HydroRIVERS_v10_shp/HydroRIVERS_v10.dbf' 'HydroRIVERS_v10_shp/HydroRIVERS_v10.shx'
get https://mrdata.usgs.gov/mrds/mrds-csv.zip mrds-csv.zip
unzip -oq mrds-csv.zip -d mrds
mkdir -p etopo && get https://www.ngdc.noaa.gov/mgg/global/relief/ETOPO5/TOPO/ETOPO5/ETOPO5.DAT etopo/ETOPO5.DAT
ls -la
