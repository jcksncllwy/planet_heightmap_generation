// gpu-erode.mjs with its probe hook loaded first, as one script: sim-slots sends only `node <absolute script> …` to chroma
// (an --import before the script makes the job not portable, and it runs here). Same arguments as gpu-erode.mjs.
await import('./gpu-harness/probe-hook.mjs');
await import('./gpu-erode.mjs');
