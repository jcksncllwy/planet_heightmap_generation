// Three.js globe that displays the lab's equirectangular canvas as a texture.
// The texture is the single source of truth for both views, so globe and map always agree.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class GlobeView {
    /** @param {HTMLCanvasElement} glCanvas  @param {HTMLCanvasElement} mapCanvas */
    constructor(glCanvas, mapCanvas) {
        this.canvas = glCanvas;
        this.renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true });
        this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x05060a);
        this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
        this.camera.position.set(0, 0.9, 3.2);

        this.texture = new THREE.CanvasTexture(mapCanvas);
        this.texture.colorSpace = THREE.SRGBColorSpace;
        this.texture.magFilter = THREE.NearestFilter;      // keep sim cells crisp
        this.texture.minFilter = THREE.LinearFilter;
        this.texture.generateMipmaps = false;
        this.globe = new THREE.Mesh(
            new THREE.SphereGeometry(1, 128, 64),
            new THREE.MeshBasicMaterial({ map: this.texture }),
        );
        this.scene.add(this.globe);

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

    textureChanged() { this.texture.needsUpdate = true; }

    /** Crisp texels (sim cells, the default) or smoothly filtered ones (shaded terrain). */
    setSmooth(on) {
        const filter = on ? THREE.LinearFilter : THREE.NearestFilter;
        if (this.texture.magFilter !== filter) { this.texture.magFilter = filter; this.texture.needsUpdate = true; }
    }

    render() {
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
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
