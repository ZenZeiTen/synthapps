// keyframe-animator.js — PlayCanvas Editor script (classic pc.createScript).
// Upload with create_assets {type:'script', options:{filename:'keyframe-animator.js', text}},
// then script_parse, attach_script(scriptName 'keyframeAnimator', attributes {...}).
//
// Attribute `timeline` is a JSON string:
// {
//   "loop": false,
//   "tracks": [
//     { "prop": "position", "keys": [[0, [0, 0.5, 0]], [0.6, [0, 1.6, 0], "outCubic"], [1.2, [0, 0.5, 0], "inQuad"]] },
//     { "prop": "euler",    "keys": [[0, [0, 0, 0]], [3, [0, 360, 0], "inOutCubic"]] },
//     { "prop": "scale",    "keys": [[0, 1], [0.3, 1.2, "outBack"]] },            // number = uniform
//     { "prop": "material.diffuse",   "keys": [[0, [1, 0.3, 0.2]], [2, [0.2, 0.5, 1]]] },
//     { "prop": "material.opacity",   "keys": [[0, 0], [0.5, 1]] },
//     { "prop": "light.intensity",    "keys": [[0, 0], [1, 3, "outQuad"]] },
//     { "prop": "camera.fov",         "keys": [[0, 45], [3, 30, "inOutSine"]] },
//     { "prop": "enabled",            "keys": [[0, 0], [1, 1, "step"]] }
//   ]
// }
// A key is [seconds, value, easeIntoThisKey?]. Time advances with dt only, so a
// render.mjs capture is frame-exact. `lookAt` (entity) re-aims after each update —
// put this on a camera for an animated shot. material.* edits the entity's first
// render material (cloned per entity so siblings are unaffected).
var KeyframeAnimator = pc.createScript('keyframeAnimator');

KeyframeAnimator.attributes.add('timeline', { type: 'string', default: '{"tracks":[]}', description: 'JSON timeline (see file header)' });
KeyframeAnimator.attributes.add('startDelay', { type: 'number', default: 0 });
KeyframeAnimator.attributes.add('speed', { type: 'number', default: 1 });
KeyframeAnimator.attributes.add('lookAt', { type: 'entity' });

KeyframeAnimator.EASE = {
    linear: function (t) { return t; },
    step: function (t) { return t < 1 ? 0 : 1; },
    inQuad: function (t) { return t * t; },
    outQuad: function (t) { return 1 - (1 - t) * (1 - t); },
    inOutQuad: function (t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; },
    inCubic: function (t) { return t * t * t; },
    outCubic: function (t) { return 1 - Math.pow(1 - t, 3); },
    inOutCubic: function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; },
    inOutSine: function (t) { return -(Math.cos(Math.PI * t) - 1) / 2; },
    outExpo: function (t) { return t === 1 ? 1 : 1 - Math.pow(2, -10 * t); },
    inBack: function (t) { return 2.70158 * t * t * t - 1.70158 * t * t; },
    outBack: function (t) { return 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2); },
    outElastic: function (t) { return t === 0 || t === 1 ? t : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI) / 3) + 1; },
    outBounce: function (t) {
        var n = 7.5625, d = 2.75;
        if (t < 1 / d) return n * t * t;
        if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
        if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
        return n * (t -= 2.625 / d) * t + 0.984375;
    }
};

KeyframeAnimator.sample = function (keys, time) {
    if (time <= keys[0][0]) return keys[0][1];
    for (var i = 1; i < keys.length; i++) {
        if (time <= keys[i][0]) {
            var t0 = keys[i - 1][0], v0 = keys[i - 1][1], t1 = keys[i][0], v1 = keys[i][1];
            var f = KeyframeAnimator.EASE[keys[i][2] || 'linear'];
            var u = f(t1 === t0 ? 1 : (time - t0) / (t1 - t0));
            if (Array.isArray(v0)) return v0.map(function (x, j) { return x + (v1[j] - x) * u; });
            return v0 + (v1 - v0) * u;
        }
    }
    return keys[keys.length - 1][1];
};

KeyframeAnimator.prototype.initialize = function () {
    this.time = -this.startDelay;
    this.parse();
    this.on('attr:timeline', this.parse, this);
    this.apply();
};

KeyframeAnimator.prototype.parse = function () {
    var data;
    try {
        data = JSON.parse(this.timeline || '{}');
    } catch (e) {
        console.error('keyframeAnimator: timeline is not valid JSON on ' + this.entity.name + ': ' + e.message);
        data = { tracks: [] };
    }
    this.loop = !!data.loop;
    this.tracks = (data.tracks || []).map(function (tr) {
        var keys = tr.keys.slice().sort(function (a, b) { return a[0] - b[0]; });
        keys.forEach(function (k) {
            if (k[2] && !KeyframeAnimator.EASE[k[2]]) console.error('keyframeAnimator: unknown ease "' + k[2] + '"');
        });
        return { prop: tr.prop, keys: keys };
    });
    this.duration = this.tracks.reduce(function (m, tr) { return Math.max(m, tr.keys[tr.keys.length - 1][0]); }, 0);
    this.material = null;
};

KeyframeAnimator.prototype.getMaterial = function () {
    if (this.material) return this.material;
    var r = this.entity.render;
    if (!r || !r.meshInstances.length) return null;
    var m = r.meshInstances[0].material.clone();
    r.meshInstances.forEach(function (mi) { mi.material = m; });
    this.material = m;
    return m;
};

KeyframeAnimator.prototype.setProp = function (prop, v) {
    var e = this.entity;
    switch (prop) {
        case 'position': e.setLocalPosition(v[0], v[1], v[2]); return;
        case 'euler': e.setLocalEulerAngles(v[0], v[1], v[2]); return;
        case 'scale': if (Array.isArray(v)) e.setLocalScale(v[0], v[1], v[2]); else e.setLocalScale(v, v, v); return;
        case 'enabled':
            // keep the script itself running: toggle render/light/sprite/element instead
            ['render', 'light', 'sprite', 'element', 'particlesystem'].forEach(function (c) { if (e[c]) e[c].enabled = v >= 0.5; });
            return;
    }
    var dot = prop.indexOf('.');
    var comp = prop.slice(0, dot), field = prop.slice(dot + 1);
    if (comp === 'material') {
        var m = this.getMaterial();
        if (!m) return;
        if (Array.isArray(v)) m[field].set(v[0], v[1], v[2]); else m[field] = v;
        m.update();
        return;
    }
    var c = e[comp];
    if (!c) return;
    if (Array.isArray(v)) {
        var cur = c[field];
        if (cur && cur.set) { cur.set.apply(cur, v); c[field] = cur; } else c[field] = v;
    } else {
        c[field] = v;
    }
};

KeyframeAnimator.prototype.apply = function () {
    var t = Math.max(0, this.time);
    for (var i = 0; i < this.tracks.length; i++) {
        this.setProp(this.tracks[i].prop, KeyframeAnimator.sample(this.tracks[i].keys, t));
    }
    if (this.lookAt) this.entity.lookAt(this.lookAt.getPosition());
};

KeyframeAnimator.prototype.update = function (dt) {
    this.time += dt * this.speed;
    if (this.loop && this.duration > 0 && this.time > this.duration) this.time %= this.duration;
    this.apply();
};
