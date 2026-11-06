"""Earth replay reference poses (pygplates's own composition of the Müller 2019 rotation tree), for the harness check to hold
the JS rotation reader and the start world's poses against. Writes tuning/earth/data/poses-<t0>.json:
  { t0, times, poses: { plateId: { t: [w, x, y, z] } } } — the unit quaternion that carries a plate from its t₀ position to its
position at t (mantle frame, right-handed). Plates: every id in the rotation file with a rotation at t₀.
  tuning/earth/data/venv/bin/python -I v2/tools/earth-replay-poses.py [--t0 100] [--times 99 95 90 …]"""
import os, json, math, argparse
import pygplates

ap = argparse.ArgumentParser()
ap.add_argument('--t0', type=float, nargs='+', default=[100])
ap.add_argument('--down', type=float, nargs='+', default=[1, 5, 10, 20, 50])   # sample times are t₀ − each (≥ 0)
a = ap.parse_args()
DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../tuning/earth/data')
rot = pygplates.RotationModel(os.path.join(DATA, 'raw/muller2019/Rotations/Rotations/Muller_etal_2019_CombinedRotations.rot'))
ids = set()
for line in open(os.path.join(DATA, 'raw/muller2019/Rotations/Rotations/Muller_etal_2019_CombinedRotations.rot')):
    f = line.split('!')[0].split()
    if len(f) >= 6 and f[0] != '999': ids.add(int(f[0]))

def quat(fr):
    if fr.represents_identity_rotation(): return [1, 0, 0, 0]
    pole, ang = fr.get_euler_pole_and_angle()
    x, y, z = pole.to_xyz(); s = math.sin(ang / 2)
    return [math.cos(ang / 2), x * s, y * s, z * s]

for t0 in a.t0:
    times = [t0 - d for d in a.down if t0 - d >= 0]
    poses = {}
    for pid in sorted(ids):
        try: rot.get_rotation(t0, pid)
        except Exception: continue
        poses[pid] = {}
        for t in times:
            try: poses[pid][str(t)] = quat(rot.get_rotation(t, pid, t0))
            except Exception: pass
    json.dump({'t0': t0, 'times': times, 'poses': poses}, open(os.path.join(DATA, 'poses-%g.json' % t0), 'w'))
    print('t0 %g: %d plates × %d times' % (t0, len(poses), len(times)))
