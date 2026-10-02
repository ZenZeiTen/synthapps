// Turntable / sprite rig: renders a model from N yaw directions, optionally sampling
// its animation, with a fixed-scale orthographic (or perspective) camera.
//
// URL parameters (pass via render.mjs --page "index.html?model=hero.glb&dirs=8&fpd=6"):
//   model=path.glb   GLB/glTF inside the served root (omit -> built-in demo prop)
//   dirs=8           number of yaw directions (360/dirs apart)
//   fpd=1            frames per direction (animation samples per direction)
//   clip=all         'all' (default: every clip at once, one layer each), an index, or a name
//   animfps=12       animation sampling rate for fpd > 1
//   elev=30          camera elevation in degrees (0 = side view, 90 = top-down)
//   yaw0=0           yaw of direction 0 (degrees); dir i = yaw0 - i*360/dirs (clockwise from above)
//   ortho=1          1 = orthographic (sprites), 0 = perspective (hero turntable)
//   pad=1.08         framing margin
//   fov=30           perspective field of view
// Frame k -> direction floor(k / fpd), anim sample k % fpd. Render with
// frames = dirs * fpd, e.g. --frames 48 for dirs=8 fpd=6, and --alpha for sprites.
import * as pc from '/__engine/playcanvas.mjs';

const R = window.__RENDER__ || { capture: false, alpha: false };
const q = new URLSearchParams(location.search);
const num = (k, d) => (q.has(k) ? parseFloat(q.get(k)) : d);
const P = {
    model: q.get('model'),
    dirs: num('dirs', 8), fpd: num('fpd', 1), clip: q.get('clip') ?? 'all', animfps: num('animfps', 12),
    elev: num('elev', 30), yaw0: num('yaw0', 0), ortho: num('ortho', 1) !== 0, pad: num('pad', 1.08), fov: num('fov', 30)
};

const canvas = document.getElementById('app');
const app = new pc.Application(canvas, {
    graphicsDeviceOptions: { alpha: !!R.alpha, preserveDrawingBuffer: !!R.capture, antialias: true }
});
window.app = app;
if (R.capture) {
    app.setCanvasFillMode(pc.FILLMODE_NONE, R.width, R.height);
    app.setCanvasResolution(pc.RESOLUTION_FIXED, R.width, R.height);
} else {
    app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
    app.setCanvasResolution(pc.RESOLUTION_AUTO);
    window.addEventListener('resize', () => app.resizeCanvas());
}

function loadContainer(url) {
    return new Promise((resolve, reject) => {
        app.assets.loadFromUrl(url, 'container', (err, asset) => (err ? reject(err) : resolve(asset)));
    });
}

function demoProp() {
    const root = new pc.Entity('DemoProp');
    const mat = (c, metal = 0, gloss = 0.6) => {
        const m = new pc.StandardMaterial();
        m.diffuse.set(...c); m.useMetalness = true; m.metalness = metal; m.gloss = gloss; m.update();
        return m;
    };
    const part = (type, m, pos, scale) => {
        const e = new pc.Entity(type);
        e.addComponent('render', { type, material: m, castShadows: true });
        e.setLocalPosition(...pos); e.setLocalScale(...scale);
        root.addChild(e);
        return e;
    };
    part('box', mat([0.9, 0.4, 0.2]), [0, 0.6, 0], [0.8, 0.9, 0.5]);
    part('sphere', mat([0.95, 0.85, 0.7]), [0, 1.35, 0], [0.55, 0.55, 0.55]);
    part('box', mat([0.2, 0.25, 0.3]), [0, 1.4, 0.26], [0.35, 0.12, 0.1]);   // visor = front (+Z)
    part('cylinder', mat([0.3, 0.3, 0.35], 0.8), [-0.2, 0.1, 0], [0.22, 0.4, 0.22]);
    part('cylinder', mat([0.3, 0.3, 0.35], 0.8), [0.2, 0.1, 0], [0.22, 0.4, 0.22]);
    return root;
}

function worldBounds(entity) {
    const aabb = new pc.BoundingBox();
    let first = true;
    for (const r of entity.findComponents('render')) {
        for (const mi of r.meshInstances) {
            if (first) { aabb.copy(mi.aabb); first = false; } else aabb.add(mi.aabb);
        }
    }
    return first ? null : aabb;
}

async function build() {
    app.scene.ambientLight = new pc.Color(0.35, 0.37, 0.42);

    const pivot = new pc.Entity('Pivot');       // yaw turns this; model sits inside
    app.root.addChild(pivot);
    let model, anim = null, clipDuration = 0;
    if (P.model) {
        const asset = await loadContainer(P.model);
        model = asset.resource.instantiateRenderEntity();
        const anims = (asset.resource.animations || []).map(a => a.resource);
        if (anims.length) {
            // Blender often exports one clip per animated object, so the default 'all'
            // plays every clip at once, each on its own anim layer.
            let pickList;
            if (P.clip === 'all') pickList = anims;
            else {
                const idx = /^\d+$/.test(P.clip) ? parseInt(P.clip, 10) : anims.findIndex(t => t.name === P.clip);
                if (idx < 0 || idx >= anims.length) throw new Error(`clip "${P.clip}" not found; have: ${anims.map(t => t.name).join(', ')}`);
                pickList = [anims[idx]];
            }
            model.addComponent('anim', { activate: true });
            pickList.forEach((track, i) => {
                if (i === 0) model.anim.assignAnimation('clip', track);
                else { model.anim.addLayer(`L${i}`); model.anim.assignAnimation('clip', track, `L${i}`); }
            });
            // Keep layers playing (a paused layer never leaves its START state, so
            // scrubbing would be a no-op) but at speed 0: only our scrub moves time.
            model.anim.speed = 0;
            clipDuration = Math.max(...pickList.map(t => t.duration));
            anim = { layers: model.anim.layers, durations: pickList.map(t => t.duration), names: pickList.map(t => t.name) };
        }
    } else {
        model = demoProp();
    }
    pivot.addChild(model);

    // Frame on the bounding sphere so scale is identical in every direction.
    app.root.syncHierarchy();
    const box = worldBounds(model);
    const center = box ? box.center.clone() : new pc.Vec3(0, 0.5, 0);
    const radius = box ? box.halfExtents.length() : 1;
    // recentre the model on the pivot (yaw about its own centre)
    model.setLocalPosition(-center.x, 0, -center.z);
    center.x = 0; center.z = 0;

    const camera = new pc.Entity('Camera');
    camera.addComponent('camera', {
        clearColor: R.alpha ? new pc.Color(0, 0, 0, 0) : new pc.Color(0.12, 0.13, 0.16, 1),
        projection: P.ortho ? pc.PROJECTION_ORTHOGRAPHIC : pc.PROJECTION_PERSPECTIVE,
        orthoHeight: radius * P.pad, fov: P.fov,
        nearClip: 0.01, farClip: radius * 20 + 10,
        toneMapping: pc.TONEMAP_ACES, gammaCorrection: pc.GAMMA_SRGB
    });
    const dist = P.ortho ? radius * 4 : radius * P.pad / Math.sin((P.fov * Math.PI / 180) / 2);
    const e = P.elev * Math.PI / 180;
    camera.setLocalPosition(center.x, center.y + Math.sin(e) * dist, center.z + Math.cos(e) * dist);
    camera.lookAt(center);
    app.root.addChild(camera);

    // Lights are fixed relative to the camera, so every direction is lit the same way.
    const key = new pc.Entity('Key');
    key.addComponent('light', { type: 'directional', intensity: 1.8, color: new pc.Color(1, 0.96, 0.9), castShadows: false });
    key.setLocalEulerAngles(45, 30, 0);
    app.root.addChild(key);
    const rim = new pc.Entity('Rim');
    rim.addComponent('light', { type: 'directional', intensity: 0.8, color: new pc.Color(0.6, 0.75, 1) });
    rim.setLocalEulerAngles(-150, 20, 0);
    app.root.addChild(rim);

    // Pose for frame n. app.systems 'update' fires inside tick k before the anim
    // system's 'animationUpdate', so the scrubbed time is what gets evaluated.
    let n = -1;
    const pose = () => {
        const dir = Math.floor(n / P.fpd) % P.dirs;
        const sample = n % P.fpd;
        pivot.setLocalEulerAngles(0, P.yaw0 - dir * 360 / P.dirs, 0);
        if (anim && clipDuration > 0) {
            const t = P.fpd > 1 ? (sample / P.animfps) % clipDuration : 0;
            anim.layers.forEach((layer, i) => { layer.activeStateCurrentTime = t % anim.durations[i]; });
        }
    };
    app.systems.on('update', () => { n++; pose(); });

    window.__sprite = { dirs: P.dirs, fpd: P.fpd, frames: P.dirs * P.fpd, radius, clipDuration };
    if (window.__renderLog) window.__renderLog(`turntable: dirs=${P.dirs} fpd=${P.fpd} frames=${P.dirs * P.fpd} radius=${radius.toFixed(3)} clip=${clipDuration.toFixed(3)}s${anim ? ` clips=[${anim.names.join(', ')}]` : ''}`);
}

window.__renderReady = build();
app.start();
