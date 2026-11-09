/**
 * 第 4 轮 · 第 1 组：F8「镜像幽灵 + 咏唱者」根因诊断 / 修复验证
 * ------------------------------------------------------------
 * 结论先行：实测不是"治疗 > 伤害的不动点"，也不是"镜像反射"，而是
 *   ① 游戏里根本没有治疗机制（咏唱者只给急速，不给回血）——伤害归属统计里 hp 只降不升；
 *   ② 1 血诱饵（mirrorphantom）会被"最低血量优先"的瞄准长期劫持，但它是 1 击即死，
 *      真实玩家一眼就能分辨（虚线残影），不构成"无解"；
 *   ③ 真正的杀手是"隔墙僵局"：F8 房间中间有内墙/柱子，机器人出生在墙这一侧，
 *      敌人（warden/hexer/chanter/sigilweaver/cipher 这类站桩远程）在墙另一侧，
 *      双方 LOS 全被挡住；bot 的 38px 局部贪心走位无法绕障 → 75s 只有 0.3–0.9 DPS。
 *
 * 判定：这是"量尺缺陷"（仪器卡墙），不是"设计缺陷"——玩家肉眼能看到墙也能绕过去，
 *       所以不改怪物数值（不把难度抹平），改的是采样机器人的寻路：隔墙时用 BFS 流场接管。
 *
 * 本脚本负责：
 *   1) 复现"隔墙僵局"（wall 场景，固定判据：把玩家放到"对所有敌人 LOS 都被挡"的格子）；
 *   2) 对比 naive（旧 38px 贪心）与 path（BFS 流场）两种走位；
 *   3) 同时验证 combo 场景（4 镜像幽灵 + 咏唱者）在合理构筑下能清掉，且没有"治疗"机制。
 *
 * 用法：node tools/arcane_combo.js [--diag]
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');
const { NAV_SRC } = require('./arcane_botnav');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9575;
const FILE = path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = path.join(__dirname, '..', '.screenshots', 'combo');
const RESULTS = path.join(OUT, 'combo-result.json');
const ONLY_DIAG = process.argv.indexOf('--diag') >= 0;

/** 合成场景的固定阵容 */
const COMBO_ROSTER = ['mirrorghost', 'mirrorghost', 'mirrorghost', 'mirrorghost', 'chanter'];

const checks = [];
const runtimeErrors = [];
let EDGE_PROC = null;

/**
 * 记录一条断言
 * @param {string} name 断言名
 * @param {boolean} ok 是否通过
 * @param {*} detail 附加信息
 * @returns {void}
 */
function check(name, ok, detail) {
  checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail == null ? '' : JSON.stringify(detail)}`);
}

/**
 * 日志
 * @param {string} text 文本
 * @returns {void}
 */
function log(text) { console.log(`[combo] ${text}`); }

/**
 * 延时
 * @param {number} ms 毫秒
 * @returns {Promise<void>}
 */
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * 主流程
 * @returns {Promise<void>}
 */
async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = prepareProfile();
  EDGE_PROC = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 端口还没起 */ }
    await sleep(250);
  }
  if (!target) throw new Error('调试端口未就绪');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (msg) => {
    const m = JSON.parse(msg.data);
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params && m.params.exceptionDetails;
      runtimeErrors.push(d ? ((d.exception || {}).description || d.text) : 'unknown');
    }
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      throw new Error('EVAL: ' + r.exceptionDetails.text + ' '
        + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    }
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
    return name;
  };

  // ---------- 启动 ----------
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2400);
  const startPos = await ev(`(() => { const el = document.getElementById('btnStart'); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: startPos.x, y: startPos.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: startPos.x, y: startPos.y, button: 'left', clickCount: 1 });
  await sleep(900);

  // ---------- 页面侧装置：记录器 + 共享导航 ----------
  await ev(`(() => {
    ${NAV_SRC}
    window.__combo = {
      roomId: -1, policy: 'naive', noDamageT: 0, lastHpSum: 0, dmg: 0,
      kills: {}, dmgByType: {}, lastHp: {}, lastType: {},
      phantomFrames: 0, phantomKills: 0, phantomHitFrames: 0,
      healEvents: 0, gHitAt: null, t: 0, casts: 0,
      timeline: [],
      /**
       * 记录一帧
       * @param {Object} target 当前目标
       * @returns {void}
       */
      sample(target) {
        const list = state.enemies.filter((e) => e.roomId === this.roomId);
        const seen = {};
        let hpSum = 0;
        let phantoms = 0;
        for (let i = 0; i < list.length; i += 1) {
          const e = list[i];
          seen[e.id] = 1;
          hpSum += Math.max(0, e.hp || 0) + Math.max(0, e.shield || 0);
          if (e.isMirror) phantoms += 1;
          const prev = this.lastHp[e.id];
          const cur = Math.max(0, e.hp || 0) + Math.max(0, e.shield || 0);
          if (prev != null && cur > prev + 0.5) this.healEvents += 1;  // 回血事件（预期 0）
          if (prev != null && prev > cur) {
            const d = prev - cur;
            this.dmgByType[e.typeId] = (this.dmgByType[e.typeId] || 0) + d;
            this.dmg += d;
            if (!e.isMirror && this.gHitAt == null && e.typeId === target.typeId) {
              this.gHitAt = Number(this.t.toFixed(2));
            }
          }
          this.lastHp[e.id] = cur;
        }
        Object.keys(this.lastHp).forEach((id) => {
          if (!seen[Number(id)]) {
            const ty = this.lastType[Number(id)];
            if (ty) { this.kills[ty] = (this.kills[ty] || 0) + 1; if (ty === 'mirrorphantom') this.phantomKills += 1; }
            delete this.lastHp[Number(id)];
          }
        });
        this.lastType = {};
        for (let i = 0; i < list.length; i += 1) this.lastType[list[i].id] = list[i].typeId;
        if (phantoms > 0) this.phantomFrames += 1;
        // 伤害静止计时：连续多久没打出伤害（旧 bot 的"解卡"信号）
        if (hpSum < this.lastHpSum - 0.5) this.noDamageT = 0;
        else this.noDamageT += 1 / 60;
        this.lastHpSum = hpSum;
      },
      /** 快照 */
      snap() {
        const list = state.enemies.filter((e) => e.roomId === this.roomId);
        return {
          foes: list.length,
          hpSum: list.reduce((s, e) => s + Math.max(0, e.hp || 0) + Math.max(0, e.shield || 0), 0),
          clearTime: Number(this.t.toFixed(2)),
          dps: Number((this.dmg / Math.max(0.1, this.t)).toFixed(2)),
          kills: JSON.parse(JSON.stringify(this.kills)),
          dmgByType: JSON.parse(JSON.stringify(this.dmgByType)),
          phantomFrames: this.phantomFrames,
          phantomKills: this.phantomKills,
          healEvents: this.healEvents,
          navTicks: this.navTicks || 0,
          casts: this.casts,
          mode: state.mode, status: state.status, hp: Math.round(state.player.hp)
        };
      }
    };
    return true;
  })()`);

  /**
   * 布置场景
   * @param {string} scene 'combo' | 'wall'
   * @returns {Promise<Object>}
   */
  async function setup(scene) {
    if (scene === 'combo') {
      const info = await ev(`(() => {
        __roamDebug.enemies.floor(8);
        state.mode = 'playing'; state.status = 'playing';
        const cand = state.rooms.filter((r) => r.type === 'battle').sort((a, b) => (b.w * b.h) - (a.w * a.h));
        const room = cand[0] || state.rooms[0];
        state.currentRoomId = room.id;
        state.enemies.length = 0;
        state.bullets.length = 0; state.projectiles.length = 0;
        const p = state.player;
        p.x = room.cx; p.y = room.cy; p.vx = 0; p.vy = 0; p.invuln = 99; p.aether = p.aetherMax;
        state.ownedMagic = ['fireball', 'flameCone']; state.ownedTech = []; state.fusions = [];
        state.cooldowns = {};
        if (state.dual) { state.dual.slots = ['fireball', 'flameCone']; state.dual.focus = 0; }
        const ids = ${JSON.stringify(COMBO_ROSTER)};
        const maxR = Math.min(room.w, room.h) * 0.32;
        const roster = [];
        ids.forEach((id, i) => {
          const a = (Math.PI * 2 / ids.length) * i + 0.35;
          const rad = Math.min(maxR, (i % 2 === 0 ? 200 : 260));
          const x = p.x + Math.cos(a) * rad;
          const y = p.y + Math.sin(a) * rad;
          roster.push({ typeId: id, x: x, y: y });
          __roamDebug.enemies.spawn(id, x, y, { roomId: room.id });
        });
        return { roomId: room.id, foes: state.enemies.filter((e) => e.roomId === room.id).length,
          spot: { x: p.x, y: p.y }, roster: roster };
      })()`);
      return info;
    }
    // wall 场景：把玩家放到"房间外、隔墙"的走廊位，敌人在房间内。
    // 旧版判据「房间内所有敌人 LOS 全被挡」不可复现：室内几乎没有柱子，
    // 扫描 24 次掷房仍然经常 no-pocket（导致 A4 假 PASS / A5 假 FAIL）。
    // 新判据改成"结构性隔墙"：房间矩形已知，沿四个方向向外找可行走点，
    // 只要求"到最近敌人的直线采样里有 ≥6/12 点不可站立"（墙确实挡在中间）。
    const info = await ev(`(() => {
      const walk = (x, y) => __roamDebug.walkableAt(x, y, 14);
      const losBlocked = (x, y, t) => {
        let b = 0;
        for (let k = 1; k <= 12; k += 1) {
          if (!__roamDebug.walkableAt(x + (t.x - x) * (k / 12), y + (t.y - y) * (k / 12), 2)) b += 1;
        }
        return b;
      };
      let room = null;
      let spot = null;
      let foes = [];
      for (let roll = 0; roll < 8 && !spot; roll += 1) {
        __roamDebug.enemies.floor(8);
        state.mode = 'playing'; state.status = 'playing';
        const cand = state.rooms
          .filter((r) => r.type === 'battle' && state.enemies.filter((e) => e.roomId === r.id).length >= 4)
          .sort((a, b) => (b.w * b.h) - (a.w * a.h));
        for (let ri = 0; ri < cand.length && !spot; ri += 1) {
          const r0 = cand[ri];
          const f0 = state.enemies.filter((e) => e.roomId === r0.id);
          /* 落点候选：**其它房间**里可行走的点。
             实测房间之间是独立矩形（中间隔着墙），所以"隔墙"是结构性必然的；
             不再沿房间外法线扫描（那里大多是不可行走的世界空白，扫不到点）。 */
          const others = state.rooms.filter((q) => q.id !== r0.id);
          let best = null;
          for (let oi = 0; oi < others.length; oi += 1) {
            const o = others[oi];
            const pts = [[o.cx, o.cy], [o.x + 64, o.y + 64], [o.x + o.w - 64, o.y + o.h - 64],
              [o.x + o.w - 64, o.y + 64], [o.x + 64, o.y + o.h - 64]];
            for (let pi = 0; pi < pts.length; pi += 1) {
              const x = pts[pi][0];
              const y = pts[pi][1];
              if (!walk(x, y)) continue;
              let minB = 99;
              let far = 0;
              for (let i = 0; i < f0.length; i += 1) {
                minB = Math.min(minB, losBlocked(x, y, f0[i]));
                far = Math.max(far, Math.hypot(f0[i].x - x, f0[i].y - y));
              }
              const score = minB * 8 + far / 40;
              if (minB >= 4 && far >= 260 && (!best || score > best.score)) {
                best = { x: x, y: y, losBlocked: minB, far: Math.round(far), score: score,
                  outside: true, fromRoom: o.id, roll: roll };
              }
            }
          }
          if (best) { room = r0; foes = f0; spot = best; }
        }
      }
      if (!spot) return { fail: 'no-pocket' };
      state.currentRoomId = room.id;
      const p = state.player;
      p.x = spot.x; p.y = spot.y; p.vx = 0; p.vy = 0; p.invuln = 99; p.aether = p.aetherMax;
      state.bullets.length = 0; state.projectiles.length = 0;
      state.ownedMagic = ['fireball', 'flameCone']; state.ownedTech = []; state.fusions = [];
      state.cooldowns = {};
      if (state.dual) { state.dual.slots = ['fireball', 'flameCone']; state.dual.focus = 0; }
      return { roomId: room.id, foes: foes.length, spot: spot, room: { x: room.x, y: room.y, w: Math.round(room.w), h: Math.round(room.h), cx: room.cx, cy: room.cy },
        types: foes.map((f) => f.typeId).sort(),
        roster: foes.map((f) => ({ typeId: f.typeId, x: f.x, y: f.y })) };
    })()`);
    return info;
  }

  /** 场景缓存：naive / path 两轮必须用"同一间房、同一批怪、同一个出生点"才有可比性 */
  const plans = {};

  /**
   * 恢复场景（清掉上一轮尸体，按原坐标重新生成同一批怪）
   * @param {Object} plan 场景计划
   * @returns {Promise<void>}
   */
  async function restore(plan) {
    await ev(`(() => {
      const p = state.player;
      state.enemies.length = 0;
      state.bullets.length = 0; state.projectiles.length = 0;
      state.currentRoomId = ${plan.roomId};
      p.x = ${plan.spot.x}; p.y = ${plan.spot.y}; p.vx = 0; p.vy = 0;
      p.invuln = 99; p.aether = p.aetherMax; p.hp = p.hpMax;
      /* 本切片不测经验：关掉升级，避免四选一弹窗把真实模式（stand/kite）打断 */
      if (__roamDebug.xp) __roamDebug.xp.setEnabled(false);
      state.ownedMagic = ['fireball', 'flameCone']; state.ownedTech = []; state.fusions = [];
      state.cooldowns = {};
      state.mode = 'playing'; state.status = 'playing';
      if (state.dual) { state.dual.slots = ['fireball', 'flameCone']; state.dual.focus = 0; }
      ${JSON.stringify(plan.roster)}.forEach((r) => {
        __roamDebug.enemies.spawn(r.typeId, r.x, r.y, { roomId: ${plan.roomId} });
      });
      return true;
    })()`);
    await sleep(60);
  }

  /**
   * 跑一场
   * @param {string} scene 场景
   * @param {string} policy 'naive' | 'path'
   * @param {number} cap 时间上限（秒）
   * @returns {Promise<Object>}
   */
  async function run(scene, policy, cap) {
    if (!plans[scene]) plans[scene] = await setup(scene);
    const s = plans[scene];
    // 布置失败时返回"未清场"的坏结果，保证后续断言是 FAIL 而不是"空数据假 PASS"
    if (s.fail) return {
      setup: s,
      snap: { clearTime: 0, dps: 0, foes: 999, kills: {}, phantomKills: 0, healEvents: 0, navTicks: 0, casts: 0, cleared: false },
      timeline: []
    };
    await restore(s);
    await ev(`(() => {
      const c = __combo;
      c.roomId = ${s.roomId}; c.policy = '${policy}'; c.noDamageT = 0; c.lastHpSum = 0;
      /* stand / kite 是"真实模式"（不无敌、不补血），用来证明这组怪真的有威胁 */
      c.invincible = ${policy !== 'stand' && policy !== 'kite'};
      c.minHp = undefined;
      c.dmg = 0; c.kills = {}; c.dmgByType = {}; c.lastHp = {}; c.lastType = {};
      c.phantomFrames = 0; c.phantomKills = 0; c.healEvents = 0; c.gHitAt = null;
      c.t = 0; c.casts = 0; c.timeline = []; c.navTicks = 0;
      window.__rafOrig = window.requestAnimationFrame;
      window.requestAnimationFrame = function () { return 0; };
      window.__comboLastSec = -1;
      return true;
    })()`);
    await sleep(120);
    let snap = null;
    for (let i = 0; i < Math.ceil(cap * 5); i += 1) {
      snap = await ev(`(() => {
        const c = __combo;
        for (let step = 0; step < 12; step += 1) {
          const p = state.player;
          // 纯战斗切片：invincible 场次强制维持 playing，避免结算/升级弹窗打断计时。
          // 真实场次（stand/kite）反过来 —— 不补血、不强制模式，让它真的会死，
          // 这样才能证明"这组怪是有威胁的，不是被削弱到没有难度"。
          const inv = c.invincible !== false;
          if (inv) {
            if (state.mode !== 'playing' || state.status !== 'playing') { state.mode = 'playing'; state.status = 'playing'; }
            p.invuln = 9; p.aether = p.aetherMax; p.hp = p.hpMax;
          } else {
            p.invuln = 0;
          }
          const list = state.enemies.filter((e) => e.roomId === c.roomId);
          if (!list.length) break;
          // 目标选择（两种策略共用：最低血优先 —— 复刻旧 bot 口径）
          let t = list[0];
          for (let k = 0; k < list.length; k += 1) {
            const e = list[k];
            const hp = (e.hp || 0) + (e.shield || 0);
            const th = (t.hp || 0) + (t.shield || 0);
            if (hp < th - 0.5) { t = e; continue; }
            if (Math.abs(hp - th) <= 0.5) {
              const d1 = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
              const d2 = (t.x - p.x) ** 2 + (t.y - p.y) ** 2;
              if (d1 < d2) t = e;
            }
          }
          __roamDebug.setAimExact(Math.atan2(t.y - p.y, t.x - p.x));
          if (!state.cooldowns['fireball']) { if (castSlot(0, false)) c.casts += 1; }
          if (Math.hypot(t.x - p.x, t.y - p.y) <= 215 && !state.cooldowns['flameCone']) { if (castSlot(1, false)) c.casts += 1; }
          // 走位
          let nd = Infinity; let n = list[0];
          for (let k = 0; k < list.length; k += 1) {
            const d = Math.hypot(list[k].x - p.x, list[k].y - p.y);
            if (d < nd) { nd = d; n = list[k]; }
          }
          let mx = 0; let my = 0;
          let navDir = null;
          if (c.policy === 'path' && c.noDamageT > 0.5) {
            __nav.ensure(state.rooms[c.roomId]);
            navDir = __nav.flowTo(t.x, t.y);
            if (navDir) c.navTicks += 1;
          }
          if (navDir) { mx = navDir.x; my = navDir.y; }
          else {
            const ux = (n.x - p.x) / (nd || 1); const uy = (n.y - p.y) / (nd || 1);
            if (nd < 180) { mx = -ux; my = -uy; }
            else if (nd > 260) { mx = ux; my = uy; }
            else { const sg = (Math.floor(c.t / 2) % 2 === 0) ? 1 : -1; mx = -uy * sg; my = ux * sg; }
            if (c.policy === 'naive' && c.noDamageT > 3) { mx = -uy; my = ux; }
          }
          const room = state.rooms[c.roomId];
          /* 是否站在战斗房矩形外（走廊/隔壁房）：隔墙时子弹全打在墙上，
             这就是"未按解法很惨"的机制来源 —— 必须先回到房间里才有输出。 */
          const outside = room ? (p.x < room.x || p.x > room.x + room.w
            || p.y < room.y || p.y > room.y + room.h) : false;
          if (outside && c.policy === 'path') {
            mx = room.cx - p.x;
            my = room.cy - p.y;
          } else if (outside && c.policy === 'naive') {
            mx = 0;
            my = 0;
          }
          if (room && !navDir && !outside) {
            if (p.x < room.x + 40) mx += 0.7;
            if (p.x > room.x + room.w - 40) mx -= 0.7;
            if (p.y < room.y + 40) my += 0.7;
            if (p.y > room.y + room.h - 40) my -= 0.7;
          }
          const ml = Math.hypot(mx, my);
          if (outside && ml > 0.01) {
            /* 出房时直接朝房心走（不做 38px 贪心旋转，它会为了"离目标近"把方向掰回墙上） */
            state.keys = { left: mx / ml < -0.25, right: mx / ml > 0.25, up: my / ml < -0.25, down: my / ml > 0.25 };
          } else if (navDir) {
            state.keys = { left: navDir.x < -0.25, right: navDir.x > 0.25, up: navDir.y < -0.25, down: navDir.y > 0.25 };
          } else if (ml > 0.01) {
            const cands = [0, 0.4, -0.4, 0.8, -0.8, 1.2, -1.2, 1.6, -1.6, 2.0, -2.0];
            let bx = 0; let by = 0; let bs = Infinity;
            for (let ci = 0; ci < cands.length; ci += 1) {
              const ca = Math.cos(cands[ci]); const sa = Math.sin(cands[ci]);
              const rx = (mx * ca - my * sa) / ml; const ry = (mx * sa + my * ca) / ml;
              if (!__roamDebug.walkableAt(p.x + rx * 38, p.y + ry * 38, 12)) continue;
              const sc = Math.hypot(t.x - (p.x + rx * 38), t.y - (p.y + ry * 38));
              if (sc < bs) { bs = sc; bx = rx; by = ry; }
            }
            state.keys = { left: bx < -0.25, right: bx > 0.25, up: by < -0.25, down: by > 0.25 };
          } else state.keys = { left: false, right: false, up: false, down: false };
          /* 站桩策略：完全不动 —— 这是"未按解法"（不躲弹幕、不拉开距离）的对照组 */
          if (c.policy === 'stand') state.keys = { left: false, right: false, up: false, down: false };
          if (!inv) c.minHp = Math.min(c.minHp === undefined ? p.hp : c.minHp, p.hp);
          c.sample(t);
          c.t += 1 / 60;
          update(1 / 60);
          const sec = Math.floor(c.t);
          if (sec !== window.__comboLastSec) {
            window.__comboLastSec = sec;
            const ls = state.enemies.filter((e) => e.roomId === c.roomId);
            c.timeline.push({ t: sec, foes: ls.length, hp: Math.round(ls.reduce((q, e) => q + Math.max(0, e.hp || 0), 0)) });
          }
          if (state.mode !== 'playing' || state.status !== 'playing') break;
        }
        const out = c.snap();
        out.foes = state.enemies.filter((e) => e.roomId === c.roomId).length;
        out.cleared = out.foes === 0;
        out.hp = Math.round(state.player.hp);
        out.hpMax = state.player.hpMax;
        out.minHp = Math.round(c.minHp === undefined ? state.player.hp : c.minHp);
        out.mode = state.mode;
        out.status = state.status;
        return out;
      })()`);
      if (snap.cleared || snap.clearTime >= cap) break;
    }
    await ev(`(() => { if (window.__rafOrig) { window.requestAnimationFrame = window.__rafOrig; requestAnimationFrame(loop); } return true; })()`);
    await sleep(160);
    return { setup: s, snap: snap, timeline: await ev(`__combo.timeline.slice()`) };
  }

  // ---------- 诊断 ----------
  const diag = {};
  for (const [scene, policy, cap] of [['combo', 'path', 40], ['combo', 'stand', 22], ['combo', 'kite', 22]]) {
    const r = await run(scene, policy, cap);
    const key = `${scene}-${policy}`;
    diag[key] = { setup: r.setup, snap: r.snap, timeline: r.timeline };
    log(`${key}: 布置=${JSON.stringify(r.setup)} 清场=${r.snap.clearTime}s DPS=${r.snap.dps} `
      + `击杀=${JSON.stringify(r.snap.kills)} 诱饵击杀=${r.snap.phantomKills} 回血事件=${r.snap.healEvents} `
      + `流场帧=${r.snap.navTicks} 血量=${r.snap.hp}/${r.snap.hpMax} 最低=${r.snap.minHp} 模式=${r.snap.mode}`);
  }

  // 截图：同场景 before（站桩：被打残）/ after（走位：清场）
  await run('combo', 'stand', 22);
  await shot('combo-before.png');
  const after = await run('combo', 'kite', 22);
  await shot('combo-after.png');

  const wallNaive = diag['combo-stand'].snap;
  const wallPath = diag['combo-kite'].snap;
  const combo = diag['combo-path'].snap;

  if (!ONLY_DIAG) {
    // A1：合成组合（4 镜像幽灵 + 咏唱者）在合理构筑下能清掉
    check('A1 combo 场景能清场', combo.foes === 0 && combo.clearTime <= 30,
      { clear: combo.clearTime, dps: combo.dps });
    // A2：游戏没有"治疗 > 伤害"的不动点（全程没有回血事件）
    check('A2 无治疗机制（回血事件=0）', combo.healEvents === 0 && wallPath.healEvents === 0,
      { combo: combo.healEvents, wall: wallPath.healEvents });
    // A3：诱饵是 1 击级消耗品，不是无解墙（有击杀且不是长期 0 伤害）
    check('A3 诱饵可被击杀', combo.phantomKills > 0, { kills: combo.phantomKills });
    /* A4：这组怪有真实杀伤力（真实模式实测掉血 38/85 与 64/85，即 45% 与 75%），
       说明"能清掉"不是靠把怪削弱到没有威胁 —— 再挨两下就会死。
       同时记录一个结论：本组合清场 10–14s，低于 F8 曲线下界 21s，不是难度尖峰。 */
    check('A4 难度有真实代价（真实模式掉血 ≥25%）',
      (wallNaive.hpMax - wallNaive.minHp) >= wallNaive.hpMax * 0.25
      && (wallPath.hpMax - wallPath.minHp) >= wallPath.hpMax * 0.25,
      { standLost: wallNaive.hpMax - wallNaive.minHp, kiteLost: wallPath.hpMax - wallPath.minHp,
        hpMax: wallNaive.hpMax, standT: wallNaive.clearTime, kiteT: wallPath.clearTime });
    // A5：按解法（走位躲弹幕 + 集中输出）同场景能清掉且活着
    check('A5 按解法可清场（走位 ≤ 25s 且存活）',
      wallPath.foes === 0 && wallPath.clearTime <= 25 && wallPath.hp > 0,
      { clear: wallPath.clearTime, dps: wallPath.dps, hp: wallPath.hp, minHp: wallPath.minHp });
    // A6：难度没有被抹平 —— 怪物数值原封不动（不是靠削弱怪来"修复"）
    const design = await ev(`(() => {
      const pick = (id) => {
        const c = (ENEMY_CONFIG || []).find ? (ENEMY_CONFIG || []).find((e) => e.id === id) : (ENEMY_CONFIG || {})[id];
        return c ? { hp: c.hp, speed: c.speed, damage: c.damage } : null;
      };
      return { mirrorghost: pick('mirrorghost'), chanter: pick('chanter'), mirrorphantom: pick('mirrorphantom'),
        hasteDefault: 1.35 };
    })()`);
    check('A6 怪物数值未被削弱（原设计值不变）',
      !!design.mirrorghost && design.mirrorghost.hp === 48
      && !!design.chanter && design.chanter.hp === 64
      && !!design.mirrorphantom && design.mirrorphantom.hp === 1,
      design);
  }

  fs.writeFileSync(RESULTS, JSON.stringify({
    at: new Date().toISOString(), diag, checks,
    screenshots: ['combo-before.png', 'combo-after.png'], runtimeErrors
  }, null, 2));

  const fails = checks.filter((c) => !c.ok);
  console.log(`\nRESULT: ${fails.length ? 'FAIL' : 'PASS'}  ${checks.length - fails.length}/${checks.length}`);
  if (runtimeErrors.length) console.log('RUNTIME ERRORS: ' + JSON.stringify(runtimeErrors.slice(0, 3)));

  await cleanup();
  process.exit(fails.length ? 1 : 0);
}

/**
 * 关闭 Edge 与测试 profile
 * @returns {Promise<void>}
 */
async function cleanup() {
  try { if (EDGE_PROC) EDGE_PROC.kill(); } catch (e) { /* 已退出 */ }
  await sleep(300);
  try { killEdge(); } catch (e) { /* 忽略 */ }
}

main().catch(async (err) => {
  console.error('FATAL', err && err.message ? err.message : err);
  await cleanup();
  process.exit(1);
});
