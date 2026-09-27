// Image pipeline after the path tracer:
//   denoise  edge-aware à-trous wavelet filter (Dammertz et al. 2010) guided
//            by normal, depth, albedo and per-pixel variance, so it fades out
//            by itself as samples accumulate (the SVGF idea)
//   resolve  average the samples, apply exposure
//   bloom    downsample / upsample pyramid (lens glare)
//   film     vignetting, chromatic aberration, halation, white balance,
//            contrast, tone mapping, grain, dithering, sRGB encoding

export const FULLSCREEN_VERTEX = /* glsl */ `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

const HEADER = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
// NaN / infinity tests on the bit pattern (see trace.glsl.js).
bool badf(float x) { return (floatBitsToUint(x) & 0x7f800000u) == 0x7f800000u; }
bool bad3(vec3 v) { return badf(v.x) || badf(v.y) || badf(v.z); }
vec3 safe3(vec3 v) { return bad3(v) ? vec3(0) : v; }
`;

// Demodulate: illumination = colour / albedo, plus variance of the mean.
export const DENOISE_PREP = HEADER + /* glsl */ `
uniform sampler2D uColor, uAlbedo;
out vec4 outIllum;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 c = texelFetch(uColor, p, 0);
  vec4 a = texelFetch(uAlbedo, p, 0);
  float n = max(c.a, 1.0);
  vec3 color = safe3(c.rgb / n);
  vec3 albedo = bad3(a.rgb) ? vec3(1) : max(a.rgb / n, vec3(0.02));
  float lum = dot(color, vec3(0.2126, 0.7152, 0.0722));
  float variance = badf(a.a) ? 0.0 : max(0.0, a.a / n - lum * lum) / n;
  float la = dot(albedo, vec3(0.2126, 0.7152, 0.0722));
  outIllum = vec4(color / albedo, variance / (la * la));
}
`;

export const DENOISE_ATROUS = HEADER + /* glsl */ `
uniform sampler2D uIllum, uAux, uColor;
uniform int uStep;
uniform vec2 uResolution;
out vec4 outIllum;
const float K[3] = float[3](0.375, 0.25, 0.0625);
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  float n = max(texelFetch(uColor, p, 0).a, 1.0);
  vec4 ap = texelFetch(uAux, p, 0) / n;
  vec3 np = normalize(ap.xyz + 1e-6);
  float zp = ap.w;
  vec4 cp = texelFetch(uIllum, p, 0);
  float lp = dot(cp.rgb, vec3(0.2126, 0.7152, 0.0722));
  ivec2 size = ivec2(uResolution);
  // Per-pixel variance from few samples is itself noisy: blur it (3x3).
  float var = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      float k = (x == 0 ? 0.5 : 0.25) * (y == 0 ? 0.5 : 0.25);
      var += k * texelFetch(uIllum, clamp(p + ivec2(x, y), ivec2(0), size - 1), 0).a;
    }
  }
  float sigmaL = 6.0 * sqrt(max(var, 0.0)) + 1e-4;
  vec3 sum = vec3(0);
  float wsum = 0.0, vsum = 0.0;
  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      ivec2 q = clamp(p + ivec2(x, y) * uStep, ivec2(0), size - 1);
      vec4 aq = texelFetch(uAux, q, 0) / max(texelFetch(uColor, q, 0).a, 1.0);
      vec4 cq = texelFetch(uIllum, q, 0);
      float lq = dot(cq.rgb, vec3(0.2126, 0.7152, 0.0722));
      float wn = pow(max(0.0, dot(np, normalize(aq.xyz + 1e-6))), 64.0);
      float wz = exp(-abs(zp - aq.w) / (0.01 * zp * float(uStep) + 1e-3));
      float wl = exp(-abs(lp - lq) / sigmaL);
      float w = K[abs(x)] * K[abs(y)] * wn * wz * wl;
      if (badf(w) || bad3(cq.rgb) || badf(cq.a)) continue;
      sum += cq.rgb * w;
      vsum += cq.a * w * w;
      wsum += w;
    }
  }
  vec4 r = wsum > 1e-8 ? vec4(sum / wsum, vsum / (wsum * wsum)) : cp;
  outIllum = bad3(r.rgb) || badf(r.a) ? vec4(0) : r;
}
`;

// Average samples (or take the denoised illumination back to colour) and
// apply exposure. Output is exposed HDR, clamped to the half-float range.
export const RESOLVE = HEADER + /* glsl */ `
uniform sampler2D uColor, uAlbedo, uIllum;
uniform bool uDenoised;
uniform float uExposure;
out vec4 outHdr;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 c = texelFetch(uColor, p, 0);
  float n = max(c.a, 1.0);
  vec3 col;
  if (uDenoised) {
    vec3 albedo = max(texelFetch(uAlbedo, p, 0).rgb / n, vec3(0.02));
    col = texelFetch(uIllum, p, 0).rgb * albedo;
  } else {
    col = c.rgb / n;
  }
  col = safe3(col * uExposure);
  outHdr = vec4(clamp(col, vec3(0), vec3(60000.0)), 1.0);
}
`;

// 13-tap downsample (Jimenez, "Next Generation Post Processing in Call of Duty").
export const BLOOM_DOWN = HEADER + /* glsl */ `
uniform sampler2D uSrc;
uniform vec2 uSrcTexel;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / vec2(textureSize(uSrc, 0) / 2);
  vec2 t = uSrcTexel;
  vec3 a = texture(uSrc, uv + t * vec2(-2, 2)).rgb, b = texture(uSrc, uv + t * vec2(0, 2)).rgb, c = texture(uSrc, uv + t * vec2(2, 2)).rgb;
  vec3 d = texture(uSrc, uv + t * vec2(-2, 0)).rgb, e = texture(uSrc, uv).rgb, f = texture(uSrc, uv + t * vec2(2, 0)).rgb;
  vec3 g = texture(uSrc, uv + t * vec2(-2, -2)).rgb, h = texture(uSrc, uv + t * vec2(0, -2)).rgb, i = texture(uSrc, uv + t * vec2(2, -2)).rgb;
  vec3 j = texture(uSrc, uv + t * vec2(-1, 1)).rgb, k = texture(uSrc, uv + t * vec2(1, 1)).rgb;
  vec3 l = texture(uSrc, uv + t * vec2(-1, -1)).rgb, m = texture(uSrc, uv + t * vec2(1, -1)).rgb;
  vec3 s = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  outColor = vec4(s, 1.0);
}
`;

// 3x3 tent upsample, added onto the next-larger level.
export const BLOOM_UP = HEADER + /* glsl */ `
uniform sampler2D uSrc;
uniform vec2 uSrcTexel;
uniform vec2 uDstSize;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uDstSize;
  vec2 t = uSrcTexel;
  vec3 s = texture(uSrc, uv + t * vec2(-1, 1)).rgb + 2.0 * texture(uSrc, uv + t * vec2(0, 1)).rgb + texture(uSrc, uv + t * vec2(1, 1)).rgb
         + 2.0 * texture(uSrc, uv + t * vec2(-1, 0)).rgb + 4.0 * texture(uSrc, uv).rgb + 2.0 * texture(uSrc, uv + t * vec2(1, 0)).rgb
         + texture(uSrc, uv + t * vec2(-1, -1)).rgb + 2.0 * texture(uSrc, uv + t * vec2(0, -1)).rgb + texture(uSrc, uv + t * vec2(1, -1)).rgb;
  outColor = vec4(s / 16.0, 1.0);
}
`;

export const FILM = HEADER + /* glsl */ `
uniform sampler2D uHdr, uBloom;
uniform vec2 uResolution;
uniform float uBloomAmount, uBloomLevels, uHalation, uVignette, uAberration, uGrain, uGrainSize, uContrast, uSaturation;
uniform float uTanHalfW, uTanHalfH;
uniform vec3 uWhiteBalance;
uniform int uTonemap, uFrame;
out vec4 outColor;

// Minimal AgX (Troy Sobotka's AgX, fit by Benjamin Wrensch).
vec3 agxContrast(vec3 x) {
  vec3 x2 = x * x, x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 agx(vec3 v) {
  const mat3 inset = mat3(0.842479062253094, 0.0423282422610123, 0.0423756549057051,
                          0.0784335999999992, 0.878468636469772, 0.0784336,
                          0.0792237451477643, 0.0791661274605434, 0.879142973793104);
  const mat3 outset = mat3(1.19687900512017, -0.0528968517574562, -0.0529716355144438,
                           -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
                           -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
  const float minEv = -12.47393, maxEv = 4.026069;
  v = inset * v;
  v = clamp(log2(max(v, vec3(1e-10))), minEv, maxEv);
  v = (v - minEv) / (maxEv - minEv);
  v = agxContrast(v);
  v = outset * v;
  return pow(max(v, vec3(0)), vec3(2.2)); // back to linear for sRGB encoding
}
// ACES filmic fit (Krzysztof Narkowicz).
vec3 aces(vec3 x) {
  x *= 0.6;
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
vec3 srgbEncode(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float grainNoise(vec2 p, float seed) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i + seed), b = hash12(i + vec2(1, 0) + seed);
  float c = hash12(i + vec2(0, 1) + seed), d = hash12(i + vec2(1, 1) + seed);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Halation: light that passes through the film reflects off the back of the
// base and exposes the red layer again, in a thin ring around highlights.
// Real halation reaches a few pixels, not across the frame, and its rim
// saturates instead of growing with the highlight. So it is sampled from
// the image itself on two small rings (not from the wide bloom pyramid) and
// compressed: a lamp in view gets a red edge, not a red frame.
vec3 halation(vec2 uv) {
  vec2 px = 1.0 / uResolution;
  float r = max(1.5, uResolution.y / 400.0);
  vec3 sum = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.7853982;
    vec2 d = vec2(cos(a), sin(a)) * px * r;
    sum += safe3(texture(uHdr, uv + d).rgb) + safe3(texture(uHdr, uv + d * 2.5).rgb);
  }
  // Only light above paper white (1.0 after exposure) causes halation.
  vec3 over = max(sum / 16.0 - 1.0, vec3(0.0));
  float l = dot(over, vec3(0.2126, 0.7152, 0.0722));
  return vec3(1.0, 0.28, 0.1) * (l / (1.0 + 0.5 * l));
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec2 c = uv - 0.5;
  float k = uAberration * 0.006;
  vec3 col;
  col.r = texture(uHdr, 0.5 + c * (1.0 + k)).r;
  col.g = texture(uHdr, uv).g;
  col.b = texture(uHdr, 0.5 + c * (1.0 - k)).b;

  // The pyramid adds its levels together; divide to keep energy.
  vec3 bloom = safe3(texture(uBloom, uv).rgb / uBloomLevels);
  col = safe3(col);
  col = mix(col, bloom, uBloomAmount);
  if (uHalation > 0.0) col += uHalation * 0.6 * halation(uv);

  // Natural vignetting of an ideal lens: cos^4 of the angle off axis.
  vec2 tanXY = (uv * 2.0 - 1.0) * vec2(uTanHalfW, uTanHalfH);
  float cos2 = 1.0 / (1.0 + dot(tanXY, tanXY));
  col *= mix(1.0, cos2 * cos2, uVignette);

  col *= uWhiteBalance;
  if (uContrast != 1.0) col = 0.18 * pow(max(col, vec3(0)) / 0.18, vec3(uContrast));
  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = max(mix(vec3(luma), col, uSaturation), vec3(0));

  if (uTonemap == 0) col = agx(col);
  else if (uTonemap == 1) col = aces(col);
  else if (uTonemap == 2) col = col / (1.0 + dot(col, vec3(0.2126, 0.7152, 0.0722)));

  vec3 display = srgbEncode(col);

  if (uGrain > 0.0) {
    float seed = float(uFrame % 997) * 17.13;
    vec2 gp = gl_FragCoord.xy / max(uGrainSize, 0.5);
    float g = grainNoise(gp, seed) + grainNoise(gp * 1.7 + 11.0, seed) + grainNoise(gp * 0.6 + 5.0, seed) - 1.5;
    float l = dot(display, vec3(0.2126, 0.7152, 0.0722));
    float amount = uGrain * 0.22 * (0.35 + 4.0 * l * (1.0 - l)); // strongest in the mid-tones
    display += g * amount;
  }
  // Triangular dither to hide banding in 8-bit output.
  display += (hash12(gl_FragCoord.xy + float(uFrame % 61)) + hash12(gl_FragCoord.yx * 1.3) - 1.0) / 255.0;
  outColor = vec4(bad3(display) ? vec3(0) : clamp(display, 0.0, 1.0), 1.0);
}
`;
