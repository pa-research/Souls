// GLSL sources for the portrait renderer (WebGL2). All lighting happens in linear RGB; the composite pass
// tone-maps (ACES fit), converts to display gamma and then colour-grades.
'use strict';
window.SHADERS = (function () {
  const vert = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

  // Shared noise helpers. Coordinates are kept small (seed offsets < 100) so the float hashes stay stable.
  const common = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uSeed;
out vec4 fragColor;

float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy) * 2.0 - 1.0; }
float gnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(mix(dot(hash22(i), f), dot(hash22(i + vec2(1, 0)), f - vec2(1, 0)), u.x),
             mix(dot(hash22(i + vec2(0, 1)), f - vec2(0, 1)), dot(hash22(i + vec2(1, 1)), f - vec2(1, 1)), u.x), u.y);
}
const mat2 ROT = mat2(0.80, 0.60, -0.60, 0.80);
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 6; i++) { s += a * gnoise(p); p = ROT * p * 2.03 + 17.1; a *= 0.5; } return s; }
float fbm4(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * gnoise(p); p = ROT * p * 2.03 + 17.1; a *= 0.5; } return s; }
float ridged(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * (1.0 - abs(gnoise(p) * 1.6)); p = ROT * p * 2.1 + 9.3; a *= 0.5; } return s; }
vec2 voronoi(vec2 p) { // x: distance to nearest cell point, y: distance to second nearest
  vec2 n = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j)); vec2 o = 0.5 + 0.45 * hash22(n + g); float d = length(g + o - f);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
  }
  return vec2(d1, d2);
}
// canvas-sourced textures are stored top row first
vec2 tc(vec2 uv) { return vec2(uv.x, 1.0 - uv.y); }
`;

  // ---------------------------------------------------------------- background (sky, light, clouds, scenery, mist)
  const bg = common + `
uniform vec2 uLight;          // light centre, GL uv
uniform float uLightKind;     // 0 glow only, 1 moon, 2 sun
uniform float uLightR;        // disc radius as a fraction of the height
uniform vec3 uSkyTop, uSkyBot, uGlowCol, uDiscCol, uCloudDark, uCloudLit, uFogCol;
uniform vec3 uSceneFar, uSceneMid, uSceneNear;
uniform float uGlowStr, uGlowSize, uCloudAmt, uCloudScale, uWarp, uCloudStyle, uRayAmt, uRayFreq, uMist, uMistY;
uniform float uHalo;          // ring around the light (epic / legendary)
uniform float uSceneLit;      // how much the light silhouettes the scenery edges
uniform sampler2D uScenery;   // r far, g mid, b near (coverage)
uniform sampler2D uSigil;     // glowing symbol behind the subject: r sharp, g soft, b wide glow
uniform vec3 uSigilCol;
uniform float uSigilStr;

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float asp = uRes.x / uRes.y;
  vec2 p = vec2(uv.x * asp, uv.y);
  vec2 L = vec2(uLight.x * asp, uLight.y);
  vec2 dl = p - L; float d = length(dl);
  vec2 so = vec2(uSeed * 7.31, uSeed * 3.17);

  // sky gradient, brighter around the light
  vec3 col = mix(uSkyBot, uSkyTop, smoothstep(0.0, 1.05, uv.y));
  float g1 = exp(-d / (0.07 * uGlowSize)), g2 = exp(-d / (0.22 * uGlowSize)), g3 = exp(-d / (0.7 * uGlowSize));
  col += uGlowCol * uGlowStr * (0.07 * g3 + 0.38 * g2 + 1.4 * g1);

  // angular light rays in the sky
  float ang = atan(dl.y, dl.x);
  float rn = fbm4(vec2(cos(ang), sin(ang)) * uRayFreq + so * 0.1);
  float rays = smoothstep(-0.05, 0.45, rn) * exp(-d * 1.6) * (1.0 - exp(-d * 9.0));
  col += uGlowCol * rays * uRayAmt;

  // disc: moon or sun
  float R = uLightR;
  if (uLightKind > 0.5) {
    float disc = 1.0 - smoothstep(R - 0.003, R + 0.003, d);
    vec3 dc = uDiscCol;
    if (uLightKind < 1.5) { // moon: maria and craters, darker limb
      vec2 mp = dl / max(R, 1e-3);
      float maria = fbm4(mp * 1.6 + so);
      float crat = voronoi(mp * 3.0 + so).x;
      dc *= 0.78 + 0.22 * smoothstep(-0.3, 0.3, maria) + 0.08 * smoothstep(0.1, 0.35, crat);
      dc *= mix(1.0, 0.82, smoothstep(0.5, 1.0, length(mp)));
    } else { dc *= 1.6; }
    col = mix(col, dc, disc);
    col += uGlowCol * exp(-max(d - R, 0.0) / 0.03) * 0.45 * uGlowStr;
  }
  if (uHalo > 0.0) {
    float hr = max(R, 0.06) * 2.2 + 0.08;
    col += uGlowCol * uHalo * (0.55 * exp(-pow((d - hr) / 0.012, 2.0)) + 0.25 * exp(-pow((d - hr * 1.45) / 0.03, 2.0)));
  }

  // clouds / smoke (domain warped fbm) lit from the light direction
  vec2 q = p * uCloudScale + so;
  if (uCloudStyle > 1.5) q *= vec2(0.55, 1.9); // long mist bands
  vec2 w = vec2(fbm4(q), fbm4(q + vec2(5.2, 1.3)));
  vec2 w2 = vec2(fbm4(q + 4.0 * w + vec2(1.7, 9.2)), fbm4(q + 4.0 * w + vec2(8.3, 2.8)));
  vec2 qq = q + uWarp * w2;
  float n = fbm(qq);
  vec2 toL = normalize(-dl + 1e-4);
  float n2 = fbm(qq + toL * 0.12);
  float dens;
  if (uCloudStyle < 0.5) dens = smoothstep(-0.25, 0.45, n + 0.25 * length(w2));        // swirling smoke
  else if (uCloudStyle < 1.5) dens = smoothstep(-0.05, 0.35, n + 0.15 * w.x);         // cumulus
  else dens = smoothstep(-0.1, 0.4, n);                                               // mist bands
  dens *= uCloudAmt;
  float edge = clamp((n - n2) * 4.0, 0.0, 1.0);
  float lit = clamp(0.12 + 1.0 * g2 + 0.8 * g1 + 0.15 * g3 + edge * (0.25 + 1.5 * g2), 0.0, 2.0);
  vec3 cc = mix(uCloudDark, uCloudLit, clamp(lit, 0.0, 1.0)) * (0.7 + 0.45 * lit);
  col = mix(col, cc, dens);
  col += uGlowCol * uGlowStr * 0.3 * g1 * (1.0 - dens * 0.5); // light bleeding through

  if (uSigilStr > 0.0) {
    vec4 sg = texture(uSigil, tc(uv));
    col += uSigilCol * uSigilStr * (0.9 * sg.r + 0.45 * sg.g + 0.3 * sg.b) * (0.75 + 0.5 * fbm4(p * 9.0 + so));
  }

  // scenery layers with aerial perspective
  vec4 sc = texture(uScenery, tc(uv));
  float mistN = fbm4(p * vec2(2.2, 7.0) + so * 0.7);
  float glowNear = clamp(g2 * 1.2 + g1 + 0.15 * g3, 0.0, 1.0);
  vec3 far = mix(uSceneFar, col, 0.35) * (0.9 + 0.25 * fbm4(p * 6.0 + so));
  far += uGlowCol * glowNear * 0.25 * uSceneLit;
  col = mix(col, far, sc.r);
  float m1 = uMist * smoothstep(uMistY + 0.12, uMistY - 0.12, uv.y) * (0.55 + 0.6 * mistN);
  col = mix(col, uFogCol * (0.7 + 0.8 * glowNear), clamp(m1, 0.0, 1.0));
  vec3 mid = uSceneMid * (0.85 + 0.35 * fbm4(p * 9.0 + so.yx));
  mid += uGlowCol * glowNear * 0.08 * uSceneLit;
  col = mix(col, mid, sc.g);
  float m2 = uMist * 0.8 * smoothstep(uMistY - 0.02, uMistY - 0.3, uv.y) * (0.5 + 0.7 * fbm4(p * vec2(1.6, 6.0) - so * 0.5));
  col = mix(col, uFogCol * (0.55 + 0.6 * glowNear), clamp(m2, 0.0, 1.0));
  vec3 nearc = uSceneNear * (0.8 + 0.4 * fbm4(p * 14.0 + so));
  col = mix(col, nearc, sc.b);

  fragColor = vec4(max(col, 0.0), 1.0);
}`;

  // ---------------------------------------------------------------- god rays: radial blur of the bright background, occluded by the subject
  const rays = common + `
uniform sampler2D uBg;
uniform sampler2D uSdf;
uniform vec2 uLight;
uniform float uThreshold, uDensity, uDecay;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  const int N = 72;
  vec2 delta = (uv - uLight) * uDensity / float(N);
  vec2 c = uv - delta * hash12(gl_FragCoord.xy + uSeed);
  float illum = 1.0; vec3 acc = vec3(0.0);
  for (int i = 0; i < N; i++) {
    c -= delta;
    vec3 s = texture(uBg, c).rgb;
    float lum = dot(s, vec3(0.3, 0.6, 0.1));
    s *= smoothstep(uThreshold, uThreshold * 2.5, lum);
    float occ = clamp(texture(uSdf, tc(c)).r * 0.25 + 0.5, 0.0, 1.0);
    acc += s * (1.0 - occ) * illum;
    illum *= uDecay;
  }
  fragColor = vec4(acc / float(N), 1.0);
}`;

  // ---------------------------------------------------------------- composite: subject lighting + atmosphere + grade
  const comp = common + `
uniform sampler2D uBg, uRays, uSdf, uAux, uPartB, uPartF;
uniform vec2 uLight;
uniform vec3 uRimCol, uKeyCol, uAmbCol, uEmitCol, uAuraCol, uBaseCol, uBase2Col, uAccentCol, uSpecCol, uFogCol, uGlowCol;
uniform vec3 uKeyDir;
uniform float uMat, uAccentMat;
uniform float uRimStr, uRimW, uBackStr, uKeyStr, uSpecStr, uShin, uBevelW, uBevelH, uDomeW, uDomeH, uDetRim;
uniform float uTexScale, uTexAmt, uBump, uGroove, uEmitStr, uBodyFade, uFadeLo, uFadeHi;
uniform float uAuraStr, uAuraW, uOutline, uShadow, uRaysStr, uRaysOver, uFogFront, uFogY, uAlpha;
uniform vec2 uShadowOff;

// material ids: 0 shadow, 1 bone, 2 iron, 3 gold, 4 stone, 5 fur, 6 cloth, 7 ethereal, 8 ice, 9 bark, 10 flesh, 11 blood
float matNoise(float mat, vec2 p) {
  vec2 q = p * uTexScale;
  if (mat < 0.5) return fbm4(q * 0.5) * 0.6;
  if (mat < 1.5) return fbm4(q) * 0.6 - pow(clamp(1.0 - abs(gnoise(q * 0.7) * 3.0), 0.0, 1.0), 6.0) * 0.6;
  if (mat < 2.5) return fbm4(q * vec2(0.25, 3.0)) * 0.35 + fbm4(q * 2.0) * 0.15;
  if (mat < 3.5) return fbm4(q * 0.8) * 0.4;
  if (mat < 4.5) { vec2 v = voronoi(q * 0.5); return fbm(q) * 0.8 - (1.0 - smoothstep(0.0, 0.12, v.y - v.x)) * 0.35; }
  if (mat < 5.5) return fbm4(vec2(q.x * 2.2 + 0.4 * q.y, q.y * 0.18)) * 0.9;
  if (mat < 6.5) return fbm4(q * 0.6) * 0.5;
  if (mat < 7.5) return 0.0;
  if (mat < 8.5) { vec2 v = voronoi(q * 0.45); return (v.y - v.x) * 0.6 + fbm4(q) * 0.2; }
  if (mat < 9.5) return fbm4(vec2(q.x * 0.35, q.y * 1.4)) * 0.8 + fbm4(q * 1.5) * 0.3;
  return fbm4(q) * 0.5;
}

float sSil(vec2 uv) { return texture(uSdf, tc(uv)).r; }
float sDet(vec2 uv) { return texture(uSdf, tc(uv)).g; }
// relief height (px): soft rounded bevel from the detail SDF (holes become grooves), a broad dome over the silhouette
float heightAt(vec2 uv, float mat, vec2 p) {
  vec4 t = texture(uSdf, tc(uv));
  float b = clamp(t.g / uBevelW, 0.0, 1.0);
  float h = uBevelH * (1.0 - (1.0 - b) * (1.0 - b));
  h += uDomeH * t.b;
  h += uBump * matNoise(mat, p);
  return h;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 px = 1.0 / uRes;
  float asp = uRes.x / uRes.y;
  vec2 p = vec2(uv.x * asp, uv.y);
  vec2 L = vec2(uLight.x * asp, uLight.y);

  vec4 sd = texture(uSdf, tc(uv));
  float sil = sd.r, det = sd.g;
  vec4 aux = texture(uAux, tc(uv));
  float accent = aux.r, emitM = aux.g, blurM = aux.b;
  float mSil = clamp(sil * 0.6 + 0.5, 0.0, 1.0);
  float mDet = clamp(det * 0.6 + 0.5, 0.0, 1.0);
  float hole = mSil * (1.0 - mDet);

  // ---------------- background with contact shadow, outline and aura
  vec3 col = texture(uBg, uv).rgb;
  float outside = max(-sil, 0.0);
  float shadowM = texture(uAux, tc(uv + uShadowOff)).b;
  col *= 1.0 - uShadow * shadowM * (1.0 - mSil);
  col *= 1.0 - uOutline * exp(-outside / 8.0) * (1.0 - mSil);
  vec2 gS = vec2(sSil(uv + vec2(px.x * 2.0, 0)) - sSil(uv - vec2(px.x * 2.0, 0)), sSil(uv + vec2(0, px.y * 2.0)) - sSil(uv - vec2(0, px.y * 2.0)));
  vec2 nOut = -normalize(gS + 1e-5);           // outward normal of the silhouette
  vec2 toL = normalize(L - p + 1e-5);
  float facing = dot(nOut, toL);
  float lightNear = exp(-length(L - p) * 1.6);
  float aura = exp(-outside / uAuraW) * (0.25 + 0.75 * smoothstep(-0.3, 0.9, facing)) * (0.35 + 0.9 * lightNear);
  col += uAuraCol * aura * uAuraStr * (1.0 - mSil);

  col += texture(uPartB, tc(uv)).rgb * (1.0 - mSil * 0.85);

  // ---------------- subject
  if (mSil > 0.0) {
    float mat = accent > 0.5 ? uAccentMat : uMat;
    float e = 1.5;
    float hx = heightAt(uv + vec2(px.x * e, 0), mat, p + vec2(px.x * e * asp, 0)) - heightAt(uv - vec2(px.x * e, 0), mat, p - vec2(px.x * e * asp, 0));
    float hy = heightAt(uv + vec2(0, px.y * e), mat, p + vec2(0, px.y * e)) - heightAt(uv - vec2(0, px.y * e), mat, p - vec2(0, px.y * e));
    vec3 N = normalize(vec3(-hx / (2.0 * e), -hy / (2.0 * e), 1.0));

    float tn = matNoise(mat, p + 3.1);
    vec3 base = mix(uBaseCol, uBase2Col, clamp(0.5 + tn * uTexAmt * 2.0, 0.0, 1.0));
    if (accent > 0.5) base = uAccentCol * (0.8 + tn * uTexAmt);
    if (mat > 8.5 && mat < 9.5) base = mix(base, uBase2Col * 1.15, smoothstep(0.0, 0.3, fbm4(p * uTexScale * 0.25 + 4.0)) * smoothstep(-0.2, 0.6, N.y)); // moss on top faces

    vec3 Lk = normalize(uKeyDir);
    vec3 V = vec3(0, 0, 1);
    float wrapD = clamp((dot(N, Lk) + 0.4) / 1.4, 0.0, 1.0);
    float fall = mix(1.0 - uBodyFade, 1.0, smoothstep(uFadeLo, uFadeHi, uv.y)) * (0.7 + 0.6 * lightNear);
    vec3 Lb = normalize(vec3(toL, -0.2));
    float back = pow(max(dot(N, Lb), 0.0), 2.0) * (1.0 - smoothstep(0.0, uBevelW * 2.0, det));
    float spec = pow(max(dot(N, normalize(Lk + V)), 0.0), uShin);
    bool metal = (mat > 1.5 && mat < 3.5) || mat > 10.5;

    float groove = hole * uGroove;
    float ao = (1.0 - 0.55 * groove) * (1.0 - 0.3 * (1.0 - smoothstep(0.0, uBevelW * 1.5, det)) * smoothstep(0.45, 0.9, blurM));
    vec3 lit;
    if (metal) {
      // polished metal reflects a sky-bright-above / dark-below environment
      float env = smoothstep(-0.35, 0.95, N.y * 0.75 + dot(N.xy, toL) * 0.45 + 0.1);
      lit = base * (uAmbCol * 0.6 + uKeyCol * uKeyStr * (0.15 + 1.1 * env) * fall) * ao;
      lit += base * uSpecCol * spec * uSpecStr * 2.0 * fall;
    } else {
      lit = base * (uAmbCol + uKeyCol * wrapD * uKeyStr * fall) * ao;
      lit += uSpecCol * spec * uSpecStr * fall * ao;
    }
    // back light: thin rim on the silhouette edge facing the light, a little on inner edges and bevels
    float rimEdge = (1.0 - smoothstep(0.0, uRimW, sil)) * pow(clamp(facing * 0.5 + 0.5, 0.0, 1.0), 2.0);
    vec2 gD = vec2(sDet(uv + vec2(px.x, 0)) - sDet(uv - vec2(px.x, 0)), sDet(uv + vec2(0, px.y)) - sDet(uv - vec2(0, px.y)));
    float rimDet = (1.0 - smoothstep(0.0, uRimW * 0.6, det)) * pow(clamp(dot(-normalize(gD + 1e-5), toL) * 0.5 + 0.5, 0.0, 1.0), 3.0) * (1.0 - hole);
    lit += uRimCol * (back * uBackStr * fall + (rimEdge * 1.4 + rimDet * uDetRim) * uRimStr) * (0.45 + 0.8 * lightNear);

    if (mat > 6.5 && mat < 7.5) { // ethereal: glows from within, partly transparent
      float inner = smoothstep(0.0, uDomeW, sil);
      lit = uBaseCol * (0.3 + 0.9 * (1.0 - inner)) * fall + uBase2Col * (0.5 + fbm4(p * 5.0 + vec2(0.0, uSeed))) * 0.45 * fall + uRimCol * rimEdge * uRimStr;
      lit *= (1.0 - 0.6 * groove);
    }
    if (mat > 7.5 && mat < 8.5) { // ice: cold subsurface glow in thin parts and sparkles
      lit += uBase2Col * 0.12 * (1.0 - smoothstep(0.0, uDomeW * 0.5, sil)) * fall;
      lit += vec3(1.0) * pow(hash12(floor(gl_FragCoord.xy / 3.0)), 80.0) * 2.0 * wrapD;
    }
    col = mix(col, lit, mSil * uAlpha);
    if (uAlpha < 1.0) col += lit * mSil * (1.0 - uAlpha) * 0.5;
  }

  // ---------------- emissive details (eyes, flames)
  float emit = emitM * (hole * 2.6 + mDet * 0.35) + emitM * emitM * 0.45;
  col += uEmitCol * emit * uEmitStr;

  // ---------------- god rays and front atmosphere
  vec3 r = texture(uRays, uv).rgb;
  col += r * uRaysStr * (1.0 - mSil * (1.0 - uRaysOver));
  float fogN = fbm4(vec2(p.x * 1.6, p.y * 5.5) + vec2(uSeed * 1.7, 0.0));
  float band = smoothstep(uFogY, 0.0, uv.y);
  float fog = clamp(band * (0.3 + 1.1 * (fogN + 0.2)), 0.0, 1.0) * uFogFront;
  col = mix(col, uFogCol * (0.5 + 1.0 * lightNear), fog);
  col += texture(uPartF, tc(uv)).rgb;
  fragColor = vec4(max(col, 0.0), 1.0);
}`;

  // ---------------------------------------------------------------- post: painterly (Kuwahara) filter, tone map, grade, vignette, grain
  const post = common + `
uniform sampler2D uImg;
uniform float uPaint, uExposure, uSat, uContrast, uSplit, uVignette, uGrain, uLift;
uniform vec3 uShadowTint, uHiTint;
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
vec3 disp(vec3 c) { return pow(aces(c * uExposure), vec3(1.0 / 2.2)); }
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 col;
  if (uPaint > 0.0) {
    const int R = 3;
    vec2 st = uPaint / float(R) / uRes;
    vec3 m0 = vec3(0), m1 = vec3(0), m2 = vec3(0), m3 = vec3(0), s0 = vec3(0), s1 = vec3(0), s2 = vec3(0), s3 = vec3(0);
    for (int j = -R; j <= R; j++) for (int i = -R; i <= R; i++) {
      vec3 c = disp(texture(uImg, uv + vec2(float(i), float(j)) * st).rgb), c2 = c * c;
      if (i <= 0 && j <= 0) { m0 += c; s0 += c2; }
      if (i >= 0 && j <= 0) { m1 += c; s1 += c2; }
      if (i <= 0 && j >= 0) { m2 += c; s2 += c2; }
      if (i >= 0 && j >= 0) { m3 += c; s3 += c2; }
    }
    float n = float((R + 1) * (R + 1));
    m0 /= n; m1 /= n; m2 /= n; m3 /= n;
    vec3 v0 = s0 / n - m0 * m0, v1 = s1 / n - m1 * m1, v2 = s2 / n - m2 * m2, v3 = s3 / n - m3 * m3;
    float w0 = 1.0 / (1.0 + pow(400.0 * (v0.r + v0.g + v0.b), 2.0));
    float w1 = 1.0 / (1.0 + pow(400.0 * (v1.r + v1.g + v1.b), 2.0));
    float w2 = 1.0 / (1.0 + pow(400.0 * (v2.r + v2.g + v2.b), 2.0));
    float w3 = 1.0 / (1.0 + pow(400.0 * (v3.r + v3.g + v3.b), 2.0));
    col = (m0 * w0 + m1 * w1 + m2 * w2 + m3 * w3) / (w0 + w1 + w2 + w3);
  } else {
    col = disp(texture(uImg, uv).rgb);
  }
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col += (uShadowTint - 0.5) * uSplit * (1.0 - lum) * (1.0 - lum) + (uHiTint - 0.5) * uSplit * lum * lum;
  lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, uSat);
  col = clamp((col - 0.5) * uContrast + 0.5 + uLift, 0.0, 1.0);
  vec2 vc = (uv - vec2(0.5, 0.52)) * vec2(1.0, 0.82);
  col *= 1.0 - uVignette * smoothstep(0.18, 0.75, length(vc));
  float g = hash12(gl_FragCoord.xy + fract(uSeed * 0.123) * 917.0) - 0.5;
  col += g * uGrain * (0.35 + 0.65 * (1.0 - abs(lum - 0.45) * 1.6));
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

  return { vert, bg, rays, comp, post };
})();
