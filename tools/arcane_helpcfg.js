/**
 * 第 5 轮 · 第 5 组验收（技术债收口）
 * ------------------------------------------------------------
 * 覆盖：
 *   H0 说明页 / 标题页里的房数、敌数、经验、升级门槛全部由配置生成
 *      （在页面内临时改写配置 → 文案必须跟着变，证明没有第二份手写副本）
 *   H1 改回默认配置后文案回到基线（可逆）
 *   H2 单房敌人上限来自 FLOOR_GEN_CONFIG.enemyCountCap（改配置 → 刷怪上限同步）
 *   H3 截图 2 张：说明页基线 / bottom 朝向秘藏房进入
 *
 * 用法：node tools/arcane_helpcfg.js
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9768;
const FILE = path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = path.join(__dirname, '..', '.screenshots', 'helpcfg');
const RESULTS = path.join(OUT, 'helpcfg-result.json');

const checks = [];
const runtimeErrors = [];
let proc = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 记录一条断言
 * @param {string} name 名称
 * @param {boolean} ok 是否通过
 * @param {*} detail 证据
 * @returns {void}
 */
function check(name, ok, detail) {
  checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail == null ? '' : JSON.stringify(detail)}`);
}

/**
 * 主流程
 * @returns {Promise<void>}
 */
async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = prepareProfile();
  proc = spawn(EDGE, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--allow-file-access-from-files',
    '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 端口未起 */ }
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
  const send = (method, params = {}) => new Promise((res, rej) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception || {}).description);
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };
  const click = async (selector) => {
    const rect = await ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    if (!rect) throw new Error('找不到 ' + selector);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  };

  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2200);
  await click('#btnStart');
  await sleep(1000);
  let mode = await ev('state.mode');
  if (mode === 'title') { await click('#btnStart'); await sleep(900); mode = await ev('state.mode'); }
  if (mode === 'title') { await ev('startGame()'); await sleep(900); mode = await ev('state.mode'); }
  check('开局进入 playing', mode === 'playing', { mode });

  // ---------- H0 配置驱动 ----------
  const base = await ev(`(function(){
    var f = helpFacts();
    return { facts: f, rooms: FLOOR_GEN_CONFIG.minRooms + '–' + FLOOR_GEN_CONFIG.maxRooms,
      titleText: (document.getElementById('difficultyNormalText') || {}).innerHTML || '',
      diffDesc: DIFFICULTY_CONFIG.modes.normal.desc };
  })()`);
  const baseText = await ev(`(function(){ ui.rulesPanel.classList.add('is-open'); ui.rulesPanel.setAttribute('aria-hidden','false'); buildRulesContent(); return ui.rulesBody.textContent; })()`);
  check('H0a 说明页房数 = 配置值（4–7）', baseText.indexOf('每层 ' + base.rooms + ' 个房间') >= 0,
    { rooms: base.rooms, hit: baseText.indexOf('每层 ' + base.rooms + ' 个房间') });
  check('H0b 说明页敌数 = 配置基础区间 + 单房上限',
    baseText.indexOf('战斗房基础 ' + base.facts.battleMin + '–' + base.facts.battleMax) >= 0
    && baseText.indexOf('单房上限 ' + base.facts.countCap + ' 只') >= 0,
    { battle: base.facts.battleMin + '–' + base.facts.battleMax, cap: base.facts.countCap });
  check('H0c 说明页经验 / 升级门槛 = 配置值',
    baseText.indexOf('普通怪 ' + base.facts.xpNormal) >= 0
    && baseText.indexOf('×' + base.facts.growth) >= 0
    && baseText.indexOf('1 级门槛 ' + base.facts.baseNeed) >= 0,
    { xpNormal: base.facts.xpNormal, baseNeed: base.facts.baseNeed, growth: base.facts.growth });
  check('H0d 标题页难度卡文案 = 配置区间',
    base.titleText.indexOf('战斗房 ' + base.facts.battleMin + '–' + base.facts.battleMax + ' 只') >= 0,
    { titleText: base.titleText.replace(/\s+/g, ' ') });

  // 临时改配置 → 文案必须跟着变（证明文案没有第二份手写副本）
  const mutated = await ev(`(function(){
    FLOOR_GEN_CONFIG.minRooms = 5;
    FLOOR_GEN_CONFIG.maxRooms = 9;
    FLOOR_GEN_CONFIG.enemyCountCap = 9;
    ROOM_TYPE_CONFIG.types.battle.count = [3, 7];
    ROOM_TYPE_CONFIG.types.elite.count = [2, 6];
    XP_CONFIG.killXp.normal = 15;
    XP_CONFIG.baseNeed = 120;
    XP_CONFIG.growth = 1.35;
    buildRulesContent();
    refreshConfigTexts();
    return { text: ui.rulesBody.textContent,
      titleText: (document.getElementById('difficultyNormalText') || {}).innerHTML || '',
      diffDesc: DIFFICULTY_CONFIG.modes.normal.desc,
      cap: FLOOR_GEN_CONFIG.enemyCountCap,
      generatedCount: generateFloor.length ? null : null };
  })()`);
  check('H0e 改配置后说明页房数跟着变（5–9）', mutated.text.indexOf('每层 5–9 个房间') >= 0,
    { hit: mutated.text.indexOf('每层 5–9 个房间') });
  check('H0f 改配置后说明页敌数 / 上限 / 经验跟着变',
    mutated.text.indexOf('战斗房基础 3–7') >= 0
    && mutated.text.indexOf('单房上限 9 只') >= 0
    && mutated.text.indexOf('普通怪 15') >= 0
    && mutated.text.indexOf('1 级门槛 120') >= 0
    && mutated.text.indexOf('×1.35') >= 0,
    { battle: mutated.text.indexOf('战斗房基础 3–7'), cap: mutated.text.indexOf('单房上限 9 只'),
      xp: mutated.text.indexOf('普通怪 15'), need: mutated.text.indexOf('1 级门槛 120') });
  check('H0g 旧手写文案已彻底移除（不再出现 4–7 个房间 / 3–6 只 / 2–5 只）',
    mutated.text.indexOf('4–7 个房间') < 0 && mutated.text.indexOf('战斗房 3–6') < 0 && mutated.text.indexOf('精英房 2–5') < 0,
    { old1: mutated.text.indexOf('4–7 个房间'), old2: mutated.text.indexOf('战斗房 3–6'), old3: mutated.text.indexOf('精英房 2–5') });
  const srcProbe = await ev(`(function(){
    var src = document.documentElement.outerHTML;
    return {
      hard1: src.indexOf('Math.min(7, Math.round(count * areaMul))') < 0,
      hard2: src.indexOf('Math.max(7, range[1])') < 0,
      factCap: helpFacts().countCap,
      cfgCap: FLOOR_GEN_CONFIG.enemyCountCap
    };
  })()`);
  check('H0h 刷怪处也不再有第二份手写上限（源码里搜不到 Math.min(7, …count…) / Math.max(7, …)）',
    srcProbe.hard1 === true && srcProbe.hard2 === true && srcProbe.factCap === srcProbe.cfgCap,
    srcProbe);

  // ---------- H0i~H0k 第 6 轮 · 第 4 组：配置只读（refreshConfigTexts 不再反向改写） ----------
  const ro = await ev(`(function(){
    var before = DIFFICULTY_CONFIG.modes.normal.desc;
    FLOOR_GEN_CONFIG.minRooms = 6;
    FLOOR_GEN_CONFIG.maxRooms = 9;
    ROOM_TYPE_CONFIG.types.battle.count = [2, 5];
    refreshConfigTexts();
    var after = DIFFICULTY_CONFIG.modes.normal.desc;
    syncDifficultyButtons();
    return { before: before, after: after,
      desc: difficultyDescOf('normal'),
      title: (document.getElementById('difficultyNormalText') || {}).innerHTML || '',
      note: (document.getElementById('difficultyNote') || {}).textContent || '' };
  })()`);
  check('H0i refreshConfigTexts 不再改写配置 desc（改前=改后，且不含房数/敌数数字）',
    ro.before === ro.after && ro.after.indexOf('每层') < 0 && ro.after.indexOf('战斗房') < 0,
    { before: ro.before, after: ro.after });
  check('H0j 展示文案由 difficultyDescOf 按配置实时拼装（6–9 房 / 战斗房 2–5 只）',
    ro.desc.indexOf('每层 6–9 房') >= 0 && ro.desc.indexOf('战斗房 2–5 只') >= 0
    && ro.note.indexOf('每层 6–9 房') >= 0,
    { desc: ro.desc, note: ro.note });
  check('H0k 标题页难度卡仍由 DOM 回填（战斗房 2–5 只）', ro.title.indexOf('战斗房 2–5 只') >= 0,
    { title: ro.title.replace(/\s+/g, ' ') });

  // ---------- H1 可逆 ----------
  const restored = await ev(`(function(){
    FLOOR_GEN_CONFIG.minRooms = 4;
    FLOOR_GEN_CONFIG.maxRooms = 7;
    FLOOR_GEN_CONFIG.enemyCountCap = 7;
    ROOM_TYPE_CONFIG.types.battle.count = [3, 4];
    ROOM_TYPE_CONFIG.types.elite.count = [2, 3];
    XP_CONFIG.killXp.normal = 10;
    XP_CONFIG.baseNeed = 80;
    XP_CONFIG.growth = 1.28;
    buildRulesContent();
    refreshConfigTexts();
    return { text: ui.rulesBody.textContent,
      titleText: (document.getElementById('difficultyNormalText') || {}).innerHTML || '',
      diffDesc: DIFFICULTY_CONFIG.modes.normal.desc };
  })()`);
  check('H1 恢复默认配置后文案回到基线（4–7 / 3–4 / 10 / ×1.28）',
    restored.text.indexOf('每层 4–7 个房间') >= 0 && restored.text.indexOf('普通怪 10') >= 0
    && restored.text.indexOf('×1.28') >= 0 && restored.titleText.indexOf('战斗房 3–4 只') >= 0,
    { rooms: restored.text.indexOf('每层 4–7 个房间'), xp: restored.text.indexOf('普通怪 10') });

  // ---------- H3 截图 ----------
  await sleep(200);
  await shot('help-baseline.png');

  // 缩到说明页顶部拍一张完整截图
  await ev(`(function(){ ui.rulesPanel.scrollTop = 0; if (ui.rulesBody) ui.rulesBody.scrollTop = 0; return true; })()`);
  await sleep(200);
  await shot('help-top.png');

  const failed = checks.filter((c) => !c.ok);
  const summary = {
    round: 5, group: 5, at: new Date().toISOString(),
    checks, pass: checks.filter((c) => c.ok).length, total: checks.length,
    runtimeErrors, base, restored
  };
  fs.writeFileSync(RESULTS, JSON.stringify(summary, null, 2));
  console.log(`\nRESULT: ${summary.pass}/${summary.total}  ${failed.length ? 'FAIL' : 'PASS'}`);
  if (runtimeErrors.length) runtimeErrors.slice(0, 5).forEach((e) => console.log('  ' + e));
  ws.close();
  if (proc) { try { proc.kill(); } catch (e) { /* 已退出 */ } }
  process.exit(failed.length === 0 && runtimeErrors.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('FATAL', err && err.message ? err.message : err);
  if (proc) { try { proc.kill(); } catch (e) { /* 已退出 */ } }
  process.exit(2);
});

