// The sites lane iceage B2 measures the climate at (2026-11-25, the supervisor's two measurements before B2 closes): where
// Earth's last inception began (the plateaus of Baffin, Labrador and Keewatin, ~0.3–1.5 km: Ives 1957's "instantaneous
// glacierization"; Clark et al. 1999) and High Asia's ranges (the Tibetan plateau carried no ice sheet: Owen & Dortch 2014).
// Shared by tools/iceage-inception.mjs (the climate, on Chroma's GPU) and tools/iceage-sites-cru.mjs (CRU CL 2.0, the
// observed side: tuning/climate/fetch-cru.sh). Each site: the land within KM of its centre.
export const SITE_KM = 150;
export const SITES = [
    { name: 'Baffin, Penny highlands', lat: 67.0, lon: -65.5, group: 'inception' },
    { name: 'Baffin, Barnes plateau', lat: 70.0, lon: -73.5, group: 'inception' },
    { name: 'Labrador, Torngat', lat: 58.8, lon: -63.7, group: 'inception' },
    { name: 'Labrador–Québec plateau', lat: 54.8, lon: -66.8, group: 'inception' },
    { name: 'Keewatin', lat: 64.0, lon: -96.0, group: 'inception' },
    { name: 'Karakoram', lat: 35.8, lon: 76.5, group: 'high asia' },
    { name: 'West Kunlun', lat: 35.5, lon: 80.0, group: 'high asia' },
    { name: 'Tanggula, central Tibet', lat: 33.0, lon: 91.0, group: 'high asia' },
    { name: 'Nyainqêntanglha, SE Tibet', lat: 30.3, lon: 90.5, group: 'high asia' },
];
/** Great-circle km between two points (°). */
export function gcKm(a1, o1, a2, o2) {
    const r = Math.PI / 180, s = Math.sin((a2 - a1) * r / 2) ** 2 + Math.cos(a1 * r) * Math.cos(a2 * r) * Math.sin((o2 - o1) * r / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(s)));
}
