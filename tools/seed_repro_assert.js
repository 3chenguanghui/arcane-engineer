// 种子可复现断言（headless Edge + CDP）
// 用法：node tools/seed_repro_assert.js [被测文件] [输出目录] [--e1]
//   --e1 = 额外跑 E1 兼容断言（F1 清层多一次三选一，仅 seed-suite 模式有效）
// 两种模式：
//   1) deterministic-core（默认）：自带 mulberry32 种子注入，不依赖任何补丁，
//      断言「同种子 + 同操作序列 → 40 层生成逐字节一致」，并输出 FNV-1a / SHA-256 指纹，
//      供「接线前 vs 接线后」两个文件逐字节比对。
//   2) seed-suite：文件里若存在 window.__seedDebug（种子/每日挑战补丁），额外跑完整种子套件。
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9455;
const FILE = path.resolve(process.argv[2] || path.join(__dirname, '..', '.seedwork', 'index_seed_patched.html'));
const OUT = path.resolve(process.argv[3] || path.join(__dirname, '..', '.seedwork', 'shots'));
const E1_MODE = process.argv.includes('--e1');
// 确定性核心使用的固定种子（与 _probe/parity_generation.js 同一颗，便于交叉核对）
const SEED = 261108;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail == null ? '' : JSON.stringify(detail)}`);
}

/**
 * FNV-1a 32 位哈希（对 UTF-8 字节计算）
 * @param {string} str 输入字符串
 * @returns {number} 无符号 32 位哈希
 */
function fnv1a32(str) {
  const buf = Buffer.from(str, 'utf8');
  let h = 0x811c9dc5;
  for (let i = 0; i < buf.length; i += 1) {
    h ^= buf[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
/** 把 32 位哈希格式化成 0x 前缀的 8 位十六进制 */
const hex32 = (n) => '0x' + (n >>> 0).toString(16).padStart(8, '0');

// 注入脚本：在页面任何脚本执行前替换 Math.random 为固定种子的 mulberry32，
// 并暴露重播种函数 __probeSeedReset。这样不依赖任何测试补丁（如 __seedDebug），
// 主文件、备份、任意版本都能在同一随机流起点上复现。
const INJECT = `(function () {
  var SEED = ${SEED};
  /** mulberry32：32 位确定性伪随机数发生器 */
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  var rng = mulberry32(SEED);
  Math.random = function () { return rng(); };
  window.__probeSeed = SEED;
  window.__probeSeedReset = function () { rng = mulberry32(SEED); };
  window.__probeMathRandomInstalled = true;
})();`;

// 页面内表达式：两次独立重播种各生成 1–40 层 + 两次模拟，返回原始字符串供逐字节比较。
// 字段顺序固定，避免 JSON 键序抖动造成假差异。
const DET_EXPR = `(async () => {
  const has = (n) => { try { return typeof eval(n); } catch (e) { return 'THROW:' + e.name; } };
  const types = {
    buildValidatedFloorLayout: has('buildValidatedFloorLayout'),
    GAME_CONFIG: has('GAME_CONFIG'),
    simulate: (function () {
      try { return typeof (window.__roamDebug && window.__roamDebug.floorGen && window.__roamDebug.floorGen.simulate); }
      catch (e) { return 'THROW:' + e.name; }
    })()
  };
  if (typeof buildValidatedFloorLayout !== 'function') {
    return { types: types, error: 'buildValidatedFloorLayout 不存在，无法做确定性生成对拍' };
  }
  const minR = GAME_CONFIG.floorMinRooms || 4;
  const maxR = GAME_CONFIG.floorMaxRooms || 7;
  const cols = GAME_CONFIG.roomColumns || 3;
  const span = maxR - minR + 1;

  /** 把单层布局规范化为固定字段顺序的对象（不含时间戳等易变字段） */
  const norm = (floor, lay) => {
    const list = (lay && Array.isArray(lay.rooms)) ? lay.rooms : [];
    return {
      floor: floor,
      valid: !!(lay && lay.valid),
      fallback: !!(lay && lay.fallback),
      attempts: lay ? lay.attempts : null,
      spawnId: lay ? lay.spawnId : null,
      stairId: lay ? lay.stairId : null,
      rooms: list.map((r) => ({
        id: r.id,
        type: (r.type === undefined || r.type === null) ? null : String(r.type),
        x: r.x, y: r.y, w: r.w, h: r.h, cx: r.cx, cy: r.cy,
        seed: (r.seed === undefined) ? null : r.seed
      }))
    };
  };

  /** 从同一随机流起点生成 1–40 层，拼成多行字符串 */
  function genOnce() {
    window.__probeSeedReset();
    const out = [];
    for (let f = 1; f <= 40; f += 1) {
      const target = minR + (f % span);
      out.push(JSON.stringify(norm(f, buildValidatedFloorLayout(f, target, cols))));
    }
    return out.join('\\n');
  }

  const a = genOnce();
  const b = genOnce();

  // 备用入口：__roamDebug.floorGen.simulate(40)，同样两次重播种
  let s1 = ''; let s2 = ''; let simErr = null;
  try {
    const fg = window.__roamDebug && window.__roamDebug.floorGen;
    if (fg && typeof fg.simulate === 'function') {
      window.__probeSeedReset(); s1 = JSON.stringify(fg.simulate.call(fg, 40));
      window.__probeSeedReset(); s2 = JSON.stringify(fg.simulate.call(fg, 40));
    }
  } catch (e) { simErr = String((e && e.message) || e); }

  return {
    types: types,
    config: { minRooms: minR, maxRooms: maxR, cols: cols },
    genA: a, genB: b,
    simA: s1, simB: s2, simErr: simErr,
    ready: { dom: document.readyState, titleVisible: !!(document.getElementById('titleLayer') && !document.getElementById('titleLayer').classList.contains('hidden')) }
  };
})()`;

async function main() {
  // 每次用独立的 profile 目录，避免上一次异常退出残留的锁导致 Edge 起不来
  const profile = path.join(OUT, 'edge-profile');
  fs.mkdirSync(OUT, { recursive: true });
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch (e) { /* 忽略 */ }
  fs.mkdirSync(profile, { recursive: true });
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--allow-file-access-from-files',
    '--window-size=1440,900',
    'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等端口 */ }
    await sleep(250);
  }
  if (!target) throw new Error('调试端口未就绪');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (evt) => {
    const msg = JSON.parse(evt.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
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
  };
  /** 等待页面脚本装载完成（整页刷新后复用，最多约 30 秒） */
  const waitBoot = async () => {
    for (let i = 0; i < 120; i += 1) {
      await sleep(250);
      try {
        if (await ev(`typeof state !== 'undefined' && !!window.__seedDebug`)) return true;
      } catch (e) { /* 页面仍在解析 */ }
    }
    return false;
  };

  const url = 'file:///' + FILE.replace(/\\/g, '/');
  // 关键顺序：注入脚本必须在导航之前登记，否则页面主脚本已经跑完，Math.random 换不掉
  await send('Page.addScriptToEvaluateOnNewDocument', { source: INJECT });
  await send('Page.navigate', { url });

  // 等待主脚本完成装载（大文件 headless 冷启动可达 10s+，这里轮询 30s；
  // 就绪判据 = state 已建立，__seedDebug 由补丁提供，单独给出诊断）
  let bootReady = false;
  for (let i = 0; i < 120; i += 1) {
    await sleep(250);
    try {
      bootReady = await ev(`typeof state !== 'undefined'`);
      if (bootReady) break;
    } catch (e) { /* 页面仍在解析 */ }
  }
  if (!bootReady) {
    const dump = await ev(`({ url: location.href, ready: document.readyState, errors: (window.__errors || []).slice(0, 5) })`).catch(() => null);
    console.error('BOOT DUMP', JSON.stringify(dump));
    throw new Error('页面启动失败（30 秒内 state 仍未建立）：这是脚本装载超时，不是断言失败');
  }
  // __seedDebug 是「种子 / 每日挑战」补丁提供的调试桥。该补丁从未合入主文件，
  // 历史补丁副本 .seedwork/index_seed_patched.html 也已不存在。
  // 所以这里不再把「缺补丁」当失败：有补丁跑完整种子套件，没补丁跑自带的确定性核心。
  const hasSeedDebug = await ev(`typeof window.__seedDebug !== 'undefined' && !!window.__seedDebug`).catch(() => false);
  console.log(`MODE  ${hasSeedDebug ? 'seed-suite（检测到 __seedDebug 补丁）' : 'deterministic-core（无补丁，跑自带种子注入）'}`);

  if (hasSeedDebug) {
  // 0. 启动检查
  const boot = await ev(`({ ready: document.readyState, hasDebug: !!window.__seedDebug, errors: (window.__errors || []).slice(0, 3), mode: state.mode })`);
  check('页面启动且补丁已装载', boot.ready === 'complete' && boot.hasDebug && boot.mode === 'title', boot);
  check('启动零报错', (boot.errors || []).length === 0, boot.errors);

  // 1. 8 位种子格式
  const fmt = await ev(`(() => {
    const D = window.__seedDebug;
    const base = '261108';
    const chk = D.checksum(base);
    const good = base + chk;
    const bad = base + (chk === '00' ? '01' : '00');
    return {
      daily: D.dailySeed(),
      good: good,
      valid: D.validate(good),
      badChecksum: D.validate(bad),
      badFormat: D.validate('1234567')
    };
  })()`);
  check('每日种子是 8 位数字', /^\d{8}$/.test(fmt.daily), fmt.daily);
  check('合法种子通过校验', fmt.valid && fmt.valid.ok && fmt.valid.value === fmt.good, fmt.valid);
  check('校验位错误被拒绝', fmt.badChecksum && !fmt.badChecksum.ok && fmt.badChecksum.reason === 'checksum', fmt.badChecksum);
  check('位数错误被拒绝', fmt.badFormat && !fmt.badFormat.ok && fmt.badFormat.reason === 'format', fmt.badFormat);

  // 2. 同种子两次跑 1–5 层：房间类型 / 敌人 / 三选一 / 被动（宝箱同源）逐项比对
  const seed = fmt.valid.value;
  const repro = await ev(`(async () => {
    const D = window.__seedDebug;
    const SEED = ${JSON.stringify(seed)};

    /** 跑一遍 1–5 层：返回每层指纹与奖励选项字符串 */
    function runOnce() {
      D.newRun(SEED);
      const out = [];
      for (let f = 1; f <= 5; f += 1) {
        const sig = JSON.parse(D.forceFloor(f));
        const rooms = sig.rooms.map((r) => r.id + ':' + r.type);
        const enemies = sig.enemies.map((e) => e.type + '@' + e.roomId + ':' + e.hpMax
          + (e.elite ? 'E' : '') + ':' + (e.affix || '-'));
        out.push({
          floor: f,
          rooms: rooms,
          enemyCount: sig.enemies.length,
          enemies: enemies,
          skill: D.choices('skill', 3),
          passive: D.choices('passive', 1),
          full: JSON.stringify(sig)
        });
      }
      return out;
    }

    const A = runOnce();
    const B = runOnce();
    const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
    /** 找第一处敌人差异，便于定位是哪个字段漂了 */
    const enemyDiffOf = (i) => {
      const a = A[i].enemies; const b = B[i].enemies;
      for (let k = 0; k < Math.max(a.length, b.length); k += 1) {
        if (String(a[k]) !== String(b[k])) return { index: k, a: a[k], b: b[k] };
      }
      return null;
    };
    return {
      seed: SEED,
      floors: A.map((x) => ({
        floor: x.floor,
        rooms: x.rooms.join(','),
        enemyCount: x.enemyCount,
        sameRooms: same(x.rooms, B[x.floor - 1].rooms),
        sameEnemies: same(x.enemies, B[x.floor - 1].enemies),
        enemyDiff: enemyDiffOf(x.floor - 1),
        sameSkill: same(x.skill, B[x.floor - 1].skill),
        samePassive: same(x.passive, B[x.floor - 1].passive),
        sameFull: same(x.full, B[x.floor - 1].full),
        skill0: x.skill[0]
      }))
    };
  })()`);

  check('种子值正确回写', repro.seed === seed, repro.seed);
  repro.floors.forEach((f) => {
    check(`第 ${f.floor} 层房型序列逐项一致`, f.sameRooms, f.rooms);
    check(`第 ${f.floor} 层敌人数量与种类逐项一致（${f.enemyCount} 只）`, f.sameEnemies,
      f.sameEnemies ? f.enemyCount : f.enemyDiff);
    check(`第 ${f.floor} 层三次三选一逐项一致`, f.sameSkill, f.skill0);
    check(`第 ${f.floor} 层被动/宝箱奖励一致`, f.samePassive, null);
    check(`第 ${f.floor} 层完整指纹一致`, f.sameFull, null);
  });

  // 3. 存档续局：第 3 层保存 → 读回 → 后续楼层与选择流仍按原种子
  const cont = await ev(`(() => {
    const D = window.__seedDebug;
    const SEED = ${JSON.stringify(seed)};
    /** 找两个指纹串的第一处差异位置 */
    function firstDiffIndex(a, b) {
      const n = Math.min(a.length, b.length);
      for (let i = 0; i < n; i += 1) if (a[i] !== b[i]) return i;
      return n;
    }
    // 参考局：第 3 层做两次选择（选择流游标 = 2）
    D.newRun(SEED);
    D.forceFloor(1); D.choices('skill', 3); D.choices('passive', 1);
    D.forceFloor(2); D.choices('skill', 3); D.choices('passive', 1);
    D.forceFloor(3);
    const refFloor3Skill = D.choices('skill', 3);
    const ref3 = JSON.parse(D.signature());
    D.forceFloor(4); const ref4 = D.signature();
    D.forceFloor(5); const ref5 = D.signature();
    // 续局：第 3 层只做两次选择后存档 → 读档 → 第三次选择必须等于参考局第三次
    D.newRun(SEED);
    D.forceFloor(1); D.choices('skill', 3); D.choices('passive', 1);
    D.forceFloor(2); D.choices('skill', 3); D.choices('passive', 1);
    D.forceFloor(3);
    D.choices('skill', 2);
    window.saveRunSlot(2, 'assert');
    const rr = window.restoreRunFromSlot(2);
    const afterChoice = D.choices('skill', 1)[0];
    const sig4 = D.forceFloor(4);
    const sig5 = D.forceFloor(5);
    return {
      restoreOk: rr.ok,
      seedSame: state.seedInfo.value === SEED,
      choiceCursorKept: afterChoice === refFloor3Skill[2],
      floor4Same: sig4 === ref4,
      floor5Same: sig5 === ref5,
      detail: {
        afterChoice: afterChoice,
        expectChoice: refFloor3Skill[2],
        sig4Stable: sig4.length,
        sig4DiffIndex: sig4 === ref4 ? -1 : firstDiffIndex(sig4, ref4),
        sig4Slice: sig4 === ref4 ? '' : sig4.slice(Math.max(0, firstDiffIndex(sig4, ref4) - 60), firstDiffIndex(sig4, ref4) + 90),
        ref4Slice: sig4 === ref4 ? '' : ref4.slice(Math.max(0, firstDiffIndex(sig4, ref4) - 60), firstDiffIndex(sig4, ref4) + 90)
      }
    };
  })()`);
  check('读档成功', cont.restoreOk, cont.restoreOk);
  check('续局后种子不变', cont.seedSame, cont.seedSame);
  check('续局后选择流游标未丢（第三次三选一一致）', cont.choiceCursorKept, cont.detail);
  check('续局后第 4 层指纹一致', cont.floor4Same,
    cont.floor4Same ? null : { slice: cont.detail.sig4Slice, ref: cont.detail.ref4Slice });
  check('续局后第 5 层指纹一致', cont.floor5Same, null);

  // 4. 表现层不推进玩法流
  const fx = await ev(`(() => {
    const D = window.__seedDebug;
    D.newRun(${JSON.stringify(seed)});
    const r = D.fxPollution();
    const t = D.fxPollution();
    return { first: r, second: t };
  })()`);
  check('粒子 / 屏震 / 音效随机不推进 playRng', fx.first.clean && fx.second.clean, fx.first);

  // 5. 每日首次锁定 + 最佳只展示
  const daily = await ev(`window.__seedDebug.dailyLock()`);
  check('每日首次成绩锁定（首次 3 层不被 5 层覆盖）', daily.locked && daily.firstFloor === 3 && daily.bestFloor === 5, daily);

  // 6. 每日成绩与普通最佳楼层隔离
  const iso = await ev(`window.__seedDebug.isoTest()`);
  check('每日局不写 meta.bestFloor（成绩隔离）', iso.isolated, iso);

  // 7. 每日结算页只多一行
  const resultLine = await ev(`(() => {
    const D = window.__seedDebug;
    D.newRun(${JSON.stringify(seed)});
    D.forceFloor(4);
    state.seedInfo.daily = true;
    state.seedInfo.dailyDateKey = localDateKey();
    state.elapsed = 321; state.kills = 17;
    window.seedRecordRun({ cleared: false });
    state.status = 'dead'; state.mode = 'result';
    window.showResult();
    const line = document.querySelector('.result-daily-line');
    return { text: line ? line.textContent : null, hasOnlyOne: document.querySelectorAll('.result-daily-line').length === 1 };
  })()`);
  check('每日结算页出现且仅出现一行“今日挑战”', !!resultLine.text && resultLine.hasOnlyOne, resultLine.text);
  await shot('08_daily_result.png');

  // 7.5 每日难度钉死：每日局完全不读玩家 meta.bestFloor；普通局保留进度成长
  const diff = await ev(`(() => {
    const D = window.__seedDebug;
    const SEED = D.makeSeed();
    /** 用指定账号进度开一局（daily=每日），取第 1 层敌人属性与难度参照 */
    function probe(daily, best) {
      D.setBestFloor(best);
      if (daily) D.dailyRun(); else D.newRun(SEED);
      const sig = JSON.parse(D.forceFloor(1));
      return {
        hp: sig.enemies.map((e) => e.type + ':' + e.hpMax).sort().join(','),
        onboard: D.probeOnboard()
      };
    }
    return {
      seed: SEED,
      dailyNew: probe(true, 1),
      dailyVet: probe(true, 20),
      normalNew: probe(false, 1),
      normalVet: probe(false, 20)
    };
  })()`);
  check('每日难度与账号进度无关（bestFloor 1 vs 20 第 1 层敌人属性一致）',
    diff.dailyNew.hp === diff.dailyVet.hp
      && diff.dailyNew.onboard.progressFloor === diff.dailyVet.onboard.progressFloor,
    { new: diff.dailyNew.onboard, vet: diff.dailyVet.onboard });
  check('每日局难度参照 = 日期基准（不是玩家 bestFloor）',
    diff.dailyVet.onboard.daily === true
      && diff.dailyVet.onboard.progressFloor === diff.dailyVet.onboard.baseline
      && diff.dailyVet.onboard.bestFloor === 20,
    {
      progressFloor: diff.dailyVet.onboard.progressFloor,
      baseline: diff.dailyVet.onboard.baseline,
      bestFloor: diff.dailyVet.onboard.bestFloor
    });
  check('普通局仍保留进度成长（bestFloor 1 vs 20 第 1 层敌人属性不同）',
    diff.normalNew.hp !== diff.normalVet.hp,
    { newHp: diff.normalNew.hp.slice(0, 70), vetHp: diff.normalVet.hp.slice(0, 70) });

  // 7.55 每日封存：固定普通档 + ascension 0 + 满解锁池（且不写回账号）
  const sandbox = await ev(`(() => {
    const D = window.__seedDebug;
    const SEED = D.makeSeed();
    const POOR = { ascension: 5, difficulty: 'nightmare',
      unlocks: { fusion: false, device: false, overdrive: false, parallel: false } };
    const RICH = { ascension: 0, difficulty: 'easy',
      unlocks: { fusion: true, device: true, overdrive: true, parallel: true } };
    /** 用指定账号状态开一局每日，取指纹与三选一 */
    function dailyProbe(acc) {
      D.setBestFloor(10);
      D.setAccount(acc);
      const before = JSON.stringify({
        asc: state.meta.ascension, diff: state.meta.difficulty, unlocks: state.meta.unlocks
      });
      D.dailyRun();
      const sig = JSON.parse(D.forceFloor(1));
      return {
        fp: JSON.stringify(sig),
        skill: D.choices('skill', 3),
        box: D.sandbox(),
        before: before,
        after: JSON.stringify({
          asc: state.meta.ascension, diff: state.meta.difficulty, unlocks: state.meta.unlocks
        })
      };
    }
    /** 普通局对照：应继承账号（进阶/难度档/解锁） */
    function normalProbe(acc) {
      D.setBestFloor(10);
      D.setAccount(acc);
      D.newRun(SEED);
      // 开局后重新写入解锁，避开“老档补齐”把 poor 号补成满解锁
      state.meta.unlocks = Object.assign(
        { fusion: false, device: false, overdrive: false, parallel: false }, acc.unlocks
      );
      return { asc: state.ascension, diff: state.difficulty, unlocked: D.sandbox().unlocked };
    }
    return {
      dPoor: dailyProbe(POOR),
      dRich: dailyProbe(RICH),
      nPoor: normalProbe(POOR)
    };
  })()`);
  check('每日封存：ascension 固定 0（账号 5 也不继承）',
    sandbox.dPoor.box.ascension === 0 && sandbox.dRich.box.ascension === 0,
    { poor: sandbox.dPoor.box.ascension, rich: sandbox.dRich.box.ascension });
  check('每日封存：难度固定普通档（账号困难/简单都不继承）',
    sandbox.dPoor.box.difficulty === 'normal' && sandbox.dRich.box.difficulty === 'normal',
    { poor: sandbox.dPoor.box.difficulty, rich: sandbox.dRich.box.difficulty });
  check('每日封存：满解锁池（四个系统对所有人开放）',
    sandbox.dPoor.box.unlocked.fusion && sandbox.dPoor.box.unlocked.device
      && sandbox.dPoor.box.unlocked.overdrive && sandbox.dPoor.box.unlocked.parallel,
    sandbox.dPoor.box.unlocked);
  check('每日不把“试玩解锁”写回账号',
    sandbox.dPoor.before === sandbox.dPoor.after
      && JSON.stringify(sandbox.dPoor.box.metaUnlocks) === JSON.stringify(
        { fusion: false, device: false, overdrive: false, parallel: false }),
    { before: sandbox.dPoor.before, after: sandbox.dPoor.after, metaUnlocks: sandbox.dPoor.box.metaUnlocks });
  check('普通局仍继承账号（ascension 5 / 困难档 / 未解锁）',
    sandbox.nPoor.asc === 5 && sandbox.nPoor.diff === 'nightmare'
      && !sandbox.nPoor.unlocked.fusion,
    sandbox.nPoor);
  check('每日局与账号无关（不同账号第 1 层指纹 + 三选一逐项一致）',
    sandbox.dPoor.fp === sandbox.dRich.fp
      && JSON.stringify(sandbox.dPoor.skill) === JSON.stringify(sandbox.dRich.skill),
    { fpSame: sandbox.dPoor.fp === sandbox.dRich.fp });

  // 7.6 中途退出：不写、也不持久化任何“临时钉住”的进度值
  const exitTest = await ev(`(() => {
    const D = window.__seedDebug;
    D.setBestFloor(7);
    D.dailyRun();
    const before = state.meta.bestFloor;
    window.returnToTitleFromRun();
    return {
      before,
      after: state.meta.bestFloor,
      baselineKeys: Object.keys(state.meta).filter((k) => /baseline|dailyBase/i.test(k)),
      mode: state.mode
    };
  })()`);
  check('中途退出不污染 meta.bestFloor（也不写入任何临时基准）',
    exitTest.before === 7 && exitTest.after === 7 && exitTest.baselineKeys.length === 0,
    exitTest);

  // 8. 标题页 UI：今日挑战按钮 + 8 位输入框
  await ev(`(() => { state.mode = 'title'; window.setTitleVisible(true); window.renderLongrunTitle(); return true; })()`);
  await sleep(400);
  const title = await ev(`(() => {
    const b = document.getElementById('btnDailyRun');
    const input = document.getElementById('seedInput');
    const rb = document.getElementById('btnSeedRandom');
    const cb = document.getElementById('btnSeedCopy');
    return {
      dailyText: b ? b.textContent : null,
      maxLength: input ? input.maxLength : null,
      randomBtn: !!rb, copyBtn: !!cb,
      badge: window.__seedDebug.dailyCompleted()
    };
  })()`);
  check('主菜单今日挑战显示 8 位种子', !!title.dailyText && /今日挑战 · \d{8}/.test(title.dailyText), title.dailyText);
  check('输入框限制 8 位', title.maxLength === 8, title.maxLength);
  check('随机生成 / 复制种子按钮已就位', title.randomBtn && title.copyBtn, title);
  await shot('09_title_seed_ui.png');

  // 8.5 旧格式记录：只读保留 + “旧格式”角标（8 位新记录不带）
  const badge = await ev(`(() => {
    const D = window.__seedDebug;
    state.meta.seedRuns['daily-20260101'] = {
      seed: 'daily-20260101', daily: true, bestFloor: 7, bestTime: 305, lastAt: 1
    };
    state.meta.seedRuns['legacyTextSeed'] = {
      seed: 'legacyTextSeed', daily: false, bestFloor: 3, bestTime: 120, lastAt: 2
    };
    window.renderLongrunTitle();
    const chips = Array.from(document.querySelectorAll('.seed-rec'));
    return {
      badgeCount: document.querySelectorAll('.seed-rec-legacy').length,
      legacyChips: chips.filter((c) => /daily-20260101|legacyTextSeed/.test(c.textContent)).length,
      legacyWithBadge: chips.filter((c) => /daily-20260101|legacyTextSeed/.test(c.textContent)
        && c.querySelector('.seed-rec-legacy')).length,
      newWithBadge: chips.filter((c) => /^(今日\\s+)?\\d{8}/.test(c.textContent.trim())
        && c.querySelector('.seed-rec-legacy')).length,
      texts: chips.map((c) => c.textContent)
    };
  })()`);
  check('旧格式记录带“旧格式”角标（日期种子 + 文本种子各 1 条）',
    badge.legacyChips === 2 && badge.legacyWithBadge === 2 && badge.badgeCount >= 2,
    { badgeCount: badge.badgeCount, legacyChips: badge.legacyChips, legacyWithBadge: badge.legacyWithBadge });
  check('8 位新记录不带“旧格式”角标', badge.newWithBadge === 0, badge.newWithBadge);
  await shot('14_title_legacy_badge.png');

  // 9. E1 兼容断言（--e1）：多出的那次三选一并不会改变其他任何内容
  if (E1_MODE) {
    const e1 = await ev(`(() => {
      const D = window.__seedDebug;
      const SEED = ${JSON.stringify(seed)};
      /** 基线：不启用 E1，正常跑 1–5 层 */
      function runBase() {
        D.newRun(SEED);
        const out = [];
        for (let f = 1; f <= 5; f += 1) {
          const sig = JSON.parse(D.forceFloor(f));
          out.push({ full: JSON.stringify(sig), skill: D.choices('skill', 3) });
        }
        return out;
      }
      /** E1：每层清层多一次三选一（额外选卡走独立流） */
      function runE1() {
        D.newRun(SEED);
        const out = [];
        for (let f = 1; f <= 5; f += 1) {
          const sig = JSON.parse(D.forceFloor(f));
          const skill = D.choices('skill', 3);
          const extra = D.e1Choice(f);
          out.push({ full: JSON.stringify(sig), skill, extra });
        }
        return out;
      }
      /** 不启用 E1，但“手动跳过”那一次额外选卡（消耗同一条独立流后丢弃） */
      function runSkip() {
        D.newRun(SEED);
        const out = [];
        for (let f = 1; f <= 5; f += 1) {
          const sig = JSON.parse(D.forceFloor(f));
          const skill = D.choices('skill', 3);
          D.e1Choice(f); // 模拟“打开额外选卡但不选，直接跳过”
          out.push({ full: JSON.stringify(sig), skill });
        }
        return out;
      }
      const base = runBase();
      const A = runE1();
      const B = runE1();
      const skip = runSkip();
      const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
      return {
        mode: D.e1Mode(),
        fullSame: A.every((x, i) => x.full === base[i].full),
        skillSame: A.every((x, i) => same(x.skill, base[i].skill)),
        skipSame: A.every((x, i) => x.full === skip[i].full && same(x.skill, skip[i].skill)),
        extrasExist: A.every((x) => {
          const arr = String(x.extra || '').split('|').filter(Boolean);
          return arr.length >= 3 && new Set(arr).size === arr.length;
        }),
        extrasStable: A.every((x, i) => x.extra === B[i].extra),
        extras: A.map((x, i) => 'F' + (i + 1) + ':' + x.extra)
      };
    })()`);
    check('E1：每层存在一次额外三选一（每条 3 个选项）', e1.extrasExist, e1.extras[0]);
    check('E1：额外选卡不改变 1–5 层内容（与未启用 E1 逐项一致）',
      e1.fullSame && e1.skillSame, { fullSame: e1.fullSame, skillSame: e1.skillSame, mode: e1.mode });
    check('E1：与“不启用 E1 但手动跳过该次选卡”逐项一致',
      e1.skipSame, { skipSame: e1.skipSame });
    check('E1：额外选卡同种子两次逐项一致', e1.extrasStable, e1.extras);
  }

  // 10. 崩溃 / 刷新 → 读档：钉住的只是“计算基准”，不落盘污染账号进度
  const preReload = await ev(`(() => {
    const D = window.__seedDebug;
    D.setBestFloor(9);
    D.dailyRun();
    const sig = JSON.parse(D.forceFloor(1));
    const save = window.saveRunSlot(1, 'assert-reload');
    return {
      bestFloor: state.meta.bestFloor,
      seed: state.seedInfo.value,
      dailyDateKey: state.seedInfo.dailyDateKey,
      hp: sig.enemies.map((e) => e.type + ':' + e.hpMax).sort().join(','),
      saveOk: save.ok,
      onboard: D.probeOnboard()
    };
  })()`);
  await send('Page.navigate', { url });
  const rebooted = await waitBoot();
  check('模拟崩溃：整页刷新后重新就绪', rebooted, rebooted);
  if (rebooted) {
    const postReload = await ev(`(() => {
      const D = window.__seedDebug;
      const rr = window.restoreRunFromSlot(1);
      const sig = JSON.parse(D.forceFloor(1));
      return {
        restoreOk: rr.ok,
        bestFloor: state.meta.bestFloor,
        seed: state.seedInfo && state.seedInfo.value,
        daily: !!(state.seedInfo && state.seedInfo.daily),
        hp: sig.enemies.map((e) => e.type + ':' + e.hpMax).sort().join(','),
        onboard: D.probeOnboard(),
        errors: (window.__errors || []).slice(0, 3)
      };
    })()`);
    check('崩溃/刷新后 meta.bestFloor 未被临时基准污染',
      postReload.bestFloor === preReload.bestFloor, { before: preReload.bestFloor, after: postReload.bestFloor });
    check('崩溃/刷新后读档：种子与每日标记保留',
      postReload.restoreOk && postReload.seed === preReload.seed && postReload.daily === true,
      { restoreOk: postReload.restoreOk, seed: postReload.seed, daily: postReload.daily, expectSeed: preReload.seed });
    check('崩溃/刷新后读档：每日难度仍是日期基准（敌人属性一致）',
      postReload.hp === preReload.hp
        && postReload.onboard.progressFloor === postReload.onboard.baseline,
      { hpSame: postReload.hp === preReload.hp, onboard: postReload.onboard });
  }
  } else {
    // ---- 确定性核心：不依赖任何测试补丁，主文件 / 备份 / 任意版本都能跑 ----
    // 判据：同一种子、同一操作序列（1–40 层顺序生成），两次独立重播种必须逐字节一致。
    const det = await ev(DET_EXPR);
    check('页面启动且标题层可见', det.ready.dom === 'complete' && det.ready.titleVisible, det.ready);
    if (det.error) {
      check('确定性生成入口存在', false, det.error);
    } else {
      check('确定性生成：同种子两次生成 40 层逐字节一致',
        det.genA === det.genB, { lenA: det.genA.length, lenB: det.genB.length });
      const floors = det.genA.split('\n').map((s) => { try { return JSON.parse(s); } catch (e) { return null; } });
      check('确定性生成：40 层全部有效且无回退',
        floors.length === 40 && floors.every((f) => f && f.valid && !f.fallback),
        {
          floors: floors.length,
          invalid: floors.filter((f) => !f || !f.valid).length,
          fallback: floors.filter((f) => f && f.fallback).length
        });
      if (det.simA) {
        check('确定性模拟：floorGen.simulate(40) 两次逐字节一致', det.simA === det.simB, { len: det.simA.length });
      } else {
        check('确定性模拟：floorGen.simulate(40) 可用', false, det.simErr || '未暴露 simulate');
      }
      // 指纹落盘：长度 + FNV-1a + SHA-256，两个文件各跑一次后即可逐字节比对
      const fp = {
        file: FILE,
        seed: SEED,
        config: det.config,
        gen: {
          length: det.genA.length,
          bytes: Buffer.byteLength(det.genA, 'utf8'),
          fnv1a32Hex: hex32(fnv1a32(det.genA)),
          sha256: crypto.createHash('sha256').update(det.genA, 'utf8').digest('hex')
        },
        sim: det.simA ? {
          length: det.simA.length,
          fnv1a32Hex: hex32(fnv1a32(det.simA)),
          sha256: crypto.createHash('sha256').update(det.simA, 'utf8').digest('hex')
        } : null
      };
      console.log('FINGERPRINT ' + JSON.stringify(fp));
      fs.writeFileSync(path.join(OUT, 'det_fingerprint.json'), JSON.stringify(fp, null, 2), 'utf8');
      fs.writeFileSync(path.join(OUT, 'det_gen.txt'), det.genA, 'utf8');
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n== ${results.length - failed.length}/${results.length} PASS ==`);
  fs.writeFileSync(path.join(OUT, 'assert_result.json'), JSON.stringify(results, null, 2));
  ws.close();
  killEdge(edge);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error('ASSERT FAILED:', e.message);
  process.exit(2);
});
