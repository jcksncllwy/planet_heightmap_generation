import fs from 'node:fs'; import v8 from 'node:v8';
import Delaunator from 'delaunator'; import { setDelaunator } from '../../js/sphere-mesh.js';
import { buildSimMesh } from '../js/core/sim-mesh.js';
setDelaunator(Delaunator);
const f = v8.deserialize(fs.readFileSync(process.argv[2])).frame, mesh = buildSimMesh(40000, 12345);
const ll = w => { const x = mesh.xyz[3*w], y = mesh.xyz[3*w+1], z = mesh.xyz[3*w+2]; return [Math.asin(z)*180/Math.PI, Math.atan2(y, x)*180/Math.PI]; };
// the young ocean component near 4.3,121.6 between 98 and 144
const young = w => f.owner[w] >= 0 && f.type[w] === 0 && f.time - f.formedAt[w] < 5;
const [LA, LO] = (process.argv[3]||'4.3,121.6').split(',').map(Number); let best=-1, bd=1e9; for (let w=0; w<mesh.numCells; w++){ if(!young(w)) continue; const [la,lo]=ll(w); const d=Math.hypot(la-LA, lo-LO); if(d<bd){bd=d;best=w;} }
console.log('nearest young ocean', best, ll(best), bd.toFixed(2));
const comp=[best], seen=new Set(comp); for(let i=0;i<comp.length;i++) for(let k=mesh.adjOffset[comp[i]];k<mesh.adjOffset[comp[i]+1];k++){const nb=mesh.adjList[k]; if(!seen.has(nb)&&young(nb)){seen.add(nb);comp.push(nb);}}
const owners={}, ring={}; for(const w of comp){ owners[f.owner[w]]=(owners[f.owner[w]]||0)+1; for(let k=mesh.adjOffset[w];k<mesh.adjOffset[w+1];k++){const nb=mesh.adjList[k]; if(seen.has(nb)) continue; const key=`${f.owner[nb]}:${['O','C','K','A'][f.type[nb]]??f.type[nb]}`; ring[key]=(ring[key]||0)+1;}}
console.log('young comp cells', comp.length, 'owners', owners); console.log('ring', ring);
const lats=comp.map(w=>ll(w)); console.log('extent lat', Math.min(...lats.map(x=>x[0])).toFixed(1), Math.max(...lats.map(x=>x[0])).toFixed(1), 'lon', Math.min(...lats.map(x=>x[1])).toFixed(1), Math.max(...lats.map(x=>x[1])).toFixed(1));
