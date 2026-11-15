// HERE — shaders
// Every scene returns linear HDR light. Tonemapping happens once, at the end.

window.HERE_VERT = `#version 300 es
in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }
`;

window.HERE_FRAG = `#version 300 es
precision highp float;
precision highp sampler3D;

uniform vec2  uRes;
uniform float uTime;
uniform int   uA;
uniform int   uB;
uniform float uTA;
uniform float uTB;
uniform float uMix;
uniform float uBreath;   // 0..1, one full breath every 10 s
uniform float uPulse;    // decays after each chime of the music
uniform float uFade;     // master fade (begin / end)
uniform sampler3D uNoise;

out vec4 outColor;

#define PI  3.14159265359
#define TAU 6.28318530718

// ------------------------------------------------------------------ utils
float sq(float x){ return x * x; }

mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float ign(vec2 p){   // per-pixel ray jitter: white noise, re-rolled every frame (reads as fine film grain)
  return hash12(p + fract(uTime * 7.31) * vec2(97.13, 59.71));
}

float hash13(vec3 p3){
  p3 = fract(p3 * .1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

// smooth periodic value noise, baked into a 3D texture (period 16)
// texture(): mip-filtered, so detail too fine for a pixel fades instead of shimmering.
// textureLod(…, 0): for ray-march loops, where screen derivatives mean nothing.
float noise3(vec3 p){ return texture(uNoise, p * 0.0625).r; }
float noise2(vec2 p){ return texture(uNoise, vec3(p * 0.0625, 0.371)).r; }
vec4  noise34(vec3 p){ return texture(uNoise, p * 0.0625); }   // four independent fields
float noise3v(vec3 p){ return textureLod(uNoise, p * 0.0625, 0.0).r; }
float noise2v(vec2 p){ return textureLod(uNoise, vec3(p * 0.0625, 0.371), 0.0).r; }
vec4  noise34v(vec3 p){ return textureLod(uNoise, p * 0.0625, 0.0); }

float fbm2(vec2 p){
  float f = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for(int i = 0; i < 5; i++){ f += a * noise2(p); p = m * p + 3.1; a *= 0.5; }
  return f;
}
float fbm3(vec3 p){
  float f = 0.0, a = 0.5;
  for(int i = 0; i < 5; i++){ f += a * noise3(p); p = p * 2.03 + vec3(1.7, 9.2, 4.1); a *= 0.5; }
  return f;
}
float fbm3v(vec3 p){
  float f = 0.0, a = 0.5;
  for(int i = 0; i < 5; i++){ f += a * noise3v(p); p = p * 2.03 + vec3(1.7, 9.2, 4.1); a *= 0.5; }
  return f;
}
float fbm3lov(vec3 p){
  float f = 0.0, a = 0.5;
  for(int i = 0; i < 3; i++){ f += a * noise3v(p); p = p * 2.03 + vec3(1.7, 9.2, 4.1); a *= 0.5; }
  return f / 0.875;
}
float fbm3lo(vec3 p){
  float f = 0.0, a = 0.5;
  for(int i = 0; i < 3; i++){ f += a * noise3(p); p = p * 2.03 + vec3(1.7, 9.2, 4.1); a *= 0.5; }
  return f / 0.875;
}

// floating motes of light, screen space
vec3 motes(vec2 p, float t, vec2 drift, vec3 c1, vec3 c2, float amount){
  vec3 c = vec3(0.0);
  for(int i = 0; i < 4; i++){
    float fi = float(i);
    float sc = 5.0 + fi * 4.0;
    vec2 q = p * sc + drift * t * (0.6 + fi * 0.35) + vec2(fi * 17.3, fi * 7.9);
    vec2 id = floor(q);
    vec2 f = fract(q) - 0.5;
    vec2 h = hash22(id + fi * 31.7);
    if(hash12(id * 1.37 + fi * 7.3) > amount) continue;
    vec2 off = (h - 0.5) * 0.36 + 0.09 * vec2(sin(t * 0.31 + h.x * 40.0), cos(t * 0.27 + h.y * 40.0));
    float d = length(f - off);
    float size = 0.012 + 0.03 * h.y;
    float tw = 0.55 + 0.45 * sin(t * (0.4 + h.x * 1.6) + h.y * 30.0);
    float k = max(1.0 - d / 0.22, 0.0);
    float m = exp(-d * d / (size * size)) * k + 0.08 * k * k * k;
    c += mix(c1, c2, h.x) * m * tw / (1.0 + fi * 0.8);
  }
  return c;
}

// stars on the celestial sphere
// every glow is compact (reaches exactly zero inside its own cell) so no star is ever clipped into a square
vec3 stars(vec3 rd, float t, float amount){
  vec2 sp = vec2(atan(rd.x, rd.z), asin(clamp(rd.y, -1.0, 1.0)));
  vec3 c = vec3(0.0);
  for(int i = 0; i < 3; i++){
    float fi = float(i);
    float sc = 45.0 + fi * 40.0;
    float w = 0.75 * sc / uRes.y;                       // one pixel, in cell units
    float layer = smoothstep(0.13, 0.07, w);            // too coarse a resolution for this layer: let it go
    if(layer <= 0.0) continue;
    vec2 q = sp * sc + fi * 17.7;
    vec2 id = floor(q);
    vec2 f = fract(q) - 0.5;
    float h = hash12(id + fi * 3.1);
    if(h > amount) continue;
    vec2 o = (hash22(id + fi * 5.3) - 0.5) * 0.56;
    float d = length(f - o);
    float mag = pow(hash12(id + 6.6), 5.0) * 3.0 + 0.2;   // a few bright, many faint
    float k = max(1.0 - d / 0.21, 0.0);
    float b = exp(-d * d / (w * w)) * mag * k + k * k * k * k * mag * mag * 0.04;
    float tw = 0.75 + 0.25 * sin(t * (1.0 + h * 9.0) + h * 100.0);
    vec3 col = mix(vec3(0.65, 0.78, 1.0), vec3(1.0, 0.82, 0.62), hash12(id + 9.1));
    c += col * b * tw * (1.0 - fi * 0.25) * layer;
  }
  return c;
}

// ======================================================= 0 · ORIGIN
// a single light, breathing in the dark
vec3 sOrigin(vec2 p, float t){
  float br = uBreath;
  float r = length(p);
  vec3 col = vec3(0.003, 0.002, 0.008);

  // faint veils of smoke lit by the light
  vec2 q = rot(t * 0.012) * p;
  float w  = fbm2(q * 2.2 + vec2(t * 0.020, -t * 0.015));
  float w2 = fbm2(q * 3.4 - vec2(t * 0.010, 0.0) + w * 1.8);
  float fall = 1.0 / (1.0 + r * r * 10.0);
  col += vec3(0.35, 0.14, 0.45) * pow(w2, 3.0) * fall * 0.9;
  col += vec3(0.80, 0.38, 0.16) * pow(w, 4.0) * fall * 0.7;

  // the light itself
  float core = 0.016 + 0.010 * br;
  col += vec3(1.0, 0.92, 0.80) * exp(-r * r / (core * core)) * 4.0;
  col += vec3(1.0, 0.66, 0.36) * 0.007 / (r * r + 0.005) * (0.45 + 0.55 * br);
  col += vec3(0.9, 0.45, 0.35) * exp(-r * (6.0 - 2.0 * br)) * 0.14 * (0.5 + br);

  // soft rays
  float a = atan(p.y, p.x + 1e-5);
  vec2 cs = vec2(cos(a), sin(a));
  float ry = noise2(cs * 5.0 + t * 0.03) * noise2(cs * 11.0 - t * 0.02 + 4.0);
  col += vec3(1.0, 0.7, 0.45) * sq(ry) * exp(-r * 2.6) * 0.45 * (0.6 + 0.4 * br);

  col += motes(p, t, vec2(0.0, -0.08), vec3(1.0, 0.8, 0.6), vec3(0.7, 0.7, 1.0), 0.35) * (0.25 + fall * 1.6);
  return col;
}

// ======================================================= 1 · STARDUST
// drifting through a stellar nursery
vec3 sStardust(vec2 p, float t){
  vec3 ro = vec3(0.0, 0.0, t * 0.11);
  vec3 rd = normalize(vec3(p, 1.35));
  rd.xy = rot(0.25 + t * 0.006) * rd.xy;
  rd.xz = rot(sin(t * 0.011) * 0.18) * rd.xz;

  vec3 L = ro + vec3(0.7 * sin(t * 0.017), 0.25 + 0.15 * cos(t * 0.013), 4.5);
  float jit = ign(gl_FragCoord.xy);

  vec3 col = vec3(0.0);
  float T = 1.0;
  float dt = 0.15;
  float s = 0.25 + jit * dt;
  for(int i = 0; i < 46; i++){
    vec3 pos = ro + rd * s;
    vec4 w4 = noise34v(pos * 0.26 + vec3(3.0, 1.0, 7.0));
    float big = w4.x;
    vec3 wq = pos * 0.55 + vec3(0.0, 0.0, t * 0.012);
    wq += (w4.yzw - 0.5) * 2.2 + (noise34v(wq * 0.9 + 5.0).yzw - 0.5) * 0.9;
    float n = fbm3v(wq);
    float v = n + (big - 0.5) * 0.5;
    float gas  = smoothstep(0.46, 0.63, v);                         // glowing gas
    float dust = 0.0;
    if(big > 0.35) dust = smoothstep(0.64, 0.74, fbm3lov(wq * 1.3 + 21.0)) * smoothstep(0.35, 0.6, big);   // dark lanes
    if(gas + dust > 0.002){
      vec3 dl = L - pos;
      float ld2 = dot(dl, dl);
      vec3 lit = vec3(1.0, 0.78, 0.55) * 4.0 / (1.0 + ld2 * 0.6);
      vec3 base = mix(vec3(0.04, 0.14, 0.38), vec3(0.62, 0.08, 0.16), smoothstep(0.35, 0.65, big));
      base = mix(base, vec3(0.95, 0.55, 0.25), smoothstep(0.62, 0.78, v) * 0.6);
      float edge = gas * (1.0 - gas) * 4.0;                          // ionised rims glow brighter
      vec3 emis = base * (0.20 + lit) * (0.55 + 0.8 * edge) + vec3(0.2, 0.45, 0.9) * edge * 0.06;
      float a = gas * dt * 2.2;
      col += T * emis * a;
      T *= exp(-(a * 0.9 + dust * dt * 3.0));
      if(T < 0.02) break;
    }
    s += dt;
  }

  // the newborn star
  float g = max(dot(rd, normalize(L - ro)), 0.0);
  vec3 star = vec3(1.0, 0.9, 0.78) * (exp(-(1.0 - g) * 9000.0) * 6.0 + exp(-(1.0 - g) * 600.0) * 0.6 + exp(-(1.0 - g) * 40.0) * 0.12);
  // diffraction spikes
  vec3 lv = normalize(L - ro);
  vec2 sp = rd.xy / rd.z - lv.xy / lv.z;
  float spike = exp(-abs(sp.x) * 900.0) * exp(-abs(sp.y) * 7.0) + exp(-abs(sp.y) * 900.0) * exp(-abs(sp.x) * 7.0);
  star += vec3(1.0, 0.85, 0.75) * spike * 0.6;
  col += star * (0.35 + 0.65 * T);
  col += T * stars(rd, t, 0.06) * 1.2;
  col += T * vec3(0.004, 0.005, 0.012);
  return col;
}

// ======================================================= 2 · WATER
// sunlight falling through the sea where life began
float caustic(vec2 uv, float time){
  vec2 p = mod(uv * TAU, TAU) - 250.0;
  vec2 i = p;
  float c = 1.0;
  float inten = 0.005;
  for(int n = 0; n < 5; n++){
    float tt = time * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
  }
  c /= 5.0;
  c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 8.0);
}

vec2 sdSegT(vec2 p, vec2 a, vec2 b){
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return vec2(length(pa - ba * h), h);
}
vec3 sWater(vec2 p, float t){
  vec3 ro = vec3(t * 0.04, 0.0, t * 0.09);
  vec3 rd = normalize(vec3(p.x, p.y + 0.32, 1.0));
  rd.xz = rot(sin(t * 0.025) * 0.25) * rd.xz;
  float surf = 4.0;
  vec3 sunDir = normalize(vec3(0.25, 1.0, 0.55));

  vec3 deep    = vec3(0.000, 0.006, 0.025);
  vec3 shallow = vec3(0.010, 0.190, 0.300);
  vec3 col = mix(deep, shallow * 0.45, pow(smoothstep(-0.3, 1.0, rd.y), 1.6));
  col += vec3(0.05, 0.25, 0.3) * pow(max(dot(rd, sunDir), 0.0), 6.0) * 0.6;

  if(rd.y > 0.0){
    float d = (surf - ro.y) / rd.y;
    vec3 hp = ro + rd * d;
    float c = mix(0.04, caustic(hp.xz * 0.12, t * 0.35), exp(-d * 0.06));
    float win = smoothstep(0.58, 0.72, rd.y);              // Snell's window
    float sun = pow(max(dot(rd, sunDir), 0.0), 60.0);
    vec3 skyc = vec3(0.45, 0.80, 1.0) * 1.1 + vec3(1.0, 0.95, 0.8) * sun * 14.0;
    vec3 sc = mix(shallow * 0.35, skyc, win);
    sc += c * vec3(0.6, 0.95, 1.0) * (0.12 + win * 0.8);
    float fog = exp(-d * 0.09);
    col = mix(col, sc, fog);
  } else {
    float d = 3.2 / -rd.y;
    vec3 hp = ro + rd * d;
    float c = mix(0.04, caustic(hp.xz * 0.25, t * 0.35), exp(-d * 0.08));
    vec3 sand = vec3(0.35, 0.40, 0.35) * (0.25 + 0.6 * fbm2(hp.xz * 0.8)) + c * vec3(0.5, 0.9, 1.0) * 0.8;
    float fog = exp(-d * 0.14);
    col = mix(col, sand * 0.5, fog);
  }

  // shafts of light
  float jit = ign(gl_FragCoord.xy);
  float acc = 0.0;
  for(int i = 0; i < 28; i++){
    float s = (float(i) + jit) * 0.55;
    vec3 pos = ro + rd * s;
    if(pos.y > surf) break;
    vec3 sp = pos + sunDir * ((surf - pos.y) / sunDir.y);
    float sh = noise2v(sp.xz * 1.1 + vec2(t * 0.05, t * 0.03)) * noise2v(sp.xz * 2.3 - t * 0.04);
    sh = pow(sh, 3.5) * 1.6;
    acc += sh * exp(-s * 0.10) * exp(-(surf - pos.y) * 0.10);
  }
  col += vec3(0.40, 0.80, 0.95) * acc * 0.40;

  // bubbles and drifting life
  col += motes(p, t, vec2(0.02, -0.10), vec3(0.6, 0.95, 1.0), vec3(0.4, 1.0, 0.8), 0.28) * 0.7;
  return col;
}

// ======================================================= HOME
// the Earth from orbit: city lights, lightning, the thin shell of sky, and then the sun
vec2 sph(vec3 ro, vec3 rd, float r){
  float b = dot(ro, rd);
  float c = dot(ro, ro) - r * r;
  float h = b * b - c;
  if(h < 0.0) return vec2(-1.0);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}

// city lights: tiny points scattered in 3D cells on the sphere; fp = pixel footprint (in sphere units)
float cityLights(vec3 sp, float fp){
  float acc = 0.0;
  for(int i = 0; i < 2; i++){
    float K = i == 0 ? 70.0 : 190.0;
    float fk = fp * K;                                   // pixel size in cell units
    vec3 q = sp * K + float(i) * 13.7;
    vec3 id = floor(q);
    vec3 f = fract(q) - 0.5;
    float h = hash13(id);
    vec3 o = (vec3(hash13(id + 1.7), hash13(id + 3.1), hash13(id + 5.3)) - 0.5) * 0.5;
    float d = length(f - o);
    float r = clamp(fk * 0.9, 0.02, 0.25);
    float k = max(1.0 - d / r, 0.0);
    float e = min(0.05 / r, 1.0);
    float pt = k * k * e * e * (0.4 + 1.6 * h * h);
    float far = smoothstep(0.12, 0.35, fk);              // sub-pixel: use the average glow instead
    acc += mix(pt, 0.0035, far) * (i == 0 ? 1.0 : 0.7);
  }
  return acc;
}

// colour of sunlit air above a point whose normal makes cos(angle) = mu with the sun
vec3 skyLight(float mu){
  vec3 day = vec3(0.25, 0.52, 1.0) * smoothstep(-0.02, 0.35, mu);
  vec3 dusk = vec3(1.0, 0.42, 0.16) * exp(-sq((mu - 0.01) / 0.05));
  return day * 1.1 + dusk * 0.6;
}

vec3 sHome(vec2 p, float t){
  const float R = 1.0, ATM = 1.014, H = 0.0026;
  vec3 ro = vec3(0.0, 1.065, 0.0);                       // our orbit, relative to the planet's centre
  vec3 rd = normalize(vec3(p, 1.25));
  rd.yz = rot(-0.45) * rd.yz;
  rd.xz = rot(0.05 * sin(t * 0.008)) * rd.xz;

  // the sun climbs out from behind the planet (clears the limb ~36 s in)
  float se = -0.43 + t * 0.0029;
  vec3 S = normalize(vec3(0.17, sin(se), cos(se)));
  float tcS = -dot(ro, S);
  float bS = length(ro + S * max(tcS, 0.0));
  float vis = smoothstep(R + 0.0008, R + 0.007, bS);
  vec3 sunTint = mix(vec3(1.0, 0.38, 0.10), vec3(1.0, 0.95, 0.88), smoothstep(0.002, 0.02, max(bS - R, 0.0)));

  float sd = dot(rd, S);
  float ad = sqrt(max(2.0 - 2.0 * sd, 0.0));            // angle to the sun

  // space: stars, and the sun's disc
  vec3 col = stars(rd, t, 0.07) * (1.0 - 0.75 * vis);
  col += sunTint * smoothstep(0.0062, 0.0050, ad) * 60.0;

  vec2 hp = sph(ro, rd, R);
  vec2 ha = sph(ro, rd, ATM);

  // the edge of the world, anti-aliased: blend planet and sky over about one pixel
  vec3 sky = col;
  float tc = -dot(ro, rd);
  vec3 c = ro + rd * max(tc, 0.0);
  float b = length(c);
  float pix = 0.37 / (uRes.y * 1.25);                    // one pixel, at the distance of the horizon
  float cov = tc > 0.0 ? smoothstep(R - 1.2 * pix, R + 1.2 * pix, b) : 1.0;
  float muC = dot(c / b, S);
  vec3 surfCol = skyLight(muC) * 0.3 * (1.0 + 2.0 * pow(max(sd, 0.0), 8.0));   // just past the edge: pure haze

  if(hp.x > 0.0){
    vec3 pos = ro + rd * hp.x;
    vec3 n = normalize(pos);
    vec3 sp = n;
    sp.yz = rot(-t * 0.0035) * sp.yz;                    // the world turning beneath us
    float mu = dot(n, S);
    float facing = dot(n, -rd);

    float cont = fbm3(sp * 7.0 + 7.0);
    float land = smoothstep(0.50, 0.535, cont);
    vec3 cq = sp * 24.0 + (noise34(sp * 6.0 + 3.0).yzw - 0.5) * 3.0;
    float cl = fbm3(cq + vec3(0.0, 0.0, t * 0.01));
    float clouds = smoothstep(0.45, 0.66, cl);
    clouds *= 0.7 + 0.3 * noise3(sp * 90.0);

    vec3 ocean = vec3(0.004, 0.022, 0.065);
    vec3 ground = mix(vec3(0.10, 0.085, 0.05), vec3(0.035, 0.065, 0.03), noise3(sp * 40.0));
    vec3 alb = mix(ocean, ground, land);
    alb = mix(alb, vec3(0.8), clouds);
    vec3 tint = mix(vec3(1.0, 0.45, 0.2), vec3(1.0, 0.97, 0.93), smoothstep(-0.01, 0.09, mu));
    vec3 surf = alb * tint * smoothstep(-0.02, 0.25, mu) * 2.2;
    float glint = pow(max(dot(n, normalize(S - rd + vec3(0.0, 1e-5, 0.0))), 0.0), 260.0) * (1.0 - land) * (1.0 - clouds);
    surf += tint * glint * 5.0 * step(0.0, mu);

    // cities, on the night side
    float night = 1.0 - smoothstep(-0.10, 0.03, mu);
    float region = land * smoothstep(0.51, 0.55, cont) * smoothstep(0.38, 0.62, noise3(sp * 22.0 + 2.0)) * (0.5 + noise3(sp * 70.0));
    float fp = hp.x / (uRes.y * 1.25 * max(facing, 0.08));
    float lights = cityLights(sp, fp) * smoothstep(0.03, 0.25, facing);
    surf += vec3(1.0, 0.62, 0.28) * lights * region * night * (1.0 - clouds * 0.8) * 22.0;
    surf += alb * vec3(0.004, 0.006, 0.011) * night;                   // faint earthshine on the night side

    // lightning inside the night clouds
    vec3 lc = floor(sp * 15.0);
    float fl = hash13(lc + floor(t * 5.0) * 0.731);
    float flash = step(0.9975, fl) * clouds * night;
    surf += vec3(0.55, 0.65, 1.0) * flash * smoothstep(0.55, 0.0, length(fract(sp * 15.0) - 0.5)) * 1.2;

    // the thin skin of air over it all
    float path = hp.x - max(ha.x, 0.0);
    float haze = 1.0 - exp(-path * 4.0);
    float phase = 1.0 + 2.0 * pow(max(sd, 0.0), 8.0);
    surfCol = surf * (1.0 - haze * 0.7) + skyLight(mu) * haze * phase * 0.3;
  }

  // the limb: light passing tangentially through the atmosphere
  if(cov > 0.0 && b < ATM){
    float h = max(b - R, 0.0);
    float chord = 2.0 * sqrt(max(ATM * ATM - b * b, 0.0));
    float od = exp(-h / H) * chord * 14.0;
    float mu = dot(c / b, S);
    vec3 band = mix(vec3(1.0, 0.20, 0.03), vec3(1.0, 0.58, 0.22), smoothstep(0.0, 0.0018, h));
    band = mix(band, vec3(0.22, 0.45, 1.0), smoothstep(0.0012, 0.006, h));     // red low, blue high
    float lit = smoothstep(-0.10, 0.10, mu);
    float near = pow(max(sd, 0.0), 6.0);
    float phase = 0.6 + 2.0 * near + 8.0 * pow(max(sd, 0.0), 60.0);
    float twilight = exp(-sq(mu / 0.08)) * (0.3 + 2.5 * near);          // the dawn arc, before the sun
    vec3 airlight = band * (lit * phase + twilight * 0.8) * 0.9;
    sky = sky * exp(-od) + airlight * (1.0 - exp(-od));
    // airglow: the faint green shell, visible on the night side (never thinner than a pixel)
    float wg = max(0.0006, pix * 1.3);
    sky += vec3(0.25, 0.95, 0.45) * exp(-sq((h - 0.0042) / wg)) * 0.045 * (0.0006 / wg) * (1.0 - lit * 0.8) * min(chord * 4.0, 1.0);
  }
  col = mix(surfCol, sky, cov);

  // the sun's glare, and its star
  vec3 U = normalize(cross(S, vec3(0.0, 1.0, 0.0)));
  vec3 V = cross(U, S);
  vec3 v = rd - S * sd;
  float ang = atan(dot(v, V), dot(v, U) + 1e-6) + t * 0.01;
  float spikes = pow(abs(cos(ang * 3.0)), 90.0) + 0.4 * pow(abs(cos(ang * 3.0 + 0.5236)), 160.0);
  col += sunTint * vis * (exp(-ad * 70.0) * 1.2 + exp(-ad * 12.0) * 0.08 + spikes * exp(-ad * 28.0) * 0.7);
  return col;
}

// ======================================================= NIGHT
// the Milky Way arching over a still lake; now and then, a falling star
float mountains(float az){
  return 0.03 + 0.10 * fbm2(vec2(az * 2.5, 1.7)) * smoothstep(0.0, 1.0, noise2(vec2(az * 0.8, 9.0)) + 0.4) - 0.04;
}

vec3 galaxy(vec3 rd, out float bandOut){
  const vec3 A = vec3(-0.32, 0.05, 1.0);
  const vec3 B = vec3(0.65, 0.85, 0.45);
  vec3 U = normalize(A);
  vec3 G = normalize(cross(U, normalize(B)));
  vec3 V = cross(G, U);
  float lat = dot(rd, G);
  float lon = atan(dot(rd, V), dot(rd, U));
  float wob = 0.02 * sin(lon * 3.0 + 1.0);
  float bulge = exp(-sq((lon - 0.25) / 0.32) - sq(lat / 0.11));
  float band = exp(-sq((lat - wob) / (0.10 + 0.05 * bulge)));
  vec2 g = vec2(lon * 5.0, (lat - wob) * 16.0);
  float clump = fbm2(g + 3.0);
  float fine = fbm2(g * 3.1 + 11.0);
  float rift = smoothstep(0.42, 0.68, fbm2(vec2(lon * 6.0, (lat - wob) * 22.0) + 7.0 + clump)) * exp(-sq((lat - wob + 0.008 * sin(lon * 9.0)) / 0.045));
  float I = band * (0.18 + 1.1 * clump * clump * fine) + bulge * 1.3 * (0.6 + 0.6 * clump);
  I *= 1.0 - 0.88 * rift;
  vec3 c = mix(vec3(0.55, 0.62, 0.90), vec3(1.0, 0.80, 0.58), clamp(bulge * 1.4 + clump * 0.3, 0.0, 1.0));
  vec3 col = c * I * 0.20;
  col += vec3(0.9, 0.25, 0.35) * smoothstep(0.72, 0.82, fbm2(g * 2.0 + 5.0)) * band * (1.0 - rift) * 0.05;   // glowing hydrogen
  bandOut = band * (1.0 - rift * 0.8) + bulge;
  return col;
}

vec3 meteor(vec3 rd, float t){
  float period = 9.0;
  float id = floor(t / period);
  float lt = t - id * period;
  vec3 h = vec3(hash12(vec2(id, 1.3)), hash12(vec2(id, 7.1)), hash12(vec2(id, 3.7)));
  if(h.z < 0.4) return vec3(0.0);
  float dur = 0.6 + h.y * 0.7;
  float u = (lt - h.x * 5.0) / dur;
  if(u < 0.0 || u > 1.0) return vec3(0.0);
  vec2 sky = vec2(atan(rd.x, rd.z), asin(clamp(rd.y, -1.0, 1.0)));
  vec2 p0 = vec2(-0.55 + h.x * 1.1, 0.30 + h.y * 0.35);
  vec2 dir = normalize(vec2((h.z > 0.7 ? 1.0 : -1.0) * (0.6 + h.y * 0.5), -0.55));
  vec2 head = p0 + dir * 0.32 * u;
  vec2 tail = head - dir * (0.04 + 0.12 * u);
  vec2 sg = sdSegT(sky, tail, head);
  float w = 1.1 / uRes.y;
  float b = exp(-sg.x * sg.x / (w * w)) * sg.y * sg.y * sin(PI * u);
  return vec3(0.85, 0.92, 1.0) * b * 2.5;
}

vec3 nightSky(vec3 rd, float t){
  float e = rd.y;
  vec3 col = mix(vec3(0.010, 0.016, 0.034), vec3(0.002, 0.003, 0.010), smoothstep(0.0, 0.6, e));
  col += vec3(0.035, 0.04, 0.028) * exp(-max(e, 0.0) * 14.0) * 0.5;      // airglow near the horizon
  float band;
  col += galaxy(rd, band) * smoothstep(-0.02, 0.10, e);
  col += stars(rd, t, 0.045 + 0.30 * clamp(band, 0.0, 1.0)) * smoothstep(-0.02, 0.15, e);
  col += meteor(rd, t);
  float az = atan(rd.x, rd.z);
  float m = mountains(az);
  float aaN = 1.6 / uRes.y;
  col = mix(col, mix(vec3(0.004, 0.006, 0.012), vec3(0.010, 0.014, 0.024), smoothstep(m - 0.03, m, e)), smoothstep(m + aaN, m - aaN, e));
  // pines along the far shore
  float k = az * 80.0;
  float tri = abs(fract(k) - 0.5) * 2.0;
  float th = 0.008 + 0.028 * pow(1.0 - tri, 1.3) * hash12(vec2(floor(k), 3.0)) * smoothstep(0.35, 0.6, noise2(vec2(az * 6.0, 1.0)));
  col = mix(col, vec3(0.002, 0.003, 0.006), smoothstep(th + aaN, th - aaN, e));
  return col;
}

vec3 sNight(vec2 p, float t){
  float camH = 0.25;
  vec3 rd = normalize(vec3(p.x, p.y + 0.24, 1.15));
  rd.xz = rot(sin(t * 0.010) * 0.12 - 0.05) * rd.xz;
  vec3 col;
  if(rd.y > 0.0){
    col = nightSky(rd, t);
  } else {
    float d = camH / -rd.y;
    vec2 hp = rd.xz * d;
    float k = 1.0 / (1.0 + d * 0.15);
    vec2 n = vec2(noise2(hp * 1.5 + vec2(0.0, t * 0.15)) - 0.5, noise2(hp * 1.5 + vec2(5.0, -t * 0.12)) - 0.5);
    n += 0.5 * vec2(noise2(hp * 4.0 + t * 0.3) - 0.5, noise2(hp * 4.0 - t * 0.25 + 9.0) - 0.5);
    vec3 r = normalize(vec3(rd.x + n.x * 0.010 * k, -rd.y + n.y * 0.006 * k, rd.z));
    float fres = 0.35 + 0.65 * pow(1.0 - (-rd.y), 5.0);
    col = nightSky(r, t) * fres * 0.85;
  }
  return col;
}

// ======================================================= 5 · DAWN
// sunrise above a sea of clouds
vec3 sDawn(vec2 p, float t){
  float sunE = -0.035 + t * 0.0015;
  vec3 sunDir = normalize(vec3(0.15, sunE, 1.0));
  vec3 rd = normalize(vec3(p.x, p.y + 0.10, 1.3));
  rd.xz = rot(sin(t * 0.01) * 0.08 + 0.04) * rd.xz;
  float day = smoothstep(-0.05, 0.15, sunE);

  float e = rd.y;
  float sd = max(dot(rd, sunDir), 0.0);
  vec3 sky = mix(vec3(0.95, 0.42, 0.20), vec3(0.42, 0.30, 0.50), smoothstep(-0.02, 0.18, e));
  sky = mix(sky, vec3(0.10, 0.16, 0.40), smoothstep(0.12, 0.45, e));
  sky = mix(sky, vec3(0.02, 0.05, 0.16), smoothstep(0.40, 0.95, e));
  sky = mix(sky, sky * vec3(0.9, 1.0, 1.2) * 1.4, day * smoothstep(0.0, 0.5, e));
  sky += vec3(1.0, 0.50, 0.20) * pow(sd, 6.0) * (0.5 + 0.8 * day);
  sky += vec3(1.0, 0.78, 0.45) * pow(sd, 90.0) * 2.0;
  float disk = smoothstep(0.99955, 0.99975, sd);
  sky += vec3(1.0, 0.9, 0.75) * disk * 40.0;
  sky *= 0.55 + 0.35 * day;

  // wisps of high cloud catching the light
  if(e > 0.0){
    vec2 cq = rd.xz / (e + 0.08);
    float ci = fbm2(cq * vec2(0.6, 2.2) + vec2(t * 0.01, 0.0));
    ci = smoothstep(0.5, 0.8, ci) * smoothstep(0.0, 0.08, e);
    vec3 cc = mix(vec3(1.0, 0.45, 0.4), vec3(1.0, 0.8, 0.6), sd) * (0.5 + 1.5 * pow(sd, 4.0));
    sky = mix(sky, cc * (0.6 + 0.6 * day), ci * 0.7);
  }

  // distant peaks rising above the clouds
  float az = atan(rd.x, rd.z);
  float pk = sq(fbm2(vec2(az * 3.0 + 11.0, 2.0))) * 0.30 - 0.05;
  pk *= smoothstep(0.5, 0.1, abs(az + 0.45)) + smoothstep(0.35, 0.05, abs(az - 0.7)) * 0.8;
  float aaD = 1.6 / uRes.y;
  float inPk = smoothstep(pk + aaD, pk - aaD, e);
  if(inPk > 0.0){
    float rim = smoothstep(pk - 0.004, pk, e);
    vec3 mc = mix(vec3(0.20, 0.17, 0.30), vec3(0.45, 0.30, 0.35), smoothstep(-0.02, pk, e));
    mc += vec3(1.0, 0.6, 0.35) * rim * pow(sd, 16.0) * 0.8;
    sky = mix(sky, mix(mc, sky, 0.25), inPk);
  }

  vec3 col = sky;
  if(e < 0.01){
    float top = -0.35, bot = -1.4;
    float t0 = (top - 0.0) / min(e, -0.0005);
    float t1 = (bot - 0.0) / min(e, -0.0005);
    t0 = max(t0, 0.0);
    float len = min(t1, t0 + 40.0) - t0;
    float dt = len / 36.0;
    float jit = ign(gl_FragCoord.xy);
    vec3 cc = vec3(0.0);
    float T = 1.0;
    vec3 wind = vec3(t * 0.06, 0.0, t * 0.02);
    for(int i = 0; i < 36; i++){
      float s = t0 + (float(i) + jit) * dt;
      vec3 pos = rd * s;
      float h01 = (pos.y - bot) / (top - bot);
      vec3 q = pos * 0.35 + wind;
      float n = fbm3v(q);
      float den = clamp((n - 0.30 - h01 * 0.42) * 4.0, 0.0, 1.0);
      if(den > 0.003){
        float ln = fbm3lov(q + sunDir * 0.35);
        float ld = clamp((ln - 0.30 - (h01 + 0.1) * 0.42) * 4.0, 0.0, 1.0);
        float sh = exp(-ld * 2.5);
        vec3 sunC = mix(vec3(1.0, 0.40, 0.18), vec3(1.0, 0.72, 0.45), day) * (0.9 + 2.2 * pow(sd, 8.0)) * (0.4 + 0.6 * day);
        vec3 amb = mix(vec3(0.10, 0.08, 0.20), vec3(0.28, 0.30, 0.48), day) * (0.3 + 0.7 * h01);
        vec3 lc = amb + sunC * sh * (0.25 + 0.75 * h01);
        float a = den * dt * 1.6;
        cc += T * lc * a;
        T *= exp(-a * 2.2);
        if(T < 0.02) break;
      }
    }
    float fog = 1.0 - exp(-t0 * 0.045);
    vec3 haze = mix(vec3(0.85, 0.42, 0.28), vec3(0.85, 0.60, 0.50), day) * (0.5 + 1.2 * pow(sd, 5.0)) * (0.6 + 0.4 * day);
    vec3 below = vec3(0.06, 0.05, 0.10);
    vec3 clouds = cc + T * below;
    clouds = mix(clouds, haze, fog);
    col = mix(clouds, sky, smoothstep(-0.004, 0.01, e));
  }
  // god rays streaming from the sun
  vec2 sp = rd.xy / rd.z - sunDir.xy / sunDir.z;
  float ang = atan(sp.y, sp.x);
  float gr = noise2(vec2(ang * 9.0, t * 0.05)) * noise2(vec2(ang * 23.0, -t * 0.04));
  col += vec3(1.0, 0.7, 0.4) * sq(gr) * exp(-length(sp) * 3.0) * 0.6 * smoothstep(-0.05, 0.02, e);
  col += motes(p, t, vec2(0.03, 0.0), vec3(1.0, 0.85, 0.6), vec3(1.0, 0.7, 0.6), 0.10) * 0.25;
  return col;
}

// ======================================================= composition
// origin → stardust → home → water → dawn → night → (origin)
vec3 scene(int id, vec2 p, float t){
  if(id == 0) return sOrigin(p, t);
  if(id == 1) return sStardust(p, t);
  if(id == 2) return sHome(p, t);
  if(id == 3) return sWater(p, t);
  if(id == 4) return sDawn(p, t);
  return sNight(p, t);
}

vec3 aces(vec3 x){
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

uniform int uDirect;     // 1: no float buffers, finish the image here

void main(){
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec3 col = vec3(0.0);
  if(uMix < 0.999) col = scene(uA, p, uTA) * (1.0 - uMix);
  if(uMix > 0.001) col += scene(uB, p, uTB) * uMix;

  col *= 0.94 + 0.06 * uBreath;
  col *= 1.0 + uPulse * 0.06;
  if(!(col.r >= 0.0 && col.g >= 0.0 && col.b >= 0.0 && col.r < 1e5 && col.g < 1e5 && col.b < 1e5)) col = vec3(0.0);
  col = clamp(col, 0.0, 2000.0);

  if(uDirect == 1){
    vec2 v = gl_FragCoord.xy / uRes - 0.5;
    col *= 1.0 - 0.55 * dot(v, v);
    col = pow(aces(col * 1.1), vec3(1.0 / 2.2)) * uFade;
    col += (hash12(gl_FragCoord.xy + fract(uTime) * 91.7) - 0.5) / 255.0;
  }
  outColor = vec4(col, 1.0);
}
`;

// ------------------------------------------------------------------ bloom
// dual-filter blur: a chain of half-size downsamples, then additive upsamples

window.HERE_DOWN = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uSrcTexel;
uniform vec2 uDstTexel;
uniform int uFirst;
out vec4 outColor;
void main(){
  vec2 uv = gl_FragCoord.xy * uDstTexel;
  vec2 o = uSrcTexel;
  vec3 s = texture(uTex, uv).rgb * 4.0;
  s += texture(uTex, uv + vec2(-o.x, -o.y)).rgb;
  s += texture(uTex, uv + vec2( o.x, -o.y)).rgb;
  s += texture(uTex, uv + vec2(-o.x,  o.y)).rgb;
  s += texture(uTex, uv + vec2( o.x,  o.y)).rgb;
  s *= 0.125;
  if(!(s.r >= 0.0 && s.g >= 0.0 && s.b >= 0.0 && s.r < 1e5 && s.g < 1e5 && s.b < 1e5)) s = vec3(0.0);
  if(uFirst == 1){
    // only light brighter than the scene's whites contributes; soft knee
    float l = max(s.r, max(s.g, s.b));
    float k = clamp(l - 0.35, 0.0, 1.2);
    k = k * k / 2.4;
    s *= max(k, l - 1.0) / max(l, 1e-4);
    s = min(s, vec3(200.0));
  }
  outColor = vec4(s, 1.0);
}
`;

window.HERE_UP = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uSrcTexel;
uniform vec2 uDstTexel;
uniform float uWeight;
out vec4 outColor;
void main(){
  vec2 uv = gl_FragCoord.xy * uDstTexel;
  vec2 o = uSrcTexel;
  vec3 s = vec3(0.0);
  s += texture(uTex, uv + vec2(-2.0 * o.x, 0.0)).rgb;
  s += texture(uTex, uv + vec2( 2.0 * o.x, 0.0)).rgb;
  s += texture(uTex, uv + vec2(0.0, -2.0 * o.y)).rgb;
  s += texture(uTex, uv + vec2(0.0,  2.0 * o.y)).rgb;
  s += texture(uTex, uv + vec2(-o.x, -o.y)).rgb * 2.0;
  s += texture(uTex, uv + vec2( o.x, -o.y)).rgb * 2.0;
  s += texture(uTex, uv + vec2(-o.x,  o.y)).rgb * 2.0;
  s += texture(uTex, uv + vec2( o.x,  o.y)).rgb * 2.0;
  outColor = vec4(s / 12.0 * uWeight, 1.0);
}
`;

window.HERE_COMP = `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform vec2 uRes;
uniform float uTime;
uniform float uFade;
uniform float uBloomAmt;
out vec4 outColor;
float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 aces(vec3 x){
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 col = texture(uScene, uv).rgb;
  vec3 bl = texture(uBloom, uv).rgb;
  col += bl * uBloomAmt;
  vec2 v = uv - 0.5;
  col *= 1.0 - 0.55 * dot(v, v);
  col = pow(aces(col * 1.1), vec3(1.0 / 2.2)) * uFade;
  col += (hash12(gl_FragCoord.xy + fract(uTime) * 91.7) - 0.5) / 255.0;
  outColor = vec4(col, 1.0);
}
`;
