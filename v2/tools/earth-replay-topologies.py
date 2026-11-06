"""Earth replay study, Q2/Q3 probe: resolve Müller et al. 2019's plate topologies through time with pygplates and measure
what a prescribed-kinematics replay must absorb — how many plates there are at each time, how big, and how often a plate
is born or ends (plate ids appearing / vanishing between samples). Optionally writes, per sample time, the plate id under
each point of a Fibonacci grid (the mapping a replay would rasterise onto the model's mesh).
  data/venv/bin/python -I v2/tools/earth-replay-topologies.py [--step 10] [--n 20000] [--out DIR]
(venv: tuning/earth/fetch-earth-replay.sh's last comment.) Report-only; nothing in the model reads it."""
import sys, os, math, json, argparse
import pygplates

ap = argparse.ArgumentParser()
ap.add_argument('--step', type=float, default=10)
ap.add_argument('--until', type=float, default=250)
ap.add_argument('--n', type=int, default=0)
ap.add_argument('--out', default='')
a = ap.parse_args()

RAW = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../tuning/earth/data/raw/muller2019')
rot = pygplates.RotationModel(os.path.join(RAW, 'Rotations/Rotations/Muller_etal_2019_CombinedRotations.rot'))
topo_dir = os.path.join(RAW, 'Topologies')
topo_files = [os.path.join(r, f) for r, _, fs in os.walk(topo_dir) for f in fs if f.endswith(('.gpml', '.gpmlz'))]
# (pygplates 1.0's TopologicalModel; the older resolve_topologies() segfaults on this file with the PyPI arm64 build)
model = pygplates.TopologicalModel(topo_files, rot)
R_KM = 6371.0
EARTH_KM2 = 4 * math.pi * R_KM ** 2

pts = None
if a.n:
    g = math.pi * (3 - math.sqrt(5))
    pts = []
    for i in range(a.n):
        z = 1 - (2 * i + 1) / a.n; r = math.sqrt(1 - z * z)
        pts.append(pygplates.PointOnSphere(r * math.cos(g * i), r * math.sin(g * i), z))

times = [t for t in [round(k * a.step, 6) for k in range(int(a.until / a.step) + 1)]]
prev = None
print(' Ma | plates | networks | ≥1% Earth | largest % | median km² | ids only at this (older) time = born going forward | ids only at the younger = ended going forward | grid coverage %')
for t in times:
    rt = model.topological_snapshot(t).get_resolved_topologies()
    plates = [x for x in rt if isinstance(x, pygplates.ResolvedTopologicalBoundary)]
    networks = [x for x in rt if isinstance(x, pygplates.ResolvedTopologicalNetwork)]
    areas = {}
    for p in plates:
        pid = p.get_feature().get_reconstruction_plate_id()
        areas[pid] = areas.get(pid, 0) + p.get_resolved_boundary().get_area() * R_KM ** 2
    ids = set(areas)
    born = len(ids - prev) if prev is not None else 0
    ended = len(prev - ids) if prev is not None else 0
    prev = ids
    s = sorted(areas.values())
    big = sum(1 for v in s if v >= 0.01 * EARTH_KM2)
    cov = ''
    if pts is not None:
        owner = [0] * len(pts)
        for p in plates:
            poly = p.get_resolved_boundary(); pid = p.get_feature().get_reconstruction_plate_id()
            for i, q in enumerate(pts):
                if not owner[i] and poly.is_point_in_polygon(q): owner[i] = pid
        cov = '%.1f' % (100 * sum(1 for o in owner if o) / len(owner))
        if a.out:
            os.makedirs(a.out, exist_ok=True)
            json.dump({'time': t, 'n': a.n, 'plate': owner}, open(os.path.join(a.out, 'plates-%g.json' % t), 'w'))
    print('%3g | %6d | %8d | %9d | %9.1f | %10.3g | %15d | %16d | %s' % (t, len(ids), len(networks), big,
          100 * s[-1] / EARTH_KM2 if s else 0, s[len(s) // 2] if s else 0, born, ended, cov))
    sys.stdout.flush()
