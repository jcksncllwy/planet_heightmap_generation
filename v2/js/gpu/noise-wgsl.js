// Simplex noise in WGSL (gpuscan "Shared GPU infrastructure" 5): core/fast-noise.js's FastNoise.noise3D, operation for
// operation, in f32 — the same permutation from the same seed (its table uploaded, never re-made), the same skew, the same
// simplex choice and gradient. f32's step at the coordinates the finish uses (up to ~150: a 200 km texture at four times
// its frequency) is ~1e-5, so a value lands within ~1e-5 of the CPU's (a point on a simplex's face may take the next
// simplex: the noise is continuous across it, so the value still agrees to rounding). fbm3 is FastNoise.fbm(x, y, z, 3, 0.5).
// Several noises share one table buffer, each NOISE_TABLE u32 from its offset `t`: its permutation (512) and its gradient
// index (perm % 12, 512). (gpu/finish-paint.js keeps its own copy inside the Satellite pass's table; one noise, read from f32.)

/** u32 a noise's table takes: the permutation, then each entry's gradient (perm % 12). */
export const NOISE_TABLE = 1024;

/** A FastNoise's table, for the WGSL below: written into `into` at `at` (u32), or a new array. */
export function noiseTable(noise, into = new Uint32Array(NOISE_TABLE), at = 0) {
    for (let i = 0; i < 512; i++) { into[at + i] = noise.perm[i]; into[at + 512 + i] = noise.perm[i] % 12; }
    return into;
}

/** WGSL: noise3(x, y, z, t) and fbm3(x, y, z, t), reading the tables from the storage array named `table` (array<u32>). */
export const noiseWGSL = table => /* wgsl */`
const SX_GRAD = array<vec3f, 12>(vec3f(1, 1, 0), vec3f(-1, 1, 0), vec3f(1, -1, 0), vec3f(-1, -1, 0), vec3f(1, 0, 1), vec3f(-1, 0, 1),
    vec3f(1, 0, -1), vec3f(-1, 0, -1), vec3f(0, 1, 1), vec3f(0, -1, 1), vec3f(0, 1, -1), vec3f(0, -1, -1));
fn sxPerm(t: u32, i: i32) -> i32 { return i32(${table}[t + u32(i)]); }
fn sxCorner(d: vec3f, t: u32, gi: i32) -> f32 {
    var a = 0.6 - d.x * d.x - d.y * d.y - d.z * d.z;
    if (a <= 0.0) { return 0.0; }
    a *= a;
    let g = SX_GRAD[${table}[t + 512u + u32(gi)]];
    return a * a * (g.x * d.x + g.y * d.y + g.z * d.z);
}
fn noise3(x: f32, y: f32, z: f32, t: u32) -> f32 {
    let F = 1.0 / 3.0; let H = 1.0 / 6.0; let s = (x + y + z) * F;
    let i = floor(x + s); let j = floor(y + s); let k = floor(z + s);
    let u = (i + j + k) * H; let x0 = x - i + u; let y0 = y - j + u; let z0 = z - k + u;
    var o1 = vec3i(0, 0, 0); var o2 = vec3i(0, 0, 0);
    if (x0 >= y0) {
        if (y0 >= z0) { o1 = vec3i(1, 0, 0); o2 = vec3i(1, 1, 0); } else if (x0 >= z0) { o1 = vec3i(1, 0, 0); o2 = vec3i(1, 0, 1); } else { o1 = vec3i(0, 0, 1); o2 = vec3i(1, 0, 1); }
    } else {
        if (y0 < z0) { o1 = vec3i(0, 0, 1); o2 = vec3i(0, 1, 1); } else if (x0 < z0) { o1 = vec3i(0, 1, 0); o2 = vec3i(0, 1, 1); } else { o1 = vec3i(0, 1, 0); o2 = vec3i(1, 1, 0); }
    }
    let d0 = vec3f(x0, y0, z0);
    let d1 = vec3f(x0 - f32(o1.x) + H, y0 - f32(o1.y) + H, z0 - f32(o1.z) + H);
    let d2 = vec3f(x0 - f32(o2.x) + 2.0 * H, y0 - f32(o2.y) + 2.0 * H, z0 - f32(o2.z) + 2.0 * H);
    let d3 = vec3f(x0 - 1.0 + 3.0 * H, y0 - 1.0 + 3.0 * H, z0 - 1.0 + 3.0 * H);
    let ii = i32(i) & 255; let jj = i32(j) & 255; let kk = i32(k) & 255;
    let n0 = sxCorner(d0, t, ii + sxPerm(t, jj + sxPerm(t, kk)));
    let n1 = sxCorner(d1, t, ii + o1.x + sxPerm(t, jj + o1.y + sxPerm(t, kk + o1.z)));
    let n2 = sxCorner(d2, t, ii + o2.x + sxPerm(t, jj + o2.y + sxPerm(t, kk + o2.z)));
    let n3 = sxCorner(d3, t, ii + 1 + sxPerm(t, jj + 1 + sxPerm(t, kk + 1)));
    return 32.0 * (n0 + n1 + n2 + n3);
}
fn fbm3(x: f32, y: f32, z: f32, t: u32) -> f32 {
    var sum = 0.0; var mx = 0.0; var amp = 1.0;
    for (var o = 0u; o < 3u; o++) { let f = f32(1u << o); sum += amp * noise3(x * f, y * f, z * f, t); mx += amp; amp *= 0.5; }
    return sum / mx;
}
`;
