// In-browser renderer: turns a resolved card spec (see style.js / generate.js) into a 708x501 portrait.
// Pipeline: icon paths -> masks (Canvas 2D) -> signed distance fields (exact EDT) -> WebGL2 passes
// (background, god rays, composite) at 2x -> downsample.
'use strict';
(function () {
  const OUT_W = 708, OUT_H = 501, SS = 2;
  const W = OUT_W * SS, H = OUT_H * SS;

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  // ------------------------------------------------------------------------------------------- subject masks
  function layerMatrix(group, layer) {
    const m = new DOMMatrix();
    m.translateSelf(group.ox, group.oy).scaleSelf(group.k, group.k);
    m.translateSelf((layer.x || 0) + 256, (layer.y || 0) + 256);
    m.rotateSelf(layer.rot || 0);
    m.scaleSelf((layer.s || 1) * (layer.flip ? -1 : 1), (layer.s || 1) * (layer.flipY ? -1 : 1));
    m.translateSelf(-256, -256);
    return m;
  }

  function drawMasks(spec, group) {
    const union = canvas(W, H), acc = canvas(W, H), plug = canvas(W, H);
    const cu = union.getContext('2d'), ca = acc.getContext('2d'), cp = plug.getContext('2d');
    for (const c of [cu, ca, cp]) { c.fillStyle = '#000'; c.fillRect(0, 0, W, H); }
    spec.layers.forEach((layer, i) => {
      const path = new Path2D(layer.d);
      const m = layerMatrix(group, layer);
      const gap = layer.gap != null ? layer.gap : (i > 0 ? 12 : 0);
      for (const [c, white] of [[cu, true], [ca, !!layer.accent]]) {
        c.setTransform(m);
        if (gap > 0) { // knock a gap around the new layer so stacked icons stay readable
          c.fillStyle = '#000'; c.strokeStyle = '#000'; c.lineJoin = 'round';
          c.lineWidth = gap * 2 / (layer.s || 1); c.stroke(path); c.fill(path);
        }
        if (layer.invert) { // the figure is the dark cut-out of a disc icon (wolf against the moon): disc minus icon
          const v = layer.invert;
          c.fillStyle = white ? '#fff' : '#000';
          c.beginPath(); c.arc(v.cx, v.cy, v.r, 0, Math.PI * 2); c.fill();
          c.fillStyle = '#000';
        } else {
          c.fillStyle = white ? '#fff' : '#000';
        }
        c.fill(path);
        c.setTransform(1, 0, 0, 1, 0, 0);
      }
      // plugs: polygons (icon units) that close open recesses, e.g. a hood opening that runs out of the figure;
      // they become part of the solid silhouette, so the icon's holes there render as dark grooves
      for (const poly of layer.plug || []) {
        cp.setTransform(m); cp.fillStyle = '#fff'; cp.beginPath();
        poly.forEach(([x, y], k) => (k ? cp.lineTo(x, y) : cp.moveTo(x, y)));
        cp.closePath(); cp.fill(); cp.setTransform(1, 0, 0, 1, 0, 0);
      }
    });
    return { union, acc, plug };
  }

  function coverage(cnv) {
    const d = cnv.getContext('2d').getImageData(0, 0, W, H).data;
    const a = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) a[i] = d[i * 4] / 255;
    return a;
  }

  // Fill the icon's small enclosed holes (eyes, engraved lines) so the silhouette is solid; large enclosed holes stay open.
  function fillHoles(cov, holeMax) {
    const N = W * H, state = new Uint8Array(N); // 0 unvisited, 1 outside, 2 hole (filled), 3 big hole (open)
    const queue = new Int32Array(N);
    const low = i => cov[i] < 0.5;
    let qh = 0, qt = 0;
    const push = i => { if (!state[i] && low(i)) { state[i] = 1; queue[qt++] = i; } };
    for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
    for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
    while (qh < qt) {
      const i = queue[qh++], x = i % W, y = (i / W) | 0;
      if (x > 0) push(i - 1); if (x < W - 1) push(i + 1); if (y > 0) push(i - W); if (y < H - 1) push(i + W);
    }
    for (let s = 0; s < N; s++) {
      if (state[s] || !low(s)) continue;
      qh = 0; qt = 0; state[s] = 2; queue[qt++] = s;
      while (qh < qt) {
        const i = queue[qh++], x = i % W, y = (i / W) | 0;
        const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
        for (const j of nb) if (j >= 0 && !state[j] && low(j)) { state[j] = 2; queue[qt++] = j; }
      }
      if (qt > holeMax) for (let k = 0; k < qt; k++) state[queue[k]] = 3;
    }
    const filled = new Float32Array(N);
    for (let i = 0; i < N; i++) filled[i] = state[i] === 2 ? 1 : cov[i];
    return filled;
  }

  // Felzenszwalb & Huttenlocher exact Euclidean distance transform (as in mapbox/tiny-sdf).
  const INF = 1e20;
  function edt1d(grid, offset, stride, length, f, v, z) {
    v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 0; q < length; q++) f[q] = grid[offset + q * stride];
    for (let q = 1, k = 0, s = 0; q < length; q++) {
      do { const r = v[k]; s = (f[q] - f[r] + q * q - r * r) / (q - r) / 2; } while (s <= z[k] && --k > -1);
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    for (let q = 0, k = 0; q < length; q++) {
      while (z[k + 1] < q) k++;
      const r = v[k], qr = q - r;
      grid[offset + q * stride] = f[r] + qr * qr;
    }
  }
  function edt(grid) {
    const n = Math.max(W, H), f = new Float64Array(n), v = new Uint16Array(n), z = new Float64Array(n + 1);
    for (let x = 0; x < W; x++) edt1d(grid, x, W, H, f, v, z);
    for (let y = 0; y < H; y++) edt1d(grid, y * W, 1, W, f, v, z);
  }
  function sdf(cov) { // positive inside, in pixels
    const N = W * H, outer = new Float64Array(N), inner = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const a = cov[i];
      if (a >= 0.999) { outer[i] = 0; inner[i] = INF; }
      else if (a <= 0.001) { outer[i] = INF; inner[i] = 0; }
      else { const d = 0.5 - a; outer[i] = d > 0 ? d * d : 0; inner[i] = d < 0 ? d * d : 0; }
    }
    edt(outer); edt(inner);
    const out = new Float32Array(N);
    for (let i = 0; i < N; i++) out[i] = Math.max(-2000, Math.min(2000, Math.sqrt(inner[i]) - Math.sqrt(outer[i])));
    return out;
  }

  // repeated box blur (~gaussian, sigma about r) of a float image, used for the smooth large-scale relief
  function boxBlur(src, r, passes) {
    let a = Float32Array.from(src), b = new Float32Array(W * H);
    const pass1d = (from, to, n, m, stride, step) => { // n lines of m samples
      for (let l = 0; l < n; l++) {
        const o = l * stride; let acc = 0;
        for (let k = -r; k <= r; k++) acc += from[o + Math.min(m - 1, Math.max(0, k)) * step];
        for (let k = 0; k < m; k++) {
          to[o + k * step] = acc / (2 * r + 1);
          acc += from[o + Math.min(m - 1, k + r + 1) * step] - from[o + Math.max(0, k - r) * step];
        }
      }
    };
    for (let p = 0; p < passes; p++) {
      pass1d(a, b, H, W, W, 1); [a, b] = [b, a];
      pass1d(a, b, W, H, 1, W); [a, b] = [b, a];
    }
    return a;
  }

  function bbox(cov) {
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (cov[y * W + x] > 0.5) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    return { x0, y0, x1, y1 };
  }

  function grayCanvas(arr) {
    const c = canvas(W, H), ctx = c.getContext('2d'), img = ctx.createImageData(W, H);
    for (let i = 0; i < W * H; i++) { const v = Math.round(Math.min(1, Math.max(0, arr[i])) * 255); img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  function buildSubject(spec) {
    // 1) provisional layout, measure, 2) final layout so the silhouette fills spec.fill of the height
    const k0 = H * 0.7 / 512;
    let group = { k: k0, ox: W / 2 - 256 * k0, oy: H / 2 - 256 * k0 };
    let m = drawMasks(spec, group);
    const bb = bbox(coverage(m.union));
    const gx0 = (bb.x0 - group.ox) / k0, gx1 = (bb.x1 - group.ox) / k0, gy0 = (bb.y0 - group.oy) / k0, gy1 = (bb.y1 - group.oy) / k0;
    const k = Math.min(spec.fill * H / (gy1 - gy0), spec.maxW * W / (gx1 - gx0));
    group = { k, ox: spec.center[0] * W - (gx0 + gx1) / 2 * k, oy: spec.center[1] * H - (gy0 + gy1) / 2 * k };
    m = drawMasks(spec, group);

    const cov = coverage(m.union);
    const plugCov = coverage(m.plug);
    for (let i = 0; i < W * H; i++) plugCov[i] = Math.max(plugCov[i], cov[i]);
    let filled = fillHoles(plugCov, spec.holeMax * W * H);
    if (spec.closeR > 0) {
      // morphological closing (dilate, then erode by closeR px): narrow channels that reach the outside become
      // grooves instead of see-through slits, so the silhouette stays solid
      const dil = sdf(filled), grown = new Float32Array(W * H);
      for (let i = 0; i < W * H; i++) grown[i] = Math.min(1, Math.max(0, dil[i] + spec.closeR + 0.5));
      const back = sdf(grown);
      for (let i = 0; i < W * H; i++) filled[i] = Math.max(filled[i], Math.min(1, Math.max(0, back[i] - spec.closeR + 0.5)));
      filled = fillHoles(filled, spec.holeMax * W * H);
    }
    const sSil = sdf(filled), sDet = sdf(cov);
    const accCov = coverage(m.acc);

    // blurred silhouette (contact shadow, cavity darkening)
    const blurC = canvas(W, H), bctx = blurC.getContext('2d');
    bctx.fillStyle = '#000'; bctx.fillRect(0, 0, W, H);
    bctx.filter = `blur(${spec.blurR}px)`; bctx.drawImage(grayCanvas(filled), 0, 0); bctx.filter = 'none';
    const blurD = bctx.getImageData(0, 0, W, H).data;

    // emissive spots, given in the coordinates of the layer they belong to
    const em = canvas(W, H), ec = em.getContext('2d');
    ec.fillStyle = '#000'; ec.fillRect(0, 0, W, H); ec.globalCompositeOperation = 'lighter';
    for (const g of spec.glow || []) {
      const layer = spec.layers[g.layer || 0];
      ec.setTransform(layerMatrix(group, layer));
      ec.translate(g.x, g.y); ec.rotate((g.rot || 0) * Math.PI / 180); ec.scale(g.r, g.ry || g.r);
      const i = g.i != null ? g.i : 1;
      const grd = ec.createRadialGradient(0, 0, 0, 0, 0, 1);
      grd.addColorStop(0, `rgba(255,255,255,${i})`); grd.addColorStop(0.5, `rgba(255,255,255,${i * 0.8})`); grd.addColorStop(1, 'rgba(255,255,255,0)');
      ec.fillStyle = grd; ec.beginPath(); ec.arc(0, 0, 1, 0, Math.PI * 2); ec.fill();
      ec.setTransform(1, 0, 0, 1, 0, 0);
    }
    const emD = ec.getImageData(0, 0, W, H).data;

    const aux = new Uint8Array(W * H * 4);
    const dome = boxBlur(filled, spec.domeBlur, 3);
    const sd = new Float32Array(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      aux[i * 4] = Math.round(accCov[i] * 255);
      aux[i * 4 + 1] = emD[i * 4];
      aux[i * 4 + 2] = blurD[i * 4];
      aux[i * 4 + 3] = 255;
      sd[i * 4] = sSil[i]; sd[i * 4 + 1] = sDet[i]; sd[i * 4 + 2] = dome[i]; sd[i * 4 + 3] = 1;
    }
    // a disc icon used inverted puts its moon exactly behind the figure
    let moon = null;
    const li = spec.layers.findIndex(l => l.invert);
    if (li >= 0) {
      const l = spec.layers[li], v = l.invert, mtx = layerMatrix(group, l);
      const c = mtx.transformPoint(new DOMPoint(v.cx, v.cy));
      moon = { x: c.x / W, y: c.y / H, r: (v.moonR || v.r) * group.k * (l.s || 1) / H };
    }
    return { aux, sd, group, moon, bbox: bbox(filled) };
  }

  // ------------------------------------------------------------------------------------------- WebGL
  let gl, glCanvas, programs, quad;
  function initGL() {
    if (gl) return;
    glCanvas = canvas(W, H);
    gl = glCanvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false, premultipliedAlpha: false });
    if (!gl) throw new Error('WebGL2 not available');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float not available');
    gl.getExtension('OES_texture_float_linear');
    const S = window.SHADERS;
    programs = { bg: link(S.vert, S.bg), rays: link(S.vert, S.rays), comp: link(S.vert, S.comp), post: link(S.vert, S.post) };
    quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  }
  function compile(type, src) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
    return s;
  }
  function link(vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
    return p;
  }
  function tex(w, h, internal, format, type, data, filter) {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (data instanceof HTMLCanvasElement) gl.texImage2D(gl.TEXTURE_2D, 0, internal, format, type, data);
    else gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter || gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter || gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  function target(w, h) {
    const t = tex(w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, null);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { t, fb, w, h };
  }
  function run(prog, fbo, w, h, uniforms, textures) {
    gl.useProgram(prog);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, w, h);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    let unit = 0;
    for (const [name, t] of Object.entries(textures)) {
      gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.uniform1i(gl.getUniformLocation(prog, name), unit); unit++;
    }
    for (const [name, v] of Object.entries(uniforms)) {
      const l = gl.getUniformLocation(prog, 'u' + name);
      if (l === null) continue;
      if (typeof v === 'number') gl.uniform1f(l, v);
      else if (v.length === 2) gl.uniform2f(l, v[0], v[1]);
      else if (v.length === 3) gl.uniform3f(l, v[0], v[1], v[2]);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  // ------------------------------------------------------------------------------------------- main entry
  window.renderCard = function (spec) {
    initGL();
    const t0 = performance.now();
    const rng = mulberry32(spec.seed * 7919 + 13);
    const subj = buildSubject(spec);
    const t1 = performance.now();

    const scen = canvas(W, H);
    if (subj.moon) { spec.light = [subj.moon.x, subj.moon.y]; spec.uniforms.LightR = subj.moon.r; spec.uniforms.LightKind = 1; }
    Scenery.drawScenery(scen, spec.motif, rng, Object.assign({ light: spec.light }, spec.motifOpts));
    const pb = canvas(W, H), pf = canvas(W, H);
    Scenery.drawParticles(pb, pf, spec.particles, rng, spec.particleCount, spec.particleRGB, spec.light);

    const u = Object.assign({}, spec.uniforms);
    u.Res = [W, H];
    u.Seed = spec.seed % 97 + 0.37;
    u.Light = [spec.light[0], 1 - spec.light[1]];

    const texSdf = tex(W, H, gl.RGBA16F, gl.RGBA, gl.FLOAT, subj.sd);
    const texAux = tex(W, H, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, subj.aux);
    const texScen = tex(W, H, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, scen);
    const texPB = tex(W, H, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, pb);
    const texPF = tex(W, H, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, pf);

    const sig = canvas(W, H), sc = sig.getContext('2d');
    sc.fillStyle = '#000'; sc.fillRect(0, 0, W, H);
    if (spec.sigil) {
      const path = new Path2D(spec.sigil.d);
      sc.globalCompositeOperation = 'lighter';
      for (const [col, blur] of [['#f00', 0], ['#0f0', 10], ['#00f', 36]]) {
        sc.filter = blur ? `blur(${blur}px)` : 'none';
        sc.setTransform(layerMatrix(subj.group, spec.sigil));
        sc.fillStyle = col; sc.fill(path);
        sc.setTransform(1, 0, 0, 1, 0, 0);
      }
      sc.filter = 'none'; sc.globalCompositeOperation = 'source-over';
    } else u.SigilStr = 0;
    const texSig = tex(W, H, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, sig);

    const bgT = target(W, H);
    run(programs.bg, bgT.fb, W, H, u, { uScenery: texScen, uSigil: texSig });
    const rW = W / 2, rH = H / 2;
    const raysT = target(rW, rH);
    run(programs.rays, raysT.fb, rW, rH, Object.assign({}, u, { Res: [rW, rH] }), { uBg: bgT.t, uSdf: texSdf });
    const compT = target(W, H);
    run(programs.comp, compT.fb, W, H, u, { uBg: bgT.t, uRays: raysT.t, uSdf: texSdf, uAux: texAux, uPartB: texPB, uPartF: texPF });
    run(programs.post, null, W, H, u, { uImg: compT.t });
    gl.finish();

    const out = canvas(OUT_W, OUT_H), oc = out.getContext('2d');
    oc.imageSmoothingEnabled = true; oc.imageSmoothingQuality = 'high';
    oc.drawImage(glCanvas, 0, 0, OUT_W, OUT_H);
    const url = out.toDataURL('image/png');

    for (const t of [texSdf, texAux, texScen, texSig, texPB, texPF, bgT.t, raysT.t, compT.t]) gl.deleteTexture(t);
    for (const f of [bgT.fb, raysT.fb, compT.fb]) gl.deleteFramebuffer(f);
    return { png: url, ms: Math.round(performance.now() - t0), maskMs: Math.round(t1 - t0), bbox: subj.bbox };
  };

  window.rendererReady = true;
})();
