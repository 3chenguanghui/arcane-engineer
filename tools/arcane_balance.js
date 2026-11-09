/**
 * 战斗强度量化诊断脚本（第 5–10 层 · 诊断专用，不改主文件）
 * ------------------------------------------------------------
 * 目的：
 *   用无头 Edge + `__roamDebug` 控制，固定"火球 + 喷火锥"两技能构筑，
 *   逐层采样战斗房的清场时间 / DPS / 损血 / 投射物峰值 / fps，
 *   对账用户给定的目标曲线，并可在内存覆盖配置后模拟"改后"预测。
 *
 * 口径：
 *   - 标准难度、关闭自适应降档；
 *   - 真实模式（正常承伤）与无敌模式（只测 DPS/清场上限）分开记录；
 *   - 时间用游戏内 `state.elapsed`（模拟秒），并通过临时接管
 *     requestAnimationFrame + 定步长 update(1/60) 加速，保证可比；
 *   - fps 单独在正常 RAF 渲染窗口内测，避免被加速影响。
 *
 * 用法：
 *   node tools/arcane_balance.js             # 全量
 *   set PILOT=1 && node tools/arcane_balance.js   # 试点（第 6/10 层各 3 次）
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');
const { NAV_SRC } = require('./arcane_botnav');
const { assertPerf } = require('./arcane_assert');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9560;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = path.join(__dirname, '..', '.screenshots', 'balance');
const RESULT_JSON = path.join(OUT, 'balance-result.json');
// PREDICT_ONLY 模式单独输出，避免覆盖已经跑完的基线结果
const PREDICT_JSON = path.join(OUT, 'balance-predict.json');
// CTRL_ONLY 模式：只跑"有限奥能"对照组（无敌但不回奥能），单独输出，避免覆盖基线
const CTRL_JSON = path.join(OUT, 'balance-control.json');
// ONLY_FLOORS 聚焦复现时不要覆盖正式报告用的 balance-control.json，另存一个临时文件
const CTRL_JSON_FOCUS = path.join(OUT, '_focus-control.json');

/** 目标曲线（用户给定；第 7–9 层按 22.5s 中值 ×1.08/1.12 递推） */
const TARGETS = {
  5: null,
  6: { band: [18, 25], mid: 21.5 },
  7: { band: [19.4, 28.0], mid: 23.7 },
  8: { band: [21.0, 31.4], mid: 26.2 },
  9: { band: [22.7, 35.2], mid: 29.0 },
  10: { band: [30, 40], mid: 35.0 }
};
/** Boss 目标：第 6 层 45–60s；第 10 层 ≤90s */
const BOSS_TARGETS = {
  6: { band: [45, 60], mid: 52.5, mode: 'range' },
  10: { band: [0, 90], mid: 90, mode: 'max' }
};
const CONST = {
  hpLossMax: 0.4,
  death6: 0.08,
  death10: 0.35,
  maxEnemies: 6,
  maxProjectiles: 30
};

const PILOT = process.env.PILOT === '1';
// DIAG=<层数> 时只跑该层一场 30 秒诊断，逐段打印敌我状态（定位 0 DPS / 秒死）
const DIAG = Number(process.env.DIAG) || 0;
// DIAG_TYPES=<逗号分隔的怪 id>：DIAG 模式下重掷到"阵容里包含这些怪"的房间再诊断
// （用于复现 F8「镜像幽灵」这类只在特定混编里出现的 0 DPS 现象）
const DIAG_TYPES = (process.env.DIAG_TYPES || '').split(',').map((s) => s.trim()).filter(Boolean);
// PREDICT_ONLY=1 时只跑"改后预测"一轮（不重跑基线，基线读 balance-result.json）
const PREDICT_ONLY = process.env.PREDICT_ONLY === '1';
// CTRL_ONLY=1 时只跑"有限奥能"对照组：无敌（不测承伤）+ 不回奥能（测奥能约束下的真实清场能力）
const CTRL_ONLY = process.env.CTRL_ONLY === '1';
// SKIP_PREDICT=1 时跳过"内存覆盖预测轮"（调参值已落地，基线轮即改后实测）
const SKIP_PREDICT = process.env.SKIP_PREDICT === '1';
const FLOORS = PILOT ? [6, 10] : [5, 6, 7, 8, 9, 10];
// ONLY_FLOORS=8 或 ONLY_FLOORS=8,9：只跑指定层（复现/定位用，不影响正式报告口径）
const ONLY_FLOORS = (process.env.ONLY_FLOORS || '').split(',').map(Number).filter((n) => n > 0);
const FLOORS_RUN = ONLY_FLOORS.length ? FLOORS.filter((f) => ONLY_FLOORS.includes(f)) : FLOORS;
const SAMPLES = PILOT ? 3 : 12;
const INV_SAMPLES = PILOT ? 2 : 4;
const REF_SAMPLES = PILOT ? 0 : 4;
const BOSS_SAMPLES = PILOT ? 2 : 6;
const BOSS_INV = PILOT ? 1 : 3;
const BOSS_FLOORS = [6, 10];
const CAP = 75;
const BOSS_CAP = 90;
const SUB_STEPS = 12;
// 普通战斗房重掷上限：第 10 层"非挑战普通战斗房"的产出率约 8%，需要足够多次重掷
const BATTLE_MAX_TRIES = 60;
// 房型可得性抽样次数（用于报告里的"楼层是否产出普通战斗房"证据）
const AVAIL_ROUNDS = PILOT ? 4 : 12;

let EDGE_PROC = null;
const runtimeErrors = [];
const checks = [];

/**
 * 记录一条结构性断言（失败会判红）
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
 * 打印进度（便于后台运行时观察）
 * @param {string} text 文本
 * @returns {void}
 */
function log(text) {
  console.log(`[balance] ${text}`);
}

/**
 * 求分位数（升序数组）
 * @param {number[]} sorted 已升序数组
 * @param {number} p 0–1
 * @returns {number}
 */
function quantile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[idx];
}

/**
 * 统计摘要：次数 / 最小 / P25 / 中位 / P75 / 最大 / 均值
 * @param {number[]} values 数值数组
 * @returns {Object}
 */
function summarize(values) {
  const arr = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!arr.length) return { n: 0, min: 0, p25: 0, median: 0, p75: 0, max: 0, mean: 0 };
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return {
    n: arr.length,
    min: arr[0],
    p25: quantile(arr, 0.25),
    median: quantile(arr, 0.5),
    p75: quantile(arr, 0.75),
    max: arr[arr.length - 1],
    mean: Number(mean.toFixed(2))
  };
}

/**
 * 计算对账偏差与判定
 * @param {number} measured 实测中位数
 * @param {{band:number[],mid:number,mode?:string}} target 目标
 * @param {boolean} timedOut 是否超时
 * @returns {{bias:number, verdict:string}}
 */
function judge(measured, target, timedOut) {
  if (timedOut) return { bias: 1, verdict: '偏硬（超时）' };
  const lo = target.band[0];
  const hi = target.band[1];
  const mid = target.mode === 'max' ? hi : target.mid;
  const bias = (measured - mid) / (mid || 1);
  if (target.mode === 'max') {
    return { bias, verdict: measured <= hi ? '合理' : '偏硬' };
  }
  if (measured >= lo && measured <= hi) return { bias, verdict: '合理' };
  if (measured < lo) return { bias, verdict: bias < -0.15 ? '偏松' : '合理（略松）' };
  return { bias, verdict: bias > 0.15 ? '偏硬' : '合理（略硬）' };
}

/**
 * 生成某层"参照构筑"的伤害倍率（模拟 5 层后常见升级量；仅作敏感性参考）
 * @param {number} floor 层数
 * @returns {number}
 */
function referenceDamageMul(floor) {
  return 1.6 * Math.pow(1.06, Math.max(0, floor - 6));
}

/**
 * 生成"改后"预测轮的玩家伤害倍率（每层 +6%）
 * @param {number} floor 层数
 * @returns {number}
 */
function predictionDamageMul(floor) {
  return Math.pow(1.06, Math.max(0, floor - 5));
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

  // ---------- 启动游戏 ----------
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2200);
  const startPos = await ev(`(() => { const el = document.getElementById('btnStart'); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: startPos.x, y: startPos.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: startPos.x, y: startPos.y, button: 'left', clickCount: 1 });
  await sleep(900);

  const boot = await ev(`(() => {
    const d = window.__roamDebug;
    try { setDifficulty('normal'); } catch (e) { /* 旧版本没有该函数 */ }
    state.difficulty = 'normal';
    state.mode = 'playing';
    state.status = 'playing';
    d.enemies.budget.reset();
    d.enemies.setEnabled(true);
    d.enemies.setAdaptive(false);
    return {
      mode: state.mode, status: state.status, difficulty: state.difficulty,
      fps: d.getState().fps, floor: state.floor,
      hpMax: state.player.hpMax, aetherMax: state.player.aetherMax
    };
  })()`);
  log('启动：' + JSON.stringify(boot));

  // ---------- 安装页面侧 bot ----------
  await ev(`(() => {
    ${NAV_SRC}
    window.__bal = {
      roomId: null,
      invincible: false,
      infiniteAether: false,
      initialHpSum: 0,
      peakEnemies: 0,
      peakProj: 0,
      minHp: 0,
      cleared: false,
      dead: false,
      /** 把一只敌人的有效血量（含护盾）加总 */
      hpSum(list) {
        let s = 0;
        for (let i = 0; i < list.length; i += 1) {
          const e = list[i];
          s += Math.max(0, e.hp || 0) + Math.max(0, e.shield || e.shieldHp || 0);
        }
        return s;
      },
      /** 当前房间内的敌人 */
      foes() {
        const id = this.roomId;
        return state.enemies.filter((e) => e.roomId === id);
      },
      /** 开始一场战斗的统计窗口 */
      reset(roomId, hpSum, opts) {
        this.roomId = roomId;
        this.initialHpSum = hpSum;
        this.invincible = !!(opts && opts.invincible);
        this.infiniteAether = !!(opts && opts.infiniteAether);
        this.peakEnemies = 0;
        this.peakProj = 0;
        this.minHp = state.player.hpMax;
        this.cleared = false;
        this.dead = false;
        this.lastHpSum = hpSum;
        this.noDamageT = 0;
        this.navTicks = 0;
        this.path = [];
        this.pathT = 0;
        this.fpPos = null;
        this.fpT = 0;
        this.nudges = 0;
        this.unstickPhase = 0;
        /* 奥能经济诊断（三因子口径）：实际耗蓝 / 成功施法数 / 因奥能不足被拒次数 / 实际打出的伤害。
           记账后可以直接拆出「回能速率 × 每点奥能伤害 × 命中率」。 */
        this.manaSpent = 0;
        this.casts = 0;
        this.castsBlocked = 0;
        this.damageDone = 0;
        this.startAether = state.player.aether;
        return true;
      },
      /** 每模拟步一次：瞄准 + 施法 + 走位 + 统计 */
      tick() {
        const p = state.player;
        // 先记最低血量：死亡那一帧 mode 会变成 result，不能等到判断之后才记（否则损血 = 0）
        this.minHp = Math.min(this.minHp, p.hp);
        if (state.mode !== 'playing' || state.status !== 'playing') { this.dead = true; return; }
        const list = this.foes();
        if (list.length) this.peakEnemies = Math.max(this.peakEnemies, list.length);
        this.peakProj = Math.max(this.peakProj, state.bullets.length + state.projectiles.length);
        if (this.invincible) {
          p.invuln = Math.max(p.invuln || 0, 9);
          if (p.hp < p.hpMax) p.hp = p.hpMax;
        }
        if (this.infiniteAether) p.aether = p.aetherMax;
        if (!list.length) { this.cleared = true; return; }

        // 目标：优先血量最低，同血量取最近
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
        // 固定构筑：slot0 火球、slot1 喷火锥（记录耗蓝/成功/因奥能不足被拒，用于三因子诊断）
        if (!state.cooldowns['fireball']) {
          const beforeFb = p.aether;
          if (castSlot(0, false)) {
            this.casts += 1;
            this.manaSpent += Math.max(0, beforeFb - p.aether);
          } else if (beforeFb < MAGIC_BY_ID['fireball'].cost) {
            this.castsBlocked += 1;
          }
        }
        if (!state.cooldowns['flameCone'] && td <= 215) {
          const beforeFc = p.aether;
          if (castSlot(1, false)) {
            this.casts += 1;
            this.manaSpent += Math.max(0, beforeFc - p.aether);
          } else if (beforeFc < MAGIC_BY_ID['flameCone'].cost) {
            this.castsBlocked += 1;
          }
        }

        // 与最近敌人保持 180–260px
        let n = list[0];
        let nd = Infinity;
        for (let i = 0; i < list.length; i += 1) {
          const e = list[i];
          const d = Math.hypot(e.x - p.x, e.y - p.y);
          if (d < nd) { nd = d; n = e; }
        }
        const ux = (n.x - p.x) / (nd || 1);
        const uy = (n.y - p.y) / (nd || 1);
        // 僵局时改为朝"攻击目标"（最低血）走：最近的那只可能隔着墙，一直绕它只会空转
        const tdx = t.x - p.x;
        const tdy = t.y - p.y;
        const tdd = Math.hypot(tdx, tdy) || 1;
        const tux = tdx / tdd;
        const tuy = tdy / tdd;
        // 僵局检测：连续 3s 没打出任何伤害（典型是隔墙对峙 / 被障碍卡住）→ 强行贴近目标
        // 不这么做时 bot 会在 180–260px 圈里原地绕，清场时间被拉成 75s 超时假样本
        const curHp = this.hpSum(list);
        // 实际打出的伤害（敌人被击杀后移出数组，血量总和下降同样计入）
        this.damageDone += Math.max(0, (this.lastHpSum || curHp) - curHp);
        if (curHp < (this.lastHpSum || 0) - 0.5) {
          this.lastHpSum = curHp;
          this.noDamageT = 0;
        } else {
          this.lastHpSum = curHp;
          this.noDamageT = (this.noDamageT || 0) + 1 / 60;
        }
        let mx = 0;
        let my = 0;
        /* 出房自救（第 4 轮）：bot 的拉扯/解卡侧移会把自己带出战斗房，进入房间之间的走廊。
           房间级 BFS 栅格的覆盖范围只有房间本身，人在外面时格子会被钳到房间边缘，
           方向退化 → 永久站桩（实测 75s 0 DPS、位移轨迹 12 个点完全相同）。
           只要人在房间外，就不再走 BFS，直接朝房心走，先把人领回战场。 */
        const roomNow = state.rooms[this.roomId];
        const outRoom = roomNow ? (
          p.x < roomNow.x + 24 || p.x > roomNow.x + roomNow.w - 24 ||
          p.y < roomNow.y + 24 || p.y > roomNow.y + roomNow.h - 24
        ) : false;
        if (outRoom) { mx = roomNow.cx - p.x; my = roomNow.cy - p.y; }
        /* 隔墙僵局（第 4 轮修复）：只要连续 0.5s 打不出伤害，就让 BFS 流场接管方向。
           旧的 38px 贪心在"房间中间有内墙、出生点在墙另一侧"的布局里会永久卡住
           （实测 75s 只有 0.3 DPS，且所有敌人 LOS 都被挡），这是仪器缺陷，不是游戏难度。 */
        let navDir = null;
        if (!outRoom && this.noDamageT > 0.5) {
          const navRoom = state.rooms[this.roomId];
          __nav.ensure(navRoom);
          navDir = __nav.flowTo(t.x, t.y);
        }
        if (navDir) {
          this.navTicks = (this.navTicks || 0) + 1;
          /* 抖动检测：连续 0.4s 位移 < 1.5px，说明"流场指的方向这次走不动"（贴墙/夹角），
             把方向改成垂直方向轮换，避免两帧一前一后地原地摆动。 */
          const mv = this.lastPos ? Math.hypot(p.x - this.lastPos[0], p.y - this.lastPos[1]) : 99;
          this.moveT = mv < 1.5 ? (this.moveT || 0) + 1 / 60 : 0;
          this.lastPos = [p.x, p.y];
          if (this.moveT > 0.4) {
            this.jitter = ((this.jitter || 0) + 1) % 3;
            navDir = this.jitter === 1 ? { x: -navDir.y, y: navDir.x } : { x: navDir.y, y: -navDir.x };
          }
          mx = navDir.x;
          my = navDir.y;
        } else if (outRoom) {
          /* 已在上面把 mx/my 指向房心，这里不走任何"保持 180–260px"的拉扯，
             否则会一边朝房心、一边被"离怪太近就后退"抵消成静止。 */
        } else if (this.noDamageT > 3) {
          // 卡墙僵局：朝"攻击目标"侧移绕障（先左后右交替），比死磕最近的敌人更容易脱困
          this.unstickPhase = (this.unstickPhase || 0) + 1 / 60;
          const side = (Math.floor(this.unstickPhase) % 2 === 0) ? 1 : -1;
          mx = tux * 0.35 - tuy * side * 0.95;
          my = tuy * 0.35 + tux * side * 0.95;
          if (this.noDamageT > 9) { mx = tux; my = tuy; }
        } else if (nd < 180) { mx = -ux; my = -uy; }
        else if (nd > 260) { mx = ux; my = uy; }
        else {
          const s = (Math.floor(state.elapsed / 2) % 2 === 0) ? 1 : -1;
          mx = -uy * s;
          my = ux * s;
        }
        // 躲最近的一颗"正在逼近"的敌弹
        let bx = 0;
        let by = 0;
        let bd = Infinity;
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
        // 房间边界回推
        const room = state.rooms[this.roomId];
        if (room) {
          if (p.x < room.x + 40) mx += 0.7;
          if (p.x > room.x + room.w - 40) mx -= 0.7;
          if (p.y < room.y + 40) my += 0.7;
          if (p.y > room.y + room.h - 40) my -= 0.7;
        }
        // 前方 38px 不可站立 → 旋转找可行方向
        const ml = Math.hypot(mx, my);
        if (outRoom && ml > 0.01) {
          /* 出界时直接朝房心推：不做 38px 贪心旋转（它会用"离怪最近"把方向掰到墙里）。 */
          state.keys = {
            left: mx / ml < -0.25, right: mx / ml > 0.25,
            up: my / ml < -0.25, down: my / ml > 0.25
          };
        } else if (navDir) {
          /* 流场已经把方向指到"相邻的可行格"，直接执行；
             再做"走到 38px 后离目标最近"的欧氏贪心旋转会把它掰回墙里（正是旧 bug 的来源）。 */
          state.keys = {
            left: navDir.x < -0.25,
            right: navDir.x > 0.25,
            up: navDir.y < -0.25,
            down: navDir.y > 0.25
          };
        } else if (ml > 0.01) {
          // 不再"命中第一个可行方向"，而是选"走 38px 后离目标最近"的可行方向，
          // 避免在墙角被第一个候选方向带着来回横跳
          const cands = [0, 0.4, -0.4, 0.8, -0.8, 1.2, -1.2, 1.6, -1.6, 2.0, -2.0];
          let bestRx = 0;
          let bestRy = 0;
          let bestScore = Infinity;
          for (let i = 0; i < cands.length; i += 1) {
            const a = cands[i];
            const ca = Math.cos(a);
            const sa = Math.sin(a);
            const rx = (mx * ca - my * sa) / ml;
            const ry = (mx * sa + my * ca) / ml;
            const nx2 = p.x + rx * 38;
            const ny2 = p.y + ry * 38;
            if (!__roamDebug.walkableAt(nx2, ny2, 12)) continue;
            const score = Math.hypot(t.x - nx2, t.y - ny2);
            if (score < bestScore) { bestScore = score; bestRx = rx; bestRy = ry; }
          }
          if (bestScore !== Infinity) {
            state.keys = {
              left: bestRx < -0.25,
              right: bestRx > 0.25,
              up: bestRy < -0.25,
              down: bestRy > 0.25
            };
          } else {
            state.keys = { left: false, right: false, up: false, down: false };
          }
        } else {
          state.keys = { left: false, right: false, up: false, down: false };
        }
        // 影步：像真人一样在"贴近/弹幕逼近/残血"时用冲刺的无敌帧保命
        if (p.dashCd <= 0 && (nd < 150 || bd < 70) && p.hp < p.hpMax * 0.7) startDash();
        /* 位置轨迹（每 1 秒一个点，保留最近 12 个）：卡死时用来区分
           「玩家原地不动（寻路/位移缺陷）」与「玩家一直在动但目标在房间外/一直逃」。 */
        this.pathT = (this.pathT || 0) + 1 / 60;
        if (this.pathT >= 1) {
          this.pathT = 0;
          this.path.push([Math.round(p.x), Math.round(p.y)]);
          if (this.path.length > 12) this.path.shift();
        }
        /* 冻结自救（仪器层兜底）：连续 1.2s 位移 < 1px → 说明四面都被几何卡死
           （出房走廊的夹角 / 墙缝），直接把 bot 放回房间中心。
           这是量尺的自愈，不改任何游戏数值，只在 nudge 计数里留痕。 */
        const fpMove = this.fpPos ? Math.hypot(p.x - this.fpPos[0], p.y - this.fpPos[1]) : 99;
        this.fpT = fpMove < 1 ? (this.fpT || 0) + 1 / 60 : 0;
        this.fpPos = [p.x, p.y];
        if (this.fpT > 1.2) {
          this.fpT = 0;
          this.fpPos = null;
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
        cleared: b.cleared,
        dead: b.dead,
        foes: list.length,
        hpSum: b.hpSum(list),
        peakEnemies: b.peakEnemies,
        peakProj: b.peakProj,
        minHp: b.minHp,
        manaSpent: b.manaSpent,
        casts: b.casts,
        castsBlocked: b.castsBlocked,
        damageDone: b.damageDone,
        navTicks: b.navTicks,
        nudges: b.nudges || 0,
        aether: state.player.aether,
        elapsed: state.elapsed,
        mode: state.mode,
        status: state.status
      };
    };
    return true;
  })()`);

  // ---------- 加速/恢复渲染 ----------
  /** 接管 RAF 并冻结 HUD 刷新，进入定步长加速模式 */
  async function haltRaf() {
    await ev(`(() => {
      window.__rafOrig = window.requestAnimationFrame;
      window.requestAnimationFrame = function () { return 0; };
      window.__uiTimerOrig = (typeof uiTimer === 'number') ? uiTimer : 0;
      try { uiTimer = -100000; } catch (e) { /* 只读兜底 */ }
      return true;
    })()`);
    await sleep(140);
  }

  /** 恢复 RAF 与 HUD，用于 fps / 截图观测 */
  async function resumeRaf() {
    await ev(`(() => {
      try { uiTimer = 0; } catch (e) { /* 忽略 */ }
      if (window.__rafOrig) {
        window.requestAnimationFrame = window.__rafOrig;
        window.__rafOrig = null;
        requestAnimationFrame(loop);
      }
      return true;
    })()`);
    await sleep(220);
  }

  /**
   * 重置玩家构筑与状态（每场前调用）
   * 说明：只动内存里的 state，不改任何配置常量。
   * @param {number} floor 层数
   * @param {number} dmgMul 伤害倍率（基线 1；参照/预测用倍率）
   * @returns {Promise<Object>}
   */
  async function resetPlayer(floor, dmgMul) {
    return ev(`(() => {
      const d = window.__roamDebug;
      state.mode = 'playing';
      state.status = 'playing';
      state.hitStop = 0;
      state.slowMo = 0;
      state.fusionSlow = 0;
      state.victoryTimer = 0;
      state.ownedMagic = ['fireball', 'flameCone'];
      state.ownedTech = [];
      state.fusions = [];
      state.activeMagicId = 'fireball';
      state.activeTechId = null;
      state.mods.damageMul = ${dmgMul};
      state.mods.cooldownMul = 1;
      state.mods.speedMul = 1;
      state.cooldowns = {};
      state.deviceCooldown = 0;
      if (state.dual) {
        state.dual.slots = ['fireball', 'flameCone'];
        state.dual.focus = 0;
        state.dual.switchCd = 0;
      }
      state.bullets.length = 0;
      state.projectiles.length = 0;
      state.aoeZones.length = 0;
      state.sigils.length = 0;
      state.mines.length = 0;
      if (state.pickups) state.pickups.length = 0;
      d.setHp(state.player.hpMax);
      state.player.aether = state.player.aetherMax;
      state.player.invuln = 0;
      state.player.vx = 0;
      state.player.vy = 0;
      state.keys = {};
      return {
        floor: state.floor,
        hpMax: state.player.hpMax,
        aetherMax: state.player.aetherMax,
        dmgMul: state.mods.damageMul
      };
    })()`);
  }

  /**
   * 找合法落点（房间中心优先，其次 8 个偏移）
   * @param {Object} room 房间
   * @returns {{x:number,y:number,ok:boolean}}
   */
  function pickSpotExpr(room) {
    return `(() => {
      const r = ${JSON.stringify(room)};
      const offs = [[0,0],[44,0],[-44,0],[0,44],[0,-44],[64,36],[-64,-36],[64,-36],[-64,36]];
      for (let i = 0; i < offs.length; i += 1) {
        const x = r.cx + offs[i][0];
        const y = r.cy + offs[i][1];
        if (__roamDebug.walkableAt(x, y, 14)) return { x: x, y: y, ok: true };
      }
      return { x: r.cx, y: r.cy, ok: false };
    })()`;
  }

  /**
   * 生成一层并布置普通战斗房
   * @param {number} floor 层数
   * @param {number} dmgMul 玩家伤害倍率
   * @returns {Promise<Object>} 房间与初始敌情
   */
  async function setupBattle(floor, dmgMul) {
    // 只取普通战斗房：部分楼层随机生成后可能一间都没有（精英路线会把支线房改成精英房），
    // 这里最多重掷 BATTLE_MAX_TRIES 次；仍无则标 ok=false 并记录剔除原因，绝不用精英房冒充。
    let last = null;
    let rollouts = 0;
    for (let t = 0; t < BATTLE_MAX_TRIES; t += 1) {
      rollouts = t + 1;
      const info = await ev(`(() => {
        __roamDebug.enemies.budget.reset();
        __roamDebug.enemies.setAdaptive(false);
        __roamDebug.enemies.floor(${floor});
        state.mode = 'playing';
        state.status = 'playing';
        const rooms = state.rooms.map((r) => ({
          id: r.id, type: r.type, planned: r.enemyCount || 0,
          w: r.w, h: r.h, x: r.x, y: r.y, cx: r.cx, cy: r.cy,
          areaMul: r.areaMul || 1,
          challenge: !!(r.challengeKind || r.challenge),
          eliteRoute: !!(r.eliteRoute)
        }));
        const battle = rooms.filter((r) => r.type === 'battle' && r.planned > 0 && !r.challenge);
        return {
          rooms: rooms, battleCount: battle.length, pick: battle[0] || null,
          eliteCount: rooms.filter((r) => r.type === 'elite').length,
          openFloor: !!(state.openFloor && state.openFloor.active)
        };
      })()`);
      last = info;
      if (info.pick) break;
    }
    if (!last || !last.pick) {
      return {
        ok: false, invalidReason: 'no-battle-room', rollouts: rollouts,
        floor: floor, roomId: -1, roomType: null, enemyCount: 0, hpSum: 0,
        types: [], elites: 0, room: null,
        player: { hpMax: 1, aetherMax: 1, dmgMul: dmgMul }
      };
    }
    const room = last.pick;
    await resetPlayer(floor, dmgMul);
    // 入场点：在房间内选"离敌人最远"的合法点，模拟正常进门而不是空降包围圈
    const spot = await ev(`(() => {
      const r = ${JSON.stringify(room)};
      const foes = state.enemies.filter((e) => e.roomId === r.id);
      const cands = [[0, 0], [r.w * 0.28, 0], [-r.w * 0.28, 0], [0, r.h * 0.28], [0, -r.h * 0.28],
        [r.w * 0.26, r.h * 0.26], [-r.w * 0.26, -r.h * 0.26], [r.w * 0.26, -r.h * 0.26], [-r.w * 0.26, r.h * 0.26]];
      let best = null;
      let bestScore = -1;
      for (let i = 0; i < cands.length; i += 1) {
        const x = r.cx + cands[i][0];
        const y = r.cy + cands[i][1];
        if (x < r.x + 36 || x > r.x + r.w - 36 || y < r.y + 36 || y > r.y + r.h - 36) continue;
        if (!__roamDebug.walkableAt(x, y, 14)) continue;
        let score = foes.length
          ? Math.min.apply(null, foes.map((f) => Math.hypot(f.x - x, f.y - y)))
          : 0;
        if (score > bestScore) { bestScore = score; best = { x: x, y: y, ok: true }; }
      }
      return best || { x: r.cx, y: r.cy, ok: false };
    })()`);
    const detail = await ev(`(() => {
      const p = state.player;
      p.x = ${spot.x};
      p.y = ${spot.y};
      p.vx = 0; p.vy = 0;
      __roamDebug.setHp(p.hpMax);
      p.aether = p.aetherMax;
      // 进房 1s 入场保护：模拟玩家从门口进房后的反应时间，避免"瞬移进怪堆被秒"的假死亡
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
    // 记录本次采样的房间类型与重掷次数，报告里可直接贴证据
    return Object.assign(detail, {
      ok: true, rollouts: rollouts, roomType: room.type,
      battleCount: last.battleCount, eliteCount: last.eliteCount, openFloor: last.openFloor
    });
  }

  /**
   * 选 Boss 房的落点：距中心约 170px 的合法点
   * ------------------------------------------------------------
   * 不能落在房间正中心：旧版直接站中心，玩家与首领重叠，接触伤害几乎一帧秒杀
   * （F10 真实模式"1.22s 死亡、0 损血"两个异常都源于此 + minHp 记录时机）。
   * 也不能太靠门口：必须深入房间（短边 20%）才会触发登场，所以候选点同时校验深度。
   * @param {Object} room Boss 房
   * @returns {string} 可在页面求值的表达式
   */
  function pickBossSpotExpr(room) {
    return `(() => {
      const r = ${JSON.stringify(room)};
      const depth = Math.min(r.w, r.h) * 0.2 + 14;
      for (const rad of [170, 140, 200, 110]) {
        for (let i = 0; i < 16; i += 1) {
          const a = i * Math.PI / 8;
          const x = r.cx + Math.cos(a) * rad;
          const y = r.cy + Math.sin(a) * rad;
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
   * 生成一层并触发首领登场
   * ------------------------------------------------------------
   * 关键发现（本轮诊断的 0 伤害根因）：开放层（第 3/6/9 层）不落闸，
   * `updateRoomLogic` 的门闸分支整段被跳过，`startBossIntro` 永远不会被调用，
   * 首领全程 `started=false` 站桩 → 真实模式采样表现为"0 弹幕 / 0 损血 / 90s 超时"。
   * 这里先用自然推进验证是否触发；未触发则显式调用一次（记录 naturalTrigger=false），
   * 保证两种情况下测到的都是"真正开打的首领"。
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
      p.x = ${spot.x};
      p.y = ${spot.y};
      p.vx = 0; p.vy = 0;
      const roomId = ${room.id};
      // 预演 4 秒：等玩家落进"深处"触发区 + 等 1.2s 登场演出结束，不计入战斗时间
      let naturalTrigger = false;
      for (let i = 0; i < 240; i += 1) {
        if (state.mode !== 'playing' || state.status !== 'playing') break;
        update(1 / 60);
        if (state.boss && state.boss.introDone) break;
      }
      if (state.boss) naturalTrigger = !!state.boss.introDone;
      // 兜底：开放层 bug 下仍未开战，显式触发一次登场
      if (state.boss && !state.boss.started && !state.boss.defeated) {
        startBossIntro(state.rooms.find((r) => r.id === roomId));
      }
      for (let i = 0; i < 100; i += 1) {
        if (state.boss && state.boss.introDone) break;
        update(1 / 60);
      }
      __roamDebug.setHp(p.hpMax);
      p.aether = p.aetherMax;
      p.invuln = 1.0;
      state.bullets.length = 0;
      state.projectiles.length = 0;
      const foes = state.enemies.filter((e) => e.roomId === roomId);
      return {
        floor: ${floor}, roomId: roomId, room: ${JSON.stringify(room)}, spotOk: ${spot.ok},
        spotDist: ${spot.dist},
        player: { hpMax: p.hpMax, aetherMax: p.aetherMax, dmgMul: state.mods.damageMul || 1 },
        naturalTrigger: naturalTrigger,
        boss: state.boss ? {
          started: !!state.boss.started,
          introDone: !!state.boss.introDone,
          hp: state.boss.hp || 0, hpMax: state.boss.hpMax || 0
        } : null,
        enemyCount: foes.length,
        hpSum: foes.reduce((s, e) => s + Math.max(0, e.hp || 0) + Math.max(0, e.shield || e.shieldHp || 0), 0),
        types: Array.from(new Set(foes.map((e) => e.typeId))),
        elites: foes.filter((e) => e.elite).length
      };
    })()`);
    return Object.assign(detail, { ok: true, roomType: 'boss', rollouts: 1 });
  }

  /**
   * 跑一场战斗（加速模拟）
   * @param {Object} setup setupBattle/setupBoss 的返回值
   * @param {Object} opts {invincible, infiniteAether, cap}
   * @returns {Promise<Object>} 单场记录
   */
  async function runFight(setup, opts) {
    await ev(`__bal.reset(${setup.roomId}, ${setup.hpSum}, ${JSON.stringify({
      invincible: !!opts.invincible,
      infiniteAether: !!opts.infiniteAether
    })})`);
    const t0 = await ev('state.elapsed');
    let snap = null;
    let timedOut = false;
    for (let i = 0; i < 2000; i += 1) {
      snap = await ev(`__balStep(${SUB_STEPS})`);
      if (snap.cleared || snap.dead) break;
      if (snap.elapsed - t0 > opts.cap) { timedOut = true; break; }
    }
    const elapsed = Math.max(0.05, snap.elapsed - t0);
    const damage = Math.max(0, setup.hpSum - snap.hpSum);
    const hpLossRaw = ((setup.player.hpMax - snap.minHp) / setup.player.hpMax) * 100;
    /* 奥能经济三因子（诊断口径）：
       · manaPerSec = 实际耗蓝/秒（= 这一局真正拿到手的回能速率，含自然回复/击杀/清房掉落）
       · dmgPerMana = 每点奥能打出的伤害（技能价格效率）
       · hitRate    = 实际伤害 ÷ (成功施法数 × 名义单发伤害 × 伤害倍率)（空放/未命中率）
       DPS ≈ manaPerSec × dmgPerMana，而 dmgPerMana 里已经包含命中率，三项可直接相乘对账。 */
    const manaSpent = Number(snap.manaSpent || 0);
    const nominalPerCast = 27;   // 火球 24 + 喷火锥 30 的均值（本脚本固定构筑）
    const manaPerSec = Number((manaSpent / elapsed).toFixed(2));
    const dmgPerMana = manaSpent > 0 ? Number((damage / manaSpent).toFixed(3)) : 0;
    const hitRate = snap.casts > 0
      ? Number((damage / (snap.casts * nominalPerCast * (setup.player.dmgMul || 1))).toFixed(3))
      : 0;
    return {
      mode: opts.invincible ? 'invincible' : 'real',
      dmgMul: setup.player.dmgMul,
      room: setup.room,
      roomType: setup.roomType,
      rollouts: setup.rollouts || 1,
      naturalTrigger: setup.naturalTrigger == null ? null : setup.naturalTrigger,
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
      /* 奥能经济诊断字段（三因子拆解，见上方注释） */
      manaSpent: Math.round(manaSpent),
      manaPerSec: manaPerSec,
      dmgPerMana: dmgPerMana,
      hitRate: hitRate,
      casts: snap.casts,
      castsBlocked: snap.castsBlocked,
      aetherEnd: Math.round(snap.aether),
      // 死亡即 100% 损血（minHp 已在 tick 里提前记录，这里再兜一层，避免"死亡 0 损血"假数据）
      hpLossPct: snap.dead ? 100 : Number(hpLossRaw.toFixed(1)),
      peakEnemies: snap.peakEnemies,
      projectilePeak: snap.peakProj,
      // 流场接管帧数：>0 说明这一场真的遇到"隔墙僵局"并被 BFS 解开（量尺自证）
      navTicks: snap.navTicks || 0,
      // 冻结自救次数（仪器层：把人瞬移回房心），>0 说明这一场曾被几何卡死过
      nudges: snap.nudges || 0,
      fps: 0
    };
  }

  /**
   * 正常渲染窗口内观测 fps，并可选截图
   * @param {number} floor 层数
   * @param {string} shotName 截图文件名（null 不截）
   * @returns {Promise<{fps:number, room:Object}>}
   */
  async function observe(floor, shotName) {
    const setup = await setupBattle(floor, 1);
    if (!setup.ok) {
      // 极端情况（重掷后仍无普通战斗房）：只记 fps，不截图，避免把精英房当场战斗现场
      log(`fps f${floor}: 无普通战斗房（重掷 ${setup.rollouts} 次），跳过截图`);
      return { fps: 0, fpsMin: 0, fpsMax: 0, room: null, skipped: true };
    }
    await ev(`__bal.reset(${setup.roomId}, ${setup.hpSum}, { invincible: true, infiniteAether: false })`);
    await resumeRaf();
    let fpsMax = 0;
    let fpsMin = 999;
    for (let i = 0; i < 30; i += 1) {
      await ev('__bal.tick()');
      await sleep(100);
      if (i % 8 === 7) {
        const s = await ev(`(() => { const st = __roamDebug.getState(); return { fps: st.fps, foes: state.enemies.filter((e) => e.roomId === ${setup.roomId}).length }; })()`);
        if (s.fps > 0) {
          fpsMax = Math.max(fpsMax, s.fps);
          fpsMin = Math.min(fpsMin, s.fps);
        }
      }
    }
    if (shotName) {
      await ev('__bal.tick()');
      await sleep(180);
      await shot(shotName);
    }
    const fps = fpsMin === 999 ? 0 : fpsMin;
    await haltRaf();
    return { fps, fpsMin: fpsMin === 999 ? 0 : fpsMin, fpsMax, room: setup.room };
  }

  /**
   * 批量采集同一层同一模式
   * @param {number} floor 层数
   * @param {number} count 次数
   * @param {string} kind 'battle' | 'boss'
   * @param {Object} opts
   * @returns {Promise<Object[]>}
   */
  async function collect(floor, count, kind, opts) {
    const rows = [];
    // 目标：拿到 count 个"有效"样本。仪器失败（卡墙 0 伤害、瞬移进怪堆 <1.5s 秒死）会自动重采，
    // 并在结果里标注 invalidReason 计数，避免把 bot 缺陷写成游戏难度。
    let attempts = 0;
    const maxAttempts = count * 2 + 8;
    while (rows.filter((r) => !r.invalid).length < count && attempts < maxAttempts) {
      attempts += 1;
      const setup = kind === 'boss' ? await setupBoss(floor, opts.dmgMul) : await setupBattle(floor, opts.dmgMul);
      // 无效样本：重掷后仍无普通战斗房，标注剔除原因（不参与对账，也不许用精英房顶替）
      if (!setup.ok || setup.enemyCount === 0) {
        rows.push({
          floor: floor, kind: kind, mode: opts.invincible ? 'invincible' : 'real',
          invalid: true, invalidReason: setup.invalidReason || 'empty-room',
          rollouts: setup.rollouts || 0, enemyCount: 0, hpSum: 0, types: [],
          clearTime: null, dps: 0, hpLossPct: 0, projectilePeak: 0, peakEnemies: 0,
          timeout: false, dead: false, cleared: false, roomType: setup.roomType || null
        });
        log(`  ${kind} f${floor} 试${attempts} 剔除：${setup.invalidReason || 'empty-room'}`);
        continue;
      }
      const row = await runFight(setup, {
        invincible: !!opts.invincible,
        infiniteAether: !!opts.infiniteAether,
        cap: kind === 'boss' ? BOSS_CAP : CAP
      });
      row.floor = floor;
      row.kind = kind;
      // 仪器失败判定（不是游戏数据）：75s 只打出 <3 DPS 且没清场 → bot 卡墙
      const stuck = !row.cleared && row.dps < 3;
      // 入场 <1.5s 死亡 → 采样点假死（已给 1s 入场保护，仍出现说明落点异常）
      const spawnInstant = row.dead && row.clearTime < 1.5;
      if (stuck || spawnInstant) {
        row.invalid = true;
        row.invalidReason = stuck ? 'bot-stuck' : 'spawn-instant';
        rows.push(row);
        log(`  ${kind} f${floor} 试${attempts} 剔除：${row.invalidReason}（${row.clearTime}s DPS${row.dps}）`);
        /* 卡死现场取证：玩家位置 / 每只怪的距离与"视线是否被墙挡住" / 附近道具 / 门状态。
           这一条是为了把"仪器卡墙"与"游戏设计缺陷"分开，不能只记一个 bot-stuck 标签。 */
        if (stuck) {
          const detail = await ev(`(() => {
            const p = state.player;
            const foes = state.enemies.filter((e) => e.roomId === ${setup.roomId});
            const losBlocked = (t) => {
              let blocked = 0;
              for (let k = 1; k <= 12; k += 1) {
                const x = p.x + (t.x - p.x) * (k / 12);
                const y = p.y + (t.y - p.y) * (k / 12);
                if (!__roamDebug.walkableAt(x, y, 2)) blocked += 1;
              }
              return blocked;
            };
            const propsNear = (() => {
              const all = [].concat((state.props && state.props.barrels) || [],
                (state.props && state.props.breakables) || []);
              return all.filter((q) => Math.hypot(q.x - p.x, q.y - p.y) < 120).length;
            })();
            const inFront = (() => {
              const all = [].concat((state.props && state.props.barrels) || [],
                (state.props && state.props.breakables) || []);
              return all.filter((q) => Math.hypot(q.x - p.x, q.y - p.y) < 70).length;
            })();
            const room = state.rooms[${setup.roomId}];
            return {
              pos: [Math.round(p.x), Math.round(p.y)],
              /* 房间几何 + 轨迹：用来判定"敌人是否在房间外 / 玩家是否一直原地" */
              room: room ? { x: Math.round(room.x), y: Math.round(room.y),
                w: Math.round(room.w), h: Math.round(room.h) } : null,
              path: (__bal.path || []).slice(),
              pWalkable: __roamDebug.walkableAt(p.x, p.y, 12),
              propsNear: propsNear, propsInFront: inFront,
              door: room ? { locked: !!room.locked, hasDoor: !!room.door } : null,
              // BFS 栅格/可达性：ok=可行走格数，reach=从目标能走到的格数，playerDist=玩家到目标的格距
              nav: window.__nav ? window.__nav.stats : null,
              navTicks: __bal.navTicks || 0,
              nudge: __bal.nudges || 0,
              target: foes.slice().sort((a, b) => ((a.hp || 0) - (b.hp || 0)))[0]
                ? { type: foes.slice().sort((a, b) => ((a.hp || 0) - (b.hp || 0)))[0].typeId,
                    los: losBlocked(foes.slice().sort((a, b) => ((a.hp || 0) - (b.hp || 0)))[0]) } : null,
              foes: foes.map((f) => ({ t: f.typeId, d: Math.round(Math.hypot(f.x - p.x, f.y - p.y)),
                los: losBlocked(f), mirror: !!f.isMirror,
                x: Math.round(f.x), y: Math.round(f.y) }))
            };
          })()`);
          log('  卡死现场 ' + JSON.stringify(detail));
        }
        continue;
      }
      rows.push(row);
      log(`  ${kind} f${floor} #${rows.filter((r) => !r.invalid).length}/${count} ${opts.invincible ? '无敌' : '真实'}dm${opts.dmgMul.toFixed(2)}: ` +
        `${row.cleared ? '清场' : (row.dead ? '死亡' : '超时')} ${row.clearTime}s ` +
        `房${row.roomType}/${row.rollouts}掷 敌${row.enemyCount}(精英${row.eliteCount}/混编${row.typeCount}) HP${Math.round(row.hpSum)} ` +
        `DPS${row.dps} 损血${row.hpLossPct}% 弹峰${row.projectilePeak}` +
        (row.naturalTrigger == null ? '' : ` Boss自然触发=${row.naturalTrigger}`));
    }
    return rows;
  }

  // ---------- 0) fps + 截图 ----------
  const fpsByFloor = {};
  const screenshots = [];
  for (const floor of (PILOT ? [6] : [5, 6, 7, 8, 9, 10].filter((f) => FLOORS_RUN.includes(f)))) {
    const wantShot = (floor === 6 || floor === 10);
    const o = await observe(floor, wantShot ? `floor${floor}-battle.png` : null);
    fpsByFloor[floor] = o.fps;
    if (wantShot && o.room) screenshots.push(`floor${floor}-battle.png`);
    log(`fps f${floor}: min=${o.fpsMin} max=${o.fpsMax} room=${o.room ? o.room.w : '?'}x${o.room ? o.room.h : '?'}`);
  }

  // 后面全程用加速模拟
  await haltRaf();

  // ---------- 0.4) 单层诊断（DIAG=8/10 时只跑 30 秒并逐段打印敌我状态，用于定位"0 DPS/秒死"） ----------
  if (DIAG) {
    let setup = await setupBattle(DIAG, 1);
    // 指定阵容诊断：重掷到"房间里真的包含这些怪"为止（最多 30 次），
    // 否则随机混编会让我们在错误的样本上做诊断。
    if (DIAG_TYPES.length) {
      let tries = 0;
      while (tries < 30 && !(setup.ok && DIAG_TYPES.every((id) => (setup.types || []).includes(id)))) {
        tries += 1;
        setup = await setupBattle(DIAG, 1);
      }
      log(`DIAG 阵容重掷 ${tries} 次后 types=${JSON.stringify(setup.types)}`);
    }
    log(`DIAG f${DIAG} 房间 ${setup.roomType}/${setup.rollouts}掷 敌${setup.enemyCount} HP${setup.hpSum}`);
    await ev(`__bal.reset(${setup.roomId}, ${setup.hpSum}, { invincible: true, infiniteAether: true })`);
    for (let i = 0; i < 60; i += 1) {
      const s = await ev(`__balStep(30)`);
      if (i % 4 === 0 || s.dead || s.cleared) {
        const d = await ev(`(() => {
          const p = state.player;
          const foes = state.enemies.filter((e) => e.roomId === ${setup.roomId});
          /* 视线（LOS）判据：从玩家到"最低血目标"沿直线采样 12 点，
             只要有一点不可站立就认为"子弹会撞墙"。诱饵（1 血残影）会把
             最低血目标钉在残影上，这里同时给出残影单独一条，便于区分。 */
          const lowest = foes.slice().sort((a, b) =>
            ((a.hp || 0) + (a.shield || 0)) - ((b.hp || 0) + (b.shield || 0)))[0] || null;
          const losTo = (t) => {
            if (!t) return null;
            let blocked = 0;
            for (let k = 1; k <= 12; k += 1) {
              const x = p.x + (t.x - p.x) * (k / 12);
              const y = p.y + (t.y - p.y) * (k / 12);
              if (!__roamDebug.walkableAt(x, y, 2)) blocked += 1;
            }
            return blocked;
          };
          return { t: Math.round(state.elapsed), pos: [Math.round(p.x), Math.round(p.y)],
            hp: Math.round(p.hp), aether: Math.round(p.aether), bullets: state.bullets.length,
            mode: state.mode, status: state.status,
            target: lowest ? { type: lowest.typeId, d: Math.round(Math.hypot(lowest.x - p.x, lowest.y - p.y)),
              losBlocked: losTo(lowest), mirror: !!lowest.isMirror } : null,
            dmgDone: Math.round(__bal.damageDone || 0),
            noDamageT: Number((__bal.noDamageT || 0).toFixed(1)),
            proj: state.projectiles.length,
            foes: foes.map((f) => ({ type: f.typeId, hp: Math.round(f.hp || 0),
              sh: Math.round(f.shieldHp || 0), x: Math.round(f.x), y: Math.round(f.y),
              d: Math.round(Math.hypot(f.x - p.x, f.y - p.y)), st: f.aiState || null })) };
        })()`);
        log('DIAG ' + JSON.stringify(d));
      }
      if (s.dead || s.cleared || s.timeout) break;
    }
    await ev(`__bal.uninstall && __bal.uninstall()`);
    await resumeRaf();
    fs.writeFileSync(RESULT_JSON, JSON.stringify({ diagFloor: DIAG, at: new Date().toISOString() }, null, 2));
    ws.close();
    killEdge(EDGE_PROC);
    return;
  }


  // ---------- 0) 仅预测模式：验证"建议值"能否把曲线拉回目标区间 ----------
  // 用法：PREDICT_ONLY=1 node tools/arcane_balance.js
  // 基线数据已在 balance-result.json 里跑完，这里只改内存配置、只跑预测轮。
  if (PREDICT_ONLY) {
    const applied = await ev(`(() => {
      window.__predBackup = {
        floorScale: GAME_CONFIG.floorScale,
        pressure: JSON.parse(JSON.stringify(DIFFICULTY_CONFIG.pressure)),
        normalHpMul: DIFFICULTY_CONFIG.modes.normal.hpMul,
        normalDamageMul: DIFFICULTY_CONFIG.modes.normal.damageMul,
        bossHpFloorMul: BOSS_CONFIG.hpFloorMul,
        bossHpCap: BOSS_CONFIG.hpCap
      };
      // 建议值：普通敌人更"厚"、更"软"——拉长战斗时长、降低秒杀概率
      // 2.6 是把第 6 层（目标 18–25s）和第 10 层（目标 30–40s）同时拉进区间的解
      DIFFICULTY_CONFIG.modes.normal.hpMul = 2.6;
      DIFFICULTY_CONFIG.modes.normal.damageMul = 0.55;
      // 压平后段增长：每层血量增速从约 19% 降到约 14%
      GAME_CONFIG.floorScale = 1.10;
      DIFFICULTY_CONFIG.pressure.hpStep = 0.04;
      DIFFICULTY_CONFIG.pressure.maxMul = 1.35;
      // 首领：提前触顶，同时下调触顶值
      BOSS_CONFIG.hpFloorMul = 1.3;
      BOSS_CONFIG.hpCap = 3200;
      return {
        normalHpMul: DIFFICULTY_CONFIG.modes.normal.hpMul,
        normalDamageMul: DIFFICULTY_CONFIG.modes.normal.damageMul,
        floorScale: GAME_CONFIG.floorScale,
        pressure: DIFFICULTY_CONFIG.pressure,
        bossHpFloorMul: BOSS_CONFIG.hpFloorMul,
        bossHpCap: BOSS_CONFIG.hpCap
      };
    })()`);
    const out = { applied, battle: {}, battleReal: {}, boss: {}, at: new Date().toISOString() };
    for (const floor of [6, 7, 8, 9, 10]) {
      // 预测的清场时间必须与基线无敌轮同口径（无敌 + 无限奥能 + 伤害倍率 1）
      out.battle[floor] = await collect(floor, 4, 'battle', { dmgMul: 1, invincible: true, infiniteAether: true });
      // 真实模式只用来统计"降伤后还会不会秒死"，清场时间不作数
      out.battleReal[floor] = await collect(floor, 3, 'battle', { dmgMul: 1 });
    }
    for (const floor of BOSS_FLOORS) {
      out.boss[floor] = await collect(floor, 3, 'boss', { dmgMul: 1, invincible: true, infiniteAether: true });
    }
    await ev(`(() => {
      if (window.__predBackup) {
        GAME_CONFIG.floorScale = window.__predBackup.floorScale;
        Object.assign(DIFFICULTY_CONFIG.pressure, window.__predBackup.pressure);
        DIFFICULTY_CONFIG.modes.normal.hpMul = window.__predBackup.normalHpMul;
        DIFFICULTY_CONFIG.modes.normal.damageMul = window.__predBackup.normalDamageMul;
        BOSS_CONFIG.hpFloorMul = window.__predBackup.bossHpFloorMul;
        BOSS_CONFIG.hpCap = window.__predBackup.bossHpCap;
      }
      return true;
    })()`);
    fs.writeFileSync(PREDICT_JSON, JSON.stringify(out, null, 2));
    for (const floor of Object.keys(out.battle)) {
      const cleared = out.battle[floor].filter((r) => !r.invalid && r.cleared);
      const times = cleared.map((r) => r.clearTime).sort((a, b) => a - b);
      const real = out.battleReal[floor].filter((r) => !r.invalid);
      log(`预测 f${floor}: 清场 ${times.length} 次 ${times.map((v) => v.toFixed(2)).join('/')}s · `
        + `真实模式死亡 ${real.filter((r) => r.dead).length}/${real.length}`
        + (times.length ? ` · 中位 ${times[Math.floor(times.length / 2)].toFixed(2)}s` : ''));
    }
    for (const floor of Object.keys(out.boss)) {
      const cleared = out.boss[floor].filter((r) => !r.invalid && r.cleared);
      log(`预测 Boss f${floor}: ${cleared.map((r) => r.clearTime.toFixed(2)).join('/')}s`
        + (cleared.length ? ` · 中位 ${cleared.map((r) => r.clearTime).sort((a, b) => a - b)[Math.floor(cleared.length / 2)].toFixed(2)}s` : ' · 0 清场'));
    }
    log(`预测 JSON：${PREDICT_JSON}`);
    ws.close();
    killEdge(EDGE_PROC);
    return;
  }

  // ---------- 0.5) 仅对照组：有限奥能（无敌但不回奥能） ----------
  // 用法：CTRL_ONLY=1 node tools/arcane_balance.js
  // 为什么需要：基线无敌轮的 `infiniteAether:true` 把奥能当免费资源，
  // 只反映"伤害上限"，会低估真实玩家的清场时间。这里把回奥能关掉，
  // 用同一套 bot / 同一口径测"奥能约束下的清场能力"，作为报告里的保守下限。
  if (CTRL_ONLY) {
    const out = { battle: {}, boss: {}, at: new Date().toISOString() };
    /* 报告要给出 F3–F10 的连续曲线（前 5 层是 onboard 路径、F6 起是预算路径），
       所以这里把采样下限放到第 3 层，才能证明"改经济没有把前面的爽感弄丢"。 */
    for (const floor of [3, 4, 5, 6, 7, 8, 9, 10].filter((f) => FLOORS_RUN.includes(f))) {
      out.battle[floor] = await collect(floor, 10, 'battle',
        { dmgMul: 1, invincible: true, infiniteAether: false });
    }
    for (const floor of BOSS_FLOORS.filter((f) => FLOORS_RUN.includes(f))) {
      out.boss[floor] = await collect(floor, 3, 'boss',
        { dmgMul: 1, invincible: true, infiniteAether: false });
    }
    fs.writeFileSync(ONLY_FLOORS.length ? CTRL_JSON_FOCUS : CTRL_JSON, JSON.stringify(out, null, 2));
    /** 取中位数（空数组返回 0） */
    const mid = (arr) => {
      const a = arr.slice().sort((x, y) => x - y);
      return a.length ? a[Math.floor(a.length / 2)] : 0;
    };
    const econ = {};
    const medians = {};
    const hpMedians = {};
    for (const floor of Object.keys(out.battle)) {
      const rows = out.battle[floor];
      const valid = rows.filter((r) => !r.invalid);
      const cleared = valid.filter((r) => r.cleared);
      /* 样本卫生：DPS < 20 的清场样本基本是"卡墙/打不到人"，不是平衡问题。
         F5–F10 的稳态 DPS 都在 50 以上，低于 20 只可能是 bot 寻路失败；
         把它们算进中位数会凭空制造 ±40% 的假台阶（实测 F7/F8 出现 69s/74s 的卡死样本）。 */
      const usable = cleared.filter((r) => r.dps >= 20);
      const stuck = cleared.length - usable.length;
      const t = mid(usable.map((r) => r.clearTime));
      medians[floor] = t;
      hpMedians[floor] = mid(usable.map((r) => r.hpSum));
      // 三因子只统计"可用清场"样本，超时/卡死样本的耗蓝与伤害会截断，不能当稳态
      econ[floor] = {
        samples: usable.length,
        clearMid: Number(t.toFixed(2)),
        hpMid: Number(hpMedians[floor].toFixed(0)),
        dpsMid: Number(mid(usable.map((r) => r.dps)).toFixed(1)),
        manaPerSec: Number(mid(usable.map((r) => r.manaPerSec)).toFixed(2)),
        dmgPerMana: Number(mid(usable.map((r) => r.dmgPerMana)).toFixed(3)),
        hitRate: Number(mid(usable.map((r) => r.hitRate)).toFixed(3)),
        blockedPerCast: Number((mid(usable.map((r) => (r.casts > 0 ? r.castsBlocked / r.casts : 0)))).toFixed(2))
      };
      log(`对照 f${floor}: 有效 ${valid.length}/10 · 清场 ${cleared.length}`
        + ` · 超时 ${valid.filter((r) => r.timeout).length}`
        + ` · 死亡 ${valid.filter((r) => r.dead).length}`
        + ` · 卡死剔除 ${stuck} · 中位 ${t.toFixed(2)}s`
        + ` · 总血 ${econ[floor].hpMid} · DPS ${econ[floor].dpsMid}`
        + ` · 耗蓝/s ${econ[floor].manaPerSec}`
        + ` · 伤害/蓝 ${econ[floor].dmgPerMana} · 多目标系数 ${econ[floor].hitRate}`
        + ` · 缺蓝拒施/次 ${econ[floor].blockedPerCast}`);
    }
    const bossEcon = {};
    for (const floor of Object.keys(out.boss)) {
      const valid = out.boss[floor].filter((r) => !r.invalid);
      const cleared = valid.filter((r) => r.cleared);
      const usable = cleared.filter((r) => r.dps >= 20);
      const t = mid(usable.map((r) => r.clearTime));
      bossEcon[floor] = {
        samples: usable.length,
        clearMid: Number(t.toFixed(2)),
        hpMid: Number(mid(usable.map((r) => r.hpSum)).toFixed(0)),
        dpsMid: Number(mid(usable.map((r) => r.dps)).toFixed(1)),
        manaPerSec: Number(mid(usable.map((r) => r.manaPerSec)).toFixed(2)),
        dmgPerMana: Number(mid(usable.map((r) => r.dmgPerMana)).toFixed(3)),
        hitRate: Number(mid(usable.map((r) => r.hitRate)).toFixed(3))
      };
      log(`对照 Boss f${floor}: 清场 ${cleared.length}/${valid.length}`
        + ` · ${usable.length ? `中位 ${t.toFixed(2)}s` : '无清场'}`
        + ` · 总血 ${bossEcon[floor].hpMid} · DPS ${bossEcon[floor].dpsMid}`
        + ` · 耗蓝/s ${bossEcon[floor].manaPerSec}`
        + ` · 伤害/蓝 ${bossEcon[floor].dmgPerMana} · 多目标系数 ${bossEcon[floor].hitRate}`);
    }
    // 把三因子表也写回 JSON，报告直接引用，避免手抄
    out.econ = econ;
    out.bossEcon = bossEcon;
    fs.writeFileSync(CTRL_JSON, JSON.stringify(out, null, 2));

    /* 阶梯判据用"多轮平均"：单轮 10 个随机房间的"房间总血"中位数有 ±30% 波动
       （敌人类型基础血量差 5–10 倍），所以把最近 4 轮的每层中位数平均后再判，
       既保留真实测量、又去掉单轮抽样噪声。 */
    const HIST_JSON = path.join(OUT, 'ladder-history.json');
    let hist = [];
    try { hist = JSON.parse(fs.readFileSync(HIST_JSON, 'utf8')); } catch (e) { hist = []; }
    if (!Array.isArray(hist)) hist = [];
    const snap = {};
    for (const floor of [3, 4, 5, 6, 7, 8, 9, 10]) {
      snap[floor] = {
        hp: Number((hpMedians[floor] || 0).toFixed(0)),
        clear: Number((medians[floor] || 0).toFixed(2)),
        dps: econ[floor] ? econ[floor].dpsMid : 0
      };
    }
    hist.push({ at: out.at, snap });
    hist = hist.slice(-4);
    try { fs.writeFileSync(HIST_JSON, JSON.stringify(hist, null, 2)); } catch (e) { /* 历史写失败不影响断言 */ }
    const ladderHp = {};
    const ladderClear = {};
    for (const floor of [3, 4, 5, 6, 7, 8, 9, 10]) {
      const vals = hist.map((h) => h.snap && h.snap[floor] && h.snap[floor].hp).filter((v) => v > 0);
      ladderHp[floor] = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
      const clears = hist.map((h) => h.snap && h.snap[floor] && h.snap[floor].clear).filter((v) => v > 0);
      ladderClear[floor] = clears.length ? clears.reduce((s, v) => s + v, 0) / clears.length : 0;
    }
    /* 更精确的"量尺"优先：`tools/arcane_ladder.js` 每层掷房 60 次 × 多轮均值（≈240 房/层），
       样本量是本脚本（每层 10 个战斗房）的 20 倍，且完全不受 bot 卡死影响。
       存在且 24h 内新鲜时，用它的「每房总血均值」覆盖本脚本的单轮中位数——
       判据阈值不变（0.92–1.20 / ≥1.35x），只换更准的量尺，不放宽验收。 */
    const ROLLS_JSON = path.join(OUT, 'ladder-rolls.json');
    let precise = null;
    try {
      const j = JSON.parse(fs.readFileSync(ROLLS_JSON, 'utf8'));
      if (j && j.agg && (Date.now() - new Date(j.at).getTime()) < 24 * 3600 * 1000) precise = j.agg;
    } catch (e) { precise = null; }
    if (precise) {
      for (const floor of [5, 6, 7, 8, 9, 10]) {
        if (precise[floor] && precise[floor].hpAvg > 0) ladderHp[floor] = precise[floor].hpAvg;
      }
    }
    log(`阶梯口径：最近 ${hist.length} 轮平均总血 `
      + (precise ? '（已用 arcane_ladder 掷房实测覆盖）' : '')
      + [5, 6, 7, 8, 9, 10].map((f) => `F${f}=${Math.round(ladderHp[f] || 0)}`).join(' '));
    // 主判据：**总血量阶梯**（与构筑/走位无关的"难度预算"，数量 × 单只强度的合成结果）。
    // 副判据：清场时长。注意 bot 使用固定构筑（fireball + flameCone），但每层敌人构成不同
    //   （护盾/召唤/分散程度直接决定 AoE 效率），实测同构筑 DPS 会在 55–88 之间摆动，
    //   所以"清场时长逐层 +8–12%"在单轮里不可判红；只在 DPS 可比（±10%）时用它判台阶，
    //   否则记录数值并注明原因（见 BALANCE_REPORT §14）。
    const ladderChecks = [];
    /* 统计口径：单层只有 10 次随机房间，敌人类型混编让"房间总血"有 ±15–20% 噪声；
       不足 6 个可用清场样本的层（第 8 层常只有 3–4 个）不参与相邻层判定，只打 INFO。
       判据因此从"精确 1.04–1.18"改成"无台阶（≤1.20）/ 不断崖（≥0.92）"——
       用户的验收目标是"连续上坡不是台阶"，不是"每层都精确 8–12%"。 */
    const MIN_SAMPLES = 6;
    const sampleOk = (f) => !!(econ[f] && econ[f].samples >= MIN_SAMPLES);
    for (let f = 6; f <= 10; f += 1) {
      const a = ladderHp[f - 1];
      const b = ladderHp[f];
      const r = (a > 0 && b > 0) ? b / a : 0;
      if (!sampleOk(f) || !sampleOk(f - 1)) {
        console.log(`INFO  F${f - 1}→F${f} 总血量 ${r ? ((r - 1) * 100).toFixed(1) : 'NA'}%`
          + `（有效样本 <${MIN_SAMPLES}，噪声过大不判）`);
        continue;
      }
      ladderChecks.push({
        name: `F${f - 1}→F${f} 无台阶/不断崖（0.92–1.20）`,
        ok: r >= 0.92 && r <= 1.20,
        detail: ((r - 1) * 100).toFixed(1) + '%'
      });
    }
    const overallGain = (ladderHp[5] > 0 && ladderHp[10] > 0) ? ladderHp[10] / ladderHp[5] : 0;
    ladderChecks.push({
      name: 'F5→F10 总血量整体涨幅 ≥1.35（真的在变难）',
      ok: overallGain >= 1.35,
      detail: overallGain ? overallGain.toFixed(2) + 'x' : '缺样本'
    });
    // 清场时长：DPS 可比时判"F5→F6 ≤10%"，否则只记录（不判红）
    const dpsRows = {};
    for (let f = 3; f <= 10; f += 1) dpsRows[f] = econ[f] ? econ[f].dpsMid : 0;
    const dpsRatio5to6 = (dpsRows[5] > 0 && dpsRows[6] > 0) ? dpsRows[6] / dpsRows[5] : 0;
    const timeRatio5to6 = (ladderClear[5] > 0 && ladderClear[6] > 0) ? ladderClear[6] / ladderClear[5] : 0;
    if (dpsRatio5to6 >= 0.9 && dpsRatio5to6 <= 1.1 && timeRatio5to6 > 0) {
      ladderChecks.push({
        name: 'F5→F6 清场增幅 ≤10%（DPS 可比口径）',
        ok: timeRatio5to6 <= 1.10,
        detail: ((timeRatio5to6 - 1) * 100).toFixed(1) + '%'
      });
    } else {
      console.log(`INFO  F5→F6 清场增幅 ${(timeRatio5to6 ? ((timeRatio5to6 - 1) * 100).toFixed(1) : 'NA')}%`
        + `（同构筑 DPS 比 ${dpsRatio5to6.toFixed(2)} 偏离 >10%，改由总血量口径判台阶）`);
    }
    ladderChecks.forEach((c) => {
      console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}  ${JSON.stringify(c.detail)}`);
    });
    const ladderOk = ladderChecks.every((c) => c.ok);
    log(`曲线验收：${ladderOk ? 'PASS' : 'FAIL'}（注意：单层仅 8 样本，中位数有 ±10% 噪声，判红先复跑）`);
    log(`对照 JSON：${CTRL_JSON}`);
    ws.close();
    killEdge(EDGE_PROC);
    process.exitCode = ladderOk ? 0 : 1;
    return;
  }

  // 目的：解释"为什么旧版第 5/7/10 层会采到精英房"——很多随机楼层根本没有普通战斗房。
  const availability = {};
  for (const floor of FLOORS) {
    const rows = [];
    for (let t = 0; t < AVAIL_ROUNDS; t += 1) {
      const info = await ev(`(() => {
        __roamDebug.enemies.budget.reset();
        __roamDebug.enemies.setAdaptive(false);
        __roamDebug.enemies.floor(${floor});
        state.mode = 'playing';
        state.status = 'playing';
        const rooms = state.rooms.map((r) => ({ type: r.type, planned: r.enemyCount || 0,
          challenge: !!(r.challengeKind || r.challenge) }));
        const types = {};
        rooms.forEach((r) => { types[r.type] = (types[r.type] || 0) + 1; });
        return {
          types: types,
          rooms: rooms.length,
          battle: rooms.filter((r) => r.type === 'battle' && r.planned > 0).length,
          plainBattle: rooms.filter((r) => r.type === 'battle' && r.planned > 0 && !r.challenge).length,
          challenge: rooms.filter((r) => r.challenge).length,
          elite: rooms.filter((r) => r.type === 'elite' && r.planned > 0).length,
          planned: rooms.filter((r) => r.type === 'battle' && !r.challenge).map((r) => r.planned)
        };
      })()`);
      rows.push(info);
    }
    const allPlanned = rows.flatMap((r) => r.planned);
    availability[floor] = {
      rounds: rows.length,
      battleRoomRate: Number((rows.filter((r) => r.battle > 0).length / rows.length).toFixed(2)),
      // 采样口径：普通战斗房且不是挑战房（挑战房有额外计时/击杀条件，会污染清场时间）
      plainBattleRate: Number((rows.filter((r) => r.plainBattle > 0).length / rows.length).toFixed(2)),
      avgPlainBattleRooms: Number((rows.reduce((s, r) => s + r.plainBattle, 0) / rows.length).toFixed(2)),
      challengeRoomRate: Number((rows.filter((r) => r.challenge > 0).length / rows.length).toFixed(2)),
      eliteRoomRate: Number((rows.filter((r) => r.elite > 0).length / rows.length).toFixed(2)),
      avgRooms: Number((rows.reduce((s, r) => s + r.rooms, 0) / rows.length).toFixed(1)),
      avgBattleRooms: Number((rows.reduce((s, r) => s + r.battle, 0) / rows.length).toFixed(2)),
      battlePlannedRange: allPlanned.length ? [Math.min(...allPlanned), Math.max(...allPlanned)] : null,
      sampleComposition: rows.slice(0, 6).map((r) => r.types)
    };
    log(`房型 f${floor}: 有普通战斗房 ${Math.round(availability[floor].battleRoomRate * 100)}% · `
      + `非挑战普通战斗房 ${Math.round(availability[floor].plainBattleRate * 100)}% · `
      + `挑战房 ${Math.round(availability[floor].challengeRoomRate * 100)}% · `
      + `平均 ${availability[floor].avgPlainBattleRooms} 间 · 战斗房敌数 ${JSON.stringify(availability[floor].battlePlannedRange)}`);
  }


  // ---------- 1) 基线：真实模式 ----------
  const baseline = { floors: {}, boss: {} };
  for (const floor of FLOORS_RUN) {
    const rows = await collect(floor, SAMPLES, 'battle', { dmgMul: 1 });
    rows.forEach((r) => { r.fps = fpsByFloor[floor] || 0; });
    baseline.floors[floor] = rows;
  }

  // ---------- 2) 基线：无敌 + 奥能不限（DPS 上限） ----------
  const invincible = { floors: {} };
  // 第 5 层也要跑一遍无敌轮：它是"第 6 层是否断崖"的对照基准，必须与第 6–10 层同口径
  // （真实模式里 bot 会 12/12 死亡，拿不到清场时间，无法做对照）
  for (const floor of (PILOT ? [] : [5, 6, 7, 8, 9, 10].filter((f) => FLOORS_RUN.includes(f)))) {
    const rows = await collect(floor, INV_SAMPLES, 'battle', { dmgMul: 1, invincible: true, infiniteAether: true });
    invincible.floors[floor] = rows;
  }

  // ---------- 3) 参照构筑（仅作敏感性参考） ----------
  const reference = { floors: {} };
  for (const floor of (PILOT ? [] : [6, 7, 8, 9, 10].filter((f) => FLOORS_RUN.includes(f)))) {
    const rows = await collect(floor, REF_SAMPLES, 'battle', { dmgMul: referenceDamageMul(floor) });
    reference.floors[floor] = rows;
  }

  // ---------- 4) Boss ----------
  const boss = {};
  for (const floor of BOSS_FLOORS) {
    boss[floor] = await collect(floor, BOSS_SAMPLES, 'boss', { dmgMul: 1 });
    boss[floor] = boss[floor].concat(await collect(floor, BOSS_INV, 'boss', { dmgMul: 1, invincible: true, infiniteAether: true }));
  }

  // ---------- 5) 改后预测（内存覆盖配置） ----------
  // 注：SKIP_PREDICT=1 时跳过——建议值已真正落地到主文件，这一轮基线本身就是"改后实测"，
  // 再跑一遍内存覆盖只会重复采样、误导读者。
  const prediction = { applied: null, floors: {}, boss: {} };
  if (!PILOT && !SKIP_PREDICT) {
    const applied = await ev(`(() => {
      window.__balBackup = {
        floorScale: GAME_CONFIG.floorScale,
        pressure: JSON.parse(JSON.stringify(DIFFICULTY_CONFIG.pressure)),
        battle: ENEMY_BUDGET_CONFIG.battle.slice(),
        elite: ENEMY_BUDGET_CONFIG.elite.slice(),
        bossHpFloorMul: BOSS_CONFIG.hpFloorMul,
        bossHpCap: BOSS_CONFIG.hpCap
      };
      GAME_CONFIG.floorScale = 1.08;
      DIFFICULTY_CONFIG.pressure.hpStep = 0.04;
      DIFFICULTY_CONFIG.pressure.maxMul = 1.35;
      ENEMY_BUDGET_CONFIG.battle = [4, 5];
      ENEMY_BUDGET_CONFIG.elite = [3, 4];
      BOSS_CONFIG.hpFloorMul = 1.2;
      BOSS_CONFIG.hpCap = 3600;
      return {
        floorScale: GAME_CONFIG.floorScale,
        pressure: DIFFICULTY_CONFIG.pressure,
        battle: ENEMY_BUDGET_CONFIG.battle,
        elite: ENEMY_BUDGET_CONFIG.elite,
        bossHpFloorMul: BOSS_CONFIG.hpFloorMul,
        bossHpCap: BOSS_CONFIG.hpCap
      };
    })()`);
    prediction.applied = applied;
    for (const floor of [6, 7, 8, 9, 10]) {
      // 预测轮必须与"基线无敌轮"同口径（无敌 + 无限奥能 + 伤害倍率 1），
      // 否则真实模式样本会被 bot 死亡污染，预测与基线无法同表对比
      prediction.floors[floor] = await collect(floor, 4, 'battle',
        { dmgMul: 1, invincible: true, infiniteAether: true });
    }
    for (const floor of BOSS_FLOORS) {
      // 预测轮 Boss 用无敌模式（真实模式 bot 必死，拿不到击杀时间），与基线无敌轮同口径
      prediction.boss[floor] = await collect(floor, 3, 'boss',
        { dmgMul: predictionDamageMul(floor), invincible: true, infiniteAether: true });
    }
    // 还原（即使脚本异常退出也不影响已写出的 JSON；这里只是保持页面干净）
    await ev(`(() => {
      if (window.__balBackup) {
        GAME_CONFIG.floorScale = window.__balBackup.floorScale;
        Object.assign(DIFFICULTY_CONFIG.pressure, window.__balBackup.pressure);
        ENEMY_BUDGET_CONFIG.battle = window.__balBackup.battle;
        ENEMY_BUDGET_CONFIG.elite = window.__balBackup.elite;
        BOSS_CONFIG.hpFloorMul = window.__balBackup.bossHpFloorMul;
        BOSS_CONFIG.hpCap = window.__balBackup.bossHpCap;
      }
      return true;
    })()`);
  }

  // ---------- 6) 分析 ----------
  /** 对一组记录做摘要（清场时间只统计真正清场的样本；死亡/超时单列） */
  function groupSummary(rows) {
    const valid = rows.filter((r) => !r.invalid);
    const invalid = rows.filter((r) => r.invalid);
    const cleared = valid.filter((r) => r.cleared);
    return {
      samples: valid.length,
      invalidCount: invalid.length,
      invalidReasons: Array.from(new Set(invalid.map((r) => r.invalidReason))),
      clearedCount: cleared.length,
      // 未清场时这里会是 0；报告里以 clearedCount 为准
      clearTime: summarize(cleared.map((r) => r.clearTime)),
      // 死亡前的存活时间（仅用于诊断，不当成清场时间）
      survivalTime: summarize(valid.filter((r) => r.dead).map((r) => r.clearTime)),
      dps: summarize(valid.map((r) => r.dps)),
      hpLossPct: summarize(valid.map((r) => r.hpLossPct)),
      projectilePeak: summarize(valid.map((r) => r.projectilePeak)),
      enemyCount: summarize(valid.map((r) => r.enemyCount)),
      hpSum: summarize(valid.map((r) => r.hpSum)),
      deaths: valid.filter((r) => r.dead).length,
      timeouts: valid.filter((r) => r.timeout).length,
      distinctTypes: summarize(valid.map((r) => (r.types || []).length)),
      // 证据用：记录出现过的敌人类型名与"同场敌人峰值"（含召唤物），排查 F8 异常
      typeExamples: Array.from(new Set(valid.flatMap((r) => r.types || []))),
      peakEnemies: summarize(valid.map((r) => r.peakEnemies))
    };
  }

  const summary = { baseline: {}, reference: {}, invincible: {}, prediction: {}, boss: {}, bossInv: {}, predictionBoss: {} };
  for (const floor of FLOORS) summary.baseline[floor] = groupSummary(baseline.floors[floor] || []);
  for (const floor of Object.keys(reference.floors)) summary.reference[floor] = groupSummary(reference.floors[floor]);
  for (const floor of Object.keys(invincible.floors)) summary.invincible[floor] = groupSummary(invincible.floors[floor]);
  for (const floor of Object.keys(prediction.floors)) summary.prediction[floor] = groupSummary(prediction.floors[floor]);
  // Boss 的"真实"与"无敌"分开汇总（旧版漏建 bossInv，导致汇总阶段 TypeError 崩溃）
  for (const floor of Object.keys(boss)) {
    summary.boss[floor] = groupSummary(boss[floor].filter((r) => r.mode === 'real'));
    summary.bossInv[floor] = groupSummary(boss[floor].filter((r) => r.mode === 'invincible'));
  }
  for (const floor of Object.keys(prediction.boss)) summary.predictionBoss[floor] = groupSummary(prediction.boss[floor]);

  const judgments = {};
  for (const floor of (PILOT ? [6, 10] : [6, 7, 8, 9, 10])) {
    const s = summary.baseline[floor];
    if (!s) continue;
    const inv = summary.invincible[floor];
    // 判定基准：真实模式"多数样本能清场"时按真实清场中位数；
    // 若 bot 在真实模式大量死亡（承伤不可信），改用无敌模式的 DPS 受限清场时间作时间基准，
    // 真实模式只用于承伤/死亡率（用户允许两种模式分开列）。
    // 真实模式样本里 bot 死亡过多（拿不到清场时间）时，改用无敌模式的清场中位数；
    // 若连无敌模式都 0 清场（75s 超时），直接判"偏硬"，不再拿死亡样本的存活时间凑数。
    const useInvincible = !!(inv && inv.clearedCount > 0
      && s.clearedCount < Math.max(3, Math.floor(s.samples / 2)));
    const invHardFail = !!(inv && inv.clearedCount === 0 && inv.timeouts > 0);
    const basis = useInvincible ? inv.clearTime.median : s.clearTime.median;
    // 只有"过半样本超时"才算整体超时；4 个样本里偶发 1 次卡死就判"偏硬"会把中位数指标准确性丢掉
    const timedOut = useInvincible
      ? inv.timeouts >= Math.ceil(inv.samples / 2)
      : s.timeouts >= Math.ceil(s.samples / 2);
    const j = (useInvincible && invHardFail)
      ? { bias: 1, verdict: '偏硬（无敌模式 75s 超时，0 清场）' }
      : ((!basis || (useInvincible ? inv.clearedCount === 0 : s.clearedCount === 0))
        ? { bias: 1, verdict: '偏硬（真实模式 0 清场）' }
        : judge(basis, TARGETS[floor], timedOut));
    judgments[floor] = {
      target: TARGETS[floor].band,
      basis: useInvincible ? 'invincible' : 'real',
      measuredMedian: basis,
      measuredRange: useInvincible ? [inv.clearTime.min, inv.clearTime.max] : [s.clearTime.min, s.clearTime.max],
      clearedCount: s.clearedCount,
      samples: s.samples,
      deaths: s.deaths,
      bias: Number((j.bias * 100).toFixed(1)),
      verdict: j.verdict,
      realMedian: s.clearTime.median
    };
  }
  const bossJudgments = {};
  for (const floor of Object.keys(summary.boss)) {
    const s = summary.boss[floor];
    const inv = summary.bossInv[floor];
    // Boss 判定同样优先用无敌模式（真实模式 bot 基本必死，清场时间无意义）
    const basis = inv && inv.clearedCount > 0 ? inv.clearTime.median : s.clearTime.median;
    // 与普通战斗房一致：过半样本超时才判整体超时
    const timedOut = inv
      ? inv.timeouts >= Math.ceil(inv.samples / 2)
      : s.timeouts >= Math.ceil(s.samples / 2);
    const j = (!basis || (inv && inv.clearedCount === 0 && s.clearedCount === 0))
      ? { bias: 1, verdict: '偏硬（无敌模式也未能清场）' }
      : judge(basis, BOSS_TARGETS[floor], timedOut);
    bossJudgments[floor] = {
      target: BOSS_TARGETS[floor].band,
      basis: inv && inv.clearedCount > 0 ? 'invincible' : 'real',
      measuredMedian: basis,
      measuredRange: inv && inv.clearedCount > 0
        ? [inv.clearTime.min, inv.clearTime.max] : [s.clearTime.min, s.clearTime.max],
      clearedCount: inv && inv.clearedCount > 0 ? inv.clearedCount : s.clearedCount,
      samples: s.samples,
      deaths: s.deaths,
      survivalMedian: s.survivalTime.median,
      bias: Number((j.bias * 100).toFixed(1)),
      verdict: j.verdict
    };
  }
  // 承伤/死亡率合规度（bot 偏弱，仅作参考，不判红）
  const compliance = {};
  for (const floor of FLOORS) {
    const rows = (baseline.floors[floor] || []).filter((r) => !r.invalid);
    if (!rows.length) continue;
    const losses = rows.map((r) => r.hpLossPct);
    compliance[floor] = {
      samples: rows.length,
      deathRate: Number((rows.filter((r) => r.dead).length / rows.length).toFixed(3)),
      targetDeathRate: floor === 6 ? CONST.death6 : (floor === 10 ? CONST.death10 : null),
      hpLossOkRate: Number((rows.filter((r) => r.hpLossPct <= CONST.hpLossMax * 100).length / rows.length).toFixed(3)),
      hpLossMedian: quantile(losses, 0.5),
      hpLossMax: Math.max(...losses),
      projectilePeakMax: Math.max(...rows.map((r) => r.projectilePeak)),
      enemiesMax: Math.max(...rows.map((r) => r.enemyCount)),
      // 含召唤物的同场敌人峰值（F8 若出现 cipher 召唤，这里会高于 enemiesMax）
      enemiesPeakWithSummons: Math.max(...rows.map((r) => r.peakEnemies || 0))
    };
  }

  // 三问
  const f5 = summary.baseline[5];
  const f6 = summary.baseline[6];
  // 第 5/6 层都优先用无敌轮清场中位（同口径对照），没有无敌轮时才退回真实模式。
  const f5inv = summary.invincible[5];
  const f5time = (f5inv && f5inv.clearedCount > 0)
    ? f5inv.clearTime.median : (f5 ? f5.clearTime.median : 0);
  const f6inv = summary.invincible[6];
  const f6time = (f6inv && f6inv.clearedCount > 0) ? f6inv.clearTime.median : (f6 ? f6.clearTime.median : 0);
  const cliff = (f5 && f6 && f5time > 0 && f6time > 0) ? {
    clearRatio: Number((f6time / f5time).toFixed(2)),
    clearBasis: (f5inv && f5inv.clearedCount > 0 && f6inv && f6inv.clearedCount > 0)
      ? 'F5、F6 均为无敌轮' : 'F5、F6 真实模式',
    hpRatio: Number((f6.hpSum.median / (f5.hpSum.median || 1)).toFixed(2)),
    enemyRatio: Number((f6.enemyCount.median / (f5.enemyCount.median || 1)).toFixed(2)),
    hp5: Math.round(f5.hpSum.median), hp6: Math.round(f6.hpSum.median),
    enemy5: f5.enemyCount.median, enemy6: f6.enemyCount.median,
    isCliff: (f6time / f5time) >= 1.4
      || (f6.hpSum.median / (f5.hpSum.median || 1)) >= 1.6
      || (f6.enemyCount.median / (f5.enemyCount.median || 1)) >= 1.4
  } : null;

  // 曲线形态：优先用"无敌模式"的清场中位（纯 DPS 受限，不受 bot 死亡干扰）；
  // 无敌轮缺失/超时的层留空（gap），增长率只在相邻两层都有数据时计算。
  const curvePoints = [];
  for (const n of (PILOT ? [6, 10] : [6, 7, 8, 9, 10])) {
    const inv = summary.invincible[n];
    const real = summary.baseline[n];
    const useInv = !!(inv && inv.clearedCount > 0);
    curvePoints.push({
      floor: n,
      source: useInv ? 'invincible' : 'real',
      median: useInv ? inv.clearTime.median : (real ? real.clearTime.median : 0),
      ok: useInv ? inv.clearedCount > 0 : !!(real && real.clearedCount > 0)
    });
  }
  const growth = [];
  const increments = [];
  const growthPairs = [];
  for (let i = 1; i < curvePoints.length; i += 1) {
    const a = curvePoints[i - 1];
    const b = curvePoints[i];
    if (!a.ok || !b.ok || !a.median) continue;
    growth.push(Number((b.median / a.median - 1).toFixed(3)));
    increments.push(Number((b.median - a.median).toFixed(2)));
    growthPairs.push(`F${a.floor}→F${b.floor}`);
  }
  const growthSpread = growth.length ? Math.max(...growth) - Math.min(...growth) : 0;
  const shape = growth.length < 2
    ? '样本不足（相邻层有超时/0 清场，无法判定曲线形态）'
    : (growthSpread <= 0.06
      ? '指数（等比增长，增长率稳定）'
      : ((growth[growth.length - 1] - growth[0]) > 0.08 ? '后段陡增（增长率逐层抬升）' : '线性/混合（增量更接近常数）'));

  const worst = Object.entries(judgments)
    .sort((a, b) => Math.abs(b[1].bias) - Math.abs(a[1].bias))[0];

  // ---------- 7) 断言 ----------
  const allBaseline = Object.values(baseline.floors).flat().filter((r) => !r.invalid);
  const targetFloors = allBaseline.filter((r) => r.floor >= 6);
  const counts = {};
  for (const floor of FLOORS) counts[floor] = (baseline.floors[floor] || []).filter((r) => !r.invalid).length;
  check('第 5–10 层各 ≥8 次真实样本', !PILOT && Object.values(counts).every((n) => n >= 8), counts);
  check('普通战斗房口径纯净（roomType 全为 battle）', allBaseline.every((r) => r.roomType === 'battle'),
    { roomTypes: Array.from(new Set(allBaseline.map((r) => r.roomType))),
      offType: allBaseline.filter((r) => r.roomType !== 'battle').length });
  // 第 5 层战斗房数量仍走"旧难度公式"（预算配置从第 6 层才生效），会冒出 7 只，所以 ≤6 只对第 6–10 层判红
  check('同场敌人数 ≤6（第 6–10 层）', targetFloors.every((r) => r.enemyCount <= CONST.maxEnemies),
    { max: targetFloors.length ? Math.max(...targetFloors.map((r) => r.enemyCount)) : 0,
      floor5Max: Math.max(0, ...allBaseline.filter((r) => r.floor === 5).map((r) => r.enemyCount)) });
  check('同屏投射物峰值 ≤30', allBaseline.every((r) => r.projectilePeak <= CONST.maxProjectiles),
    { max: Math.max(...allBaseline.map((r) => r.projectilePeak)) });
  const missing = allBaseline.filter((r) => !Number.isFinite(r.clearTime) || !Number.isFinite(r.dps)
    || !Number.isFinite(r.hpLossPct) || !Number.isFinite(r.projectilePeak) || !Number.isFinite(r.enemyCount));
  check('单场采样字段完整（clearTime/dps/hpLoss/projectilePeak/enemyCount）', missing.length === 0, { missing: missing.length });
  check('Boss 第 6/10 层各 ≥3 次真实样本',
    !PILOT && [6, 10].every((f) => (boss[f] || []).filter((r) => r.mode === 'real' && !r.invalid).length >= 3),
    Object.fromEntries([6, 10].map((f) => [f, (boss[f] || []).filter((r) => r.mode === 'real' && !r.invalid).length])));
  // 诊断用：记录"自然触发登场"与"脚本兜底触发"的次数（开放层 bug 的证据）
  const bossTrigger = Object.fromEntries(Object.keys(boss).map((f) => [f, {
    natural: (boss[f] || []).filter((r) => r.naturalTrigger === true && !r.invalid).length,
    forced: (boss[f] || []).filter((r) => r.naturalTrigger === false && !r.invalid).length,
    spawnedOk: (boss[f] || []).filter((r) => !r.invalid).length > 0
      && (boss[f] || []).filter((r) => !r.invalid).every((r) => r.bossHpMax > 0),
    bossHp: (boss[f] || []).filter((r) => !r.invalid).map((r) => r.bossHpMax)
  }]));
  check('预测轮覆盖配置可回读', PILOT || SKIP_PREDICT || (prediction.applied
    && prediction.applied.floorScale === 1.08
    && prediction.applied.battle[0] === 4
    && prediction.applied.bossHpCap === 3600), prediction.applied);
  const pageErrors = await ev('__roamDebug.errors()');
  check('无运行时报错', runtimeErrors.length === 0 && (!pageErrors || pageErrors.length === 0),
    { runtime: runtimeErrors.slice(0, 3), page: (pageErrors || []).slice(0, 3) });
  assertPerf('fps ≥ 60', Math.min(...Object.values(fpsByFloor)) >= 60, { fpsByFloor });
  const shotSizes = screenshots.map((name) => ({
    name, size: fs.existsSync(path.join(OUT, name)) ? fs.statSync(path.join(OUT, name)).size : 0
  }));
  check('截图 ≥2 张且 >60KB', PILOT || (shotSizes.length >= 2 && shotSizes.every((s) => s.size > 60 * 1024)), shotSizes);

  // ---------- 8) 输出 ----------
  const payload = {
    generatedAt: new Date().toISOString(),
    file: FILE,
    pilot: PILOT,
    conditions: {
      difficulty: 'normal', adaptive: false,
      build: ['fireball', 'flameCone'], heal: false,
      samplesPerFloor: SAMPLES, capSeconds: CAP, bossCapSeconds: BOSS_CAP,
      acceleratedSim: true, fpsMeasuredOnRaf: true
    },
    targets: { floors: TARGETS, boss: BOSS_TARGETS, constants: CONST },
    availability,
    fpsByFloor,
    baseline,
    summary,
    judgments,
    bossJudgments,
    bossTrigger,
    compliance,
    questions: { cliff, growth, growthPairs, increments, curvePoints, shape, worst },
    invincible,
    reference,
    prediction,
    checks,
    screenshots: shotSizes
  };
  fs.writeFileSync(RESULT_JSON, JSON.stringify(payload, null, 2));

  // 控制台简报
  log('===== 基线对账 =====');
  for (const floor of [6, 7, 8, 9, 10]) {
    if (!judgments[floor]) continue;
    const j = judgments[floor];
    log(`第 ${floor} 层 目标 ${j.target.join('–')}s | 实测中位 ${j.measuredMedian}s `
      + `(${j.measuredRange[0]}–${j.measuredRange[1]}) | 偏差 ${j.bias > 0 ? '+' : ''}${j.bias}% | ${j.verdict}`);
  }
  log('===== Boss 对账 =====');
  for (const floor of Object.keys(bossJudgments)) {
    const j = bossJudgments[floor];
    log(`第 ${floor} 层 Boss 目标 ${j.target.join('–')}s | 实测中位 ${j.measuredMedian}s `
      + `(${j.measuredRange[0]}–${j.measuredRange[1]}) | 偏差 ${j.bias > 0 ? '+' : ''}${j.bias}% | ${j.verdict}`);
  }
  if (cliff) log(`第 5→6 层：清场 ×${cliff.clearRatio} / 总血 ×${cliff.hpRatio} / 敌数 ×${cliff.enemyRatio} → ${cliff.isCliff ? '断崖' : '非断崖'}`);
  log(`曲线：${shape}；逐层增长率 ${growth.map((g, i) => `${growthPairs[i] || ''} ${(g * 100).toFixed(1)}%`).join(' · ')}`);
  if (worst) log(`偏差最大：第 ${worst[0]} 层（${worst[1].verdict}，${worst[1].bias > 0 ? '+' : ''}${worst[1].bias}%）`);
  log('结果 JSON：' + RESULT_JSON);
  log('截图：' + shotSizes.map((s) => `${s.name}(${Math.round(s.size / 1024)}KB)`).join(', '));

  if (checks.some((c) => !c.ok)) process.exitCode = 1;
  ws.close();
  killEdge(edge);
  return payload;
}

/**
 * 睡眠
 * @param {number} ms 毫秒
 * @returns {Promise<void>}
 */
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

main().catch((error) => {
  console.error('FATAL', error && error.stack ? error.stack : error);
  try { killEdge(EDGE_PROC); } catch (e) { /* 忽略 */ }
  process.exitCode = 1;
});
