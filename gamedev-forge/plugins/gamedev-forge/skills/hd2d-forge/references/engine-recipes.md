# HD-2D engine recipes

Concrete setup for Godot 4, Unity 6 (URP), Unreal Engine 5 and three.js: the node, component
and setting names for each part of the pipeline in `rendering-pipeline.md`, and each
engine's known trap.

**Checked on 26 September 2026.** Sources: Godot class reference (4.7 stable and 4.8 dev
docs), the Unity 6 manual (6000.x) and URP shader source, Epic's UE5 documentation (5.6-5.8),
and three.js r186 source plus this skill's browser test. Engines change quickly: re-check
anything older than about three months against the engine's own docs. Items marked
**check** were not confirmed in official documentation.

## Contents

- [Godot 4](#godot-4)
- [Unity 6 URP](#unity-6-urp)
- [Unreal Engine 5](#unreal-engine-5)
- [three.js](#threejs)
- [Side-by-side summary](#side-by-side-summary)

---

## Godot 4

For general Godot practice (typed GDScript, headless checks, exports) use `godot-forge`.

**Renderer (dial 6).** Forward+ is clustered: 512 omni and 512 spot lights per cluster.
Mobile and Compatibility are forward single-pass: 8 omni and 8 spot lights **per mesh**.
Use Forward+ unless the target cannot run it. Decals do not work on Compatibility.

**Sprite.** Use a `MeshInstance3D` with a `QuadMesh`, not a `Sprite3D`:
- `Sprite3D.shaded` defaults to `false` (unlit), and `Sprite3D` has no normal-map slot.
- `QuadMesh.size` = frame size × `texel`; `center_offset = Vector3(0, height / 2, 0)` puts
  the pivot at the feet. QuadMesh faces +Z and generates the tangents a normal map needs.

`StandardMaterial3D` on the quad:

| Property | Value |
|---|---|
| `albedo_texture` | colour sheet |
| `texture_filter` | `TEXTURE_FILTER_NEAREST` (import the sheet with mipmaps off) |
| `transparency` | `TRANSPARENCY_ALPHA_SCISSOR`, `alpha_scissor_threshold = 0.5` |
| `normal_enabled` / `normal_texture` | on / normal sheet (Godot expects X+, Y+, Z+, the OpenGL convention) |
| `billboard_mode` | `BILLBOARD_FIXED_Y` (cylindrical) |
| `uv1_scale` / `uv1_offset` | frame selection: scale = (1/columns, 1/rows), offset = (column/columns, row/rows) |

**Shadows.** Add a second `MeshInstance3D` with the same quad and texture, a material
**without** billboarding, and `cast_shadow = SHADOW_CASTING_SETTING_SHADOWS_ONLY`. Turn it
toward the key light around Y in `_process`. Set the visible sprite's `cast_shadow` to off.
Tune `Light3D.shadow_bias` and `shadow_normal_bias` (defaults 0.1 and 2.0) down if the
shadow detaches from the feet. **Check:** how a billboarded material is oriented in the
shadow pass is not documented; the proxy avoids depending on it.

**Blob.** A `Decal` node under the character (Forward+ and Mobile), or a small dark
alpha-blended quad lying on the ground (all renderers).

**Contact shadows.** Not in 4.7 stable. The 4.8 development docs add
`rendering/lights_and_shadows/contact_shadow/enabled` (project setting, default off) and
per-light `shadow_contact_shadows_allow`, `_blur` and `_opacity`.

**Depth of field.** `CameraAttributesPractical` on the camera or `WorldEnvironment`:
`dof_blur_far_enabled`, `dof_blur_far_distance`, `dof_blur_far_transition`, the matching
`dof_blur_near_*`, and `dof_blur_amount`. Bokeh look: project settings
`rendering/camera/depth_of_field/depth_of_field_bokeh_shape` and `..._bokeh_quality`.

**Bloom and tone mapping.** `Environment.glow_enabled`, `glow_hdr_threshold` (keep ≥ 1.0),
`glow_blend_mode`; `tonemap_mode = TONE_MAPPER_ACES` or `TONE_MAPPER_AGX`.

**Trap.** Physics interpolation is off by default. **Heuristic:** move the camera in
`_process`, or enable interpolation, so camera-facing sprites do not jitter against the
world when the camera follows a physics body. Forward+-only features (SDFGI, VoxelGI, SSIL, volumetric fog) silently do
nothing on the other renderers; see `godot-forge`.

## Unity 6 URP

**Rendering path (dial 6).** Set on the Universal Renderer asset: Forward, Forward+,
Deferred, Deferred+ (Deferred+ since URP 17.1 / Unity 6.1). Forward: up to 9 lights per
object (1 main + 8 additional), 256 additional per camera on desktop. Forward+: no
per-object limit, up to 256 per camera, no per-vertex lights. Deferred: no per-object limit
for opaque objects, 9 for transparent ones; Deferred and Deferred+ need shader model 4.5 and
do not run on OpenGL / OpenGL ES; MSAA works in Forward and Forward+ only.

**Sprite.** Use a Quad with a `MeshRenderer` and a **URP Lit** (or Simple Lit) material:
- `SpriteRenderer` with `Sprite-Lit-Default` is lit only by **2D** lights in the 2D Renderer;
  under the Universal (3D) Renderer it renders unlit. 3D and 2D lights do not mix.
- Lit material: Surface Type Opaque, **Alpha Clipping** on, Threshold 0.5; Base Map = colour
  sheet; Normal Map = normal sheet; Render Face Both.
- Textures: Filter Mode Point, Compression None, Generate Mip Maps off. Normal sheet:
  Texture Type "Normal map". Unity expects Y+ (OpenGL); use "Flip Green Channel" on import
  for a DirectX sheet.
- Frame selection: material tiling and offset (`_BaseMap_ST`), or a MaterialPropertyBlock per
  renderer to avoid material copies.
- Billboarding: rotate the transform around Y toward the camera in `LateUpdate`, or do it in
  a Shader Graph vertex stage.

**Shadows.** The Lit shader's ShadowCaster pass applies Alpha Clipping (read from the URP
shader source), so the proxy casts a cutout shadow. Proxy: a second quad, same material,
`MeshRenderer.shadowCastingMode = ShadowCastingMode.ShadowsOnly`, turned toward the main
light around Y. Visible sprite: Cast Shadows Off, Receive Shadows On.

**Blob.** Add the **Decal Renderer Feature** (technique Automatic, DBuffer or Screen Space;
DBuffer needs a depth-normal prepass and does not support OpenGL/GLES) and a URP Decal
Projector under each character. (Using it for blob shadows is an inference; the docs do not
describe that use.)

**Contact shadows.** None found in URP (HDRP has them). URP's "Screen Space Shadows" renderer
feature resolves the main light's cascades into one screen texture; it is not a
contact-shadow effect. SSAO exists as a renderer feature and helps ground props.

**Depth of field.** Volume override Depth of Field, mode **Bokeh** (physically based: Focus
Distance, Focal Length in mm, Aperture as f-stop, blade count, curvature, rotation).
Gaussian mode is cheaper but blurs the far field only.

**Bloom and tone mapping.** Enable HDR on the URP Asset. Bloom Threshold is in **gamma
space** (default 0.9); raise it until only lights and emissives bloom. Tonemapping mode ACES
(or Neutral). Grading Mode High Dynamic Range grades before tone mapping.

**Trap.** A 2D-Renderer tutorial (Sprite-Lit-Default, Light 2D, normal maps via Secondary
Textures) does not carry over to a 3D scene: it is a separate renderer with separate lights.

## Unreal Engine 5

**Renderer (dial 6).** Deferred by default. Project Settings > Rendering > Forward Shading
switches to forward (editor restart); forward does not support SSR, SSAO, Contact Shadows or
dynamically shadowed translucency. Stay deferred for HD-2D.

**Sprite.** Paper2D sprites default to an unlit masked material. Use
`MaskedLitSpriteMaterial` or, for normal maps, a custom material:
- Blend Mode **Masked** (pixels below Opacity Mask Clip Value are discarded; lighting works),
  Shading Model Default Lit, Two Sided.
- Base Color from the colour sheet; Opacity Mask from its alpha; Normal from the normal sheet
  (Texture Sample set to Normal). Unreal expects DirectX (green down): generate with
  `--flip-green` or tick "Flip Green Channel" on the texture (Epic's asset guidelines state
  DirectX; **check** for your version).
- Pixel textures: filter Nearest, no mipmaps, uncompressed. **Check:** the texture group
  "2D Pixels (unfiltered)" sets these together in many versions.
- Whether the stock lit sprite materials sample a normal map is not documented (**check**);
  the custom material avoids the question.
- Billboarding: rotate the sprite component around Z toward the camera each tick. A World
  Position Offset billboard is cheaper but also runs in shadow passes (**check** how your
  version orients it there).

**Shadows.** Masked materials cast cutout shadows (implied by the "Cast Dynamic Shadow as
Masked" option for translucent materials; **check**). Proxy: a second sprite component with
the same material, hidden in game but still casting a shadow (**check** the property name in
your version, "Hidden Shadow" / `bCastHiddenShadow`), turned toward the key light.

**Contact shadows.** Per light: **Contact Shadow Length** (screen-space ray length; the
"Contact Shadow Length in World Space Units" option makes it world-space). Start small
(0.02-0.05 screen) on the key light; deferred only.

**Blob.** A Decal Actor with a soft dark material under each character.

**Depth of field.** Cinematic DoF with a `CineCameraActor`: Focus Method Manual or Tracking,
Current Focal Length, Current Aperture (f-stop); Post Process Volume: Focal Distance (cm),
Depth Blur settings. A long focal length at a moderate aperture gives the diorama falloff.

**Bloom and tone mapping.** Bloom Method Standard for games; Threshold is the luminance where
bloom starts (−1 lets everything contribute). The filmic tonemapper matches ACES.

**Trap.** Paper2D's default unlit material makes sprites ignore every light in the level;
the scene looks "done" in the editor until the first night scene.

## three.js

Use `assets/hd2d-threejs.js` (tested with three r186, `WebGLRenderer`, in headless
Chromium). Read `threejs-retro-forge/references/threejs-r18x.md` first for API currency.

```js
import * as THREE from 'three';
import * as HD2D from './hd2d-threejs.js';

const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;   // PCFSoftShadowMap was removed; PCF is soft now
const key = HD2D.createKeyLight({ elevationDeg: 40, azimuthDeg: 135 });
scene.add(key, key.target);
const hero = HD2D.createSprite({ map, normalMap, frameWidth: 32, frameHeight: 48, columns: 4, rows: 4 });
scene.add(hero.group);
const rig = HD2D.createCameraRig(camera, { pitchDeg: 32, fovDeg: 28, target: hero.group.position });
const post = HD2D.createDioramaPost(renderer, { focusDistance: 12, tiltShift: 0.3 });

renderer.setAnimationLoop(() => {
  rig.update();
  hero.update(camera, key);
  post.render(scene, camera);
});
```

What the module does, and what it verified:

| Part | How | Verified in the browser test |
|---|---|---|
| Sprite material | `MeshStandardMaterial`, `alphaTest`, nearest filtering, normal map (OpenGL) | cutout corner shows the ground; top rim lit from above; flipping green reverses it |
| Shadow proxy | same silhouette, `colorWrite: false, depthWrite: false`, faces the key light | full shadow at a camera angle where a self-shadowing sprite casts none |
| Blob | soft ellipse decal, turns with the sprite | darkens the contact point with shadow maps off |
| Post | HDR target + depth texture → bokeh DoF (+ tilt-shift) → bloom → ACES → sRGB | far ground blurred, focus sharp; frame edges blurred by tilt-shift; glow around an HDR emissive |

**Trap.** Shader function names in a `ShaderMaterial` share a namespace with the prologue
three.js injects (which already defines `RRTAndODTFit` and other tone-mapping helpers).
The browser test caught exactly this collision; the module prefixes its GLSL helpers with
`hd2d`.

## Side-by-side summary

| Need | Godot 4 | Unity 6 URP | Unreal 5 | three.js module |
|---|---|---|---|---|
| Many lights | Forward+ | Forward+ or Deferred | Deferred (default) | forward; keep lights few |
| Lit sprite | MeshInstance3D + QuadMesh + StandardMaterial3D | Quad + URP Lit, Alpha Clipping | Paper2D + custom Masked lit material | `createSprite` |
| Normal convention | OpenGL | OpenGL | DirectX | OpenGL |
| Cutout shadow proxy | cast_shadow Shadows Only | Cast Shadows: Shadows Only | hidden, still casting (**check**) | `colorWrite: false` proxy |
| Contact shadows | 4.8 dev only | none (use decal) | per-light Contact Shadow Length | none (blob) |
| Blob | Decal (not Compatibility) | Decal Projector | Decal Actor | built in |
| DoF | CameraAttributesPractical | Volume: DoF, Bokeh | Cinematic DoF, CineCamera | `createDioramaPost` |
| Bloom threshold | glow_hdr_threshold ≥ 1 | gamma space, raise above 0.9 | luminance threshold | HDR, default 1.2 |
| Tone map | ACES or AgX | ACES | filmic (ACES) | ACES (Hill fit) |
