"""Earth replay precompute: the Müller et al. 2019 plate id under every sim-mesh cell, for each Myr from 0 to 250 Ma.
  node v2/tools/earth-replay-mesh.mjs                      # once: dumps the mesh cell centres
  tuning/earth/data/venv/bin/python -I v2/tools/earth-replay-plates.py [--cells 40000] [--until 250]
Writes tuning/earth/data/plates-<cells>.u16 (little-endian Uint16, time-major: row t = Ma t, one id per cell; 0 = no
topology there) and plates-<cells>.json (shape, and per time the cells that fell in a deforming network or nowhere).
Uses TopologicalModel + get_point_locations — never resolve_topologies(), which segfaults on this arm64 build.
A cell in a rigid plate takes that plate's id. A cell in a deforming network takes the id of the rigid block it sits in,
or else the network's own plate id (Müller 2019 gives each network the id of the plate it is reference-framed to)."""
import os, sys, json, array, math, argparse
import pygplates

ap = argparse.ArgumentParser()
ap.add_argument('--cells', type=int, default=40000)
ap.add_argument('--until', type=int, default=250)
a = ap.parse_args()

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, '../../tuning/earth/data')
RAW = os.path.join(DATA, 'raw/muller2019')
rot = pygplates.RotationModel(os.path.join(RAW, 'Rotations/Rotations/Muller_etal_2019_CombinedRotations.rot'))
topo_files = sorted(os.path.join(r, f) for r, _, fs in os.walk(os.path.join(RAW, 'Topologies')) for f in fs if f.endswith(('.gpml', '.gpmlz')))
model = pygplates.TopologicalModel(topo_files, rot)

xyz = array.array('d'); xyz.frombytes(open(os.path.join(DATA, 'mesh-%d.f64' % a.cells), 'rb').read())
pts = [pygplates.PointOnSphere(xyz[i], xyz[i + 1], xyz[i + 2], True) for i in range(0, len(xyz), 3)]
n = len(pts)

out = array.array('H')
meta = {'cells': n, 'times': a.until + 1, 'network': {}, 'none': {}}
for t in range(a.until + 1):
    row = array.array('H', bytes(2 * n)); net = none = 0
    for i, loc in enumerate(model.topological_snapshot(t).get_point_locations(pts)):
        if loc.located_in_resolved_boundary():
            row[i] = loc.located_in_resolved_boundary().get_feature().get_reconstruction_plate_id()
        elif loc.located_in_resolved_network():
            blk = loc.located_in_resolved_network_rigid_block()
            row[i] = (blk.get_feature() if blk and hasattr(blk, 'get_feature') else loc.located_in_resolved_network().get_feature()).get_reconstruction_plate_id()
            net += 1
        else:
            none += 1
    out.extend(row)
    meta['network'][t] = net; meta['none'][t] = none
    if t % 25 == 0: print('%3d Ma: %d network cells, %d unlocated' % (t, net, none)); sys.stdout.flush()
if sys.byteorder != 'little': out.byteswap()
out.tofile(open(os.path.join(DATA, 'plates-%d.u16' % a.cells), 'wb'))
json.dump(meta, open(os.path.join(DATA, 'plates-%d.json' % a.cells), 'w'))
print('wrote plates-%d.u16: %d times × %d cells = %.1f MB' % (a.cells, a.until + 1, n, len(out) * 2 / 1e6))
