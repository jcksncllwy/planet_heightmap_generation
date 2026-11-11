// Every tunable of the tectonic history engine, in physical units (km, Myr, cm/yr).
// A TectonicWorld copies this into `world.config`; engine code reads ONLY `world.config`, so a scene,
// the lab's sliders or a tuning harness can override values per world without touching the defaults.
// Values marked [WBP] come from Worldbuilding Pasta's Part Va rules of thumb.

import { GEOLOGY } from '../geology/geology-config.js';

export const CM_PER_YR_TO_KM_PER_MYR = 10;          // 1 cm/yr = 10 km/Myr
export const CM_PER_YR_TO_RAD_PER_MYR = 10 / 6371; // … = 10/6371 rad/Myr on an Earth-radius sphere

export const TECTONICS = {
    // ── Simulation grid & clock ──
    simCells: 40000,            // ≈125 km between cell centres; independent of render detail
    maxStepMyr: 4,
    stepGridMyr: 2,             // no step crosses a multiple of this: histories do not depend on how often they are recorded
                                // (snapshotEveryMyr should be a multiple of it)
    maxCellsPerStep: 1.5,       // adaptive dt: the two fastest plates together cover at most this many cells (Phase 12:
                                // 1.0 → 1.5 for a third fewer steps — the most crust growth in step/resolve.js allows: it
                                // looks ~2 cells around a gap; the whole-planet scenes take 2.25 — scenarios/terrain-scenes.js
                                // WHOLE_PLANET_PACE: a gap of 2.25 cells is ~1.1 for each flank to grow)
    slowRulesEveryMyr: 0,       // the slow rules — arcs, margin islands, arc collapse, arc maturing, heights —
                                // every this many Myr, with the time since (0: every step; tidying stays every step — a fragment
                                // left a few Myr is a scrap — and the rivers keep their own clock, heights.riverEveryMyr). Their work
                                // changes little from step to step; run less often, the world view rebuilt after them is too
    snapshotEveryMyr: 10,
    crustLedger: false,         // book every stage's change to the continental and arc crust (step/crust-ledger.js; the checks turn it on)
    crustLedgerVolume: false,   // …and to its volume (area × thickness): slow, a diagnostic for tools/trace-crust.mjs

    // ── Initial supercontinent [WBP] (init/) ──
    cratonCount: 14,            // [WBP: 8–12] more, smaller cores than that: a supercontinent reads as an assembly of many
                                // old pieces, and there are more seams for a later rift to choose between (developer)
    continentalFraction: 0.41,  // the start world's continental CRUST (incl. shelves and margins) as a share of the surface — not
                                // its land: how much stands above the sea is the water's (terrain/land-mask.js, the water
                                // inventory, terrain-config waterInventory). Earth: ~41 % crust under ~29 % land (Cogley 1984).
                                // ONE source: the Evolution page's Crust slider, the lab and the tools (tools/lib/moment-frame.mjs
                                // DEFAULT_CONT) all start here. Was 0.29 (Earth's LAND share, from before the inventory, when the
                                // crust stood almost all above the reckoned sea); under the poured sea a 29 % crust spreads Earth's
                                // 1.332e9 km³ over ~360 Mkm² of deep floor with no margin to flood, so the sea stood 0.60–0.85 km
                                // low on every seed and every Earth land-height target measured that mismatch (landheight report,
                                // 2026-11-10; Jackson's ruling Q1, 2026-11-10). HONOURED FIRST: if the spacing rules need more
                                // room, cratons get smaller, not the crust bigger
    cratonShare: 0.24,          // REQUESTED fraction of continental crust that is craton (an upper bound, see above)
    cratonMinAreaScale: 0.3,    // cratons shrink down to this share of their requested area before anything else gives
    cratonSizeRatio: 3.4,       // largest craton diameter ÷ smallest — guarantees a mix of big and small cores
    cratonSizeSkew: 1.6,        // > 1 bends the size ladder: most cores small, a few big (1 = evenly graded)
    cratonMaxDiameterKm: 4000,  // [WBP] cratons are ~1000–4000 km across
    cratonMinGapKm: 500,        // HARD minimum of accreted crust between any two cratons (room for a rift)
    cratonMinCoastKm: 450,      // HARD minimum of accreted crust between any craton and the sea
    cratonEdgeNoiseKm: 150,     // how far a craton's outline may wander from its ideal (lobed) shape
    cratonLobes: 0.55,          // strength of the low-order harmonics that make a craton non-circular
    gapVariety: 1.0,            // extra spacing (× min gap, random per craton) → belts and terranes of varied width
    clusterLooseness: 0.15,     // randomness in where the next craton settles (rad-ish): 0 packs them like a honeycomb
    clusterElongation: 0.5,     // 0 = round supercontinents only, → 1 = may be strongly stretched
    startMaxLatitudeDeg: 12,    // a ~150°-wide supercontinent centred higher than this drapes over a pole
    spanAllowanceDeg: 19,       // [WBP: not much more than half-way round] extent allowed beyond a perfectly round landmass
    coastReliefKm: 1200,        // how far bays and peninsulas push the coast in and out (continent-scale)
    coastUnionSoftnessKm: 450,  // rounds the notches between neighbouring cratons out of the coastline
    bridgeHalfWidthKm: 260,     // half-width of the corridor of accreted crust guaranteed between neighbouring cratons (spanning tree)
    terraneBorderWanderKm: 380, // how far terrane borders stray from the geometric mid-line between cratons
    sutureHalfWidthKm: 80,      // half-width of the weak belt along a terrane border — a LINE, not a province: weak
                                // ground steers a later rift, and a wide one lets rifts shave slivers off a coast (developer)
    apronKm: 250,               // captured old ocean between the coast and the rim trench
    apronSmoothKm: 1400,        // bays narrower than ~2× this lie inside the plate: trench lines are smooth arcs over 1000s of km
    rimTrenchCoverage: 0.85,    // share of the rim that starts as an active trench (rest = passive margin)
    initialOceanAgeMyr: 150,    // pre-history ocean floor: uniformly old, soon overwritten
    initialLandAgeMyr: 2000,    // continental crust is ancient at the start of recorded history
    startSutureBeltKm: 350,     // the start supercontinent's sutures carry old ranges (init/start-world.js): this wide…
    startSutureWorkKm: 600,     // …built by this much convergence (0: none)…
    startSutureAgeMyr: 300,     // …this long before the history starts…
    startSutureKeep: 0.45,      // …and worn down to this share of a fresh range's relief…
    startSutureNoiseKm: 1600,   // …along about half the suture network: long stretches this size come and go

    // ── Boundaries & crust bookkeeping (step/boundaries.js, step/resolve.js) ──
    boundaryActiveCmYr: 0.3,    // relative motion below this counts as a locked / welded contact
    obliqueLimit: 0.35,         // |normal| ÷ |shear| below this → the contact is a transform (≈ 70° oblique)
    closingCmYr: 0.2,           // a plate edge advancing faster than this is "closing": no new crust forms there
    orogenyQuietMyr: 40,        // an orogeny record that was quiet this long starts over as a new event

    // ── Plate driving forces (step/forces.js, step/torque-balance.js) ──
    // Boundary forces are per 100 km of boundary, drag is per 10⁴ km² of plate; `mobility` converts the
    // balance into rad/Myr and is the one constant that calibrates speeds to WBP's table.
    forceUnitNPerM: 6e12,       // the force unit in N/m: what a full slab pull (slabPull = 1) passes into its plate per metre of trench.
                                // Not the slab's gross negative buoyancy, up to ~3 × 10¹³ (England & Wortel 1980; this unit until 2026-11-02):
                                // of that, ~20 % reaches the plate (van Summeren et al. 2012, abstract: or at least half, with a weak layer
                                // round the slab); 8–12 % in lab models (Schellart 2004, abstract); 1–4 × 10¹² N/m available (Hopper & Buck
                                // 1993, search snippet). With it the drag lands in Bird, Liu & Rucker 2008's ≤ ~1 MPa under slabless plates
                                // (ocean ~0.3 MPa, continent ~1.6 at 10 cm/yr) — at 3 × 10¹³ it was 1.6 and 8. The balance is linear in the
                                // forces, so the unit changes no plate speed (tools/pstress-history.mjs --probe: the rotations agree to
                                // ~10⁻¹³ with every force and resistance × 0.2); it sets what a stress is against a strength in N/m
                                // (founderStrength; field/plate-stress-field.js). Lane emerge's force-scale study, report 2026-11-01
    slabPull: 1.0,              // on the subducting plate, toward the trench (× age factor × slab maturity)
    slabResistance: 30,         // viscous resistance to a slab sinking through the mantle, per 100 km of trench per
                                // rad/Myr of convergence: what actually limits a subducting plate's speed (≈ slabPull ÷ this)
    slabPullAgeRefMyr: 80,      // age factor = √(age ÷ this), saturating at 1: old crust is colder, thicker, denser
    slabMatureKm: 600,          // a trench pulls in proportion to the slab hanging from it: full strength only once
                                // this much crust has gone down (≈ the depth of the upper mantle)
    slabSuction: 0.25,          // on the overriding plate, toward its own trench — what moves an active-margin continent
    ridgePush: 0.25,            // on both plates at a young ridge, away from it [WBP: secondary]. 0.25 × forceUnitNPerM = 1.5 × 10¹² N/m,
                                // toward the 3–5 × 10¹² of Hopper & Buck 1993 and ~3.3 × 10¹² at 80 Myr by Turcotte & Schubert's
                                // formula (recalled; lane emerge). Was 0.05 (3 × 10¹¹ N/m on the 6 × 10¹² unit, ~10× low). Raised with
                                // founderStrength as one change (Jackson, 2026-11-02): RMS plate speed +9 %, founders −11 % on 3 seeds
                                // (lane pstress, s0.jsonl 'both')
    ridgeMaxAgeMyr: 40,         // crust younger than this on both sides of a contact = an active ridge
    collisionResistance: 100,   // viscous coupling per 10⁴ km² of land-on-land overlap: colliding plates lock together —
                                // across the front, against their closing (Phase 11; developer: collisions "more fluid, more
                                // rotating and kinematic")… — but not dead: the pair keeps converging a little where it
                                // touches (India into Asia, ~5 cm/yr), taken up by shortening and underthrusting, which keeps
                                // the collided part pressed while the rest closes (Phase 12, 300 → 100: held rigid, the plate
                                // see-sawed about the middle of the contact, opening one end as it closed the other)
    collisionLockGpe: false,    // (lane belts, opt-in) the lock resists with a FORCE, the buoyancy of the crust the collision has thickened (~5.7 × 10¹² N/m
                                // at Tibet's; Copley et al. 2010), not collisionResistance's viscosity per km² of overlap — under which the
                                // closing fell as the overlap grew, India stalling at ~0.5 cm/yr 30 Myr after contact (Earth ~4) and
                                // converging 1110–1350 km (Earth 2400–3200): step/torque-balance.js collisionGpeNPerM; its Δh counts the two
                                // crusts stacked in the overlap, so it holds from first contact (forces.js frontThickening). Off by default
                                // (lane belts5, 2026-11-09): on, Phase 4's forces-only slowing on contact fails (a force capped at the
                                // plateau's cannot stop a plate whose drive goes on: India's 20 → 6 cm/yr was its drive collapsing), and the
                                // whole model's biggest collisions close 1461–2374 km at 1–2 cm/yr (Earth ~5 for ~50 Myr) — the missing
                                // process is the drive after contact, not this lock (README, "The collision lock is a bounded force").
                                // collisionResistance applies only with this off. The shares below apply
    collisionSlabPull: false,   // (lane upper, opt-in) the slab hanging under a collision front keeps pulling the lower plate in, net of the buoyancy
                                // of its continental crust gone down after it (Cloos 1993) above the eclogite depth, until the slab breaks off as it warms through (step/forces.js hangingSlabPull).
                                // Off: it brings no whole-model collision into Earth's range (README, lane belts5)
    collisionSlabGrossNPerM: 3e13, // …the slab's gross negative buoyancy, N/m, that the crust's buoyancy is set against (England & Wortel 1980: up to ~3 × 10¹³;
                                // the force unit is the ~20 % of it the plate feels — forceUnitNPerM)
    slabCoreTempShare: 0.6,     // …and breaks off once the mantle has warmed through the core that carries its weight: the lithosphere colder than this
                                // share of the mantle's temperature, ~800 °C of 1350 (olivine's strength falls away at ~700–800 °C at a
                                // plate's strain rates: Goetze & Evans 1979, the isotherm as Kirby 1987 reads it; the 1350 °C mantle of
                                // Parsons & Sclater 1977). A slab of age A breaks ~0.115 A after contact (step/forces.js hangingSlabPull):
                                // 9 Myr for an 80-Myr slab, 16 for India's scene's ~140 — the warming alone; van Hunen & Allen 2011 find
                                // 20–25 Myr for old slabs (~10 for young), the neck's own runaway included, which is not drawn. Not fitted
    collisionEclogiteKm: 60,    // …and the crust dragged down after it is buoyant only above this depth: below, its mafic lower half is eclogite
                                // (3.1–3.6 g/cm³: Austrheim 1991, Terra Nova; Holsnøy's lower-crust eclogites formed at ≥ 1.46 GPa, > 55 km),
                                // ~6 % denser than the mantle (Hacker, Abers & Peacock 2003); India's under southern Tibet (Hetényi et al. 2007)
    collisionSlabDipDeg: 30,    // …down a slab dipping this steeply: so at most collisionEclogiteKm ⁄ sin(dip) of crust, 120 km, offsets the slab
                                // (subduction zones' plate-boundary dip over 0–125 km, 32 ± 9°: Lallemand, Heuret & Boutelier 2005, G³)
    collisionShearShare: 0.5,   // …along the front half as hard (oblique plates slide some; much looser and they slide past
                                // each other instead of colliding)…
    collisionSeparateShare: 0.05, // …and against parting this share: a contact is a pivot, not a lock — the pull of the ocean
                                // still going down beside it turns the plate about it, closing the rest like a zipper
    dragOcean: 1.0,             // basal drag under ocean crust
    dragContinent: 5.0,         // [WBP] continents have deep lithospheric roots
    dragCraton: 8.0,
    mobility: 3.0,              // overall speed scale
    relaxMyr: 6,                // plates approach their force-balance velocity over this time

    // ── Speed limits, cm/yr [WBP] — a backstop only: check-phase4 asserts the force balance never reaches them ──
    maxSpeedOceanic: 25,
    maxSpeedContinental: 10,
    continentalPlateShare: 0.15, // a plate with more than this share of continental keel (continent and craton, not island arc: torque-balance.js keeled) is held to the continental limit
    continentalSoftCmYr: 7,     // …and its speed saturates smoothly: v → v ÷ √(1 + (v ÷ this)²) (0: off) — a third slower near the limit
    oceanicSoftCmYr: 12,        // an oceanic plate's likewise (20 cm/yr → 10; Earth's fastest, the Pacific, ~10)

    // ── Collision & orogeny (Phase 5a). Records only: heights come later. ──
    // A belt reaches inland by an amount that grows with the convergence it has absorbed (rate × time) and
    // with the current rate: base + perKm × work, capped; × a speed factor (see beltSpeed…). Caps are [WBP]'s
    // belt widths: Andean a few hundred km, a continental plateau 1000+ km, its foreland narrow.
    belts: {
        andean:    { baseKm: 120, perKm: 1.0, maxKm: 400 },     // work = andeanWorkShare × slab gone down: a young margin starts narrow
                                                                // (700 → 400 after Phase 13: the Andes are mostly 200–500 km wide, and long-lived
                                                                // margins at the cap made 11–16 % of all land an active Andean belt)
        himalayan: { baseKm: 220, perKm: 0.6, maxKm: 1000 },    // plateau side of a continent–continent collision (Tibet ≈ 1000 km after ~2500 km;
                                                                // 1300 → 1000 after Phase 13: a reassembly's many plateaus covered a fifth of the land)
        foreland:  { baseKm: 120, perKm: 0.2, maxKm: 350 },     // the lower plate's side: fold-and-thrust belt, then a basin
        ural:      { baseKm: 150, perKm: 0.3, maxKm: 400 },     // a short front: simple collision or terrane accretion, both sides
        laramide:  { baseKm: 200, perKm: 0.6, maxKm: 1800 },    // over a FLAT slab: work = slab gone down FLAT, so the belt migrates inland
                                                                // as the flat slab lengthens — the Laramide Rockies stand 1000–1500 km from
                                                                // the old trench after ~20 Myr, the Andes a few hundred
        transpression: { baseKm: 40, perKm: 0.3, maxKm: 150 },  // along a transform pressed together: a narrow ridge (work = the front's own record)
    },
    beltSpeedRefCmYr: 5,        // at this convergence rate the speed factor is 1
    beltSpeedExponent: 0.5,     // factor = (rate ÷ ref)^exponent, clamped below — fast convergence carries deformation further inland (flat slabs)
    beltSpeedFactorMin: 0.6,
    beltSpeedFactorMax: 1.6,
    arcAdditionKm3PerKmMyr: 60, // (lane crust, 1c(ii); 0 = off, the old unbounded thickening) an Andean or Laramide belt adds at most this much crust per km of its front per
                                // Myr; its thickening beyond is the margin's own shortened crust, which this raster cannot take away. ~60:
                                // arc addition at ocean-margin subduction zones 2.5 AU (1.5 intra-oceanic + 1.0 continental margins) over
                                // ~41,700 km — their recycling 2.5 AU ÷ 60 km³ Myr⁻¹ km⁻¹ (Scholl & von Huene 2009; the length is my arithmetic)
    orogenicCollapse: true,     // (lane beltthick) a quiet belt on its own coast spreads its root over the sea beside it as continent: crust-flow's
                                // channel carried across the coast, area = volume ÷ an ordinary continent's crust (Dewey 1988; step/orogenic-collapse.js). No parameter of its own
    andeanShorteningShare: 0.25, // (lane beltthick; Jackson's ruling 4 as amended 2026-11-11; 0 = off) an upper plate pressed toward its trench
                                // shortens behind its arc at this share of that velocity, Vd = share × Vup (Heuret & Lallemand 2005, PEPI 149:
                                // Vd + Vt = Vup, the rest the trench's own retreat), its edge's area folded into its belt as root
                                // (step/andean-shortening.js). Derived from the Central Andes: ~300–350 km of shortening since ~45 Ma
                                // (Oncken et al. 2006; Kley & Monaldi 1998), ~7–8 mm/yr, against South America's westward drift in the
                                // hotspot frame, risen from ~1–2 to ~2–3 cm/yr since ~30–25 Ma (Silver, Russo & Lithgow-Bertelloni 1998,
                                // Science 279; the 2–3 cm/yr as reviews of it quote, e.g. Oncken et al. 2006; O'Driscoll et al. 2012, Tectonics 31,
                                // date the speed-up ~25–24 Ma): 7–8 ÷ 20–30 = 0.25–0.4. The low end: the Altiplano's shortening also took
                                // the slab's retreat (~2 cm/yr since ~50 Ma, Schepers et al. 2017, Nat. Commun. 8), and a higher share only takes more area
    crustPaidRelief: true,      // (lane crustmass, S1; on since S5) a belt's relief is the isostatic face of a root that was paid for, not rock of
                                // its own: belts no longer raise the broad uplift (measure.js counts it as crust, uplift ÷ column slope — ~5 Gkm³
                                // a 1200 Myr cycle made from nothing, about the planet's whole continental crust: crustmass/report.md §0, F4–F6),
                                // only their root stands them up. The roots a rigid upper plate cannot pay for in area are bounded by arc
                                // magmatism alone (arcAdditionKm3PerKmMyr, one cap over the margin's continent and arc alike; booked as
                                // arcRootAddedKm3, a mantle source — Jackson's ruling 4: Andean thickening counted as arc magmatism only);
                                // a transpression belt's or a sutured terrane's thickens nothing (no shortened area pays for it); an arc welded
                                // on as continent keeps its rock (a relabel: its root is set so the column holds what the arc held, F2)
    prismAccretion: true,       // (lane crustmass, S2; on since S5) the rock a trench scrapes off — what its subduction channel does not take of the
                                // rise, the sea fill and the fans' rock (accretionSedimentKm × sedimentSubductionShare) — is the overriding plate's
                                // prism, laid on its fore-arc as continental crust (Jackson's ruling 3; Cawood et al. 2009; step/prism-accretion.js),
                                // not a book of rock gone (~0.4–1 Gkm³ a cycle, crustmass/report.md F15); its fore-arc islands rise out of it
    crustFlow: true,            // (lane crustmass, S3; on since S5) thick crust spreads by lower-crustal channel flow, ∂h/∂t = ∇·(K∇s), K = ρc g h_ch³ ÷ 12η
                                // (Bird 1991; Clark & Royden 2000; step/crust-flow.js), in place of heights.js's old collapse (a 5 km threshold and a
                                // hand-set rate, removed at S5): no threshold, the channel h_ch from a geotherm, so thick and hot crust flows and a cold shield blocks it
    crustChannelC: 700,         // °C: the channel is the crust hotter than this — where melt-weakening brings it to a channel's viscosity (700–750 °C,
                                // Beaumont et al. 2004, JGR 109 B06406: crustal channels form only with that drop, not with wet-quartz creep alone)
    crustChannelViscosity: null, // Pa s; null: Clark & Royden 2000's fitted flux (1e18 for an assumed 15 km channel, Tibet's gentle margins) carried to the
                                // geotherm's own channel under crustChannelRefKm of crust — η = 1e18 × (h_ch ÷ 15 km)³, ~2.6e19 (Hilley et al. 2005 ~1e19)
    crustChannelRefKm: 70,      // km: Tibet's crust, where that fit was made (~65–70 km: Owens & Zandt 1997 — recalled)
    crustHeatDepthKm: 10,       // km: the crust's heat production decays with depth over this (Lachenbruch 1970; Turcotte & Schubert §4-8: ~10 km)
    crustHeatConductivity: 2.5, // W/m/K: the crust's (Turcotte & Schubert §4-8)
    crustSurfaceC: 10,          // °C at the ground (the geotherm's top)
    crustChannelLag: true,      // thickened crust heats over its diffusion time before its channel flows (England & Thompson 1984; step/crust-flow.js);
                                // false: the steady geotherm at once (an active belt flows as soon as it thickens)
    crustThermalDiffusivity: 1e-6, // m²/s: rock's (Turcotte & Schubert §4-15) — τ = h² ÷ π²κ: ~16 Myr for 70 km of crust, ~8 for 50
    subductionErosionKm3PerKmMyr: 0,   // OFF by default (gjallar's ruling, 2026-11-05; built and measured at 36). With beltStrainRate off
                                // it holds the Andes down: check 8a's main range stands only 0.21 km over the coast (needs 0.3) and the
                                // collision's upper-plate plateau 0.56 km over the foreland (needs 0.75); at 0 both pass (Upwell, crust7).
                                // The suspect is the reach: subductionErosionReachKm's unsourced 250 km spans the inner half of a
                                // 300–500 km belt and eats the arc's root behind the fore-arc, where Earth's erosive margins lose
                                // only the fore-arc wedge. Follow-up: a sourced trench-to-arc reach, then back on.
                                // (lane crust; 0 = off) every closing overriding trench eats this much continental crust per km of
                                // its length per Myr off the fore-arc nearest it (step/subduction-erosion.js): ~36 is Earth's mean —
                                // ~60 % of the ~2.5 km³/yr recycled at ocean margins over ~41,700 km of them (Scholl & von Huene
                                // 2009, GSL SP 318; the 36 is my arithmetic); measured long-term rates 30–115 (von Huene et al. 2004)
    subductionErosionReachKm: 250,   // …from the continent nearest the trench within this: the fore-arc, trench to volcanic front
                                // ~150–300 km (recalled, not sourced: a margin farther than this from its trench has an oceanic fore-arc)
    rockBook: true,             // (lane crust; false = the old separate flux) the rivers carry the rock the heights wear off the crust (crust.wornKm), not a flux of their
                                // own (trenchDenudationKmPerMyr, ~5× the crust's own wear over the first 200 Myr): one book, so what
                                // the basins, seas and shelves keep is the continents' rock, and only what leaves them is lost
    beltStrainRate: 0,          // OFF by default (gjallar's ruling, 2026-11-05; 1e-15 is the value it was built and measured at). It took
                                // compressive records < 240 Myr 61 → 55 % (3 seeds), but its live width makes Andean belts sub-cell
                                // (median 44 km against one ~121 km cell at 160K; Earth's Andes 300–700 km): the per-step Andean work
                                // ÷ dt is tens of km/Myr only at a fast margin, so the belt holds no terrain (8a main range) and its
                                // area jitters with the mesh (scale: Laramide 12.05 vs 10.56 Mkm² at 40K/80K). Likely missing: the
                                // margin's shortening averaged over its life, not this step's. Under it a Laramide belt is floored at
                                // the flat slab's length (step/boundaries.js, Bird 1988), inert when off.
                                // (lane crust, 1c; /s, 0 = off: reach by absorbed convergence, floored by speed) a LIVE belt reaches only as far as it deforms at least this fast: a sheet
                                // shortening at v across width W strains at v ÷ W, so W = v ÷ this (capped at its kind's maxKm), with v the
                                // shortening rate now — not the convergence absorbed so far, floored by speed — so a slowing belt narrows
                                // and a stalled one stops refreshing its records. Unsourced: swept 3e-16 / 1e-15 / 3e-15 (India ~4 cm/yr
                                // over Tibet's ~1300 km and the Andes' ~1 cm/yr of shortening over ~350 km both give ~1e-15; my arithmetic)
    beltObliqueMin: 0.35,       // a belt's reach × this where the plates slide along the front rather than meet across it, rising to × 1
                                // head-on (× cos² of the obliquity): oblique convergence goes into strike-slip, not into the belt
    beltYoungSlabBoost: 0.5,    // a trench's belt reaches up to this much further over a brand-new slab (the ridge close offshore)…
    beltYoungSlabRefMyr: 60,    // …falling to × 1 at this slab age…
    beltOldSlabMin: 0.75,       // …and to this over a very old, steep slab
    andeanWorkShare: 0.12,      // share of the slab length going down that counts as shortening of the margin above it
    weakCellCost: 0.4,          // an old suture / rift margin carries deformation this far again (reactivation)
    cratonStrainShare: 0.35,    // a belt crosses onto a craton as a thin-skinned fold-thrust belt — the cover folds and thrusts over the
                                // shield's edge, as the sub-Andean zone and the Canadian Rockies' foothills do — with this share of
                                // the belt's uplift and crests. How far in it gets is not drawn: each km of craton costs the belt's
                                // reach as many km as its column is stronger (field/stress-step.js cratonStrengthRatio, ~3.5: a 1000 km
                                // plateau belt gets ~290 km in, an Andean one a few tens), and the shield thickens by only that much less (Jordan 1978: cratons are strong, not rigid —
                                // the Laramide uplifts stand inside the Wyoming craton). 0: a craton takes no belt
    beltHotStrength: 0.5,       // crust a belt has thickened to crustMaxThickKm, and island-arc crust, is this strong against ordinary
                                // continent (1) for a belt crossing it — hot, its lower crust ductile (Te 10–20 km against 30–50:
                                // Jordan & Watts 2005, Pérez-Gussinyé et al. 2008) — and a belt reaches over it that much further
                                // (step/orogeny.js spreadBelt); less thickened crust between. 1: every continent alike
    beltWorkShare: 0.35,        // share of the convergence at the front that is recorded across the belt (the front cell keeps the full amount)
    thickeningPerWorkKm: 0.05,  // crust thickens by this many km per km of shortening spread over a belt (Tibet: ~2500 km of shortening → ~35 km thicker)
    crustMaxThickKm: 40,        // …and less as the crust nears this much thicker than normal, none past it: crust thickened ~twice over
                                // spreads under its own weight instead of thickening more (gravitational collapse — England &
                                // Houseman 1989; Tibet and the Altiplano ~70 km, ~35–40 above normal, their plateaus widening, not rising)
    sutureStallCmYr: 0.4,       // two colliding plates weld once the seam between them has been closing slower than this…
    sutureStallMyr: 12,         // …for this long — and only then: no set shortening, contact time or overlap ends a collision.
                                // After the cores meet, the pair keeps converging as long as the forces on the two drive it
                                // against the collision's resistance (step/torque-balance.js), slowing as that grows over tens
                                // of Myr: India has run 2400–3200 km into Asia since ~50 Ma and still converges at ~4 cm/yr
                                // (Molnar & Stock 2009; van Hinsbergen et al. 2012). (Were: weld after 600 km of shortening, 40
                                // Myr of contact or 0.4 Mkm² of overlap, and at 120 Myr whatever sea was left — hand-set lock times)
    sutureHoldGpe: false,       // (lane weld, opt-in) …or once the belt has held the pair through one measure of the seam (sutureCheckMyr): the push
                                // across the front no more than the buoyancy force of the crust the collision has thickened (the GPE lock's,
                                // ~5.7 × 10¹² N/m at Tibet's: torque-balance.js seamHold). A thin viscous sheet converges while the force on
                                // its edge beats that buoyancy and stops when it does not (England & McKenzie 1982; England & Houseman 1989);
                                // the viscous lock alone only damps the push, and whole-model pairs crept on at 0.5–0.8 cm/yr for 50–150 Myr
                                // after their convergence ran down — contact → weld ~124 Myr against the ~60–70 of Earth's ended
                                // collisions (Alleghanian ~325→265 Ma, Hatcher 2002; Uralian ~320→250 Ma, Puchkov 2009). Held, the seam has
                                // also closed all it will (the sea left is a remnant: no waiting on sutureStallGiveUpMyr)
    sutureStallMinKm: 200,      // …and only once at least this much has been absorbed (two plates merely touching do not weld)
    overlapCapKm: 250,          // (Phase 11) land stacked deeper than this on average (overlap ÷ front) goes under the upper plate
                                // while the pair waits for its seam to close…
    sutureStackKm: 500,         // …and a pair stacked this deep is one already: it welds, converging or not, whatever sea is left
    sutureMinContactKm: 800,    // a collision front shorter than this is a terrane docking (Phase 5b), not a suture
    sutureGapKm: 1000,          // …and a weld waits for the seam to close (Phase 11): the sea between the two continents'
                                // coasts, up to this wide…
    sutureGapWidthKm: 250,      // …must be nowhere wider than this (the weld closes that much) — welded with the ocean between
                                // them still open, it would be sealed inside one plate for good. (Phase 12, developer on the
                                // zipper: "the western lobe never meets the coast" — judged by its width on average along the
                                // front, a wedge of sea at one end let the pair weld before it had closed)
    sutureCheckMyr: 4,          // (how often a waiting pair measures its seam and what its land rings)
    sutureStallGiveUpMyr: 24,   // …and a seam that has stalled this long has closed all it will: it welds with what sea is left…
    sutureGapStallMyr: 40,      // …as does one whose gap has not shrunk by a tenth in this long (a zipper closes in fits and starts)
    underthrustShare: 0.25,     // (Phase 7c) this share of the area a collision's convergence sweeps (shortening × front) is
                                // consumed from the lower continent as it slides under the upper plate… (0.8 → 0.25 after Phase 13:
                                // over 1200 Myr of collisions the continents lost a fifth of their area — 148 → 115–125 Mkm² —
                                // developer: "keep it at least closer to flat over time"; now 133–165, with arcs maturing)
    underthrustThickenKm: 25,   // …thickening the upper plate's crust above it by this much…
    collisionVolume: true,      // (lane crust, 1b) the crust a collision consumes — underthrust, or absorbed in a weld's overlap — is kept
                                // as the upper plate's thickness (ops/thicken.js), up to underthrustMaxThickKm a cell, across the belt
                                // the collision has built (1 − u²), then ring by ring from the front, instead of deleted (step/collision.js keepConsumed)…
    collisionLostShare: 0.15,   // …all but this share, which returns to the mantle. Derived: collisions lose ~0.7 km³/yr of continental
                                // crust (Scholl & von Huene 2009, GSL Spec. Pub. 318) out of ~4.8 km³/yr they consume today — India
                                // ~4 cm/yr over ~2400 km (Copley et al. 2010) and Arabia ~2 cm/yr over ~2000 km (McQuarrie et al.
                                // 2003), × ~35 km of crust (my arithmetic): 0.7 ÷ 4.8 ≈ 0.15
    collisionKeepLocal: true,   // (lane beltthick, F7) …laid only on belt cells within their own belt's reach of where the crust was consumed:
                                // the shortening at a stretch of front thickens the belt behind it (Δh = S·h₀ ÷ W; Tibet: ~1000–1500 km of
                                // Asia and India shortened over a ~1000 km plateau, crust ~35 → ~70 km). false: every collision belt the upper
                                // plate stamped since the collision began (a supercontinent's whole stock; the control)
    underthrustMaxThickKm: 40,  // …up to this (Tibet: crust ~70 km, about 35 km thicker than normal)
    collisionForgetMyr: 8,      // a collision record whose plates have not touched for this long is forgotten: the next meeting starts afresh
    collisionJitterFrontKm: 845, // a brand-new contact of parting plates no bigger than a one-cell sliver this long is jitter, not a collision
    riftJitterFrontKm: 635,     // …and between the fresh margins of a rift, this long
    escapeShare: 0.75,          // at suture, how much of the indentation is taken up sideways (escape tectonics) at the ends of the front
    indentGain: 1.5,            // crust ahead of the indenter is pushed this many times the overlap depth (the whole zone deforms, not just the overlap)
    indentFalloffKm: 1500,      // the redraw's displacement decays over this distance behind the front
    sealStraitKm: 0,            // at suture, sea between the two plates narrower than twice this is filled with their land (0: only the
                                // seams a cell wide, which are the raster's). Filling makes land: the ledger books it to collisions. A
                                // strait between two continents closes by their converging, its floor going down — not by being
                                // filled — and what the weld leaves open stays a sea sealed in the plate (the Black Sea, the South
                                // Caspian), until its floor founders or the plate breaks again (was 260 km: 32 Mkm² of land made
                                // in 1200 Myr, as much as all the arcs that matured into continent)
    inlandSeaMaxKm2: 0,         // …and an enclosed sea smaller than this is filled too (was 0.5 Mkm²; a taste setting, for the lab)
    cratonLockFactor: 4,        // a craton at the collision front resists (locks) this much harder than ordinary crust

    // ── Wings, arcs, terranes (Phase 5b): plates are larger than their land ──
    wingGrowthCmYr: 4,          // a trench's ends propagate along strike this fast (the wing lengthens by capturing old ocean)
    wingRimCrossKm: 364,        // a new wing may cross this much of its own plate's apron rim to get off it
    wingMaxKm: 1500,            // …up to this far past the land
    wingFillKm: 300,            // the old ocean behind a wing, this far toward the plate's body, is captured with it (fore-arc: part of the overriding plate)
    wingBendToMotion: 0.8,      // 0 = straight along strike, 1 = perpendicular to the plate's motion (WBP: arcs sit across the motion, like the Aleutians off Alaska)
    arcSlabDepthKm: 105,        // an arc rises where the slab's top lies this deep — 105 km on average beneath the world's arc volcanoes
                                // (Syracuse & Abers 2006: 72–173 km) — so it forms once the slab reaches that depth, and that far
                                // behind the trench (step/wings.js arcSlabKm, arcGapKm). Was: 1000 km of slab swallowed, tuned for
                                // how common arcs looked; the Izu-Bonin-Mariana arc began 7–8 Myr after its trench (Ishizuka et al.)
    slabDipDeg: 35,             // …the slab's dip down to that depth (most slabs dip ~30–45° in their top 100 km): the arc forms after
                                // 105 ÷ sin 35° ≈ 180 km of slab, ~150 km behind its trench (arc–trench gaps 100–300 km: Dickinson 1973)
    arcWidenSlabKm: 500,        // every further this much slab, the arc behind a trench gains a row: a chain of islets → a Philippines → an Indonesia
    arcNearKm: 400,             // an arc this close to a continent may grow up to arcNearMaxKm wide (below)
    arcRowWidthKm: 121,         // an island arc is this wide when it forms, and this much wider with every arcWidenSlabKm more slab
    arcNearMaxKm: 360,          // an arc near a continent grows at most this wide (Japan ~250 km, the Philippines ~500)…
    arcFarMaxKm: 240,           // …one out in the open ocean at most this (a chain of islands on a ridge: the Marianas ~150–250 km)…
    arcFarKm: 1200,             // …beyond this from any continent (between: a smooth blend from arcNearKm on). Uncapped,
                                // a trench consuming 5 cm/yr widened its arc ~1200 km per 100 Myr (developer: "huge unnaturally")
    arcBeltMaxKm: 243,          // the orogeny belt of an island arc reaches at most this far: an arc is a narrow line
    arcContinentKmPerMyr: 1.5,  // arc crust welded onto a continent turns continental, its front advancing this fast, once it is
    arcContinentAgeMyr: 100,    // this old (step/arc-maturation.js) — how continents grow. (crust-sink branch) Derived from Earth's arc
                                // magmatic addition: ~2.5–2.7 AU (km³/yr) along ~42,000 km of arcs (Scholl & von Huene 2009) is
                                // ~60 km³/Myr per km of arc; booked as continent continentCrustKm (40 km) thick, that is a front
                                // advancing 60 ÷ 40 = 1.5 km/Myr along the arc's contact with its continent. All of it is booked
                                // here as made: which part LASTS is for the sinks to decide (subduction erosion, sediment subduction,
                                // underthrusting) — taking a lasting share here as well would count the losses twice. (Was 3: "a
                                // 300 km arc in ~100 Myr", twice Earth's addition)
    arcAccreteThickKm: 17,      // (Phase 7c) arc crust thinner than this arriving at a trench goes down with its slab instead of
                                // accreting: too little buoyant crust to hold up the lithosphere under it (Cloos 1993: ~15–17 km
                                // of crust makes young lithosphere unsubductable; Clift & Vannucchi 2004). Was by area: a piece
                                // smaller than 3e4 km² went down
    arcBirthKm: 8,              // …an arc's crust is this thick when it forms (ocean crust and its first volcanoes)…
    arcThickenKmPerMyr: 0.4,    // …and thickens this fast as magma adds to it (Izu-Bonin-Mariana: 20–35 km after ~50 Myr)…
    arcMaxKm: 35,               // …up to this (a mature arc's crust: the Aleutians, Izu ~30–35 km)
    arcCollapseKm: 1000,        // an arc chain within this distance of its own plate's continent…
    arcCollapseMinKm2: 1.0e5,   // …and at least this big…
    arcCollapseAgeMyr: 20,      // …and this old collapses onto the coast: the fore-arc closes, subduction jumps in (the plate's front retreats)
    arcCollapseForeArcKm: 500,  // when an arc collapses, the plate's sea this far beyond it (toward the old trench) is given up

    // ── Hotspots & LIPs (Phase 7a, step/hotspots.js) ──
    plumeRatePerMyr: 0.05,      // new mantle plumes per Myr, anywhere on the planet (step/hotspots.js): each head erupts a LIP,
                                // then its tail draws a hotspot track; under a big continent a head may also rift it
    hotspotInitialCount: 6,     // plumes already rising when the history begins (their heads erupted in prehistory: no LIP)
    plumeOceanWeight: 0.3,      // a plume is this likely to rise under cool mantle, relative to fully insulated mantle (1):
                                // it favours the mantle a continent has sat on, strongly but not absolutely (developer)
    mantleInsulateMyr: 100,     // mantle under a continent warms toward "fully insulated" over about this long…
    mantleCoolMyr: 150,         // …and cools back over about this long once the continent has moved off it
    plumeSpacingKm: 1500,       // a new plume does not rise within this of a live one
    plumeLifeMinMyr: 80,        // a plume's tail lasts between these (Hawaii ~80 Myr and still going; Kerguelen ~120)
    plumeLifeMaxMyr: 250,
    plumeRiftChance: 0.35,      // chance a plume head under a continent splits it, when the continent is pulled apart at least
    plumeRiftTension: 0.35,     // …this hard (its tension: the share of its plate's pulls that cancel; a ringed supercontinent ~0.35)
                                // — less, a smaller chance: a plume weakens the lithosphere, the pull across it breaks it (Buiter &
                                // Torsvik 2014: break-up needs far-field tension as well as a plume). Was: any continent bigger than
                                // riftMinContinentKm2 at plumeRiftChance, a smaller one never
    plumeJunctionKm: 450,       // a head under a craton rifts from the nearest ordinary ground within this
    lipAreaMinMkm2: 0.15,       // a plume head spreads its flood basalt over this many million km²… (log-uniform: many small,
    lipAreaMaxMkm2: 4,          // …a few vast — Columbia River 0.2, Deccan 1.5, Karoo 3, Siberia ~4; developer: not all alike)
    lipThicknessKm: 2,          // flood basalt piled onto the crust by a head (a record: Phase 8 makes a plateau of it)
    lipLobes: 0.5,              // strength of the low-order harmonics that make a LIP's outline lobed, as a craton's is…
    lipEdgeNoise: 0.3,          // …and of the finer noise that bites bays and pushes out tongues (developer: not discs)
    hotspotTrackKm: 110,        // half-width of the track a plume tail stamps on the plate passing over it (on the plate’s own
                                // lattice, so it is one unbroken ribbon there; snapshot.js shows the cells the world grid misses)
    hotspotBurstMinMyr: 0.6,    // a tail erupts in BURSTS, each building one volcano over its shield-building life (Hawaii's
    hotspotBurstMaxMyr: 2,      // shields grew for ~0.5–1.5 Myr each)…
    hotspotSpacingAlpha: 2.4,   // …and the next one breaks through only once the plate has carried the last this many flexural
                                // lengths off: the volcano's weight bends the plate, and the bending squeezes the vents shut in the
                                // moat around it — magma finds its way up beyond it, near the flexural bulge (~3πα/4; ten Brink
                                // 1991, Hieronymus & Bercovici 1999). An old, stiff plate spaces its volcanoes wider: α ∝ Te^¾…
    hotspotContinentTeKm: 40,   // …the elastic thickness under a continent (an ocean plate's grows with its age: the depth of its
                                // 450 °C isotherm, ~3.4 km × √age in Myr — Watts 2001; Hawaii's ~90 Myr plate: ~30 km)
    hotspotEdificeKm: 70,       // radius of the volcano a burst builds (the swell around it is hotspotTrackKm)
    hotspotBuildKmPerMyr: 8,    // volcanic pile a burst builds per Myr, × its intensity and the plume's strength…
    hotspotMaxKm: 10,           // …up to this: a volcano this tall stops growing up (Mauna Kea stands ~9 km off the sea floor)

    // ── Margins, flat slabs, slab rollback & back-arc basins (Phase 7b) ──
    marginReachKm: 600,         // a coast is ACTIVE if its own plate's trench lies within this, seaward (measure.js)
    marginMotionCos: 0.35,      // a coast facing within ~70° of its plate's motion is LEADING, against it TRAILING
    flatSlabMaxAgeMyr: 35,      // a slab younger than this is warm and buoyant…
    flatSlabCrustKm: 10,        // …and one carrying thick crust — a plateau, an aseismic ridge — is buoyant longer: every this many
                                // km of crust above normal doubles the square root of that age (the slab's sinking weight grows as
                                // √age: its crust's buoyancy offsets it). Most of today's flat slabs lie under subducting ridges and
                                // plateaus (Gutscher et al. 2000: the Nazca Ridge under Peru, the Juan Fernández under Chile)
    oceanPlateauCrustKm: 15,    // …the crust a plume head's plateau adds at sea (Ontong Java ~30 km against ~7 normal; the Nazca Ridge ~17)
    flatSlabAdvanceCmYr: 2,     // …and if the overriding plate drives at the trench faster than this, it goes in FLAT: a
                                // Laramide belt reaching far inland, and no volcanic arc above it (step/boundaries.js; van Hunen et al.
                                // 2002: a buoyant slab flattens under an advancing upper plate)
    flatSlabOnShare: 0.5,       // a plate's slab goes flat once more than this share of its feeding trench qualifies…
    flatSlabOffShare: 0.3,      // …and steepens again only below this (hysteresis: a slab does not flip every step)
    rollbackMinAgeMyr: 70,      // a slab older than this is cold and sinks steeply: its hinge rolls back, the trench retreating…
    rollbackFullAgeMyr: 150,    // …ever faster with age, up to…
    rollbackMaxCmYr: 3,         // …this. Where the overriding plate follows its trench more slowly than that, it is stretched
                                // behind it (step/backarc.js)
    backArcRatePerMyr: 0.03,    // chance per Myr a rolling-back trench backArcMinLengthKm long opens a back-arc basin (0.015 until arcs
                                // became commoner in 7c: more arcs collide and collapse, fewer trenches qualify)
    backArcMinLengthKm: 800,    // (real back-arc basins run 500–1500 km along their trench: Tyrrhenian, Okinawa, Mariana)
    backArcWidthKm: 350,        // the strip that rifts off behind the trench, measured from it: an arc and its fore-arc…
    backArcContinentalWidthKm: 650, // …or, where the trench fronts a continent, this much — the trench lies a few hundred km offshore, so
                                // the strip carries some 300 km of the coast with it: a coherent arc of land, not a sliver (developer)
    backArcContinentalShare: 0.35, // a continental margin opens one this much less readily than an arc on an ocean plate
    backArcMinLandKm2: 3e5,     // a continental strip with less land than this stays put: it would be a sliver (developer)
    backArcActiveMyr: 30,       // a back-arc basin opens for this long (the Sea of Japan: ~25–15 Ma): meanwhile the strip moves
                                // as its parent does plus the slab's rollback — the hinge sets its pace, not a force balance
    backArcSeamKm: 400,         // when a strip rejoins, a seam of missed cells up to this wide between it and its plate is closed
    backArcTenureMyr: 60,       // a plate that took part in a back-arc split waits this long before its trench may open another (an arc does rift
                                // again — the Mariana Trough is a second episode — but not every few Myr)
    // ── Fore-arc islands off an active continental coast (step/margin-isles.js) ──
    marginIsleSlabKm: 600,      // a trench must have swallowed this much slab before its fore-arc rises
    marginIsleReachKm: 500,     // a trench this close to its plate's land is a continental margin whose fore-arc can rise
    marginIsleRatePerMyr: 0.6,  // islands born per 1000 km of margin per Myr
    marginIsleGrowKmPerMyr: 10, // an island grows outward this fast…
    marginIsleCoastShare: 0.2,  // …and the coast itself creeps seaward at this share of it (the accretionary wedge)
    marginIsleGapKm: 80,        // sea always left in front of the trench
    // …on an ACCRETIONARY margin. An EROSIVE one eats its coast instead (Phase 7c):
    // Which it is, stretch by stretch (Clift & Vannucchi 2004): a margin accretes where convergence is slower than
    // erosiveConvergenceCmYr and its trench is filled with at least accretionSedimentKm of sediment; otherwise it erodes.
    erosiveConvergenceCmYr: 6,  // faster than this, the trench eats its fore-arc whatever the sediment (the Andes, Tonga, Japan)
    accretionSedimentKm: 1,     // …and with less than this in the trench it does too
                                // (a trench's fill from the land around it: trenchDenudationKmPerMyr, in the crust-sink block below)
                                // (trenchSedimentReachKm, the land within 300 km of a trench, is gone: whole river basins feed the
                                // trenches their fans reach — trenchFanReachKm, in the crust-sink block below)
    trenchPelagicKmPerMyr: 0.003, // …plus what the incoming ocean floor carries: ~3 m per Myr of its age (0.5 km on 160 Myr floor)
    marginErosionKmPerMyr: 2,   // an erosive margin's coast retreats this fast…
    marginErosionMaxGapKm: 500, // …until it lies this far from its trench (the Andes: ~250 km of coast lost since the Jurassic)

    // ── Crust sinks at trenches: sediment subduction (crust-sink branch, step/sediment-subduction.js) ──
    // On Earth the continental crust's additions at arcs (~2.7 km³/yr) and its losses (~3.2 km³/yr) about balance: no net
    // growth through the Phanerozoic (Scholl & von Huene 2009). Of the ~60 km³/Myr per km recycled at ocean-margin
    // subduction zones, ~60 % is subduction erosion (the erosive margins above) and ~40 % — ~24 km³/Myr per km — is trench
    // sediment dragged down the subduction channel, at accretionary margins as much as at erosive ones. The channel
    // takes about accretionSedimentKm of the trench's fill (more is scraped off into the wedge); its terrigenous share
    // was continent, and is lost.
    sedimentSubductionShare: 1, // the share of the sediment in the channel that leaves the continent for good (Scholl & von Huene
                                // count all of it lost; relamination under the arc — Hacker et al. 2011 — would return some: 1 is
                                // the upper bound, 0 switches the sink off)
    trenchDenudationKmPerMyr: 0.1, // a trench's terrigenous fill is a FLUX, not a thickness: every river basin wears down this fast
                                // (× how fast its latitude erodes: terrain-config.js erosionAtLatitude, rain or ice; step/rivers.js)
                                // and its fan delivers that rock to the trenches it reaches, which the downgoing plate carries away at the
                                // convergence rate — so the fill stands at supply ÷ convergence: a slow trench off wet land fills
                                // (Cascadia, southern Chile), a fast one starves (Tonga, northern Chile), as Clift & Vannucchi
                                // (2004) find. River basins worldwide by ¹⁰Be: median 0.054, mean 0.218 km/Myr (Portenga &
                                // Bierman 2011); an active margin's seaward slope lies between. (Was trenchTerrigenousKm 2.5: a
                                // thickness, × the land's share × the latitude's erosion, whatever the convergence)
    trenchFanReachKm: 3000,     // a river's rock runs out across the ocean floor this far, as turbidity currents down its submarine
                                // fan, to the nearest trench in reach (step/trench-fans.js): the Bengal–Nicobar fan, the longest, runs
                                // ~3000 km from the Ganges–Brahmaputra mouth to the Sumatra–Andaman trench (Curray et al. 2003).
                                // Beyond it — or with land in the way — a mouth's rock stays on its own margin
    trenchAxialTransportKm: 700, // …and along the trench's own axis, e-folding over this: the Chile trench is turbidite-filled from
                                // its glacial sources at 41–46°S north to the Juan Fernández ridge at ~33°S, ~1000–1400 km, by an axial
                                // channel (Völker et al. 2013; Laursen & Normark 2002 at its northern end): half that span
    riseProfile: {              // a mouth with no trench in reach lays what its shelf has no room for past the shelf, down to the surface a
                                // margin's sediment grades to (step/trench-fans.js layRise: fill and spill, nearest first, out to
                                // trenchFanReachKm). A record (crust.riseKm3): it rides its plate to a trench, where the channel takes
                                // what it can and the prism the rest (step/resolve.js), or it stays.
        shelfKm: 80,            // the mouth to the shelf break: the world's shelves average ~80 km wide (Shepard 1963)
        breakKm: 0.13,          // the break's depth, ~130 m (Shepard 1963; Kennett 1982)
        slope: 0.05,            // the slope below it, ~3° (continental slopes 2–5°, Pratson & Haxby 1996; terrain-config.js clinoformGradient)
        footKm: 2.5,            // …down to its foot, where the rise begins, at 1.5–3.5 km (Heezen, Tharp & Ewing 1959; Kennett 1982)
        rise: 0.004,            // the rise, 1:100–1:700 (Heezen et al. 1959; Emery 1980): ~1:250, the middle of that range
        toeKm: 4.5,             // …down to its toe on the abyssal plain, at ~4–5 km (Heezen et al. 1959): the rise ~500 km wide (100–1000)
        plain: 0.001,           // the abyssal plain beyond, its turbidites levelled to < 1:1000 (Heezen & Laughton 1963)
        coastKm: 400,           // the walk out from the mouth may cross a drowned shelf or a cape this far, then only ocean floor
    },
    enclosedSeaFill: true,     // a river running into an enclosed sea lays its rock on that sea's floor, and a sea filled to sea level
                                // is lowland (step/sea-fill.js; the floor's depth under it: measure.js; false: the rock is lost, as before)
    continentCrustKm: 40,       // continental crust's mean thickness: a volume lost (km³) is booked as this much less area
                                // (Christensen & Mooney 1995: 41 km; Rudnick & Gao 2003: ~40 km)
    oceanCrustKm: 7,            // oceanic crust's thickness (White et al. 1992: 7.1 ± 0.8 km): the fore-arc floor an island rises from
    wedgeConservation: true,    // fore-arc islands are the accretionary prism risen above the sea: they rise only as fast as the trench
                                // scrapes sediment off — v × (fill − accretionSedimentKm) per km of trench — each cell of island costing
                                // (continentCrustKm − oceanCrustKm) × its area (step/margin-isles.js; false: at their own rates, as before)

    // ── Subduction initiation (Phase 6b, step/subduction-init.js) ──
    subductionInitRatePerMyr: 0.02,   // chance per Myr for a margin at the age threshold, per subductionInitRateLengthKm of it
    subductionInitAgeMyr: 180,        // unsqueezed, ocean founders once it is this old: its weight then overcomes the margin's strength.
                                      // Earth's oldest passive margins (~180 Myr) have not foundered, and ancient ones lived a mean
                                      // 181 Myr (Bradley 2008); most trenches are born squeezed (induced: Crameri et al. 2020), so the
                                      // squeeze (founderUrge) does most of the founding. Was 120
    subductionInitAgeCap: 3,          // the age factor (age ÷ threshold − 1) counts no higher than this
    // (subductionInitMinLengthKm: below, in the stress-driven initiation block)
    subductionInitMaxOpeningCmYr: 0.3, // a margin opening faster than this is a ridge, not a founder
    basinOceanAgeMyr: 260,            // (a scene setting) the old basin of scene "founder", left by a rift, ready to founder
    segmentPolarity: true,            // ocean on ocean, which side goes down is settled for a whole stretch of boundary at a time, not cell by cell
    segmentTrenchWeight: 4,           // in that vote, a cell of an established trench counts this many times over
    oceanPlateReachKm: 5000,          // how much of the passive ocean a newborn oceanic plate takes with it
    oceanPlateMinAreaKm2: 8e6,        // below this there is not enough old ocean to be worth a plate of its own
    subductionInitSlabKm: 150,        // the slab a new trench starts with: it pulls weakly until it has swallowed more
    marginFounderRatePerMyr: 0.02,    // the same, for a margin INSIDE a plate (its old ocean breaks away as a plate of its own,
                                      // founderWithinPlates): without it a plate that holds its whole ocean never breaks up again
    // (founderStrength: below, in the stress-driven initiation block)
    founderSqueezeCmYr: 17,          // two plates closing on a margin between them at this rate squeeze it as hard as it is strong:
                                      // the rate at which a contact's resistance, shared by its two plates (slabResistance ÷ 2, step/forces.js),
                                      // reaches founderStrength: 0.4 ÷ 15 rad/Myr ≈ 17 cm/yr (derived; was 3.4 from 0.08, and 6 by hand before)
    oceanNeutralAgeMyr: 30,           // ocean younger than this is too warm and light to founder however hard it is squeezed

    // ── Oceans that break into plates (realism pass, phase 3: step/ocean-plates.js) ──
    backgroundEndMyr: 150,            // from then on, each region of the passive pre-history ocean big enough becomes a plate
    oceanSplitAreaKm2: 40e6,          // a plate with more ocean than this may break along a new ridge (the Pacific: ~100 Mkm²)…
    oceanSplitRatePerMyr: 0.03,       // …a chance per Myr this × its excess (ocean ÷ oceanSplitAreaKm2 − 1)…
    oceanSplitAreaCap: 2,             // …counted up to this…
    oceanSplitMinAgeMyr: 60,          // …not within this of its birth, a weld, a rift or its last split…
    oceanSplitLandKm: 800,            // …on a line through its open ocean: over this far from its land
    oceanPlateCaptureKm2: 2e6,        // an ocean plate subducted down to less than this is captured by its neighbour (a microplate)

    // ── Stress-driven subduction initiation (branch stress-init: step/subduction-init.js, step/plate-stress.js) ──
    founderStrength: 0.4,             // (2026-11-02, lane pstress: 2–3 × 10¹² N/m ÷ forceUnitNPerM 6 × 10¹² = 0.33–0.5; it was 0.08 against a
                                      // gross 3 × 10¹³ unit, the same N/m. Adopted with ridgePush 0.25 as one change, Jackson's ruling)
                                      // what holds a weak zone up against a squeeze across it, per 100 km of line, in units of a full
                                      // slab pull: a squeeze this hard founders it whatever its age (founderUrge). The resisting force
                                      // of a plate starting to bend into a new trench peaks at 2–3 × 10¹² N/m (Gurnis, Hall & Lavier
                                      // 2004, G³ 5), against a slab pull of ~3 × 10¹³ N/m (Turcotte & Schubert 2002): ≈ 0.08. (Was 1.0,
                                      // a margin as strong as a whole slab pull: the plates' stresses, ±0.1 here, then barely counted
                                      // and the floor's age did nearly all the founding — tools/trace-founders.mjs)
    subductionInitMinLengthKm: 800,   // a trench is born along a margin at least this long, not at a corner. Earth's youngest
                                      // trenches, born in the last ~20 Myr, are this long and more: Puysegur ~800 km (Gurnis et al.
                                      // 2004), Yap–Palau and Manila ~1000 km; they then lengthen along strike (step/wings.js). And a
                                      // slab sinks as a sheet, its pull not leaking round its ends, once it is several times wider
                                      // than the lithosphere is thick (~100 km) — 800 km is ~8×. (Was 2000 km, unsourced: it threw
                                      // out ~98 % of the margins between two plates — tools/trace-founders.mjs)
    subductionInitRateLengthKm: 2000, // the length of margin subductionInitRatePerMyr and marginFounderRatePerMyr are quoted for: the
                                      // chance per Myr per km of margin is theirs ÷ this (it was the old minimum length, so the
                                      // chance per km is as before)
    marginFounderEveryMyr: 4,         // the founder tests inside plates (founderWithinPlates: margins, sealed seas, across) are drawn this
                                      // often, each for the time since — the same chance per Myr. A trench takes ~10 Myr from the first
                                      // failure to sinking on its own (Gurnis, Hall & Lavier 2004; Stern 2004), so a draw every 4 Myr is
                                      // finer than the process it stands for. (It ran every step: ~3 % of a history's time)
    founderAcross: true,              // a plate's open ocean founders ACROSS the plate too, on the line it would split along, when it is
                                      // pressed together across it (large-plate failure: subduction-init.js founderAcross)

    // ── Trenches that nucleate on a segment and propagate (branch founders: step/subduction-init.js) ──
    founderNucleusKm: 300,            // a new trench nucleates along this much of the margin that fails — its weakest, most pressed
                                      // stretch — not along the whole margin at once: Puysegur, induced ~11 Ma, is still only ~150 km
                                      // wide (Stern & Gerya 2018, Tectonophysics 746 §6.3.1); a slab sinks as a sheet once a few times
                                      // wider than the plate is thick (~100 km). The ocean behind it breaks away as a strip that
                                      // wide (a microplate bounded by the trench and a transform at each end), and widens as the
                                      // trench lengthens
    founderPropagationCmYr: 10,       // how fast a trench end runs along a margin that keeps failing ahead of it, at full urge (urge ≥ 1;
                                      // slower in proportion below): ~100 mm/yr along the 3000 km Bitlis–Zagros ophiolite belt
                                      // (Stern & Gerya 2018, Fig. 8G, after Moghadam et al. 2013); ~17 cm/yr in 3-D models of a
                                      // trench propagating onto a weak passive margin (Zhou et al. 2020, Sci. Adv. 6, eaaz1048)
    founderSlabLoad: 0.42,            // the pull a mature slab beside a trench end puts on the margin just ahead of it, in units of the
                                      // margin's strength (× the slab's maturity): next to a mature slab a weak margin propagates on
                                      // floor ≥ 60 Myr old, but not on younger (the Scotia arc's Atlantic: Zhou et al. 2020), so
                                      // √(60 ÷ subductionInitAgeMyr) + load = 1 in founderUrge: load = 1 − √(60/180) ≈ 0.42
    founderSlabMyr: 10,               // a plate born at a new trench is not captured as a microplate this long while it faces that trench:
                                      // it hangs from a young slab that pulls it, by the trench's state, before it moves fast enough to
                                      // count as going down. A new trench takes ~10 Myr from failure to sinking on its own (Gurnis, Hall &
                                      // Lavier 2004; Stern & Gerya 2018: 6–8 Myr for Izu–Bonin–Mariana) — past that, one still not going
                                      // down has failed (Zhou et al. 2020's aborted initiation) and is captured as before
    trenchEstablishKm: 100,           // a closing contact is a trench once it has taken this much convergence under the founder law: a
                                      // fracture zone becomes a self-sustaining subduction zone after ~100 km (Hall et al. 2003, EPSL 212),
                                      // and cumulative convergence, not its rate, sets the force balance (Gurnis, Hall & Lavier 2004)
    trenchDetachAgeMyr: 5,            // floor younger than this reaching a trench cannot hold the slab up, and the slab detaches: ridges are
                                      // abandoned 100–275 km from the trench (Burkett & Billen 2009, 2010), ~3–9 Myr at ~30 km/Myr half-spreading
    founderPropagate: true,           // trench ends propagate along strike, and invade a passive margin they abut (false: no propagation)


    // ── Terranes & plate integrity (step/collision.js, ops/accrete-terrane.js, ops/tidy-plates.js) ──
    arcScrapeLogKm2: 1.5e5,     // an arc being scraped onto a continent is reported once this much of it has arrived
    terraneForeArcKm: 250,      // an accreting terrane takes along its plate's trench-flagged ocean this far in front of it
    fragmentJoinKm: 350,        // a piece of land cut off from its plate joins another plate whose crust lies within this distance
    terraneMinAreaKm2: 6e4,     // smaller scraps (a few cells of arc) are absorbed quietly: no event, no belt, no strait closing
    terraneMaxAreaKm2: 1.2e6,   // a colliding landmass smaller than this accretes as a terrane instead of suturing (Borneo, Madagascar ≈ 0.6–0.75; Arabia 3.2)

    // ── The stress inside the plates (lane pstress: field/plate-stress-field.js, step/plate-stress-field-step.js) ──
    plateStress: true,          // solve it (default on since lane rifton, 2026-11-03; off, the history's motion is the same, records only)
    plateStressRifts: true,     // …and continental crust it breaks in tension is logged as stretched (a RIFT record, no work): diffuse
                                // extension, the field's own (field/stress-step.js). Its amount follows plateYieldContinent, which is
                                // declared: a finding at that strength, not a calibration (lane pstress)
    plateStressEveryMyr: 10,    // how often: a plate's load changes over its trenches' lives (tens of Myr), not step by step
    plateStressCells: 5000,     // the stress mesh, whatever the sim's (~340 km between nodes): the field varies across a plate's
                                // breadth; one fixed mesh keeps it the same on every sim mesh
    plateStressTol: 1e-2,       // the solver's relative residual: the field is read for where a plate is most pulled, to a few %
                                // (at 40K, 5K against 10K and 20K stress meshes and 1e-2 against 1e-3: quantiles within ~10 %, pstress-field.mjs)
    plateStressMaxIter: 800,
    // …and the strength it is held against (field/stress-step.js), vertically integrated, N/m. Where the stress beats it the
    // lithosphere breaks (a record, crust.damage; the diffuse extension above). The continent's is a law (lane riftstrength,
    // 2026-11-10, on Jackson's ruling Q1 (b) of 2026-11-09): a sourced strength weakened by heat, magma and strain, each below.
    // Before it, 3e12 was DECLARED (Jackson, 2026-11-03), standing in for the weakening the model lacked (the plate force
    // paradox, Buck 2004): with exceedance damage it put ~15 bands per solve past their strength, 5–16× over (lane riftprobe2)
    plateYieldContinent: 1e13,  // N/m: the force to rift Earth's average continent, ~40 km of crust at ~65 mW/m² (Pollack, Hurter & Johnson
                                // 1993's continental mean, recalled): 8.8 × 10¹² on Buck 1991's curves (Hopper & Buck 1993 Fig. 1, read
                                // 2026-11-10: 30 km crust ~19, 50 km ~4 at 65 mW/m²; "> 20 TN/m" below 50). Over mantle no continent has warmed
                                // (h 0); the heat below weakens it. 2e13 (cold, < 50 mW/m²) is the high case swept in tools/riftforce.mjs
    plateHeatFlowRef: 65,       // mW/m²: the surface heat flow plateYieldContinent stands at (above)…
    plateCrustRefKm: 40,        // km: …and the crust it stands for (Earth's continental mean ~40 km, Christensen & Mooney 1995, recalled).
                                // A cell's own crust (measure.js crustThicknessKm: as formed, thickened, thinned) moves it along the
                                // figure's second axis: 50 km is ×0.45 of this at 65 mW/m², 30 km ×2.2, held at those curves outside
                                // them (Buck 1991: thick orogenic crust is weak; field/stress-step.js heatWeakening)
    plateStrengthCrust: true,   // the strength reads each cell's own crust (above); off: every continent at plateCrustRefKm. The crust it reads
                                // is the heights' (rootKm, relief), which erosion thins, so wear feeds the history through it (unroofing
                                // restores a worn orogen's strength: Willett 1999's coupling); check-phase8a's like-for-like erosion pair
                                // turns it off, as it does collisionLockGpe
    plateHeatMantleFlow: 45,    // …of which this much comes up from the mantle: Hopper & Buck 1993 let the crust's heat production give
                                // 20 mW/m² of the surface flow (their §"model formulation")…
    plateHeatWarmK: 100,        // …and a continent's insulation warms the mantle under it by up to this (h = 1): "as large as 100 °C" under
                                // a supercontinent (Coltice et al. 2007, Geology 35, abstract) — world.mantleHeat's full insulation…
    plateHeatMantleK: 1600,     // …at about this mantle temperature (K; a ~1330 °C potential temperature, McKenzie & Bickle 1988, recalled)…
    plateHeatCreepKJ: 250,      // …whose viscosity falls with it by an Arrhenius law with this activation energy (kJ/mol): olivine diffusion
                                // creep, the low-stress mantle's (Karato et al. 1986, as tabulated by Hopper & Buck 1993 Table 1; their
                                // dislocation creep is 498). The boundary layer under the lid thins as η^⅓ (Nu ∝ Ra^⅓), so the mantle heat
                                // flow rises; Buck's curve gives the strength at the new surface flow (field/stress-step.js heatWeakening):
                                // ×0.43 at the land's median h 0.62, ×0.30 at h 1
    plateHeatLidK: 1300,        // …across a lid this many K from the surface to the mantle (its heat flow ∝ the contrast too)
    magmaWeakening: 10,         // crust a plume head's flood basalt covered is this many times weaker while the magma lasts: dikes open the
                                // lithosphere at a force an order of magnitude below tectonic faulting (Bialas, Buck & Qin 2010, EPSL 292,
                                // abstract; their Fig. 1e: ~20 TN/m by faulting against ~1–1.5 by diking at 60 km of lithosphere, a ratio
                                // they call an underestimate of faulting's). Was ×6 in the rift audit (unverified there)
    magmaWeakMyr: 20,           // …for this long after the eruption: magma weakens a rift into tectonic rifting over ~1 Myr (fast
                                // injection, volcanic margins) to > 10–20 Myr (slow, the Red Sea) (Bialas, Buck & Qin 2010, abstract);
                                // the upper end, since the dike-heated lithosphere then rifts "without additional magma"
    plateYieldOcean: 1e13,      // N/m: old ocean. ~150–250 MPa over ~50 km (the yield stresses of Mallard et al. 2016's plate-like
                                // runs, reported second-hand); an envelope gives ~8 × 10¹² in tension (a teaching source, UNVERIFIED)
    plateYieldOceanAgeMyr: 100, // …growing as √(age ÷ this) to 1: its cold, strong layer thickens as √age (half-space cooling)
    plateYieldOceanFloor: 0.05, // …from at least this share (ridge-axis lithosphere is not nothing)
    plateYieldCompression: 2.5, // rock is this much stronger pressed than pulled: ~2 × 10¹³ against ~8 × 10¹² (the same teaching
                                // source, UNVERIFIED; Byerlee friction gives 2–4× for thrust over normal faults, recalled)
    plateDamageKeep: 0.17,      // (a record only since lane riftstrength: no strength reads crust.damage) a broken zone keeps this share of its
                                // strength: fault friction ~0.1 (Bird, Liu & Rucker 2008's best fit) against Byerlee's ~0.6
    plateDamageHealMyr: 300,    // damage fades e-fold over this: a CHOICE (Bercovici & Ricard 2014 need weak zones to outlast a
                                // Wilson cycle; the stress-field study found scars fading in 100–200 Myr under a 300 Myr law)

    // ── Rifting (Phase 6a) [WBP]. Probabilistic, from the world's seeded rng (developer decision). ──
    riftMinContinentKm2: 1.8e7, // only a continent this big rifts on its own (South America 18, Africa 30 Mkm²; smaller ones need a plume)
    riftTenureMyr: 60,          // a fresh or just-sutured continent is stable this long
    riftRatePerMyr: 0.08,       // chance per Myr = this × tension × (size ÷ riftMinContinentKm2 − 1, capped at riftSizeCap) × the pace
                                // (below; 0.04 before the pace kept each piece's breakups apart: most then rifted only when forced)
    riftSizeCap: 4,             // a supercontinent (8× the minimum) at tension 0.35 rifts within ~20 Myr on average (developer: ~30 Myr);
                                // a continent of twice the minimum at tension 0.5 waits ~50 Myr beyond its tenure
    // (a craton's strength: no constant — its column's, field/stress-step.js rockStrength: Buck's curve at the surface heat
    // flow its 250 km keel lets through (terrain-config.js cratonLithKm against riftLithKm), ~5× ordinary continent's at rest,
    // ~3.5× ordinary crust as formed; a rift goes round one where it can, through it only where every way round costs more
    // (the South Atlantic split the Congo and São Francisco cratons). Was: cratonStrength 6, before that never cut (∞).)
    riftWeaknessCost: 0.8,      // (also the strength there: field/stress-step.js — strain softening, the friction and cohesion of a zone that
                                // took strain halving, Naliboff et al. 2017 Nat. Commun. 8, over brittle strain 0–0.1, on the brittle ~20–40 %
                                // of the strength: 0.8–0.9) a rift path costs this much per km along old sutures / failed rifts (1 elsewhere): a real
                                // preference, but a mild one — at 0.45 a continent reopened the very same suture almost
                                // every time it broke (developer); over a long history about half the length of the rifts
                                // follows old weak lines (Phase 13, developer: "maybe 50%… not having it follow it perfectly
                                // will help make more interesting worlds"; 0.75 made it ~70 %; 0.9 → 0.8 with the
                                // crust's grain below, which the paths now also follow: ~50 %)
    riftCurveAmp: 0.9,          // the grain of the crust a rift follows (ops/rift-path.js): the cost of breaking ground × 1 ± this
    riftCurveKm: 1500,          // …swinging over about this distance (a rift bends)…
    riftJagAmp: 0.4,            // …plus ± this
    riftJagKm: 350,             // …over this (it is jagged). Uniform ground made every rift a straight cut: rectangular continents
                                // (developer); at ±0.5 over 1200 km a detour hardly paid for its length — the cuts stayed straight
    riftMinArmKm: 400,          // an arm must reach the coast at least this far from the junction
    riftMinChordKm: 1500,       // the two ends of a rift must be at least this far apart: a rift crosses a landmass, it does not nick it
    riftTortuosityMax: 1.4,     // the rift's length may be at most this many times the distance between its ends (zig-zag, not meander)
    riftOverhangKm: 182,        // a rift may double back on itself by at most this much (never less than a cell): no promontories that jam as the halves part
    riftArmEndCoastKm: 19400,   // the cheapest coast cells, this much coast of them, are the candidate ends of a rift's arms
    riftCostSlack: 1.6,         // cuts costing up to this many times the cheapest are considered, for the stress across them
    riftStage: true,            // a rift stretches before it breaks up: the first riftBreakupKm of its opening is thinned continent, not
                                // ocean (step/rifting.js evolveRiftStages; lane pstress, stage 2)
    riftStageVolume: true,      // (lane crust, 1a) …and that thinned continent is the zone's own crust spread wider, not made: the margins
                                // thin as the opening widens, volume conserved (step/rifting.js stretchConserving)
    riftBreakupKm: 180,         // …this much: ~177 km of continental crustal extension across the Iberia–Newfoundland conjugate pair
                                // before breakup (Gómez-Romeu et al., EGU 2019 abstract; 135 km by fault heaves alone)
    riftByStress: true,         // WHERE a continent rifts is set by its stress field against its strength (field/rift-stress.js: junction
                                // and arms), not drawn at random and searched by cost (lane pstress, stage 2). When stays as below
    riftStressFloor: 0.05,      // a cut's stress (per 100 km; slab pull is 1: 3 × 10¹¹ N/m on forceUnitNPerM) counts as at least this: where nothing pulls the plate
                                // apart, the cheapest ground breaks (ops/rift-path.js)
    riftFailedArmKm: 1500,      // a failed arm reaches this far before it dies and stays as an aulacogen
    riftShoulderKm: 260,        // how far the uplifted flank of a rift reaches back from the line it opened along
    riftShoulderWorkKm: 70,     // the "work" recorded across that flank — the measure of how high the shoulders stand
    riftFailedShoulderShare: 0.5, // a failed arm's flanks are lifted too, this share as high (it stretched less before it stopped), and
                                // wear down as a rift's do; the arm itself stays a low trough (the Benue, Reelfoot and Rio Grande rifts)
    riftFailedArms: 2,          // how many arms fail at a junction (they strike out across ordinary ground, seeding NEW weak lines)
    riftPush: 0.6,              // a fresh rift pushes its two sides apart (uplifted rift shoulders), per 100 km of rift…
    riftPushMyr: 60,            // …fading to nothing over this long, by which time the ridge push of the young ocean has taken over
    // Scissor opening (developer: a rift "suddenly appear[s] across an entire continent all at once" — expected "a tear start
    // to happen on an edge of a continent and then see it spread — not always, but sometimes"). Most rifts propagate: the
    // South Atlantic unzipped from the south over ~20 Myr, the Red Sea and Gulf of Aden from the east, the Bay of Biscay and
    // the Woodlark basin open as wedges. The halves turn about a pole just beyond the tip of the propagating rift, so the
    // ocean opens as a wedge from one coast; as the tip runs along the rift the pole moves out past its far end and the
    // spreading becomes nearly parallel. Modelled as a pin between the halves that slides from riftHingeFrom to riftHingeTo
    // along the rift (0 its open end, 1 its far end, past 1 beyond the far coast) over riftHingeMyr, then lets go.
    riftScissorShare: 0.75,     // the share of rifts that unzip from one end (the rest open along their whole length at once)
    riftHingeMyr: 15,           // how long the tip takes to run the length of the rift
    riftHingeFrom: 0.75,        // where the pin starts (short of the far end: the far quarter is still whole)…
    riftHingeTo: 1.5,           // …and where it is when it lets go
    riftHingeLock: 30,          // its stiffness, per 10⁴ km² of land of the smaller half (basal drag under a continent is 5)
    riftHingeFade: 0.3,         // the last share of riftHingeMyr over which it loosens
    // The pace of breakups (developer: they came "way way too many … all at once", and the supercontinent sat through "a long
    // period of only erosion and 0 breakups" — "at most one major rifting event every 30 Myr, and closer to 50 … not more
    // than 150 [Myr] without one, and really closer to 100"; then: "the rules dont apply to the whole world, but to each
    // individual PIECE of continent … each piece has its own timer … This resets when they fit together … shouldnt FORCE
    // something to break apart if its too small … a limit globally … minimum at 10myrs"). Each piece's clock runs from when
    // it was born of a rift or welded together (plate.born):
    riftMinGapMyr: 30,          // it does not rift within this (a plume head arriving then erupts, but does not split it)…
    riftSpacingMyr: 50,         // …its chance coming back smoothly from there to full by this (a piece then rifts at ~50 Myr typically)…
    riftDueMyr: 90,             // …and growing once this has passed: × (1 + ((age − this) ÷ riftDueRampMyr)²) — × 3.25 at 120, × 10 at 150…
    riftDueRampMyr: 20,
    // (Retired 2026-11-09, Jackson: riftMaxGapMyr 150, a rift forced at that age, and riftGlobalGapMyr 10, the world rifting at
    // most once per 10 Myr and one a step. Upstream ee0a67b rules with no physical reading — rifts are local and Earth has
    // several under way at once; riftaudit §2.2: without them the supercontinent cycle survives on 3/3 seeds.)
    plumeRiftWaitMyr: 30,       // a plume head under a piece too young to rift (or a supercontinent still holding) splits it once it may,
                                // up to this long after the head arrived; its flood basalt erupts on arrival

    // ── The supercontinent cycle (Phase 13, step/supercontinent.js) ──
    // ── The swell's push (lane riftswell; step/forces.js swellPush) ──
    swellPush: true,            // the lithosphere over the mantle's swell carries its gravitational potential energy, and pushes away from
                                // its high centre: a body force −∇U, U = ρ̄ g L × the swell's height (the model's own: mantleSwellKm × the
                                // smoothed heat, terrain/sea-level.js). Nothing to set: L and ρ̄ are the column model's (riftLithKm 125 km, its
                                // crust and lid densities: ≈ 3.9 × 10¹² N/m per km of swell). Puts an insulated supercontinent's interior in
                                // tension (Coblentz, Richardson & Sandiford 1994, Tectonics 13: elevated continents stand in extension;
                                // Lithgow-Bertelloni & Silver 1998, Nature 395: the African superswell drives its plates). Off: no such load
    riftBandForce: true,        // (F2, with swellPush) a rift is judged by its whole band, not by the junction's peak: of the cuts searched
                                // (field/rift-stress.js stressJunctions now spreads their junctions over the landmass), the one whose
                                // F_drive = Σ σn·km (the stress normal to the cut, compression counting against) is greatest against
                                // F_R = Σ T·km (the strength along it) is taken (Buck 1991, JGR 96:20161: a rift runs through only where
                                // the band's driving force beats its integrated strength). When stays the dice's (step/rifting.js)
    riftHeatFloor: 0.05,        // a continent's rift chance × (floor + gain × heat^power), heat = the mean mantle heat under its
    riftHeatGain: 5,            // land (step/hotspots.js): on mantle it has only just drifted onto it hardly rifts, over the mantle
    riftHeatPower: 5,           // a supercontinent has insulated for 100+ Myr readily — so a breakup comes in a burst, then quiets
                                // (heat 1 → ×5, 0.9 → ×3, 0.8 → ×1.7, 0.6 → ×0.44); a plume head splits a continent likewise
    riftHeatTension: 0.3,       // …and its tension is at least this × the heat (the swell beneath stretches it; a supercontinent with
                                // no boundaries left pulling at it — every plate welded into one — otherwise never rifted: the world froze)
    riftTenureHotMyr: 5,        // …and over fully insulated mantle the tenure (riftTenureMyr) of a rift's pieces shrinks to this: those of
                                // a breakup still on its hot mantle may rift again soon (Pangaea: the Central Atlantic ~200 Ma, East
                                // from West Gondwana ~180 Ma)
    mantleOutflow: 0.025,       // the mantle's flow drags on continents' roots, per 10⁴ km² of continental crust: outward from the
                                // upwelling under the last supercontinent, × the heat still under it, × sin 2θ (none at the centre
                                // or 90° off it) — it spreads the pieces of a breakup, and fades as that mantle cools…
    mantleInflow: 0.015,        // …and toward the downwelling set 90° from it (orthoversion): where the next one gathers — only
                                // while the pieces gather (the cycle's clock, below; not while a supercontinent holds: it sits
                                // still over its own mantle and heats it)…
    mantleInflowPackKm: 1500,   // …at full strength until this near it, so the pieces press together there (a pull that faded
                                // toward the downwelling left them touching through thin strips: a chain, not one mass)
    superShare: 0.7,            // the largest landmass holding this share of the continental crust is a supercontinent…
    dispersedShare: 0.6,        // …and once, after its breakup, the largest holds less than this, it has broken up (a split in
                                // two — a Laurasia and a Gondwana — is a breakup: the pieces may gather again from there)
    cycleHoldMyr: 30,           // either must hold this long to count (two continents that touch and part again are not one)
    cycleNeckKm: 800,           // land joined only by a neck narrower than this counts as two landmasses (developer: a
                                // supercontinent is one cohesive mass, not continents strung together by strips)
    cycleGatherHeat: 0.45,      // the pieces start to GATHER once the mantle the last supercontinent warmed has cooled to this
                                // (cycle.upHeat, 0–1): while it is hot its upwelling pushes them apart; as it cools the ring of
                                // downwelling slabs that surrounded it takes over (Gurnis 1988, Zhong et al. 2007: the cycle's
                                // pace is the mantle's, not a clock — no period is drawn). How long that takes comes from
                                // mantleInsulateMyr / mantleCoolMyr and from how far the pieces drift; Earth's cycle is ~600 ±
                                // 100 Myr (Li et al. 2019; check-phase13 reports it)
    cycleRampMyr: 30,           // (the pull comes on over this long)
    dispersalRepulsion: 0.3,    // until then each continent is pushed away from the others near it, per 10⁴ km² of continent,
                                // (0.2 when rifts came in bursts that broke up pieces gathered too soon; with breakups paced —
                                // riftMinGapMyr — the push keeps them apart instead: the next supercontinent at ~560–730 Myr)
    dispersalRepulsionKm: 2000, // × (1 − distance to the other's edge ÷ this)², × its share of the land (twice, at most 1)
    dispersalMaxShare: 0.45,    // while they disperse, the plates of a landmass that holds more than this share of the continental
    dispersalRiftBoost: 10,     // crust (each 15 %+ of it) rift this many times more readily, after riftTenureHotMyr (gathered too soon)
    superHoldMarginKm: 500,     // until it first rifts, a supercontinent is held together over its own footprint: its disc and this
    superTenureMyr: 100,        // a supercontinent just counted holds this long before it rifts on its own (Pangaea held ~100–150
                                // Myr; as soon as it was counted — often not yet welded — it came apart in 40–80); continents
                                // outside it rift as ever
    disperseFounderFactor: 0.15, // while they disperse, the chance that a margin of an ocean opened since the breakup founders × this
                                // (closing those oceans is how the pieces gather: at the usual rate they closed by ~300 Myr)
    gatherRiftFactor: 0.2,      // while they gather, the rift chance of the landmass they gather into × this: over the downwelling
                                // the lithosphere is pressed together, not stretched (and a gathering that rifted apart again never
                                // finished); continents elsewhere rift as ever
    cycleCheckMyr: 10,          // how often the landmasses are counted
    cycleUpwellingKm: 2500,     // the upwelling's heat is the mean mantle heat within this of it

    // ── Choose your ending (tectonics/ending.js): a history may be asked to end in a stage of the cycle ──
    endingExtraMyr: 1000,       // it runs on at most this far past its length to reach it (a cycle is 300–700 Myr)
    endingQuietMyr: 30,         // "a supercontinent": …with no rift for this long (whole, not yet coming apart)
    endingBreakupMyr: [15, 60], // "breaking up": the first rift since it formed is this old (young seas, the pieces still close)
    endingDispersedShare: 0.45, // "dispersed": broken up, the largest landmass holding no more than this of the continental crust

    // ── Reserved for later phases: not read by the engine; kept so the numbers from the research survive ──
    // (maxPlates: 28 is gone, 2026-10-29: it had no source and the engine never read it. Plate count is a report against
    // Earth's range through time — check-phase6, 6b, 7b — with only a loose bug guard in 7b)
    reserved: {
        minPlateAreaKm2: 1.5e5,           // smaller plates are absorbed by a neighbour
        historyMyr: 600,                  // [WBP] 500–1000 Myr covers nearly all surviving geology
    },

    // ── The geological record (step/geology.js; ported from World Orogen, raguilar011095, GPL v3). Records only. ──
    // Cover is what the rivers' own books laid (basinFillKm, seaFillKm), so there are no rates by setting here: no shelf,
    // inland-sea, rift or foreland km/Myr, and no sea stand (lane litho, Jackson's ruling 4).
    geology: {
        records: true,              // keep it (false: none kept — the check that the tectonics never read it runs both ways)
        everyMyr: 4,                // the rivers' fill, the arcs and the settings looked at this often (the rivers drain every 4 Myr; the wear goes with the heights)
        // ── the zonal palaeoclimate: what a hollow or a sea lays by the latitude it lay at then (upstream's bands; sources in its
        // plans/V2_GEOLOGY_RESEARCH.md, not re-verified here) ──
        warmLat: [22, 32],          // warm-water carbonate: full equatorward of the first latitude, gone poleward of the second
        coolCarbonate: 0.25,        // cool-water carbonate's share, poleward of that (low production)
        aridLat: [12, 18, 32, 38],  // the arid belt: rising over the first two latitudes, falling over the last two
        wetLat: [8, 14, 34, 40, 58, 66],   // ever-wet tropics (gone over the first two); humid mid-latitudes (between the rest)
        coalShare: 0.12,            // coal in a wet belt's basin fill, at most
        coalByWetBelts: GEOLOGY.guideRules.coalByWetBelts,   // coal by the wet belts (science) or within 45° (her guide)
        saltShare: 0.4,             // salt in a restricted arid sea or hollow
        organicShare: 0.35,         // organic-rich mud in an enclosed warm sea, or a young rift's lake
        dissolvedShare: 0.2,        // the rivers' dissolved load in what they deliver (recalled: ~1/5 of denudation by mass, Gaillardet et al. 1999): a sea's carbonate, at most
        faciesMixKm: 0.5,           // the cover's make-up is that of about its top this many km
        // ── the settings ──
        riftBasinMyr: 40,           // a rift counts as a young basin this long (upstream's value, unverified)
        forelandKm: 300,            // a belt's front reaches this far over the plain from its outer edge (foredeeps 100–300 km wide)…
        forelandFlagKm: 190,        // …BELT_FRONT within this of it (upstream's 0.3 of its taper over forelandKm)
        forelandEdgeU: 0.8,         // …the edge where the belt's cross-section reaches this (0 at its front, 1 at its far edge)
        forelandDepthKm: 0.02,      // FORELAND: the history's own sunk basins (heights.js), from this far below the plain
        // ── the record of wear ──
        crestShare: 0.3,            // of a belt's crests worn away, this share is rock taken off the whole cell (crests cover a part of it)
        crustKm: 35,                // the continental crust's ordinary thickness: shortening that thickens it by x thickens its cover by x / this
        // ── the start world's past (seedGeology, a painted initial state: step/geology.js header) ──
        cratonExhumKm: [12, 28],    // a shield worn down this deep before history began (per craton)…
        beltExhumKm: [6, 16],       // …the older continental crust about the cratons (its Proterozoic mobile belts)
        platformCoverKm: 2.5,       // platform sediment over the old crust, at most (in its sags; over half of it)
        platformNoiseKm: 1500,      // the size of the sags and arches
        platformLowGain: 1,         // the sags lean to the start world's lowlands (1 − its swells' height, heights.js seedBaseRelief):
        platformLowMid: 0.9,        // the noise + this × (that − this)
    },
};

/**
 * The off-switch of every event mechanism that can be turned off, by name. A test scene that is about ONE thing turns the
 * rest off with onlyMechanisms(…) or mechanismsOff(…), so its checklist and its check script see that thing alone.
 * A NEW MECHANISM MUST ADD ITS OFF-SWITCH HERE — every older scene then leaves it out without being edited.
 */
export const MECHANISMS = Object.freeze({
    wings:          { wingGrowthCmYr: 0 },                                   // trench wings (step/wings.js)
    arcs:           { arcSlabDepthKm: 1e9 },                                 // island arcs (step/wings.js)
    rifts:          { riftRatePerMyr: 0 },                                   // continental rifting (step/rifting.js)
    plumes:         { plumeRatePerMyr: 0, hotspotInitialCount: 0 },          // mantle plumes, LIPs and tracks (step/hotspots.js)
    subductionInit: { subductionInitRatePerMyr: 0 },                         // passive margins foundering (step/subduction-init.js)
    marginFounder:  { marginFounderRatePerMyr: 0 },                          // margins inside a plate foundering: the ocean breaks away (step/subduction-init.js)
    founderAcross:  { founderAcross: false },                                // a plate failing across its open ocean under compression (step/subduction-init.js)
    trenchEstablish: { trenchEstablishKm: 0 },                               // a closing contact must earn its slab, and slabs detach (step/subduction-init.js establishes, step/boundaries.js)
    trenchPropagation: { founderPropagate: false },                          // trench ends running along strike, invading passive margins (step/subduction-init.js)
    backgroundRetires: { backgroundEndMyr: Infinity },                       // the pre-history ocean becomes plates (step/ocean-plates.js)
    oceanSplits:    { oceanSplitRatePerMyr: 0 },                             // big ocean plates split along a new ridge (step/ocean-plates.js)
    microplates:    { oceanPlateCaptureKm2: 0 },                             // small ocean plates captured by a neighbour (step/ocean-plates.js)
    flatSlabs:      { flatSlabMaxAgeMyr: 0 },                                // flat slabs → Laramide belts (step/boundaries.js)
    backArcs:       { backArcRatePerMyr: 0 },                                // slab rollback → back-arc seas (step/backarc.js)
    marginIsles:    { marginIsleRatePerMyr: 0, marginIsleGrowKmPerMyr: 0 },  // fore-arc islands (step/margin-isles.js)
    marginErosion:  { marginErosionKmPerMyr: 0 },                            // erosive margins (step/margin-isles.js)
    sedimentSubduction: { sedimentSubductionShare: 0 },
    seaFill: { enclosedSeaFill: false },                                       // enclosed seas filled by their rivers (step/sea-fill.js)                      // trench sediment down the subduction channel (step/sediment-subduction.js)
    underthrust:    { underthrustShare: 0 },                                 // continental underthrusting at collisions (step/collision.js)
    arcRecycling:   { arcAccreteThickKm: 0 },                                // thin (young) arcs go down instead of accreting (step/collision.js)
    arcMaturation:  { arcContinentKmPerMyr: 0 },                             // arcs welded onto a continent become continent (step/arc-maturation.js)
    mantleHeatRifts: { riftHeatGain: 0, riftHeatFloor: 1, dispersalRiftBoost: 1, riftHeatTension: 0 },                  // continents rift readily over mantle they have insulated (step/rifting.js)
    mantleFlow:     { mantleOutflow: 0, mantleInflow: 0, dispersalRepulsion: 0, disperseFounderFactor: 1 }, // the mantle's flow drags continents apart and together again (step/supercontinent.js)
});

/** Config overrides that switch off the named mechanisms (keys of MECHANISMS). */
export function mechanismsOff(...names) {
    for (const n of names) if (!MECHANISMS[n]) throw new Error(`unknown mechanism: ${n}`);
    return Object.assign({}, ...names.map(n => MECHANISMS[n]));
}

/** Config overrides that switch off every mechanism except the named ones. */
export function onlyMechanisms(...keep) {
    for (const n of keep) if (!MECHANISMS[n]) throw new Error(`unknown mechanism: ${n}`);
    return mechanismsOff(...Object.keys(MECHANISMS).filter(n => !keep.includes(n)));
}

/**
 * Config overrides that switch the named mechanisms back ON at their default settings — for a scene built on another
 * scene whose build() switched them off.
 */
export function mechanismsOn(...names) {
    for (const n of names) if (!MECHANISMS[n]) throw new Error(`unknown mechanism: ${n}`);
    return Object.fromEntries(names.flatMap(n => Object.keys(MECHANISMS[n]).map(k => [k, TECTONICS[k]])));
}
