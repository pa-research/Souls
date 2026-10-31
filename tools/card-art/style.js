// The look of the set: race palettes, moods, materials and rarity drama. generate.js merges, in order,
// race defaults -> mood -> material -> rarity -> the card's own "tweak" block, then hands the flat result to the browser.
'use strict';

// sRGB hex -> linear RGB (lighting runs in linear space)
function lin(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => Math.pow(v / 255, 2.2));
}
// sRGB hex -> display-space RGB 0..1 (grading tints)
function disp(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => v / 255);
}
const rgbStr = hex => { const n = parseInt(hex.replace('#', ''), 16); return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`; };

// Uniforms whose values are colours (converted with lin() unless listed in DISPLAY).
const COLORS = ['SkyTop', 'SkyBot', 'GlowCol', 'DiscCol', 'CloudDark', 'CloudLit', 'FogCol', 'SceneFar', 'SceneMid', 'SceneNear',
  'RimCol', 'KeyCol', 'AmbCol', 'EmitCol', 'AuraCol', 'BaseCol', 'Base2Col', 'AccentCol', 'SpecCol', 'SigilCol'];
const DISPLAY = ['ShadowTint', 'HiTint'];

const MATERIAL_IDS = { shadow: 0, bone: 1, iron: 2, gold: 3, stone: 4, fur: 5, cloth: 6, ethereal: 7, ice: 8, bark: 9, flesh: 10, blood: 11 };

// Shared defaults (every race overrides colours).
const BASE = {
  LightKind: 0, LightR: 0.12, GlowStr: 1.0, GlowSize: 1.0, CloudAmt: 0.8, CloudScale: 2.0, Warp: 1.2, CloudStyle: 0,
  RayAmt: 0.25, RayFreq: 3.0, Mist: 0.5, MistY: 0.32, Halo: 0, SceneLit: 1.0,
  Threshold: 0.35, Density: 0.9, Decay: 0.968,
  RimStr: 1.5, RimW: 6, BackStr: 0.35, KeyStr: 0.8, SpecStr: 0.25, Shin: 24, DetRim: 0.15,
  BevelW: 16, BevelH: 5, DomeW: 170, DomeH: 34, TexScale: 30, TexAmt: 0.5, Bump: 2.0, Groove: 1.0, EmitStr: 1.6,
  BodyFade: 0.55, FadeLo: 0.12, FadeHi: 0.75, Paint: 3.5,
  AuraStr: 0.7, AuraW: 18, Outline: 0.0, Shadow: 0.0, ShadowOff: [-0.006, 0.010], RaysStr: 0.6, RaysOver: 0.08,
  SigilCol: '#ff2020', SigilStr: 0.0,
  FogFront: 0.45, FogY: 0.28, Exposure: 1.0, Sat: 1.0, Contrast: 1.06, Split: 0.22, Vignette: 0.55, Grain: 0.05, Alpha: 1.0, Lift: 0.0,
  SpecCol: '#ffffff', AccentCol: '#8a8a8a', AccentMat: 'iron',
};

const RACES = {
  darkness: {
    light: [0.5, 0.3], lightKind: 'moon', motif: 'graveyard', particles: 'ash', particleColor: '#c8d8d0', particleCount: 140,
    material: 'shadow',
    u: {
      SkyTop: '#040308', SkyBot: '#1a1428', GlowCol: '#a8ccb6', DiscCol: '#dce8d4', GlowStr: 1.0, LightR: 0.11,
      CloudDark: '#0a0812', CloudLit: '#4c466a', FogCol: '#2e2a42', CloudStyle: 0, CloudAmt: 0.85, CloudScale: 2.2, Warp: 1.5,
      SceneFar: '#221c34', SceneMid: '#0e0a16', SceneNear: '#030205',
      RimCol: '#d8ffe4', KeyCol: '#7a6aa4', AmbCol: '#1a1428', EmitCol: '#b0ff90', AuraCol: '#a4d8b8',
      ShadowTint: '#5a2c8a', HiTint: '#e2ffe6', Split: 0.26,
    },
  },
  vampiric: {
    light: [0.5, 0.3], lightKind: 'moon', motif: 'gothic', particles: 'blood', particleColor: '#ff3a2a', particleCount: 120,
    material: 'cloth',
    u: {
      SkyTop: '#040205', SkyBot: '#160208', GlowCol: '#a8201e', DiscCol: '#b03424', GlowStr: 0.8, LightR: 0.12,
      CloudDark: '#080306', CloudLit: '#3a1418', FogCol: '#22060a', CloudStyle: 0, CloudAmt: 0.85, CloudScale: 1.8, Warp: 1.3,
      SceneFar: '#2c060e', SceneMid: '#120205', SceneNear: '#040001',
      RimCol: '#ff8a78', KeyCol: '#8a7c8c', AmbCol: '#120608', EmitCol: '#ff2a1a', AuraCol: '#b02a26',
      ShadowTint: '#4a0018', HiTint: '#ffdcc8', Split: 0.24,
    },
  },
  lightbringer: {
    light: [0.5, 0.3], lightKind: 'sun', motif: 'cathedral', particles: 'sparks', particleColor: '#ffe6a0', particleCount: 110,
    material: 'gold',
    u: {
      SkyTop: '#061436', SkyBot: '#2a4a7c', GlowCol: '#ffd690', DiscCol: '#fffbe8', GlowStr: 1.15, LightR: 0.07, GlowSize: 0.8,
      CloudDark: '#1c2c50', CloudLit: '#ffdca4', FogCol: '#5a6070', CloudStyle: 1, CloudAmt: 0.7, CloudScale: 1.5, Warp: 0.7,
      SceneFar: '#4a5470', SceneMid: '#22263a', SceneNear: '#0a0a14',
      RimCol: '#fff0d0', KeyCol: '#ffe2a8', AmbCol: '#2c3456', EmitCol: '#fff0b0', AuraCol: '#ffc870',
      KeyStr: 1.05, Outline: 0.5, Shadow: 0.3, AuraW: 12,
      ShadowTint: '#1c2c5c', HiTint: '#fff2d4', Split: 0.2, Mist: 0.35,
    },
  },
  ferocious: {
    light: [0.5, 0.32], lightKind: 'sun', motif: 'forest', particles: 'fireflies', particleColor: '#ffc860', particleCount: 60,
    material: 'fur',
    u: {
      SkyTop: '#030d08', SkyBot: '#22422a', GlowCol: '#ff9a38', DiscCol: '#ffd08a', GlowStr: 0.9, LightR: 0.08, GlowSize: 0.85,
      CloudDark: '#08160c', CloudLit: '#74883a', FogCol: '#32583a', CloudStyle: 2, CloudAmt: 0.65, CloudScale: 1.8, Warp: 1.0,
      SceneFar: '#1a3024', SceneMid: '#08140c', SceneNear: '#020503',
      RimCol: '#ffd088', KeyCol: '#c09a6c', AmbCol: '#1a2a1c', EmitCol: '#ffb020', AuraCol: '#e8a048',
      ShadowTint: '#103a20', HiTint: '#ffe4a8', Split: 0.24,
    },
  },
  neutral: { // the Lost Soul token
    light: [0.5, 0.4], lightKind: 'none', motif: 'void', particles: 'wisps', particleColor: '#9cc8ff', particleCount: 70,
    material: 'ethereal',
    u: {
      SkyTop: '#04060c', SkyBot: '#141e30', GlowCol: '#7aa8e0', DiscCol: '#e0ecff', GlowStr: 0.9,
      CloudDark: '#080c16', CloudLit: '#3c5478', FogCol: '#2c3c58', CloudStyle: 0, CloudAmt: 0.85, CloudScale: 2.4, Warp: 1.6,
      SceneFar: '#141c2c', SceneMid: '#0a0e18', SceneNear: '#020306',
      RimCol: '#e4f0ff', KeyCol: '#8aa8d8', AmbCol: '#1c2840', EmitCol: '#d8ecff', AuraCol: '#9cc4ff',
      ShadowTint: '#18284c', HiTint: '#e8f2ff', Split: 0.2,
    },
  },
};

// Moods: other lighting set-ups within a race (card "mood"), so a race keeps one palette family (its shadow tint,
// eye colour, particles) without every card sharing one sky. Same fields as a race; u is merged over the race's u.
const MOODS = {
  darkness: {
    plague: { // Pesta, plague and rot: sickly green-yellow murk
      lightKind: 'glow', particles: 'motes', particleColor: '#c8e080',
      u: {
        SkyTop: '#040604', SkyBot: '#1c2612', GlowCol: '#b4d460', DiscCol: '#e4f0b0', CloudDark: '#080c06', CloudLit: '#56662c',
        FogCol: '#2c3c1c', SceneFar: '#1e2a14', SceneMid: '#0a0e06', SceneNear: '#020301',
        RimCol: '#ecffb4', KeyCol: '#8c9c62', AmbCol: '#121a0c', EmitCol: '#d4ff60', AuraCol: '#b4dc70',
        ShadowTint: '#3a1a4a', HiTint: '#f0ffd0',
      },
    },
    nightmare: { // spirits and terrors: violet void
      lightKind: 'glow', particles: 'wisps', particleColor: '#c8a8ff',
      u: {
        SkyTop: '#06030c', SkyBot: '#26143c', GlowCol: '#a478ff', DiscCol: '#ece0ff', CloudDark: '#0c0618', CloudLit: '#5e3e90',
        FogCol: '#2c1c46', SceneFar: '#26183c', SceneMid: '#0e0818', SceneNear: '#030106',
        RimCol: '#ecdcff', KeyCol: '#8c74c4', AmbCol: '#160e24', EmitCol: '#d8b0ff', AuraCol: '#b494ff',
        ShadowTint: '#2a1050', HiTint: '#f2eaff',
      },
    },
  },
  vampiric: {
    moonlit: { // a pale cold moon over the castle; the crimson stays in eyes, blood and the shadows
      light: [0.5, 0.3], lightKind: 'moon', motif: 'castle', particles: 'ash', particleColor: '#e4d8ff', particleCount: 90,
      u: {
        SkyTop: '#05040c', SkyBot: '#201834', GlowCol: '#bcb2dc', DiscCol: '#eee8f6', GlowStr: 0.95, LightR: 0.13,
        CloudDark: '#0a0812', CloudLit: '#4e4266', FogCol: '#2c2238', SceneFar: '#2c2238', SceneMid: '#100a16', SceneNear: '#040206',
        RimCol: '#f2e8ff', KeyCol: '#aa9cc4', AmbCol: '#16101e', EmitCol: '#ff2a1a', AuraCol: '#bcace4',
        ShadowTint: '#4a0c30', HiTint: '#f6eeff', Split: 0.24,
      },
    },
    candle: { // candle-lit crypt: warm amber light, wine-dark stone
      light: [0.5, 0.4], lightKind: 'glow', motif: 'crypt', particles: 'embers', particleColor: '#ffb060', particleCount: 70,
      u: {
        SkyTop: '#070304', SkyBot: '#2c100a', GlowCol: '#ff9c44', GlowStr: 1.0, GlowSize: 0.9,
        CloudDark: '#0c0405', CloudLit: '#5e2c18', FogCol: '#3a160e', SceneFar: '#3c1610', SceneMid: '#160606', SceneNear: '#050101',
        RimCol: '#ffc888', KeyCol: '#d49464', AmbCol: '#1a0808', EmitCol: '#ff3a1a', AuraCol: '#ffa056',
        ShadowTint: '#4a0014', HiTint: '#ffe2b4', Split: 0.24,
      },
    },
    rosewindow: { // a crimson rose window in a dark chapel
      light: [0.5, 0.3], lightKind: 'glow', motif: 'cathedral', particles: 'motes', particleColor: '#ff7a96', particleCount: 80,
      u: {
        SkyTop: '#1c0420', SkyBot: '#6c0c24', GlowCol: '#ec3444', GlowStr: 1.0, CloudStyle: 1, CloudAmt: 0.6,
        CloudDark: '#2c0618', CloudLit: '#ff7458', FogCol: '#2c0a1a', SceneFar: '#4c1022', SceneMid: '#0e0408', SceneNear: '#030102',
        RimCol: '#ffb4c4', KeyCol: '#c47494', AmbCol: '#160612', EmitCol: '#ff2a2a', AuraCol: '#ff5474',
        ShadowTint: '#2c0834', HiTint: '#ffe2ea', Split: 0.22,
      },
    },
    dusk: { // the sun setting behind the hills, violet sky over a blood-orange horizon
      light: [0.5, 0.76], lightKind: 'sun', motif: 'castle', particles: 'motes', particleColor: '#ffa484', particleCount: 80,
      u: {
        SkyTop: '#0c0618', SkyBot: '#8c2c2c', GlowCol: '#ff6c3c', DiscCol: '#ffd4a4', GlowStr: 1.1, LightR: 0.09, GlowSize: 1.1,
        CloudDark: '#1c0a1c', CloudLit: '#e4643c', FogCol: '#4c1a2c', CloudStyle: 2, CloudAmt: 0.7,
        SceneFar: '#3c1428', SceneMid: '#140610', SceneNear: '#040104',
        RimCol: '#ffbc94', KeyCol: '#cc8474', AmbCol: '#180a18', EmitCol: '#ff3020', AuraCol: '#ff7454',
        ShadowTint: '#3c0a3c', HiTint: '#ffdab4', Split: 0.24,
      },
    },
  },
  lightbringer: {
    dawn: { // a low rose-gold sun on the horizon
      light: [0.5, 0.72], lightKind: 'sun', motif: 'sky', particles: 'sparks', particleColor: '#ffe2b4',
      u: {
        SkyTop: '#0a1034', SkyBot: '#b4626a', GlowCol: '#ffb070', DiscCol: '#fff6e0', GlowStr: 1.1, LightR: 0.1, GlowSize: 0.85,
        CloudDark: '#281e3c', CloudLit: '#ffb488', FogCol: '#84546c', CloudStyle: 2, CloudAmt: 0.7,
        SceneFar: '#6c5274', SceneMid: '#2c2238', SceneNear: '#0c0a14',
        RimCol: '#fff2dc', KeyCol: '#ffcca4', AmbCol: '#3c3254', EmitCol: '#fff0b4', AuraCol: '#ffbc84',
        ShadowTint: '#2c2254', HiTint: '#fff2dc',
      },
    },
  },
  ferocious: {
    moonwood: { // a cold moon over the pines
      light: [0.32, 0.26], lightKind: 'moon', particles: 'fireflies', particleColor: '#b4ffd8', particleCount: 50,
      u: {
        SkyTop: '#020810', SkyBot: '#142a3c', GlowCol: '#a0ccdc', DiscCol: '#eaf6f2', GlowStr: 0.9, LightR: 0.11,
        CloudDark: '#06101a', CloudLit: '#3c5c6c', FogCol: '#22424c', SceneFar: '#16323c', SceneMid: '#061218', SceneNear: '#010406',
        RimCol: '#dcf6ff', KeyCol: '#8cacbc', AmbCol: '#0e1c24', EmitCol: '#a4f4ff', AuraCol: '#94cce4',
        ShadowTint: '#0c2c30', HiTint: '#eafff8',
      },
    },
    frost: { // snow and ice under a white sun
      light: [0.68, 0.2], motif: 'mountains', particles: 'snow', particleColor: '#e8f6ff',
      u: {
        SkyTop: '#030a12', SkyBot: '#16303c', GlowCol: '#a8dcf0', DiscCol: '#f0faff', CloudLit: '#5a8494', CloudDark: '#0a1620',
        FogCol: '#3a5866', SceneFar: '#3a5a6a', SceneMid: '#122028', RimCol: '#e8faff', AuraCol: '#8cd0f0', KeyCol: '#b8d4e8',
        ShadowTint: '#0c3040', HiTint: '#f0faff', EmitCol: '#c8f4ff', GlowStr: 0.7,
      },
    },
  },
};

// Materials override the subject's surface. Colours here are race-agnostic; races can override per card.
const MATERIALS = {
  shadow: { BaseCol: '#1c1628', Base2Col: '#342a48', SpecStr: 0.12, Shin: 18, TexScale: 22, TexAmt: 0.6, Bump: 1.2, KeyStr: 0.55 },
  bone: { BaseCol: '#b8ae98', Base2Col: '#e0d8c4', SpecStr: 0.15, Shin: 14, TexScale: 26, TexAmt: 0.55, Bump: 2.4, KeyStr: 0.85 },
  iron: { BaseCol: '#3a3a42', Base2Col: '#5c5c66', SpecStr: 0.9, Shin: 40, TexScale: 20, TexAmt: 0.4, Bump: 0.8, KeyStr: 0.75 },
  gold: { BaseCol: '#9c6e24', Base2Col: '#d8b058', SpecStr: 1.1, Shin: 36, TexScale: 22, TexAmt: 0.45, Bump: 0.9, KeyStr: 1.0 },
  stone: { BaseCol: '#5a5650', Base2Col: '#8a847a', SpecStr: 0.1, Shin: 10, TexScale: 30, TexAmt: 0.6, Bump: 3.0, KeyStr: 0.9 },
  fur: { BaseCol: '#2e241a', Base2Col: '#5a4630', SpecStr: 0.08, Shin: 8, TexScale: 30, TexAmt: 0.8, Bump: 5.0, KeyStr: 0.85 },
  cloth: { BaseCol: '#2a0c12', Base2Col: '#4a141c', SpecStr: 0.18, Shin: 16, TexScale: 18, TexAmt: 0.5, Bump: 1.4, KeyStr: 0.7 },
  ethereal: { BaseCol: '#6a9ad8', Base2Col: '#b0d0ff', SpecStr: 0.0, TexAmt: 0.0, Bump: 0.0, Alpha: 0.85, DomeW: 90 },
  ice: { BaseCol: '#6a8cac', Base2Col: '#a8d4f4', SpecStr: 1.2, Shin: 50, TexScale: 16, TexAmt: 0.5, Bump: 3.0, KeyStr: 1.0 },
  bark: { BaseCol: '#3a2c1e', Base2Col: '#4a5a2a', SpecStr: 0.06, Shin: 8, TexScale: 22, TexAmt: 0.6, Bump: 3.2, KeyStr: 0.85 },
  flesh: { BaseCol: '#5a3c38', Base2Col: '#8a5c54', SpecStr: 0.2, Shin: 20, TexScale: 20, TexAmt: 0.45, Bump: 1.2, KeyStr: 0.8 },
  blood: { BaseCol: '#4a0408', Base2Col: '#8a0c14', SpecStr: 1.0, Shin: 60, TexScale: 14, TexAmt: 0.4, Bump: 0.6, KeyStr: 0.8 },
};

// Rarity drama: multipliers (x) and absolute values.
const RARITY = {
  C: { particles: 1.0, u: { RaysStr: 0.55, Halo: 0, AuraStr: 0.7 } },
  R: { particles: 1.25, u: { RaysStr: 0.8, Halo: 0, AuraStr: 0.85 }, x: { GlowStr: 1.05 } },
  E: { particles: 1.6, u: { RaysStr: 1.15, Halo: 0.35, AuraStr: 1.0 }, x: { GlowStr: 1.12, Sat: 1.05, RayAmt: 1.4 } },
  L: { particles: 2.3, u: { RaysStr: 1.7, Halo: 0.75, AuraStr: 1.2 }, x: { GlowStr: 1.25, Sat: 1.1, RayAmt: 2.0, Exposure: 1.04 } },
};

function resolve(card, icons) {
  let race = RACES[card.race];
  if (!race) throw new Error(`card ${card.id}: unknown race ${card.race}`);
  if (card.mood) {
    const mood = (MOODS[card.race] || {})[card.mood];
    if (!mood) throw new Error(`card ${card.id}: unknown mood ${card.mood} for ${card.race}`);
    race = Object.assign({}, race, mood, { u: Object.assign({}, race.u, mood.u) });
  }
  const rar = RARITY[card.rarity];
  if (!rar) throw new Error(`card ${card.id}: unknown rarity ${card.rarity}`);
  const material = card.material || race.material;
  if (!MATERIALS[material]) throw new Error(`card ${card.id}: unknown material ${material}`);

  const u = Object.assign({}, BASE, race.u, MATERIALS[material], rar.u);
  for (const [k, f] of Object.entries(rar.x || {})) u[k] *= f;
  Object.assign(u, card.tweak || {});
  if (!u.KeyDir) { // key light comes from the side of the scene's light, a bit from the front
    const l = card.light || race.light;
    u.KeyDir = [(l[0] - 0.5) * 1.4, (0.5 - l[1]) * 1.2 + 0.45, 0.75];
  }
  u.Mat = MATERIAL_IDS[material];
  u.AccentMat = MATERIAL_IDS[card.accentMaterial || u.AccentMat];
  const kind = card.lightKind || race.lightKind;
  u.LightKind = { none: 0, glow: 0, moon: 1, sun: 2 }[kind];
  if (kind === 'none') { u.GlowStr *= 0.6; }

  const uniforms = {};
  for (const [k, v] of Object.entries(u)) {
    if (k === 'AccentMat') { uniforms[k] = v; continue; }
    if (COLORS.includes(k)) uniforms[k] = lin(v);
    else if (DISPLAY.includes(k)) uniforms[k] = disp(v);
    else uniforms[k] = v;
  }

  const layers = card.layers.map(l => {
    const ic = icons[l.icon];
    if (!ic) throw new Error(`card ${card.id}: icon ${l.icon} not found`);
    const d = /\sd="([^"]+)"/.exec(ic.body)[1];
    return Object.assign({}, l, { d });
  });

  return {
    id: card.id,
    seed: card.seed != null ? card.seed : (typeof card.id === 'number' ? card.id : 77) * 31 + 5,
    layers,
    glow: card.glow || [],
    fill: card.fill || 0.74,
    maxW: card.maxW || 0.8,
    center: card.center || [0.5, 0.53],
    holeMax: card.holeMax != null ? card.holeMax : 0.03,
    blurR: card.blurR || 16,
    grow: card.grow || 0,
    dropSpecks: card.dropSpecks || 0,
    closeR: card.closeR != null ? card.closeR : 10,
    domeBlur: card.domeBlur || 28,
    light: card.light || race.light,
    motif: card.motif || race.motif,
    motifOpts: card.motifOpts || {},
    particles: card.particles || race.particles,
    particleRGB: rgbStr(card.particleColor || race.particleColor),
    particleCount: (card.particleCount || race.particleCount) * rar.particles,
    sigil: card.sigil ? Object.assign({}, card.sigil, { d: /\sd="([^"]+)"/.exec(icons[card.sigil.icon].body)[1] }) : null,
    uniforms,
  };
}

module.exports = { resolve, RACES, MOODS, MATERIALS, RARITY };
