# Where `species.json` comes from

`species.json` is a **derivative work**. This file records what it was made from,
what was changed, and under what terms it may be used — as CC-BY-NC 4.0 requires.

## Sources

**FishBase** — depth ranges, habitat, common names, taxonomy for the sharks.
> Froese, R. and D. Pauly, eds. (2025). *FishBase.* World Wide Web electronic
> publication. <https://www.fishbase.org>

**SeaLifeBase** — the same fields for the cetaceans.
> Palomares, M.L.D. and D. Pauly, eds. (2025). *SeaLifeBase.* World Wide Web
> electronic publication. <https://www.sealifebase.org>

Accessed via the Parquet snapshot **v25.04** published by Carl Boettiger:
<https://data.source.coop/cboettig/fishbase/>

## Licence

Both are licensed **CC-BY-NC 4.0** — attribution required, **non-commercial use
only**.

<https://creativecommons.org/licenses/by-nc/4.0/>

This derivative inherits those terms. Share it, study it, build on it, teach with
it. Do not sell it or run it commercially without replacing this file.

## What was changed

The source databases were **not** copied wholesale. This file is the result of:

1. **Filtered** from 44,140 marine species to **539** — the nine shark
   orders (not all of Elasmobranchii, which would include rays and skates) and the
   cetaceans. See `KEEP_ORDERS` in `scripts/build_species.py`.
2. **Kept** only: scientific name, common name, family, order, class, habitat
   (`DemersPelag`), and depth range (`DepthRangeShallow` / `DepthRangeDeep`).
   Everything else was dropped.
3. **Renamed and restructured** into a compact JSON record per species.

## What was ADDED, and is not FishBase data

> ⚠️ The **`day`, `night` and `dvm` fields are ours.** They do not exist in
> FishBase or SeaLifeBase, or in any other database we could find — we checked
> FishBase's 216 tables, WoRMS attributes and Sharkipedia. Diel vertical migration
> is not published as a queryable field anywhere.

They are **inferred** by a rule of our own (`classify()` in
`scripts/build_species.py`): a pelagic animal whose depth range reaches the
twilight zone is treated as a vertical migrator. It's a sound rule — it is the
mechanism behind the deep scattering layer — but it is a rule, not an observation.
Every such record is stamped `"src": "inferred"`.

The 48 sharks in `src/species/sharks.js` are the exception: their day/night depths
are hand-curated from the tagging and survey literature, stamped `"src":
"curated"`, and are not derived from FishBase either.

**Do not cite the day/night values as FishBase data. They are not.**
