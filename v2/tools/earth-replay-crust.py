"""Earth replay precompute, t₀ side: what kind of crust lies under every sim-mesh cell at the start time t₀.
  tuning/earth/data/venv/bin/python -I v2/tools/earth-replay-crust.py [--cells 40000] [--t0 0 65 100 250]
Needs the plate table (earth-replay-plates.py). Each polygon is carried to t₀ by its OWN plate id (the topologies use coarser ids
than the polygons) and tested against the mesh cells there; only polygons whose valid time covers t₀ count. Classes:
  1 CONTINENT  Müller 2019 continental polygons
  3 ARC        Müller 2019 static polygons of type IslandArc
  2 CRATON     a CONTINENT cell inside a Merdith 2021 `Cratons` feature of type Craton, or named *craton*/*shield*
  0 OCEAN      everything else (its age comes from the t₀ age grid, read in JS)
Also marks the TRENCH cells: cells of the overriding plate of a topological SubductionZone sub-segment, within one cell edge of it
(trench-<cells>-<t0>.u8, 1 = trench). Writes tuning/earth/data/crust-<cells>-<t0>.u8. Inputs are t₀ reconstructions only: no present-day topography, crust model or
climate. (The Cratons layer is a mixed bag of basement terranes in Merdith's frame, not a craton map: the filter keeps ~13 Mkm²
of the ~50 Mkm² Earth has, so cratons are under-counted: see the README section.)"""
import os, re, sys, array, argparse, math
import pygplates

ap = argparse.ArgumentParser()
ap.add_argument('--cells', type=int, default=40000)
ap.add_argument('--t0', type=float, nargs='+', default=[0, 65, 100, 250])
a = ap.parse_args()

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../tuning/earth/data')
RAW = os.path.join(DATA, 'raw')
M19 = os.path.join(RAW, 'muller2019')
EDGE_RAD = math.sqrt(8 * math.pi / (math.sqrt(3) * a.cells))      # the mesh's cell spacing (core/sim-mesh.js meshEdgeKm / radius)
rot = pygplates.RotationModel(os.path.join(M19, 'Rotations/Rotations/Muller_etal_2019_CombinedRotations.rot'))

def _recon(feats, t):
    out = []
    pygplates.reconstruct(feats, rot, out, t)
    return out

def alive(f, t):
    begin, end = f.get_valid_time()
    return begin >= t >= end

def polys(features, t):
    return [(f.get_reconstruction_plate_id(), g) for f in features if alive(f, t) for g in f.get_geometries()]

continents = list(pygplates.FeatureCollection(os.path.join(M19, 'ContinentalPolygons/ContinentalPolygons/Global_PresentDay_ContPolygons_2019_v1.shp')))
static = list(pygplates.FeatureCollection(os.path.join(M19, 'StaticPolygons/StaticPolygons/Muller_etal_2019_Global_StaticPlatePolygons.gpmlz')))
arcs = [f for f in static if str(f.get_feature_type()) == 'gpml:IslandArc']
cratons = [f for f in pygplates.FeatureCollection(os.path.join(RAW, 'merdith2021/Cratons/Cratons/shapes_cratons_Merdith_etal.gpml'))
           if str(f.get_feature_type()) == 'gpml:Craton' or re.search(r'craton|shield', f.get_name() or '', re.I)]

xyz = array.array('d'); xyz.frombytes(open(os.path.join(DATA, 'mesh-%d.f64' % a.cells), 'rb').read())
pts = [pygplates.PointOnSphere(xyz[i], xyz[i + 1], xyz[i + 2], True) for i in range(0, len(xyz), 3)]
n = len(pts)
table = array.array('H'); table.frombytes(open(os.path.join(DATA, 'plates-%d.u16' % a.cells), 'rb').read())
if sys.byteorder != 'little': table.byteswap()

for t0 in a.t0:
    ids = table[int(t0) * n:(int(t0) + 1) * n]
    cont, arc, crat = polys(continents, t0), polys(arcs, t0), [g for _, g in polys(cratons, t0)]
    topo_files = [os.path.join(r, f) for r, _, fs in os.walk(os.path.join(M19, 'Topologies')) for f in fs if f.endswith(('.gpml', '.gpmlz'))]
    snap = pygplates.TopologicalModel(topo_files, rot).topological_snapshot(t0)         # (never resolve_topologies(): it segfaults here)
    subd = {}                                                # overriding plate id → its subduction-zone polylines at t₀
    for sec in snap.get_resolved_topological_sections():
        if sec.get_topological_section_feature().get_feature_type() != pygplates.FeatureType.gpml_subduction_zone: continue
        for ss in sec.get_shared_sub_segments():
            over = ss.get_overriding_plate()
            if over: subd.setdefault(over.get_feature().get_reconstruction_plate_id(), []).append(ss.get_resolved_geometry())
    trench = array.array('B', bytes(n))
    for i, p in enumerate(pts):
        if any(pygplates.GeometryOnSphere.distance(p, g, EDGE_RAD) is not None for g in subd.get(ids[i], ())): trench[i] = 1
    def reconstructed(features):                             # [(plate id, polygon at t₀)], each by its own plate's rotation
        live = [f for f in features if alive(f, t0)]
        return [(r.get_feature().get_reconstruction_plate_id(), r.get_reconstructed_geometry()) for r in _recon(live, t0)]
    cont, arc = reconstructed(continents), reconstructed(arcs)
    crat = [g for _, g in polys(cratons, t0)]
    out = array.array('B', bytes(n))
    for i, p in enumerate(pts):
        if any(g.is_point_in_polygon(p) for _, g in arc): out[i] = 3
        else:
            hit = next((pid for pid, g in cont if g.is_point_in_polygon(p)), None)
            if hit is not None:
                q = rot.get_rotation(t0, hit).get_inverse() * p          # (its present-day place, for the craton layer)
                out[i] = 2 if any(g.is_point_in_polygon(q) for g in crat) else 1
    out.tofile(open(os.path.join(DATA, 'crust-%d-%g.u8' % (a.cells, t0)), 'wb'))
    trench.tofile(open(os.path.join(DATA, 'trench-%d-%g.u8' % (a.cells, t0)), 'wb'))
    print('t0 %g Ma: %d continent, %d craton, %d arc, %d trench of %d cells' % (t0, out.count(1), out.count(2), out.count(3), trench.count(1), n)); sys.stdout.flush()
