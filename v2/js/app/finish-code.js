// The hash of the finish code this page's finish worker loaded — null here, as committed and as any static host serves it.
// The local dev server (tuning/dev-server.mjs) serves this file with the hash written in, worked out from the very files
// it serves at that moment (tools/lib/finish-cache.mjs finishCodeHash: finish/finish-worker.js and all it imports). The
// finish worker imports it when it starts, alongside the code it runs, so a finished moment is filed under the code that
// made it (app/finish-key.js). Null: the finish cache is not used (the public site).
export const FINISH_CODE = null;
