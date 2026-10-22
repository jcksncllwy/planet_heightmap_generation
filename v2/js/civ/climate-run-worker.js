// One run of the civ layer's climate ensemble (climate-var.js), so the People worker can run all five at once.
//
// Message in:  {xyz, z, ocean, forcing}   Message out: {rain} (mm/yr per cell) · {error}

import { ensembleRain, landOf } from './climate-var.js';

self.onmessage = ({ data }) => {
    try {
        const rain = ensembleRain({ xyz: data.xyz, z: data.z, land: landOf(data.ocean) }, data.forcing);
        self.postMessage({ rain }, [rain.buffer]);
    } catch (err) {
        self.postMessage({ error: err?.stack ?? String(err) });
    }
};
