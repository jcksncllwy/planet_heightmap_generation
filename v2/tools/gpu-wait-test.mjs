// The GPU's waits fail loudly (js/gpu/gpu-device.js gpuWait, lane histprof): a wait that never settles throws within its
// limit, naming its stage; a device lost under a pending wait throws at once, naming the stage and the loss; a lost device
// fails the next wait too, and nothing is retried. On a real Dawn device (a loss is device.destroy(), the one Dawn can make
// on demand; a driver reset or a GPU taken by another program reaches device.lost the same way).
//   node v2/tools/gpu-wait-test.mjs
// under Dawn (v2/tools/gpu-harness: `npm ci` there first). Exit 1 on a case that does not behave.
import { gpu } from './gpu-harness/dawn.mjs';
import { openDevice, gpuWait, readBack } from '../js/gpu/gpu-device.js';

let failed = 0;
const say = (ok, label, detail) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${detail}`); if (!ok) failed++; };
const never = () => new Promise(() => {});
const outcome = async (p) => { const t = performance.now(); try { await p; return { ok: true, ms: performance.now() - t }; } catch (e) { return { ok: false, msg: e.message, ms: performance.now() - t }; } };

{   // a wait that never settles: thrown at its limit, named
    const { device } = await openDevice(gpu);
    const r = await outcome(gpuWait(device, never(), 'a test stage', 300));
    say(!r.ok && /GPU hang: a test stage did not finish in 0\.3 s/.test(r.msg) && r.ms >= 290 && r.ms < 2000, 'a wait that never settles throws at its limit', r.ok ? 'it settled' : `${r.ms.toFixed(0)} ms: ${r.msg}`);
    // a wait that settles: its value, and its timer gone (else the process would linger a whole limit after its last wait)
    const buf = device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(buf, 0, Float32Array.of(1, 2, 3, 4));
    const v = await readBack(device, buf);
    say(v.join() === '1,2,3,4', 'a wait that settles gives its value', v.join());
    // the device lost under a pending wait: thrown at once, not at the limit
    const pending = outcome(gpuWait(device, never(), 'the sweeps', 60000));
    setTimeout(() => device.destroy(), 50);
    const r2 = await pending;
    say(!r2.ok && /GPU device lost during the sweeps \(destroyed/.test(r2.msg) && r2.ms < 5000, 'a device lost under a wait throws at once', r2.ok ? 'it settled' : `${r2.ms.toFixed(0)} ms: ${r2.msg}`);
    // …and the next wait on it fails too: no silent retry on a dead device
    const r3 = await outcome(readBack(device, buf));
    say(!r3.ok && r3.ms < 5000, 'the lost device\'s next wait fails', r3.ok ? 'it settled' : `${r3.ms.toFixed(0)} ms: ${r3.msg}`);
}
console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);
