#!/usr/bin/env python3
"""
Build the species catalogue.

Pulls the sharks and whales with a known depth range out of FishBase and
SeaLifeBase, and writes one compact JSON file the server loads at startup.

Sharks and whales only — the nine shark orders (not all of Elasmobranchii, which
would bring 543 rays and skates with it) and the cetaceans (not seals, not
manatees). See KEEP_ORDERS.

    python3 -m pip install --user duckdb
    python3 scripts/build_species.py

What this script CAN do: depth ranges, habitat, taxonomy, common names. Those
are real, sourced fields.

What it CANNOT do: day/night behaviour. No database on Earth holds diel vertical
migration as a queryable column — we checked FishBase's 216 tables, WoRMS
attributes and Sharkipedia. So this script *infers* a day/night split from the
species' habitat and depth range, using the one rule the ocean actually obeys at
scale: pelagic animals over the twilight zone rise at night to feed and sink at
dawn. It is the largest migration on the planet and it is astonishingly regular.

Every inferred species is stamped src="inferred". The hand-curated sharks in
src/species/sharks.js are stamped src="curated" and always win. The UI must show
the difference — an inferred band is a decent guess, not an observation.

Licence note: FishBase and SeaLifeBase are CC-BY-NC 4.0. Non-commercial only.
"""

import json
import os
import sys

try:
    import duckdb
except ImportError:
    sys.exit("need duckdb:  python3 -m pip install --user duckdb")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "species.json")

BASE = "https://data.source.coop/cboettig/fishbase/{db}/v25.04/parquet/{tbl}.parquet"

# Families with well-documented strong diel vertical migration. These are the
# engine of the deep scattering layer — the sonar-reflecting "false seafloor"
# that WWII operators found rising every dusk and sinking every dawn.
DVM_FAMILIES = {
    # fish
    "Myctophidae",        # lanternfishes — the most numerous vertebrates alive
    "Gonostomatidae",     # bristlemouths — most numerous vertebrate genus (Cyclothone)
    "Sternoptychidae",    # hatchetfishes
    "Stomiidae",          # dragonfishes
    "Phosichthyidae",     # lightfishes
    "Melamphaidae",       # bigscales
    "Paralepididae",      # barracudinas
    "Microstomatidae",
    "Bathylagidae",       # deep-sea smelts
    "Opisthoproctidae",   # barreleyes
    # invertebrates
    "Euphausiidae",       # krill
    "Sergestidae",        # sergestid shrimps
    "Oplophoridae",       # deep-sea shrimps
    "Enoploteuthidae",    # squid
    "Histioteuthidae",
    "Cranchiidae",
    "Onychoteuthidae",
    "Ommastrephidae",     # flying squid
    "Pyrosomatidae",      # pyrosomes
    "Salpidae",           # salps
}

# Families that hunt at night and shelter by day. Not a guess — this is what
# they are known for.
NOCTURNAL_FAMILIES = {
    "Holocentridae",   # squirrelfishes — the big eyes are the giveaway
    "Apogonidae",      # cardinalfishes
    "Muraenidae",      # moray eels
    "Congridae",       # conger eels
    "Ophidiidae",      # cusk-eels
    "Priacanthidae",   # bigeyes
    "Haemulidae",      # grunts — rest in daytime schools, disperse to feed at night
    "Pempheridae",     # sweepers
    "Scorpaenidae",    # scorpionfishes
    "Synodontidae",    # lizardfishes
    "Octopodidae",     # many octopuses
    "Palinuridae",     # spiny lobsters
    "Nephropidae",     # clawed lobsters
    "Diodontidae",     # porcupinefishes
}

# Families that are active in daylight and sleep at night. The reef by day.
DIURNAL_FAMILIES = {
    "Labridae",        # wrasses — bury themselves in sand at dusk
    "Scaridae",        # parrotfishes — sleep in a mucus cocoon
    "Pomacentridae",   # damselfishes
    "Chaetodontidae",  # butterflyfishes
    "Pomacanthidae",   # angelfishes
    "Acanthuridae",    # surgeonfishes
    "Balistidae",      # triggerfishes
    "Blenniidae",
    "Gobiidae",
    "Serranidae",      # groupers — mostly crepuscular/diurnal hunters
}

# Animals that breathe air. They live at the surface by necessity and dive from
# it; a "day deep / night shallow" migration is meaningless for them.
AIR_BREATHERS = {"Mammalia", "Reptilia", "Aves"}

# ...and the same check by order, because SeaLifeBase files every sea turtle
# under Class "Not assigned". Going by class alone, the rule missed all of them
# and cheerfully reported that green turtles spend their days at 200 m — an
# animal that has to surface to breathe.
AIR_BREATHING_ORDERS = {
    "Testudines",        # sea turtles
    "Cetacea", "Cetartiodactyla",  # whales, dolphins
    "Sirenia",           # manatees, dugongs
    "Carnivora",         # seals, sea lions, otters
    "Squamata",          # sea snakes
    "Crocodylia",
    "Sphenisciformes", "Procellariiformes", "Charadriiformes",
    "Pelecaniformes", "Suliformes", "Anseriformes", "Gaviiformes",
    "Podicipediformes", "Phaethontiformes",
}

# Things that are attached to the seabed and go nowhere at all.
SESSILE_CLASSES = {
    "Hexacorallia", "Octocorallia", "Anthozoa", "Demospongiae", "Calcarea",
    "Hexactinellida", "Bivalvia", "Ascidiacea", "Crinoidea", "Hydrozoa",
    "Bryozoa", "Homoscleromorpha",
}

# Habitat codes from FishBase's DemersPelag field.
PELAGIC = {"pelagic", "pelagic-oceanic", "pelagic-neritic", "bathypelagic", "benthopelagic"}

MESO_TOP = 200

# ── what the app is about ───────────────────────────────────────────────────
#
# Sharks and whales, and nothing else.
#
# Sharks are the nine shark orders — NOT all of Elasmobranchii, which would drag
# in 543 rays, skates and torpedo rays. Chimaeras (ratfish) are their own thing
# and aren't sharks either.
SHARK_ORDERS = {
    "Carcharhiniformes",   # ground sharks — reef, tiger, hammerheads, catsharks
    "Lamniformes",         # mackerel sharks — great white, mako, threshers, megamouth
    "Squaliformes",        # dogfish sharks — greenland, cookiecutter, lanternsharks
    "Orectolobiformes",    # carpet sharks — whale shark, nurse, wobbegongs
    "Hexanchiformes",      # cow and frilled sharks
    "Squatiniformes",      # angelsharks
    "Heterodontiformes",   # bullhead sharks — horn, Port Jackson
    "Pristiophoriformes",  # sawsharks
    "Echinorhiniformes",   # bramble sharks
}

# Whales, in the sense anyone means it: the cetaceans — whales, dolphins,
# porpoises. Seals (Carnivora) and manatees (Sirenia) are neither.
WHALE_ORDERS = {"Cetacea", "Cetartiodactyla"}

KEEP_ORDERS = SHARK_ORDERS | WHALE_ORDERS


def classify(klass, order, family, habitat, shallow, deep):
    """
    Infer a diel pattern and the day/night bands.

    Only one rule here is strong enough to apply at scale: a pelagic animal whose
    range reaches the twilight zone is almost certainly a vertical migrator. That
    is where the food is, and hiding below the light by day is how it avoids
    being eaten. It is the largest migration on Earth and it is very regular.

    Everything else gets "unknown" unless its family is *known* one way or the
    other. An earlier version of this function guessed "nocturnal" for anything
    shallow that lived near the bottom, which confidently mislabelled every
    wrasse and angelfish on the reef — those are the textbook *diurnal* fish, and
    they sleep at night. A blank is worth more than a wrong answer.
    """
    hab = (habitat or "").lower()

    # Air-breathers dive from the surface; they don't commute with the plankton.
    if klass in AIR_BREATHERS or order in AIR_BREATHING_ORDERS:
        return "airbreather", [0, deep], [0, deep]

    if klass in SESSILE_CLASSES or hab in ("sessile", "host"):
        return "sessile", [shallow, deep], [shallow, deep]

    if hab in PELAGIC and deep >= MESO_TOP:
        dvm = "strong" if family in DVM_FAMILIES else "moderate"
        # Deep by day, up to feed by night.
        day = [max(shallow, round(deep * 0.45)), deep]
        night = [shallow, max(shallow + 30, min(round(deep * 0.18), MESO_TOP))]
        return dvm, day, night

    if family in NOCTURNAL_FAMILIES:
        return "nocturnal", [shallow, deep], [shallow, deep]
    if family in DIURNAL_FAMILIES:
        return "diurnal", [shallow, deep], [shallow, deep]

    return "unknown", [shallow, deep], [shallow, deep]


def fetch(con, db):
    sp = BASE.format(db=db, tbl="species")
    fam = BASE.format(db=db, tbl="families")
    return con.execute(
        f"""
        SELECT
          s.Genus || ' ' || s.Species          AS sci,
          s.FBname                             AS common,
          f.Family                             AS family,
          f."Order"                            AS ord,
          f.Class                              AS class,
          s.DemersPelag                        AS habitat,
          CAST(s.DepthRangeShallow AS INTEGER) AS shallow,
          CAST(s.DepthRangeDeep    AS INTEGER) AS deep,
          CAST(s.Length            AS DOUBLE)  AS length
        FROM '{sp}' s
        LEFT JOIN '{fam}' f USING (FamCode)
        WHERE s.Saltwater = 1
          AND s.DepthRangeDeep IS NOT NULL
          AND s.DepthRangeDeep > 0
          AND s.Species IS NOT NULL
          AND s.Genus   IS NOT NULL
        """
    ).fetchall()


def write_attribution(n_species):
    """
    Write data/species.SOURCES.md next to the data.

    CC-BY-NC asks for three things: credit, a link to the licence, and a statement
    of what was changed. The third is the one that matters most here, and not only
    legally — the day/night bands are DERIVED, and FishBase contains nothing of the
    sort. Nobody must ever mistake them for FishBase data.

    Generated by the build, so it can't drift out of step with what was built.
    """
    path = os.path.join(ROOT, "data", "species.SOURCES.md")
    with open(path, "w") as fh:
        fh.write(f"""# Where `species.json` comes from

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

1. **Filtered** from 44,140 marine species to **{n_species}** — the nine shark
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
""")
    print(f"  attribution → {path}")


def main():
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs;")

    rows = []
    for db, label in (("fb", "FishBase"), ("slb", "SeaLifeBase")):
        got = fetch(con, db)
        print(f"  {label:12} {len(got):>6} marine species with a depth range")
        rows.extend(got)

    seen = set()
    out = []
    skipped = 0
    for sci, common, family, ord_, klass, habitat, shallow, deep in (r[:8] for r in rows):
        if sci in seen or deep is None:
            continue
        if ord_ not in KEEP_ORDERS:
            skipped += 1
            continue
        seen.add(sci)

        shallow = max(0, shallow or 0)
        deep = max(shallow + 1, deep)  # a band needs to have some height
        dvm, day, night = classify(klass, ord_, family, habitat, shallow, deep)

        out.append({
            "sci": sci,
            "common": common or None,
            "family": family or None,
            "order": ord_ or None,
            "class": klass or None,
            "habitat": habitat or None,
            "day": day,
            "night": night,
            "dvm": dvm,
            "maxDepth": deep,
            "src": "inferred",
        })

    out.sort(key=lambda r: r["sci"])

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as fh:
        json.dump(out, fh, separators=(",", ":"))

    write_attribution(len(out))

    size = os.path.getsize(OUT) / 1e6
    by_dvm = {}
    for r in out:
        by_dvm[r["dvm"]] = by_dvm.get(r["dvm"], 0) + 1

    sharks = sum(1 for r in out if r["order"] in SHARK_ORDERS)
    whales = len(out) - sharks

    print(f"\n  wrote {len(out):,} species → {OUT}  ({size:.2f} MB)")
    print(f"  {sharks} sharks, {whales} whales  ({skipped:,} other species left out)")
    print(f"  diel split: {by_dvm}")


if __name__ == "__main__":
    main()
