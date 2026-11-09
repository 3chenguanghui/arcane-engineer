/* ============================================================
   烬 · 技能视觉补丁（skill-fx.js）
   ------------------------------------------------------------
   设计原则：
   1. 不另建调度器。所有特效都写进游戏已有的 state.rings / state.beams /
      state.particles，由原渲染循环统一绘制；卡面状态挂在已有的 20Hz
      updateDeckCooldowns 上。
   2. 不改战斗数值。出手时机、伤害、冷却、耗能一律不碰；“前摇语言”与出手
      同帧起播（0.12–0.22s 的收束/成形/预兆），读起来是“蓄力→释放”。
   3. 同帧合并 + 总量上限。同一帧内同一技能的多段命中只出一枚签名章；
      粒子沿用游戏 300 上限，环/光束另有 88/60 的补丁上限。
   4. 命名空间 SKILLFX；apply()/revert() 幂等；?skillfx=off 一键关闭。
   ============================================================ */
(function (global) {
  'use strict';

  var NS = global.SKILLFX || (global.SKILLFX = {});
  if (NS.__installed) return;
  NS.__installed = true;
  NS.version = '1.0.0';

  var TAU = Math.PI * 2;
  var QUERY = String((global.location && global.location.search) || '');
  NS.disabledByQuery = /(^|[?&])skillfx=off(&|$)/.test(QUERY);

  /* 补丁自身上限：只约束本补丁追加的内容，游戏原有上限不动 */
  var LIMITS = {
    particles: 300,   // 与游戏 addBurst/addSparks 的硬上限保持一致
    rings: 88,        // 环总量上限（含原技能环）
    beams: 60,        // 光束总量上限
    hitStamps: 20     // 每 0.2 秒最多 20 枚命中签名，防止 AOE 刷屏
  };

  /* ---------- 0. 可复现随机：截图与压测需要同一条序列 ---------- */
  var seed = 20261108;
  function rnd01() {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  }
  function rnd(a, b) { return a + (b - a) * rnd01(); }
  NS.setSeed = function (value) { seed = (Number(value) || 0) >>> 0; };

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /**
   * 把 #rgb / #rrggbb 转成 rgba()，用于环形/粒子柔光
   * @param {string} hex 颜色
   * @param {number} alpha 透明度
   * @returns {string} rgba 字符串
   */
  function rgba(hex, alpha) {
    var h = String(hex || '#ffffff').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    if (!isFinite(n)) return 'rgba(255,255,255,' + alpha + ')';
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')';
  }

  /* ============================================================
     1. 12 张技能卡的“视觉签名”
     ------------------------------------------------------------
     el    元素：决定前摇语言与命中几何
     shape 形状口径：同一元素内的第二层区分（形状 + 方向 + 颜色）
     ============================================================ */
  var CARD_ORDER = [
    'fireball', 'frost', 'bolt', 'heal', 'blade', 'mine',
    'lavaFissure', 'arcanePool', 'runeOrbit', 'collapseHole', 'flameCone', 'frostRing'
  ];

  var CARD_FX = {
    fireball:     { el: 'fire',    shape: 'lance',   label: '火球' },
    flameCone:    { el: 'fire',    shape: 'wedge',   label: '喷火锥' },
    lavaFissure:  { el: 'fire',    shape: 'line',    label: '熔岩地裂' },
    mine:         { el: 'fire',    shape: 'seal',    label: '符文雷' },
    frost:        { el: 'ice',     shape: 'hex',     label: '冰环' },
    frostRing:    { el: 'ice',     shape: 'hexring', label: '冰霜环' },
    bolt:         { el: 'thunder', shape: 'zigzag',  label: '雷击' },
    arcanePool:   { el: 'thunder', shape: 'field',   label: '奥术雷池' },
    heal:         { el: 'heal',    shape: 'aura',    label: '治疗符' },
    blade:        { el: 'poison',  shape: 'crescent',label: '回旋刃' },
    runeOrbit:    { el: 'poison',  shape: 'orbit',   label: '符文轨道' },
    collapseHole: { el: 'void',    shape: 'vortex',  label: '坍缩黑洞' }
  };

  /* 融合形态归到母卡：命中签名仍能认出“是哪一类法术打中的” */
  var CARD_ALIAS = {
    homingFireball: 'fireball', novaBurst: 'fireball', piercingBeam: 'fireball',
    frostField: 'frost', gravityWell: 'frost',
    chainSpread: 'bolt', droneSwarm: 'bolt',
    regenField: 'heal', shieldNova: 'heal',
    lavaBand: 'lavaFissure', frostFlame: 'frostRing', drainRing: 'collapseHole'
  };

  var FALLBACK_COLOR = {
    fire:    { core: '#ff9a5a', glow: '#ff6b3d', accent: '#ffd27a' },
    ice:     { core: '#7fd8ff', glow: '#4aa8ff', accent: '#d8f6ff' },
    thunder: { core: '#a8e6ff', glow: '#5ec8ff', accent: '#eaffff' },
    heal:    { core: '#47e8a7', glow: '#2fbf87', accent: '#c8ffe2' },
    poison:  { core: '#d8b8ff', glow: '#a06bff', accent: '#f4e6ff' },
    void:    { core: '#c7a8ff', glow: '#7b4dff', accent: '#ffffff' }
  };

  /**
   * 读取一张卡的视觉定义（含颜色）
   * @param {string} id 卡 id（可以是融合 id）
   * @returns {Object|null} 定义
   */
  function cardDef(id) {
    var base = CARD_FX[id] ? id : CARD_ALIAS[id];
    var def = CARD_FX[base];
    if (!def) return null;
    var fb = FALLBACK_COLOR[def.el];
    var magic = (typeof MAGIC_BY_ID !== 'undefined' && MAGIC_BY_ID) ? MAGIC_BY_ID[base] : null;
    var vfx = magic && magic.vfx ? magic.vfx : {};
    return {
      id: base,
      el: def.el,
      shape: def.shape,
      label: def.label,
      core: vfx.core || fb.core,
      glow: vfx.glow || fb.glow,
      accent: vfx.accent || fb.accent
    };
  }

  NS.cards = CARD_ORDER.slice();
  NS.cardInfo = cardDef;

  /* ============================================================
     2. 渲染后端：游戏内 = 既有 addRing/addBurst/addBeam/对象池
       预览页 = SKILLFX.bindSandbox() 注入的同签名适配器
     ============================================================ */
  var world = null;

  /**
   * 绑定游戏内既有接口（不新建数组、不新建调度器）
   * @returns {boolean} 是否绑定成功
   */
  function bindGameWorld() {
    if (typeof addRing !== 'function' || typeof addBurst !== 'function') return false;
    if (typeof state === 'undefined' || !state) return false;
    world = {
      kind: 'game',
      ring: function (x, y, r, color, grow, life, shape, spin) {
        addRing(x, y, r, color, grow, life, shape, spin);
      },
      burst: function (x, y, color, count, speed, dir, spread, skip) {
        addBurst(x, y, color, count, speed, dir, spread, skip);
      },
      sparks: function (x, y, color, count) {
        if (typeof addSparks === 'function') addSparks(x, y, color, count);
      },
      beam: function (points, color, life, width, branch) {
        addBeam(points, color, life, width, branch);
      },
      mote: function (x, y, vx, vy, size, color, life) {
        var p = acquireParticle();
        p.x = x; p.y = y; p.vx = vx; p.vy = vy;
        p.size = size; p.color = color;
        p.life = life; p.maxLife = life; p.spark = false;
        state.particles.push(p);
        if (state.particles.length > LIMITS.particles) {
          var dropped = state.particles.splice(0, state.particles.length - LIMITS.particles);
          for (var i = 0; i < dropped.length; i += 1) releaseParticle(dropped[i]);
        }
      },
      counts: function () {
        return {
          particles: state.particles ? state.particles.length : 0,
          rings: state.rings ? state.rings.length : 0,
          beams: (state.beams && state.beams.length) || 0
        };
      },
      now: function () {
        return Number(state.elapsed) || 0;
      },
      player: function () { return state.player; },
      aim: function () {
        return (typeof getAimAngle === 'function') ? getAimAngle() : (state.player ? state.player.angle : 0);
      },
      scale: function () {
        return (typeof perfParticleScale === 'function') ? perfParticleScale() : 1;
      }
    };
    return true;
  }

  /**
   * 预览页/测试台注入后端。适配器字段与游戏后端完全一致。
   * @param {Object} adapter 适配器
   * @returns {boolean} 是否接受
   */
  NS.bindSandbox = function (adapter) {
    if (!adapter || typeof adapter.ring !== 'function') return false;
    world = {
      kind: 'sandbox',
      ring: adapter.ring,
      burst: adapter.burst || function () {},
      sparks: adapter.sparks || function () {},
      beam: adapter.beam || function () {},
      mote: adapter.mote || function () {},
      counts: adapter.counts || function () { return { particles: 0, rings: 0, beams: 0 }; },
      now: adapter.now || function () { return 0; },
      player: adapter.player || function () { return { x: 0, y: 0, angle: 0 }; },
      aim: adapter.aim || function () { return 0; },
      scale: adapter.scale || function () { return 1; }
    };
    return true;
  };

  /* ---------- 2.1 统一入口：上限、同帧合并、峰值统计 ---------- */
  var stats = { casts: 0, hits: 0, merged: 0, peakParticles: 0, peakRings: 0, peakBeams: 0 };
  NS.stats = stats;
  NS.resetStats = function () {
    stats.casts = 0; stats.hits = 0; stats.merged = 0;
    stats.peakParticles = 0; stats.peakRings = 0; stats.peakBeams = 0;
  };

  function counts() { return world ? world.counts() : { particles: 0, rings: 0, beams: 0 }; }

  /**
   * 记录当前峰值（供压测读取）
   */
  function notePeak() {
    var c = counts();
    if (c.particles > stats.peakParticles) stats.peakParticles = c.particles;
    if (c.rings > stats.peakRings) stats.peakRings = c.rings;
    if (c.beams > stats.peakBeams) stats.peakBeams = c.beams;
  }

  /**
   * 追加一圈环（受补丁上限约束）
   * @returns {boolean} 是否真的写入
   */
  function ring(x, y, r, color, grow, life, shape, spin) {
    if (!world || counts().rings >= LIMITS.rings) return false;
    world.ring(x, y, Math.max(1, r), color, grow, life, shape || 'ring', spin || 0);
    notePeak();
    return true;
  }

  /**
   * 追加一条光束（受补丁上限约束）
   * @returns {boolean} 是否真的写入
   */
  function beam(points, color, life, width, branch) {
    if (!world || !points || points.length < 2) return false;
    if (counts().beams >= LIMITS.beams) return false;
    world.beam(points, color, life, width || 1.4, !!branch);
    notePeak();
    return true;
  }

  /**
   * 追加一簇方向粒子（沿用游戏 addBurst 的 300 上限）
   * @returns {boolean} 是否真的写入
   */
  function burst(x, y, color, count, speed, dir, spread) {
    if (!world || counts().particles >= LIMITS.particles) return false;
    var n = Math.max(3, Math.round((count || 8) * world.scale()));
    world.burst(x, y, color, n, speed, dir, spread, true);
    notePeak();
    return true;
  }

  /**
   * 追加手写粒子（收束 / 上升 / 残留用），走同一个对象池
   * @returns {boolean} 是否真的写入
   */
  function mote(x, y, vx, vy, size, color, life) {
    if (!world || counts().particles >= LIMITS.particles) return false;
    world.mote(x, y, vx, vy, size, color, life);
    notePeak();
    return true;
  }

  /* ---------- 2.2 同帧合并：同一 60Hz 帧内同技能只出一枚大签名 ---------- */
  var frameTick = -1;
  var frameSeen = {};
  /**
   * 判断某个 key 是否在本帧第一次出现
   * @param {string} key 合并键
   * @returns {boolean} true=本帧已出现过，应合并掉
   */
  function alreadyThisFrame(key) {
    var tick = Math.floor((world ? world.now() : performance.now() / 1000) * 60);
    if (tick !== frameTick) { frameTick = tick; frameSeen = {}; }
    if (frameSeen[key]) return true;
    frameSeen[key] = 1;
    return false;
  }

  /* ---------- 2.3 命中签名预算：0.2 秒内最多 20 枚 ---------- */
  var hitWin = -1;
  var hitCount = 0;
  function hitBudget() {
    var win = Math.floor((world ? world.now() : performance.now() / 1000) * 5);
    if (win !== hitWin) { hitWin = win; hitCount = 0; }
    if (hitCount >= LIMITS.hitStamps) return false;
    hitCount += 1;
    return true;
  }

  /* ============================================================
     3. 几何小工具
     ============================================================ */

  /**
   * 生成折线闪电的顶点（起点 → 抖动中点 → 终点）
   * @returns {Array} 点集
   */
  function zigPoints(x1, y1, x2, y2, seg, jitter) {
    var pts = [{ x: x1, y: y1 }];
    var ang = Math.atan2(y2 - y1, x2 - x1);
    var nx = Math.cos(ang + Math.PI / 2);
    var ny = Math.sin(ang + Math.PI / 2);
    for (var i = 1; i < seg; i += 1) {
      var f = i / seg;
      var off = rnd(-jitter, jitter);
      pts.push({ x: x1 + (x2 - x1) * f + nx * off, y: y1 + (y2 - y1) * f + ny * off });
    }
    pts.push({ x: x2, y: y2 });
    return pts;
  }

  /**
   * 生成一段圆弧点集（回旋刃的月牙用）
   * @returns {Array} 点集
   */
  function arcPoints(cx, cy, angle, radius, span, steps) {
    var pts = [];
    for (var i = 0; i <= steps; i += 1) {
      var a = angle - span / 2 + (span * i) / steps;
      pts.push({ x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius });
    }
    return pts;
  }

  /**
   * 让粒子从四周向一点收束（火/虚空的“蓄”）
   */
  function converge(cx, cy, color, count, radius, speed, life) {
    for (var i = 0; i < count; i += 1) {
      var a = rnd(0, TAU);
      var r = radius + rnd(-5, 5);
      var spd = speed + rnd(-20, 25);
      mote(cx + Math.cos(a) * r, cy + Math.sin(a) * r,
        -Math.cos(a) * spd, -Math.sin(a) * spd, rnd(1.1, 2.1), color, life + rnd(-0.02, 0.04));
    }
  }

  /**
   * 向上飘的光粒（治疗/成形）
   */
  function riseMotes(cx, cy, color, count, spread, life) {
    for (var i = 0; i < count; i += 1) {
      mote(cx + rnd(-spread, spread), cy + rnd(-4, spread * 0.6),
        rnd(-10, 10), rnd(-110, -52), rnd(1.4, 2.8), color, life + rnd(-0.06, 0.1));
    }
  }

  /**
   * 向心收束的光束（坍缩黑洞）
   */
  function inwardBeams(cx, cy, color, count, radius, life) {
    for (var i = 0; i < count; i += 1) {
      var a = (TAU * i) / count + rnd(-0.2, 0.2);
      beam([{ x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius },
        { x: cx + Math.cos(a) * radius * 0.35, y: cy + Math.sin(a) * radius * 0.35 }],
        color, life, 1.2, false);
    }
  }

  /* ============================================================
     4. 施法演出：前摇语言 → 释放签名 → 残留收束
     ------------------------------------------------------------
     注意：三段与出手同帧起播。前摇不是“延迟”，而是让玩家在子弹飞出的
     同时看到杖口“在收 / 在结 / 在闪”，从而读得懂这一发是什么属性。
     ============================================================ */

  /**
   * 前摇：按元素给不同语言
   * 火=向内收束 / 冰=结晶成形 / 雷=预兆电弧 / 毒=印记旋开 / 虚空=内旋 / 治疗=升腾
   */
  function anticipate(def, px, py, angle) {
    var c = rgba(def.core, 0.8);
    var g = rgba(def.glow, 0.55);
    var a = rgba(def.accent, 0.9);
    if (def.el === 'fire') {
      ring(px, py, 46, a, -38, 0.2, 'ring');
      ring(px, py, 8, g, 22, 0.26, 'shockwave');
      converge(px, py, def.accent, 7, 30, 170, 0.18);
    } else if (def.el === 'ice') {
      ring(px, py, 8, a, 34, 0.26, 'hex', 1.4);
      ring(px, py, 30, g, -22, 0.2, 'hex', -1.2);
      for (var i = 0; i < 6; i += 1) {
        var ang = (TAU * i) / 6 + angle;
        beam([{ x: px, y: py },
          { x: px + Math.cos(ang) * 26, y: py + Math.sin(ang) * 26 }], a, 0.22, 1.2, false);
      }
    } else if (def.el === 'thunder') {
      ring(px, py, 18, a, 10, 0.18, 'rune', 4.2);
      for (var k = 0; k < 3; k += 1) {
        var aa = angle + (k - 1) * 0.55;
        beam(zigPoints(px + Math.cos(aa) * 16, py + Math.sin(aa) * 16,
          px + Math.cos(aa) * 52, py + Math.sin(aa) * 52, 3, 7), a, 0.16, 1.1, false);
      }
      burst(px, py, def.accent, 4, 80);
    } else if (def.el === 'poison') {
      ring(px, py, 12, a, 26, 0.24, 'rune', 3.2);
      for (var m = -1; m <= 1; m += 1) {
        beam(arcPoints(px, py, angle + m * 0.42, 30, 0.55, 3), g, 0.2, 1.3, false);
      }
      burst(px, py, def.accent, 4, 70, angle, Math.PI / 3);
    } else if (def.el === 'void') {
      ring(px, py, 48, a, -40, 0.3, 'rune', -3.6);
      ring(px, py, 10, '#ffffff', 20, 0.24, 'ring');
      converge(px, py, def.core, 6, 32, 150, 0.22);
    } else {
      ring(px, py, 14, a, 32, 0.3, 'rune', 2.4);
      ring(px, py, 6, g, 18, 0.26, 'ring');
      riseMotes(px, py, def.core, 6, 18, 0.4);
    }
  }

  /**
   * 释放签名：方向 + 形状 + 颜色三层区分
   */
  function release(def, id, px, py, angle, target) {
    var c = def.core;
    var g = def.glow;
    var a = def.accent;
    var px2 = px + Math.cos(angle) * 12;
    var py2 = py + Math.sin(angle) * 12;

    if (def.shape === 'lance') {
      ring(px2, py2, 5, rgba(a, 0.9), 30, 0.2, 'shockwave');
      for (var i = -1; i <= 1; i += 1) {
        var aa = angle + i * 0.12;
        beam([{ x: px2, y: py2 },
          { x: px2 + Math.cos(aa) * 52, y: py2 + Math.sin(aa) * 52 }], a, 0.2, i === 0 ? 2.2 : 1.2, false);
      }
      burst(px2, py2, a, 10, 190, angle, Math.PI / 5);
    } else if (def.shape === 'wedge') {
      ring(px, py, 8, rgba(g, 0.7), 34, 0.24, 'shockwave');
      var half = (72 * Math.PI / 180) * 0.5;
      for (var w = -2; w <= 2; w += 1) {
        var wa = angle + (half * w) / 2;
        beam([{ x: px, y: py },
          { x: px + Math.cos(wa) * 190, y: py + Math.sin(wa) * 190 }], rgba(g, 0.42), 0.3, 1.5, false);
      }
      burst(px, py, a, 18, 250, angle, half * 2);
    } else if (def.shape === 'line') {
      var ex = px + Math.cos(angle) * 260;
      var ey = py + Math.sin(angle) * 260;
      beam([{ x: px, y: py }, { x: ex, y: ey }], rgba(g, 0.8), 0.42, 7, false);
      ring(ex, ey, 10, rgba(a, 0.85), 46, 0.3, 'shockwave');
      for (var s = 1; s <= 4; s += 1) {
        var f = s / 5;
        burst(px + (ex - px) * f, py + (ey - py) * f, a, 4, 70);
      }
      for (var cr = -2; cr <= 2; cr += 1) {
        var ca = angle + cr * 0.5 + Math.PI * 0.5;
        beam([{ x: ex, y: ey },
          { x: ex + Math.cos(ca) * 22, y: ey + Math.sin(ca) * 22 }], c, 0.22, 1.1, false);
      }
    } else if (def.shape === 'seal') {
      ring(target.x, target.y, 8, rgba(a, 0.85), 38, 0.3, 'rune', 2.2);
      ring(target.x, target.y, 4, rgba(g, 0.6), 14, 0.22, 'hex', -1.6);
      for (var q = 0; q < 4; q += 1) {
        var qa = Math.PI / 4 + q * Math.PI / 2;
        beam([{ x: target.x + Math.cos(qa) * 16, y: target.y + Math.sin(qa) * 16 },
          { x: target.x + Math.cos(qa) * 30, y: target.y + Math.sin(qa) * 30 }], a, 0.28, 1.4, false);
      }
      burst(target.x, target.y, a, 8, 80);
    } else if (def.shape === 'hex' || def.shape === 'hexring') {
      var R = (def.shape === 'hexring') ? 140 : 96;
      ring(px, py, 10, rgba(a, 0.9), R, 0.44, 'hex', 1.5);
      ring(px, py, 16, rgba(g, 0.5), R * 0.72, 0.38, 'rune', -2.4);
      burst(px, py, a, def.shape === 'hexring' ? 14 : 10, 160);
      for (var h = 0; h < 6; h += 1) {
        var ha = (TAU * h) / 6 + angle;
        beam([{ x: px + Math.cos(ha) * 18, y: py + Math.sin(ha) * 18 },
          { x: px + Math.cos(ha) * (R * 0.55), y: py + Math.sin(ha) * (R * 0.55) }], rgba(c, 0.55), 0.3, 1.2, false);
      }
    } else if (def.shape === 'zigzag') {
      var tx = target.x;
      var ty = target.y;
      beam(zigPoints(px, py, tx, ty, 4, 13), c, 0.26, 2.2, false);
      beam(zigPoints(tx - Math.cos(angle) * 10, ty - Math.sin(angle) * 10,
        tx + rnd(-20, 20), ty + rnd(-20, 20), 2, 8), g, 0.18, 1.2, true);
      ring(tx, ty, 4, rgba(c, 0.9), 24, 0.2, 'shockwave');
      burst(tx, ty, a, 6, 150, angle, Math.PI / 4);
    } else if (def.shape === 'field') {
      ring(target.x, target.y, 8, rgba(a, 0.9), 110, 0.5, 'shockwave');
      ring(target.x, target.y, 44, rgba(g, 0.65), 116, 0.42, 'rune', 1.8);
      for (var z = 0; z < 6; z += 1) {
        var za = (TAU * z) / 6 + rnd(-0.2, 0.2);
        var zr = 26 + rnd(0, 62);
        beam(zigPoints(target.x + Math.cos(za) * zr, target.y + Math.sin(za) * zr,
          target.x + Math.cos(za) * (zr + 22), target.y + Math.sin(za) * (zr + 22), 3, 6),
          a, 0.24, 1.3, false);
      }
      burst(target.x, target.y, a, 12, 160);
    } else if (def.shape === 'aura') {
      ring(px, py, 12, rgba(c, 0.85), 58, 0.5, 'rune', 2.2);
      ring(px, py, 8, rgba(a, 0.6), 34, 0.4, 'ring');
      riseMotes(px, py, c, 10, 24, 0.6);
    } else if (def.shape === 'crescent') {
      ring(px2, py2, 5, rgba(a, 0.9), 24, 0.2, 'shockwave');
      beam(arcPoints(px2, py2, angle, 56, 1.1, 4), c, 0.34, 2.4, false);
      beam(arcPoints(px2, py2, angle, 38, 0.92, 4), rgba(g, 0.8), 0.3, 1.6, false);
      burst(px2, py2, a, 8, 140, angle, Math.PI / 5);
    } else if (def.shape === 'orbit') {
      ring(px, py, 40, rgba(g, 0.85), 200, 0.5, 'rune', 3.2);
      ring(px, py, 48, rgba(a, 0.6), 180, 0.44, 'ring', -2.4);
      ring(px, py, 32, rgba(c, 0.5), 160, 0.58, 'hex', 1.6);
      burst(px, py, a, 12, 120);
    } else {
      ring(target.x, target.y, 34, rgba(g, 0.9), 94, 0.5, 'rune', -3.4);
      ring(target.x, target.y, 8, '#ffffff', 28, 0.24, 'ring');
      inwardBeams(target.x, target.y, rgba(c, 0.55), 4, 72, 0.34);
      converge(target.x, target.y, a, 8, 60, 120, 0.4);
      burst(target.x, target.y, a, 10, 70);
    }
  }

  /**
   * 残留：技能收束后留一圈慢消散的余韵，避免“直接消失”
   */
  function residue(def, px, py, angle, target) {
    if (def.el === 'fire') {
      ring(px, py, 26, rgba(def.glow, 0.34), 30, 0.55, 'shockwave');
      burst(px, py, def.accent, 4, 50);
    } else if (def.el === 'ice') {
      ring(px, py, 34, rgba(def.core, 0.28), 22, 0.62, 'hex', 0.9);
      burst(px, py, def.accent, 3, 40);
    } else if (def.el === 'thunder') {
      ring(target.x, target.y, 18, rgba(def.core, 0.3), 34, 0.4, 'rune', 2.6);
      burst(target.x, target.y, def.accent, 3, 46);
    } else if (def.el === 'poison') {
      ring(px, py, 22, rgba(def.glow, 0.3), 34, 0.55, 'rune', 2.0);
      burst(px, py, def.accent, 3, 42);
    } else if (def.el === 'void') {
      ring(target.x, target.y, 70, rgba(def.glow, 0.3), -52, 0.6, 'rune', -2.4);
      burst(target.x, target.y, def.core, 3, 36);
    } else {
      ring(px, py, 30, rgba(def.core, 0.28), 26, 0.58, 'ring');
      riseMotes(px, py, def.core, 3, 14, 0.5);
    }
  }

  /**
   * 计算“落点类技能”的实际目标点（与游戏同一口径）
   * @returns {{x:number,y:number}} 目标点
   */
  function resolveTarget(id, px, py, angle) {
    if (id === 'mine' && typeof getGroundCastPoint === 'function') return getGroundCastPoint(420);
    if ((id === 'arcanePool' || id === 'collapseHole') && typeof aoeAimPoint === 'function') {
      return aoeAimPoint(300);
    }
    if (typeof mouseState !== 'undefined' && mouseState && Number.isFinite(mouseState.worldX)) {
      var dx = mouseState.worldX - px;
      var dy = mouseState.worldY - py;
      var len = Math.hypot(dx, dy);
      if (len > 320) { dx = dx / len * 320; dy = dy / len * 320; }
      return { x: px + dx, y: py + dy };
    }
    if (id === 'bolt' && typeof findNearestEnemy === 'function') {
      var e = findNearestEnemy(px, py, 520);
      if (e) return { x: e.x, y: e.y };
    }
    return { x: px + Math.cos(angle) * 220, y: py + Math.sin(angle) * 220 };
  }

  /**
   * 对外：打一发完整施法演出（前摇 + 释放 + 残留）
   * @param {string} id 技能 id
   * @param {Object} [origin] 可选起点 {x,y,angle}
   * @returns {boolean} 是否演出成功
   */
  function emitCast(id, origin) {
    if (!world || !NS.enabled && world.kind !== 'sandbox') return false;
    var def = cardDef(id);
    if (!def) return false;
    var p = origin && Number.isFinite(origin.x) ? origin : world.player();
    if (!p) return false;
    var angle = (origin && Number.isFinite(origin.angle)) ? origin.angle : world.aim();
    var target = (origin && Number.isFinite(origin.tx))
      ? { x: origin.tx, y: origin.ty }
      : resolveTarget(id, p.x, p.y, angle);
    try {
      anticipate(def, p.x, p.y, angle);
      release(def, def.id, p.x, p.y, angle, target);
      residue(def, p.x, p.y, angle, target);
      stats.casts += 1;
      notePeak();
      return true;
    } catch (err) {
      return false;
    }
  }
  NS.emitCast = emitCast;

  /**
   * 对外：命中签名（形状 + 方向 + 颜色）
   * @param {string} abilityId 命中来源 id（含融合 id）
   * @param {number} x 命中点 x
   * @param {number} y 命中点 y
   * @param {number} dir 命中方向（弧度）
   * @returns {boolean} 是否演出
   */
  function emitHit(abilityId, x, y, dir) {
    if (!world) return false;
    var def = cardDef(abilityId);
    if (!def || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    if (!hitBudget()) return false;
    var d = Number.isFinite(dir) ? dir : 0;
    var merged = alreadyThisFrame('h:' + def.id);
    if (merged) { stats.merged += 1; return false; }
    try {
      if (def.el === 'fire') {
        ring(x, y, 5, rgba(def.accent, 0.9), 26, 0.18, 'shockwave');
        beam([{ x: x - Math.cos(d) * 10, y: y - Math.sin(d) * 10 },
          { x: x + Math.cos(d) * 24, y: y + Math.sin(d) * 24 }], def.accent, 0.16, 1.4, false);
        burst(x, y, def.accent, 5, 110, d, Math.PI / 4);
      } else if (def.el === 'ice') {
        ring(x, y, 8, rgba(def.core, 0.85), 15, 0.2, 'hex', 1.6);
        for (var i = 0; i < 3; i += 1) {
          var a = d + (i - 1) * 0.5;
          beam([{ x: x, y: y }, { x: x + Math.cos(a) * 20, y: y + Math.sin(a) * 20 }],
            rgba(def.accent, 0.8), 0.16, 1.1, false);
        }
        burst(x, y, def.accent, 3, 70);
      } else if (def.el === 'thunder') {
        beam(zigPoints(x - Math.cos(d) * 18, y - Math.sin(d) * 18,
          x + Math.cos(d) * 18, y + Math.sin(d) * 18, 3, 9), def.core, 0.18, 1.6, false);
        ring(x, y, 4, rgba(def.core, 0.8), 18, 0.18, 'shockwave');
        burst(x, y, def.accent, 4, 90, d, Math.PI / 3);
      } else if (def.el === 'poison') {
        ring(x, y, 10, rgba(def.glow, 0.8), 20, 0.2, 'rune', 2.6);
        beam(arcPoints(x, y, d, 22, 0.9, 3), rgba(def.accent, 0.75), 0.16, 1.2, false);
        burst(x, y, def.accent, 3, 60);
      } else if (def.el === 'void') {
        ring(x, y, 26, rgba(def.glow, 0.85), -20, 0.22, 'rune', -2.8);
        converge(x, y, def.core, 3, 24, 90, 0.16);
      } else {
        ring(x, y, 6, rgba(def.core, 0.75), 16, 0.16, 'ring');
        burst(x, y, def.accent, 3, 50);
      }
      stats.hits += 1;
      notePeak();
      return true;
    } catch (err) {
      return false;
    }
  }
  NS.emitHit = emitHit;

  /* ============================================================
     5. 卡面反馈
     ============================================================ */

  var prevCd = {};
  var cardColorCache = {};

  function cardEl(id) {
    return document.querySelector('.mini-card[data-magic-id="' + id + '"]');
  }

  /**
   * 给卡面写入元素色（只在技能第一次出现时写，避免每帧重排）
   */
  function paintCardColor(card, def) {
    if (!card || cardColorCache[def.id] === def.glow) return;
    cardColorCache[def.id] = def.glow;
    card.style.setProperty('--sfx-c', def.glow);
    card.style.setProperty('--sfx-c-soft', rgba(def.glow, 0.26));
    card.style.setProperty('--sfx-line', rgba(def.glow, 0.5));
  }

  /**
   * 读一张卡的最小耗能（主/副槽取便宜的那个），用于“缺能”判定
   */
  function minCostOf(magic) {
    if (!magic) return 0;
    var cdr = (typeof talentEff === 'function') ? talentEff('aetherCostPct') : 0;
    var secondary = (typeof DUAL_CONFIG !== 'undefined' && DUAL_CONFIG.enabled !== false)
      ? DUAL_CONFIG.secondaryCost : 1;
    return Math.max(1, Math.round((magic.cost || 0) * secondary * (1 - cdr)));
  }

  /**
   * 短时间挂一个类名，结束后移除（动画可重复触发）
   * 每个类名单独计时：同一次施法要同时挂“冷却开始”和“按下”两个类
   */
  function flashClass(card, cls, ms) {
    if (!card) return;
    if (!card.__sfxTimers) card.__sfxTimers = {};
    if (card.__sfxTimers[cls]) clearTimeout(card.__sfxTimers[cls]);
    card.classList.remove(cls);
    card.classList.add(cls);
    card.__sfxTimers[cls] = setTimeout(function () {
      card.classList.remove(cls);
      card.__sfxTimers[cls] = null;
    }, ms);
  }

  /**
   * 卡面按下：立刻下压；如果当前放不出，再补一次“被拒抖动”
   */
  function pressCard(id) {
    var card = cardEl(id);
    var def = cardDef(id);
    if (!card || !def) return;
    paintCardColor(card, def);
    flashClass(card, 'sfx-press', 150);
    if (typeof state === 'undefined' || !state) return;
    var cooling = (state.cooldowns && state.cooldowns[id]) ? state.cooldowns[id] > 0.05 : false;
    var magic = (typeof MAGIC_BY_ID !== 'undefined') ? MAGIC_BY_ID[id] : null;
    var lack = state.player && state.player.aether < minCostOf(magic);
    if (cooling || lack) flashClass(card, 'sfx-denied', 300);
  }

  /**
   * 卡面：成功施法（冷却开始 + 元素色外溢）
   */
  function castCard(id) {
    var card = cardEl(id);
    var def = cardDef(id);
    if (!card || !def) return;
    paintCardColor(card, def);
    card.classList.remove('sfx-casting');
    void card.offsetWidth;
    card.classList.add('sfx-casting');
    setTimeout(function () { card.classList.remove('sfx-casting'); }, 430);
    flashClass(card, 'sfx-coolstart', 350);
    flashClass(card, 'sfx-press', 150);
  }

  /**
   * 卡面：放不出时的回执
   */
  function denyCard(id, reason) {
    var card = cardEl(id);
    if (!card) return;
    flashClass(card, 'sfx-denied', 300);
    if (reason === 'aether') flashClass(card, 'sfx-aether', 700);
  }

  NS.press = pressCard;
  NS.castCard = castCard;

  /**
   * 20Hz 卡面状态刷新：可用 / 冷却 / 缺能 / 充能完毕
   */
  function refreshCards() {
    if (typeof state === 'undefined' || !state) return;
    var cards = document.querySelectorAll('.mini-card[data-magic-id]');
    if (!cards.length) return;
    var cdMul = (state.mods && state.mods.cooldownMul) ? state.mods.cooldownMul : 1;
    var aether = (state.player && Number.isFinite(state.player.aether)) ? state.player.aether : 999;

    for (var i = 0; i < cards.length; i += 1) {
      var card = cards[i];
      var id = card.getAttribute('data-magic-id');
      var magic = (typeof MAGIC_BY_ID !== 'undefined') ? MAGIC_BY_ID[id] : null;
      if (!magic) continue;
      var def = cardDef(id);
      if (def) paintCardColor(card, def);

      var remain = Math.max(0, (state.cooldowns && state.cooldowns[id]) || 0);
      var total = Math.max(0.001, magic.cooldown * cdMul);
      var frac = remain > 0.05 ? clamp(remain / total, 0, 1) : 0;
      var deg = (frac * 360).toFixed(1) + 'deg';
      if (card.__sfxCda !== deg) { card.__sfxCda = deg; card.style.setProperty('--sfx-cda', deg); }
      card.style.setProperty('--sfx-cd', frac.toFixed(3));

      var owned = (state.ownedMagic || []).indexOf(id) >= 0;
      var cooling = remain > 0.05;
      var lack = owned && !cooling && aether < minCostOf(magic);

      card.classList.toggle('sfx-cooling', cooling);
      card.classList.toggle('sfx-aether', lack);
      card.classList.toggle('sfx-usable', owned && !cooling && !lack);

      var before = prevCd[id];
      if (before > 0.05 && remain <= 0.05 && owned) flashClass(card, 'sfx-ready', 900);
      prevCd[id] = remain;
    }
  }
  NS.refreshCards = refreshCards;

  /* ============================================================
     6. 挂载 / 卸载：只包一层既有函数，不复制任何逻辑
     ============================================================ */
  var hooks = null;
  var listenersOn = false;

  /**
   * 包装 castSlot：成功 → 施法签名 + 卡面；失败 → 卡面回执
   */
  function installGameHooks() {
    if (typeof castSlot !== 'function' || typeof damageEnemy !== 'function') return false;
    var origCast = castSlot;
    var origUpdate = updateDeckCooldowns;
    var origDamage = damageEnemy;

    /**
     * 判断当前槽位会释放哪张卡
     */
    function slotCardId(slot) {
      var d = state.dual;
      if (typeof DUAL_CONFIG !== 'undefined' && DUAL_CONFIG.enabled !== false && d && d.slots) {
        return d.slots[slot] || null;
      }
      return state.activeMagicId || null;
    }

    /**
     * 失败原因判定（只读状态，不改任何逻辑）
     */
    function failReason(id) {
      if (!id) return 'none';
      if (state.ownedMagic && state.ownedMagic.indexOf(id) < 0) return 'locked';
      if ((state.cooldowns && state.cooldowns[id]) > 0.05) return 'cooldown';
      var magic = (typeof MAGIC_BY_ID !== 'undefined') ? MAGIC_BY_ID[id] : null;
      if (id === 'bolt' && typeof findNearestEnemy === 'function'
        && !findNearestEnemy(state.player.x, state.player.y, 520)) return 'notarget';
      if (magic && state.player && state.player.aether < minCostOf(magic)) return 'aether';
      return 'other';
    }

    var wrappedCast = function (slot, loud) {
      var id = slotCardId(slot);
      var ok = origCast.call(this, slot, loud);
      try {
        if (ok) {
          emitCast(id);
          castCard(id);
        } else if (id) {
          denyCard(id, failReason(id));
        }
      } catch (err) { /* 演出失败绝不能影响施法 */ }
      return ok;
    };

    var wrappedUpdate = function () {
      var r = origUpdate.apply(this, arguments);
      try { refreshCards(); } catch (err) {}
      return r;
    };

    var wrappedDamage = function (enemy, amount, dirAway, meta) {
      var r = origDamage.apply(this, arguments);
      try {
        if (meta && meta.abilityId && amount > 0 && enemy) {
          emitHit(meta.abilityId, enemy.x, enemy.y, dirAway);
        }
      } catch (err) {}
      return r;
    };

    castSlot = wrappedCast;
    updateDeckCooldowns = wrappedUpdate;
    damageEnemy = wrappedDamage;
    hooks = {
      cast: wrappedCast, update: wrappedUpdate, damage: wrappedDamage,
      origCast: origCast, origUpdate: origUpdate, origDamage: origDamage
    };
    return true;
  }

  /**
   * 卸载包装，恢复主文件原函数
   */
  function uninstallGameHooks() {
    if (!hooks) return;
    castSlot = hooks.origCast;
    updateDeckCooldowns = hooks.origUpdate;
    damageEnemy = hooks.origDamage;
    hooks = null;
  }

  /**
   * 当前这一按会打到哪些卡（并联回路会同时打主 + 副）
   */
  function activeSlotIds() {
    var d = state && state.dual;
    if (typeof DUAL_CONFIG !== 'undefined' && DUAL_CONFIG.enabled !== false && d && d.slots) {
      var ids = [];
      if (d.slots[0]) ids.push(d.slots[0]);
      if (d.slots[1]) ids.push(d.slots[1]);
      return ids;
    }
    return state && state.activeMagicId ? [state.activeMagicId] : [];
  }

  function onKeyDown(event) {
    if (!NS.enabled || typeof state === 'undefined' || !state) return;
    if (state.mode !== 'playing' || state.status !== 'playing') return;
    var action = (typeof keyToAction === 'function') ? keyToAction(event) : null;
    if (action === 'primary') {
      var ids = activeSlotIds();
      for (var i = 0; i < ids.length; i += 1) pressCard(ids[i]);
    } else if (action && action.indexOf('magic') === 0) {
      var idx = Number(action.slice(5)) - 1;
      var card = document.querySelectorAll('.mini-card[data-magic-id]')[idx];
      if (card) flashClass(card, 'sfx-press', 150);
    }
  }

  function onPointerDown(event) {
    if (!NS.enabled || typeof state === 'undefined' || !state) return;
    if (state.mode !== 'playing' || state.status !== 'playing') return;
    var t = event.target;
    if (!t || !t.closest || !t.closest('canvas')) return;
    if (typeof event.button === 'number' && event.button !== 0) return;
    var ids2 = activeSlotIds();
    for (var i = 0; i < ids2.length; i += 1) pressCard(ids2[i]);
  }

  function installInput() {
    if (listenersOn) return;
    global.addEventListener('keydown', onKeyDown, true);
    global.addEventListener('pointerdown', onPointerDown, true);
    listenersOn = true;
  }
  function uninstallInput() {
    if (!listenersOn) return;
    global.removeEventListener('keydown', onKeyDown, true);
    global.removeEventListener('pointerdown', onPointerDown, true);
    listenersOn = false;
  }

  /**
   * 开启补丁（幂等）
   * @returns {boolean} 是否开启
   */
  function apply() {
    if (NS.disabledByQuery) return false;
    if (NS.enabled) return true;
    if (!world) bindGameWorld();
    if (!world) {
      if (global.console && console.warn) console.warn('[SKILLFX] 找不到渲染后端，请先加载游戏或 bindSandbox()');
      return false;
    }
    document.body.classList.add('skillfx');
    if (typeof state !== 'undefined' && state && state.performanceMode) {
      document.body.classList.add('is-lowfx');
    }
    if (world.kind === 'game') installGameHooks();
    installInput();
    refreshCards();
    NS.enabled = true;
    return true;
  }

  /**
   * 关闭补丁（幂等）：恢复原函数、移除类名与监听
   */
  function revert() {
    if (!NS.enabled) return false;
    uninstallGameHooks();
    uninstallInput();
    document.body.classList.remove('skillfx');
    document.body.classList.remove('is-lowfx');
    var cards = document.querySelectorAll('.mini-card');
    for (var i = 0; i < cards.length; i += 1) {
      cards[i].classList.remove('sfx-press', 'sfx-casting', 'sfx-cooling',
        'sfx-aether', 'sfx-usable', 'sfx-ready', 'sfx-coolstart', 'sfx-denied');
      cards[i].style.removeProperty('--sfx-c');
      cards[i].style.removeProperty('--sfx-c-soft');
      cards[i].style.removeProperty('--sfx-line');
      cards[i].style.removeProperty('--sfx-cda');
      cards[i].style.removeProperty('--sfx-cd');
      delete cards[i].__sfxCda;
    }
    prevCd = {};
    cardColorCache = {};
    world = null;
    NS.enabled = false;
    return true;
  }

  NS.apply = apply;
  NS.revert = revert;
  NS.bindGameWorld = bindGameWorld;
  NS.isEnabled = function () { return !!NS.enabled; };
  NS.backend = function () { return world ? world.kind : null; };

  /* 被直接引入且主文件已在运行时，自动挂载；预览页会先 bindSandbox 再手动 apply */
  if (!NS.disabledByQuery && typeof document !== 'undefined') {
    var auto = function () {
      if (NS.enabled) return;
      if (typeof state !== 'undefined' && state && typeof addRing === 'function') apply();
    };
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      setTimeout(auto, 0);
    } else {
      global.addEventListener('load', function () { setTimeout(auto, 0); });
    }
  }
})(window);
