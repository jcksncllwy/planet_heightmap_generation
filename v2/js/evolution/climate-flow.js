// The Climate view's flow: the winds and the sea's currents drawn as moving particles with fading trails, over the
// globe or the map — the flow itself, where arrows on a lattice only sampled it.
//
// Borrowed conventions (cited):
//  • earth.nullschool.net (Cameron Beccario, after Fernanda Viégas & Martin Wattenberg's "Wind Map", hint.fm 2012):
//    particles advected through the field, each living a random number of frames and reborn at a random place, their
//    trails fading behind them; speed shown both by how fast they move and by a quiet colour underneath; the particles'
//    density held on the screen, not on the planet, so a zoom keeps the picture as full.
//  • Climate Reanalyzer (climatereanalyzer.org, U. Maine) and the textbook ocean maps: the currents told warm or cold by
//    the water they carry (red/orange warm, blue cold), over the sea surface temperature's anomaly.
//
// Honest at 1°: the fields are the climate's 1° grid (climate-fields.js), sampled bilinearly — smooth, never sharpened.
// The particles' paths follow that smooth field; no detail below the grid is invented.
//
// How it works: the particles live on the CPU (a few thousand bilinear lookups a frame: well under a millisecond). Each
// keeps its last TRAIL positions in one row of a small float texture (TRAIL × count texels, ~1 MB), sent each frame; one
// instanced draw makes every trail's segments — quads a fixed number of screen pixels wide, so a trail is as thin at
// every zoom. On the globe a segment is lifted just off the surface and faded toward the limb (no depth test, so nothing
// fights the globe's surface); on the map the same positions are laid flat (the map's turn applied, segments that cross
// its edge dropped). New particles are born where the screen shows: on the globe, inside the cap the camera sees; on the
// map, anywhere, evenly by area of the map.

import * as THREE from 'three';

const DEG = Math.PI / 180;
/** Trail length, in frames: each particle's last positions, drawn as TRAIL − 1 segments fading toward the tail. */
export const TRAIL = 18;
/** The particles' visual pace: a "strong" speed (the field's 95th percentile) crosses this share of the visible radius per
 *  second (nullschool's pace: a fast particle crosses a good part of the screen in a few seconds). */
const PACE_PER_S = 0.18;
/** A particle's life, frames (at 60 a second): uniform between these, then reborn (nullschool: up to ~100 frames). */
const LIFE_MIN = 50, LIFE_MAX = 140;

const VERT = /* glsl */`
precision highp float;
uniform sampler2D posTex;
uniform float head, trail, mode, turn, widthPx, lift;
uniform vec2 viewport;
attribute vec2 corner;      // x: 0 tail end of the segment, 1 head end; y: −1 … 1 across
attribute vec2 inst;        // particle, segment (0 = the newest)
varying float vAlpha, vTint, vAcross;

vec3 onSphere(vec2 ll) {
    // (three's SphereGeometry: texture u = 0 at longitude −180°, x = −cos φ sin θ, y = cos θ, z = sin φ sin θ)
    float phi = ll.x + 3.14159265, cl = cos(ll.y);
    return vec3(-cos(phi) * cl, sin(ll.y), sin(phi) * cl);
}
vec4 project(vec2 ll, out float facing) {
    if (mode < 0.5) {
        vec3 p = onSphere(ll) * lift;
        vec4 world = modelMatrix * vec4(p, 1.0);
        facing = dot(normalize(world.xyz), normalize(cameraPosition - world.xyz));
        return projectionMatrix * viewMatrix * world;
    }
    facing = 1.0;
    float u = fract((ll.x + 3.14159265) / 6.2831853 - turn), v = 0.5 - ll.y / 3.14159265;
    return vec4(2.0 * u - 1.0, 1.0 - 2.0 * v, 0.0, 1.0);
}
void main() {
    float s = inst.y, a = mod(head - s + trail, trail), b = mod(head - s - 1.0 + trail, trail);
    vec4 A = texelFetch(posTex, ivec2(int(a), int(inst.x)), 0), B = texelFetch(posTex, ivec2(int(b), int(inst.x)), 0);
    float fA, fB;
    // (the newer end is A, the older B: the segment runs from B to A)
    vec4 cA = project(A.xy, fA), cB = project(B.xy, fB);
    vec2 sA = cA.xy / cA.w * viewport * 0.5, sB = cB.xy / cB.w * viewport * 0.5, d = sA - sB;
    float len = length(d);
    // (a gap — a newborn's empty past, or the map's edge — draws nothing)
    float ok = step(0.0, A.z) * step(0.0, B.z) * (mode > 0.5 ? step(abs(cA.x - cB.x), 1.0) : 1.0) * step(len, 0.25 * viewport.x);
    vec2 dir = len > 1e-4 ? d / len : vec2(1.0, 0.0), nrm = vec2(-dir.y, dir.x);
    vec4 c = corner.x > 0.5 ? cA : cB;
    vec2 off = nrm * corner.y * 0.5 * widthPx + dir * (corner.x - 0.5) * widthPx * 0.5;
    c.xy += off / (viewport * 0.5) * c.w;
    gl_Position = c;
    // (older segments fainter: the trail fades over its frames; toward the limb, fainter still)
    float age = (s + 1.0 - corner.x) / (trail - 1.0);
    float facing = corner.x > 0.5 ? fA : fB;
    vAlpha = ok * mix(A.z, B.z, 1.0 - corner.x) * (1.0 - age) * smoothstep(0.02, 0.3, facing);
    vTint = A.w;
    vAcross = corner.y;
}`;

const FRAG = /* glsl */`
precision highp float;
uniform vec3 warm, cold, plain;
uniform float opacity;
varying float vAlpha, vTint, vAcross;
void main() {
    float edge = 1.0 - smoothstep(0.55, 1.0, abs(vAcross));
    // (a current's tint saturates fast: a third of the way to full is already clearly warm or cold)
    float t = smoothstep(0.0, 0.35, abs(vTint));
    vec3 col = mix(plain, vTint > 0.0 ? warm : cold, t);
    gl_FragColor = vec4(col, vAlpha * edge * opacity);
    #include <colorspace_fragment>
}`;

/** A 360 × 180 field (rows north → south from 89.5°, columns west → east from −179.5°) at (lon, lat) in radians, bilinear. */
function sample(f, lon, lat) {
    const gx = (lon / DEG + 180) - 0.5, gy = Math.min(178.999, Math.max(0, 90 - lat / DEG - 0.5));
    const ix = Math.floor(gx), i0 = (ix % 360 + 360) % 360, i1 = i0 === 359 ? 0 : i0 + 1, tx = gx - ix, j0 = Math.floor(gy), ty = gy - j0;
    const r0 = j0 * 360, r1 = r0 + 360;
    return (f[r0 + i0] * (1 - tx) + f[r0 + i1] * tx) * (1 - ty) + (f[r1 + i0] * (1 - tx) + f[r1 + i1] * tx) * ty;
}

/** The speed a flow's arrows and particles treat as strong: its 95th percentile (over `mask` where given). */
export function strongSpeed(U, V, mask = null) {
    const s = [];
    for (let c = 0; c < U.length; c += 3) if (!mask || mask[c]) s.push(Math.hypot(U[c], V[c]));
    s.sort((a, b) => a - b);
    return s[Math.floor(0.95 * (s.length - 1))] || 1;
}

/**
 * What a current's water carries: the latitude-average sea temperature where it comes from, minus here (°C) — the
 * climate's own warm-or-cold measure (climate/ocean.js `carried`, CARRY_TRACE_KM 1500 km traced back along the current,
 * faded where it barely moves), worked out again here from the drawn currents and sea temperature, so a moment kept
 * from before the page carried it can still be drawn. Positive: a warm current; negative: a cold one.
 */
export function carriedOf(U, V, Tsea, sea, traceKm = 1500, calmMs = 0.005) {
    const w = 360, h = 180, G = w * h, rowMean = new Float64Array(h);
    for (let j = 0; j < h; j++) {
        let s = 0, k = 0;
        for (let i = 0; i < w; i++) { const c = j * w + i; if (sea[c] && Tsea[c] === Tsea[c]) { s += Tsea[c]; k++; } }
        rowMean[j] = k ? s / k : NaN;
    }
    // (rows without sea take their nearest sea row's mean)
    for (let j = 0; j < h; j++) if (rowMean[j] !== rowMean[j]) { for (let d = 1; d < h; d++) { const a = rowMean[j - d], b = rowMean[j + d]; if (a === a) { rowMean[j] = a; break; } if (b === b) { rowMean[j] = b; break; } } }
    const tz = y => { const yy = Math.max(0, Math.min(h - 1, y - 0.5)), j0 = Math.floor(yy), f = yy - j0; return rowMean[j0] * (1 - f) + rowMean[Math.min(h - 1, j0 + 1)] * f; };
    const out = new Float32Array(G), steps = Math.max(1, Math.round(traceKm / 111.2));
    for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
            const c = j * w + i;
            if (!sea[c]) continue;
            const sp0 = Math.hypot(U[c], V[c]);
            if (!(sp0 > 0)) continue;
            let y = j + 0.5, x = i + 0.5;
            for (let k = 0; k < steps; k++) {
                const cc = Math.floor(y) * w + ((Math.floor(x) % w) + w) % w, sp = Math.hypot(U[cc], V[cc]);
                if (!(sp > 0)) break;
                const cl = Math.max(0.1, Math.cos((90 - y) * DEG));
                const ny = y + V[cc] / sp, nx = x - U[cc] / sp / cl;              // (one cell upstream; rows run south)
                if (ny < 0 || ny >= h || !sea[Math.floor(ny) * w + ((Math.floor(nx) % w) + w) % w]) break;
                y = ny; x = nx;
            }
            // (ocean.js fades by the transport's speed, Ψ-derived over OCEAN_CURRENT_DEPTH_M: the drawn surface speed is
            // that already, so calm = 0.005 m/s)
            out[c] = (tz(y) - tz(j + 0.5)) * Math.tanh(sp0 / calmMs);
        }
    }
    return out;
}

export class FlowLayer {
    /** @param {number} count  particles kept at once (the screen's density: nullschool's ~1 per 500–1000 px²) */
    constructor(count = 5000) {
        this.count = count;
        this.trail = TRAIL;
        this.data = new Float32Array(4 * TRAIL * count);
        this.tex = new THREE.DataTexture(this.data, TRAIL, count, THREE.RGBAFormat, THREE.FloatType);
        this.tex.magFilter = this.tex.minFilter = THREE.NearestFilter;
        this.tex.needsUpdate = true;
        // particle state: lon, lat (radians), age, life (frames)
        this.lon = new Float64Array(count); this.lat = new Float64Array(count);
        this.age = new Float32Array(count); this.life = new Float32Array(count);
        this.head = 0;
        this.field = null;
        this._v1 = new THREE.Vector3(); this._v2 = new THREE.Vector3();
        this.seeded = false;
        const quad = new THREE.InstancedBufferGeometry();
        quad.setAttribute('corner', new THREE.Float32BufferAttribute([0, -1, 1, -1, 0, 1, 1, 1], 2));
        quad.setIndex([0, 1, 2, 2, 1, 3]);
        const inst = new Float32Array(2 * count * (TRAIL - 1));
        for (let p = 0, k = 0; p < count; p++) for (let s = 0; s < TRAIL - 1; s++) { inst[k++] = p; inst[k++] = s; }
        quad.setAttribute('inst', new THREE.InstancedBufferAttribute(inst, 2));
        quad.instanceCount = count * (TRAIL - 1);
        this.geometry = quad;
        const uniforms = {
            posTex: { value: this.tex }, head: { value: 0 }, trail: { value: TRAIL }, mode: { value: 0 }, turn: { value: 0 },
            widthPx: { value: 2 }, lift: { value: 1.004 }, viewport: { value: new THREE.Vector2(1, 1) }, opacity: { value: 0.9 },
            warm: { value: new THREE.Color(1, 0.5, 0.12) }, cold: { value: new THREE.Color(0.25, 0.78, 1) }, plain: { value: new THREE.Color(0.92, 0.94, 0.97) },
        };
        const make = mode => {
            const u = { ...uniforms, mode: { value: mode }, viewport: { value: new THREE.Vector2(1, 1) } };
            const m = new THREE.Mesh(quad, new THREE.ShaderMaterial({ uniforms: u, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthTest: false, depthWrite: false }));
            m.frustumCulled = false; m.renderOrder = 10;
            return m;
        };
        this.uniforms = uniforms;
        this.globeMesh = make(0); this.mapMesh = make(1);
        this.globeMesh.visible = this.mapMesh.visible = false;
    }

    /**
     * The flow to draw: U, V (m/s east and north, 360 × 180); `mask` (360 × 180, 1 where particles may go — the sea for
     * the currents), `onLand(lon°, lat°)` (finer: a particle that reaches it dies), `tint` (360 × 180, −1 cold … +1 warm,
     * or null: plain), `strong` (the speed drawn as a full one).
     */
    setField({ u, v, mask = null, onLand = null, tint = null, strong = null, widthPx = 2, opacity = 0.9, plain = null }) {
        this.field = { u, v, mask, onLand, tint, strong: strong ?? strongSpeed(u, v, mask) };
        this.widthCss = widthPx;
        this.uniforms.opacity.value = opacity;
        if (plain) this.uniforms.plain.value.setRGB(...plain);
        this.seeded = false;
    }
    clear() { this.field = null; this.globeMesh.visible = this.mapMesh.visible = false; }

    /** Into a GlobeView's scenes (the map's once it has one). */
    attach(globe) {
        if (this.globeMesh.parent !== globe.scene) globe.scene.add(this.globeMesh);
        if (globe.mapScene && this.mapMesh.parent !== globe.mapScene) globe.mapScene.add(this.mapMesh);
    }

    /** The cap of the globe the camera sees: its centre (unit vector) and angular radius (radians). */
    visibleCap(globe) {
        const cam = globe.camera, d = cam.position.length(), c = cam.position.clone().divideScalar(d);
        const horizon = Math.acos(Math.min(1, 1 / d));
        // (the frustum's corner ray: off-axis by its half diagonal; where it meets the sphere, its central angle)
        const half = cam.fov * DEG / 2, tanV = Math.tan(half), diag = Math.atan(tanV * Math.hypot(1, cam.aspect)), sd = d * Math.sin(diag);
        const corner = sd < 1 ? Math.asin(sd) - diag : horizon;
        return { c, r: Math.min(horizon, corner) };
    }

    /** A random point of the globe under the screen (a ray through a random pixel, met with the sphere): [lon, lat] in
     *  radians, or null where that pixel misses the globe. Evenly by screen area, as nullschool seeds. */
    screenPoint(cam) {
        const o = cam.position, a = this._v1.set(Math.random() * 2 - 1, Math.random() * 2 - 1, 0.5).unproject(cam).sub(o).normalize();
        const b = o.dot(a), c = o.lengthSq() - 1, disc = b * b - c;
        if (disc <= 0) return null;
        const t = -b - Math.sqrt(disc), x = o.x + a.x * t, y = o.y + a.y * t, z = o.z + a.z * t;
        let lon = Math.atan2(z, -x) - Math.PI;
        if (lon < -Math.PI) lon += 2 * Math.PI;
        return [lon, Math.asin(Math.max(-1, Math.min(1, y)))];
    }

    /** Is (lon, lat) on the screen, on the globe's near side (clear of the limb)? */
    onScreen(cam, lon, lat) {
        const cl = Math.cos(lat), v = this._v2.set(-Math.cos(lon + Math.PI) * cl, Math.sin(lat), Math.sin(lon + Math.PI) * cl);
        const o = cam.position, dx = o.x - v.x, dy = o.y - v.y, dz = o.z - v.z;
        if (v.x * dx + v.y * dy + v.z * dz < 0.03 * Math.hypot(dx, dy, dz)) return false;
        v.project(cam);
        return v.x > -1.05 && v.x < 1.05 && v.y > -1.05 && v.y < 1.05;
    }

    spawn(p, cam) {
        const F = this.field;
        for (let tries = 0; tries < 40; tries++) {
            let lon, lat;
            if (cam) { const q = this.screenPoint(cam); if (!q) continue; [lon, lat] = q; }
            // the map: evenly by its area
            else { lon = (Math.random() * 2 - 1) * Math.PI; lat = (Math.random() - 0.5) * Math.PI * 0.98; }
            if (F.mask && !(sample(F.mask, lon, lat) > 0.5)) continue;
            if (F.onLand && F.onLand(lon / DEG, lat / DEG)) continue;
            this.lon[p] = lon; this.lat[p] = lat;
            this.age[p] = 0; this.life[p] = LIFE_MIN + Math.random() * (LIFE_MAX - LIFE_MIN);
            // (its past emptied: nothing drawn behind a newborn)
            const row = 4 * TRAIL * p;
            for (let s = 0; s < TRAIL; s++) this.data[row + 4 * s + 2] = -1;
            return true;
        }
        // (none found this frame — the globe small on the screen, or the field's mask narrow there: try again next frame)
        this.age[p] = this.life[p] = 0;
        const row = 4 * TRAIL * p;
        for (let s = 0; s < TRAIL; s++) this.data[row + 4 * s + 2] = -1;
        return false;
    }

    /**
     * Advance the particles by dt seconds and lay them out for drawing on `globe` (a GlobeView). Returns the ms it took.
     */
    step(globe, dt) {
        const t0 = performance.now(), F = this.field, mapMode = !!globe.map;
        this.attach(globe);
        this.globeMesh.visible = !!F && !mapMode;
        this.mapMesh.visible = !!F && mapMode;
        if (!F) return 0;
        const cap = mapMode ? null : this.visibleCap(globe), cam = mapMode ? null : globe.camera;
        cam?.updateMatrixWorld();
        // (the pace: on the globe, a share of the cap's radius a second; on the map, of the map's half height (π/2))
        const radius = cap ? cap.r : Math.PI / 2, k = PACE_PER_S * radius * dt / F.strong;      // radians per (m/s)
        if (!this.seeded) { for (let p = 0; p < this.count; p++) { this.spawn(p, cam); this.age[p] = Math.random() * this.life[p]; } this.seeded = true; }
        const frames = dt * 60;
        this.head = (this.head + 1) % TRAIL;
        const D = this.data, head = this.head;
        for (let p = 0; p < this.count; p++) {
            this.age[p] += frames;
            let lon = this.lon[p], lat = this.lat[p];
            let dead = this.age[p] >= this.life[p] || (cam && !this.onScreen(cam, lon, lat));
            let u = 0, v = 0;
            if (!dead) {
                // midpoint (RK2) on the sphere: east u/(R cos φ), north v/R — scaled to the screen's pace
                u = sample(F.u, lon, lat); v = sample(F.v, lon, lat);
                const cm = Math.max(0.05, Math.cos(lat));
                const lonM = lon + 0.5 * k * u / cm, latM = lat + 0.5 * k * v;
                const um = sample(F.u, lonM, latM), vm = sample(F.v, lonM, latM);
                lon += k * um / Math.max(0.05, Math.cos(latM)); lat += k * vm;
                if (lat > Math.PI / 2 - 0.01 || lat < -Math.PI / 2 + 0.01) dead = true;
                if (lon > Math.PI) lon -= 2 * Math.PI; else if (lon < -Math.PI) lon += 2 * Math.PI;
                if (!dead && F.mask && !(sample(F.mask, lon, lat) > 0.5)) dead = true;
                if (!dead && F.onLand && F.onLand(lon / DEG, lat / DEG)) dead = true;
                u = um; v = vm;
            }
            if (dead) {
                this.spawn(p, cam);
                lon = this.lon[p]; lat = this.lat[p];
                u = sample(F.u, lon, lat); v = sample(F.v, lon, lat);
            }
            this.lon[p] = lon; this.lat[p] = lat;
            // strength: the speed against the strong one (a calm barely shows), faded in at birth and out before death
            const sp = Math.hypot(u, v) / F.strong, a = this.age[p], L = this.life[p];
            const fade = Math.min(1, a / 8, (L - a) / 12);
            const o = 4 * (TRAIL * p + head);
            D[o] = lon; D[o + 1] = lat; D[o + 2] = Math.max(0, fade) * (0.25 + 0.75 * Math.min(1, sp));
            D[o + 3] = F.tint ? Math.max(-1, Math.min(1, sample(F.tint, lon, lat))) : 0;
        }
        this.tex.needsUpdate = true;
        // the uniforms: the ring's head, the viewport (device pixels) and, on the map, its turn
        for (const m of [this.globeMesh, this.mapMesh]) m.material.uniforms.head.value = head;
        const r = globe.renderer, pr = r.getPixelRatio();
        if (mapMode) {
            const b = globe.mapBox();
            this.mapMesh.material.uniforms.viewport.value.set(b.width * pr, b.height * pr);
            this.mapMesh.material.uniforms.turn.value = globe.map.centerLon / 360;
        } else {
            const s = r.getDrawingBufferSize(new THREE.Vector2());
            this.globeMesh.material.uniforms.viewport.value.copy(s);
        }
        this.uniforms.widthPx.value = this.widthCss * pr;
        globe._dirty = true;
        return performance.now() - t0;
    }

    dispose() {
        this.globeMesh.parent?.remove(this.globeMesh); this.mapMesh.parent?.remove(this.mapMesh);
        this.geometry.dispose(); this.tex.dispose(); this.globeMesh.material.dispose(); this.mapMesh.material.dispose();
    }
}

/**
 * When the flow steps, for the page's animation loop: never while the tab is hidden or the page is busy (`busy()`: a
 * finish or a build under way), at most `fps` times a second (30: the trails read the same, at half the CPU of 60), and
 * with dt clamped after a stall (a tab brought back must not throw every particle across the planet). Under
 * prefers-reduced-motion the flow is drawn still: TRAIL steps at once, so each particle shows as a streak, then no more
 * until the field or the view changes (`touch()`).
 */
export class FlowClock {
    constructor({ fps = 30, busy = () => false } = {}) {
        this.minMs = 1000 / fps; this.busy = busy; this.last = null; this.still = 0;
        const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
        this.reduced = !!mq?.matches;
        mq?.addEventListener?.('change', e => { this.reduced = e.matches; this.touch(); });
    }
    /** The field or the view changed: under reduced motion, draw the still picture again. */
    touch() { this.still = 0; }
    /**
     * The steps to take now, as [dt, dt, …] seconds (empty: none) — one in motion, TRAIL at once for a still picture.
     * Call from requestAnimationFrame with its timestamp.
     */
    due(now) {
        if ((typeof document !== 'undefined' && document.hidden) || this.busy()) { this.last = null; return []; }
        if (this.reduced) { if (this.still) return []; this.still = 1; return new Array(TRAIL).fill(1 / 30); }
        if (this.last !== null && now - this.last < this.minMs - 1) return [];
        const dt = this.last !== null ? Math.min(0.1, (now - this.last) / 1000) : 1 / 30;
        this.last = now;
        return [dt];
    }
}
