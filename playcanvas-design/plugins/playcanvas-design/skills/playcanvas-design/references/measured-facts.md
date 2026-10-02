# Measured facts (2026-10-02)

Each fact was run, not read. The setup was Windows 11, an RTX 4050 laptop and Chrome 154.0.8037.93, with
PlayCanvas engine 2.23.0 (npm, code scenes) and 2.22.6 (an Editor static build of a small
rolling-ball physics demo), Blender 5.2.2 LTS, Python 3.14 + Pillow 12.2, and Node 24.14.
Re-measure when a version changes.

1. **The deterministic clock works.** Holding the engine's rAF callback (the class-field arrow `app.tick`,
   whose `.name` is `"tick"` in both the npm and the minified Editor build) and calling `tick(t)`
   with t advancing 1000/fps gives `dt = 1/fps` every update. A timeline key at 0.6 s was hit
   exactly on frame 18 at 30 fps (y = 1.6000).
2. **Runs are reproducible.** The same scene rendered twice gave 90/90 byte-identical PNGs (MD5).
3. **The first tick has dt = 0**, because `_time` starts at 0. Frame 0 is the initialized scene at t = 0.
4. **Headless Chrome uses the GPU.** `--headless=new` renders real WebGL2 with PCF shadows and
   tone mapping (no SwiftShader fallback) on the test machine. `deviceType` reports `webgl2`.
5. **Readback works.** `canvas.toBlob()` straight after `tick()` captures the frame when
   preserveDrawingBuffer is true. Code scenes set it from `window.__RENDER__.capture`.
6. **How Editor static builds create their device.** `__settings__.js` assigns `window.CONTEXT_OPTIONS`
   (deviceTypes, alpha, preserveDrawingBuffer), and `__start__.js` passes it to
   `pc.createGraphicsDevice`. `config.json` application_properties are *not* used for the device.
   The recorder traps the global with a property setter so overrides survive the assignment.
7. **Editor builds expose `pc`** as a global (UMD `playcanvas-stable.min.js`) and the app as `pc.app`.
   `pc.GltfExporter` is in that build.
8. **pc.Keyboard reads `event.keyCode`.** A synthetic `KeyboardEvent({key})` has keyCode 0 and is
   ignored. `__renderKey` defines keyCode/which getters. Measured: holding W+D in a hook moved the
   ball from z 3.000 to −0.157 over 2 s at 30 fps.
9. **Anim component scrubbing.**
   - A layer whose component has `playing = false` never leaves its START state, so
     `layer.activeStateCurrentTime = t` does nothing.
   - What works: keep the layer playing with `anim.speed = 0`, then set
     `activeStateCurrentTime` in an `app.systems.on('update')` handler. That fires inside the
     tick, before the `animationUpdate` pass.
   - Setting it in `app.on('update')` or `prerender` comes a frame late, or never takes effect.
10. **Blender's glTF export splits animations.** It wrote one animation clip per animated object
    (here two clips, "Head" and "Shoulder"), and key times are `frame / fps`, so frame 1 is
    0.0417 s, not 0. The turntable plays all clips at once, one anim layer each.
11. **Atlas rects count y from the bottom.** PlayCanvas `TextureAtlas` frame rects measure y from the
    image bottom (`bv = 1 - rect.y/texHeight`). spritesheet.py's `.playcanvas.json` was rendered back
    through `pc.Sprite`, and each sprite matched its own cell (mean abs error 10–17 against 53–71
    for other cells). That test converted the JSON arrays to `pc.Vec4`/`pc.Vec2` first.
    Assigning the raw arrays gives NaN bounds and a blank sprite (found by the fresh-agent test).
12. **Blender 5.x video output changed.** You must set `image_settings.media_type = 'VIDEO'` before
    `file_format = 'FFMPEG'` (the enum no longer lists FFMPEG otherwise), and VSE uses
    `sequence_editor.strips` (an empty collection is falsy; use `hasattr`). The MP4 read back
    as 90 frames, 30 fps, 640×360, with frame 0 mean colour within 0.5/255 of the PNG.
13. **Speed.** About 2.4 s startup. 300 frames at 1920×1080 took 12.8 s total, roughly 29 frames/s
    (template scene). 90 frames at 640×360 took 4.1 s. A Blender MP4 encode of 90 frames at
    640×360 took 3.6 s.
14. **GLB round trip.** `new pc.GltfExporter().build(entity, {maxTextureSize})` on the Editor
    build's `Platforms` group gave 37 KB. Blender imported 9 meshes, 3 materials and 1 image
    with entity names intact.
15. **A frame-rate dependency exists in the demo project.** Its movement script applies its impulse every frame
    without dt. Renders at 30 fps move the ball far less per second than the about 165 fps launch window.
16. **The Editor MCP can stop answering mid-session.** After `download_build`, later calls
    (`delete_build`, `list_builds`, `vcs_status`) timed out after 60 s each. The bridge
    needs the Editor tab alive and connected; ask the user to check it, and list any cleanup still owed.
17. **ffmpeg was not installed on the test machine.** encode.py falls back to Blender for video. Pillow
    handles GIF (with 1-bit transparency), lossless or lossy animated WebP, and APNG.
18. **The Editor atlas path works via MCP.** `upload_assets` type `textureatlas` kept a 1166×1738
    (non-power-of-two) PNG at full size. `modify_sprite_asset {frames}` stored spritesheet.py's
    rects verbatim. `create_assets` sprite with `textureAtlas` + `frameKeys` succeeded. New atlases
    default to `minfilter linear_mip_linear`, `magfilter linear` and `mipmaps false`. Probe assets were deleted afterwards.
19. **GIF delays are centiseconds.** Pillow stored a 33 ms delay as 30 ms, so 90 frames at 30 fps played
    in 2700 ms instead of 3000. With cumulative rounding (3/3/4 cs) the readback is exactly
    3000 ms (and 3750 ms at 24 fps). Pillow does not expose animated-WebP durations in `info`.
    The ANMF chunks hold them (33/34 ms, total 3000), and encode.py reads those back.
20. **Fog vs. clear colour under ACES** (measured by the fresh-agent test). Fog is tone-mapped and
    the camera clear colour is not: fog (4,5,7) against clear (9,10,14) at the horizon. Fog
    0.062/0.07/0.094 matched clear 0.035/0.04/0.055 to within 1/255.
21. **Floor gloss 0.35–0.4 plus an omni rim light behind the subject** gives a large specular
    hotspot on the floor in front (fresh-agent test). 0.25 avoids it.
22. **Loop proof.** A 4 s staggered-bounce loop rendered with `--duration auto --extra 1` (121
    frames) had frame 120 byte-identical to frame 0. The wrap step was 1.883 against normal steps
    0.926–3.231. A non-looping 3 s orbit gave DIFFERENT and a wrap step of 9.675 against
    0.029–1.316, and review.py exits 1 on it. Repeating tracks used `{period: 1, offset: i*0.1}`.
    Sphere 2 landed on frame 6 with y 0.3280 and scale.y 0.6560, exactly the squash keys.
