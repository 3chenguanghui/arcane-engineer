// P2 断言总表：种子局 / 进阶难度 / 图鉴 + 追加需求 A（帮助入口）+ B（局内存档）
// 用法：node tools\arcane_p2.js *> tools\p2.log
// 说明：全部断言走游戏真实入口（probeFloor / startSeedRun / openPanel / saveRunSlot / restoreRunFromSlot），
//       不另造测试专用假路径；每个用例只读取 state / 面板 DOM，不直接改配置。
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9683;
const MAIN = path.join(__dirname, '..', 'index_arcane_v2.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 把本地路径转成 file:// URL */
function fileUrl(p) { return 'file:///' + p.replace(/\\/g, '/'); }

/** 生成一段等待页面稳定的固定延时（主线程） */
const settle = () => sleep(1300);

async function main() {
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--allow-file-access-from-files', '--force-device-scale-factor=1',
    '--window-size=1536,900', 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* CDP 还没起来 */ }
    await sleep(250);
  }
  if (!target) throw new Error('Edge CDP 未就绪');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push('EXCEPTION: ' + m.params.exceptionDetails.text);
    }
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res, rej) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');

  /** 在页面里执行一段表达式并取回值（异常直接抛出，避免静默失败） */
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    }
    return r.result.value;
  };
  /** 重新加载主页面并等待初始化完成 */
  const reload = async () => {
    await send('Page.navigate', { url: fileUrl(MAIN) });
    await settle();
  };

  const checks = [];
  /** 记录一条断言（PASS / FAIL + 详情） */
  const check = (name, ok, detail) => {
    checks.push({ name, ok: !!ok, detail });
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + '  ' + JSON.stringify(detail));
  };

  // ---------- 0) 干净起点：清掉元进度与局内存档，回到全新档 ----------
  await send('Page.navigate', { url: fileUrl(MAIN) });
  await settle();
  const keys = await ev(`(function(){
    var metaKey = GAME_CONFIG.metaKey;
    var slotKey = SAVE_SLOTS_CONFIG.key;
    localStorage.removeItem(metaKey);
    localStorage.removeItem(slotKey);
    return { metaKey: metaKey, slotKey: slotKey };
  })()`);
  await reload();
  check('全新档：种子开关打开且当前局无种子', await ev(`(function(){
    var p = window.__roamDebug.p2;
    var i = p.info();
    return { enabled: i.seed.enabled, active: i.seed.active, playRngState: i.seed.playRngState, p2: !!p };
  })()`).then((r) => r.enabled === true && r.active === false && r.playRngState === null && r.p2 === true),
  await ev(`window.__roamDebug.p2.info().seed`));

  // ---------- P2-1 种子局 ----------
  // 同种子 + 同层：两次生成必须完全一致（房间布局 / 敌人编队 / 门 / 出生房 / 楼梯房）
  const sigA1 = await ev(`window.__roamDebug.p2.probeFloor('alpha', 1)`);
  const sigA2 = await ev(`window.__roamDebug.p2.probeFloor('alpha', 1)`);
  const diffAA = await ev(`window.__roamDebug.p2.compare(${JSON.stringify(sigA1)}, ${JSON.stringify(sigA2)})`);
  check('同种子同层两次生成完全一致', diffAA === '', { diff: diffAA, rooms: sigA1.rooms.length, enemies: sigA1.enemies.length });

  const sigB1 = await ev(`window.__roamDebug.p2.probeFloor('beta', 1)`);
  const diffAB = await ev(`window.__roamDebug.p2.compare(${JSON.stringify(sigA1)}, ${JSON.stringify(sigB1)})`);
  check('不同种子生成不同布局', diffAB !== '', { diff: diffAB });

  const sigA3 = await ev(`window.__roamDebug.p2.probeFloor('alpha', 3)`);
  const sigA3b = await ev(`window.__roamDebug.p2.probeFloor('alpha', 3)`);
  const diffA3 = await ev(`window.__roamDebug.p2.compare(${JSON.stringify(sigA3)}, ${JSON.stringify(sigA3b)})`);
  check('同种子第 3 层同样可复现', diffA3 === '' && sigA3.floor === 3, { diff: diffA3, floor: sigA3.floor, rooms: sigA3.rooms.length });

  const sameSeedDiffFloor = await ev(`window.__roamDebug.p2.compare(${JSON.stringify(sigA1)}, ${JSON.stringify(sigA3)})`);
  check('同种子不同层布局不同（楼层盐生效）', sameSeedDiffFloor !== '', { diff: sameSeedDiffFloor });

  const daily = await ev(`(function(){
    var d1 = dailySeedValue(); var d2 = dailySeedValue();
    return { d1: d1, d2: d2, prefix: SEED_CONFIG.dailyPrefix, len: d1.length };
  })()`);
  check('今日挑战种子当天恒定', daily.d1 === daily.d2 && daily.d1.indexOf(daily.prefix) === 0, daily);

  const dailyProbeA = await ev(`window.__roamDebug.p2.probeFloor(dailySeedValue(), 1)`);
  const dailyProbeB = await ev(`window.__roamDebug.p2.probeFloor(dailySeedValue(), 1)`);
  const dailyDiff = await ev(`window.__roamDebug.p2.compare(${JSON.stringify(dailyProbeA)}, ${JSON.stringify(dailyProbeB)})`);
  check('同一天两次今日挑战布局一致', dailyDiff === '', { diff: dailyDiff });

  // 无种子：仍走 Math.random（与旧行为零差异：seedActive=false 且 playRng 为空）
  const unseeded = await ev(`(function(){
    return {
      seedActive: seedActive(),
      playRng: state.playRng ? 'set' : null,
      r1: Math.random(),
      r2: rng(),
      r3: rng(),
      sample: [rng(), rng()]
    };
  })()`);
  check('无种子时随机源仍是 Math.random（不与旧行为分叉）',
    unseeded.seedActive === false && unseeded.playRng === null && unseeded.sample[0] !== unseeded.sample[1],
    { seedActive: unseeded.seedActive, playRng: unseeded.playRng, sample: unseeded.sample });

  // 自定义种子开局 + 成绩记录
  const seedStart = await ev(`(function(){
    var p = window.__roamDebug.p2;
    var r = p.startSeed('assert-seed', { custom: true });
    var rec = state.meta.seedRuns['assert-seed'] || null;
    var stored = localStorage.getItem(GAME_CONFIG.metaKey) || '';
    return {
      ok: r.ok, mode: state.mode, floor: state.floor,
      attempts: rec ? rec.attempts : 0,
      active: p.info().seed.active, value: p.info().seed.value,
      persisted: stored.indexOf('assert-seed') >= 0
    };
  })()`);
  check('自定义种子能开局且成绩落盘',
    seedStart.ok === true && seedStart.mode === 'playing' && seedStart.active === true
    && seedStart.value === 'assert-seed' && seedStart.attempts >= 1 && seedStart.persisted === true,
    seedStart);

  const seedBest = await ev(`(function(){
    state.floor = 2;
    seedRecordRun({ deathCause: '断言死因' });
    var rec = state.meta.seedRuns['assert-seed'];
    return { bestFloor: rec.bestFloor, deathCause: rec.deathCause, bestTime: rec.bestTime };
  })()`);
  check('种子成绩记录最高层 + 死亡原因', seedBest.bestFloor === 2 && seedBest.deathCause === '断言死因', seedBest);

  // ---------- P2-2 进阶难度 ----------
  const lockCheck = await ev(`(function(){
    var p = window.__roamDebug.p2;
    var before = p.setAscension(1); // 未解锁时应当被夹到 0
    return { unlocked: before.unlocked, current: before.current };
  })()`);
  check('未解锁时无法选择进阶', lockCheck.unlocked === 0 && lockCheck.current === 0, lockCheck);

  const unlockCheck = await ev(`(function(){
    var p = window.__roamDebug.p2;
    var unlocked = p.unlockAscension(1);
    var r = p.setAscension(1);
    var stored = JSON.parse(localStorage.getItem(GAME_CONFIG.metaKey) || '{}');
    return { unlocked: unlocked, current: r.current, storedUnlocked: stored.ascensionUnlocked, storedCurrent: stored.ascension };
  })()`);
  check('通关解锁进阶 1 并持久化', unlockCheck.current === 1 && unlockCheck.storedUnlocked === 1 && unlockCheck.storedCurrent === 1, unlockCheck);

  const l1 = await ev(`(function(){
    var p = window.__roamDebug.p2;
    p.setAscension(0); var f0 = p.probeFloor('asc-test', 1);
    p.setAscension(1); var f1 = p.probeFloor('asc-test', 1);
    var rooms = f0.rooms.filter(function(r){ return (r.type === 'battle' || r.type === 'elite'); }).length;
    return { base: f0.enemies.length, plus: f1.enemies.length, delta: f1.enemies.length - f0.enemies.length, rooms: rooms };
  })()`);
  check('进阶 1「敌潮」：每间战斗/精英房 +1 敌人',
    l1.plus > l1.base && l1.delta === l1.rooms && l1.rooms > 0, l1);

  const l2 = await ev(`(function(){
    var p = window.__roamDebug.p2;
    p.unlockAscension(2); p.setAscension(2);
    var f2 = p.probeFloor('asc-test', 1);
    var elites = f2.enemies.filter(function(e){ return e.elite; });
    var normals = f2.enemies.filter(function(e){ return !e.elite; });
    var second = elites.filter(function(e){ return e.affix2; }).length;
    var dup = elites.filter(function(e){ return e.affix2 && e.affix2 === e.affix; }).length;
    var normalSecond = normals.filter(function(e){ return e.affix2; }).length;
    return { elites: elites.length, second: second, dup: dup, normalSecond: normalSecond };
  })()`);
  check('进阶 2「精英强化」：精英多一条不重复词缀，普通怪不受影响',
    l2.elites > 0 && l2.second === l2.elites && l2.dup === 0 && l2.normalSecond === 0, l2);

  const l3 = await ev(`(function(){
    var p = window.__roamDebug.p2;
    p.unlockAscension(3); p.setAscension(2);
    var c2 = eventSacrificeCost();
    var w2 = ascensionWagerChance();
    var curse2 = eventCursePerFloor();
    p.setAscension(3);
    var c3 = eventSacrificeCost();
    var w3 = ascensionWagerChance();
    var curse3 = eventCursePerFloor();
    return { c2: c2, c3: c3, w2: w2, w3: w3, curse2: curse2, curse3: curse3, text: eventWagerChanceText() };
  })()`);
  check('进阶 3「代价加重」：献祭代价 ×1.5、赌注胜率 −8%、诅咒每层更痛',
    l3.c3 > l3.c2 && l3.w3 < l3.w2 && l3.curse3 >= l3.curse2, l3);

  const l4 = await ev(`(function(){
    var p = window.__roamDebug.p2;
    p.unlockAscension(4); p.setAscension(3);
    var boss = window.__roamDebug.execute.spawn('boss', 1);
    var b = state.enemies.find(function(e){ return e.isBoss; });
    enterBossPhase3(b);
    var at3 = !!(b && b.phase3);
    p.setAscension(4);
    var boss2 = window.__roamDebug.execute.spawn('boss', 1);
    var b2 = state.enemies.find(function(e){ return e.isBoss; });
    var dmgBefore = b2 ? b2.damage : 0;
    enterBossPhase3(b2);
    return { at3: at3, at4: !!(b2 && b2.phase3), phase: b2 ? b2.phase : null, dmgBefore: dmgBefore, dmgAfter: b2 ? b2.damage : 0 };
  })()`);
  check('进阶 4「首领三阶段」：仅 4 阶生效且伤害提升',
    l4.at3 === false && l4.at4 === true && l4.phase === 3 && l4.dmgAfter > l4.dmgBefore, l4);

  const revert = await ev(`(function(){
    var p = window.__roamDebug.p2;
    p.setAscension(0);
    var stored = JSON.parse(localStorage.getItem(GAME_CONFIG.metaKey) || '{}');
    return { current: p.info().ascension.current, stored: stored.ascension, rule: p.info().ascension.rule };
  })()`);
  check('进阶可回退到 0 且持久化', revert.current === 0 && revert.stored === 0 && revert.rule === '', revert);

  // ---------- P2-3 图鉴 ----------
  const codexTruth = await ev(`(function(){
    var p = window.__roamDebug.p2;
    var defs = { enemies: ENEMY_CONFIG, recipes: FUSION_CONFIG, blueprints: BOSS_BLUEPRINT_CONFIG.blueprints, relics: RELIC_CONFIG, cards: MAGIC_CONFIG.concat(TECH_CONFIG) };
    var out = {};
    Object.keys(defs).forEach(function(tab){
      var info = p.codexInfo(tab);
      out[tab] = { total: info.total, configLen: defs[tab].length, firstId: info.ids[0] || null };
    });
    return out;
  })()`);
  check('图鉴条目数 = 配置真值（五类）',
    Object.keys(codexTruth).every((tab) => codexTruth[tab].total === codexTruth[tab].configLen) && codexTruth.enemies.total > 0,
    codexTruth);

  // 清空已见后：未遇见条目必须黑影 + "?"
  const codexLocked = await ev(`(function(){
    var p = window.__roamDebug.p2;
    state.meta.codex.enemies = [];
    p.openCodex();
    var html = p.codexHtml();
    return { mode: state.mode, hasShadow: html.indexOf('is-locked') >= 0, hasQuestion: html.indexOf('???') >= 0, rows: (html.match(/codex-entry/g) || []).length };
  })()`);
  check('未遇见条目显示黑影 + "?"', codexLocked.mode === 'codex' && codexLocked.hasShadow === true && codexLocked.hasQuestion === true, codexLocked);

  const markFirst = codexTruth.enemies.firstId;
  const codexMark = await ev(`(function(){
    var p = window.__roamDebug.p2;
    var added = p.codexMark('enemies', ${JSON.stringify(markFirst)});
    p.codexSearch('enemies', '');
    var info = p.codexInfo('enemies');
    var firstRow = document.querySelector('#codexBody .codex-entry');
    return { added: added, seen: info.seen, firstLocked: firstRow ? firstRow.classList.contains('is-locked') : null, hasRow: !!firstRow };
  })()`);
  check('遇见后解锁并立刻在图鉴里显形', codexMark.added === true && codexMark.seen === 1 && codexMark.hasRow === true && codexMark.firstLocked === false, codexMark);

  const codexSearch = await ev(`(function(){
    var p = window.__roamDebug.p2;
    p.codexSearch('enemies', '');
    var allText = document.getElementById('codexPageText').textContent;
    var totalText = document.getElementById('codexProgress').textContent;
    var html = p.codexSearch('enemies', 'zzz-no-match');
    return { allPage: allText, total: totalText, empty: html.indexOf('没有匹配的条目') >= 0 };
  })()`);
  check('图鉴搜索/翻页可用（无匹配给空态）', /\d+ \/ \d+/.test(codexSearch.allPage) && codexSearch.empty === true, codexSearch);

  // 关闭图鉴后回到游戏
  const codexClose = await ev(`(function(){
    window.__roamDebug.p2.closeCodex();
    return { mode: state.mode };
  })()`);
  check('关闭图鉴回到游戏', codexClose.mode === 'playing', codexClose);

  // ---------- A1/A3 帮助入口（三个入口同一个面板 / 关闭后状态不变） ----------
  // 先回标题页：三入口分别在标题页、设置页、战斗内
  const toTitle = await ev(`(function(){
    returnToTitleFromRun();
    return { mode: state.mode, titleVisible: !document.getElementById('titleLayer').classList.contains('hidden') };
  })()`);
  check('可返回标题页（存档已写）', toTitle.mode === 'title' && toTitle.titleVisible === true, toTitle);

  const helpFromTitle = await ev(`(function(){
    document.getElementById('btnTitleHelp').click();
    var body = document.getElementById('rulesBody');
    return {
      mode: state.mode,
      open: document.getElementById('rulesPanel').classList.contains('is-open'),
      panes: body.querySelectorAll('[data-help-pane]').length,
      len: body.innerHTML.length,
      overTitle: document.getElementById('rulesPanel').classList.contains('is-over-title')
    };
  })()`);
  check('标题页入口打开帮助（三页签）',
    helpFromTitle.mode === 'rules' && helpFromTitle.open === true && helpFromTitle.panes === 3 && helpFromTitle.overTitle === true,
    helpFromTitle);

  await ev(`closeActivePanel(); true`);
  await sleep(200);

  // 进游戏（用种子局，便于后面存档断言复现同一层）
  const playStart = await ev(`(function(){
    var p = window.__roamDebug.p2;
    var r = p.startSeed('slot-test', { custom: true });
    return { ok: r.ok, mode: state.mode, floor: state.floor, slot: state.runSlot, seed: state.seedInfo ? state.seedInfo.value : null };
  })()`);
  check('种子局可进入战斗', playStart.ok === true && playStart.mode === 'playing' && playStart.seed === 'slot-test', playStart);

  const helpFromIngame = await ev(`(function(){
    document.getElementById('btnRules').click();
    var body = document.getElementById('rulesBody');
    return {
      mode: state.mode,
      open: document.getElementById('rulesPanel').classList.contains('is-open'),
      panes: body.querySelectorAll('[data-help-pane]').length,
      len: body.innerHTML.length,
      overTitle: document.getElementById('rulesPanel').classList.contains('is-over-title')
    };
  })()`);
  await sleep(600);
  const paused = await ev(`(function(){
    var elapsed1 = state.elapsed;
    var frames1 = perfState.frames;
    return { elapsed1: elapsed1, frames1: frames1 };
  })()`);
  await sleep(700);
  const paused2 = await ev(`(function(){
    return { elapsed2: state.elapsed, frames2: perfState.frames };
  })()`);
  check('战斗中 H 入口打开同一个帮助面板',
    helpFromIngame.mode === 'rules' && helpFromIngame.open === true && helpFromIngame.panes === 3
    && helpFromIngame.len === helpFromTitle.len && helpFromIngame.overTitle === false,
    helpFromIngame);
  check('帮助打开期间时间不推进（暂停生效）', Math.abs(paused2.elapsed2 - paused.elapsed1) < 0.02, { paused, paused2 });

  // 关掉帮助后世界必须能继续推进（说明只是暂停，不是卡死）
  const resumed = await ev(`(function(){ closeActivePanel(); return { e1: state.elapsed, mode: state.mode }; })()`);
  await sleep(500);
  const resumed2 = await ev(`(function(){ return { e2: state.elapsed, status: state.status }; })()`);
  check('关闭帮助后世界继续推进（不卡死）', resumed.mode === 'playing' && resumed2.e2 > resumed.e1,
    { before: resumed.e1, after: resumed2.e2 });

  // 设置页入口：先关帮助 → 开设置 → 点"打开说明"
  const helpFromSettings = await ev(`(function(){
    closeActivePanel();
    openPanel('settings');
    var settingsMode = state.mode;
    document.getElementById('btnOpenHelp').click();
    var body = document.getElementById('rulesBody');
    return {
      settingsMode: settingsMode,
      mode: state.mode,
      open: document.getElementById('rulesPanel').classList.contains('is-open'),
      panes: body.querySelectorAll('[data-help-pane]').length,
      len: body.innerHTML.length,
      settingsClosed: !document.getElementById('settingsPanel').classList.contains('is-open')
    };
  })()`);
  check('设置页入口打开同一个帮助面板（设置自动收起）',
    helpFromSettings.settingsMode === 'settings' && helpFromSettings.mode === 'rules'
    && helpFromSettings.open === true && helpFromSettings.panes === 3
    && helpFromSettings.len === helpFromTitle.len && helpFromSettings.settingsClosed === true,
    helpFromSettings);

  // 关闭帮助：游戏状态不变（血量 / 层数 / 敌人 / 计时都不动；关与读在同一帧内完成）
  const closeHelp = await ev(`(function(){
    var before = { floor: state.floor, hp: state.player.hp, hpMax: state.player.hpMax,
      aether: state.player.aether, elapsed: state.elapsed, enemies: state.enemies.length,
      seed: state.seedInfo.value, slot: state.runSlot };
    closeActivePanel();
    var after = { floor: state.floor, hp: state.player.hp, hpMax: state.player.hpMax,
      aether: state.player.aether, elapsed: state.elapsed, enemies: state.enemies.length,
      seed: state.seedInfo.value, slot: state.runSlot };
    return { before: before, after: after, mode: state.mode, status: state.status };
  })()`);
  check('关闭帮助后回到战斗且状态不变',
    closeHelp.mode === 'playing' && closeHelp.status === 'playing'
    && JSON.stringify(closeHelp.before) === JSON.stringify(closeHelp.after),
    closeHelp);

  // ---------- B 局内存档 ----------
  // B1 3 槽存储与自动占槽
  const b1 = await ev(`(function(){
    var p = window.__roamDebug.p2;
    localStorage.removeItem(SAVE_SLOTS_CONFIG.key);
    var r = p.saveNow('manual');
    var info = p.slotInfo(state.runSlot || 1);
    return { ok: r.ok, slot: state.runSlot, slots: SAVE_SLOTS_CONFIG.slots, stored: info !== null, reason: info ? info.reason : null };
  })()`);
  check('3 个存档槽 + 自动占槽写入', b1.ok === true && b1.slot >= 1 && b1.slots === 3 && b1.stored === true, b1);

  // B2 存 → 改状态 → 读回：整份快照逐字段一致（含敌人附着 / 处决 / 破防、掉落、房间、门、Fog）
  const roundtrip = await ev(`(function(){
    var p = window.__roamDebug.p2;
    var slot = state.runSlot || 1;
    var r = p.saveNow('roundtrip');
    var saved = p.slotData(slot);
    // 故意改坏一批关键字段
    state.floor = 99;
    state.player.hp = 1;
    state.player.aether = 0;
    state.enemies.length = 0;
    state.pickups.length = 0;
    state.meta.crystals = 12345;
    var load = p.loadSlot(slot);
    var after = p.snapshot();
    var diff = p.compare(saved, after);
    return {
      saveOk: r.ok, loadOk: load.ok, diff: diff,
      floor: state.floor, hp: state.player.hp, aether: state.player.aether,
      enemies: state.enemies.length, pickups: state.pickups.length,
      crystals: state.meta.crystals,
      metaInSnap: after.meta !== undefined,
      seed: state.seedInfo.value, playRngState: after.playRngState
    };
  })()`);
  check('存 → 改状态 → 读回：快照逐字段完全一致', roundtrip.saveOk === true && roundtrip.loadOk === true && roundtrip.diff === '', {
    diff: roundtrip.diff, floor: roundtrip.floor, hp: roundtrip.hp, enemies: roundtrip.enemies,
    pickups: roundtrip.pickups, seed: roundtrip.seed
  });
  check('读档不覆盖元进度（meta 不进快照）', roundtrip.metaInSnap === false && roundtrip.crystals === 12345, {
    metaInSnap: roundtrip.metaInSnap, crystals: roundtrip.crystals
  });

  // B3 随机种子可复现同一层：读档后的指纹 == 同 (seed, floor) 重新生成
  const seedRepro = await ev(`(function(){
    var p = window.__roamDebug.p2;
    var slot = state.runSlot || 1;
    var saved = p.slotData(slot);
    var seed = saved.seedInfo.value;
    var floor = saved.floor;
    var again = p.probeFloor(seed, floor);
    return { diff: p.compare(saved.floorSignature, again), floor: floor, seed: seed, savedSeed: seed, savedRng: saved.playRngState, rngState: state.playRng ? state.playRng.state : null };
  })()`);
  check('存档里的种子可复现同一层（指纹一致）',
    seedRepro.diff === '' && seedRepro.seed === 'slot-test' && seedRepro.savedRng !== null, seedRepro);

  // B4 三槽互不覆盖
  const threeSlots = await ev(`(function(){
    var p = window.__roamDebug.p2;
    localStorage.removeItem(SAVE_SLOTS_CONFIG.key);
    state.floor = 1; p.saveNow('manual');          // 槽 1 = 第 1 层
    state.floor = 2; saveRunSlot(2, 'manual');      // 槽 2 = 第 2 层
    state.floor = 3; saveRunSlot(3, 'manual');      // 槽 3 = 第 3 层
    var s1 = p.slotInfo(1), s2 = p.slotInfo(2), s3 = p.slotInfo(3);
    return { f1: s1 ? s1.floor : null, f2: s2 ? s2.floor : null, f3: s3 ? s3.floor : null, list: p.listSlots() };
  })()`);
  check('三槽互不覆盖（各自保留自己的层）',
    threeSlots.f1 === 1 && threeSlots.f2 === 2 && threeSlots.f3 === 3, threeSlots);

  const deleteMiddle = await ev(`(function(){
    var p = window.__roamDebug.p2;
    p.clearSlot(2);
    var s1 = p.slotInfo(1), s3 = p.slotInfo(3);
    return { f1: s1 ? s1.floor : null, f3: s3 ? s3.floor : null, s2: p.slotInfo(2) };
  })()`);
  check('删除中间槽不影响其它槽', deleteMiddle.f1 === 1 && deleteMiddle.f3 === 3 && deleteMiddle.s2 === null, deleteMiddle);

  // B5 导出 → 导入后能继续玩
  const exportImport = await ev(`(function(){
    var p = window.__roamDebug.p2;
    var ex = p.exportSlot(1);
    if (!ex.ok) return { exportOk: false, error: ex.error };
    var parsed = JSON.parse(ex.text);
    var checksum = slotChecksum(JSON.stringify(parsed.data));
    var storedChecksum = parsed.checksum;
    var before = p.rawStore().length;
    // 损坏文本：校验和不匹配 → 必须拒绝且原存储不变
    parsed.checksum = 'deadbeef';
    var bad = JSON.stringify(parsed);
    var badResult = p.importSlot(2, bad);
    var afterBad = p.rawStore().length;
    // 版本不匹配 → 明确报错
    var wrongVer = JSON.parse(ex.text);
    wrongVer.version = 1;
    var verResult = p.importSlot(2, JSON.stringify(wrongVer));
    // 缺结构 → 明确报错
    var noRooms = JSON.parse(ex.text);
    noRooms.data = { floor: 1 };
    var structResult = p.importSlot(2, JSON.stringify(noRooms));
    // 合法导入到槽 2
    var okResult = p.importSlot(2, ex.text);
    var load = p.loadSlot(2);
    return {
      exportOk: true, kind: parsed.kind, version: Number(parsed.version), hasChecksum: typeof storedChecksum === 'string' && storedChecksum.length === 8,
      checksum: checksum, storedChecksum: storedChecksum,
      badError: badResult.error, verError: verResult.error, structError: structResult.error,
      sameStoreAfterBad: before === afterBad,
      importOk: okResult.ok, loadOk: load.ok,
      mode: state.mode, floor: state.floor, slot: state.runSlot
    };
  })()`);
  check('导出文本带版本号 + 校验和', exportImport.exportOk === true && exportImport.kind === 'arcane-run-slot'
    && exportImport.version === 2 && exportImport.hasChecksum === true
    && exportImport.checksum === exportImport.storedChecksum, exportImport);
  check('损坏 / 版本不符 / 缺字段的导入被明确拒绝',
    exportImport.badError === 'checksum' && exportImport.verError === 'version' && exportImport.structError === 'structure', exportImport);
  check('导入失败不破坏原存档', exportImport.sameStoreAfterBad === true, exportImport);
  check('导出 → 导入 → 读回后能继续玩',
    exportImport.importOk === true && exportImport.loadOk === true && exportImport.mode === 'playing'
    && exportImport.floor === 1 && exportImport.slot === 2, exportImport);

  // B6 超限降级：首次写入抛 QuotaExceededError，降级只保留最近一槽且不崩
  const quota = await ev(`(function(){
    var p = window.__roamDebug.p2;
    var orig = Storage.prototype.setItem;
    var calls = 0;
    Storage.prototype.setItem = function(){
      calls += 1;
      if (calls === 1) throw new DOMException('quota', 'QuotaExceededError');
      return orig.apply(this, arguments);
    };
    var result;
    try {
      result = p.saveNow('quota-test');
    } catch (error) {
      Storage.prototype.setItem = orig;
      return { crashed: true, message: error && error.message };
    }
    Storage.prototype.setItem = orig;
    var store = JSON.parse(localStorage.getItem(SAVE_SLOTS_CONFIG.key) || '{}');
    var keys = Object.keys(store.slots || {});
    return { crashed: false, ok: result.ok, slotsLeft: keys.length, kept: keys, escapedException: true };
  })()`);
  check('存储超限降级：不崩、只保留最近一槽', quota.crashed === false && quota.ok === true && quota.slotsLeft === 1, quota);

  // B7 关键节点自动存档写入原因（升层 / 开宝箱 / 事件结算 / 退出）
  const reasons = await ev(`(function(){
    var p = window.__roamDebug.p2;
    var out = {};
    var slot = state.runSlot || 1;
    maybeAutosaveRun('floor'); out.floor = p.slotInfo(slot).reason;
    maybeAutosaveRun('chest'); out.chest = p.slotInfo(slot).reason;
    maybeAutosaveRun('event'); out.event = p.slotInfo(slot).reason;
    return out;
  })()`);
  check('关键节点自动存档（floor / chest / event）', reasons.floor === 'floor' && reasons.chest === 'chest' && reasons.event === 'event', reasons);

  const exitSave = await ev(`(function(){
    var p = window.__roamDebug.p2;
    var slot = state.runSlot || 1;
    var before = p.slotInfo(slot).savedAt;
    window.dispatchEvent(new Event('pagehide'));
    var after = p.slotInfo(slot);
    return { before: before, after: after.savedAt, reason: after.reason, grew: after.savedAt >= before };
  })()`);
  check('关闭页面（pagehide）时自动写一次', exitSave.grew === true && exitSave.reason === 'exit', exitSave);

  // B8 旧档（无局内存档）必须正常进标题页
  // 先回标题（returnToTitleFromRun 会写一次槽），再删槽并刷新；
  // 若在战斗状态下直接刷新，pagehide 会再次自动存档，把刚删掉的槽写回来。
  await ev(`(function(){ returnToTitleFromRun(); localStorage.removeItem(SAVE_SLOTS_CONFIG.key); return true; })()`);
  await reload();
  const legacy = await ev(`(function(){
    var p = window.__roamDebug.p2;
    return {
      mode: state.mode,
      titleVisible: !document.getElementById('titleLayer').classList.contains('hidden'),
      slots: p.listSlots(),
      startVisible: !!document.getElementById('btnStart'),
      info: p.info().save
    };
  })()`);
  check('旧档无局内存档时正常进标题页', legacy.mode === 'title' && legacy.titleVisible === true
    && legacy.slots.every((s) => s === null) && legacy.startVisible === true, legacy);

  const legacyStart = await ev(`(function(){
    document.getElementById('btnStart').click();
    return { mode: state.mode, floor: state.floor, slot: state.runSlot };
  })()`);
  check('旧档开局正常（自动占槽）', legacyStart.mode === 'playing' && legacyStart.floor === 1 && legacyStart.slot >= 1, legacyStart);

  // ---------- P2-3 持久化 / 老档图鉴回填 ----------
  await reload();
  const codexPersist = await ev(`(function(){
    var p = window.__roamDebug.p2;
    var info = p.codexInfo('enemies');
    return { seen: info.seen, seenIds: info.seenIds, markedId: ${JSON.stringify(markFirst)} };
  })()`);
  check('图鉴解锁跨局持久化', codexPersist.seen >= 1 && codexPersist.seenIds.indexOf(codexPersist.markedId) >= 0, codexPersist);

  // 模拟旧档：删掉 codex 字段，但保留 meta.recipes（旧版本已记录的配方）
  const legacyCodex = await ev(`(function(){
    var id = FUSION_CONFIG[0].id;
    var bpId = BOSS_BLUEPRINT_CONFIG.blueprints[0].id;
    var meta = JSON.parse(localStorage.getItem(GAME_CONFIG.metaKey) || '{}');
    delete meta.codex;
    meta.recipes = [id];
    meta.bossBlueprints = [bpId];
    localStorage.setItem(GAME_CONFIG.metaKey, JSON.stringify(meta));
    return { recipeId: id, bpId: bpId };
  })()`);
  await reload();
  const legacyCodexAfter = await ev(`(function(){
    var p = window.__roamDebug.p2;
    return {
      recipes: p.codexInfo('recipes').seenIds,
      blueprints: p.codexInfo('blueprints').seenIds,
      hasAllTabs: !!(state.meta.codex && state.meta.codex.enemies && state.meta.codex.cards),
      version: state.meta.version
    };
  })()`);
  check('旧档（无 codex 字段）回填且不重置已见',
    legacyCodexAfter.recipes.indexOf(legacyCodex.recipeId) >= 0
    && legacyCodexAfter.blueprints.indexOf(legacyCodex.bpId) >= 0
    && legacyCodexAfter.hasAllTabs === true,
    { after: legacyCodexAfter, inject: legacyCodex });

  // ---------- 汇总 ----------
  const pass = checks.filter((c) => c.ok).length;
  console.log('P2 ASSERT: ' + pass + '/' + checks.length + ' PASS');
  checks.forEach((c) => { if (!c.ok) console.log('  - FAIL: ' + c.name + ' => ' + JSON.stringify(c.detail)); });
  console.log('exceptions=' + errors.length + (errors.length ? ' ' + errors.join(' | ') : ''));
  if (pass !== checks.length) process.exitCode = 1;
  if (errors.length) process.exitCode = 1;
  try { ws.close(); } catch (e) { /* 已关闭 */ }
  try { edge.kill(); } catch (e) { /* 已退出 */ }
  await sleep(300);
  process.exit(process.exitCode || 0);
}

main().catch((e) => { console.error('FATAL', e && e.message); process.exit(1); });
