// The analogue library's contract (ecodesign §7; the analogue lane L5). The shared keys (js/ecology/analogues/keys.js) are the
// vocabulary the detail pass and the cards agree on: every list frozen, its keys unique and well-formed, so a typo can't make
// a second spelling of a habitat that no card answers to.
// Usage: node v2/tools/check-analogues.mjs

import { check, section, finish } from './lib/check-kit.mjs';
import * as K from '../js/ecology/analogues/keys.js';

section('the shared keys');
const lists = { LAND_HABITATS: K.LAND_HABITATS, AZONAL_HABITATS: K.AZONAL_HABITATS, SEA_HABITATS: K.SEA_HABITATS,
    FRESH_HABITATS: K.FRESH_HABITATS, REALMS: K.REALMS, GRADES: K.GRADES, ROLES: K.ROLES, ISOLATION: K.ISOLATION };
for (const [name, list] of Object.entries(lists)) {
    check(`${name} is frozen and non-empty`, Object.isFrozen(list) && list.length > 0, `${list.length} keys`);
    const dup = list.filter((k, i) => list.indexOf(k) !== i);
    check(`${name} has no duplicate key`, dup.length === 0, dup.join(', '));
    const bad = list.filter(k => !/^[a-z][a-zA-Z0-9-]*$/.test(k));
    check(`${name} keys are plain words (kebab or camel)`, bad.length === 0, bad.join(', '));
}
const habitats = [...K.LAND_HABITATS, ...K.AZONAL_HABITATS, ...K.SEA_HABITATS, ...K.FRESH_HABITATS];
const shared = habitats.filter((k, i) => habitats.indexOf(k) !== i);
check('no habitat key is in two habitat lists', shared.length === 0, shared.join(', '));
const sizes = Object.values(K.SIZE_CLASSES);
check('size classes tile 0 kg → ∞ without gaps', Object.isFrozen(K.SIZE_CLASSES) && sizes[0][0] === 0 && sizes.at(-1)[1] === Infinity
    && sizes.every((r, i) => i === 0 || r[0] === sizes[i - 1][1]));
finish('Analogues');
