/**
 * Curated shark traits.
 *
 * OBIS can tell us *where* a shark has been seen. It cannot tell us how deep it
 * hunts at 3am. No public API holds diel vertical migration behaviour in a
 * queryable form — it lives in tagging papers, one species at a time — so this
 * table is hand-assembled from the telemetry and survey literature.
 *
 * Depths are metres below the surface, as [shallow, deep] bands describing
 * where the animal spends most of its time — not the record-breaking outlier.
 * `maxDepth` is that outlier, kept separately.
 *
 * dvm:
 *   'strong'   — migrates hundreds of metres on a daily cycle, like clockwork
 *   'moderate' — a consistent but shallower day/night shift
 *   'reverse'  — goes DEEPER at night (rarer; usually predator avoidance)
 *   'none'     — depth doesn't track the sun
 *   'nocturnal'— little vertical shift, but active by night and resting by day
 *
 * Numbers are approximations of central tendency and vary by region, sex, life
 * stage and season. Good enough to be honest; not a substitute for the papers.
 */

export const ZONES = [
  { id: 'epipelagic', name: 'Epipelagic', sub: 'Sunlight zone', min: 0, max: 200 },
  { id: 'mesopelagic', name: 'Mesopelagic', sub: 'Twilight zone', min: 200, max: 1000 },
  { id: 'bathypelagic', name: 'Bathypelagic', sub: 'Midnight zone', min: 1000, max: 4000 },
  { id: 'abyssopelagic', name: 'Abyssopelagic', sub: 'The abyss', min: 4000, max: 6000 },
  { id: 'hadal', name: 'Hadal', sub: 'The trenches', min: 6000, max: 11000 },
];

export const SHARKS = [
  /* ─────────────────────────── the great vertical migrators ─────────────── */
  {
    scientificName: 'Isistius brasiliensis',
    common: 'Cookiecutter shark',
    aphia: 215612,
    day: [1000, 3500], night: [0, 200], maxDepth: 3700,
    dvm: 'strong', habitat: 'pelagic', size: 0.56, iucn: 'LC',
    glow: true,
    note: 'Rises up to 3 km every night to bite plugs of flesh out of tuna, whales and the occasional submarine. Its underside glows, except for a dark collar that mimics a small fish — bait for whatever comes to eat it.',
  },
  {
    scientificName: 'Megachasma pelagios',
    common: 'Megamouth shark',
    aphia: 281542,
    day: [120, 170], night: [12, 30], maxDepth: 1000,
    dvm: 'strong', habitat: 'pelagic', size: 5.5, iucn: 'LC',
    note: 'Unknown to science until 1976, when one swallowed a US Navy anchor. Tracking a single individual revealed it follows krill up at dusk and back down at dawn with near-perfect fidelity.',
  },
  {
    scientificName: 'Alopias superciliosus',
    common: 'Bigeye thresher',
    aphia: 105835,
    day: [300, 500], night: [0, 100], maxDepth: 955,
    dvm: 'strong', habitat: 'pelagic', size: 4.9, iucn: 'VU',
    note: 'Those enormous upward-looking eyes are built to spot prey silhouetted against faint light 400 m down. It hunts with its tail, stunning fish with a whip-crack of its scythe-like upper lobe.',
  },
  {
    scientificName: 'Hexanchus griseus',
    common: 'Bluntnose sixgill',
    aphia: 105833,
    day: [500, 1100], night: [30, 200], maxDepth: 2500,
    dvm: 'strong', habitat: 'deep', size: 5.5, iucn: 'NT',
    note: 'A living fossil with six gill slits instead of five, on a body plan largely unchanged for 200 million years. It spends the day in the cold dark and climbs most of a kilometre after sunset.',
  },
  {
    scientificName: 'Euprotomicrus bispinatus',
    common: 'Pygmy shark',
    aphia: 215608,
    day: [1500, 2000], night: [0, 200], maxDepth: 2000,
    dvm: 'strong', habitat: 'pelagic', size: 0.27, iucn: 'LC',
    glow: true,
    note: 'Small enough to sit in your palm, and it commutes two kilometres of open ocean twice a day. Its belly is studded with photophores that erase its shadow from below.',
  },
  {
    scientificName: 'Pseudocarcharias kamoharai',
    common: 'Crocodile shark',
    aphia: 217632,
    day: [200, 590], night: [0, 100], maxDepth: 590,
    dvm: 'strong', habitat: 'pelagic', size: 1.1, iucn: 'LC',
    note: 'Huge eyes, no eyelids, and a habit of snapping convulsively when landed — hence the name. A metre-long shark that dives half a kilometre and back every single day.',
  },
  {
    scientificName: 'Echinorhinus cookei',
    common: 'Prickly shark',
    aphia: 271656,
    day: [200, 650], night: [10, 200], maxDepth: 1100,
    dvm: 'moderate', habitat: 'deep', size: 4.0, iucn: 'DD',
    note: 'Covered in thorn-like denticles the size of shirt buttons. Spends daylight in submarine canyon heads and drifts up the walls at night.',
  },
  {
    scientificName: 'Etmopterus spinax',
    common: 'Velvet belly lanternshark',
    aphia: 105913,
    day: [300, 700], night: [70, 300], maxDepth: 2490,
    dvm: 'moderate', habitat: 'deep', size: 0.6, iucn: 'NT',
    glow: true,
    note: 'Glows from its belly to match the dim light filtering from above, so that from below it simply is not there. The spines on its back glow too — a warning, not a lure.',
  },

  /* ───────────────────────────── the ocean wanderers ─────────────────────── */
  {
    scientificName: 'Prionace glauca',
    common: 'Blue shark',
    aphia: 105801,
    day: [200, 600], night: [0, 100], maxDepth: 1082,
    dvm: 'strong', habitat: 'pelagic', size: 3.8, iucn: 'NT',
    note: 'The most wide-ranging shark alive — one crossed the Atlantic and was recaught 16,000 km later. It saw-tooths up and down the thermocline all day, hunting squid in the twilight.',
  },
  {
    scientificName: 'Rhincodon typus',
    common: 'Whale shark',
    aphia: 105847,
    day: [0, 200], night: [0, 60], maxDepth: 1928,
    dvm: 'moderate', habitat: 'pelagic', size: 18.8, iucn: 'EN',
    note: 'The largest fish on Earth, and a filter-feeder that strains plankton through pads in its throat. It punctuates surface feeding with sudden plunges to nearly 2 km, for reasons still argued over.',
  },
  {
    scientificName: 'Cetorhinus maximus',
    common: 'Basking shark',
    aphia: 105837,
    day: [50, 300], night: [0, 100], maxDepth: 1264,
    dvm: 'moderate', habitat: 'pelagic', size: 12.0, iucn: 'EN',
    note: 'Filters two million litres of seawater an hour with its mouth held open like a trawl. Long assumed to hibernate on the seabed in winter; satellite tags showed it just goes deep and keeps going.',
  },
  {
    scientificName: 'Carcharodon carcharias',
    common: 'Great white shark',
    aphia: 105838,
    day: [0, 300], night: [0, 300], maxDepth: 1200,
    dvm: 'none', habitat: 'pelagic', size: 6.0, iucn: 'VU',
    note: 'Warm-blooded, which is why it can hunt seals in cold water. In the open Pacific it abandons the coast for the "White Shark Café", where it dives to 300 m and back hundreds of times, over and over.',
  },
  {
    scientificName: 'Isurus oxyrinchus',
    common: 'Shortfin mako',
    aphia: 105839,
    day: [50, 500], night: [0, 150], maxDepth: 888,
    dvm: 'moderate', habitat: 'pelagic', size: 4.0, iucn: 'EN',
    note: 'The fastest shark in the sea — clocked in bursts over 70 km/h. Endothermic, like the great white, and capable of leaping six metres clear of the water.',
  },
  {
    scientificName: 'Carcharhinus longimanus',
    common: 'Oceanic whitetip',
    aphia: 105794,
    day: [0, 200], night: [0, 150], maxDepth: 1082,
    dvm: 'none', habitat: 'pelagic', size: 4.0, iucn: 'CR',
    note: 'Once among the most abundant large animals on the planet; now critically endangered. Unhurried, endlessly curious, and the shark most associated with open-ocean shipwrecks.',
  },
  {
    scientificName: 'Carcharhinus falciformis',
    common: 'Silky shark',
    aphia: 105789,
    day: [50, 500], night: [0, 100], maxDepth: 500,
    dvm: 'moderate', habitat: 'pelagic', size: 3.5, iucn: 'VU',
    note: 'Named for the fine texture of its skin. It follows tuna schools and drifting objects, which is exactly why it is the most-caught bycatch shark on Earth.',
  },
  {
    scientificName: 'Lamna nasus',
    common: 'Porbeagle',
    aphia: 105841,
    day: [100, 700], night: [0, 200], maxDepth: 1360,
    dvm: 'moderate', habitat: 'pelagic', size: 3.7, iucn: 'VU',
    note: 'A cold-water torpedo that stays warmer than the sea around it. Among the few sharks credibly observed playing — rolling and chasing kelp with no apparent purpose.',
  },
  {
    scientificName: 'Alopias vulpinus',
    common: 'Common thresher',
    aphia: 105836,
    day: [50, 400], night: [0, 100], maxDepth: 650,
    dvm: 'moderate', habitat: 'pelagic', size: 6.1, iucn: 'VU',
    note: 'Half its body length is tail. It herds baitfish into a ball, then cracks that tail overhead at 80 km/h to stun them — one of the only fish known to use a limb as a weapon.',
  },
  {
    scientificName: 'Sphyrna lewini',
    common: 'Scalloped hammerhead',
    aphia: 105816,
    day: [0, 300], night: [200, 900], maxDepth: 1000,
    dvm: 'reverse', habitat: 'coastal', size: 4.3, iucn: 'CR',
    note: 'Schools in their hundreds around seamounts by day, then scatters into the deep to hunt at night — the opposite of the usual pattern. It holds its breath on those dives, shutting its gills to stay warm.',
  },

  /* ────────────────────────────── the deep and the strange ───────────────── */
  {
    scientificName: 'Mitsukurina owstoni',
    common: 'Goblin shark',
    aphia: 105842,
    day: [270, 960], night: [270, 960], maxDepth: 1300,
    dvm: 'none', habitat: 'deep', size: 3.8, iucn: 'LC',
    note: 'Its jaws are slung on ligaments and fire forward out of its face to catch prey, then retract. Pink not by pigment but because its skin is translucent and the blood shows through.',
  },
  {
    scientificName: 'Chlamydoselachus anguineus',
    common: 'Frilled shark',
    aphia: 105831,
    day: [500, 1000], night: [50, 500], maxDepth: 1570,
    dvm: 'moderate', habitat: 'deep', size: 2.0, iucn: 'LC',
    note: 'An eel-bodied shark with 300 backward-curving teeth in 25 rows, arranged to make escape geometrically impossible. Thought to have one of the longest pregnancies of any vertebrate — perhaps three and a half years.',
  },
  {
    scientificName: 'Somniosus microcephalus',
    common: 'Greenland shark',
    aphia: 105919,
    day: [200, 1200], night: [0, 600], maxDepth: 2647,
    dvm: 'moderate', habitat: 'deep', size: 7.3, iucn: 'VU',
    note: 'The longest-lived vertebrate known: radiocarbon dating of eye lenses puts the oldest near 400 years. It cruises at under 1 km/h, blinded by parasites that hang from its corneas, yet somehow eats seals.',
  },
  {
    scientificName: 'Centroscymnus coelolepis',
    common: 'Portuguese dogfish',
    aphia: 105907,
    day: [400, 2700], night: [400, 2700], maxDepth: 3700,
    dvm: 'none', habitat: 'deep', size: 1.2, iucn: 'NT',
    glow: true,
    note: 'The deepest-living shark reliably recorded, at 3.7 km. Down there the pressure is 370 atmospheres and it simply does not care.',
  },
  {
    scientificName: 'Dalatias licha',
    common: 'Kitefin shark',
    aphia: 105910,
    day: [300, 1000], night: [200, 600], maxDepth: 1800,
    dvm: 'moderate', habitat: 'deep', size: 1.8, iucn: 'VU',
    glow: true,
    note: 'The largest known luminous vertebrate. In 2020 it was filmed glowing a soft blue-green across its entire underside — a metre and a half of living light.',
  },
  {
    scientificName: 'Somniosus pacificus',
    common: 'Pacific sleeper shark',
    aphia: 271654,
    day: [300, 1500], night: [50, 800], maxDepth: 2205,
    dvm: 'moderate', habitat: 'deep', size: 4.4, iucn: 'DD',
    note: 'Slow, cold and enormous. It has been filmed apparently taking bites from live giant squid, which raises the question of how something this sluggish catches something that fast.',
  },
  {
    scientificName: 'Etmopterus perryi',
    common: 'Dwarf lanternshark',
    aphia: 271637,
    day: [283, 439], night: [283, 439], maxDepth: 439,
    dvm: 'none', habitat: 'deep', size: 0.2, iucn: 'DD',
    glow: true,
    note: 'The smallest shark in the world — a full-grown adult fits in a human hand, and glows.',
  },
  {
    scientificName: 'Hexanchus nakamurai',
    common: 'Bigeye sixgill',
    aphia: 105834,
    day: [90, 620], night: [90, 400], maxDepth: 621,
    dvm: 'moderate', habitat: 'deep', size: 1.8, iucn: 'DD',
    note: 'A smaller, rarer cousin of the bluntnose sixgill, with eyes of a startling fluorescent green in life.',
  },
  {
    scientificName: 'Centrophorus granulosus',
    common: 'Gulper shark',
    aphia: 105899,
    day: [200, 1200], night: [200, 1000], maxDepth: 1500,
    dvm: 'moderate', habitat: 'deep', size: 1.6, iucn: 'EN',
    note: 'Hunted almost to nothing for the squalene in its enormous oily liver. It produces perhaps one or two pups every two years, which is no way to survive a fishery.',
  },
  {
    scientificName: 'Scyliorhinus retifer',
    common: 'Chain catshark',
    aphia: 158516,
    day: [70, 550], night: [70, 550], maxDepth: 750,
    dvm: 'none', habitat: 'benthic', size: 0.6, iucn: 'LC',
    glow: true,
    note: 'Biofluorescent: it absorbs the blue light of the deep and re-emits it as green, in a chain-link pattern that only other catsharks — whose eyes are tuned to exactly that green — can see.',
  },

  /* ────────────────────────────────── the reef and the shallows ─────────── */
  {
    scientificName: 'Triaenodon obesus',
    common: 'Whitetip reef shark',
    aphia: 214557,
    day: [8, 40], night: [1, 40], maxDepth: 330,
    dvm: 'nocturnal', habitat: 'reef', size: 2.1, iucn: 'VU',
    note: 'Spends the day stacked like firewood in reef caves, doing nothing at all. After dark it hunts in packs, forcing its whole body into coral crevices to corner sleeping fish.',
  },
  {
    scientificName: 'Carcharhinus melanopterus',
    common: 'Blacktip reef shark',
    aphia: 105795,
    day: [0, 20], night: [0, 20], maxDepth: 75,
    dvm: 'none', habitat: 'reef', size: 1.8, iucn: 'VU',
    note: 'The shark of the shallow lagoon, often in water too thin to cover its dorsal fin. Fiercely site-faithful — many spend their whole lives on a single reef.',
  },
  {
    scientificName: 'Carcharhinus amblyrhynchos',
    common: 'Grey reef shark',
    aphia: 217337,
    day: [0, 60], night: [0, 140], maxDepth: 280,
    dvm: 'moderate', habitat: 'reef', size: 2.6, iucn: 'EN',
    note: 'The first shark ever described performing a threat display: back arched, pectorals down, swimming in exaggerated figure-eights. It is telling you, quite clearly, to leave.',
  },
  {
    scientificName: 'Carcharhinus perezii',
    common: 'Caribbean reef shark',
    aphia: 271324,
    day: [0, 70], night: [0, 70], maxDepth: 378,
    dvm: 'none', habitat: 'reef', size: 3.0, iucn: 'EN',
    note: 'The most common large shark on Caribbean reefs, and one of the few that has been observed lying motionless on the seabed — "sleeping", though it has no eyelids to close.',
  },
  {
    scientificName: 'Ginglymostoma cirratum',
    common: 'Nurse shark',
    aphia: 105846,
    day: [1, 25], night: [1, 40], maxDepth: 130,
    dvm: 'nocturnal', habitat: 'reef', size: 3.0, iucn: 'VU',
    note: 'Piles up in heaps under ledges by day. Its mouth works as a bellows, generating suction strong enough to pull a conch clean out of its shell.',
  },
  {
    scientificName: 'Stegostoma tigrinum',
    common: 'Zebra shark',
    aphia: 313100,
    day: [5, 30], night: [5, 62], maxDepth: 90,
    dvm: 'nocturnal', habitat: 'reef', size: 2.5, iucn: 'EN',
    note: 'Born striped like a zebra, grows up spotted like a leopard, which is why half the world calls it the leopard shark. Females can reproduce without males when none are around.',
  },
  {
    scientificName: 'Galeocerdo cuvier',
    common: 'Tiger shark',
    aphia: 105799,
    day: [0, 250], night: [0, 100], maxDepth: 1136,
    dvm: 'moderate', habitat: 'coastal', size: 5.5, iucn: 'NT',
    note: 'Eats sea turtles, birds, licence plates and, on one occasion, a chicken coop. It oscillates constantly through the water column, which is thought to be a search strategy rather than a hunt.',
  },
  {
    scientificName: 'Carcharhinus leucas',
    common: 'Bull shark',
    aphia: 105792,
    day: [0, 30], night: [0, 30], maxDepth: 152,
    dvm: 'none', habitat: 'coastal', size: 3.5, iucn: 'VU',
    note: 'Regulates its own salt balance well enough to swim up rivers — recorded 4,000 km up the Amazon and in the Mississippi at Illinois. Fresh water is not the refuge people assume it is.',
  },
  {
    scientificName: 'Sphyrna mokarran',
    common: 'Great hammerhead',
    aphia: 105817,
    day: [1, 100], night: [1, 300], maxDepth: 300,
    dvm: 'moderate', habitat: 'coastal', size: 6.1, iucn: 'CR',
    note: 'Sweeps that hammer over the sand like a metal detector, reading the electrical fields of stingrays buried beneath it. Then it pins them with the hammer and eats them.',
  },
  {
    scientificName: 'Sphyrna tiburo',
    common: 'Bonnethead',
    aphia: 158517,
    day: [0, 25], night: [0, 25], maxDepth: 80,
    dvm: 'none', habitat: 'coastal', size: 1.5, iucn: 'EN',
    note: 'The only shark known to be omnivorous. Seagrass makes up more than half its diet, and it digests it — genuinely, with the enzymes to prove it.',
  },
  {
    scientificName: 'Carcharias taurus',
    common: 'Sand tiger shark',
    aphia: 105843,
    day: [1, 40], night: [1, 190], maxDepth: 232,
    dvm: 'nocturnal', habitat: 'coastal', size: 3.2, iucn: 'CR',
    note: 'Gulps air at the surface and holds it in its stomach to hover motionless — the only shark that does. Its embryos eat each other in the womb, so only the two strongest are ever born.',
  },
  {
    scientificName: 'Negaprion brevirostris',
    common: 'Lemon shark',
    aphia: 105800,
    day: [0, 30], night: [0, 50], maxDepth: 92,
    dvm: 'nocturnal', habitat: 'coastal', size: 3.4, iucn: 'VU',
    note: 'Social, and demonstrably a learner — juveniles pick up tasks faster by watching other lemon sharks do them first. They return to the mangrove they were born in to give birth.',
  },
  {
    scientificName: 'Squalus acanthias',
    common: 'Spiny dogfish',
    aphia: 105923,
    day: [100, 400], night: [0, 200], maxDepth: 1460,
    dvm: 'moderate', habitat: 'benthic', size: 1.2, iucn: 'VU',
    note: 'Hunts in packs thousands strong and lives past 70. Once the most abundant shark on Earth; the packs are what made it so easy to fish out.',
  },
  {
    scientificName: 'Galeorhinus galeus',
    common: 'Tope shark',
    aphia: 105820,
    day: [200, 550], night: [0, 200], maxDepth: 800,
    dvm: 'moderate', habitat: 'coastal', size: 1.9, iucn: 'CR',
    note: 'Migrates thousands of kilometres and rides the tide like a conveyor belt — holding station on the seabed against an adverse current, then lifting off when it turns favourable.',
  },
  {
    scientificName: 'Notorynchus cepedianus',
    common: 'Broadnose sevengill',
    aphia: 217628,
    day: [0, 50], night: [0, 130], maxDepth: 570,
    dvm: 'moderate', habitat: 'coastal', size: 3.0, iucn: 'VU',
    note: 'One of the very few sharks that hunts cooperatively — sevengills have been filmed circling a fur seal as a group and closing together.',
  },
  {
    scientificName: 'Heterodontus portusjacksoni',
    common: 'Port Jackson shark',
    aphia: 276699,
    day: [1, 30], night: [1, 80], maxDepth: 275,
    dvm: 'nocturnal', habitat: 'benthic', size: 1.65, iucn: 'LC',
    note: 'Lays a spiral-flanged egg case and screws it into a rock crevice, where it cannot be pulled out. Comes back to the same cave, year after year.',
  },
  {
    scientificName: 'Squatina squatina',
    common: 'Angelshark',
    aphia: 105928,
    day: [5, 100], night: [5, 150], maxDepth: 150,
    dvm: 'nocturnal', habitat: 'benthic', size: 2.4, iucn: 'CR',
    note: 'A shark pretending to be a ray. It buries itself in sand and waits, sometimes for days, then strikes upward in a tenth of a second. Once common across Europe; now gone from most of it.',
  },
  {
    scientificName: 'Scyliorhinus canicula',
    common: 'Small-spotted catshark',
    aphia: 105814,
    day: [10, 100], night: [10, 400], maxDepth: 780,
    dvm: 'nocturnal', habitat: 'benthic', size: 1.0, iucn: 'LC',
    note: 'Rests in groups by day, hunts alone by night, and forms preferences about which other catsharks it rests next to. Its egg cases wash up on beaches as "mermaid\'s purses".',
  },
  {
    scientificName: 'Hemiscyllium ocellatum',
    common: 'Epaulette shark',
    aphia: 281037,
    day: [0, 3], night: [0, 3], maxDepth: 50,
    dvm: 'nocturnal', habitat: 'reef', size: 1.07, iucn: 'LC',
    note: 'Walks. On its fins. Across dry reef flats between tide pools — and survives an hour without oxygen by shutting down parts of its own brain.',
  },
  {
    scientificName: 'Triakis semifasciata',
    common: 'Leopard shark',
    aphia: 279060,
    day: [0, 20], night: [0, 30], maxDepth: 100,
    dvm: 'none', habitat: 'coastal', size: 1.5, iucn: 'LC',
    note: 'Follows the tide into the shallows in dense schools, feeding on innkeeper worms by tearing them from their burrows with suction.',
  },
];

export const DVM_LABEL = {
  // curated
  strong: 'Strong daily migration',
  moderate: 'Moderate daily shift',
  reverse: 'Reverse migration — deeper at night',
  none: 'No daily depth cycle',
  nocturnal: 'Night-active',
  // inferred from habitat + depth (see scripts/build_species.py)
  diurnal: 'Day-active',
  sessile: 'Fixed to the seabed',
  airbreather: 'Surfaces to breathe',
  unknown: 'Daily rhythm unknown',
};

/** Does this animal actually change depth between day and night? */
export function migrates(species) {
  return ['strong', 'moderate', 'reverse'].includes(species.dvm);
}

export const IUCN = {
  LC: { label: 'Least concern', color: '#4caf82' },
  NT: { label: 'Near threatened', color: '#c7c14a' },
  VU: { label: 'Vulnerable', color: '#e0a049' },
  EN: { label: 'Endangered', color: '#e0673f' },
  CR: { label: 'Critically endangered', color: '#e04b4b' },
  DD: { label: 'Data deficient', color: '#7a8899' },
};

/** Zone containing a depth. */
export function zoneAt(depth) {
  return ZONES.find((z) => depth >= z.min && depth < z.max) ?? ZONES[ZONES.length - 1];
}
