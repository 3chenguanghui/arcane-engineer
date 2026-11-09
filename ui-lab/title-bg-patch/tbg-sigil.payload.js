/* ============================================================
   烬 · 标题页背景（方向一：符阵）
   ------------------------------------------------------------
   全部 canvas 原语程序化绘制，零外链、零 base64。
   科技感来自秩序：地面透视 / 等分刻度 / 同心环 / 缓慢旋转；
   魔法感来自非秩序：不闭合咒文弧 / 余烬 / 呼吸漏光。
   背景让位于文字：顶部 0–0.46h 每帧叠安全罩，亮元素全在 0.48h 以下。
   基础周期：外环 1500s / 内环 1200s / 咒文弧 1000s / 外大弧 1800s / 呼吸 22s。
   软光全部走预烘焙图集（禁止 shadowBlur），加色一律 lighter。
   ============================================================ */
const TBG_SIGIL = (function () {
  'use strict';
  var TAU = Math.PI * 2;
  var TBG = { w: 0, h: 0, dpr: 1, geo: null, dir: 1, ctx: null };
  var CACHE = { grain: null, sprites: {}, curtain: null, curtainH: 0, sigilEmbers: [] };
  var baseCv = document.createElement('canvas');
  var baseCtx = baseCv.getContext('2d');
  var baseDirty = true;

var PAL = {
    cyan: [62, 230, 255],
    cyanSoft: [143, 228, 255],
    ember: [255, 138, 61],
    gold: [255, 203, 110],
    purple: [176, 133, 255],
    steel: [168, 191, 220],
    white: [255, 255, 255]
  };

var SPRITE_KEYS = ['cyan', 'cyanSoft', 'ember', 'gold', 'purple', 'white'];

var RUNES = [
    [[[-0.30, -0.40], [0.30, -0.40]], [[0.00, -0.40], [0.00, 0.40]], [[-0.22, 0.34], [0.22, 0.34]]],
    [[[-0.34, 0.34], [-0.12, -0.40]], [[0.06, -0.40], [0.28, 0.34]], [[-0.30, 0.02], [0.26, 0.02]]],
    [[[-0.26, -0.36], [0.26, -0.06]], [[0.26, -0.06], [-0.26, 0.26]], [[-0.26, 0.26], [0.26, 0.40]]],
    [[[0.00, -0.40], [0.00, 0.40]], [[-0.30, -0.14], [0.30, -0.14]], [[-0.20, 0.24], [0.20, 0.24]]],
    [[[-0.30, -0.30], [-0.30, 0.30]], [[0.30, -0.30], [0.30, 0.30]], [[-0.30, 0.00], [0.30, 0.00]]],
    [[[-0.28, -0.36], [0.28, 0.10]], [[0.28, -0.36], [-0.28, 0.10]], [[0.00, 0.10], [0.00, 0.42]]]
  ];

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

function lerp(a, b, t) { return a + (b - a) * t; }

function smoothstep(e0, e1, x) { var t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }

function makeLcg(seed) {
    var s = (seed >>> 0) || 1;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }

function paintGlowTile(g, ox, size, c) {
    var half = size / 2;
    var grd = g.createRadialGradient(ox + half, half, 0, ox + half, half, half);
    grd.addColorStop(0.00, 'rgba(255,255,255,0.92)');
    grd.addColorStop(0.10, rgba(c, 0.92));
    grd.addColorStop(0.34, rgba(c, 0.34));
    grd.addColorStop(0.66, rgba(c, 0.08));
    grd.addColorStop(1.00, rgba(c, 0));
    g.fillStyle = grd;
    g.fillRect(ox, 0, size, size);
  }

function makeGrainTile(size) {
    var cv = document.createElement('canvas');
    cv.width = cv.height = size;
    var g = cv.getContext('2d');
    var img = g.createImageData(size, size);
    var rnd = makeLcg(20261108);
    for (var i = 0; i < img.data.length; i += 4) {
      var v = 116 + Math.floor(rnd() * 84);
      img.data[i] = v;         // R
      img.data[i + 1] = v;     // G
      img.data[i + 2] = v + 5; // B：极轻微的冷偏
      img.data[i + 3] = Math.floor(rnd() * 118);
    }
    g.putImageData(img, 0, 0);
    return cv;
  }

function buildSprites() {
    var size = 64;
    var atlas = document.createElement('canvas');
    atlas.width = size * SPRITE_KEYS.length;
    atlas.height = size;
    var g = atlas.getContext('2d');
    for (var i = 0; i < SPRITE_KEYS.length; i++) {
      var ox = i * size;
      paintGlowTile(g, ox, size, PAL[SPRITE_KEYS[i]]);
      CACHE.sprites[SPRITE_KEYS[i]] = { cv: atlas, sx: ox, size: size };
    }
    CACHE.grain = makeGrainTile(112);
  }

function glow(g, key, x, y, r, a) {
    if (a <= 0.004 || r <= 0.2) return;
    var spr = CACHE.sprites[key];
    g.globalAlpha = clamp(a, 0, 1);
    g.drawImage(spr.cv, spr.sx, 0, spr.size, spr.size, x - r, y - r, r * 2, r * 2);
    g.globalAlpha = 1;
  }

function glowBox(g, key, cx, cy, rx, ry, a) {
    if (a <= 0.004) return;
    var spr = CACHE.sprites[key];
    g.globalAlpha = clamp(a, 0, 1);
    g.drawImage(spr.cv, spr.sx, 0, spr.size, spr.size, cx - rx, cy - ry, rx * 2, ry * 2);
    g.globalAlpha = 1;
  }

function computeGeo(w, h) {
    // 外环半径：按纵横比换算，保证横向占屏约 7 成，窄屏允许出血
    var rOut = clamp(0.378 * (w / h), 0.42, 0.62);
    // 碎环半径：横向占屏约 5~7 成，竖直压在标题之下
    var rx = Math.max(0.28 * w, 0.38 * Math.min(w, h));
    return {
      s1: {
        rOut: rOut,
        rMid: rOut * 0.702,
        rArc: rOut * 0.446,
        horizon: 0.38,     // 地平线（屏高比例）：0.30→0.38，符阵整体下移，让出难度/天赋面板（远弧顶须越过 425px 面板底）
        camH: 0.30,        // 相机离地高度（屏高比例）
        baseZ: 1.05        // 符阵中心到相机的深度（屏高倍数）
      },
      s3: {
        cx: w * 0.5,
        cy: h * 0.635,   // 整体下移：环的顶部退出标题/统计带
        rx: rx,
        ry: rx * 0.52,   // 压扁一点：更像"悬在中上部的环"，不压难度卡
        tilt: -0.10
      }
    };
  }

function projFloor(px, pz, w, h) {
    var S = TBG.geo.s1;
    var z = S.baseZ + pz;            // 深度（屏高倍数）
    var k = 1 / z;                   // 焦距按 1 屏高计
    return [
      w * 0.5 + px * k * h,
      h * (S.horizon + S.camH * k),
      k * h
    ];
  }

function buildBase() {
    var w = TBG.w, h = TBG.h;
    baseCv.width = Math.round(w * TBG.dpr);
    baseCv.height = Math.round(h * TBG.dpr);
    baseCtx.setTransform(TBG.dpr, 0, 0, TBG.dpr, 0, 0);
    baseCtx.clearRect(0, 0, w, h);

    // 4.1 纵深底：中心偏上略亮，四周沉黑
    var bg = baseCtx.createRadialGradient(w * 0.5, h * 0.40, 0, w * 0.5, h * 0.56, Math.max(w, h) * 0.82);
    if (TBG.dir === 1) {
      bg.addColorStop(0, '#08131e');
      bg.addColorStop(0.46, '#050b13');
      bg.addColorStop(1, '#020509');
    } else if (TBG.dir === 2) {
      bg.addColorStop(0, '#0a1119');
      bg.addColorStop(0.46, '#060b12');
      bg.addColorStop(1, '#020509');
    } else {
      bg.addColorStop(0, '#07111c');
      bg.addColorStop(0.46, '#040910');
      bg.addColorStop(1, '#020509');
    }
    baseCtx.fillStyle = bg;
    baseCtx.fillRect(0, 0, w, h);

    // 4.2 方向专属静态结构
    if (TBG.dir === 1) buildBaseSigil(w, h);
    else if (TBG.dir === 2) buildBaseEmber(w, h);
    else buildBaseShatter(w, h);

    // 4.3 暗角：把边缘压下去，中心留给主视觉
    var vg = baseCtx.createRadialGradient(w * 0.5, h * 0.48, Math.min(w, h) * 0.16, w * 0.5, h * 0.54, Math.max(w, h) * 0.80);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(0.60, 'rgba(0,0,0,0.18)');
    vg.addColorStop(1, 'rgba(0,0,0,0.62)');
    baseCtx.fillStyle = vg;
    baseCtx.fillRect(0, 0, w, h);

    // 4.4 颗粒：用 tile 平铺，成本固定
    var pat = baseCtx.createPattern(CACHE.grain, 'repeat');
    if (pat) {
      baseCtx.globalAlpha = 0.052;
      baseCtx.globalCompositeOperation = 'overlay';
      baseCtx.fillStyle = pat;
      baseCtx.fillRect(0, 0, w, h);
      baseCtx.globalAlpha = 1;
      baseCtx.globalCompositeOperation = 'source-over';
    }

    // 4.5 文字安全罩：顶部整体压暗（每帧再叠一次，保证动态层也被压住）。
    // 用多段 stop 做长渐变，避免出现一条可见的水平接缝。
    if (!CACHE.curtain || CACHE.curtainH !== h) {
      CACHE.curtain = TBG.ctx.createLinearGradient(0, 0, 0, h * 0.46);
      CACHE.curtain.addColorStop(0.00, 'rgba(2, 5, 10, 0.82)');
      CACHE.curtain.addColorStop(0.16, 'rgba(2, 5, 10, 0.68)');
      CACHE.curtain.addColorStop(0.38, 'rgba(2, 5, 10, 0.44)');
      CACHE.curtain.addColorStop(0.62, 'rgba(2, 5, 10, 0.22)');
      CACHE.curtain.addColorStop(0.82, 'rgba(2, 5, 10, 0.06)');
      CACHE.curtain.addColorStop(1.00, 'rgba(2, 5, 10, 0.00)');
      CACHE.curtainH = h;
    }
  }

function buildBaseSigil(w, h) {
    var hy = h * 0.30;
    var band = baseCtx.createLinearGradient(0, hy - h * 0.10, 0, hy + h * 0.12);
    band.addColorStop(0, rgba(PAL.cyan, 0));
    band.addColorStop(0.44, rgba(PAL.cyan, 0.022));
    band.addColorStop(1, rgba(PAL.cyan, 0));
    baseCtx.fillStyle = band;
    baseCtx.fillRect(0, hy - h * 0.10, w, h * 0.22);

    // 地面极弱环境光（动态呼吸光会叠在它上面）
    baseCtx.globalCompositeOperation = 'lighter';
    glowBox(baseCtx, 'cyan', w * 0.5, h * 0.60, Math.min(w, h) * 0.62, Math.min(w, h) * 0.22, 0.070);
    baseCtx.globalCompositeOperation = 'source-over';
  }

function floorCircle(radius, rot, segs, color, width) {
    var g = TBG.ctx, w = TBG.w, h = TBG.h;
    g.beginPath();
    for (var i = 0; i <= segs; i++) {
      var a = rot + (i / segs) * TAU;
      var p = projFloor(Math.cos(a) * radius, Math.sin(a) * radius, w, h);
      if (i === 0) g.moveTo(p[0], p[1]); else g.lineTo(p[0], p[1]);
    }
    g.strokeStyle = color;
    g.lineWidth = width;
    g.stroke();
  }

function floorBand(radIn, radOut, color) {
    var g = TBG.ctx, w = TBG.w, h = TBG.h, i, p;
    var segs = 220;
    g.beginPath();
    for (i = 0; i <= segs; i++) {
      var a = (i / segs) * TAU;
      p = projFloor(Math.cos(a) * radOut, Math.sin(a) * radOut, w, h);
      if (i === 0) g.moveTo(p[0], p[1]); else g.lineTo(p[0], p[1]);
    }
    for (i = segs; i >= 0; i--) {
      var a2 = (i / segs) * TAU;
      p = projFloor(Math.cos(a2) * radIn, Math.sin(a2) * radIn, w, h);
      g.lineTo(p[0], p[1]);
    }
    g.closePath();
    g.fillStyle = color;
    g.fill();
  }

function floorTicks(radius, rot, count, majorEvery, len) {
    var g = TBG.ctx, w = TBG.w, h = TBG.h, i, a, p1, p2;
    // 短刻度
    g.beginPath();
    for (i = 0; i < count; i++) {
      if (i % majorEvery === 0) continue;
      a = rot + (i / count) * TAU;
      p1 = projFloor(Math.cos(a) * (radius - len), Math.sin(a) * (radius - len), w, h);
      p2 = projFloor(Math.cos(a) * (radius + len), Math.sin(a) * (radius + len), w, h);
      g.moveTo(p1[0], p1[1]);
      g.lineTo(p2[0], p2[1]);
    }
    g.strokeStyle = rgba(PAL.cyanSoft, 0.30);
    g.lineWidth = 1.2;
    g.stroke();
    // 长刻度
    g.beginPath();
    for (i = 0; i < count; i += majorEvery) {
      a = rot + (i / count) * TAU;
      p1 = projFloor(Math.cos(a) * (radius - len * 2.1), Math.sin(a) * (radius - len * 2.1), w, h);
      p2 = projFloor(Math.cos(a) * (radius + len * 0.6), Math.sin(a) * (radius + len * 0.6), w, h);
      g.moveTo(p1[0], p1[1]);
      g.lineTo(p2[0], p2[1]);
    }
    g.strokeStyle = rgba(PAL.cyanSoft, 0.68);
    g.lineWidth = 1.7;
    g.stroke();
  }

function drawRune(g, x, y, ang, scale, alpha, color, seed) {
    var tpl = RUNES[seed % RUNES.length];
    g.save();
    g.translate(x, y);
    g.rotate(ang);
    g.strokeStyle = rgba(color, alpha);
    g.lineWidth = 1;
    g.beginPath();
    for (var i = 0; i < tpl.length; i++) {
      var seg = tpl[i];
      g.moveTo(seg[0][0] * scale, seg[0][1] * scale);
      g.lineTo(seg[1][0] * scale, seg[1][1] * scale);
    }
    g.stroke();
    g.restore();
  }

function drawSigil(t) {
    var g = TBG.ctx, w = TBG.w, h = TBG.h;
    var S = TBG.geo.s1;
    var breath = 0.5 + 0.5 * Math.sin(t * TAU / 22);
    var c0 = projFloor(0, 0, w, h);

    // 5.1 中心漏光（缓慢呼吸，亮度极低，绝不压过标题）
    var gr = h * 0.50;
    var grad = g.createRadialGradient(c0[0], c0[1], 0, c0[0], c0[1], gr);
    grad.addColorStop(0.00, rgba(PAL.cyanSoft, 0.14 + 0.050 * breath));
    grad.addColorStop(0.38, rgba(PAL.cyan, 0.055 + 0.020 * breath));
    grad.addColorStop(1.00, rgba(PAL.cyan, 0));
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = grad;
    g.fillRect(c0[0] - gr, c0[1] - gr, gr * 2, gr * 2);
    g.globalCompositeOperation = 'source-over';

    // 5.2 辐射骨线（12 等分，极慢旋转）
    var rotOut = t * TAU / 1500;
    var rotArcOut = -t * TAU / 1800;
    g.beginPath();
    for (var i = 0; i < 12; i++) {
      var a = i * TAU / 12 + rotOut * 0.5;
      var pa = projFloor(Math.cos(a) * S.rOut * 0.13, Math.sin(a) * S.rOut * 0.13, w, h);
      var pb = projFloor(Math.cos(a) * S.rOut * 0.985, Math.sin(a) * S.rOut * 0.985, w, h);
      g.moveTo(pa[0], pa[1]);
      g.lineTo(pb[0], pb[1]);
    }
    g.strokeStyle = 'rgba(120, 190, 255, 0.16)';
    g.lineWidth = 1;
    g.stroke();

    // 5.2b 内圈稀疏同心环（三圈，极淡）：秩序感来自"等间距"，不是装饰
    for (var rc = 1; rc <= 3; rc++) {
      floorCircle(S.rOut * (0.18 + rc * 0.19), rc * 0.4, 180, rgba(PAL.cyan, 0.075), 1);
    }

    // 5.3 外层刻度环：120 格 / 每 10 格长刻度（先铺一层极淡环带作承载面）
    floorBand(S.rOut * 0.966, S.rOut, rgba(PAL.cyan, 0.070));
    floorCircle(S.rOut, 0, 220, rgba(PAL.cyanSoft, 0.28), 1.8);
    floorCircle(S.rOut * 0.950, 0, 220, rgba(PAL.cyanSoft, 0.13), 1);
    floorTicks(S.rOut * 0.975, rotOut, 120, 10, 0.011);

    // 5.3b 环外一圈"不闭合"的咒文大弧（魔法侧的重量，与内圈刻度的秩序形成对照）
    for (var ob = 0; ob < 2; ob++) {
      var obA = rotArcOut + ob * Math.PI + 0.7;
      var obSpan = Math.PI - 0.85;
      for (var os = 0; os < 34; os++) {
        var oa1 = obA + obSpan * os / 34;
        var oa2 = obA + obSpan * (os + 1) / 34;
        var owgt = Math.sin(Math.PI * (os + 0.5) / 34);
        var op1 = projFloor(Math.cos(oa1) * S.rOut * 1.10, Math.sin(oa1) * S.rOut * 1.10, w, h);
        var op2 = projFloor(Math.cos(oa2) * S.rOut * 1.10, Math.sin(oa2) * S.rOut * 1.10, w, h);
        g.beginPath();
        g.moveTo(op1[0], op1[1]);
        g.lineTo(op2[0], op2[1]);
        g.strokeStyle = rgba(ob === 0 ? PAL.purple : PAL.cyanSoft, 0.08 + 0.24 * owgt);
        g.lineWidth = 1 + 2.4 * owgt;
        g.stroke();
      }
    }

    // 5.4 内层刻度环：72 格，反向旋转
    var rotMid = -t * TAU / 1200;
    floorCircle(S.rMid, 0, 200, rgba(PAL.cyan, 0.26), 1.2);
    floorTicks(S.rMid, rotMid, 72, 6, 0.0085);

    // 5.5 不闭合咒文弧：3 段，笔压两端细中间粗，反向最慢
    var rotArc = -t * TAU / 1000;
    for (var k = 0; k < 3; k++) {
      var a0 = rotArc + k * TAU / 3 + 0.26;
      var span = TAU / 3 - 0.52;
      var segs = 40;
      for (var s = 0; s < segs; s++) {
        var aa = a0 + span * s / segs;
        var ab = a0 + span * (s + 1) / segs;
        var wgt = Math.sin(Math.PI * (s + 0.5) / segs);   // 0..1..0
        var q1 = projFloor(Math.cos(aa) * S.rArc, Math.sin(aa) * S.rArc, w, h);
        var q2 = projFloor(Math.cos(ab) * S.rArc, Math.sin(ab) * S.rArc, w, h);
        g.beginPath();
        g.moveTo(q1[0], q1[1]);
        g.lineTo(q2[0], q2[1]);
        g.strokeStyle = rgba(PAL.purple, 0.13 + 0.38 * wgt);
        g.lineWidth = 1.2 + 2.4 * wgt;
        g.stroke();
      }
      // 弧上的符文刻痕
      for (var r2 = 0; r2 < 7; r2++) {
        var ar = a0 + span * (r2 + 0.5) / 7;
        var pr = projFloor(Math.cos(ar) * S.rArc, Math.sin(ar) * S.rArc, w, h);
        var pr2 = projFloor(Math.cos(ar + 0.008) * S.rArc, Math.sin(ar + 0.008) * S.rArc, w, h);
        var tang = Math.atan2(pr2[1] - pr[1], pr2[0] - pr[0]);
        drawRune(g, pr[0], pr[1], tang, 11.0, 0.50, PAL.cyanSoft, k * 7 + r2);
      }
    }

    // 5.6 中心核心（极小、呼吸）
    g.globalCompositeOperation = 'lighter';
    glow(g, 'cyan', c0[0], c0[1], h * 0.050, 0.18 + 0.08 * breath);
    glow(g, 'gold', c0[0], c0[1], h * 0.016, 0.24 + 0.10 * breath);
    g.globalCompositeOperation = 'source-over';

    // 5.7 从环上上升的余烬（稀疏，读作"魔法"而非"粒子特效"）
    g.globalCompositeOperation = 'lighter';
    for (var e = 0; e < CACHE.sigilEmbers.length; e++) {
      var pe = CACHE.sigilEmbers[e];
      var u = ((t + pe.phase * pe.life) / pe.life) % 1;
      var ae = pe.ang + rotOut;
      var origin = projFloor(Math.cos(ae) * S.rOut * pe.rad, Math.sin(ae) * S.rOut * pe.rad, w, h);
      var x = origin[0] + Math.sin(u * 3.0 + pe.phase * TAU) * w * 0.010 * u + u * u * w * 0.018;
      var y = origin[1] - u * h * 0.34;
      var alpha = Math.pow(Math.sin(Math.PI * u), 1.4) * 0.40;
      glow(g, pe.kind, x, y, pe.size * (1 - 0.35 * u), alpha);
    }
    g.globalCompositeOperation = 'source-over';
  }

function drawCurtain() {
    if (!CACHE.curtain) return;
    TBG.ctx.fillStyle = CACHE.curtain;
    TBG.ctx.fillRect(0, 0, TBG.w, TBG.h * 0.46);
  }

  /**
   * 初始化符阵余烬（只做一次；确定性随机，刷新后布局一致）
   * @returns {void}
   */
  function initSigilParticles() {
    var rnd = makeLcg(20261108);
    CACHE.sigilEmbers = [];
    for (var i = 0; i < 56; i++) {
      CACHE.sigilEmbers.push({
        ang: rnd() * TAU,
        rad: 0.30 + rnd() * 0.68,
        life: 8 + rnd() * 9,
        phase: rnd(),
        size: 1.4 + rnd() * 2.8,
        kind: rnd() < 0.20 ? 'cyanSoft' : (rnd() < 0.5 ? 'ember' : 'gold')
      });
    }
  }

  /**
   * 尺寸变化时同步几何并标记底图重建
   * @param {number} w CSS 宽
   * @param {number} h CSS 高
   * @returns {void}
   */
  function syncSize(w, h) {
    if (w === TBG.w && h === TBG.h && TBG.geo) return;
    TBG.w = w;
    TBG.h = h;
    TBG.geo = computeGeo(w, h);
    CACHE.curtain = null;
    CACHE.curtainH = 0;
    baseDirty = true;
  }

  /**
   * 懒初始化：图集 / 余烬 / 底图只在首帧或尺寸变化时构建
   * @returns {void}
   */
  function ensure() {
    if (!CACHE.spritesBuilt) { buildSprites(); CACHE.spritesBuilt = true; }
    if (!CACHE.particlesBuilt) { initSigilParticles(); CACHE.particlesBuilt = true; }
    if (baseDirty) { buildBase(); baseDirty = false; }
  }

  /**
   * 画一整帧（调用方只提供 canvas 上下文与 CSS 尺寸）
   * @param {CanvasRenderingContext2D} c2d 上下文
   * @param {number} w CSS 宽
   * @param {number} h CSS 高
   * @param {number} dpr 设备像素比（上游已限幅 ≤1.5）
   * @param {number} t 逻辑秒
   * @returns {boolean} 是否绘制成功
   */
  function draw(c2d, w, h, dpr, t) {
    if (!c2d) return false;
    TBG.ctx = c2d;
    TBG.dpr = dpr || 1;
    syncSize(w, h);
    ensure();
    c2d.setTransform(1, 0, 0, 1, 0, 0);
    c2d.globalAlpha = 1;
    c2d.globalCompositeOperation = 'source-over';
    c2d.drawImage(baseCv, 0, 0);
    c2d.setTransform(TBG.dpr, 0, 0, TBG.dpr, 0, 0);
    drawSigil(t);
    drawCurtain();
    c2d.setTransform(1, 0, 0, 1, 0, 0);
    c2d.globalAlpha = 1;
    c2d.globalCompositeOperation = 'source-over';
    return true;
  }

  /**
   * 返回模块是否已完成首帧初始化（供验收读取）
   * @returns {boolean}
   */
  function isReady() { return !baseDirty && !!CACHE.spritesBuilt && !!CACHE.particlesBuilt; }

  return { draw: draw, isReady: isReady };
})();