// The hash of the history code this page loaded — null here, as committed and as any static host serves it. The local
// dev server (tuning/dev-server.mjs) serves this file with the hash written in, worked out from the very files it serves
// at that moment (tools/lib/history-cache.mjs historyCodeHash). The history worker imports it when it starts, alongside
// the code it runs, so the hash is that of the code the worker loaded — a tab opened before an edit, whose worker starts
// after it, files its history under the code it actually ran. Null: the history is not saved (the public site).
export const HISTORY_CODE = null;
