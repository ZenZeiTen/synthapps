// Keyframe timeline for PlayCanvas code scenes. Driven by app 'update' dt, so
// it is frame-exact under render.mjs (every frame advances exactly 1/fps).
//
//   const tl = new Timeline(app);
//   tl.position(box, [[0, [0, 0, 0]], [1, [0, 2, 0], 'outBack'], [2, [0, 0, 0], 'inOutCubic']]);
//   tl.euler(box, [[0, [0, 0, 0]], [2, [0, 360, 0]]]);
//   tl.color(material, 'diffuse', [[0, [1, 0.3, 0.2]], [2, [0.2, 0.5, 1]]]);
//   tl.value(v => light.light.intensity = v, [[0, 0], [0.5, 3, 'outQuad']]);
//   tl.call(1.5, () => burst.particlesystem.play());   // fires once when time passes 1.5
//                                                       // (t must be > 0; do t=0 work in buildScene)
//   tl.duration  // last key time (seconds) -> pass --duration to render.mjs
//
// A key is [timeSeconds, value, easeIntoThisKey?]. Values are numbers or arrays.
// Before the first key the first value holds; after the last key the last holds.
//
// Every track method takes an optional last argument { offset, period }:
//   offset  seconds this track starts late (stagger: offset: i * 0.1)
//   period  repeat the keys every `period` seconds (local time wraps, also before 0),
//           e.g. a 1 s bounce repeating inside a 4 s loop: { period: 1, offset: i * 0.1 }
// With period set, a staggered element is mid-cycle at t = 0 and the loop still
// closes, as long as the shot length is a multiple of period.
// new Timeline(app, { loop: true }) wraps the master time at tl.duration.
// sample(keys, t) is exported for hand-made tracks.

export const EASE = {
    linear: t => t,
    step: t => (t < 1 ? 0 : 1),
    inQuad: t => t * t,
    outQuad: t => 1 - (1 - t) * (1 - t),
    inOutQuad: t => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
    inCubic: t => t * t * t,
    outCubic: t => 1 - (1 - t) ** 3,
    inOutCubic: t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
    inOutSine: t => -(Math.cos(Math.PI * t) - 1) / 2,
    outExpo: t => (t === 1 ? 1 : 1 - 2 ** (-10 * t)),
    inBack: t => 2.70158 * t * t * t - 1.70158 * t * t,
    outBack: t => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2,
    outElastic: t => (t === 0 || t === 1 ? t : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI) / 3) + 1),
    outBounce: (t) => {
        const n = 7.5625, d = 2.75;
        if (t < 1 / d) return n * t * t;
        if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
        if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
        return n * (t -= 2.625 / d) * t + 0.984375;
    }
};

const lerp = (a, b, u) => (Array.isArray(a) ? a.map((x, i) => x + (b[i] - x) * u) : a + (b - a) * u);

export function sample(keys, time) {
    if (time <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
        const [t1, v1, ease] = keys[i];
        if (time <= t1) {
            const [t0, v0] = keys[i - 1];
            const f = EASE[ease || 'linear'];
            if (!f) throw new Error(`unknown ease "${ease}"`);
            const u = t1 === t0 ? 1 : (time - t0) / (t1 - t0);
            return lerp(v0, v1, f(u));
        }
    }
    return keys[keys.length - 1][1];
}

export class Timeline {
    constructor(app, { loop = false } = {}) {
        this.time = 0;
        this.loop = loop;
        this.tracks = [];
        this.cues = [];
        this.duration = 0;
        app.on('update', dt => this.advance(dt));
    }

    // Apply every track at the current time (also called once on creation of a track,
    // so frame 0 already shows the first key).
    static localTime(tr, time) {
        let t = time - tr.offset;
        if (tr.period > 0) t = ((t % tr.period) + tr.period) % tr.period;
        return t;
    }

    apply() {
        for (const tr of this.tracks) tr.set(sample(tr.keys, Timeline.localTime(tr, this.time)));
    }

    advance(dt) {
        const prev = this.time;
        this.time += dt;
        if (this.loop && this.duration > 0 && this.time > this.duration) this.time %= this.duration;
        for (const c of this.cues) if (c.t > prev && c.t <= this.time) c.fn();
        this.apply();
    }

    value(setter, keys, { offset = 0, period = 0 } = {}) {
        keys = [...keys].sort((a, b) => a[0] - b[0]);
        const tr = { set: setter, keys, offset, period };
        this.tracks.push(tr);
        // a repeating track has no natural end; it contributes its period (plus offset) at most
        const end = period > 0 ? period : keys[keys.length - 1][0] + offset;
        this.duration = Math.max(this.duration, end);
        setter(sample(keys, Timeline.localTime(tr, this.time)));
        return this;
    }

    position(entity, keys, opts) { return this.value(v => entity.setLocalPosition(v[0], v[1], v[2]), keys, opts); }
    euler(entity, keys, opts) { return this.value(v => entity.setLocalEulerAngles(v[0], v[1], v[2]), keys, opts); }
    scale(entity, keys, opts) {
        return this.value(v => (Array.isArray(v) ? entity.setLocalScale(v[0], v[1], v[2]) : entity.setLocalScale(v, v, v)), keys, opts);
    }

    // material colour property: 'diffuse' | 'emissive' | 'specular' ...; value [r,g,b]
    color(material, prop, keys, opts) {
        return this.value((v) => { material[prop].set(v[0], v[1], v[2]); material.update(); }, keys, opts);
    }

    // any numeric material property, e.g. 'opacity', 'emissiveIntensity', 'gloss'
    materialValue(material, prop, keys, opts) {
        return this.value((v) => { material[prop] = v; material.update(); }, keys, opts);
    }

    // Set the shot length explicitly (render with --duration auto); use it when
    // repeating tracks make tl.duration shorter than the shot.
    setDuration(seconds) { this.duration = seconds; return this; }

    call(time, fn) {
        this.cues.push({ t: time, fn });
        this.duration = Math.max(this.duration, time);
        return this;
    }
}
