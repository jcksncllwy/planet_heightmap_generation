// The FSM wiring's measuring hook (lane fsm-wire): `node --import ./v2/tools/fsm-register.mjs <any tool>` prints one FSM line per
// finish: the water pass's time and census, and how far it moved the ground. No library file changes for it.
import { register } from 'node:module';
register('./fsm-hooks.mjs', import.meta.url);
