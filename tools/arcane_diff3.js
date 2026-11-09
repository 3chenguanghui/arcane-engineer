/**
 * 第 7 轮 · 第 1 组：三档难度实测采样脚本
 * ------------------------------------------------------------
 * 目的：
 *   easy / normal / nightmare 三档，各自用同一套固定构筑（火球 + 喷火锥）的
 *   无头 bot 实打一遍，测出：
 *     · F1–F5 清场时长（教学区三档共享 normal 基线，只采一次）
 *     · F6–F10 清场时长 / 总血 / 承伤 / 死亡
 *     · Boss（F6、F10）击杀时长
 *     · 单场最大损血比例、死亡期望
 *   并断言：三档在"同层同房型"下总血与承伤有可测差异，
 *   且每档既不是"必死"也不是"无威胁"。
 *
 * 口径：
 *   - 时间用 state.elapsed（模拟秒），临时接管 requestAnimationFrame + 固定步长 update(1/60)；
 *   - 玩家构筑固定，不用无敌、不用无限奥能（承伤与死亡才是真实的）；
 *   - 每场给 1s 入场保护（同 arcane_balance.js 口径，避免"瞬移进怪堆"假死）；
 *   - 教学层 F1–F5 由游戏固定为 normal 难度（G 批设计），脚本按共享基线采一次，
 *     并在结果里标 sharedTutorial=true，避免把设计当成 bug。
 *
 * 用法：
 *   node tools/arcane_diff3.js
 *   node tools/arcane_diff3.js <游戏文件> <输出目录>
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');
const { NAV_SRC } = require('./arcane_botnav');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9573;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = process.argv[3] || path.join(__dirname, '..', '.screenshots', 'diff3');
const RESULT_JSON = path.join(OUT, 'diff3-result.json');

const CAP = 75;          // 单场战斗模拟上限（秒）
const BOSS_CAP = 90;     // Boss 战上限（秒）
const SUB_STEPS = 12;    // 每次 evaluate 推进的固定步数（与 balance 一致）
const BATTLE_MAX_TRIES = 60;
const TIERS = ['easy', 'normal', 'nightmare'];
const TIER_LABEL = { easy: '简单', normal: '普通', nightmare: '困难' };
/* 第 8 轮 · 组 5：每层每档真实样本数 4 → 7。
   原因：组 5 只改"量尺精度"不改阈值——4 个样本的中位数仍会被单次异常拉偏
   （第 7 轮同一份代码出现过 PASS/FAIL/PASS）。7 个样本取中位数后抖动收敛，
   且不触碰任何判据线 / LEGACY_TARGET。 */
const BATTLE_SAMPLES = 7;   // F6–F10 每层每档真实样本数
/* 第 8 轮 · 组 5 冲刺开关（默认开启＝第二版"防御性冲刺"，四轮里最优）。
   四轮对照（同一 7 样本/层口径，普通档 F6–F10 死亡）：
     ① 顺导航方向冲刺（会撞进怪堆）        62.9%   A4 FAIL
     ② 防御冲刺：近弹 <70 或 半血+贴脸 <95  51.4%   A4 PASS，A5 65.7% / A5b 34.3%（最优）
     ③ 残血背离最近敌人冲刺                57.1%   A4 PASS，A5 77.1% / A5b 22.9%
     ④ 完全不冲刺                          68.6%   A4 FAIL（F8/F10 无有效清场样本）
   结论：第二轮触发条件最接近人类"看到危险才交位移"的口径；DIFF3_BOT_DASH=0 可复现④。
   这里只调整"量尺行为"，判据线 / LEGACY_TARGET / 难度系数均未改动。 */
const BOT_DASH = process.env.DIFF3_BOT_DASH !== '0';
/* 第 23 项：bot 读取第 16 项的预警层，做"看到前摇再交位移"。
   只改量尺行为，不改难度系数、不改任何断言阈值；DIFF3_BOT_WARN=0 可复现旧的
   "只看子弹距离 / 半血贴脸"口径（第 8 轮组 5 的 ②/⑤ 基线）。 */
const BOT_WARN = process.env.DIFF3_BOT_WARN !== '0';
const BOSS_SAMPLES = 2;     // Boss 每层每档真实样本数
const BOSS_INV_SAMPLES = 2; // Boss 每层每档"无敌口径"样本数（只测击杀时长）
const SHARED_SAMPLES = 3;   // F1–F5 每层共享基线样本数

/* 调试用过滤：只跑指定档/层/类型，避免每次全量（例：DIFF3_TIERS=normal DIFF3_FLOORS=6 DIFF3_KIND=boss DIFF3_DIAG=1） */
const ONLY_TIERS = (process.env.DIFF3_TIERS || '').split(',').map((s) => s.trim()).filter(Boolean);
const ONLY_FLOORS = (process.env.DIFF3_FLOORS || '').split(',').map(Number).filter((n) => n > 0);
const ONLY_KIND = (process.env.DIFF3_KIND || '').trim();
const TIERS_RUN = ONLY_TIERS.length ? TIERS.filter((t) => ONLY_TIERS.indexOf(t) >= 0) : TIERS;
const DIAG_ON = process.env.DIFF3_DIAG === '1';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const agg = { assertions: [], notes: {} };
let EDGE_PROC = null;
const runtimeErrors = [];

/**
 * 记录一条断言
 * @param {string} name 断言名
 * @param {boolean} ok 是否通过
 * @param {*} detail 证据
 * @returns {void}
 */
function check(name, ok, detail) {
  agg.assertions.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail == null ? '' : JSON.stringify(detail)}`);
}

/**
 * 打印带前缀的进度
 * @param {string} text
 * @returns {void}
 */
function log(text) { console.log('[diff3] ' + text); }

/**
 * 求分位数（入参必须已升序）
 * @param {number[]} arr
 * @param {number} p 0–1
 * @returns {number}
 */
function quantile(arr, p) {
  if (!arr.length) return 0;
  const i = Math.min(arr.length - 1, Math.max(0, Math.round((arr.length - 1) * p)));
  return arr[i];
}

/**
 * 对数值数组做摘要（n / min / 中位 / max / 均值）
 * @param {number[]} values
 * @returns {Object}
 */
function summarize(values) {
  const arr = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!arr.length) return { n: 0, min: 0, median: 0, max: 0, mean: 0 };
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return {
    n: arr.length,
    min: Math.round(arr[0] * 10) / 10,
    median: Math.round(quantile(arr, 0.5) * 10) / 10,
    max: Math.round(arr[arr.length - 1] * 10) / 10,
    mean: Math.round(mean * 10) / 10
  };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });
  EDGE_PROC = edge;

  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等端口 */ }
    await sleep(250);
  }
  if (!target) throw new Error('调试端口未就绪');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (msg) => {
    const m = JSON.parse(msg.data);
    if (m.method === 'Runtime.exceptionThrown') {
      runtimeErrors.push(m.params && m.params.exceptionDetails
        ? (m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text
        : 'unknown');
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
    return path.join(OUT, name);
  };

  // ---------- 启动游戏，并进入战斗态 ----------
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2200);
  const startPos = await ev(`(() => { const el = document.getElementById('btnStart'); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: startPos.x, y: startPos.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: startPos.x, y: startPos.y, button: 'left', clickCount: 1 });
  await sleep(900);

  const boot = await ev(`(() => {
    const d = window.__roamDebug;
    try { setDifficulty('normal'); } catch (e) {}
    state.difficulty = 'normal';
    state.mode = 'playing';
    state.status = 'playing';
    d.enemies.budget.reset();
    d.enemies.setEnabled(true);
    d.enemies.setAdaptive(false);
    return { mode: state.mode, floor: state.floor, hpMax: state.player.hpMax };
  })()`);
  log('启动：' + JSON.stringify(boot));

  // ---------- 安装页面侧 bot（与 arcane_balance.js 同口径） ----------
  await ev(`(() => {
    ${NAV_SRC}
    window.__bal = {
      roomId: null, invincible: false, infiniteAether: false,
      initialHpSum: 0, peakEnemies: 0, peakProj: 0, minHp: 0,
      cleared: false, dead: false,
      /** 敌人总有效血量（含护盾） */
      hpSum(list) {
        let s = 0;
        for (let i = 0; i < list.length; i += 1) {
          const e = list[i];
          s += Math.max(0, e.hp || 0) + Math.max(0, e.shield || e.shieldHp || 0);
        }
        return s;
      },
      /** 当前房间内的敌人 */
      foes() { return state.enemies.filter((e) => e.roomId === this.roomId); },
      /** 开始一场战斗的统计窗口 */
      reset(roomId, hpSum, opts) {
        this.roomId = roomId;
        this.initialHpSum = hpSum;
        this.invincible = !!(opts && opts.invincible);
        this.infiniteAether = !!(opts && opts.infiniteAether);
        this.peakEnemies = 0; this.peakProj = 0;
        this.minHp = state.player.hpMax;
        this.cleared = false; this.dead = false;
        this.lastHpSum = hpSum; this.noDamageT = 0;
        this.navTicks = 0; this.nudges = 0;
        this.path = []; this.pathT = 0; this.fpPos = null; this.fpT = 0;
        this.unstickPhase = 0;
        this.manaSpent = 0; this.casts = 0; this.castsBlocked = 0; this.damageDone = 0;
        return true;
      },
      /** 每模拟步一次：瞄准 + 施法 + 走位 + 统计 */
      tick() {
        const p = state.player;
        this.minHp = Math.min(this.minHp, p.hp);
        if (state.mode !== 'playing' || state.status !== 'playing') { this.dead = true; return; }
        const list = this.foes();
        if (list.length) this.peakEnemies = Math.max(this.peakEnemies, list.length);
        this.peakProj = Math.max(this.peakProj, state.bullets.length + state.projectiles.length);
        if (this.invincible) { p.invuln = Math.max(p.invuln || 0, 9); if (p.hp < p.hpMax) p.hp = p.hpMax; }
        if (this.infiniteAether) p.aether = p.aetherMax;
        if (!list.length) { this.cleared = true; return; }

        let t = list[0];
        for (let i = 0; i < list.length; i += 1) {
          const e = list[i];
          const hp = (e.hp || 0) + (e.shield || 0);
          const th = (t.hp || 0) + (t.shield || 0);
          if (hp < th - 0.5) { t = e; continue; }
          if (Math.abs(hp - th) <= 0.5) {
            const dd = (e.x - p.x) * (e.x - p.x) + (e.y - p.y) * (e.y - p.y);
            const dt0 = (t.x - p.x) * (t.x - p.x) + (t.y - p.y) * (t.y - p.y);
            if (dd < dt0) t = e;
          }
        }
        const td = Math.hypot(t.x - p.x, t.y - p.y) || 1;
        const lead = Math.min(0.4, td / 520);
        const aim = Math.atan2(t.y + (t.vy || 0) * lead - p.y, t.x + (t.vx || 0) * lead - p.x);
        __roamDebug.setAimExact(aim);
        if (!state.cooldowns['fireball']) {
          const beforeFb = p.aether;
          if (castSlot(0, false)) { this.casts += 1; this.manaSpent += Math.max(0, beforeFb - p.aether); }
          else if (beforeFb < MAGIC_BY_ID['fireball'].cost) this.castsBlocked += 1;
        }
        if (!state.cooldowns['flameCone'] && td <= 215) {
          const beforeFc = p.aether;
          if (castSlot(1, false)) { this.casts += 1; this.manaSpent += Math.max(0, beforeFc - p.aether); }
          else if (beforeFc < MAGIC_BY_ID['flameCone'].cost) this.castsBlocked += 1;
        }

        let n = list[0]; let nd = Infinity;
        for (let i = 0; i < list.length; i += 1) {
          const e = list[i];
          const d = Math.hypot(e.x - p.x, e.y - p.y);
          if (d < nd) { nd = d; n = e; }
        }
        const ux = (n.x - p.x) / (nd || 1);
        const uy = (n.y - p.y) / (nd || 1);
        const tdx = t.x - p.x; const tdy = t.y - p.y;
        const tdd = Math.hypot(tdx, tdy) || 1;
        const tux = tdx / tdd; const tuy = tdy / tdd;
        const curHp = this.hpSum(list);
        this.damageDone += Math.max(0, (this.lastHpSum || curHp) - curHp);
        if (curHp < (this.lastHpSum || 0) - 0.5) { this.lastHpSum = curHp; this.noDamageT = 0; }
        else { this.lastHpSum = curHp; this.noDamageT = (this.noDamageT || 0) + 1 / 60; }

        let mx = 0; let my = 0;
        const roomNow = state.rooms[this.roomId];
        const outRoom = roomNow ? (
          p.x < roomNow.x + 24 || p.x > roomNow.x + roomNow.w - 24 ||
          p.y < roomNow.y + 24 || p.y > roomNow.y + roomNow.h - 24
        ) : false;
        if (outRoom) { mx = roomNow.cx - p.x; my = roomNow.cy - p.y; }
        let navDir = null;
        if (!outRoom && this.noDamageT > 0.5) {
          const navRoom = state.rooms[this.roomId];
          __nav.ensure(navRoom);
          navDir = __nav.flowTo(t.x, t.y);
        }
        if (navDir) {
          this.navTicks = (this.navTicks || 0) + 1;
          const mv = this.lastPos ? Math.hypot(p.x - this.lastPos[0], p.y - this.lastPos[1]) : 99;
          this.moveT = mv < 1.5 ? (this.moveT || 0) + 1 / 60 : 0;
          this.lastPos = [p.x, p.y];
          if (this.moveT > 0.4) {
            this.jitter = ((this.jitter || 0) + 1) % 3;
            navDir = this.jitter === 1 ? { x: -navDir.y, y: navDir.x } : { x: navDir.y, y: -navDir.x };
          }
          mx = navDir.x; my = navDir.y;
        } else if (outRoom) {
          // 已朝房心
        } else if (this.noDamageT > 3) {
          this.unstickPhase = (this.unstickPhase || 0) + 1 / 60;
          const side = (Math.floor(this.unstickPhase) % 2 === 0) ? 1 : -1;
          mx = tux * 0.35 - tuy * side * 0.95;
          my = tuy * 0.35 + tux * side * 0.95;
          if (this.noDamageT > 9) { mx = tux; my = tuy; }
        } else if (nd < 180) { mx = -ux; my = -uy; }
        else if (nd > 260) { mx = ux; my = uy; }
        else {
          const s = (Math.floor(state.elapsed / 2) % 2 === 0) ? 1 : -1;
          mx = -uy * s; my = ux * s;
        }
        // 躲逼近的敌弹
        let bx = 0; let by = 0; let bd = Infinity;
        for (let i = 0; i < state.bullets.length; i += 1) {
          const b = state.bullets[i];
          const d = Math.hypot(b.x - p.x, b.y - p.y);
          const toward = (p.x - b.x) * (b.vx || 0) + (p.y - b.y) * (b.vy || 0);
          if (d < 120 && toward > 0 && d < bd) { bd = d; bx = b.vx || 0; by = b.vy || 0; }
        }
        if (bd < 120) {
          const bl = Math.hypot(bx, by) || 1;
          const side = ((p.x - bx) * -by + (p.y - by) * bx) >= 0 ? 1 : -1;
          mx += (-by / bl) * side * 1.2;
          my += (bx / bl) * side * 1.2;
        }
        const room = state.rooms[this.roomId];
        if (room) {
          if (p.x < room.x + 40) mx += 0.7;
          if (p.x > room.x + room.w - 40) mx -= 0.7;
          if (p.y < room.y + 40) my += 0.7;
          if (p.y > room.y + room.h - 40) my -= 0.7;
        }
        const ml = Math.hypot(mx, my);
        if (outRoom && ml > 0.01) {
          state.keys = { left: mx / ml < -0.25, right: mx / ml > 0.25, up: my / ml < -0.25, down: my / ml > 0.25 };
        } else if (navDir) {
          state.keys = { left: navDir.x < -0.25, right: navDir.x > 0.25, up: navDir.y < -0.25, down: navDir.y > 0.25 };
        } else if (ml > 0.01) {
          const cands = [0, 0.4, -0.4, 0.8, -0.8, 1.2, -1.2, 1.6, -1.6, 2.0, -2.0];
          let bestRx = 0; let bestRy = 0; let bestScore = Infinity;
          for (let i = 0; i < cands.length; i += 1) {
            const a = cands[i]; const ca = Math.cos(a); const sa = Math.sin(a);
            const rx = (mx * ca - my * sa) / ml;
            const ry = (mx * sa + my * ca) / ml;
            const nx2 = p.x + rx * 38; const ny2 = p.y + ry * 38;
            if (!__roamDebug.walkableAt(nx2, ny2, 12)) continue;
            const score = Math.hypot(t.x - nx2, t.y - ny2);
            if (score < bestScore) { bestScore = score; bestRx = rx; bestRy = ry; }
          }
          if (bestScore !== Infinity) {
            state.keys = { left: bestRx < -0.25, right: bestRx > 0.25, up: bestRy < -0.25, down: bestRy > 0.25 };
          } else { state.keys = { left: false, right: false, up: false, down: false }; }
        } else { state.keys = { left: false, right: false, up: false, down: false }; }
        // 第 23 项：先读第 16 项预警层——冲锋锁定线即将落地、或近战前摇快结束时，
        // 提前向"线的垂直方向 / 远离敌人方向"交位移。只用玩家也看得见的提示，不额外给属性。
        let didWarnDash = false;
        if (${BOT_WARN}) {
          const warns = __roamDebug.warning.active();
          let danger = null;
          for (let i = 0; i < warns.length; i += 1) {
            const wt = warns[i];
            const wd = Math.hypot(wt.x - p.x, wt.y - p.y);
            if (wt.kind === 'charge' && wt.remaining <= 0.35 && wd <= 170) { danger = wt; break; }
            if (wt.kind === 'contact' && wt.remaining <= 0.20 && wd <= 62) { danger = wt; break; }
          }
          if (danger && p.dashCd <= 0) {
            // 冲锋：垂直于锁定线躲开；接触：直接远离敌人
            let a = danger.kind === 'charge' && danger.line
              ? danger.line.angle + Math.PI / 2
              : Math.atan2(p.y - danger.y, p.x - danger.x);
            if (!__roamDebug.walkableAt(p.x + Math.cos(a) * 45, p.y + Math.sin(a) * 45, 12)) {
              a += Math.PI;
            }
            state.keys = {
              left: Math.cos(a) < -0.25, right: Math.cos(a) > 0.25,
              up: Math.sin(a) < -0.25, down: Math.sin(a) > 0.25
            };
            startDash();
            didWarnDash = true;
          }
        }
        // 第 8 轮 · 组 5：防御性冲刺（第二版）。只在"子弹贴脸"或"半血以下被贴身"时交位移，
        // 方向沿用走位逻辑，不额外覆盖 state.keys——这样冲刺用来脱身，而不是把自己甩出输出环。
        if (!didWarnDash && ${BOT_DASH} && p.dashCd <= 0 && (bd < 70 || (nd < 95 && p.hp < p.hpMax * 0.5))) {
          startDash();
        }
        this.pathT = (this.pathT || 0) + 1 / 60;
        if (this.pathT >= 1) {
          this.pathT = 0;
          this.path.push([Math.round(p.x), Math.round(p.y)]);
          if (this.path.length > 12) this.path.shift();
        }
        const fpMove = this.fpPos ? Math.hypot(p.x - this.fpPos[0], p.y - this.fpPos[1]) : 99;
        this.fpT = fpMove < 1 ? (this.fpT || 0) + 1 / 60 : 0;
        this.fpPos = [p.x, p.y];
        if (this.fpT > 1.2) {
          this.fpT = 0; this.fpPos = null;
          const r3 = state.rooms[this.roomId];
          if (r3) { p.x = r3.cx; p.y = r3.cy; p.vx = 0; p.vy = 0; }
          this.nudges = (this.nudges || 0) + 1;
          this.noDamageT = 0;
        }
      }
    };
    /** 推进 n 个固定步长，返回最新快照 */
    window.__balStep = function (count) {
      const b = window.__bal;
      for (let i = 0; i < count; i += 1) {
        b.tick();
        if (b.cleared || b.dead) break;
        update(1 / 60);
        const list = b.foes();
        if (!list.length) b.cleared = true;
        if (state.mode !== 'playing' || state.status !== 'playing') b.dead = true;
        if (b.cleared || b.dead) break;
      }
      const list = b.foes();
      return {
        cleared: b.cleared, dead: b.dead, foes: list.length,
        hpSum: b.hpSum(list), peakEnemies: b.peakEnemies, peakProj: b.peakProj,
        minHp: b.minHp, manaSpent: b.manaSpent, casts: b.casts, castsBlocked: b.castsBlocked,
        damageDone: b.damageDone, navTicks: b.navTicks, nudges: b.nudges || 0,
        aether: state.player.aether, elapsed: state.elapsed, mode: state.mode, status: state.status
      };
    };
    return true;
  })()`);

  /**
   * 接管 RAF，进入定步长加速模式
   * @returns {Promise<void>}
   */
  async function haltRaf() {
    await ev(`(() => {
      window.__rafOrig = window.requestAnimationFrame;
      window.requestAnimationFrame = function () { return 0; };
      window.__uiTimerOrig = (typeof uiTimer === 'number') ? uiTimer : 0;
      try { uiTimer = -100000; } catch (e) {}
      return true;
    })()`);
    await sleep(140);
  }

  /**
   * 恢复 RAF（截图用）
   * @returns {Promise<void>}
   */
  async function resumeRaf() {
    await ev(`(() => {
      try { uiTimer = 0; } catch (e) {}
      if (window.__rafOrig) { window.requestAnimationFrame = window.__rafOrig; window.__rafOrig = null; requestAnimationFrame(loop); }
      return true;
    })()`);
    await sleep(220);
  }

  // 关键：采样全程接管 RAF，否则页面自己的 loop 会与 __balStep 叠加推进时间
  await haltRaf();

  /**
   * 重置玩家构筑与状态（每场前调用，只动内存 state）
   * @param {number} floor 层数
   * @param {number} dmgMul 玩家伤害倍率
   * @returns {Promise<Object>}
   */
  async function resetPlayer(floor, dmgMul) {
    return ev(`(() => {
      const d = window.__roamDebug;
      state.mode = 'playing'; state.status = 'playing';
      state.hitStop = 0; state.slowMo = 0; state.fusionSlow = 0; state.victoryTimer = 0;
      state.ownedMagic = ['fireball', 'flameCone']; state.ownedTech = []; state.fusions = [];
      state.activeMagicId = 'fireball'; state.activeTechId = null;
      state.mods.damageMul = ${dmgMul}; state.mods.cooldownMul = 1; state.mods.speedMul = 1;
      state.cooldowns = {}; state.deviceCooldown = 0;
      if (state.dual) { state.dual.slots = ['fireball', 'flameCone']; state.dual.focus = 0; state.dual.switchCd = 0; }
      state.bullets.length = 0; state.projectiles.length = 0;
      state.aoeZones.length = 0; state.sigils.length = 0; state.mines.length = 0;
      if (state.pickups) state.pickups.length = 0;
      d.setHp(state.player.hpMax);
      state.player.aether = state.player.aetherMax;
      state.player.invuln = 0; state.player.vx = 0; state.player.vy = 0; state.keys = {};
      return { floor: state.floor, hpMax: state.player.hpMax, dmgMul: state.mods.damageMul };
    })()`);
  }

  /**
   * 生成一层并布置普通战斗房（最多重掷 BATTLE_MAX_TRIES 次）
   * @param {number} floor 层数
   * @param {number} dmgMul 玩家伤害倍率
   * @returns {Promise<Object>}
   */
  async function setupBattle(floor, dmgMul) {
    let last = null;
    let rollouts = 0;
    for (let t = 0; t < BATTLE_MAX_TRIES; t += 1) {
      rollouts = t + 1;
      const info = await ev(`(() => {
        __roamDebug.enemies.budget.reset();
        __roamDebug.enemies.setAdaptive(false);
        __roamDebug.enemies.floor(${floor});
        state.mode = 'playing'; state.status = 'playing';
        const rooms = state.rooms.map((r) => ({
          id: r.id, type: r.type, planned: r.enemyCount || 0,
          w: r.w, h: r.h, x: r.x, y: r.y, cx: r.cx, cy: r.cy,
          challenge: !!(r.challengeKind || r.challenge)
        }));
        const battle = rooms.filter((r) => r.type === 'battle' && r.planned > 0 && !r.challenge);
        return {
          rooms: rooms, battleCount: battle.length, pick: battle[0] || null,
          eliteCount: rooms.filter((r) => r.type === 'elite').length
        };
      })()`);
      last = info;
      if (info.pick) break;
    }
    if (!last || !last.pick) {
      return { ok: false, invalidReason: 'no-battle-room', rollouts: rollouts, floor: floor,
        roomId: -1, roomType: null, enemyCount: 0, hpSum: 0, types: [], elites: 0, room: null,
        player: { hpMax: 1, aetherMax: 1, dmgMul: dmgMul } };
    }
    const room = last.pick;
    await resetPlayer(floor, dmgMul);
    const spot = await ev(`(() => {
      const r = ${JSON.stringify(room)};
      const cands = [[0, 0], [r.w * 0.28, 0], [-r.w * 0.28, 0], [0, r.h * 0.28], [0, -r.h * 0.28],
        [r.w * 0.26, r.h * 0.26], [-r.w * 0.26, -r.h * 0.26], [r.w * 0.26, -r.h * 0.26], [-r.w * 0.26, r.h * 0.26]];
      const foes = state.enemies.filter((e) => e.roomId === r.id);
      let best = null; let bestScore = -1;
      for (let i = 0; i < cands.length; i += 1) {
        const x = r.cx + cands[i][0]; const y = r.cy + cands[i][1];
        if (x < r.x + 36 || x > r.x + r.w - 36 || y < r.y + 36 || y > r.y + r.h - 36) continue;
        if (!__roamDebug.walkableAt(x, y, 14)) continue;
        let score = foes.length ? Math.min.apply(null, foes.map((f) => Math.hypot(f.x - x, f.y - y))) : 0;
        if (score > bestScore) { bestScore = score; best = { x: x, y: y, ok: true }; }
      }
      return best || { x: r.cx, y: r.cy, ok: false };
    })()`);
    const detail = await ev(`(() => {
      const p = state.player;
      p.x = ${spot.x}; p.y = ${spot.y}; p.vx = 0; p.vy = 0;
      __roamDebug.setHp(p.hpMax);
      p.aether = p.aetherMax;
      p.invuln = 1.0;
      const roomId = ${room.id};
      const foes = state.enemies.filter((e) => e.roomId === roomId);
      return {
        floor: ${floor}, roomId: roomId, room: ${JSON.stringify(room)}, spotOk: ${spot.ok},
        player: { hpMax: p.hpMax, aetherMax: p.aetherMax, dmgMul: state.mods.damageMul || 1 },
        enemyCount: foes.length,
        hpSum: foes.reduce((s, e) => s + Math.max(0, e.hp || 0) + Math.max(0, e.shield || e.shieldHp || 0), 0),
        types: Array.from(new Set(foes.map((e) => e.typeId))),
        elites: foes.filter((e) => e.elite).length
      };
    })()`);
    return Object.assign(detail, { ok: true, rollouts: rollouts, roomType: room.type,
      battleCount: last.battleCount, eliteCount: last.eliteCount });
  }

  /**
   * 选 Boss 房落点（距中心约 110–200px 的合法点，且满足深度触发）
   * @param {Object} room Boss 房
   * @returns {string} 可求值表达式
   */
  function pickBossSpotExpr(room) {
    return `(() => {
      const r = ${JSON.stringify(room)};
      const depth = Math.min(r.w, r.h) * 0.2 + 14;
      for (const rad of [170, 140, 200, 110]) {
        for (let i = 0; i < 16; i += 1) {
          const a = i * Math.PI / 8;
          const x = r.cx + Math.cos(a) * rad; const y = r.cy + Math.sin(a) * rad;
          if (x < r.x + depth || x > r.x + r.w - depth) continue;
          if (y < r.y + depth || y > r.y + r.h - depth) continue;
          if (!__roamDebug.walkableAt(x, y, 14)) continue;
          return { x: x, y: y, ok: true, dist: rad };
        }
      }
      return { x: r.cx, y: r.cy, ok: false, dist: 0 };
    })()`;
  }

  /**
   * 生成一层并触发首领登场（含开放层兜底）
   * @param {number} floor 层数
   * @param {number} dmgMul 玩家伤害倍率
   * @returns {Promise<Object>}
   */
  async function setupBoss(floor, dmgMul) {
    await ev(`(() => { __roamDebug.enemies.budget.reset(); __roamDebug.enemies.setAdaptive(false); __roamDebug.enemies.floor(${floor}); return true; })()`);
    await resetPlayer(floor, dmgMul);
    const room = await ev(`(() => {
      const room = state.rooms.find((r) => r.type === 'boss');
      return { id: room.id, type: room.type, w: room.w, h: room.h, x: room.x, y: room.y, cx: room.cx, cy: room.cy, enemyCount: room.enemyCount };
    })()`);
    const spot = await ev(pickBossSpotExpr(room));
    const detail = await ev(`(() => {
      const p = state.player;
      p.x = ${spot.x}; p.y = ${spot.y}; p.vx = 0; p.vy = 0;
      const roomId = ${room.id};
      let naturalTrigger = false;
      for (let i = 0; i < 240; i += 1) {
        if (state.mode !== 'playing' || state.status !== 'playing') break;
        update(1 / 60);
        if (state.boss && state.boss.introDone) break;
      }
      if (state.boss) naturalTrigger = !!state.boss.introDone;
      if (state.boss && !state.boss.started && !state.boss.defeated) {
        startBossIntro(state.rooms.find((r) => r.id === roomId));
      }
      for (let i = 0; i < 100; i += 1) {
        if (state.boss && state.boss.introDone) break;
        update(1 / 60);
      }
      __roamDebug.setHp(p.hpMax); p.aether = p.aetherMax; p.invuln = 1.0;
      state.bullets.length = 0; state.projectiles.length = 0;
      const foes = state.enemies.filter((e) => e.roomId === roomId);
      return {
        floor: ${floor}, roomId: roomId, room: ${JSON.stringify(room)}, spotOk: ${spot.ok}, spotDist: ${spot.dist},
        player: { hpMax: p.hpMax, aetherMax: p.aetherMax, dmgMul: state.mods.damageMul || 1 },
        naturalTrigger: naturalTrigger,
        boss: state.boss ? { started: !!state.boss.started, introDone: !!state.boss.introDone,
          hp: state.boss.hp || 0, hpMax: state.boss.hpMax || 0 } : null,
        enemyCount: foes.length,
        hpSum: foes.reduce((s, e) => s + Math.max(0, e.hp || 0) + Math.max(0, e.shield || e.shieldHp || 0), 0),
        types: Array.from(new Set(foes.map((e) => e.typeId))),
        elites: foes.filter((e) => e.elite).length
      };
    })()`);
    return Object.assign(detail, { ok: true, roomType: 'boss', rollouts: 1 });
  }

  /**
   * 跑一场战斗（定步长加速模拟）
   * @param {Object} setup setupBattle / setupBoss 返回值
   * @param {Object} opts { cap }
   * @returns {Promise<Object>}
   */
  async function runFight(setup, opts) {
    await ev(`__bal.reset(${setup.roomId}, ${setup.hpSum}, ${JSON.stringify({
      invincible: !!opts.invincible,
      infiniteAether: !!opts.infiniteAether
    })})`);
    const t0 = await ev('state.elapsed');
    let snap = null;
    let timedOut = false;
    let lastDiagSec = 0;
    for (let i = 0; i < 2500; i += 1) {
      snap = await ev(`__balStep(${SUB_STEPS})`);
      // 逐秒诊断：打印玩家血量 / 首领血量 / 危险区数量 / 距离，用于定位真实模式秒死
      if (DIAG_ON && snap.elapsed - t0 >= lastDiagSec + 1) {
        lastDiagSec = Math.floor(snap.elapsed - t0);
        const d = await ev(`(() => {
          const p = state.player;
          const b = state.boss;
          const foes = state.enemies.filter((e) => e.roomId === ${setup.roomId});
          let nd = 9999;
          foes.forEach((e) => { nd = Math.min(nd, Math.hypot(e.x - p.x, e.y - p.y)); });
          return {
            t: Math.round(state.elapsed), hp: Math.round(p.hp), invuln: Number((p.invuln || 0).toFixed(2)),
            bossHp: b ? Math.round(b.hp) : null, hazards: b && b.hazards ? b.hazards.length : 0,
            telegraph: !!(b && b.telegraph), nearest: Math.round(nd),
            mode: state.mode, status: state.status, bullets: state.bullets.length
          };
        })()`);
        log('  DIAG ' + JSON.stringify(d));
      }
      if (snap.cleared || snap.dead) break;
      if (snap.elapsed - t0 > opts.cap) { timedOut = true; break; }
    }
    const elapsed = Math.max(0.05, snap.elapsed - t0);
    const damage = Math.max(0, setup.hpSum - snap.hpSum);
    const hpLossRaw = ((setup.player.hpMax - snap.minHp) / setup.player.hpMax) * 100;
    return {
      floor: setup.floor,
      roomType: setup.roomType,
      enemyCount: setup.enemyCount,
      hpSum: setup.hpSum,
      types: setup.types,
      typeCount: (setup.types || []).length,
      eliteCount: setup.elites,
      bossHp: setup.boss ? setup.boss.hp : null,
      bossHpMax: setup.boss ? setup.boss.hpMax : null,
      clearTime: Number(elapsed.toFixed(2)),
      timeout: timedOut,
      cleared: !!snap.cleared,
      dead: !!snap.dead,
      damage: Math.round(damage),
      dps: Number((damage / elapsed).toFixed(1)),
      hpLossPct: snap.dead ? 100 : Number(hpLossRaw.toFixed(1)),
      peakEnemies: snap.peakEnemies,
      projectilePeak: snap.peakProj,
      navTicks: snap.navTicks || 0,
      nudges: snap.nudges || 0,
      naturalTrigger: setup.naturalTrigger == null ? null : setup.naturalTrigger
    };
  }

  /**
   * 采集若干场（自动剔除仪器失效样本：卡墙 / 入场瞬死 / 空房）
   * @param {number} floor 层数
   * @param {number} count 目标有效样本数
   * @param {string} kind 'battle' | 'boss'
   * @returns {Promise<Object[]>}
   */
  async function collect(floor, count, kind, mode) {
    const rows = [];
    let attempts = 0;
    const maxAttempts = count * 2 + 6;
    const fightOpts = mode === 'invincible'
      ? { invincible: true, infiniteAether: true, cap: kind === 'boss' ? BOSS_CAP : CAP }
      : { cap: kind === 'boss' ? BOSS_CAP : CAP };
    while (rows.filter((r) => !r.invalid).length < count && attempts < maxAttempts) {
      attempts += 1;
      const setup = kind === 'boss' ? await setupBoss(floor, 1) : await setupBattle(floor, 1);
      if (!setup.ok || setup.enemyCount === 0) {
        rows.push({ floor: floor, kind: kind, invalid: true, invalidReason: setup.invalidReason || 'empty-room',
          rollouts: setup.rollouts || 0, enemyCount: 0, hpSum: 0, clearTime: null, dps: 0, hpLossPct: 0,
          dead: false, cleared: false, timeout: false, roomType: setup.roomType || null, mode: mode || 'real' });
        log(`  ${kind} f${floor} 试${attempts} 剔除：${setup.invalidReason || 'empty-room'}`);
        continue;
      }
      const row = await runFight(setup, fightOpts);
      row.kind = kind;
      row.mode = mode || 'real';
      const stuck = !row.cleared && row.dps < 3;
      const spawnInstant = row.dead && row.clearTime < 1.5;
      if (stuck || spawnInstant) {
        row.invalid = true;
        row.invalidReason = stuck ? 'bot-stuck' : 'spawn-instant';
        rows.push(row);
        log(`  ${kind} f${floor} 试${attempts} 剔除：${row.invalidReason}（${row.clearTime}s DPS${row.dps}）`);
        continue;
      }
      rows.push(row);
      log(`  ${kind} f${floor} [${row.mode}] 试${attempts}：${row.clearTime}s 损血${row.hpLossPct}% 敌${row.enemyCount} 总血${Math.round(row.hpSum)}`
        + `${row.dead ? ' 死亡' : ''}${row.timeout ? ' 超时' : ''}`);
    }
    return rows;
  }

  /**
   * 跑完某一档的所有样本
   * @param {string} tier 难度 id
   * @returns {Promise<Object>}
   */
  async function runTier(tier) {
    await ev(`(() => { setDifficulty('${tier}'); state.difficulty = '${tier}'; return state.difficulty; })()`);
    await sleep(150);
    const data = { tier: tier, battle: {}, boss: {}, bossInv: {}, hpSumByFloor: {} };
    for (let f = 6; f <= 10; f += 1) {
      if (ONLY_FLOORS.length && ONLY_FLOORS.indexOf(f) < 0) continue;
      if (ONLY_KIND !== 'boss') data.battle[f] = await collect(f, BATTLE_SAMPLES, 'battle', 'real');
      const valid = (data.battle[f] || []).filter((r) => !r.invalid);
      data.hpSumByFloor[f] = valid.length ? Math.round(valid.reduce((s, r) => s + r.hpSum, 0) / valid.length) : 0;
    }
    if (ONLY_KIND !== 'battle') {
      for (const f of [6, 10]) {
        if (ONLY_FLOORS.length && ONLY_FLOORS.indexOf(f) < 0) continue;
        data.boss[f] = await collect(f, BOSS_SAMPLES, 'boss', 'real');
        data.bossInv[f] = await collect(f, BOSS_INV_SAMPLES, 'boss', 'invincible');
      }
    }
    return data;
  }

  // ---------- 开始采样 ----------
  log('采样开始（F6–F10 × 三档 + Boss F6/F10；F1–F5 为共享教学基线）');
  const shared = { battle: {}, hpSumByFloor: {} };
  await ev(`(() => { setDifficulty('normal'); state.difficulty = 'normal'; return true; })()`);
  for (let f = 1; f <= 5; f += 1) {
    if (ONLY_FLOORS.length || ONLY_KIND === 'boss') continue;
    shared.battle[f] = await collect(f, SHARED_SAMPLES, 'battle', 'real');
    const valid = shared.battle[f].filter((r) => !r.invalid);
    shared.hpSumByFloor[f] = valid.length ? Math.round(valid.reduce((s, r) => s + r.hpSum, 0) / valid.length) : 0;
  }

  const tiers = {};
  for (const tier of TIERS_RUN) {
    log(`===== 难度 ${TIER_LABEL[tier]}（${tier}）=====`);
    tiers[tier] = await runTier(tier);
  }

  // 调试过滤模式：只落盘原始数据，不做断言（便于逐层逐档复跑）
  if (ONLY_TIERS.length || ONLY_FLOORS.length || ONLY_KIND) {
    fs.writeFileSync(RESULT_JSON, JSON.stringify({ shared: shared, tiers: tiers, debug: true }, null, 2), 'utf8');
    log('调试模式结束（未跑断言）');
    ws.close();
    if (EDGE_PROC) killEdge(EDGE_PROC);
    process.exit(0);
  }

  // ---------- 汇总 ----------
  /**
   * 从一组样本里挑有效行
   * @param {Object[]} rows
   * @returns {Object[]}
   */
  const validOf = (rows) => (rows || []).filter((r) => !r.invalid);

  const perTier = {};
  for (const tier of TIERS) {
    const t = tiers[tier];
    const f6to10 = [];
    const hpSums = [];
    for (let f = 6; f <= 10; f += 1) {
      const rows = validOf(t.battle[f]);
      hpSums.push(t.hpSumByFloor[f]);
      rows.forEach((r) => f6to10.push(r));
    }
    const allBattles = f6to10;
    const bossRows = [...validOf(t.boss[6]), ...validOf(t.boss[10])];
    perTier[tier] = {
      hpSumByFloor: { 6: t.hpSumByFloor[6], 7: t.hpSumByFloor[7], 8: t.hpSumByFloor[8], 9: t.hpSumByFloor[9], 10: t.hpSumByFloor[10] },
      hpSumTotalF6to10: hpSums.reduce((a, b) => a + b, 0),
      clearTime: summarize(allBattles.map((r) => r.clearTime)),
      clearTimeByFloor: Object.fromEntries([6, 7, 8, 9, 10].map((f) => [f, summarize(validOf(t.battle[f]).map((r) => r.clearTime))])),
      hpLoss: summarize(allBattles.map((r) => r.hpLossPct)),
      hpLossMax: allBattles.length ? Math.max(...allBattles.map((r) => r.hpLossPct)) : 0,
      deaths: allBattles.filter((r) => r.dead).length,
      deathRate: allBattles.length ? Number((allBattles.filter((r) => r.dead).length / allBattles.length).toFixed(3)) : 0,
      clearRate: allBattles.length ? Number((allBattles.filter((r) => r.cleared).length / allBattles.length).toFixed(3)) : 0,
      timeoutRate: allBattles.length ? Number((allBattles.filter((r) => r.timeout).length / allBattles.length).toFixed(3)) : 0,
      boss: {
        clearTime: summarize(bossRows.map((r) => r.clearTime)),
        hpLoss: summarize(bossRows.map((r) => r.hpLossPct)),
        deaths: bossRows.filter((r) => r.dead).length,
        deathRate: bossRows.length ? Number((bossRows.filter((r) => r.dead).length / bossRows.length).toFixed(3)) : 0,
        hpSum: bossRows.length ? Math.round(bossRows.reduce((s, r) => s + r.hpSum, 0) / bossRows.length) : 0,
        timeout: bossRows.filter((r) => r.timeout).length
      }
    };
  }
  const sharedValid = [];
  const sharedHp = [];
  const sharedByFloor = {};
  for (let f = 1; f <= 5; f += 1) {
    const rows = validOf(shared.battle[f]);
    rows.forEach((r) => sharedValid.push(r));
    sharedHp.push(shared.hpSumByFloor[f]);
    sharedByFloor[f] = summarize(rows.map((r) => r.clearTime));
  }
  perTier.shared = {
    hpSumByFloor: Object.fromEntries([1, 2, 3, 4, 5].map((f) => [f, shared.hpSumByFloor[f]])),
    clearTime: summarize(sharedValid.map((r) => r.clearTime)),
    clearTimeByFloor: sharedByFloor,
    hpLoss: summarize(sharedValid.map((r) => r.hpLossPct)),
    hpLossMax: sharedValid.length ? Math.max(...sharedValid.map((r) => r.hpLossPct)) : 0,
    deaths: sharedValid.filter((r) => r.dead).length,
    deathRate: sharedValid.length ? Number((sharedValid.filter((r) => r.dead).length / sharedValid.length).toFixed(3)) : 0,
    clearRate: sharedValid.length ? Number((sharedValid.filter((r) => r.cleared).length / sharedValid.length).toFixed(3)) : 0
  };
  // ---------- 口径修正：清场时长只取真正清完的样本；Boss 拆成真实/无敌两口径 ----------
  /**
   * 清场时长只取"真正清完"的样本，死亡/超时时刻不能当作清场时长
   * @param {Object[]} rows
   * @returns {number[]}
   */
  const clearTimesOf = (rows) => validOf(rows).filter((r) => r.cleared && !r.timeout).map((r) => r.clearTime);
  /**
   * 真实模式统计块
   * @param {Object[]} rows
   * @returns {Object}
   */
  const deathBlockOf = (rows) => {
    const v = validOf(rows);
    return {
      n: v.length,
      deaths: v.filter((r) => r.dead).length,
      deathRate: v.length ? Number((v.filter((r) => r.dead).length / v.length).toFixed(3)) : 0,
      clearRate: v.length ? Number((v.filter((r) => r.cleared).length / v.length).toFixed(3)) : 0,
      timeout: v.filter((r) => r.timeout).length,
      hpLoss: summarize(v.map((r) => r.hpLossPct)),
      hpLossMax: v.length ? Math.max(...v.map((r) => r.hpLossPct)) : 0,
      survival: summarize(v.map((r) => r.clearTime))
    };
  };
  for (const tier of TIERS) {
    const t = tiers[tier];
    const rowsByFloor = {};
    for (let f = 6; f <= 10; f += 1) rowsByFloor[f] = validOf(t.battle[f]);
    const allBattles = [];
    for (let f = 6; f <= 10; f += 1) rowsByFloor[f].forEach((r) => allBattles.push(r));
    const bossReal = [...validOf(t.boss[6]), ...validOf(t.boss[10])];
    const bossInv = [...validOf(t.bossInv[6]), ...validOf(t.bossInv[10])];
    perTier[tier].ttkByFloor = {};
    for (let f = 6; f <= 10; f += 1) perTier[tier].ttkByFloor[f] = summarize(clearTimesOf(t.battle[f]));
    perTier[tier].hpSumTotalF6to10 = [6, 7, 8, 9, 10].reduce((s, f) => s + (t.hpSumByFloor[f] || 0), 0);
    perTier[tier].bossReal = deathBlockOf(bossReal);
    perTier[tier].bossInv = {
      n: bossInv.length,
      ttk: summarize(clearTimesOf(bossInv)),
      timeout: bossInv.filter((r) => r.timeout).length,
      hpSum: bossInv.length ? Math.round(bossInv.reduce((s, r) => s + r.hpSum, 0) / bossInv.length) : 0
    };
  }
  perTier.shared.clearTime = summarize(clearTimesOf(sharedValid));

  agg.notes.perTier = perTier;
  agg.notes.tiersConfig = await ev(`(() => {
    const out = {};
    ['easy','normal','nightmare'].forEach((k) => {
      const m = DIFFICULTY_CONFIG.modes[k];
      out[k] = { hpMul: m.hpMul, countMul: m.countMul, speedMul: m.speedMul, damageMul: m.damageMul,
        dropMul: m.dropMul, eliteHpMul: m.eliteHpMul, pressure: m.pressure };
    });
    return out;
  })()`);

  // ---------- 断言 ----------
  const E = perTier.easy; const N = perTier.normal; const H = perTier.nightmare;

  // A1 三档同层同房型总血差异（F7 普通战斗房，取配置生成本身的确定值）
  const hp7 = { easy: E.hpSumByFloor[7], normal: N.hpSumByFloor[7], nightmare: H.hpSumByFloor[7] };
  check('A1 三档 F7 战斗房总血：简单 < 普通 < 困难', hp7.easy < hp7.normal && hp7.normal < hp7.nightmare, hp7);

  // A2 三档承伤差异（F6–F10 全部战斗房样本的损血均值，简单 < 困难）
  const lossMean = { easy: E.hpLoss.mean, normal: N.hpLoss.mean, nightmare: H.hpLoss.mean };
  check('A2 三档承伤均值：简单 < 困难（可测差异）', lossMean.easy < lossMean.nightmare - 0.5, lossMean);

  // A3 简单档：前五层能轻松打完（教学区固定 normal 血池，bot 属"下限口径"，给 10% 容差）
  check('A3 简单档前五层：清场率 ≥ 90%', perTier.shared.clearRate >= 0.9,
    { clearRate: perTier.shared.clearRate, deathRate: perTier.shared.deathRate });
  check('A3b 简单档前五层：死亡 ≤ 10% 且平均损血 ≤ 35%',
    perTier.shared.deathRate <= 0.1 && perTier.shared.hpLoss.mean <= 35,
    { deathRate: perTier.shared.deathRate, hpLoss: perTier.shared.hpLoss, clearTime: perTier.shared.clearTime });

  // A4 普通档：清场时长落在既定曲线上（BALANCE_REPORT 目标 ±40% 容差）
  const LEGACY_TARGET = { 6: 21.5, 7: 23.7, 8: 26.2, 9: 29, 10: 35 };
  const normalTtkDev = {};
  let normalTtkOk = 0;
  for (let f = 6; f <= 10; f += 1) {
    const ttk = N.ttkByFloor[f] ? N.ttkByFloor[f].median : 0;
    if (!ttk) { normalTtkDev[f] = null; continue; }
    const dev = Number((ttk / LEGACY_TARGET[f]).toFixed(2));
    normalTtkDev[f] = { ttk: ttk, dev: dev, ok: dev >= 0.6 && dev <= 1.4 };
    if (normalTtkDev[f].ok) normalTtkOk += 1;
  }
  check('A4 普通档至少四层清场时长落在目标曲线 ±40%', normalTtkOk >= 4, normalTtkDev);
  check('A4b 普通档 F6–F10 真实死亡 ≤ 30%', N.deathRate <= 0.3, { deathRate: N.deathRate, deaths: N.deaths });

  // A5 困难档：有压迫感但可赢（死亡 ≤ 60%、清场 ≥ 40%、无超时）
  check('A5 困难档不是必死：F6–F10 死亡 ≤ 60%', H.deathRate <= 0.6, { deathRate: H.deathRate, deaths: H.deaths });
  check('A5b 困难档可赢：清场率 ≥ 40% 且超时 0', H.clearRate >= 0.4 && H.timeoutRate === 0,
    { clearRate: H.clearRate, timeoutRate: H.timeoutRate });

  // A6 每档都不是"无威胁"：简单档也必须至少出现过一次明显损血
  check('A6 简单档无威胁判定：F6–F10 最大损血 ≥ 10%',
    E.hpLossMax >= 10, { max: E.hpLossMax, mean: E.hpLoss.mean });

  // A7 Boss：无敌口径只测击杀时长；真实口径测死亡期望
  check('A7 三档 Boss 无敌口径均可击杀且无超时',
    E.bossInv.timeout === 0 && N.bossInv.timeout === 0 && H.bossInv.timeout === 0,
    { easy: E.bossInv, normal: N.bossInv, nightmare: H.bossInv });
  check('A7b Boss 击杀时长均落在 30–90s（可赢）',
    E.bossInv.ttk.median >= 30 && N.bossInv.ttk.median >= 30 && H.bossInv.ttk.median <= 90,
    { easy: E.bossInv.ttk.median, normal: N.bossInv.ttk.median, nightmare: H.bossInv.ttk.median });
  check('A7c Boss 真实死亡与难度档位无关（三档差 ≤20pp）', Math.abs(E.bossReal.deathRate - H.bossReal.deathRate) <= 0.2,
    { easy: E.bossReal.deathRate, normal: N.bossReal.deathRate, nightmare: H.bossReal.deathRate,
      survivalMedian: { easy: E.bossReal.survival.median, normal: N.bossReal.survival.median, nightmare: H.bossReal.survival.median },
      note: 'bot 不会主动用冲刺 i-frame 躲接触/重招，属量尺下限；人类可用冲刺与升级，故不据此判"设计必死"' });
  check('A7d Boss 三档血量不递减（简单 ≤ 困难）',
    E.bossInv.hpSum <= H.bossInv.hpSum,
    { easyHp: E.bossInv.hpSum, normalHp: N.bossInv.hpSum, nightmareHp: H.bossInv.hpSum });

  // A8 前五层：只吃"压力系数"，不吃 hpMul；第六层起才是完整三档分化
  const tutorialBand = await ev(`(() => {
    const probe = (mode, floor) => {
      setDifficulty(mode); state.difficulty = mode;
      state.enemies.length = 0;
      const en = spawnEnemy('assembler', state.player.x + 60, state.player.y, floor, { roomId: -1 });
      const hp = en.hp;
      state.enemies.length = 0;
      return hp;
    };
    const out = {};
    ['easy','normal','nightmare'].forEach((m) => {
      out[m + '5'] = probe(m, 5);
      out[m + '7'] = probe(m, 7);
    });
    return out;
  })()`);
  const ratio5 = Number((tutorialBand.nightmare5 / tutorialBand.easy5).toFixed(2));
  const ratio7 = Number((tutorialBand.nightmare7 / tutorialBand.easy7).toFixed(2));
  check('A8 前五层三档差异 ≤1.3x、第六层起 ≥1.6x',
    ratio5 <= 1.3 && ratio7 >= 1.6,
    { ratio5: ratio5, ratio7: ratio7, probe: tutorialBand });

  const errors = await ev('window.__roamDebug.errors()');
  check('A9 运行无报错', Array.isArray(errors) && errors.length === 0 && runtimeErrors.length === 0,
    { page: errors, cdp: runtimeErrors.slice(0, 3) });
  agg.notes.errors = errors;

  // 截图：三档 Boss 战各一张（≤4 张专项上限）
  await haltRaf();
  for (const tier of TIERS) {
    await ev(`(() => { setDifficulty('${tier}'); state.difficulty = '${tier}'; return true; })()`);
    const setup = await setupBoss(10, 1);
    if (!setup.ok) continue;
    await ev(`__bal.reset(${setup.roomId}, ${setup.hpSum}, { invincible: true, infiniteAether: true })`);
    for (let i = 0; i < 90; i += 1) await ev('__balStep(12)');
    await resumeRaf();
    await ev('__bal.tick()');
    await sleep(200);
    await shot(`diff3_boss_f10_${tier}.png`);
    await haltRaf();
  }

  fs.writeFileSync(RESULT_JSON, JSON.stringify(agg, null, 2), 'utf8');
  const failed = agg.assertions.filter((a) => !a.ok);
  console.log('==== 三档实测：' + (agg.assertions.length - failed.length) + '/' + agg.assertions.length + ' 通过 ====');
  if (failed.length) console.log('失败项：' + failed.map((a) => a.name).join(' | '));
  ws.close();
  if (EDGE_PROC) killEdge(EDGE_PROC);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error('FATAL', e);
  if (EDGE_PROC) { try { killEdge(EDGE_PROC); } catch (x) {} }
  process.exit(2);
});
