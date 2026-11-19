// The three.js side of the browser build.
//
// Constraint budget (docs/DESIGN.md, and the retro pipeline order):
//   res     320x224 (the Genesis's H40 screen), upscaled nearest at an integer scale
//   color   the game's 48 colours, all from the Genesis's 512; the last pass snaps every
//           virtual pixel to the palette with a 4x4 ordered dither, at 320x224
//   vertex  subpixel (no snapping); surface: nearest filtering
//   light   the 3D mid layer is toon-lit in 3 bands; the 2D layer is unlit pixel art
//   signal  none
//
// Each frame: the stage's far backdrop (a painted plane that scrolls slowly), the stage's
// mid scene as real 3D (the Blender glTF, three copies side by side so it repeats), then
// the 2D layer (tiles, objects, hero, HUD and every screen: a canvas texture on a quad in
// an orthographic scene), all into a 320x224 target; then the palette pass to the screen.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const W = 320;
const H = 224;
const PERIOD = 20;               // scene units across one repeat of a mid layer (backdrops.py)
const UNIT_H = PERIOD * H / 640; // the layer's height in scene units
const PX = PERIOD / 640;         // scene units per backdrop pixel

const QUANT_FRAG = `
precision highp float;
uniform sampler2D src;
uniform vec3 pal[48];
uniform vec2 res;
varying vec2 vUv;
const float bayer[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
float dist(vec3 a, vec3 b) {
  float rm = (a.r + b.r) * 0.5;
  vec3 d = a - b;
  return (2.0 + rm) * d.r * d.r + 4.0 * d.g * d.g + (3.0 - rm) * d.b * d.b;
}
void main() {
  vec2 px = floor(vUv * res);
  vec3 c = texture2D(src, (px + 0.5) / res).rgb;
  float d0 = 1e9, d1 = 1e9;
  vec3 c0 = c, c1 = c;
  for (int i = 0; i < 48; i++) {
    float d = dist(c, pal[i]);
    if (d < d0) { d1 = d0; c1 = c0; d0 = d; c0 = pal[i]; }
    else if (d < d1) { d1 = d; c1 = pal[i]; }
  }
  float t = d0 / max(d0 + d1, 1e-6);
  int bi = int(mod(px.y, 4.0)) * 4 + int(mod(px.x, 4.0));
  float thr = (bayer[bi] + 0.5) / 16.0;
  gl_FragColor = vec4((t > 0.18 && thr < t) ? c1 : c0, 1.0);
}`;
const QUAD_VERT = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export class Render3D {
  constructor(assets, canvas2d, palette) {
    this.A = assets;
    this.renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true, alpha: false });
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.id = 'screen';
    this.rt = new THREE.WebGLRenderTarget(W, H, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      depthBuffer: true });
    this.rt.texture.colorSpace = THREE.SRGBColorSpace;

    // the 3D backdrop scene
    this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(30, W / H, 0.1, 200);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(-4, 8, 10);
    this.scene.add(sun);
    this.far = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this.far.renderOrder = -1;
    this.scene.add(this.far);
    this.mid = new THREE.Group();
    this.scene.add(this.mid);
    this.theme = '';
    this.models = {};
    this.gradient = new THREE.DataTexture(new Uint8Array([90, 170, 255]), 3, 1, THREE.RedFormat);
    this.gradient.minFilter = THREE.NearestFilter;
    this.gradient.magFilter = THREE.NearestFilter;
    this.gradient.needsUpdate = true;

    // the 2D layer
    this.flat = new THREE.Scene();
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.tex2d = new THREE.CanvasTexture(canvas2d);
    this.tex2d.minFilter = THREE.NearestFilter;
    this.tex2d.magFilter = THREE.NearestFilter;
    this.tex2d.colorSpace = THREE.SRGBColorSpace;
    this.tex2d.generateMipmaps = false;
    this.flat.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2),
      new THREE.MeshBasicMaterial({ map: this.tex2d, transparent: true, depthTest: false })));

    // the palette pass
    const pal = palette.map(([r, g, b]) => new THREE.Vector3(r / 255, g / 255, b / 255));
    this.quant = new THREE.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: QUANT_FRAG, glslVersion: null,
      uniforms: { src: { value: this.rt.texture }, pal: { value: pal }, res: { value: new THREE.Vector2(W, H) } } });
    this.post = new THREE.Scene();
    this.post.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.quant));
    this.scale = 1;
  }

  mount(parent) {
    parent.appendChild(this.renderer.domElement);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  // integer scale, letterboxed
  resize() {
    const k = Math.max(1, Math.floor(Math.min(window.innerWidth / W, window.innerHeight / H)));
    this.scale = k;
    this.renderer.setSize(W * k, H * k, true);
  }

  async setTheme(theme) {
    if (theme === this.theme) return;
    this.theme = theme;
    const farImg = this.A.img[`backdrops/${theme}_far`];
    if (farImg) {
      const t = new THREE.Texture(farImg);
      t.minFilter = THREE.NearestFilter;
      t.magFilter = THREE.NearestFilter;
      t.wrapS = THREE.RepeatWrapping;
      t.colorSpace = THREE.SRGBColorSpace;
      t.needsUpdate = true;
      this.far.material.map = t;
      this.far.material.needsUpdate = true;
    }
    this.mid.clear();
    if (!(theme in this.models)) {
      this.models[theme] = null;
      try {
        const gltf = await new GLTFLoader().loadAsync(`${this.A.base}models/${theme}_mid.glb`);
        const root = gltf.scene;
        root.traverse((o) => {
          if (!o.isMesh) return;
          const m = o.material;
          const e = m.emissive && (m.emissive.r + m.emissive.g + m.emissive.b) > 0 ? m.emissive : m.color;
          // push the layer back, as the 2D build's import step does (import_renders.py)
          const col = new THREE.Color(e.r * 0.62, e.g * 0.62, e.b * 0.68 + 0.04);
          o.material = new THREE.MeshToonMaterial({ color: col, gradientMap: this.gradient });
        });
        this.models[theme] = root;
      } catch {
        this.models[theme] = null;
      }
    }
    const model = this.models[theme];
    if (model && this.theme === theme) {
      for (const dx of [-PERIOD, 0, PERIOD, 2 * PERIOD]) {
        const c = model.clone();
        c.position.x = dx;
        this.mid.add(c);
      }
    }
  }

  // camX, camY: the play camera in px (or null outside play)
  render(camX, camY, show3d) {
    const r = this.renderer;
    this.tex2d.needsUpdate = true;
    r.setRenderTarget(this.rt);
    r.setClearColor(0x000000, 1);
    r.clear();
    if (show3d) {
      // the camera frames one layer's height (so the view is UNIT_H * W / H wide); x follows
      // the play camera at the mid layer's parallax (0.45), wrapped to one repeat
      const viewW = UNIT_H * W / H;
      const dist = (UNIT_H / 2) / Math.tan(THREE.MathUtils.degToRad(15));
      const x = (((camX * 0.45 * PX) % PERIOD) + PERIOD) % PERIOD + viewW / 2;
      this.cam.position.set(x, UNIT_H / 2 + Math.min(camY, 200) * PX * 0.15, dist);
      this.cam.lookAt(x, UNIT_H / 2, 0);
      // the far plane fills the view behind everything; its texture scrolls at 0.2
      const back = 8;
      const fh = UNIT_H * (dist + back) / dist;
      const fw = fh * W / H;
      this.far.scale.set(fw, fh, 1);
      this.far.position.set(x, UNIT_H / 2, -back);
      if (this.far.material.map) {
        this.far.material.map.repeat.set(W / 640, 1);
        this.far.material.map.offset.x = (camX * 0.2) / 640;
      }
      r.render(this.scene, this.cam);
    }
    r.autoClear = false;
    r.render(this.flat, this.ortho);
    r.autoClear = true;
    r.setRenderTarget(null);
    r.render(this.post, this.ortho);
  }
}
