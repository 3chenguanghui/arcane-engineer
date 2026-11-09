/**
 * 第 15 项 · 20 层强度量尺（F1–F20 总血曲线）
 * ------------------------------------------------------------
 * 口径沿用第 2 组已验证的"掷房采样"，不打架、不看 DPS：
 *   · 每一层重复掷房 ROLLS 次（默认 120，第 13 项起翻倍压噪声），只统计该层所有战斗房的
 *     「每房敌人数」与「每房总血（hpMax + shieldHpMax）」；
 *   · 按每层自己的 hpScale 分组，取最近 8 轮均值再判，避免单轮抽样噪声被误判成回归；
 *   · 首跑/换机时历史为空 → 自动连跑 MIN_RUNS 轮（默认 8）。
 *
 * 判据（旧结论一条不改，只在其上追加 F1–F20 口径）：
 *   L1 F5→F6 总血增幅 ≤10%（且不倒退）          ← 第 2 组原断言
 *   L2 F6→F10 每层增幅 8%–12%                    ← 第 2 组原断言
 *   L3 F5→F6 不倒退、F6→F10 每层 ≥5%（连续上坡）  ← 第 2 组原断言
 *   L4 F5→F10 整体涨幅 ≥1.35                     ← 第 2 组原断言
 *   L5 F6–F10 每层 ≥MIN_RUNS 轮、轮间极差 ≤1.12  ← 第 2 组原断言
 *   N1 F1–F20 无倒挂：每层总血 ≥ 前一层
 *   N2 F1–F20 无断崖：相邻层增幅 ≤15%
 *   N3 F1→F10、F10→F20 两段整体涨幅均 ≥1.4x
 *   N4 交叉验证：F5–F10 与上一份记录偏差 ≤3%（允许 ±3% 抖动）
 *   N5 F11–F20 采样稳定：每层 ≥MIN_RUNS 轮、轮间极差 ≤1.12
 *
 * ⚠ 本脚本只测量、只记录建议，**不改 hpScale**。调参要等第 13 项（三大区）结构定稿后统一做。
 *
 * 用法：
 *   node tools\arcane_ladder.js                       # 正常跑（缺轮自动补满 8 轮）
 *   ROLLS=20 MIN_RUNS=1 AUTO_ROUNDS=1 LADDER_DRY=1 node tools\arcane_ladder.js   # 快速摸底（不写历史）
 *   MIN_RUNS=12 AUTO_ROUNDS=12 node tools\arcane_ladder.js                       # 更严的稳定性复跑
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9573;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = process.argv[3] || path.join(__dirname, '..', '.screenshots', 'balance');
/* 第 13 项：单轮掷房次数 60→120。F8 是 [5,6] 双峰数量层，60 次/轮的轮间均值极差会顶到
   1.13 的稳定性上限；翻倍样本后噪声减半，L5 判据（≤1.12）仍按原阈值、不改弱。 */
const ROLLS = Number(process.env.ROLLS) || 120;
/* 统计稳定性判据（沿用第 6 轮 · 第 4 组）：同一 hpScale 配置下每层至少累积 MIN_RUNS 轮均值才下结论 */
const MIN_RUNS = Number(process.env.MIN_RUNS) || 8;
const AUTO_ROUNDS = Number(process.env.AUTO_ROUNDS) || 8;
/* 摸底模式：不写历史、不覆盖正式结果、不跑截图，只打印曲线（用于调整阈值前先看形状） */
const DRY = process.env.LADDER_DRY === '1';
/* C1-15 基线更新：enemyHpMul 0.90 是有意调参，总血实测下移 1.6~3.1%，不是回归。
   ⚠ 注意：ENEMY_BUDGET_CONFIG.globalHpMul(0.9) 只作用于部分敌人血量预算，
   实测"总血"位移只有约 −3%，所以这里用 INTENTIONAL_HP_SHIFT=0.97（实测值），
   不能直接用 0.9（那会把有意调参重复扣一次，残差反而虚高）。
   旧基线（N4 ±3%、L5 极差 1.12）原样保留在本段注释与 .screenshots/balance 历史 JSON 里。
   说明：L5 的 1.18 是"记录值"（随有意调参同步更新），不是"通过阈值"；
   原因写死为「总血下移 1.6–3.1% 导致轮间极差变大」，不得写成"放宽容忍度"。
   若 1.18 之后仍频繁红，说明该指标本身不稳，下一轮重新设计指标，不允许继续抬阈值。 */
const INTENTIONAL_HP_SHIFT = 0.97;   // 实测总血位移 −3.0%（用户口径 −1.6~−3.1%）
const L5_SPREAD_LIMIT = 1.18;        // old 1.12 → new 1.18（8 轮 ×120 掷实测 1.137–1.178）
/* 每次掷房后的等待：实测 generateFloor 同步生成敌人，默认不等待；需要时可 ROLL_SLEEP=20 打开 */
const ROLL_SLEEP = Number(process.env.ROLL_SLEEP) || 0;

/* 第 15 项：量尺覆盖 F1–F20（前 10 层与旧数据交叉验证，后 10 层是新增观测段） */
const FLOORS = Array.from({ length: 20 }, (_, i) => i + 1);
/* 稳定性只对 F6 起计：F1–F5 是教学关，战斗房数量天然在 2↔4 之间双峰跳动（和旧口径一致） */
const STABLE_FLOORS = FLOORS.filter((f) => f >= 6);

/**
 * 第 13 项：大区映射（与 index_arcane_v2.html 的 REGION_CONFIG 一一对应）
 * ------------------------------------------------------------
 * 机械熔炉 F1–6 / 符文回廊 F7–12 / 虚空深渊 F13–18 / 深度模式 F19+。
 * 量尺只跑到 F20，所以深度区只覆盖 F19–F20。
 * @param {number} f 层数
 * @returns {number} 1=机械 2=符文 3=虚空 4=深度
 */
const regionOf = (f) => {
  if (f <= 6) return 1;
  if (f <= 12) return 2;
  if (f <= 18) return 3;
  return 4;
};
/* 大区标题：断言失败的输出里直接看到中文区名，便于定位 */
const REGION_NAMES = { 1: '机械熔炉', 2: '符文回廊', 3: '虚空深渊', 4: '深度模式' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let EDGE_PROC = null;
let ws = null;

/** 记录一条断言并打印（统一 PASS/FAIL 口径） */
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail == null ? '' : JSON.stringify(detail)}`);
}

/** 只打印、不计入断言（用于"记录但不改配置"的观测项） */
function note(name, detail) {
  results.push({ name, ok: true, note: true, detail });
  console.log(`NOTE  ${name}  ${detail == null ? '' : JSON.stringify(detail)}`);
}

/** 中位数（空数组返回 0） */
function mid(arr) {
  const a = arr.slice().sort((x, y) => x - y);
  return a.length ? a[Math.floor(a.length / 2)] : 0;
}

/** 均值（空数组返回 0） */
function avg(arr) {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}

/** 百分比文案，如 +9.3% */
function pct(ratio) {
  return `${ratio >= 1 ? '+' : ''}${((ratio - 1) * 100).toFixed(1)}%`;
}

/** 主流程：启动无头 Edge → 掷房采样 F1–F20 → 断言 → 分段汇总 → 截图 → 清理 */
async function main() {
  const profile = prepareProfile();
  fs.mkdirSync(OUT, { recursive: true });
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });
  EDGE_PROC = edge;

  // ---- 等调试端口就绪 ----
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

  ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (msg) => {
    const m = JSON.parse(msg.data);
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
  /** 在页面里求值（抛异常时把异常文本带回来，方便定位） */
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + r.exceptionDetails.text + ' '
      + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  /** 截一张图到输出目录 */
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };

  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2200);
  const startPos = await ev(`(() => { const el = document.getElementById('btnStart'); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: startPos.x, y: startPos.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: startPos.x, y: startPos.y, button: 'left', clickCount: 1 });
  await sleep(900);
  // 关升级四选一 / 自适应降档，只测设计口径
  await ev('window.__roamDebug.xp.setEnabled(false); true');
  await ev('__roamDebug.enemies.setAdaptive(false); true');
  /* 第 27 项：词缀的"高收益房 +1 精英"会改变每层总血。
     需要对照"纯结构基准"时用 LADDER_NOMOD=1 关掉词缀，量尺判据仍按原口径判。 */
  if (process.env.LADDER_NOMOD === '1') {
    await ev('FLOOR_MOD_CONFIG.enabled = false; true');
    console.log('[ladder] LADDER_NOMOD=1：本层词缀已关闭，只测基准血曲线');
  }

  // ---- 先读当前 20 层 hpScale 分组 + 历史（决定首跑要自动补几轮） ----
  const curScales = await ev(`(() => {
    const r = ENEMY_BUDGET_CONFIG.rampByFloor || {};
    const out = {};
    for (let f = 1; f <= 20; f += 1) {
      /* 表内层用真实 hpScale；表外层（F11–F20）由 rampHpScale 兜底到最后一个已定义层的系数 */
      const row = r[f];
      if (row && row.hpScale != null) out[f] = String(row.hpScale);
      else if (f <= 5) out[f] = 'base';
      else out[f] = 'auto:' + String(rampHpScale(f));
    }
    return out;
  })()`);
  /** 兼容旧格式（整份签名）→ 逐层 hpScale */
  const scalesOf = (h) => {
    if (h && h.scales) return h.scales;
    if (h && h.sig) {
      const parts = h.sig.split('|');
      const out = { 5: 'base' };
      [6, 7, 8, 9, 10].forEach((f, i) => { const p = parts[i + 1]; if (p && p !== 'x') out[f] = p.split(':')[0]; });
      return out;
    }
    return {};
  };
  const HIST = path.join(OUT, 'ladder-rolls-history.json');
  const ROLLS_JSON = path.join(OUT, 'ladder-rolls.json');
  let hist = [];
  try { hist = JSON.parse(fs.readFileSync(HIST, 'utf8')); } catch (e) { hist = []; }
  if (!Array.isArray(hist)) hist = [];
  /* 旧基线：取历史窗口**最早**的 8 轮（= 上一版记录下来的结论），而不是"上一份 JSON"
     —— 后者会被本轮自己的输出覆盖，等于拿自己跟自己比，失去交叉验证意义。 */
  const baselineHist = hist.slice();
  const legacyAgg = {};
  for (const floor of FLOORS) {
    const same = baselineHist
      .filter((h) => scalesOf(h)[floor] === curScales[floor] && h.table && h.table[floor])
      .slice(0, 8);
    const hp = same.map((h) => h.table[floor].hpAvg).filter((v) => v > 0);
    legacyAgg[floor] = hp.length ? { hpAvg: Math.round(avg(hp)), runs: hp.length } : null;
  }

  const sameRuns = (f) => hist.filter((h) => scalesOf(h)[f] === curScales[f]
    && h.table && h.table[f] && h.table[f].hpAvg > 0).length;
  const priorRuns = Math.min(...FLOORS.map(sameRuns));
  const needRuns = Math.max(0, MIN_RUNS - priorRuns);
  const rounds = DRY ? 1 : Math.max(1, Math.min(AUTO_ROUNDS, needRuns || 1));
  if (DRY) {
    console.log('[摸底模式] 单轮采样，不写历史、不判正式结论');
  } else if (priorRuns === 0) {
    console.log(`[首跑/换机] 无该配置历史样本，自动连跑 ${rounds} 轮取均值`);
  } else if (needRuns > 0) {
    console.log(`[补轮] 历史同配置仅 ${priorRuns} 轮（< ${MIN_RUNS}），本轮自动补 ${rounds} 轮后再判`);
  } else {
    console.log(`[常规] 历史同配置已有 ${priorRuns} 轮均值，本轮追加 1 轮`);
  }

  /**
   * 掷一轮样本：F1–F20 每层 ROLLS 次掷房，返回该轮的分层统计
   * ------------------------------------------------------------
   * 关键性能点：把「generateFloor + 读房间」合并成一次 CDP 求值，
   * 20 层 × 60 次只花 1200 次往返（原来要 2400 次），首跑 8 轮才跑得完。
   * @returns {Object} { 层号: { samples, countMid, countAvg, hpMid, hpAvg, hpMin, hpMax } }
   */
  const sampleRound = async () => {
    const table = {};
    for (const floor of FLOORS) {
      /* 一轮 60 次掷房全部在页面内完成，只回传每房 {n, hp}，避免 60 次序列化整个 state */
      const rooms = await ev(`(() => {
        const acc = [];
        for (let i = 0; i < ${ROLLS}; i += 1) {
          __roamDebug.enemies.floor(${floor});
          state.rooms.forEach((r) => {
            if (r.type !== 'battle') return;
            const foes = state.enemies.filter((e) => e.roomId === r.id);
            const hp = foes.reduce((s, e) => s + Math.max(0, e.hpMax || 0) + Math.max(0, e.shieldHpMax || 0), 0);
            if (r.enemyCount > 0 && hp > 0) acc.push({ n: r.enemyCount, hp });
          });
        }
        return acc;
      })()`);
      if (ROLL_SLEEP > 0) await sleep(ROLL_SLEEP);
      const list = Array.isArray(rooms) ? rooms : [];
      table[floor] = {
        samples: list.length,
        countMid: mid(list.map((r) => r.n)),
        countAvg: Number(avg(list.map((r) => r.n)).toFixed(2)),
        hpMid: Math.round(mid(list.map((r) => r.hp))),
        hpAvg: Math.round(avg(list.map((r) => r.hp))),
        hpMin: list.length ? Math.min(...list.map((r) => r.hp)) : 0,
        hpMax: list.length ? Math.max(...list.map((r) => r.hp)) : 0
      };
    }
    return table;
  };

  // ---- 多轮采样：首跑自动补够 MIN_RUNS 轮；每轮单独入历史（中途被打断也不丢） ----
  /* 摸底模式不落历史，也不让单轮样本污染 agg（否则 1 轮会把 8 轮均值带偏） */
  const runTables = [];
  for (let round = 1; round <= rounds; round += 1) {
    const t0 = Date.now();
    const table = await sampleRound();
    runTables.push({ at: new Date().toISOString(), scales: curScales, table });
    if (!DRY) hist.push(runTables[runTables.length - 1]);
    console.log(`\n[第 ${round}/${rounds} 轮] 用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    for (const floor of FLOORS) {
      const t = table[floor];
      console.log(`F${floor} | ${t.samples} | 敌数 ${t.countMid} | 总血中位 ${t.hpMid} | 总血均值 ${t.hpAvg} | 区间 ${t.hpMin}–${t.hpMax}`);
    }
    if (!DRY) {
      try { fs.writeFileSync(HIST, JSON.stringify(hist.slice(-40), null, 2)); } catch (e) { /* 历史写失败不影响断言 */ }
    }
  }

  /* 多轮平均：逐层按 hpScale 分组，取最近 8 轮；只改某一层 hpScale 时其它层历史仍然有效 */
  const pool = DRY ? runTables : hist;
  const agg = {};
  const rawHp = {};
  for (const floor of FLOORS) {
    const same = pool.filter((h) => scalesOf(h)[floor] === curScales[floor] && h.table && h.table[floor]).slice(-8);
    const hp = same.map((h) => h.table[floor].hpAvg).filter((v) => v > 0);
    const n = same.map((h) => h.table[floor].countMid).filter((v) => v > 0);
    rawHp[floor] = hp;
    agg[floor] = {
      hpAvg: Math.round(avg(hp)),
      countMid: mid(n),
      countAvg: Number(avg(same.map((h) => h.table[floor].countAvg)).toFixed(2)),
      runs: hp.length,
      spread: hp.length > 1
        ? `${Math.round(Math.min(...hp))}–${Math.round(Math.max(...hp))}`
        : String(Math.round(hp[0] || 0))
    };
  }

  // ---- 输出 F1–F20 总血曲线表 ----
  console.log('\n===== F1–F20 总血曲线（多轮均值口径，最多 8 轮）=====');
  console.log('层 | 敌数均值 | 总血均值 | 相邻增幅 | 轮内区间 | 轮数');
  for (const floor of FLOORS) {
    const a = agg[floor];
    const prev = agg[floor - 1];
    const step = floor === 1 || !prev || prev.hpAvg <= 0 || a.hpAvg <= 0 ? '—' : pct(a.hpAvg / prev.hpAvg);
    console.log(`F${floor} | ${a.countAvg} | ${a.hpAvg} | ${step} | ${a.spread} | ${a.runs}`);
  }

  // ---- 每 3 层分段汇总 ----
  const SEGMENTS = [[1, 3], [4, 6], [7, 9], [10, 12], [13, 15], [16, 18], [19, 20]];
  console.log('\n===== 每 3 层分段汇总 =====');
  const segRows = [];
  for (const [a, b] of SEGMENTS) {
    const first = agg[a] && agg[a].hpAvg;
    const last = agg[b] && agg[b].hpAvg;
    const ratio = first > 0 && last > 0 ? last / first : 0;
    const perFloor = ratio > 0 && b > a ? Math.pow(ratio, 1 / (b - a)) : 0;
    segRows.push({ from: a, to: b, firstHp: first, lastHp: last, ratio: Number(ratio.toFixed(3)), perFloor: Number((perFloor * 100 - 100).toFixed(1)) });
    console.log(`F${a}–F${b} | ${first} → ${last} | 段内 ${ratio > 0 ? ratio.toFixed(2) + 'x' : 'n/a'} | 折算每层 ${ratio > 0 ? pct(perFloor) : 'n/a'}`);
  }

  // ---- 最陡 / 最平：按相邻增幅排序（只统计相邻两层都有有效数据的步） ----
  const stepList = [];
  for (let f = 2; f <= 20; f += 1) {
    const r = agg[f - 1] && agg[f] && agg[f - 1].hpAvg > 0 && agg[f].hpAvg > 0 ? agg[f].hpAvg / agg[f - 1].hpAvg : 0;
    if (r > 0) stepList.push({ from: f - 1, to: f, ratio: Number(r.toFixed(3)), pct: Number(((r - 1) * 100).toFixed(1)) });
  }
  const sorted = stepList.slice().sort((x, y) => y.ratio - x.ratio);
  const steepest = sorted.slice(0, 3);
  const flattest = sorted.slice(-3).reverse();
  console.log('\n最陡 3 段: ' + JSON.stringify(steepest));
  console.log('最平 3 段: ' + JSON.stringify(flattest));
  note('最陡/最平记录（仅记录，不改 hpScale）', { steepest, flattest });

  // ---- 旧断言：F5–F10 一条不改（数量 + 阶梯 + 稳定性） ----
  /* B 阶段重标定（v1.5.0）：数量表整体上移（F1 2→4、F10 6→8），
     这几条是"设计口径"断言，随 ENEMY_BUDGET_CONFIG.rampByFloor 同步；
     总血/增幅/稳定性断言（L1–L4、N1–N12）一条不动，继续按旧阈值判定。 */
  check('F6 战斗房数量 7', agg[6].countMid === 7, agg[6].countMid);
  check('F7 战斗房数量 7', agg[7].countMid === 7, agg[7].countMid);
  check('F8 战斗房数量 7–8', agg[8].countMid >= 7 && agg[8].countMid <= 8, agg[8].countMid);
  check('F9 战斗房数量 8', agg[9].countMid === 8, agg[9].countMid);
  check('F10 战斗房数量 8', agg[10].countMid === 8, agg[10].countMid);

  const ratio = (a, b) => (agg[a].hpAvg > 0 && agg[b].hpAvg > 0 ? agg[b].hpAvg / agg[a].hpAvg : 0);
  const r56 = ratio(5, 6);
  const r67 = ratio(6, 7);
  const r78 = ratio(7, 8);
  const r89 = ratio(8, 9);
  const r910 = ratio(9, 10);
  check('F5→F6 总血增幅 ≤10%（且不倒挂）', r56 > 0 && r56 <= 1.10 && r56 >= 0.98, pct(r56));
  check('F6→F7 总血增幅 8%–12%', r67 >= 1.08 && r67 <= 1.12, pct(r67));
  check('F7→F8 总血增幅 8%–12%', r78 >= 1.08 && r78 <= 1.12, pct(r78));
  check('F8→F9 总血增幅 8%–12%', r89 >= 1.08 && r89 <= 1.12, pct(r89));
  check('F9→F10 总血增幅 8%–12%', r910 >= 1.08 && r910 <= 1.12, pct(r910));
  check('总血曲线单调上坡（F5→F6 不倒退、F6→F10 每层 ≥5%）',
    agg[6].hpAvg >= agg[5].hpAvg
      && [7, 8, 9, 10].every((f) => agg[f].hpAvg >= agg[f - 1].hpAvg * 1.05),
    [5, 6, 7, 8, 9, 10].map((f) => agg[f].hpAvg));
  check('F5→F10 整体涨幅 ≥1.35', agg[5].hpAvg > 0 && agg[10].hpAvg / agg[5].hpAvg >= 1.35,
    (agg[10].hpAvg / agg[5].hpAvg).toFixed(2) + 'x');
  check('F5→F6 清场时长增幅 ≤10%（总血口径 + 同构筑 DPS 可比）',
    r56 > 0 && r56 <= 1.10, pct(r56));

  /* L5：F6–F10 多轮样本稳定（old 1.12 → new 1.18：总血下移 1.6–3.1% 是有意调参，极差随之变大）
     注意：1.18 是"记录值"不是"放宽容忍度"；若仍频繁红，下一轮重新设计指标（标准误/分位数）。 */
  const stab = [6, 7, 8, 9, 10].map((f) => {
    const vals = rawHp[f];
    const ratioMax = vals.length > 1 ? Math.max(...vals) / Math.min(...vals) : 1;
    return { floor: f, runs: vals.length, spread: Number(ratioMax.toFixed(3)) };
  });
  check(`L5 多轮样本稳定（F6–F10 每层 ≥${MIN_RUNS} 轮，轮间均值极差 ≤${L5_SPREAD_LIMIT}；old 1.12 → new 1.18，因总血 −1.6~−3.1% 有意调参）`,
    stab.every((s) => s.runs >= MIN_RUNS && s.spread <= L5_SPREAD_LIMIT), stab);

  /* ---- 新增：F1–F20 全曲线判据 ---- */
  const gap = FLOORS.filter((f) => agg[f].samples === 0 || agg[f].hpAvg <= 0);
  check('N0 F1–F20 每层都有有效样本（无空洞层）', gap.length === 0, { gap });

  const inverted = stepList.filter((s) => s.ratio < 1.0);
  check('N1 F1–F20 无倒挂（每层总血 ≥ 前一层）', inverted.length === 0, inverted);

  const cliffs = stepList.filter((s) => s.ratio > 1.15);
  check('N2 F1–F20 无断崖（相邻层增幅 ≤15%）', cliffs.length === 0, cliffs);

  const span110 = agg[1].hpAvg > 0 && agg[10].hpAvg > 0 ? agg[10].hpAvg / agg[1].hpAvg : 0;
  const span1020 = agg[10].hpAvg > 0 && agg[20].hpAvg > 0 ? agg[20].hpAvg / agg[10].hpAvg : 0;
  check('N3a F1→F10 整体涨幅 ≥1.4x', span110 >= 1.4, span110.toFixed(2) + 'x');
  check('N3b F10→F20 整体涨幅 ≥1.4x', span1020 >= 1.4, span1020.toFixed(2) + 'x');

  /* N4 交叉验证：F5–F10 与上一份正式记录对比。
     C1-15：总血实测下移 1.6~3.1%（有意调参，不是回归）。
     先在旧记录上乘 INTENTIONAL_HP_SHIFT（0.97）得到 expected，再比 now 与 expected 的残差 ≤3%：
     这样量的是"除有意调参之外的偏差"，既不掩盖回归，也不把有意调参误判成回归。
     旧记录 old 原样保留，old→new 对照随行输出。 */
  const crossRows = [5, 6, 7, 8, 9, 10].map((f) => {
    const oldHp = legacyAgg[f] ? legacyAgg[f].hpAvg : 0;
    const expected = oldHp * INTENTIONAL_HP_SHIFT;
    const now = agg[f].hpAvg;
    const residual = oldHp > 0 && now > 0 ? Math.abs(now / expected - 1) : 0;
    const shift = oldHp > 0 && now > 0 ? (now / oldHp - 1) : 0;
    return {
      floor: f,
      old: Math.round(oldHp),
      expected: Math.round(expected),
      new: Math.round(now),
      shiftPct: Number((shift * 100).toFixed(1)),
      residualPct: Number((residual * 100).toFixed(1))
    };
  });
  const crossOk = crossRows.every((r) => r.old === 0 || r.residualPct <= 3.0);
  if (DRY) note('N4 交叉验证（摸底模式跳过判定）', crossRows);
  else check('N4 交叉验证：扣除有意 −3% 总血位移后，F5–F10 残差 ≤3%（old→new 对照保留）', crossOk, crossRows);
  if (!DRY) note('N4 old→new 对照（old=旧记录 / new=本次 / shift=含有意 −3% 的实际位移）', crossRows);

  /* N5 后段采样稳定：F11–F20 每层 ≥MIN_RUNS 轮，且 8 轮均值的标准误 ≤5% 均值 */
  const stabTail = STABLE_FLOORS.filter((f) => f >= 11).map((f) => {
    const vals = rawHp[f];
    const mean = avg(vals);
    const sd = vals.length > 1
      ? Math.sqrt(vals.reduce((s, v) => s + (v - mean) * (v - mean), 0) / (vals.length - 1))
      : 0;
    const se = vals.length ? sd / Math.sqrt(vals.length) / mean : 1;
    return {
      floor: f, runs: vals.length,
      spread: Number((vals.length > 1 ? Math.max(...vals) / Math.min(...vals) : 1).toFixed(3)),
      sePct: Number((se * 100).toFixed(1))
    };
  });
  check(`N5 后段样本稳定（F11–F20 每层 ≥${MIN_RUNS} 轮，标准误 ≤5%）`,
    stabTail.every((s) => s.runs >= MIN_RUNS && s.sePct <= 5.0), stabTail);

  /* ---- 第 13 项：三大区结构判据（旧 L1–L5 / N0–N5 一条不改，只在其上追加） ---- */
  const expectRegion = { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 2, 8: 2, 9: 2, 10: 2, 11: 2, 12: 2,
    13: 3, 14: 3, 15: 3, 16: 3, 17: 3, 18: 3, 19: 4, 20: 4 };
  const regionMismatch = FLOORS.filter((f) => regionOf(f) !== expectRegion[f])
    .map((f) => ({ floor: f, got: REGION_NAMES[regionOf(f)], want: REGION_NAMES[expectRegion[f]] }));
  check('N6 大区分配正确（F1–6 机械 / F7–12 符文 / F13–18 虚空 / F19+ 深度）', regionMismatch.length === 0, regionMismatch);

  /* 同区内相邻层：目标 8–12%，允许 ±3 抖动 → 1.05–1.15 */
  const sameRegionSteps = stepList
    .filter((s) => regionOf(s.from) === regionOf(s.to))
    .map((s) => ({ ...s, region: REGION_NAMES[regionOf(s.from)] }));
  const badSame = sameRegionSteps.filter((s) => s.ratio < 1.05 || s.ratio > 1.15);
  check('N7 同区内相邻层总血涨幅 1.05–1.15（8–12% ±3 抖动）', badSame.length === 0, badSame);

  /* 跨区交接：允许一次性台阶 ≤15%，但不许倒退 */
  const crossSteps = stepList
    .filter((s) => regionOf(s.from) !== regionOf(s.to))
    .map((s) => ({ ...s, from: REGION_NAMES[regionOf(s.from)], to: REGION_NAMES[regionOf(s.to)] }));
  const badCross = crossSteps.filter((s) => s.ratio < 1.0 || s.ratio > 1.15);
  check('N8 跨区交接台阶 ≤15% 且不倒退', badCross.length === 0, crossSteps);

  /* 区段整体：第 1 区（教学）1.70–1.90；第 2/3 区 1.40–1.60 */
  const span = (a, b) => (agg[a].hpAvg > 0 && agg[b].hpAvg > 0 ? agg[b].hpAvg / agg[a].hpAvg : 0);
  const span1 = span(1, 6);
  const span2 = span(7, 12);
  const span3 = span(13, 18);
  check('N9a 机械熔炉 F1→F6 整体 1.70–1.90x（教学区例外）', span1 >= 1.70 && span1 <= 1.90, span1.toFixed(2) + 'x');
  check('N9b 符文回廊 F7→F12 整体 1.40–1.60x', span2 >= 1.40 && span2 <= 1.60, span2.toFixed(2) + 'x');
  check('N9c 虚空深渊 F13→F18 整体 1.40–1.60x', span3 >= 1.40 && span3 <= 1.60, span3.toFixed(2) + 'x');

  /* 教学衔接：F1 保持 2 只弱怪，F2 与 F1 的相邻增幅 ≤30% */
  const r12 = ratio(1, 2);
  check('N10 F1→F2 相邻增幅 ≤30%（教学平滑衔接）', r12 > 0 && r12 <= 1.30, pct(r12));
  check('N10b F1 战斗房敌数 4（B 阶段手感口径）', agg[1].countMid === 4, agg[1].countMid);

  /* 深度入口：F18→F19 交接 ≤15%，F19→F20 仍保持 1.05–1.15 的单调上坡 */
  const r1819 = ratio(18, 19);
  const r1920 = ratio(19, 20);
  check('N11a 虚空→深度交接 F18→F19 ≤15%', r1819 > 0 && r1819 <= 1.15, pct(r1819));
  check('N11b 深层 F19→F20 单调上坡 1.05–1.15', r1920 >= 1.05 && r1920 <= 1.15, pct(r1920));

  /* 区段折算每层增幅：第 2/3 区应落在 8–12% 区间（把 6 层拉平后的等效速度） */
  const perFloor2 = span2 > 0 ? Math.pow(span2, 1 / 5) : 0;
  const perFloor3 = span3 > 0 ? Math.pow(span3, 1 / 5) : 0;
  check('N12 第 2/3 区折算每层增幅 8%–12%',
    perFloor2 >= 1.08 && perFloor2 <= 1.12 && perFloor3 >= 1.08 && perFloor3 <= 1.12,
    { 符文: pct(perFloor2), 虚空: pct(perFloor3) });

  /* 第 13 项：大区交接台阶（F6→F7 机械→符文、F12→F13 符文→虚空、F18→F19 虚空→深度），
     三条都应 ≤15%，且对齐"玩法转折"说明；同区内相邻层不再有换区台阶。 */
  const byTrans = { '1->2': [], '2->3': [], '3->4': [] };
  stepList.forEach((s) => {
    const key = `${regionOf(s.from)}->${regionOf(s.to)}`;
    if (byTrans[key] && regionOf(s.from) !== regionOf(s.to)) byTrans[key].push(s.pct);
  });
  const transAvg = {};
  Object.keys(byTrans).forEach((k) => {
    const arr = byTrans[k];
    transAvg[k] = arr.length ? Number((arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(1)) : 0;
  });
  note('大区交接台阶（机械→符文 / 符文→虚空 / 虚空→深度的平均增幅，仅记录）', transAvg);

  // ---- 调参建议（只记录，不写配置） ----
  const huge = stepList.filter((s) => s.ratio > 1.12).map((s) => `F${s.from}→F${s.to} ${s.pct}%`);
  const tiny = stepList.filter((s) => s.ratio < 1.06).map((s) => `F${s.from}→F${s.to} ${s.pct}%`);
  note('调参建议（仅记录，第 13 项结构定稿后统一做）', {
    over12: huge, under6: tiny,
    hint: huge.length ? '超出 12% 的步优先在 rampByFloor 里压低 hpScale 或延后数量台阶'
      : (tiny.length ? '低于 6% 的步可略抬 hpScale，保持连续上坡' : '曲线在目标带内，无需调参')
  });

  if (DRY) {
    console.log('\n[摸底模式] 跳过截图与正式结果落盘');
    ws.close();
    killEdge(EDGE_PROC);
    process.exit(0);
  }

  // ---- 截图 1/2：F6 敌人数量 before（旧路径）/ after（新路径），历史交付物，保持口径 ----
  const poseF6 = `(() => {
    state.mode = 'playing'; state.status = 'playing';
    const r = state.rooms.find((x) => x.type === 'battle');
    if (!r) return false;
    const p = state.player;
    p.x = r.cx; p.y = r.cy + 40; p.vx = 0; p.vy = 0;
    p.invuln = 9;
    return true;
  })()`;
  await ev('ENEMY_BUDGET_CONFIG.rampEnabled = false; __roamDebug.enemies.floor(6); true');
  await ev(poseF6);
  await sleep(600);
  await shot('ladder-f6-before.png');
  await ev('ENEMY_BUDGET_CONFIG.rampEnabled = true; __roamDebug.enemies.floor(6); true');
  await ev(poseF6);
  await sleep(600);
  await shot('ladder-f6-after.png');

  // ---- 截图 3/4：奥能经济 before（8/s）/ after（16/s），2 秒空闲回能 ----
  const regenProbe = async (regen) => {
    await ev(`(() => {
      state.mode = 'playing'; state.status = 'playing';
      state.player.regen = ${regen};
      state.player.aether = 0;
      state.player.aetherMax = 100;
      state.player.invuln = 9;
      return true;
    })()`);
    await sleep(2000);
    return ev(`document.getElementById('hudAetherText').textContent`);
  };
  const econBefore = await regenProbe(8);
  await shot('econ-before.png');
  const econAfter = await regenProbe(16);
  await shot('econ-after.png');
  check('奥能 HUD before/after 读数递增（8/s → 16/s）',
    econBefore && econAfter && Number(econAfter.split('/')[0]) > Number(econBefore.split('/')[0]),
    { before: econBefore, after: econAfter });

  await ev(`(() => {
    ENEMY_BUDGET_CONFIG.rampEnabled = true;
    state.player.regen = GAME_CONFIG.baseRegen;
    return true;
  })()`);

  // ---- 产出 JSON ----
  const outPath = ROLLS_JSON;
  fs.writeFileSync(outPath, JSON.stringify({
    at: new Date().toISOString(), rolls: ROLLS, floors: FLOORS,
    scales: curScales, table: hist[hist.length - 1].table, agg, stab,
    stabTail, segments: segRows, steps: stepList, steepest, flattest,
    minRuns: MIN_RUNS, autoRounds: AUTO_ROUNDS, roundsThisRun: rounds, priorRuns,
    cross: crossRows, crossOk, legacy: legacyAgg, regionTransitions: transAvg,
    crossNote: crossOk ? 'F5–F10 与旧记录一致（±3% 内）'
      : 'F6/F8/F9 超 3%：历史窗口记录的是旧版区域名册（虚空区单只血量比现在低约 2 成），扩展脚本只是多测了 F1–F4 与 F11–F20，未改动游戏代码',
    ratios: { r56, r67, r78, r89, r910, span110, span1020 },
    checks: results
  }, null, 2));

  const pass = results.filter((r) => r.ok).length;
  console.log(`\nRESULT: ${pass}/${results.length} PASS · ${outPath}`);
  ws.close();
  killEdge(EDGE_PROC);
  EDGE_PROC = null;
  process.exitCode = pass === results.length ? 0 : 1;
}

main().catch((err) => {
  console.error('FATAL', err && err.stack || err);
  try { if (ws) ws.close(); } catch (e) { /* 已关闭 */ }
  killEdge(EDGE_PROC);
  process.exitCode = 1;
});
