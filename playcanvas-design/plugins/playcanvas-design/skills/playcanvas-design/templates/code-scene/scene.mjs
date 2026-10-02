// Starter code scene for playcanvas-design. Copy this folder, edit buildScene().
// Preview:  node <skill>/scripts/render.mjs --root <this folder> --serve
// Render:   node <skill>/scripts/render.mjs --root <this folder> --out frames --duration 4
//
// The engine is served by render.mjs at /__engine/playcanvas.mjs.
import * as pc from '/__engine/playcanvas.mjs';
import { Timeline } from './timeline.mjs';

const R = window.__RENDER__ || { capture: false, alpha: false };
const canvas = document.getElementById('app');

const app = new pc.Application(canvas, {
    graphicsDeviceOptions: {
        alpha: !!R.alpha,                       // transparent background for sprites/icons
        preserveDrawingBuffer: !!R.capture,     // lets the recorder read the frame back
        antialias: true
    }
});
window.app = app; // the recorder looks for window.app
window.pc = pc;   // lets --hook scripts use pc.* (e.g. pc.GltfExporter), as in Editor builds

if (R.capture) {
    app.setCanvasFillMode(pc.FILLMODE_NONE, R.width, R.height);
    app.setCanvasResolution(pc.RESOLUTION_FIXED, R.width, R.height);
} else {
    app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
    app.setCanvasResolution(pc.RESOLUTION_AUTO);
    window.addEventListener('resize', () => app.resizeCanvas());
}

// Load a GLB/glTF into a container asset. Resolves to the asset; instantiate with
// asset.resource.instantiateRenderEntity().
export function loadContainer(url) {
    return new Promise((resolve, reject) => {
        app.assets.loadFromUrl(url, 'container', (err, asset) => (err ? reject(err) : resolve(asset)));
    });
}

function material({ name = 'Material', color = [0.8, 0.8, 0.8], metalness = 0, gloss = 0.5, emissive = null } = {}) {
    const m = new pc.StandardMaterial();
    m.name = name;   // names survive GLB export
    m.diffuse.set(...color);
    m.useMetalness = true;
    m.metalness = metalness;
    m.gloss = gloss;
    if (emissive) { m.emissive.set(...emissive); m.emissiveIntensity = 1; }
    m.update();
    return m;
}

function primitive(type, mat, pos = [0, 0, 0], scale = [1, 1, 1], parent = app.root, name = type) {
    const e = new pc.Entity(name);
    e.addComponent('render', { type, material: mat, castShadows: true, receiveShadows: true });
    e.setLocalPosition(...pos);
    e.setLocalScale(...scale);
    parent.addChild(e);
    return e;
}

// Export an entity subtree as GLB next to the frames (no-op in --serve preview).
async function exportGlb(entity, filename) {
    if (!window.__renderSave) return;
    const buf = await new pc.GltfExporter().build(entity, { maxTextureSize: 1024 });
    await window.__renderSave(filename, buf);
}

async function buildScene() {
    // --- look: tone mapping, ambient, fog -------------------------------------
    app.scene.ambientLight = new pc.Color(0.18, 0.2, 0.26);
    app.scene.exposure = 1;

    // --- camera ----------------------------------------------------------------
    const camera = new pc.Entity('Camera');
    camera.addComponent('camera', {
        clearColor: R.alpha ? new pc.Color(0, 0, 0, 0) : new pc.Color(0.07, 0.08, 0.11, 1),
        fov: 40,
        toneMapping: pc.TONEMAP_ACES,
        gammaCorrection: pc.GAMMA_SRGB
    });
    app.root.addChild(camera);

    // --- lights: key (shadows), fill, rim --------------------------------------
    const key = new pc.Entity('Key');
    key.addComponent('light', {
        type: 'directional', color: new pc.Color(1, 0.95, 0.88), intensity: 2.2,
        castShadows: true, shadowResolution: 2048, shadowDistance: 20, shadowType: pc.SHADOW_PCF5_32F,
        normalOffsetBias: 0.05, shadowBias: 0.2
    });
    key.setLocalEulerAngles(50, 35, 0);
    app.root.addChild(key);

    const fill = new pc.Entity('Fill');
    fill.addComponent('light', { type: 'directional', color: new pc.Color(0.55, 0.65, 1), intensity: 0.5 });
    fill.setLocalEulerAngles(30, -140, 0);
    app.root.addChild(fill);

    const rim = new pc.Entity('Rim');
    rim.addComponent('light', { type: 'omni', color: new pc.Color(1, 0.6, 0.3), intensity: 3, range: 8 });
    rim.setLocalPosition(-2, 2.5, -3);
    app.root.addChild(rim);

    // --- props -------------------------------------------------------------------
    // floor gloss <= 0.25: a glossier floor shows the omni rim light as a hotspot in front of the subject
    if (!R.alpha) primitive('plane', material({ name: 'Floor', color: [0.22, 0.23, 0.27], gloss: 0.25 }), [0, 0, 0], [12, 1, 12]);
    const props = new pc.Entity('Props');      // group what you may want to export as GLB
    app.root.addChild(props);
    const heroMat = material({ name: 'Hero', color: [0.95, 0.35, 0.22], metalness: 0.1, gloss: 0.75 });
    const hero = primitive('box', heroMat, [0, 0.5, 0], [1, 1, 1], props, 'Hero');
    const orb = primitive('sphere', material({ name: 'Orb', color: [0.2, 0.6, 1], metalness: 0.9, gloss: 0.85 }), [1.6, 0.35, 0.4], [0.7, 0.7, 0.7], props, 'Orb');
    // await exportGlb(props, 'props.glb');   // rest pose; call before the timeline moves things

    // --- animation (seconds) -------------------------------------------------------
    const tl = new Timeline(app);
    tl.position(hero, [[0, [0, 0.5, 0]], [0.6, [0, 1.6, 0], 'outCubic'], [1.2, [0, 0.5, 0], 'inQuad'], [3, [0, 0.5, 0]]]);
    tl.euler(hero, [[0, [0, 0, 0]], [1.2, [0, 180, 0], 'inOutCubic'], [3, [0, 360, 0], 'inOutCubic']]);
    tl.color(heroMat, 'diffuse', [[0, [0.95, 0.35, 0.22]], [1.5, [0.95, 0.8, 0.2], 'inOutSine'], [3, [0.95, 0.35, 0.22], 'inOutSine']]);
    tl.scale(orb, [[0, 0.7], [1.2, 0.7], [1.5, 0.9, 'outBack'], [3, 0.7, 'inOutSine']]);

    // camera orbit: angle track drives position + lookAt each frame
    tl.value((a) => {
        const r = 6, rad = a * Math.PI / 180;
        camera.setLocalPosition(Math.sin(rad) * r, 2.4, Math.cos(rad) * r);
        camera.lookAt(0, 0.6, 0);
    }, [[0, 20], [3, 70, 'inOutSine']]);

    window.__duration = tl.duration;
}

// The recorder waits for this promise before frame 0 (put asset loads in buildScene).
window.__renderReady = buildScene();
app.start();
