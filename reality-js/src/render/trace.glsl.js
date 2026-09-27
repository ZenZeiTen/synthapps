// The path tracer, one sample per pixel per pass, accumulated over passes.
//
// Light transport: unidirectional path tracing with next-event estimation
// toward the sun, the environment and area lights, combined with BSDF
// sampling by multiple importance sampling (power heuristic). Surfaces use
// a layered model: clearcoat over metal / specular-over-diffuse, with GGX
// microfacets sampled by visible normals; transmissive materials use a
// rough dielectric (Walter et al. 2007) and Beer-Lambert absorption. A
// homogeneous fog layer is path traced with free-flight sampling and a
// Henyey-Greenstein phase function. Motion blur comes from sampling a time
// inside the shutter for every path; depth of field from a thin lens with a
// round or polygonal aperture.

import { DATA_WIDTH, OBJECT_TEXELS, MATERIAL_TEXELS, LIGHT_TEXELS } from './pack.js';

export const TRACE_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler2DArray;

#define DATA_W ${DATA_WIDTH}
#define OBJ_TX ${OBJECT_TEXELS}
#define MAT_TX ${MATERIAL_TEXELS}
#define LIGHT_TX ${LIGHT_TEXELS}
#define PI 3.14159265358979
#define INF 1e20
#define EPS 1e-4

layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outAux;
layout(location = 2) out vec4 outAlbedo;

uniform sampler2D uPrevColor, uPrevAux, uPrevAlbedo;
uniform sampler2D uObjects, uMaterials, uLights, uBvh, uTris;
uniform sampler2D uEnv, uEnvPdf, uEnvCond, uEnvMarg;
uniform sampler2DArray uTextures;

uniform int uObjectCount, uLightCount, uFrame, uMaxBounces, uAccumulate;
uniform vec2 uResolution;
uniform ivec2 uEnvSize;
uniform float uEnvRotation;
uniform bool uEnvVisible;
uniform bool uSunOn;
uniform vec3 uSunDir, uSunRadiance;
uniform float uSunCosMax, uSunOneMinusCos;
uniform vec3 uCamPos[2], uCamRight[2], uCamUp[2], uCamFwd[2];
uniform float uTanHalfW, uTanHalfH, uLensRadius, uFocus, uBlades, uBladeRot, uDistortion;
uniform float uShutterSpan, uRollingSpan, uTime;
uniform vec4 uFog;        // density, anisotropy, top height, enabled
uniform vec3 uFogAlbedo;
uniform float uClamp;

// ---------------------------------------------------------------- random
uint rngState;
uint pcg(uint v) {
  uint state = v * 747796405u + 2891336453u;
  uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}
float rand() {
  rngState = pcg(rngState);
  return float(rngState) * (1.0 / 4294967296.0);
}

// ---------------------------------------------------------------- data
vec4 fetch(sampler2D s, int i) { return texelFetch(s, ivec2(i % DATA_W, i / DATA_W), 0); }

float gTime; // position inside the shutter, 0..1, for this path

void objectInverse(int i, out vec4 r0, out vec4 r1, out vec4 r2) {
  int b = i * OBJ_TX;
  r0 = mix(fetch(uObjects, b + 1), fetch(uObjects, b + 4), gTime);
  r1 = mix(fetch(uObjects, b + 2), fetch(uObjects, b + 5), gTime);
  r2 = mix(fetch(uObjects, b + 3), fetch(uObjects, b + 6), gTime);
}

// ---------------------------------------------------------------- intersection
struct Hit {
  float t;
  int obj;
  vec3 nObj;   // object-space geometric normal
  vec3 pObj;   // object-space position
  int tri;     // triangle index for meshes, else -1
  vec2 bary;
};

float hitSphere(vec3 o, vec3 d, float tmax, out vec3 n) {
  float a = dot(d, d), b = dot(o, d), c = dot(o, o) - 1.0;
  float disc = b * b - a * c;
  if (disc < 0.0) return INF;
  float s = sqrt(disc);
  float t = (-b - s) / a;
  if (t < EPS) t = (-b + s) / a;
  if (t < EPS || t > tmax) return INF;
  n = o + d * t;
  return t;
}

float hitBox(vec3 o, vec3 d, float tmax, out vec3 n) {
  vec3 inv = 1.0 / d;
  vec3 ta = (vec3(-0.5) - o) * inv, tb = (vec3(0.5) - o) * inv;
  vec3 t0 = min(ta, tb), t1 = max(ta, tb);
  float tn = max(max(t0.x, t0.y), t0.z), tf = min(min(t1.x, t1.y), t1.z);
  if (tn > tf) return INF;
  float t = tn > EPS ? tn : tf;
  if (t < EPS || t > tmax) return INF;
  vec3 p = o + d * t;
  vec3 a = abs(p);
  n = a.x > a.y && a.x > a.z ? vec3(sign(p.x), 0, 0) : a.y > a.z ? vec3(0, sign(p.y), 0) : vec3(0, 0, sign(p.z));
  return t;
}

float hitPlaneY(vec3 o, vec3 d, float tmax) {
  if (abs(d.y) < 1e-12) return INF;
  float t = -o.y / d.y;
  return (t < EPS || t > tmax) ? INF : t;
}

float hitCylinder(vec3 o, vec3 d, float tmax, out vec3 n) {
  float best = INF;
  float a = d.x * d.x + d.z * d.z;
  if (a > 1e-12) {
    float b = o.x * d.x + o.z * d.z, c = o.x * o.x + o.z * o.z - 1.0;
    float disc = b * b - a * c;
    if (disc >= 0.0) {
      float s = sqrt(disc);
      for (int k = 0; k < 2; k++) {
        float t = (-b + (k == 0 ? -s : s)) / a;
        float y = o.y + d.y * t;
        if (t > EPS && t < best && t < tmax && abs(y) <= 0.5) {
          best = t;
          n = vec3(o.x + d.x * t, 0, o.z + d.z * t);
        }
      }
    }
  }
  if (abs(d.y) > 1e-12) {
    for (int k = 0; k < 2; k++) {
      float cy = k == 0 ? -0.5 : 0.5;
      float t = (cy - o.y) / d.y;
      vec3 p = o + d * t;
      if (t > EPS && t < best && t < tmax && p.x * p.x + p.z * p.z <= 1.0) {
        best = t;
        n = vec3(0, sign(cy), 0);
      }
    }
  }
  return best;
}

float hitAABB(vec3 lo, vec3 hi, vec3 o, vec3 inv, float tmax) {
  vec3 ta = (lo - o) * inv, tb = (hi - o) * inv;
  vec3 t0 = min(ta, tb), t1 = max(ta, tb);
  float tn = max(max(t0.x, t0.y), max(t0.z, 0.0));
  float tf = min(min(t1.x, t1.y), min(t1.z, tmax));
  return tn <= tf ? tn : INF;
}

float hitTri(int tri, vec3 o, vec3 d, float tmax, out vec2 bary) {
  int b = tri * 6;
  vec3 v0 = fetch(uTris, b).xyz, v1 = fetch(uTris, b + 1).xyz, v2 = fetch(uTris, b + 2).xyz;
  vec3 e1 = v1 - v0, e2 = v2 - v0;
  vec3 pv = cross(d, e2);
  float det = dot(e1, pv);
  if (abs(det) < 1e-14) return INF;
  float id = 1.0 / det;
  vec3 tv = o - v0;
  float u = dot(tv, pv) * id;
  if (u < 0.0 || u > 1.0) return INF;
  vec3 q = cross(tv, e1);
  float v = dot(d, q) * id;
  if (v < 0.0 || u + v > 1.0) return INF;
  float t = dot(e2, q) * id;
  if (t < EPS || t > tmax) return INF;
  bary = vec2(u, v);
  return t;
}

float hitMesh(int root, vec3 o, vec3 d, float tmax, bool anyHit, out int triOut, out vec2 baryOut) {
  vec3 dd = d;
  dd.x = abs(dd.x) < 1e-12 ? 1e-12 : dd.x;
  dd.y = abs(dd.y) < 1e-12 ? 1e-12 : dd.y;
  dd.z = abs(dd.z) < 1e-12 ? 1e-12 : dd.z;
  vec3 inv = 1.0 / dd;
  int stack[40];
  int sp = 0;
  stack[sp++] = root;
  float best = tmax;
  triOut = -1;
  while (sp > 0) {
    int ni = stack[--sp];
    vec4 a = fetch(uBvh, ni * 2), b = fetch(uBvh, ni * 2 + 1);
    if (hitAABB(a.xyz, b.xyz, o, inv, best) >= INF) continue;
    int count = int(b.w), first = int(a.w);
    if (count > 0) {
      for (int k = 0; k < count; k++) {
        vec2 bc;
        float t = hitTri(first + k, o, d, best, bc);
        if (t < best) {
          best = t; triOut = first + k; baryOut = bc;
          if (anyHit) return best;
        }
      }
    } else if (sp < 38) {
      vec4 la = fetch(uBvh, first * 2), lb = fetch(uBvh, first * 2 + 1);
      vec4 ra = fetch(uBvh, first * 2 + 2), rb = fetch(uBvh, first * 2 + 3);
      float tl = hitAABB(la.xyz, lb.xyz, o, inv, best);
      float tr = hitAABB(ra.xyz, rb.xyz, o, inv, best);
      // Push the farther child first so the nearer one is visited first.
      if (tl < tr) {
        if (tr < INF) stack[sp++] = first + 1;
        if (tl < INF) stack[sp++] = first;
      } else {
        if (tl < INF) stack[sp++] = first;
        if (tr < INF) stack[sp++] = first + 1;
      }
    }
  }
  return triOut >= 0 ? best : INF;
}

// Closest hit, or any hit closer than tmax when anyHit is set.
bool trace(vec3 ro, vec3 rd, float tmax, bool anyHit, out Hit h) {
  h.t = tmax;
  h.obj = -1;
  h.tri = -1;
  for (int i = 0; i < uObjectCount; i++) {
    vec4 head = fetch(uObjects, i * OBJ_TX);
    int shape = int(head.x);
    vec4 r0, r1, r2;
    objectInverse(i, r0, r1, r2);
    vec3 o = vec3(dot(r0, vec4(ro, 1)), dot(r1, vec4(ro, 1)), dot(r2, vec4(ro, 1)));
    vec3 d = vec3(dot(r0.xyz, rd), dot(r1.xyz, rd), dot(r2.xyz, rd));
    float t = INF;
    vec3 n = vec3(0, 1, 0);
    int tri = -1;
    vec2 bary = vec2(0);
    if (shape == 0) t = hitSphere(o, d, h.t, n);
    else if (shape == 1) t = hitBox(o, d, h.t, n);
    else if (shape == 2) t = hitPlaneY(o, d, h.t);
    else if (shape == 3) {
      t = hitPlaneY(o, d, h.t);
      if (t < INF) { vec3 p = o + d * t; if (p.x * p.x + p.z * p.z > 1.0) t = INF; }
    } else if (shape == 4) {
      t = hitPlaneY(o, d, h.t);
      if (t < INF) { vec3 p = o + d * t; if (abs(p.x) > 0.5 || abs(p.z) > 0.5) t = INF; }
    } else if (shape == 5) t = hitCylinder(o, d, h.t, n);
    else if (shape == 6) t = hitMesh(int(head.z), o, d, h.t, anyHit, tri, bary);
    if (t < h.t) {
      h.t = t;
      h.obj = i;
      h.nObj = n;
      h.pObj = o + d * t;
      h.tri = tri;
      h.bary = bary;
      if (anyHit) return true;
    }
  }
  return h.obj >= 0;
}

bool occluded(vec3 ro, vec3 rd, float dist) {
  Hit h;
  return trace(ro, rd, dist, true, h);
}

// ---------------------------------------------------------------- noise and patterns
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), u.x),
                 mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), u.x), u.y),
             mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), u.x),
                 mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), u.x), u.y), u.z);
}
float fbm(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; }
  return s / 0.96875;
}

float pattern(int kind, vec3 q) {
  if (kind == 1) return mod(floor(q.x) + floor(q.y) + floor(q.z), 2.0);
  if (kind == 2) {
    vec2 g = abs(fract(q.xz + 0.5) - 0.5);
    return 1.0 - smoothstep(0.02, 0.035, min(g.x, g.y));
  }
  if (kind == 3) return smoothstep(0.25, 0.75, fbm(q));
  if (kind == 4) return pow(0.5 + 0.5 * sin(q.x * 3.0 + fbm(q) * 9.0), 3.0);
  if (kind == 5) {
    float r = length(q.xz) * 6.0 + fbm(q * vec3(1, 0.15, 1) * 2.0) * 3.0;
    return smoothstep(0.35, 0.65, fract(r)) * 0.8 + 0.2 * fbm(q * 12.0);
  }
  if (kind == 6) return step(0.5, fract(q.x));
  return 0.0;
}

// ---------------------------------------------------------------- materials
struct Mat {
  vec3 color;
  float rough;
  float metal;
  float trans;
  float ior;
  float coat;
  vec3 emit;
  float spec;
  vec3 absorb;
  float coatRough;
  bool thin;
};

// Sample the texture from three sides and blend by the normal.
vec3 triplanar(float layer, vec3 p, vec3 n) {
  vec3 w = pow(abs(n), vec3(4));
  w /= (w.x + w.y + w.z);
  vec3 a = textureLod(uTextures, vec3(p.zy, layer), 0.0).rgb;
  vec3 b = textureLod(uTextures, vec3(p.xz, layer), 0.0).rgb;
  vec3 c = textureLod(uTextures, vec3(p.xy, layer), 0.0).rgb;
  return a * w.x + b * w.y + c * w.z;
}

Mat loadMaterial(int obj, vec3 pObj, vec3 nObj, vec4 r0, vec4 r1, vec4 r2, inout vec3 ns) {
  int b = obj * MAT_TX;
  vec4 t0 = fetch(uMaterials, b), t1 = fetch(uMaterials, b + 1), t2 = fetch(uMaterials, b + 2);
  vec4 t3 = fetch(uMaterials, b + 3), t4 = fetch(uMaterials, b + 4), t5 = fetch(uMaterials, b + 5);
  vec4 t6 = fetch(uMaterials, b + 6), t7 = fetch(uMaterials, b + 7);
  Mat m;
  m.color = t0.rgb; m.rough = t0.a;
  m.metal = t1.x; m.trans = t1.y; m.ior = t1.z; m.coat = t1.w;
  m.emit = t2.rgb; m.spec = t2.a;
  m.absorb = t6.rgb; m.coatRough = t6.a;
  m.thin = t7.x > 0.5;

  vec3 scaleW = fetch(uObjects, obj * OBJ_TX + 7).xyz;
  vec3 pM = pObj * scaleW - t5.xyz * uTime; // object-local position in metres, drifting with flow
  int pat = int(t3.x);
  if (pat > 0) {
    float f = pattern(pat, pM * t3.y);
    m.color = mix(m.color, t4.rgb, f);
    m.rough = mix(m.rough, t4.a, f);
  }
  if (t3.w >= 0.0) {
    m.color *= triplanar(t3.w, pObj * scaleW * t5.w, normalize(nObj));
  }
  if (t3.z > 0.0) {
    // Bump: tilt the shading normal along the gradient of a noise field.
    vec3 q = pM * t7.y;
    float h = 0.02;
    vec3 g = vec3(fbm(q + vec3(h, 0, 0)) - fbm(q - vec3(h, 0, 0)),
                  fbm(q + vec3(0, h, 0)) - fbm(q - vec3(0, h, 0)),
                  fbm(q + vec3(0, 0, h)) - fbm(q - vec3(0, 0, h))) / (2.0 * h);
    vec3 gw = g.x * r0.xyz + g.y * r1.xyz + g.z * r2.xyz;
    float gl = length(gw);
    if (gl > 0.0) {
      gw = gw / gl * length(g);
      vec3 tang = gw - dot(gw, ns) * ns;
      ns = normalize(ns - t3.z * 0.5 * tang);
    }
  }
  return m;
}

// ---------------------------------------------------------------- BSDF
float D_GGX(float NoH, float a) {
  float a2 = a * a;
  float d = NoH * NoH * (a2 - 1.0) + 1.0;
  return a2 / (PI * d * d);
}
float G1(float NoV, float a) {
  float a2 = a * a;
  return 2.0 * NoV / (NoV + sqrt(a2 + (1.0 - a2) * NoV * NoV));
}
float schlick1(float F0, float c) { return F0 + (1.0 - F0) * pow(1.0 - clamp(c, 0.0, 1.0), 5.0); }
vec3 schlick3(vec3 F0, float c) { return F0 + (1.0 - F0) * pow(1.0 - clamp(c, 0.0, 1.0), 5.0); }

float fresnelDielectric(float cosi, float eta) {
  float sint2 = eta * eta * (1.0 - cosi * cosi);
  if (sint2 >= 1.0) return 1.0;
  float cost = sqrt(1.0 - sint2);
  float rs = (eta * cosi - cost) / (eta * cosi + cost);
  float rp = (cosi - eta * cost) / (cosi + eta * cost);
  return 0.5 * (rs * rs + rp * rp);
}

// Visible-normal sampling of GGX (Heitz 2018). Ve and result in tangent space.
vec3 sampleVNDF(vec3 Ve, float a, float u1, float u2) {
  vec3 Vh = normalize(vec3(a * Ve.x, a * Ve.y, Ve.z));
  float lensq = Vh.x * Vh.x + Vh.y * Vh.y;
  vec3 T1 = lensq > 0.0 ? vec3(-Vh.y, Vh.x, 0) * inversesqrt(lensq) : vec3(1, 0, 0);
  vec3 T2 = cross(Vh, T1);
  float r = sqrt(u1), phi = 2.0 * PI * u2;
  float p1 = r * cos(phi), p2 = r * sin(phi);
  float s = 0.5 * (1.0 + Vh.z);
  p2 = (1.0 - s) * sqrt(max(0.0, 1.0 - p1 * p1)) + s * p2;
  vec3 Nh = p1 * T1 + p2 * T2 + sqrt(max(0.0, 1.0 - p1 * p1 - p2 * p2)) * Vh;
  return normalize(vec3(a * Nh.x, a * Nh.y, max(1e-6, Nh.z)));
}

vec3 cosineHemisphere(float u1, float u2) {
  float r = sqrt(u1), phi = 2.0 * PI * u2;
  return vec3(r * cos(phi), r * sin(phi), sqrt(max(0.0, 1.0 - u1)));
}

void basis(vec3 n, out vec3 t, out vec3 b) {
  float s = n.z >= 0.0 ? 1.0 : -1.0;
  float a = -1.0 / (s + n.z);
  float c = n.x * n.y * a;
  t = vec3(1.0 + s * n.x * n.x * a, s * c, -s * n.x);
  b = vec3(c, s + n.y * n.y * a, -n.y);
}

// Probabilities of the opaque lobes: clearcoat, metal, specular, diffuse.
// Schlick Fresnel whose grazing peak drops with roughness: rough surfaces
// do not turn into mirrors at grazing angles (Fdez-Agüera 2019).
float schlickRough(float F0, float c, float rough) {
  return F0 + (max(1.0 - rough, F0) - F0) * pow(1.0 - clamp(c, 0.0, 1.0), 5.0);
}

vec4 lobeWeights(Mat m, float NoV) {
  float pc = m.coat * schlickRough(0.04, NoV, m.coatRough);
  float rest = 1.0 - pc;
  float pm = rest * m.metal;
  float Fs = schlickRough(0.08 * m.spec, NoV, m.rough);
  float ps = rest * (1.0 - m.metal) * Fs;
  float pd = rest * (1.0 - m.metal) * (1.0 - Fs);
  return vec4(pc, pm, ps, pd);
}

// f(wo, wi) * cos(theta_i) and the pdf of sampling wi, tangent space.
vec3 evalOpaque(Mat m, vec3 wo, vec3 wi, out float pdf) {
  pdf = 0.0;
  if (wi.z <= 0.0 || wo.z <= 0.0) return vec3(0);
  vec3 h = normalize(wo + wi);
  vec4 L = lobeWeights(m, wo.z);
  float a = max(1e-3, m.rough * m.rough);
  float ac = max(1e-3, m.coatRough * m.coatRough);
  vec3 f = vec3(0);
  if (L.x > 0.0) {
    float D = D_GGX(h.z, ac), g1o = G1(wo.z, ac);
    f += vec3(L.x * D * g1o * G1(wi.z, ac) / (4.0 * wo.z));
    pdf += L.x * g1o * D / (4.0 * wo.z);
  }
  if (L.y + L.z > 0.0) {
    float D = D_GGX(h.z, a), g1o = G1(wo.z, a);
    float spec = D * g1o * G1(wi.z, a) / (4.0 * wo.z);
    f += L.y * schlick3(m.color, dot(wo, h)) * spec + vec3(L.z * spec);
    pdf += (L.y + L.z) * g1o * D / (4.0 * wo.z);
  }
  if (L.w > 0.0) {
    f += L.w * m.color / PI * wi.z;
    pdf += L.w * wi.z / PI;
  }
  return f;
}

bool sampleOpaque(Mat m, vec3 wo, out vec3 wi) {
  vec4 L = lobeWeights(m, wo.z);
  float u = rand();
  float u1 = rand(), u2 = rand();
  if (u < L.x) {
    vec3 h = sampleVNDF(wo, max(1e-3, m.coatRough * m.coatRough), u1, u2);
    wi = reflect(-wo, h);
  } else if (u < L.x + L.y + L.z) {
    vec3 h = sampleVNDF(wo, max(1e-3, m.rough * m.rough), u1, u2);
    wi = reflect(-wo, h);
  } else {
    wi = cosineHemisphere(u1, u2);
  }
  return wi.z > 0.0;
}

float henyeyGreenstein(float c, float g) {
  float d = 1.0 + g * g - 2.0 * g * c;
  return (1.0 - g * g) / (4.0 * PI * d * sqrt(d));
}

vec3 sampleHG(vec3 dir, float g) {
  float u1 = rand(), u2 = rand();
  float c;
  if (abs(g) < 1e-3) c = 1.0 - 2.0 * u1;
  else {
    float s = (1.0 - g * g) / (1.0 - g + 2.0 * g * u1);
    c = (1.0 + g * g - s * s) / (2.0 * g);
  }
  c = clamp(c, -1.0, 1.0);
  float sn = sqrt(max(0.0, 1.0 - c * c)), phi = 2.0 * PI * u2;
  vec3 t, b;
  basis(dir, t, b);
  return normalize(t * sn * cos(phi) + b * sn * sin(phi) + dir * c);
}

// ---------------------------------------------------------------- environment
vec3 rotY(vec3 v, float a) {
  float c = cos(a), s = sin(a);
  return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);
}
vec2 equirect(vec3 d) {
  float u = atan(d.x, -d.z) / (2.0 * PI);
  u = u < 0.0 ? u + 1.0 : u;
  return vec2(u, acos(clamp(d.y, -1.0, 1.0)) / PI);
}
vec3 fromEquirect(vec2 uv) {
  float phi = uv.x * 2.0 * PI, th = uv.y * PI;
  float s = sin(th);
  return vec3(s * sin(phi), cos(th), -s * cos(phi));
}

vec3 envRadiance(vec3 d) {
  return textureLod(uEnv, equirect(rotY(d, -uEnvRotation)), 0.0).rgb;
}

float envPdf(vec3 d) {
  vec2 uv = equirect(rotY(d, -uEnvRotation));
  ivec2 ij = min(ivec2(uv * vec2(uEnvSize)), uEnvSize - 1);
  float s = sin(uv.y * PI);
  if (s <= 0.0) return 0.0;
  return texelFetch(uEnvPdf, ij, 0).r * float(uEnvSize.x * uEnvSize.y) / (2.0 * PI * PI * s);
}

vec3 sampleEnv(out float pdf) {
  float u1 = rand(), u2 = rand();
  int lo = 0, hi = uEnvSize.y - 1;
  while (lo < hi) {
    int mid = (lo + hi) / 2;
    if (texelFetch(uEnvMarg, ivec2(mid, 0), 0).r < u1) lo = mid + 1; else hi = mid;
  }
  int j = lo;
  lo = 0; hi = uEnvSize.x - 1;
  while (lo < hi) {
    int mid = (lo + hi) / 2;
    if (texelFetch(uEnvCond, ivec2(mid, j), 0).r < u2) lo = mid + 1; else hi = mid;
  }
  vec2 uv = (vec2(lo, j) + vec2(rand(), rand())) / vec2(uEnvSize);
  float s = sin(uv.y * PI);
  pdf = s > 0.0 ? texelFetch(uEnvPdf, ivec2(lo, j), 0).r * float(uEnvSize.x * uEnvSize.y) / (2.0 * PI * PI * s) : 0.0;
  return rotY(fromEquirect(uv), uEnvRotation);
}

float sunPdf() { return 1.0 / (2.0 * PI * uSunOneMinusCos); }

// Uniform direction inside a cone given 1 - cos(half angle). Taking
// 1 - cos directly keeps tiny cones (a distant bulb, the sun) exact in
// 32-bit floats, where cos(half angle) would round to 1.
vec3 sampleCone(vec3 axis, float oneMinusCos) {
  float u1 = rand(), u2 = rand();
  float c = 1.0 - u1 * oneMinusCos;
  float s = sqrt(max(0.0, 1.0 - c * c)), phi = 2.0 * PI * u2;
  vec3 t, b;
  basis(axis, t, b);
  return normalize(t * s * cos(phi) + b * s * sin(phi) + axis * c);
}

// ---------------------------------------------------------------- fog
// Portion of the segment [0, tmax] along the ray that lies below the top.
vec2 fogSegment(vec3 ro, vec3 rd, float tmax) {
  float top = uFog.z;
  float a = 0.0, b = tmax;
  if (abs(rd.y) < 1e-9) {
    if (ro.y > top) return vec2(1, 0);
  } else {
    float tc = (top - ro.y) / rd.y;
    if (rd.y > 0.0) b = min(b, tc); else a = max(a, tc);
  }
  return vec2(a, b);
}

float fogTransmittance(vec3 ro, vec3 rd, float dist) {
  if (uFog.w < 0.5) return 1.0;
  vec2 s = fogSegment(ro, rd, min(dist, 1e6));
  return exp(-uFog.x * max(0.0, s.y - s.x));
}

// ---------------------------------------------------------------- lights
float powerHeuristic(float a, float b) {
  float a2 = a * a;
  return a2 / (a2 + b * b + 1e-30);
}

vec3 lightEmission(int obj) { return fetch(uMaterials, obj * MAT_TX + 2).rgb; }

// Solid-angle pdf of picking point x on light k from point p.
float lightPdf(int k, vec3 p, vec3 x, vec3 nx) {
  vec4 h = fetch(uLights, k * LIGHT_TX);
  vec4 c = fetch(uLights, k * LIGHT_TX + 1);
  float sel = 1.0 / float(uLightCount);
  if (int(h.x) == 0) {
    float d2 = dot(c.xyz - p, c.xyz - p);
    float s2 = c.w * c.w / d2;
    if (s2 >= 1.0) return 0.0;
    return sel / (2.0 * PI * s2 / (1.0 + sqrt(1.0 - s2)));
  }
  vec3 wi = x - p;
  float d2 = dot(wi, wi);
  float cosL = abs(dot(nx, normalize(wi)));
  return cosL > 1e-6 ? sel * d2 / (cosL * h.z) : 0.0;
}

// Pick a point on a random light. Returns false if nothing usable.
bool sampleLight(vec3 p, out vec3 wi, out float dist, out float pdf, out vec3 Le) {
  if (uLightCount == 0) return false;
  int k = min(int(rand() * float(uLightCount)), uLightCount - 1);
  vec4 h = fetch(uLights, k * LIGHT_TX);
  vec4 c = fetch(uLights, k * LIGHT_TX + 1);
  vec3 eu = fetch(uLights, k * LIGHT_TX + 2).xyz;
  vec3 ev = fetch(uLights, k * LIGHT_TX + 3).xyz;
  int obj = int(h.y);
  Le = lightEmission(obj);
  float sel = 1.0 / float(uLightCount);
  if (int(h.x) == 0) {
    vec3 toC = c.xyz - p;
    float d2 = dot(toC, toC);
    float s2 = c.w * c.w / d2;
    if (s2 >= 1.0) return false;
    float omc = s2 / (1.0 + sqrt(1.0 - s2)); // 1 - cos(half angle), stable
    wi = sampleCone(normalize(toC), omc);
    // Distance to the near side of the sphere along wi.
    float b = dot(toC, wi);
    float disc = b * b - (d2 - c.w * c.w);
    dist = b - sqrt(max(0.0, disc));
    pdf = sel / (2.0 * PI * omc);
    return dist > 0.0 && omc > 0.0;
  }
  vec3 x;
  if (int(h.x) == 1) {
    x = c.xyz + (rand() - 0.5) * eu + (rand() - 0.5) * ev;
  } else {
    float r = sqrt(rand()), phi = 2.0 * PI * rand();
    x = c.xyz + r * cos(phi) * eu + r * sin(phi) * ev;
  }
  vec3 nl = normalize(cross(ev, eu));
  vec3 d = x - p;
  float d2 = dot(d, d);
  dist = sqrt(d2);
  wi = d / dist;
  float cosL = dot(nl, -wi);
  if (cosL <= 1e-6) return false; // one-sided: back of the light
  pdf = sel * d2 / (cosL * h.z);
  return true;
}

// ---------------------------------------------------------------- scattering vertex
// A place where light changes direction: a surface (tangent frame) or a
// point in the fog (phase function).
struct Vertex {
  vec3 p;
  vec3 n;        // shading normal (surface only)
  vec3 t, b;
  vec3 wo;       // toward the previous vertex
  bool fog;
  Mat m;
};

vec3 scatterEval(Vertex v, vec3 wi, out float pdf) {
  if (v.fog) {
    float ph = henyeyGreenstein(dot(-v.wo, wi), uFog.y);
    pdf = ph;
    return vec3(ph);
  }
  vec3 lo = vec3(dot(v.wo, v.t), dot(v.wo, v.b), dot(v.wo, v.n));
  vec3 li = vec3(dot(wi, v.t), dot(wi, v.b), dot(wi, v.n));
  return evalOpaque(v.m, lo, li, pdf);
}

vec3 shadowOrigin(Vertex v, vec3 wi) {
  if (v.fog) return v.p;
  return v.p + v.n * (dot(v.n, wi) > 0.0 ? EPS : -EPS) * (1.0 + length(v.p) * 0.01);
}

// Direct light from the sun, the environment and one area light.
vec3 directLight(Vertex v) {
  vec3 sum = vec3(0);
  if (uSunOn) {
    vec3 wi = sampleCone(uSunDir, uSunOneMinusCos);
    float pb;
    vec3 f = scatterEval(v, wi, pb);
    if (f.x + f.y + f.z > 0.0) {
      vec3 o = shadowOrigin(v, wi);
      if (!occluded(o, wi, INF)) {
        float pl = sunPdf();
        sum += f * uSunRadiance * fogTransmittance(o, wi, INF) * powerHeuristic(pl, pb) / pl;
      }
    }
  }
  {
    float pl;
    vec3 wi = sampleEnv(pl);
    if (pl > 0.0) {
      float pb;
      vec3 f = scatterEval(v, wi, pb);
      if (f.x + f.y + f.z > 0.0) {
        vec3 o = shadowOrigin(v, wi);
        if (!occluded(o, wi, INF)) {
          sum += f * envRadiance(wi) * fogTransmittance(o, wi, INF) * powerHeuristic(pl, pb) / pl;
        }
      }
    }
  }
  {
    vec3 wi, Le;
    float dist, pl;
    if (sampleLight(v.p, wi, dist, pl, Le)) {
      float pb;
      vec3 f = scatterEval(v, wi, pb);
      if (f.x + f.y + f.z > 0.0) {
        vec3 o = shadowOrigin(v, wi);
        float d = dist - length(o - v.p);
        if (!occluded(o, wi, d * (1.0 - 1e-3))) {
          sum += f * Le * fogTransmittance(o, wi, d) * powerHeuristic(pl, pb) / pl;
        }
      }
    }
  }
  return sum;
}

vec3 clampContribution(vec3 c, int depth) {
  if (any(isnan(c)) || any(isinf(c))) return vec3(0);
  if (depth == 0 || uClamp <= 0.0) return c;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return l > uClamp ? c * (uClamp / l) : c;
}

// ---------------------------------------------------------------- camera
vec2 sampleAperture() {
  if (uBlades < 3.0) {
    float r = sqrt(rand()), phi = 2.0 * PI * rand();
    return r * vec2(cos(phi), sin(phi));
  }
  float n = uBlades;
  float k = floor(rand() * n);
  float a0 = uBladeRot + 2.0 * PI * k / n, a1 = uBladeRot + 2.0 * PI * (k + 1.0) / n;
  float s = sqrt(rand()), w = rand();
  return s * ((1.0 - w) * vec2(cos(a0), sin(a0)) + w * vec2(cos(a1), sin(a1)));
}

float tent(float u) {
  float r = 2.0 * u;
  return r < 1.0 ? sqrt(r) - 1.0 : 1.0 - sqrt(2.0 - r);
}

void cameraRay(out vec3 ro, out vec3 rd) {
  vec2 px = gl_FragCoord.xy + vec2(tent(rand()), tent(rand()));
  vec2 ndc = px / uResolution * 2.0 - 1.0;
  float rowFrac = 1.0 - gl_FragCoord.y / uResolution.y; // sensor reads top to bottom
  gTime = clamp(rowFrac * uRollingSpan + rand() * uShutterSpan, 0.0, 1.0);

  if (uDistortion != 0.0) {
    vec2 q = vec2(ndc.x, ndc.y * uTanHalfH / uTanHalfW);
    ndc *= 1.0 + uDistortion * dot(q, q);
  }
  vec3 pos = mix(uCamPos[0], uCamPos[1], gTime);
  vec3 fwd = normalize(mix(uCamFwd[0], uCamFwd[1], gTime));
  vec3 right = normalize(mix(uCamRight[0], uCamRight[1], gTime));
  vec3 up = normalize(cross(right, fwd));
  vec3 dir = normalize(ndc.x * uTanHalfW * right + ndc.y * uTanHalfH * up + fwd);
  ro = pos;
  rd = dir;
  if (uLensRadius > 0.0) {
    vec3 focal = pos + dir * (uFocus / dot(dir, fwd));
    vec2 l = sampleAperture() * uLensRadius;
    ro = pos + l.x * right + l.y * up;
    rd = normalize(focal - ro);
  }
}

// ---------------------------------------------------------------- main
void main() {
  ivec2 pix = ivec2(gl_FragCoord.xy);
  rngState = pcg(uint(pix.x) + pcg(uint(pix.y) + pcg(uint(uFrame) * 7919u)));

  vec3 ro, rd;
  cameraRay(ro, rd);

  vec3 L = vec3(0), T = vec3(1);
  bool specular = true;       // previous bounce did not do light sampling
  float prevPdf = 1.0;
  vec3 prevPos = ro;
  vec3 absorb = vec3(0);      // absorption of the medium the ray is inside
  vec3 aovNormal = -rd, aovAlbedo = vec3(1);
  float aovDepth = 1e4;

  for (int depth = 0; depth <= 64; depth++) {
    if (depth > uMaxBounces) break;
    Hit h;
    bool hit = trace(ro, rd, INF, false, h);

    // Fog: sample a free-flight distance through the layer.
    if (uFog.w > 0.5) {
      vec2 seg = fogSegment(ro, rd, hit ? h.t : 1e6);
      if (seg.y > seg.x) {
        float dist = seg.x - log(1.0 - rand()) / uFog.x;
        if (dist < seg.y) {
          T *= uFogAlbedo;
          Vertex v;
          v.p = ro + rd * dist;
          v.wo = -rd;
          v.fog = true;
          L += T * clampContribution(directLight(v), depth);
          vec3 wi = sampleHG(rd, uFog.y);
          prevPdf = henyeyGreenstein(dot(rd, wi), uFog.y);
          specular = false;
          prevPos = v.p;
          ro = v.p;
          rd = wi;
          if (depth == 0) { aovDepth = dist; aovAlbedo = uFogAlbedo; }
          if (depth >= 3) {
            float q = max(0.05, 1.0 - max(T.x, max(T.y, T.z)));
            if (rand() < q) break;
            T /= 1.0 - q;
          }
          continue;
        }
      }
    }

    if (!hit) {
      vec3 c = vec3(0);
      if (depth > 0 || uEnvVisible) {
        vec3 e = envRadiance(rd);
        c += e * (specular ? 1.0 : powerHeuristic(prevPdf, envPdf(rd)));
      }
      if (uSunOn && dot(rd, uSunDir) >= uSunCosMax) {
        c += uSunRadiance * (specular ? 1.0 : powerHeuristic(prevPdf, sunPdf()));
      }
      L += T * clampContribution(c, depth);
      break;
    }

    if (absorb.x + absorb.y + absorb.z > 0.0) T *= exp(-absorb * h.t);

    vec4 head = fetch(uObjects, h.obj * OBJ_TX);
    int shape = int(head.x);
    vec4 r0, r1, r2;
    objectInverse(h.obj, r0, r1, r2);
    vec3 p = ro + rd * h.t;

    vec3 nObj = h.nObj, nsObj = h.nObj;
    if (h.tri >= 0) {
      int b = h.tri * 6;
      vec3 v0 = fetch(uTris, b).xyz, v1 = fetch(uTris, b + 1).xyz, v2 = fetch(uTris, b + 2).xyz;
      nObj = cross(v1 - v0, v2 - v0);
      float w = 1.0 - h.bary.x - h.bary.y;
      nsObj = fetch(uTris, b + 3).xyz * w + fetch(uTris, b + 4).xyz * h.bary.x + fetch(uTris, b + 5).xyz * h.bary.y;
    }
    // Normals transform with the inverse transpose.
    vec3 ng = normalize(nObj.x * r0.xyz + nObj.y * r1.xyz + nObj.z * r2.xyz);
    vec3 ns = normalize(nsObj.x * r0.xyz + nsObj.y * r1.xyz + nsObj.z * r2.xyz);
    if (dot(ns, ng) < 0.0) ns = -ns;
    vec3 wo = -rd;
    bool front = dot(ng, wo) > 0.0;

    Mat m = loadMaterial(h.obj, h.pObj, nsObj, r0, r1, r2, ns);

    // Emission. Flat shapes shine from their front (+Y) side only.
    if (m.emit.x + m.emit.y + m.emit.z > 0.0) {
      bool oneSided = shape == 3 || shape == 4;
      if (front || !oneSided) {
        int li = int(head.w);
        float w = 1.0;
        if (!specular && li >= 0) w = powerHeuristic(prevPdf, lightPdf(li, prevPos, p, ng));
        L += T * clampContribution(m.emit * w, depth);
      }
    }

    if (depth == 0) {
      aovNormal = front ? ns : -ns;
      aovDepth = h.t;
      aovAlbedo = m.trans > 0.5 ? vec3(1) : (m.metal > 0.5 ? m.color : m.color);
    }
    if (depth == uMaxBounces) break;

    if (rand() < m.trans) {
      // Rough dielectric: reflect or refract through a sampled microfacet.
      vec3 n = front ? ns : -ns;
      vec3 t, b;
      basis(n, t, b);
      vec3 lo = vec3(dot(wo, t), dot(wo, b), dot(wo, n));
      if (lo.z <= 0.0) { n = front ? ng : -ng; basis(n, t, b); lo = vec3(dot(wo, t), dot(wo, b), dot(wo, n)); }
      float a = max(1e-3, m.rough * m.rough);
      vec3 hm = m.thin ? vec3(0, 0, 1) : sampleVNDF(lo, a, rand(), rand());
      float eta = front ? 1.0 / m.ior : m.ior;
      float F = fresnelDielectric(dot(lo, hm), m.thin ? 1.0 / m.ior : eta);
      vec3 li;
      bool refracted = false;
      if (rand() < F) {
        li = reflect(-lo, hm);
        if (li.z <= 0.0) break;
      } else if (m.thin) {
        li = -lo;
        refracted = true;
        T *= m.color * exp(-m.absorb * 0.005);
      } else {
        li = refract(-lo, hm, eta);
        if (dot(li, li) < 1e-8 || li.z >= 0.0) break;
        refracted = true;
        T *= m.color;
      }
      if (!m.thin) T *= G1(abs(li.z), a);
      vec3 wi = normalize(li.x * t + li.y * b + li.z * n);
      if (refracted && !m.thin) absorb = front ? m.absorb : vec3(0);
      ro = p + ng * (dot(ng, wi) > 0.0 ? EPS : -EPS) * (1.0 + length(p) * 0.01);
      rd = wi;
      specular = true;
      prevPos = p;
    } else {
      // Opaque: shade both sides like a thin shell.
      vec3 n = front ? ns : -ns;
      vec3 gn = front ? ng : -ng;
      if (dot(n, wo) <= 0.0) n = gn;
      Vertex v;
      v.p = p;
      v.n = n;
      basis(n, v.t, v.b);
      v.wo = wo;
      v.fog = false;
      v.m = m;
      L += T * clampContribution(directLight(v), depth);

      vec3 lo = vec3(dot(wo, v.t), dot(wo, v.b), dot(wo, n));
      vec3 li;
      if (!sampleOpaque(m, lo, li)) break;
      vec3 wi = normalize(li.x * v.t + li.y * v.b + li.z * n);
      if (dot(wi, gn) <= 0.0) break; // below the true surface
      float pdf;
      vec3 f = evalOpaque(m, lo, li, pdf);
      if (pdf <= 0.0) break;
      T *= f / pdf;
      prevPdf = pdf;
      specular = false;
      prevPos = p;
      ro = p + gn * EPS * (1.0 + length(p) * 0.01);
      rd = wi;
    }

    if (depth >= 3) {
      float q = max(0.05, 1.0 - max(T.x, max(T.y, T.z)));
      if (rand() < q) break;
      T /= 1.0 - q;
    }
  }

  if (any(isnan(L)) || any(isinf(L))) L = vec3(0);
  L = max(L, vec3(0));

  vec4 pc = vec4(0), pa = vec4(0), pb = vec4(0);
  if (uAccumulate == 1) {
    pc = texelFetch(uPrevColor, pix, 0);
    pa = texelFetch(uPrevAux, pix, 0);
    pb = texelFetch(uPrevAlbedo, pix, 0);
  }
  float lum = dot(L, vec3(0.2126, 0.7152, 0.0722));
  outColor = pc + vec4(L, 1.0);
  outAux = pa + vec4(aovNormal, aovDepth);
  outAlbedo = pb + vec4(aovAlbedo, lum * lum);
}
`;
