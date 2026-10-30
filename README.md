# trails-data branch

Raw inputs for the Gusinje trail relief (the "Planinarske staze" model in the museum app). Not served by the app.

- `tools/fetch_data.py` downloads elevation (Copernicus GLO-30, AWS Terrain Tiles), the trail GPX files listed in `tools/gusinje_trails.csv`, and OpenStreetMap features for the area.
- The GitHub Action in `.github/workflows/trails-data.yml` runs it on every push to this branch (or by hand from the Actions tab) and commits the results to `data-raw/`.

Rights: OpenStreetMap data is ODbL (© OpenStreetMap contributors). Copernicus DEM is free to use with credit. Some GPX files (see the `licence` column of the CSV) are third-party tracks kept here for prototyping only.
