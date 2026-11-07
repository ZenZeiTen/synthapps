# Upscaling shaders

Unmodified copies from [libretro/glsl-shaders](https://github.com/libretro/glsl-shaders)
(`xbr/shaders/xbr-lv2.glsl` and `scalefx/shaders/scalefx-pass0..4.glsl`). Both are under
the MIT licence; the copyright notice is at the top of each file:

- xBR-lv2: Copyright (C) 2011-2016 Hyllian
- ScaleFX: Copyright (c) 2016 Sp00kyFox

`src/server.js` (`SHADER_PRESETS`) turns them into presets for EmulatorJS (`EJS_shaders`),
with the same pass settings as the upstream `xbr-lv2.glslp` and `scalefx.glslp`. When served, `glslForWebgl1()`
removes the `#version 130` line and rewrites xBR's three `mul(mat4x3(...), v)` lines as the
equivalent dot products, so they also compile in WebGL 1 (GLSL ES 1.00).
