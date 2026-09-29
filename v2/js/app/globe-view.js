// Three.js globe that displays the lab's equirectangular canvas as a texture.
// The texture is the single source of truth for both views, so globe and map always agree.
// `space: true` (the Evolution page) sets it in V1's space (js/scene.js): its stars, its atmosphere, its bluish ambient
// light and sun — the sun over the viewer's shoulder, where V1's stands for its opening view, so whatever is turned to
// face you is lit as V1's planet is — and the sun glinting off the sea (V1's water sphere: shininess 120, specular
// 0x4488bb at its opacity 0.55), the sea given by a mask (setSeaMask).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class GlobeView {
    /** @param {HTMLCanvasElement} glCanvas  @param {HTMLCanvasElement} mapCanvas  @param {{space?: boolean}} [o] */
    constructor(glCanvas, mapCanvas, { space = false } = {}) {
        this.canvas = glCanvas;
        this.renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true });
        this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(space ? 0x030308 : 0x05060a);
        this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, space ? 200 : 50);
        this.camera.position.set(0, 0.9, 3.2);

        this.texture = new THREE.CanvasTexture(mapCanvas);
        this.texture.colorSpace = THREE.SRGBColorSpace;
        this.texture.magFilter = THREE.NearestFilter;      // keep sim cells crisp
        this.texture.minFilter = THREE.LinearFilter;
        this.texture.generateMipmaps = false;
        this.globe = new THREE.Mesh(
            new THREE.SphereGeometry(1, 128, 64),
            space ? new THREE.MeshPhongMaterial({ map: this.texture, specular: new THREE.Color(0x4488bb).multiplyScalar(0.55), shininess: 120 })
                : new THREE.MeshBasicMaterial({ map: this.texture }),
        );
        this.scene.add(this.globe);
        if (space) this.addSpace();

        this.controls = new OrbitControls(this.camera, glCanvas);
        this.controls.enablePan = false;
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.08;
        this.controls.minDistance = 1.4;
        this.controls.maxDistance = 8;
        this.controls.rotateSpeed = 0.6;

        this._raycaster = new THREE.Raycaster();
        this._ndc = new THREE.Vector2();
    }

    resize() {
        const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
        if (!w || !h || (w === this._w && h === this._h)) return;
        this._w = w; this._h = h;
        this.renderer.setSize(w, h, false);
        this._dirty = true;
        this.camera.aspect = w / h;
        // Keep the whole globe in frame on portrait screens: hold the horizontal FOV at 40°.
        const half = Math.tan(20 * Math.PI / 180);
        this.camera.fov = 2 * Math.atan(half / Math.min(1, w / h)) * 180 / Math.PI;
        this.camera.updateProjectionMatrix();
    }

    /** Point the camera at a geographic position (degrees), keeping its current distance. */
    lookAt(latDeg, lonDeg) {
        const lat = latDeg * Math.PI / 180, lon = lonDeg * Math.PI / 180, d = this.camera.position.length();
        // SphereGeometry + equirectangular texture: lon 0 faces +x, lon 90°E faces −z, north is +y
        this.camera.position.set(d * Math.cos(lat) * Math.cos(lon), d * Math.sin(lat), -d * Math.cos(lat) * Math.sin(lon));
        this.controls.update();
    }

    textureChanged() { this.texture.needsUpdate = true; this._dirty = true; }

    /** V1's stars, atmosphere and light (js/scene.js). */
    addSpace() {
        const p = [];
        for (let i = 0; i < 3000; i++) {
            const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1), r = 40 + Math.random() * 30;
            p.push(r * Math.sin(ph) * Math.cos(th), r * Math.sin(ph) * Math.sin(th), r * Math.cos(ph));
        }
        const stars = new THREE.BufferGeometry();
        stars.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
        this.scene.add(new THREE.Points(stars, new THREE.PointsMaterial({ color: 0xffffff, size: 0.08 })));
        const atmosphere = new THREE.ShaderMaterial({
            uniforms: { c: { value: new THREE.Color(0.35, 0.6, 1.0) } },
            vertexShader: 'varying vec3 vN,vP;void main(){vN=normalize(normalMatrix*normal);vP=(modelViewMatrix*vec4(position,1)).xyz;gl_Position=projectionMatrix*vec4(vP,1);}',
            fragmentShader: 'uniform vec3 c;varying vec3 vN,vP;void main(){float r=1.0-max(0.0,dot(normalize(-vP),vN));gl_FragColor=vec4(c,pow(r,3.5)*0.55);}',
            transparent: true, side: THREE.FrontSide, depthWrite: false,
        });
        this.scene.add(new THREE.Mesh(new THREE.SphereGeometry(1.12, 64, 64), atmosphere));
        this.scene.add(new THREE.AmbientLight(0xaabbcc, 3.5));
        // the sun, carried with the camera: where V1's (5, 3, 4) stands seen from V1's opening view
        const sun = new THREE.DirectionalLight(0xfff8ee, 1.5);
        sun.position.set(0.707, 0.34, 0.62);
        this.camera.add(sun, sun.target);
        this.scene.add(this.camera);
        this.setSeaMask(null);
    }

    /** Where the sea is (a canvas the texture's shape: white sea, black land) — the sun glints there only; null: nowhere. */
    setSeaMask(canvas) {
        const m = this.globe.material;
        if (!('specularMap' in m)) return;
        if (canvas && this.seaMask?.image !== canvas) {
            this.seaMask?.dispose();
            this.seaMask = new THREE.CanvasTexture(canvas);
            this.seaMask.generateMipmaps = false;
            this.seaMask.minFilter = THREE.LinearFilter;
        }
        m.specularMap = canvas ? this.seaMask : null;
        m.specular.setScalar(0);
        if (canvas) m.specular.set(0x4488bb).multiplyScalar(0.55);
        m.needsUpdate = true;
        this._dirty = true;
    }
    seaMaskChanged() { if (this.seaMask) { this.seaMask.needsUpdate = true; this._dirty = true; } }

    /** Show another canvas (of another size) as the globe's texture, with the same filtering. */
    setSource(canvas) {
        if (this.texture.image === canvas) return;
        const old = this.texture;
        this.texture = new THREE.CanvasTexture(canvas);
        for (const k of ['colorSpace', 'magFilter', 'minFilter', 'generateMipmaps']) this.texture[k] = old[k];
        this.globe.material.map = this.texture;
        this.globe.material.needsUpdate = true;
        old.dispose();
        this._dirty = true;
    }

    /** Crisp texels (sim cells, the default) or smoothly filtered ones (shaded terrain). */
    setSmooth(on) {
        const filter = on ? THREE.LinearFilter : THREE.NearestFilter;
        if (this.texture.magFilter !== filter) { this.texture.magFilter = filter; this.texture.needsUpdate = true; }
    }

    render() {
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }

    /**
     * Draw only when something changed — the camera (moved, easing, or auto-rotating), the texture, the size. A globe
     * redrawn at 60 fps for nothing takes a core from the workers building the history (and a phone's battery).
     */
    renderIfNeeded() {
        const moved = this.controls.update();
        if (!moved && !this._dirty) return false;
        this.renderer.render(this.scene, this.camera);
        this._dirty = false;
        return true;
    }

    /** Texture UV under a client-space point, or null if the pointer is off the globe. */
    uvAt(clientX, clientY) {
        const r = this.canvas.getBoundingClientRect();
        this._ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
        this._raycaster.setFromCamera(this._ndc, this.camera);
        const hit = this._raycaster.intersectObject(this.globe)[0];
        return hit ? hit.uv : null;
    }
}
