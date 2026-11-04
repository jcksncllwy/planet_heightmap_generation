#!/bin/bash
# The FSM study's runs, one at a time, on Upwell: `bash v2/tools/fsm-matrix.sh <out dir> [640|2500]`. Each is erode-study under the loader.
OUT=$1; WHICH=${2:-all}; cd "$(dirname "$0")/../.."
DESIGN='{"at":"both","polishMyr":0.3,"polishSteps":6,"bury":true,"rebound":0.82,"playaYears":1,"delta":true,"ladder":[{"cells":160000,"timeMyr":0.5,"steps":10},{"cells":640000,"timeMyr":0.2,"steps":4},{"timeMyr":0.1,"steps":2}]}'
one() { # seed time cells fsm(0/1) erode(0/1)
    local name="s$1-c$3-f$4-e$5"; [ -s "$OUT/$name.txt" ] && grep -q '^RESULT' "$OUT/$name.txt" && return
    local args=(--seed "$1" --time "$2" --cells "$3" --label "$name"); [ "$5" = 1 ] && args+=(--erode "$DESIGN")
    uptime > "$OUT/$name.load"
    if [ "$4" = 1 ]; then export FSM=1; else unset FSM; fi
    SIM_REMOTE=0 /usr/bin/time -l node --import ./v2/tools/fsm-register.mjs v2/tools/erode-study.mjs "${args[@]}" > "$OUT/$name.txt" 2> "$OUT/$name.err"
    uptime >> "$OUT/$name.load"
}
if [ "$WHICH" != 2500 ]; then one 831576 310 640000 0 0; one 831576 310 640000 1 0; fi
if [ "$WHICH" != 640 ]; then
for f in 0 1; do one 831576 310 2500000 $f 0; done
for f in 0 1; do one 831576 310 2500000 $f 1; done
for s in "626225 300" "12345 300"; do for e in 0 1; do for f in 0 1; do one $s 2500000 $f $e; done; done; done
fi
