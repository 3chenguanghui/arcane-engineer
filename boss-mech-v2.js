/* ============================================================================
 * 《烬》首领机制 V2 · 可粘贴补丁（不改主文件）
 * ----------------------------------------------------------------------------
 * 目的：让一局 5 层的 5 场首领不再是"同一只变大变厚"。
 *
 * 一句话钉死：这一版 F1–F5 的差异来自机制轮转，不来自首领身份。
 * 身份仍按大区锁（机械熔炉就该是机械的），改身份是内容工程，不在本轮范围。
 *
 * 机制分配：
 *   机械暴君：F1/F3/F5 = 液压合拢 press，F2/F4 = 熔核火柱 beam（逐层交替）
 *   符文织者：F7 起 = 刻印按序 sigilOrder
 *   虚空噬主：F13 起 = 引力潮汐 gravityTide
 *
 * 硬约束：
 *   1) 不新建调度器：所有计时器都挂在 boss.v2 上，由 updateBossEnemy 每帧推进。
 *   2) 不申请 S0/S1/S2 演出分级，不复用 addBurst 做整屏演出；只用 addRing 做局部反馈。
 *   3) 四个机制各自独立开关，任何一个关掉，其余三个照常工作。
 *   4) 总闸 ?bossmech2=off 可整包关闭，行为完全回到旧版。
 *
 * 接入位置（详见 boss-mech-v2.md）：
 *   spawnBoss() 末尾            : boss.v2 = BOSS_MECH_V2.attach(boss, floorNumber);
 *   updateBossEnemy() 正常战斗段 : BOSS_MECH_V2.tick(boss, dt);
 *   drawBossHazards() 末尾      : BOSS_MECH_V2.draw(ctx, boss, state.elapsed);
 * ========================================================================== */
(function () {
  'use strict';

  /* -------------------------------------------------------------------------
   * 配置区（全部可调；关掉一项不会影响其他三项）
   * ---------------------------------------------------------------------- */
  var CONFIG = {
    version: 'boss-mech-v2',
    enabled: true,          // 总闸（?bossmech2=off 也会置 false）
    /* 四个独立开关：关掉一个只影响自己这一场 */
    on: {
      press: true,          // M1 液压合拢
      beam: true,           // M2 熔核火柱
      sigilOrder: true,     // M3 刻印按序
      gravityTide: true     // M4 引力潮汐
    },
    press: {
      period: 9.5,          // 两次合拢间隔（秒）——想降难度就拉长这个数
      tell: 0.9,            // 预警时间，≥0.55s
      damage: 16,           // 被夹到的伤害
      gapW: 88,             // 安全缝宽度（像素）
      pad: 46               // 墙离房间边缘的留白
    },
    beam: {
      period: 10.5,
      tell: 0.9,
      sweep: 2.4,           // 火柱横扫持续时间
      arc: 2.0,             // 横扫角度（弧度，约 115°）
      damage: 14,
      width: 22,            // 火柱半宽（像素）
      hitCd: 0.55           // 同一玩家两次灼烧的最短间隔
    },
    sigilOrder: {
      period: 11,
      firstDelay: 0.8,      // 第 1 枚刻印的点亮预警
      window: 0.75,         // 每枚的容错窗口
      count: 3,
      radius: 38,
      damage: 18,
      reach: 44             // 玩家中心距刻印中心多远算"踩中"
    },
    gravityTide: {
      period: 7,            // 一个完整周期
      tell: 0.8,            // 翻转前预警
      strength: 118,        // 吸/推速度（像素/秒）
      radius: 230           // 引力场显示半径
    }
  };

  /* 总闸：URL 参数 ?bossmech2=off */
  try {
    if (typeof location !== 'undefined' && /[?&]bossmech2=off(?:&|$)/.test(location.search)) {
      CONFIG.enabled = false;
    }
  } catch (e) { /* 非浏览器环境忽略 */ }

  /* -------------------------------------------------------------------------
   * 环境适配层：主文件直接用游戏全局；演示页用 setEnv 注入自己的实现
   * ---------------------------------------------------------------------- */
  var ENV = null;

  /**
   * 默认环境：把补丁要用的少数几个游戏全局包起来。
   * 全部用 typeof 判断，缺任何一项都不会让整包崩掉。
   * @returns {Object} 环境对象
   */
  function defaultEnv() {
    var g = (typeof window !== 'undefined') ? window : {};
    return {
      player: function () { return g.state ? g.state.player : null; },
      room: function (boss) {
        return (g.state && g.state.rooms) ? g.state.rooms[boss.roomId] : null;
      },
      damagePlayer: function (amount, x, y, cause) {
        if (typeof g.damagePlayer === 'function') g.damagePlayer(amount, x, y, cause);
      },
      addRing: function (x, y, r, color, grow, life, shape) {
        if (typeof g.addRing === 'function') g.addRing(x, y, r, color, grow, life, shape);
      },
      shake: function (mag, dur) {
        if (typeof g.triggerShake === 'function') g.triggerShake(mag, dur);
      },
      playSfx: function (name, vol) {
        if (typeof g.playSfx === 'function') g.playSfx(name, vol);
      },
      walkable: function (x, y, r) {
        return (typeof g.isWalkableCircle === 'function') ? g.isWalkableCircle(x, y, r) : true;
      }
    };
  }

  /**
   * 取环境（第一次访问时惰性构建，避免脚本加载顺序问题）
   * @returns {Object} 环境对象
   */
  function env() { return ENV || (ENV = defaultEnv()); }

  /**
   * 演示页注入自定义环境
   * @param {Object} e 环境对象（可只覆盖部分字段）
   * @returns {void}
   */
  function setEnv(e) {
    ENV = Object.assign(defaultEnv(), e || {});
  }

  /* -------------------------------------------------------------------------
   * 机制分配（与模拟器 tools/sim_panel/sim.js 的 pickBossMech2 同源）
   * ---------------------------------------------------------------------- */
  /**
   * 按层数 + 首领身份决定这一场挂哪个机制。
   * 机械：奇数次层合拢、偶数次层火柱；符文 F7+；虚空 F13+。
   * @param {number} floor 层数
   * @param {string} kind 首领身份（mech/rune/void）
   * @returns {string|null} 机制 id
   */
  function mechOf(floor, kind) {
    var f = Math.max(1, Number(floor) || 1);
    if (kind === 'mech') return (f % 2 === 1) ? 'press' : 'beam';
    if (kind === 'rune') return f >= 7 ? 'sigilOrder' : null;
    if (kind === 'void') return f >= 13 ? 'gravityTide' : null;
    return null;
  }

  /**
   * 给首领挂上本场机制状态（由 spawnBoss 调用）
   * @param {Object} boss 首领实体
   * @param {number} floor 层数
   * @returns {Object} boss.v2 运行时状态
   */
  function attach(boss, floor) {
    var id = CONFIG.enabled ? mechOf(floor, boss.bossKind) : null;
    // 该机制单独被关掉时，本场就退化为旧版首领——不会牵连其他机制
    if (id && !CONFIG.on[id]) id = null;
    boss.v2 = {
      mech: id,
      phase: 'idle',
      timer: id === 'gravityTide' ? 2.6 : 3.8,  // 开场先给玩家 3.8 秒喘息
      data: null,
      hitCd: 0,
      index: 0,
      sigils: null
    };
    return boss.v2;
  }

  /**
   * 每帧推进本场机制（由 updateBossEnemy 在正常战斗阶段调用）
   * @param {Object} boss 首领实体
   * @param {number} dt 帧时长（秒）
   * @returns {void}
   */
  function tick(boss, dt) {
    if (!CONFIG.enabled || !boss || !boss.v2 || !boss.v2.mech) return;
    var v2 = boss.v2;
    v2.hitCd = Math.max(0, v2.hitCd - dt);
    if (v2.mech === 'press') tickPress(boss, v2, dt);
    else if (v2.mech === 'beam') tickBeam(boss, v2, dt);
    else if (v2.mech === 'sigilOrder') tickSigil(boss, v2, dt);
    else if (v2.mech === 'gravityTide') tickTide(boss, v2, dt);
  }

  /* -------------------------------------------------------------------------
   * M1 液压合拢
   * ---------------------------------------------------------------------- */
  /**
   * 推进液压合拢：待机 → 0.9s 预警 → 合拢判定 → 重新计时
   * @param {Object} boss 首领
   * @param {Object} v2 机制状态
   * @param {number} dt 帧时长
   * @returns {void}
   */
  function tickPress(boss, v2, dt) {
    if (!CONFIG.on.press) return;              // 独立开关：只关自己
    var C = CONFIG.press;
    v2.timer -= dt;
    if (v2.phase === 'idle' && v2.timer <= 0) {
      var room = env().room(boss) || { cx: boss.x, cy: boss.y, w: 420, h: 320 };
      var vertical = Math.random() < 0.5;   // true=左右墙向中间夹（缺缝沿 Y）
      var minX = room.cx - room.w / 2 + C.pad;
      var maxX = room.cx + room.w / 2 - C.pad;
      var minY = room.cy - room.h / 2 + C.pad;
      var maxY = room.cy + room.h / 2 - C.pad;
      v2.data = {
        vertical: vertical,
        gap: vertical
          ? minY + Math.random() * Math.max(1, maxY - minY)   // 缝在 Y 轴上的位置
          : minX + Math.random() * Math.max(1, maxX - minX),  // 缝在 X 轴上的位置
        minX: minX, maxX: maxX, minY: minY, maxY: maxY
      };
      v2.phase = 'tell';
      v2.timer = C.tell;
      env().playSfx('bolt', 0.5);
    } else if (v2.phase === 'tell' && v2.timer <= 0) {
      resolvePress(boss, v2);
      v2.phase = 'idle';
      v2.timer = C.period;
      v2.data = null;
    }
  }

  /**
   * 合拢判定：玩家不在安全缝里就吃伤害 + 震屏
   * @param {Object} boss 首领
   * @param {Object} v2 机制状态
   * @returns {void}
   */
  function resolvePress(boss, v2) {
    var C = CONFIG.press;
    var p = env().player();
    var d = v2.data;
    if (!p || !d) return;
    var inGap = d.vertical
      ? Math.abs(p.y - d.gap) <= C.gapW / 2
      : Math.abs(p.x - d.gap) <= C.gapW / 2;
    // 预警线/墙体本身由 draw() 负责，这里只做判定
    if (!inGap) {
      env().damagePlayer(C.damage, boss.x, boss.y, {
        kind: 'hazard', name: boss.name || '首领', bossKind: boss.bossKind
      });
      env().shake(8, 0.28);
      env().playSfx('bolt', 0.8);
    } else {
      env().addRing(p.x, p.y, 18, 'rgba(120, 255, 190, 0.7)', 26, 0.3, 'glow');
    }
  }

  /* -------------------------------------------------------------------------
   * M2 熔核火柱
   * ---------------------------------------------------------------------- */
  /**
   * 推进火柱：锁定方向预警 0.9s → 2.4s 横扫 → 重新计时
   * @param {Object} boss 首领
   * @param {Object} v2 机制状态
   * @param {number} dt 帧时长
   * @returns {void}
   */
  function tickBeam(boss, v2, dt) {
    if (!CONFIG.on.beam) return;
    var C = CONFIG.beam;
    v2.timer -= dt;
    if (v2.phase === 'idle' && v2.timer <= 0) {
      var p = env().player();
      var aim = p ? Math.atan2(p.y - boss.y, p.x - boss.x) : boss.facing || 0;
      v2.data = { aim: aim, a: aim - C.arc / 2, elapsed: 0 };
      v2.phase = 'tell';
      v2.timer = C.tell;
      env().playSfx('bolt', 0.55);
    } else if (v2.phase === 'tell') {
      if (v2.timer <= 0) {
        v2.phase = 'sweep';
        v2.timer = C.sweep;
        v2.data.elapsed = 0;
      }
    } else if (v2.phase === 'sweep') {
      v2.data.elapsed += dt;
      v2.data.a = v2.data.aim - C.arc / 2 + C.arc * (v2.data.elapsed / C.sweep);
      hitByBeam(boss, v2);
      if (v2.timer <= 0) {
        v2.phase = 'idle';
        v2.timer = C.period;
        v2.data = null;
      }
    }
  }

  /**
   * 火柱命中判定：玩家到射线距离小于半宽就算被灼烧（带 0.55s 冷却）
   * @param {Object} boss 首领
   * @param {Object} v2 机制状态
   * @returns {void}
   */
  function hitByBeam(boss, v2) {
    if (v2.hitCd > 0) return;
    var C = CONFIG.beam;
    var p = env().player();
    if (!p) return;
    var dx = p.x - boss.x;
    var dy = p.y - boss.y;
    var dist = Math.hypot(dx, dy);
    if (dist < boss.radius) return;
    var ang = Math.atan2(dy, dx);
    var diff = Math.abs(((ang - v2.data.a + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    var perp = Math.abs(Math.sin(diff)) * dist;   // 到射线的垂直距离
    if (perp <= C.width) {
      env().damagePlayer(C.damage, boss.x, boss.y, {
        kind: 'hazard', name: boss.name || '首领', bossKind: boss.bossKind
      });
      v2.hitCd = C.hitCd;
      env().shake(5, 0.2);
      env().playSfx('bolt', 0.6);
    }
  }

  /* -------------------------------------------------------------------------
   * M3 刻印按序
   * ---------------------------------------------------------------------- */
  /**
   * 推进刻印：每隔一段时间生成 1→2→3 三枚刻印，按顺序踩才安全
   * @param {Object} boss 首领
   * @param {Object} v2 机制状态
   * @param {number} dt 帧时长
   * @returns {void}
   */
  function tickSigil(boss, v2, dt) {
    if (!CONFIG.on.sigilOrder) return;
    var C = CONFIG.sigilOrder;
    var p = env().player();
    if (!p) return;

    if (v2.phase === 'idle') {
      v2.timer -= dt;
      if (v2.timer > 0) return;
      var room = env().room(boss) || { cx: boss.x, cy: boss.y, w: 420, h: 320 };
      var sigils = [];
      for (var i = 0; i < C.count; i += 1) {
        var a = Math.PI * 2 * (i / C.count) + Math.random() * 0.7;
        var rr = 96 + Math.random() * 46;
        var sx = Math.max(room.cx - room.w / 2 + 40, Math.min(room.cx + room.w / 2 - 40,
          p.x + Math.cos(a) * rr));
        var sy = Math.max(room.cy - room.h / 2 + 40, Math.min(room.cy + room.h / 2 - 40,
          p.y + Math.sin(a) * rr));
        sigils.push({ x: sx, y: sy, state: i === 0 ? 'armed' : 'wait', flash: 0 });
      }
      v2.sigils = sigils;
      v2.index = 0;
      v2.phase = 'run';
      v2.timer = C.firstDelay;
      env().playSfx('bolt', 0.45);
      return;
    }

    if (v2.phase !== 'run') return;
    v2.timer -= dt;
    var cur = v2.sigils[v2.index];
    if (!cur) { v2.phase = 'idle'; v2.timer = C.period; return; }

    // 踩错：站到还没轮到的刻印上 → 提前引爆它
    for (var j = 0; j < v2.sigils.length; j += 1) {
      var s = v2.sigils[j];
      if (s.state === 'wait' && Math.hypot(p.x - s.x, p.y - s.y) <= C.reach) {
        detonateSigil(boss, v2, s);
        s.state = 'bad';
        s.flash = 0.35;
        env().shake(7, 0.22);
        return;
      }
    }

    // 踩对：站进当前刻印 → 过关，点亮下一枚
    if (Math.hypot(p.x - cur.x, p.y - cur.y) <= C.reach) {
      cur.state = 'ok';
      v2.index += 1;
      var next = v2.sigils[v2.index];
      if (next) { next.state = 'armed'; v2.timer = C.window; }
      else {
        env().addRing(cur.x, cur.y, C.radius, 'rgba(130, 255, 200, 0.8)', 52, 0.5, 'glow');
        v2.phase = 'idle';
        v2.timer = C.period;
      }
      return;
    }

    // 超时：当前刻印原地引爆，然后顺延到下一枚
    if (v2.timer <= 0) {
      detonateSigil(boss, v2, cur);
      cur.state = 'bad';
      cur.flash = 0.35;
      v2.index += 1;
      var nxt = v2.sigils[v2.index];
      if (nxt) { nxt.state = 'armed'; v2.timer = C.window; }
      else { v2.phase = 'idle'; v2.timer = C.period; }
    }
  }

  /**
   * 引爆一枚刻印：站在圈内才吃伤害
   * @param {Object} boss 首领
   * @param {Object} v2 机制状态
   * @param {Object} s 刻印
   * @returns {void}
   */
  function detonateSigil(boss, v2, s) {
    var C = CONFIG.sigilOrder;
    var p = env().player();
    env().addRing(s.x, s.y, C.radius, 'rgba(190, 120, 255, 0.85)', 90, 0.4, 'shockwave');
    if (p && Math.hypot(p.x - s.x, p.y - s.y) <= C.radius) {
      env().damagePlayer(C.damage, s.x, s.y, {
        kind: 'hazard', name: boss.name || '首领', bossKind: boss.bossKind
      });
    }
    env().shake(6, 0.2);
    env().playSfx('bolt', 0.7);
  }

  /* -------------------------------------------------------------------------
   * M4 引力潮汐
   * ---------------------------------------------------------------------- */
  /**
   * 推进引力潮汐：每半周期翻转一次吸/推，翻转前 0.8s 预警
   * @param {Object} boss 首领
   * @param {Object} v2 机制状态
   * @param {number} dt 帧时长
   * @returns {void}
   */
  function tickTide(boss, v2, dt) {
    if (!CONFIG.on.gravityTide) return;
    var C = CONFIG.gravityTide;
    var half = C.period / 2;
    if (!v2.data) v2.data = { sign: -1, warn: false };  // -1 吸，+1 推
    v2.timer -= dt;
    v2.data.warn = v2.timer <= C.tell && v2.timer > 0;

    if (v2.timer <= 0) {
      v2.data.sign = -v2.data.sign;
      v2.timer = half;
      env().addRing(boss.x, boss.y, C.radius, v2.data.sign < 0
        ? 'rgba(110, 230, 255, 0.55)' : 'rgba(190, 130, 255, 0.55)', 40, 0.5, 'shockwave');
      env().playSfx('bolt', 0.45);
    }

    var p = env().player();
    if (!p) return;
    var dx = p.x - boss.x;
    var dy = p.y - boss.y;
    var dist = Math.hypot(dx, dy) || 1;
    if (dist > C.radius) return;                        // 场外不生效
    var step = C.strength * v2.data.sign * dt / dist;   // 归一化方向
    var nx = p.x + dx * step;
    var ny = p.y + dy * step;
    if (env().walkable(nx, ny, p.radius || 10)) {
      p.x = nx;
      p.y = ny;
    }
  }

  /* -------------------------------------------------------------------------
   * 绘制（由 drawBossHazards 末尾调用，世界坐标）
   * ---------------------------------------------------------------------- */
  /**
   * 画本场机制的预警/形状/数字，保证第一次见也能看懂
   * @param {CanvasRenderingContext2D} ctx 画布上下文
   * @param {Object} boss 首领实体
   * @param {number} t 全局时间（秒）
   * @returns {void}
   */
  function draw(ctx, boss, t) {
    if (!CONFIG.enabled || !boss || !boss.v2 || !boss.v2.mech) return;
    var v2 = boss.v2;
    if (v2.mech === 'press') drawPress(ctx, boss, v2, t);
    else if (v2.mech === 'beam') drawBeam(ctx, boss, v2, t);
    else if (v2.mech === 'sigilOrder') drawSigil(ctx, boss, v2, t);
    else if (v2.mech === 'gravityTide') drawTide(ctx, boss, v2, t);
  }

  /**
   * 画液压合拢：琥珀色双墙 + 安全缝高亮
   * @param {CanvasRenderingContext2D} ctx 上下文
   * @param {Object} boss 首领
   * @param {Object} v2 机制状态
   * @param {number} t 时间
   * @returns {void}
   */
  function drawPress(ctx, boss, v2, t) {
    var d = v2.data;
    if (!d) return;
    var C = CONFIG.press;
    var k = 1 - Math.max(0, v2.timer) / C.tell;   // 0→1 合拢进度
    var pulse = 0.55 + Math.sin(t * 18) * 0.25;
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 178, 70, ' + (0.35 + k * 0.5).toFixed(3) + ')';
    ctx.fillStyle = 'rgba(255, 150, 40, ' + (0.06 + k * 0.16).toFixed(3) + ')';
    ctx.lineWidth = 3;
    if (d.vertical) {
      var y0 = d.minY, y1 = d.maxY;
      var h1 = d.gap - C.gapW / 2, h2 = d.gap + C.gapW / 2;
      // 两段墙从两侧向缝收拢
      ctx.fillRect(d.minX, y0, (d.maxX - d.minX), Math.max(0, h1 - y0));
      ctx.fillRect(d.minX, h2, (d.maxX - d.minX), Math.max(0, y1 - h2));
      ctx.strokeRect(d.minX, y0, (d.maxX - d.minX), Math.max(0, h1 - y0));
      ctx.strokeRect(d.minX, h2, (d.maxX - d.minX), Math.max(0, y1 - h2));
      // 安全缝
      ctx.strokeStyle = 'rgba(120, 255, 190, ' + pulse.toFixed(3) + ')';
      ctx.beginPath();
      ctx.moveTo(d.minX, d.gap);
      ctx.lineTo(d.maxX, d.gap);
      ctx.stroke();
    } else {
      var x1 = d.gap - C.gapW / 2, x2 = d.gap + C.gapW / 2;
      ctx.fillRect(d.minX, d.minY, Math.max(0, x1 - d.minX), (d.maxY - d.minY));
      ctx.fillRect(x2, d.minY, Math.max(0, d.maxX - x2), (d.maxY - d.minY));
      ctx.strokeRect(d.minX, d.minY, Math.max(0, x1 - d.minX), (d.maxY - d.minY));
      ctx.strokeRect(x2, d.minY, Math.max(0, d.maxX - x2), (d.maxY - d.minY));
      ctx.strokeStyle = 'rgba(120, 255, 190, ' + pulse.toFixed(3) + ')';
      ctx.beginPath();
      ctx.moveTo(d.gap, d.minY);
      ctx.lineTo(d.gap, d.maxY);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * 画熔核火柱：预警细线 → 扫过时的橙红柱体
   * @param {CanvasRenderingContext2D} ctx 上下文
   * @param {Object} boss 首领
   * @param {Object} v2 机制状态
   * @param {number} t 时间
   * @returns {void}
   */
  function drawBeam(ctx, boss, v2, t) {
    var d = v2.data;
    if (!d) return;
    var C = CONFIG.beam;
    var len = 720;
    var isSweep = v2.phase === 'sweep';
    var k = 1 - Math.max(0, v2.timer) / C.tell;
    ctx.save();
    ctx.translate(boss.x, boss.y);
    ctx.rotate(d.a);
    if (isSweep) {
      var g = ctx.createLinearGradient(0, 0, len, 0);
      g.addColorStop(0, 'rgba(255, 120, 60, 0.85)');
      g.addColorStop(1, 'rgba(255, 60, 40, 0.15)');
      ctx.fillStyle = g;
      ctx.fillRect(boss.radius, -C.width, len, C.width * 2);
      ctx.strokeStyle = 'rgba(255, 220, 150, ' + (0.7 + Math.sin(t * 22) * 0.2).toFixed(3) + ')';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(boss.radius, 0);
      ctx.lineTo(len, 0);
      ctx.stroke();
    } else {
      ctx.strokeStyle = 'rgba(255, 140, 70, ' + (0.3 + k * 0.6).toFixed(3) + ')';
      ctx.setLineDash([12, 10]);
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(boss.radius, 0);
      ctx.lineTo(len, 0);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  /**
   * 画刻印：紫青双色环 + 顺序数字，当前枚脉动、踩对变绿、踩错变红
   * @param {CanvasRenderingContext2D} ctx 上下文
   * @param {Object} boss 首领
   * @param {Object} v2 机制状态
   * @param {number} t 时间
   * @returns {void}
   */
  function drawSigil(ctx, boss, v2, t) {
    if (!v2.sigils) return;
    var C = CONFIG.sigilOrder;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    v2.sigils.forEach(function (s, i) {
      var color = s.state === 'ok' ? '140, 255, 190'
        : s.state === 'bad' ? '255, 90, 110'
        : s.state === 'armed' ? '190, 130, 255' : '110, 190, 255';
      var pulse = s.state === 'armed' ? (0.55 + Math.sin(t * 12) * 0.3) : 0.35;
      ctx.strokeStyle = 'rgba(' + color + ',' + pulse.toFixed(3) + ')';
      ctx.lineWidth = s.state === 'armed' ? 3 : 2;
      ctx.beginPath();
      ctx.arc(s.x, s.y, C.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(' + color + ',' + (s.state === 'armed' ? 0.16 : 0.06) + ')';
      ctx.beginPath();
      ctx.arc(s.x, s.y, C.radius * 0.9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(240, 240, 255, 0.92)';
      ctx.font = '700 18px system-ui, sans-serif';
      ctx.fillText(String(i + 1), s.x, s.y);
    });
    ctx.restore();
  }

  /**
   * 画引力潮汐：青色=吸、紫色=推，翻转前 0.8s 箭头闪烁
   * @param {CanvasRenderingContext2D} ctx 上下文
   * @param {Object} boss 首领
   * @param {Object} v2 机制状态
   * @param {number} t 时间
   * @returns {void}
   */
  function drawTide(ctx, boss, v2, t) {
    var d = v2.data;
    if (!d) return;
    var C = CONFIG.gravityTide;
    var inward = d.sign < 0;
    var col = inward ? '110, 230, 255' : '190, 130, 255';
    var alpha = d.warn ? (0.5 + Math.sin(t * 20) * 0.35) : 0.42;
    ctx.save();
    ctx.strokeStyle = 'rgba(' + col + ',' + alpha.toFixed(3) + ')';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(boss.x, boss.y, C.radius, 0, Math.PI * 2);
    ctx.stroke();
    for (var i = 0; i < 8; i += 1) {
      var a = Math.PI * 2 * (i / 8) + t * (inward ? 0.6 : -0.6);
      var r0 = inward ? C.radius - 18 : C.radius + 18;
      var r1 = inward ? C.radius - 54 : C.radius + 54;
      var x0 = boss.x + Math.cos(a) * r0;
      var y0 = boss.y + Math.sin(a) * r0;
      var x1 = boss.x + Math.cos(a) * r1;
      var y1 = boss.y + Math.sin(a) * r1;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      // 箭头：向内吸时箭头朝圆心，向外推时朝外，第一次见也能看懂方向
      var dirx = Math.cos(a) * (inward ? -1 : 1);
      var diry = Math.sin(a) * (inward ? -1 : 1);
      var px = -diry;
      var py = dirx;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 - dirx * 9 + px * 5, y1 - diry * 9 + py * 5);
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 - dirx * 9 - px * 5, y1 - diry * 9 - py * 5);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x1, y1, 3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(' + col + ',' + (alpha * 0.8).toFixed(3) + ')';
      ctx.fill();
    }
    ctx.restore();
  }

  /* -------------------------------------------------------------------------
   * 导出
   * ---------------------------------------------------------------------- */
  var API = {
    CONFIG: CONFIG,
    mechOf: mechOf,
    attach: attach,
    tick: tick,
    draw: draw,
    setEnv: setEnv
  };
  if (typeof window !== 'undefined') window.BOSS_MECH_V2 = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
}());
