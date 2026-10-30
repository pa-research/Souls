// Procedural background silhouettes and particles, drawn with Canvas 2D.
// Scenery goes into one canvas as three coverage channels (red = far, green = mid, blue = near) that the background
// shader fogs and tints per race. Particles are additive light drawn on black (back layer and blurred front layer).
'use strict';
window.Scenery = (function () {
  const FAR = 'rgb(255,0,0)', MID = 'rgb(0,255,0)', NEAR = 'rgb(0,0,255)';

  function ridge(ctx, W, H, rng, baseY, amp, rough, color, opts) {
    // midpoint-displacement ridge line, filled to the bottom
    opts = opts || {};
    let pts = [baseY + (rng() - 0.5) * amp, baseY + (rng() - 0.5) * amp];
    let a = amp;
    for (let it = 0; it < 8; it++) {
      const np = [];
      for (let i = 0; i < pts.length - 1; i++) {
        np.push(pts[i]);
        np.push((pts[i] + pts[i + 1]) / 2 + (rng() - 0.5) * a);
      }
      np.push(pts[pts.length - 1]);
      pts = np; a *= rough;
    }
    if (opts.peaks) { // sharpen into peaks
      pts = pts.map((y, i) => y - Math.pow(Math.max(0, Math.sin(i / pts.length * Math.PI * opts.peaks + opts.phase)), 3) * amp * 0.9);
    }
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-10, H + 10);
    pts.forEach((y, i) => ctx.lineTo(-10 + (W + 20) * i / (pts.length - 1), y));
    ctx.lineTo(W + 10, H + 10);
    ctx.closePath();
    ctx.fill();
  }

  function pine(ctx, x, baseY, h, w, rng, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    const tiers = 7 + Math.floor(rng() * 5);
    const top = baseY - h;
    ctx.moveTo(x, top);
    const pts = [];
    for (let i = 1; i <= tiers; i++) {
      const t = i / tiers;
      const y = top + h * 0.92 * t;
      const half = w * (0.12 + 0.88 * t) * (0.85 + rng() * 0.3);
      pts.push([x + half, y, x + half * 0.35, y - h / tiers * 0.15]);
    }
    for (const p of pts) { ctx.lineTo(p[0], p[1]); ctx.lineTo(p[2], p[3]); }
    ctx.lineTo(x + w * 0.06, baseY + 4); ctx.lineTo(x - w * 0.06, baseY + 4);
    for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; ctx.lineTo(x - (p[2] - x), p[3]); ctx.lineTo(x - (p[0] - x), p[1]); }
    ctx.closePath();
    ctx.fill();
  }

  function deadTree(ctx, x, y, len, ang, width, depth, rng, color) {
    ctx.strokeStyle = color; ctx.lineCap = 'round';
    const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
    ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(x, y);
    const mx = (x + x2) / 2 + (rng() - 0.5) * len * 0.25, my = (y + y2) / 2 + (rng() - 0.5) * len * 0.25;
    ctx.quadraticCurveTo(mx, my, x2, y2); ctx.stroke();
    if (depth <= 0 || width < 1.2) return;
    const n = 2 + (rng() < 0.35 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const a = ang + (rng() - 0.5) * 1.3 + (i - (n - 1) / 2) * 0.5;
      deadTree(ctx, x2, y2, len * (0.6 + rng() * 0.2), a, width * 0.62, depth - 1, rng, color);
    }
  }

  function tomb(ctx, x, baseY, w, h, kind, tilt, color) {
    ctx.save(); ctx.translate(x, baseY); ctx.rotate(tilt); ctx.fillStyle = color;
    ctx.beginPath();
    if (kind === 0) { // rounded headstone
      ctx.moveTo(-w / 2, 0); ctx.lineTo(-w / 2, -h + w / 2); ctx.arc(0, -h + w / 2, w / 2, Math.PI, 0); ctx.lineTo(w / 2, 0);
    } else if (kind === 1) { // cross
      const t = w * 0.28;
      ctx.rect(-t / 2, -h, t, h); ctx.rect(-w / 2, -h * 0.78, w, t);
    } else { // celtic-ish cross with ring
      const t = w * 0.24;
      ctx.rect(-t / 2, -h, t, h); ctx.rect(-w / 2, -h * 0.8, w, t);
      ctx.moveTo(w * 0.32, -h * 0.8 + t / 2); ctx.arc(0, -h * 0.8 + t / 2, w * 0.32, 0, Math.PI * 2);
    }
    ctx.fill();
    if (kind === 2) { ctx.lineWidth = w * 0.08; ctx.strokeStyle = color; ctx.beginPath(); ctx.arc(0, -h * 0.8 + w * 0.12, w * 0.3, 0, Math.PI * 2); ctx.stroke(); }
    ctx.restore();
  }

  function spire(ctx, x, baseY, w, h, color) { // tower with pointed roof
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x - w / 2, baseY); ctx.lineTo(x - w / 2, baseY - h * 0.7); ctx.lineTo(x - w * 0.62, baseY - h * 0.7);
    ctx.lineTo(x, baseY - h); ctx.lineTo(x + w * 0.62, baseY - h * 0.7); ctx.lineTo(x + w / 2, baseY - h * 0.7); ctx.lineTo(x + w / 2, baseY);
    ctx.closePath(); ctx.fill();
  }

  function castle(ctx, cx, baseY, scale, rng, color) {
    // a crag with a gothic castle of spires on top
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx - 260 * scale, baseY + 400);
    ctx.lineTo(cx - 170 * scale, baseY + 30 * scale); ctx.lineTo(cx - 120 * scale, baseY + 5 * scale);
    ctx.lineTo(cx + 110 * scale, baseY); ctx.lineTo(cx + 150 * scale, baseY + 40 * scale); ctx.lineTo(cx + 280 * scale, baseY + 400);
    ctx.closePath(); ctx.fill();
    ctx.fillRect(cx - 110 * scale, baseY - 70 * scale, 210 * scale, 75 * scale);
    const towers = [[-95, 26, 170], [-55, 20, 120], [-15, 34, 230], [30, 22, 150], [70, 28, 190], [95, 16, 110]];
    for (const t of towers) spire(ctx, cx + t[0] * scale, baseY - 60 * scale, t[1] * scale, t[2] * scale * (0.85 + rng() * 0.3), color);
    // battlements
    for (let i = -105; i < 100; i += 14) ctx.fillRect(cx + i * scale, baseY - 82 * scale, 8 * scale, 14 * scale);
  }

  function gothicFrame(ctx, W, H, rng, color, opts) {
    // two columns at the edges with a pointed arch across the top
    opts = opts || {};
    const colW = W * (opts.colW || 0.075);
    const inset = W * (opts.inset || 0.0);
    const springY = H * (opts.springY || 0.32);
    ctx.fillStyle = color;
    ctx.beginPath();
    // outer rectangle minus the pointed arch opening (even-odd)
    ctx.rect(-5, -5, W + 10, H + 10);
    const l = inset + colW, r = W - inset - colW;
    const span = r - l;
    ctx.moveTo(l, H + 10);
    ctx.lineTo(l, springY);
    // pointed (equilateral-ish) arch: two arcs centred on the opposite springing points
    const rad = span * (opts.archR || 0.8);
    const aL = Math.acos(1 - span / (2 * rad));
    ctx.arc(l + rad, springY, rad, Math.PI, Math.PI + aL, false);
    ctx.arc(r - rad, springY, rad, -aL, 0, false);
    ctx.lineTo(r, H + 10);
    ctx.closePath();
    ctx.fill('evenodd');
    // capitals
    ctx.fillRect(l - 4, springY - 10, colW * 0.3, 20);
    ctx.fillRect(r - colW * 0.3 + 4, springY - 10, colW * 0.3, 20);
  }

  function columns(ctx, W, H, xs, w, color, capY) {
    ctx.fillStyle = color;
    for (const x of xs) {
      ctx.fillRect(x - w / 2, capY, w, H - capY + 10);
      ctx.fillRect(x - w * 0.65, capY - 12, w * 1.3, 18);
      ctx.fillRect(x - w * 0.7, H * 0.93, w * 1.4, H * 0.1);
    }
  }

  function lancet(ctx, cx, top, w, h) { // pointed (equilateral) arch window, as a closed sub-path
    const spring = top + w * 0.866;
    ctx.moveTo(cx - w / 2, top + h);
    ctx.lineTo(cx - w / 2, spring);
    ctx.arc(cx + w / 2, spring, w, Math.PI, Math.PI * 4 / 3, false);
    ctx.arc(cx - w / 2, spring, w, Math.PI * 5 / 3, Math.PI * 2, false);
    ctx.lineTo(cx + w / 2, top + h);
    ctx.closePath();
  }

  function rocks(ctx, W, H, rng, color, side) {
    ctx.fillStyle = color;
    const n = 3 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const x = side < 0 ? rng() * W * 0.22 : W - rng() * W * 0.22;
      const r = H * (0.05 + rng() * 0.08);
      ctx.beginPath();
      const k = 7;
      for (let j = 0; j < k; j++) {
        const a = Math.PI + j / (k - 1) * Math.PI;
        const rr = r * (0.75 + rng() * 0.4);
        ctx.lineTo(x + Math.cos(a) * rr * 1.4, H + 6 + Math.sin(a) * rr);
      }
      ctx.closePath(); ctx.fill();
    }
  }

  function fence(ctx, W, H, y, rng, color) {
    ctx.fillStyle = color; ctx.strokeStyle = color;
    ctx.fillRect(-5, y, W + 10, 6); ctx.fillRect(-5, y + 46, W + 10, 6);
    for (let x = -5; x < W + 10; x += 26) {
      ctx.fillRect(x, y - 30, 5, H - y + 40);
      ctx.beginPath(); ctx.moveTo(x - 5, y - 30); ctx.lineTo(x + 2.5, y - 48); ctx.lineTo(x + 10, y - 30); ctx.fill();
    }
  }

  // ------------------------------------------------------------------------------------------------ motifs
  const motifs = {
    graveyard(ctx, W, H, rng, o) {
      ridge(ctx, W, H, rng, H * 0.78, H * 0.08, 0.55, FAR);
      if (o.church !== false) { // distant chapel on the hill
        const cx = rng() < 0.5 ? W * (0.08 + rng() * 0.12) : W * (0.8 + rng() * 0.12);
        ctx.fillStyle = FAR; ctx.fillRect(cx - 45, H * 0.72, 90, H * 0.1);
        spire(ctx, cx + 30, H * 0.73, 26, 150, FAR);
      }
      for (let i = 0; i < 2; i++) deadTree(ctx, W * (i ? 0.65 + rng() * 0.3 : 0.05 + rng() * 0.3), H * 0.8, 70, -Math.PI / 2 + (rng() - 0.5) * 0.3, 9, 5, rng, FAR);
      const n = 9;
      for (let i = 0; i < n; i++) {
        const side = i % 2 ? 1 : -1;
        const x = side < 0 ? W * (0.02 + rng() * 0.3) : W * (0.68 + rng() * 0.3);
        tomb(ctx, x, H * (0.88 + rng() * 0.06), 34 + rng() * 26, 60 + rng() * 60, Math.floor(rng() * 3), (rng() - 0.5) * 0.25, MID);
      }
      if (o.fence) fence(ctx, W, H, H * 0.9, rng, NEAR);
      const tx = o.treeSide > 0 ? W * 0.97 : W * 0.03;
      deadTree(ctx, tx, H + 20, 260, -Math.PI / 2 + (o.treeSide > 0 ? -0.25 : 0.25), 34, 6, rng, NEAR);
    },
    barrow(ctx, W, H, rng, o) {
      ridge(ctx, W, H, rng, H * 0.66, H * 0.22, 0.5, FAR, { peaks: 2, phase: rng() * 3 });
      // the barrow mound with standing stones
      ctx.fillStyle = MID; ctx.beginPath(); ctx.ellipse(W * 0.5, H * 1.02, W * 0.62, H * 0.2, 0, Math.PI, 0); ctx.fill();
      for (let i = 0; i < 6; i++) {
        const x = W * (0.06 + i * 0.18) + (rng() - 0.5) * 40;
        const h = 70 + rng() * 80; ctx.save(); ctx.translate(x, H * 0.9); ctx.rotate((rng() - 0.5) * 0.2);
        ctx.beginPath(); ctx.moveTo(-18, 10); ctx.lineTo(-14, -h); ctx.lineTo(4, -h - 14); ctx.lineTo(18, 10); ctx.fill(); ctx.restore();
      }
      rocks(ctx, W, H, rng, NEAR, -1); rocks(ctx, W, H, rng, NEAR, 1);
    },
    gothic(ctx, W, H, rng, o) {
      castle(ctx, o.castleX != null ? W * o.castleX : W * (rng() < 0.5 ? 0.18 : 0.82), H * 0.74, 0.9 + rng() * 0.25, rng, FAR);
      ridge(ctx, W, H, rng, H * 0.9, H * 0.05, 0.5, MID);
      gothicFrame(ctx, W, H, rng, NEAR, { colW: 0.07, springY: 0.3 + rng() * 0.08 });
    },
    castle(ctx, W, H, rng, o) {
      ridge(ctx, W, H, rng, H * 0.8, H * 0.12, 0.55, FAR);
      castle(ctx, o.castleX != null ? W * o.castleX : W * (rng() < 0.5 ? 0.15 : 0.85), H * 0.66, 1.2, rng, FAR);
      for (let i = 0; i < 2; i++) deadTree(ctx, i ? W * 0.95 : W * 0.05, H + 10, 200, -Math.PI / 2 + (i ? -0.3 : 0.3), 28, 6, rng, NEAR);
      ridge(ctx, W, H, rng, H * 0.94, H * 0.04, 0.5, MID);
    },
    crypt(ctx, W, H, rng, o) {
      columns(ctx, W, H, [W * 0.2, W * 0.8], 46, FAR, H * 0.18);
      ridge(ctx, W, H, rng, H * 0.95, H * 0.02, 0.5, MID);
      gothicFrame(ctx, W, H, rng, NEAR, { colW: 0.06, springY: 0.26 });
    },
    cathedral(ctx, W, H, rng, o) {
      // dark nave: a tall lancet window behind the subject, two side windows, tracery, columns in front
      const wx = (o.windowX != null ? o.windowX : o.light[0]) * W, ww = W * (o.windowW || 0.34);
      ctx.fillStyle = MID;
      ctx.beginPath();
      ctx.rect(-5, -5, W + 10, H + 10);
      lancet(ctx, wx, H * 0.03, ww, H * 0.92);
      for (const sx of [-1, 1]) {
        const x = wx + sx * W * 0.34;
        if (x > W * 0.08 && x < W * 0.92) lancet(ctx, x, H * 0.2, W * 0.1, H * 0.5);
      }
      ctx.fill('evenodd');
      ctx.fillStyle = FAR; // tracery inside the main window
      for (const f of [-1 / 6, 1 / 6]) ctx.fillRect(wx + f * ww - 5, H * 0.03 + ww * 0.5, 10, H);
      ctx.fillRect(wx - ww / 2, H * 0.55, ww, 9);
      ctx.lineWidth = 9; ctx.strokeStyle = FAR;
      ctx.beginPath(); ctx.arc(wx, H * 0.03 + ww * 0.62, ww * 0.2, 0, Math.PI * 2); ctx.stroke();
      columns(ctx, W, H, [W * 0.025, W * 0.975], 90, NEAR, -20);
      ctx.fillStyle = NEAR; ctx.fillRect(-5, H * 0.965, W + 10, H * 0.05);
    },
    sky(ctx, W, H, rng, o) {
      ridge(ctx, W, H, rng, H * 0.86, H * 0.1, 0.55, FAR, { peaks: 3, phase: rng() * 3 });
      if (o.castleX != null) castle(ctx, W * o.castleX, H * 0.84, 0.5, rng, FAR);
      ridge(ctx, W, H, rng, H * 0.97, H * 0.04, 0.5, MID);
    },
    forest(ctx, W, H, rng, o) {
      ridge(ctx, W, H, rng, H * 0.6, H * 0.25, 0.52, FAR, { peaks: 2 + Math.floor(rng() * 2), phase: rng() * 3 });
      for (let i = 0; i < 46; i++) {
        const x = rng() * W; const h = H * (0.14 + rng() * 0.12);
        pine(ctx, x, H * (0.8 + rng() * 0.06), h, h * 0.24, rng, MID);
      }
      const sides = o.treeSide === 0 ? [-1, 1] : [o.treeSide || (rng() < 0.5 ? -1 : 1)];
      for (const s of sides) {
        for (let k = 0; k < 2; k++) {
          const x = s < 0 ? W * (0.0 + k * 0.08 + rng() * 0.04) : W * (1.0 - k * 0.08 - rng() * 0.04);
          const h = H * (1.0 + rng() * 0.3);
          pine(ctx, x, H + 40, h, h * 0.2, rng, NEAR);
        }
      }
    },
    mountains(ctx, W, H, rng, o) {
      ridge(ctx, W, H, rng, H * 0.55, H * 0.3, 0.55, FAR, { peaks: 3, phase: rng() * 3 });
      ridge(ctx, W, H, rng, H * 0.78, H * 0.16, 0.55, MID, { peaks: 2, phase: rng() * 3 });
      for (let i = 0; i < 14; i++) { const x = rng() * W; const h = H * (0.08 + rng() * 0.08); pine(ctx, x, H * (0.86 + rng() * 0.05), h, h * 0.25, rng, MID); }
      rocks(ctx, W, H, rng, NEAR, -1); rocks(ctx, W, H, rng, NEAR, 1);
    },
    void() {}
  };

  function drawScenery(canvas, motif, rng, opts) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    (motifs[motif] || motifs.void)(ctx, W, H, rng, Object.assign({ light: [0.5, 0.3] }, opts));
    ctx.globalCompositeOperation = 'source-over';
  }

  // ------------------------------------------------------------------------------------------------ particles
  function glowDot(ctx, x, y, r, rgb, a) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${rgb},${a})`);
    g.addColorStop(0.25, `rgba(${rgb},${a * 0.55})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }

  function sparkle(ctx, x, y, r, rgb, a) {
    glowDot(ctx, x, y, r, rgb, a);
    ctx.strokeStyle = `rgba(${rgb},${a * 0.8})`; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(x - r * 2.2, y); ctx.lineTo(x + r * 2.2, y); ctx.moveTo(x, y - r * 2.2); ctx.lineTo(x, y + r * 2.2); ctx.stroke();
  }

  // type: embers | motes | ash | snow | fireflies | sparks | blood | wisps
  function drawParticles(back, front, type, rng, amount, rgb, light) {
    const W = back.width, H = back.height;
    const cb = back.getContext('2d'), cf = front.getContext('2d');
    for (const c of [cb, cf]) { c.globalCompositeOperation = 'source-over'; c.fillStyle = '#000'; c.fillRect(0, 0, W, H); c.globalCompositeOperation = 'lighter'; }
    const lx = light[0] * W, ly = light[1] * H;
    const n = Math.round(amount);
    const near = (x, y) => Math.exp(-Math.hypot(x - lx, y - ly) / (H * 0.6));
    for (let i = 0; i < n; i++) {
      let x = rng() * W, y = rng() * H;
      if (type === 'embers' || type === 'blood') y = H * (1 - Math.pow(rng(), 1.6)); // denser near the ground
      const b = 0.35 + 0.9 * near(x, y);
      const sz = rng();
      if (type === 'embers') {
        const r = 2 + sz * 4; glowDot(cb, x, y, r * 3, rgb, Math.min(1, 0.5 * b));
        cb.fillStyle = `rgba(255,230,180,${0.6 * b})`; cb.fillRect(x - 1, y - 1, 2, 2 + sz * 4);
      } else if (type === 'fireflies') {
        const r = 1.5 + sz * sz * 3; glowDot(cb, x, y, r * 4, rgb, 0.3 * b + 0.1); glowDot(cb, x, y, r, '255,255,210', 0.75);
      } else if (type === 'snow') {
        const r = 1.2 + sz * sz * 4; glowDot(cb, x, y, r * 1.8, rgb, 0.55 * b + 0.2);
      } else if (type === 'sparks') {
        if (rng() < 0.12) sparkle(cb, x, y, 3 + sz * 4, rgb, 0.6 * b);
        else glowDot(cb, x, y, 2 + sz * 5, rgb, 0.45 * b);
      } else if (type === 'wisps') {
        const len = 30 + sz * 90, a = -Math.PI / 2 + (rng() - 0.5) * 0.8;
        cb.strokeStyle = `rgba(${rgb},${0.18 * b})`; cb.lineWidth = 2 + sz * 3; cb.lineCap = 'round';
        cb.beginPath(); cb.moveTo(x, y); cb.quadraticCurveTo(x + Math.cos(a) * len * 0.5 + (rng() - 0.5) * 40, y + Math.sin(a) * len * 0.5, x + Math.cos(a) * len, y + Math.sin(a) * len); cb.stroke();
        glowDot(cb, x, y, 4 + sz * 6, rgb, 0.4 * b);
      } else { // motes, ash, blood
        const r = 1.0 + sz * sz * 3.2; glowDot(cb, x, y, r * 2.2, rgb, (type === 'ash' ? 0.22 : 0.32) * b + 0.06);
      }
    }
    // a few large out-of-focus particles in front
    cf.filter = 'blur(5px)';
    const nf = Math.max(3, Math.round(n * 0.05));
    for (let i = 0; i < nf; i++) {
      const x = rng() * W, y = rng() < 0.5 ? rng() * H * 0.35 : H - rng() * H * 0.35;
      if (Math.abs(x - W / 2) < W * 0.22 && rng() < 0.7) continue; // keep the subject clear
      const r = 10 + rng() * 18;
      glowDot(cf, x, y, r, rgb, 0.16 + 0.25 * near(x, y));
    }
    cf.filter = 'none';
    for (const c of [cb, cf]) c.globalCompositeOperation = 'source-over';
  }

  return { drawScenery, drawParticles, motifs: Object.keys(motifs) };
})();
