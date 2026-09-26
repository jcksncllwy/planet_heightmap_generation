// Equirectangular rasteriser for sim-mesh cell data. DOM-free: it fills a plain RGBA
// byte buffer, so the browser lab (canvas/texture) and the Node check scripts (PNG)
// share one code path. Longitude −180…180 left→right, latitude 90…−90 top→bottom.

import { locate } from '../core/mesh-locate.js';

export class MapRaster {
    constructor(simMesh, width = 1024) {
        this.width = width;
        this.height = width >> 1;
        this.pixelCell = new Int32Array(this.width * this.height);
        const { index } = simMesh;
        for (let py = 0; py < this.height; py++) {
            const lat = Math.PI / 2 - ((py + 0.5) / this.height) * Math.PI;
            const cl = Math.cos(lat), z = Math.sin(lat);
            for (let px = 0; px < this.width; px++) {
                const lon = ((px + 0.5) / this.width) * 2 * Math.PI - Math.PI;
                this.pixelCell[py * this.width + px] = index.nearest(cl * Math.cos(lon), cl * Math.sin(lon), z);
            }
        }
    }

    /** Sim cell under pixel (px, py). */
    cellAt(px, py) {
        px = Math.max(0, Math.min(this.width - 1, px | 0));
        py = Math.max(0, Math.min(this.height - 1, py | 0));
        return this.pixelCell[py * this.width + px];
    }

    /**
     * @param {Uint8Array} cellRgb  3 bytes per sim cell
     * @param {Uint8ClampedArray|Uint8Array} outRgba  width*height*4 buffer
     */
    paint(cellRgb, outRgba) {
        const pc = this.pixelCell;
        for (let i = 0, o = 0; i < pc.length; i++, o += 4) {
            const c = 3 * pc[i];
            outRgba[o] = cellRgb[c]; outRgba[o + 1] = cellRgb[c + 1]; outRgba[o + 2] = cellRgb[c + 2];
            outRgba[o + 3] = 255;
        }
    }

    /** Pixel position of a unit vector. */
    project(x, y, z) {
        const lat = Math.asin(Math.max(-1, Math.min(1, z))), lon = Math.atan2(y, x);
        return [(lon + Math.PI) / (2 * Math.PI) * this.width, (Math.PI / 2 - lat) / Math.PI * this.height];
    }
}

/**
 * The same map, but for a fine mesh drawn smoothly: each pixel blends the three cells of the mesh triangle it falls
 * in (core/mesh-locate.js), so a terrain mesh shows as continuous shaded relief instead of Voronoi patches.
 * Same interface as MapRaster.
 */
export class SmoothMapRaster {
    constructor(mesh, width = 1024) {
        this.width = width;
        this.height = width >> 1;
        const n = this.width * this.height;
        this.pixelCells = new Int32Array(3 * n);
        this.pixelWeights = new Uint8Array(2 * n);        // the 2nd and 3rd corner's weight × 255; the 1st gets the rest
        const c3 = [0, 0, 0], w3 = [0, 0, 0];
        for (let py = 0, i = 0; py < this.height; py++) {
            const lat = Math.PI / 2 - ((py + 0.5) / this.height) * Math.PI, cl = Math.cos(lat), z = Math.sin(lat);
            for (let px = 0; px < this.width; px++, i++) {
                const lon = ((px + 0.5) / this.width) * 2 * Math.PI - Math.PI;
                locate(mesh, cl * Math.cos(lon), cl * Math.sin(lon), z, c3, w3);
                this.pixelCells[3 * i] = c3[0]; this.pixelCells[3 * i + 1] = c3[1]; this.pixelCells[3 * i + 2] = c3[2];
                this.pixelWeights[2 * i] = Math.round(w3[1] * 255); this.pixelWeights[2 * i + 1] = Math.round(w3[2] * 255);
            }
        }
    }

    /** The cell that weighs most at pixel (px, py). */
    cellAt(px, py) {
        px = Math.max(0, Math.min(this.width - 1, px | 0));
        py = Math.max(0, Math.min(this.height - 1, py | 0));
        const i = py * this.width + px, w1 = this.pixelWeights[2 * i], w2 = this.pixelWeights[2 * i + 1], w0 = 255 - w1 - w2;
        return this.pixelCells[3 * i + (w0 >= w1 && w0 >= w2 ? 0 : w1 >= w2 ? 1 : 2)];
    }

    paint(cellRgb, outRgba) {
        const pc = this.pixelCells, pw = this.pixelWeights, n = this.width * this.height;
        for (let i = 0, o = 0; i < n; i++, o += 4) {
            const a = 3 * pc[3 * i], b = 3 * pc[3 * i + 1], c = 3 * pc[3 * i + 2], w1 = pw[2 * i], w2 = pw[2 * i + 1], w0 = 255 - w1 - w2;
            outRgba[o] = (w0 * cellRgb[a] + w1 * cellRgb[b] + w2 * cellRgb[c]) / 255;
            outRgba[o + 1] = (w0 * cellRgb[a + 1] + w1 * cellRgb[b + 1] + w2 * cellRgb[c + 1]) / 255;
            outRgba[o + 2] = (w0 * cellRgb[a + 2] + w1 * cellRgb[b + 2] + w2 * cellRgb[c + 2]) / 255;
            outRgba[o + 3] = 255;
        }
    }

    project(x, y, z) { return MapRaster.prototype.project.call(this, x, y, z); }
}
