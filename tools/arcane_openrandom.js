/**
 * 第 12 项 · 开局随机化 验收（O1–O10）
 * ------------------------------------------------------------
 * 运行：node tools\arcane_openrandom.js
 * 依赖：tools/arcane_profile.js（独立 Edge profile + Edge headless）
 * 端口：9552（与其它断言脚本错开）
 *
 * 覆盖规格 .spec/open-random.md 第 7 节：
 *   O1 配置结构 / O2 同种子复现 / O3 跨种子差异 / O4 起始卡池内且随天赋变化
 *   O5 起始遗物只在解锁后且来自池 / O6 大区顺序是排列且 getTheme 逐层对齐
 *   O7 房型偏好真的更多 / O8 掉落偏好真的更多 / O9 关闭零差异 / O10 存档往返
 */
const { spawn } = require('child_process');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const PORT = 9552;
const REL_HTML = path.join(__dirname, '..', 'index_arcane_v2.html');
const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];

const asserts = [];
let exceptions = [];

/** 记录一条断言（打印统一格式的 [PASS]/[FAIL] 行） */
function ok(id, label, pass, detail) {
  asserts.push({ id, label, pass: !!pass, detail });
  const mark = pass ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${id} ${label}${detail ? '  ' + detail : ''}`);
}

/** 毫秒等待 */
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

/** 找一个存在的 Edge 可执行文件 */
function findEdge() {
  const fs = require('fs');
  for (const candidate of EDGE_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('没有找到 msedge.exe');
}

/** 极简 CDP 客户端（照抄 arcane_talents.js 的连接方式） */
class Cdp {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); this.handlers = []; }
  /** 建立 WebSocket 并开始收包（Node 自带全局 WebSocket，无需 ws 依赖） */
  connect() {
    this.ws = new WebSocket(this.url);
    this.ws.onmessage = (msg) => {
      let m = null;
      try { m = JSON.parse(msg.data); } catch (e) { return; }
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
        return;
      }
      this.handlers.forEach((fn) => fn(m));
    };
    return new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
  }
  /** 发一条 CDP 命令 */
  send(method, params) {
    this.id += 1;
    const id = this.id;
    this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  /** 在页面里求值并取回可序列化结果 */
  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true
    });
    if (res.exceptionDetails) {
      const msg = res.exceptionDetails.exception
        ? res.exceptionDetails.exception.description || res.exceptionDetails.exception.value
        : res.exceptionDetails.text;
      exceptions.push(String(msg));
      return { __error: String(msg) };
    }
    return res.result ? res.result.value : undefined;
  }
}

async function main() {
  const profile = prepareProfile();
  const edge = spawn(findEdge(), [
    '--headless=new',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + profile,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--allow-file-access-from-files',
    '--disable-gpu',
    '--window-size=1440,900',
    'about:blank'
  ], { stdio: 'ignore' });

  let cdp = null;
  try {
    // 等浏览器把调试端口抬起来
    let targets = null;
    for (let i = 0; i < 40; i += 1) {
      try {
        const res = await fetch('http://127.0.0.1:' + PORT + '/json/list');
        targets = await res.json();
        if (targets && targets.length) break;
      } catch (e) { /* 端口还没起 */ }
      await sleep(200);
    }
    if (!targets || !targets.length) throw new Error('Edge 调试端口没有响应');
    const page = targets.find((t) => t.type === 'page') || targets[0];
    cdp = new Cdp(page.webSocketDebuggerUrl);
    await cdp.connect();
    cdp.handlers.push((msg) => {
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params && msg.params.exceptionDetails;
        exceptions.push(String((d && (d.text || (d.exception && d.exception.description))) || 'exception'));
      }
    });
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: 'file:///' + REL_HTML.replace(/\\/g, '/') });
    await sleep(1800);
    // 清档：避免本机旧 meta 影响天赋开关
    await cdp.eval('localStorage.clear(); true');
    await cdp.send('Page.reload', { ignoreCache: true });
    await sleep(1800);

    // 记录一份房型权重本体（O9 用它证明没有被改脏）
    const weightsBefore = await cdp.eval('JSON.parse(JSON.stringify(ROOM_TYPE_CONFIG.weights))');

    // ---------------- O1 配置结构 ----------------
    const o1 = await cdp.eval(`(function () {
      const cfg = __roamDebug.openRandom.config();
      const subKeys = Object.keys(cfg.sub);
      const relicOk = cfg.startRelicPool.every(function (id) { return !!RELIC_BY_ID[id]; });
      return {
        cfg: cfg, subKeys: subKeys,
        relicOk: relicOk,
        enabled: cfg.enabled,
        poolLen: cfg.startRelicPool.length,
        roomKinds: cfg.roomKinds, dropKinds: cfg.dropKinds,
        bias: cfg.bias
      };
    })()`);
    ok('O1', 'OPEN_RANDOM_CONFIG 六子开关 + 7 件遗物池 + 偏好表 + 倍率区间',
      o1 && o1.enabled === true && o1.subKeys.length === 6
        && o1.subKeys.every((k) => o1.cfg.sub[k] === true)
        && o1.poolLen === 7 && o1.relicOk
        && o1.roomKinds.length === 3 && o1.dropKinds.length === 4
        && o1.bias.min > 0 && o1.bias.min < o1.bias.max,
      `sub=${o1 ? o1.subKeys.join('/') : '?'} pool=${o1 ? o1.poolLen : '?'} bias=${o1 ? o1.bias.min + '~' + o1.bias.max : '?'}`);

    // ---------------- O2 同种子复现 ----------------
    const o2 = await cdp.eval(`(function () {
      const d = __roamDebug.openRandom;
      d.setSeed(12345);
      const a = createInitialState();
      const b = createInitialState();
      return {
        seedA: a.openRandom.seed, seedB: b.openRandom.seed,
        jsonA: JSON.stringify(a.openRandom), jsonB: JSON.stringify(b.openRandom),
        biasA: JSON.stringify(a.openBias), biasB: JSON.stringify(b.openBias),
        relicA: Object.keys(a.relics), relicB: Object.keys(b.relics),
        cardA: a.ownedMagic[0], cardB: b.ownedMagic[0]
      };
    })()`);
    ok('O2', '同种子两次 createInitialState：openRandom 全字段一致',
      o2 && o2.jsonA === o2.jsonB && o2.biasA === o2.biasB
        && JSON.stringify(o2.relicA) === JSON.stringify(o2.relicB),
      `seed=${o2 ? o2.seedA : '?'} card=${o2 ? o2.cardA : '?'}`);

    // ---------------- O3 跨种子差异 ----------------
    const o3 = await cdp.eval(`(function () {
      const d = __roamDebug.openRandom;
      const cards = {}; const cycles = {};
      for (let s = 1; s <= 20; s += 1) {
        d.setSeed(s * 7919);
        const st = createInitialState();
        cards[st.openRandom.card] = (cards[st.openRandom.card] || 0) + 1;
        const key = st.openRandom.themeCycle.join(',');
        cycles[key] = (cycles[key] || 0) + 1;
      }
      d.reroll();
      return { cards: cards, cycles: cycles };
    })()`);
    ok('O3', '20 个种子：起始卡 / themeCycle 取值 ≥ 2 种',
      o3 && Object.keys(o3.cards).length >= 2 && Object.keys(o3.cycles).length >= 2,
      `cards=${o3 ? JSON.stringify(o3.cards) : '?'} cycles=${o3 ? Object.keys(o3.cycles).length : '?'}种`);

    // ---------------- O4 起始卡池内 + 天赋扩容 ----------------
    const o4 = await cdp.eval(`(function () {
      const d = __roamDebug.openRandom;
      __talentDebug.resetTalents();
      const pool1 = startCardPool().slice(0);
      const seen = [];
      for (let s = 1; s <= 8; s += 1) { d.setSeed(s * 37); seen.push(createInitialState().ownedMagic[0]); }
      const inPool1 = seen.every(function (id) { return pool1.indexOf(id) >= 0; });
      __talentDebug.setLevel('startPool', 2);
      __talentDebug.setLevel('thirdWeapon', 1);
      const pool2 = startCardPool().slice(0);
      const seen2 = [];
      for (let s = 1; s <= 8; s += 1) { d.setSeed(s * 41); seen2.push(createInitialState().ownedMagic[0]); }
      const inPool2 = seen2.every(function (id) { return pool2.indexOf(id) >= 0; });
      __talentDebug.resetTalents();
      d.reroll();
      return { pool1: pool1, pool2: pool2, seen: seen, inPool1: inPool1, inPool2: inPool2 };
    })()`);
    ok('O4', `起始卡必在池内，且卡池随 startPool/thirdWeapon 扩容（${o4 ? o4.pool1.length : '?'} → ${o4 ? o4.pool2.length : '?'}）`,
      o4 && o4.inPool1 && o4.inPool2 && o4.pool2.length > o4.pool1.length,
      `cards=${o4 ? o4.seen.join(',') : '?'}`);

    // ---------------- O5 起始遗物 ----------------
    const o5 = await cdp.eval(`(function () {
      const d = __roamDebug.openRandom;
      __talentDebug.resetTalents();
      d.setSeed(333);
      const before = createInitialState();
      __talentDebug.setLevel('startRelic', 1);
      d.setSeed(334);
      const after = createInitialState();
      const pool = __roamDebug.openRandom.config().startRelicPool;
      const ids = Object.keys(after.relics);
      const inPool = ids.every(function (id) { return pool.indexOf(id) >= 0; });
      const applySrc = ids.map(function (id) {
        const apply = RELIC_BY_ID[id] && RELIC_BY_ID[id].apply;
        return String(apply).replace(/\\/\\*[\\s\\S]*?\\*\\//g, '').replace(/\\s+/g, '');
      });
      const emptyApply = applySrc.every(function (src) { return src.length < 40; });
      const names = ids.map(function (id) { return RELIC_BY_ID[id] ? RELIC_BY_ID[id].name : id; });
      __talentDebug.resetTalents();
      d.reroll();
      return { before: Object.keys(before.relics), ids: ids, names: names,
        inPool: inPool, emptyApply: emptyApply, applySrc: applySrc };
    })()`);
    ok('O5', '起始遗物只在天赋解锁后发放，id ∈ startRelicPool 且 apply() 为空',
      o5 && o5.before.length === 0 && o5.ids.length === 1 && o5.inPool && o5.emptyApply,
      `relic=${o5 ? o5.names.join(',') : '?'} apply=${o5 ? o5.applySrc.join(',') : '?'}`);

    // ---------------- O6 themeCycle 记录合法 + 主题按大区锁定 ----------------
    /* 第 13 项：主题不再按 3 层轮换，而是按大区锁定（F1–6 机械 / F7–12 符文 /
       F13–18 虚空 / F19+ 深层）。themeCycle 只保留为"开局随机记录"，仍必须是
       THEME_CONFIG.cycle 的合法排列；getTheme 必须逐层等于 regionThemeOf(n)。 */
    const o6 = await cdp.eval(`(function () {
      const order = state.themeCycle.slice(0);
      const sortedOk = order.slice().sort().join(',') === THEME_CONFIG.cycle.slice().sort().join(',');
      const map = [];
      for (let n = 1; n <= 18; n += 1) {
        const want = regionThemeOf(n);
        map.push({ n: n, id: getTheme(n).id, want: want, ok: getTheme(n).id === want });
      }
      [19, 21, 30].forEach(function (n) {
        const want = regionThemeOf(n);
        map.push({ n: n, id: getTheme(n).id, want: want, ok: getTheme(n).id === want });
      });
      return { order: order, sortedOk: sortedOk, map: map };
    })()`);
    ok('O6', 'themeCycle 仍是合法排列；getTheme 按大区锁定（F1–18 + 深层）',
      o6 && o6.sortedOk && o6.map.every((row) => row.ok),
      `order=${o6 ? o6.order.join('>') : '?'} region=${o6 ? o6.map.map((r) => r.n + ':' + r.id).join(',') : '?'}`);

    // ---------------- O7 房型偏好 ----------------
    const o7 = await cdp.eval(`(function () {
      const pref = state.openBias.roomPref;
      // 只统计"由分配池抽出来"的四类房型：start/boss/shop/survival/sacrifice/curse/stair 都是
      // 后续系统注入或保底改写的，统计它们只会稀释信号
      const POOL_TYPES = ['battle', 'elite', 'chest', 'event'];
      const countPref = function () {
        return state.rooms.filter(function (r) { return r.type === pref; }).length;
      };
      const countPool = function () {
        return state.rooms.filter(function (r) { return POOL_TYPES.indexOf(r.type) >= 0; }).length;
      };
      // 种下固定种子：同一轮里"有偏好 / 无偏好"两遍生成的房间布局（房间 seed / 哈希）完全一致，
      // 只有权重不同；多轮换种子是为了压低"哈希映射换池长"带来的采样噪声
      const compare = { prefKind: pref, withPref: 0, without: 0, poolRooms: 0, rounds: 20, floors: 30 };
      // 重新跑一遍 assignRoomTypes：把生成期之后"路线设计 / 秘藏 / 商店让位"的二次改写抹掉，
      // 只看"权重 → 房型"这一步；u11 两个开关关掉是为了去掉商店房 / 生存房的让位吸收
      state.u11V1 = false;
      state.u11bV1 = false;
      const reassign = function () {
        const spawn = state.rooms.find(function (r) { return r.id === state.spawnRoomId; });
        const stair = state.rooms.find(function (r) { return r.id === state.stairRoomId; });
        if (spawn && stair) assignRoomTypes(spawn, stair);
      };
      for (let round = 0; round < compare.rounds; round += 1) {
        applySeedToState('roompref-probe-' + round, { custom: true });
        for (let n = 1; n <= compare.floors; n += 1) {
          state.floor = n;
          state.openBias.roomPref = pref;
          generateFloor(n);
          reassign();
          compare.withPref += countPref();
          compare.poolRooms += countPool();
          state.openBias.roomPref = null;
          generateFloor(n);
          reassign();
          compare.without += countPref();
        }
      }
      return compare;
    })()`);
    ok('O7', '20×30 层房型统计：偏好组 ≥ 无偏好组',
      o7 && Number.isFinite(o7.withPref) && o7.withPref >= o7.without,
      `pref=${o7 ? o7.prefKind : '?'} with=${o7 ? o7.withPref : '?'} without=${o7 ? o7.without : '?'} poolRooms=${o7 ? o7.poolRooms : '?'} rounds=${o7 ? o7.rounds : '?'}`);

    // O7 之后状态被改脏，重载回干净页面再做 O8–O10
    await cdp.send('Page.reload', { ignoreCache: true });
    await sleep(1600);

    // ---------------- O8 掉落偏好 ----------------
    const o8 = await cdp.eval(`(function () {
      state.rewardStage = 'skill';
      state.eliteRewardBoost = 0;
      state.vaultRewardBoost = false;
      state.bossRewardBoost = false;
      const pref = 'magic';                 // 技能奖励池里一定存在的 kind
      const run = function (usePref) {
        state.openBias.dropPref = usePref ? pref : null;
        let picks = 0; let hit = 0; let draws = 0;
        for (let round = 0; round < 6; round += 1) {
          for (let i = 0; i < 60; i += 1) {
            state.fusionPity = 0;             // 关掉融合保底，避免保底选项污染统计
            const opts = buildRewardOptions('skill');
            draws += 1;
            opts.forEach(function (o) { picks += 1; if (o.kind === pref) hit += 1; });
          }
        }
        return { picks: picks, hit: hit, draws: draws };
      };
      const withPref = run(true);
      const without = run(false);
      state.openBias.dropPref = __roamDebug.openRandom.info().dropPref;
      return { withPref: withPref, without: without, pref: pref };
    })()`);
    const shareW = o8 ? o8.withPref.hit / Math.max(1, o8.withPref.picks) : 0;
    const shareB = o8 ? o8.without.hit / Math.max(1, o8.without.picks) : 0;
    ok('O8', '6×60 次技能奖励：偏好 kind(magic) 占比高于无偏好',
      o8 && o8.withPref.hit > o8.without.hit && shareW > shareB,
      `with=${o8 ? o8.withPref.hit + '/' + o8.withPref.picks : '?'} without=${o8 ? o8.without.hit + '/' + o8.without.picks : '?'} share=${(shareW * 100).toFixed(1)}% vs ${(shareB * 100).toFixed(1)}%`);

    // ---------------- O9 关闭总开关零差异 ----------------
    const o9 = await cdp.eval(`(function () {
      __talentDebug.resetTalents();
      OPEN_RANDOM_CONFIG.enabled = false;
      const st = createInitialState();
      const weights = JSON.parse(JSON.stringify(ROOM_TYPE_CONFIG.weights));
      const pool = __roamDebug.openRandom.config().startRelicPool;
      const relicIds = Object.keys(st.relics);
      const themes = [];
      const themeOk = [];
      /* 第 13 项：关闭总开关后，主题仍按大区锁定（不是回到 3 层轮换），
         逐层对齐 regionThemeOf(n)，覆盖 F1–18 与深层。 */
      for (let n = 1; n <= 18; n += 1) {
        const got = getTheme(n).id;
        themes.push(got);
        themeOk.push(got === regionThemeOf(n));
      }
      [19, 21].forEach(function (n) {
        const got = getTheme(n).id;
        themes.push(got);
        themeOk.push(got === regionThemeOf(n));
      });
      const snapshot = {
        weights: weights, relicIds: relicIds, themes: themes, themeOk: themeOk,
        card: st.ownedMagic[0],
        openRandom: JSON.parse(JSON.stringify(st.openRandom)),
        hasPoolRelic: relicIds.some(function (id) { return pool.indexOf(id) >= 0; })
      };
      OPEN_RANDOM_CONFIG.enabled = true;
      return snapshot;
    })()`);
    ok('O9', '关闭总开关：起始卡 fireball / 无起始遗物 / 主题仍按大区锁定 / 房型权重未改',
      o9 && o9.card === 'fireball' && o9.hasPoolRelic === false && o9.themeOk.every(Boolean)
        && JSON.stringify(o9.weights) === JSON.stringify(weightsBefore),
      `card=${o9 ? o9.card : '?'} relic=${o9 ? o9.relicIds.join(',') || '空' : '?'} themes=${o9 ? o9.themes.join(',') : '?'}`);

    // ---------------- O10 存档往返 ----------------
    const o10 = await cdp.eval(`(function () {
      const d = __roamDebug.openRandom;
      __talentDebug.resetTalents();
      d.reroll();
      d.setSeed(777);
      state = createInitialState();
      const before = {
        openRandom: JSON.stringify(state.openRandom),
        themeCycle: JSON.stringify(state.themeCycle),
        openBias: JSON.stringify(state.openBias),
        seed: state.openRandom.seed,
        cycle: state.themeCycle.slice(0)
      };
      const snap = captureRunSnapshot();
      // 先把三个字段打脏，再走白名单回写，验证是真往返而不是空操作
      state.openRandom = { seed: 0, card: null, relic: null, themeCycle: null, affix: null, roomPref: null, dropPref: null };
      state.themeCycle = [];
      state.openBias = {};
      const applied = applyRunSnapshot(snap);
      return {
        before: before,
        after: {
          openRandom: JSON.stringify(state.openRandom),
          themeCycle: JSON.stringify(state.themeCycle),
          openBias: JSON.stringify(state.openBias),
          seed: state.openRandom.seed,
          cycle: state.themeCycle.slice(0)
        },
        applied: applied, seed: state.openRandom.seed
      };
    })()`);
    const o10same = o10 && o10.before.openRandom === o10.after.openRandom
      && o10.before.themeCycle === o10.after.themeCycle
      && o10.before.openBias === o10.after.openBias
      && o10.before.seed === o10.after.seed;
    ok('O10', '存档往返：openRandom / themeCycle / openBias 逐字段相等',
      o10same && o10.applied && o10.applied.openRandom === true && o10.applied.themeCycle === true,
      `seed=${o10 ? o10.seed : '?'} cycle=${o10 ? o10.after.cycle.join('>') : '?'} applied=${o10 ? Object.keys(o10.applied).join(',') : '?'}`);

    // 页面 0 异常
    await sleep(300);
    ok('O10b', '页面 0 运行时异常', exceptions.length === 0, `exceptions=${exceptions.length}`);

    // 清掉调试种子，回到正常"每局随机"
    await cdp.eval('__roamDebug.openRandom.reroll(); true');
  } catch (error) {
    ok('ERR', '脚本执行异常', false, error && error.message ? error.message : String(error));
  } finally {
    if (cdp && cdp.ws) { try { cdp.ws.close(); } catch (e) { /* ignore */ } }
    killEdge(edge);
  }

  // 分类汇总（按 O 编号分组）
  const groups = {};
  asserts.forEach((a) => {
    const key = String(a.id).replace(/[^O0-9a-z]/gi, '') || 'OTHER';
    if (!groups[key]) groups[key] = { pass: 0, total: 0 };
    groups[key].total += 1;
    if (a.pass) groups[key].pass += 1;
  });
  console.log('');
  Object.keys(groups).forEach((key) => {
    console.log(`  分类 ${key}: ${groups[key].pass}/${groups[key].total}`);
  });
  const passCount = asserts.filter((a) => a.pass).length;
  console.log(`RESULT: ${passCount === asserts.length ? 'PASS' : 'FAIL'} (${passCount}/${asserts.length})`);
  if (passCount !== asserts.length) {
    console.log('失败项：');
    asserts.filter((a) => !a.pass).forEach((a) => console.log(`  - ${a.id} ${a.label} :: ${a.detail || ''}`));
  }
  process.exit(passCount === asserts.length ? 0 : 1);
}

main();
