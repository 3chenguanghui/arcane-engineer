/**
 * 第三组·丢弃技能 只读探针
 * ------------------------------------------------------------
 * 目的：在无头 Edge 里实测「丢弃技能」的四件事：
 *   1. 首次打开技能界面时，内嵌引导出现且只出现一次；
 *   2. 键盘路径（数字键选卡 → Enter 两次）能丢掉魔法卡，卡组 DOM 同步减少；
 *   3. 鼠标路径（点节点 → 点两次详情按钮）能丢掉魔法卡；
 *   4. 边界：最后一张魔法卡不可丢；科技模块没有丢弃入口；已激活融合随组件卡消失。
 * 只读：不改游戏文件；只在页面内存里构造测试用卡组，不写存档。
 * 用法：node tools/_g3_discard_probe.js
 * 产物：.screenshots/g3/discard_probe.json + guide.png / armed.png
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9791;
const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, '.screenshots', 'g3');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 启动无头 Edge，连上 CDP 并加载被测 HTML
 * @param {string} file 被测文件绝对路径
 * @returns {Promise<{ev:Function, shot:Function, close:Function}>} 探针句柄
 */
async function boot(file) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const profile = prepareProfile();
  const proc = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 160; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (target) break;
    } catch (e) { /* 等端口 */ }
    await sleep(250);
  }
  if (!target) { killEdge(proc); throw new Error('Edge 调试端口未就绪'); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (msg) => {
    const m = JSON.parse(msg.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? reject(new Error(method + ': ' + JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: 'file:///' + file.replace(/\\/g, '/') });
  for (let i = 0; i < 200; i += 1) {
    await sleep(250);
    try {
      if (await ev(`typeof state !== 'undefined' && typeof openPanel === 'function'`)) break;
    } catch (e) { /* 仍在解析 */ }
  }
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT_DIR, name), Buffer.from(r.data, 'base64'));
  };
  const close = () => { try { ws.close(); } catch (e) { /* 忽略 */ } killEdge(proc); };
  return { ev, shot, close };
}

/**
 * 主流程：构造卡组 → 首开引导 → 键盘丢卡 → 鼠标丢卡 → 边界断言
 * @returns {Promise<void>}
 */
async function main() {
  const { ev, shot, close } = await boot(FILE);
  const result = {};
  try {
    /* 起局：跳过选角，进入 playing */
    await ev(`(function(){
      window.__charSkipPick = true;
      var b = document.getElementById('btnStart');
      if (b) b.click();
      return true;
    })()`);
    await sleep(1200);

    /* 构造测试卡组：m1 参与一个已激活融合，m2/m3 为普通魔法卡 */
    result.setup = await ev(`(function(){
      var f = FUSION_CONFIG.find(function(x){ return x.magic && x.tech; });
      var m1 = f.magic, t1 = f.tech;
      var others = MAGIC_CONFIG.filter(function(m){ return m.id !== m1; });
      var m2 = others[0].id, m3 = others[1].id;
      state.ownedMagic = [m1, m2, m3];
      state.ownedTech = [t1];
      state.fusions = [f.id];
      state.activeMagicId = m1;
      state.dual = state.dual || { slots: [] };
      state.dual.slots = [];
      state.mode = 'playing';
      renderDeck(); updateHUD();
      if (typeof dualReset === 'function') dualReset();
      /* 清掉首开标记，模拟第一次打开技能界面 */
      localStorage.removeItem('arcane_onboard_v1');
      return { fusion: f.name, fusionId: f.id, magic: m1, tech: t1, m2: m2, m3: m3,
        ownedBefore: state.ownedMagic.slice(), deckBefore: document.querySelectorAll('#magicRow .mini-card.magic').length };
    })()`);
    console.log('setup', result.setup);

    /* 1) 键盘 T 打开技能树 → 引导首次可见 */
    await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 't', code: 'KeyT', bubbles: true })); true`);
    await sleep(500);
    result.guideFirst = await ev(`(function(){
      var el = document.getElementById('treeDiscardGuide');
      return { mode: state.mode, visible: !!(el && !el.hidden), text: el ? el.textContent.replace(/\\s+/g, ' ').trim() : '' };
    })()`);
    await shot('guide.png');
    console.log('guideFirst', result.guideFirst);

    /* 2) 关掉再开：引导不再出现（只出现一次） */
    await ev(`closePanel('skilltree'); true`);
    await sleep(300);
    await ev(`openPanel('skilltree'); true`);
    await sleep(400);
    result.guideSecond = await ev(`(function(){
      var el = document.getElementById('treeDiscardGuide');
      return { visible: !!(el && !el.hidden) };
    })()`);

    /* 3) 键盘路径：数字键选中 m1 → Enter 武装 → Enter 确认 */
    const m1Index = await ev(`MAGIC_CONFIG.findIndex(function(m){ return m.id === ${JSON.stringify(result.setup.magic)}; })`);
    const digit = m1Index + 1;
    await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '${digit}', code: 'Digit${digit}', bubbles: true })); true`);
    await sleep(300);
    result.kbSelected = await ev(`(function(){
      var b = document.querySelector('#treeInspector [data-discard-id]');
      return { hasButton: !!b, label: b ? b.textContent.trim() : '', detail: (document.getElementById('treeInspector')||{}).textContent || '' };
    })()`);
    await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })); true`);
    await sleep(250);
    result.kbArmed = await ev(`(function(){
      var b = document.querySelector('#treeInspector [data-discard-id]');
      return { label: b ? b.textContent.trim() : '', armedClass: b ? /is-armed/.test(b.className) : false };
    })()`);
    await shot('armed.png');
    await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })); true`);
    await sleep(600);
    result.afterKeyboard = await ev(`(function(){
      return { owned: state.ownedMagic.slice(), fusions: state.fusions.slice(),
        deck: document.querySelectorAll('#magicRow .mini-card.magic').length,
        toast: (document.getElementById('toast') || {}).textContent || '' };
    })()`);
    console.log('afterKeyboard', result.afterKeyboard);

    /* 4) 鼠标路径：点 m2 节点 → 点两次按钮 */
    await ev(`(function(){
      var n = document.querySelector('[data-tree-node="magic:${result.setup.m2}"]');
      if (n) n.click();
      return !!n;
    })()`);
    await sleep(300);
    result.mouseBefore = await ev(`(function(){
      var b = document.querySelector('#treeInspector [data-discard-id]');
      return { hasButton: !!b, label: b ? b.textContent.trim() : '' };
    })()`);
    await ev(`(function(){ var b = document.querySelector('#treeInspector [data-discard-id]'); if (b) b.click(); return true; })()`);
    await sleep(250);
    result.mouseArmed = await ev(`(function(){
      var b = document.querySelector('#treeInspector [data-discard-id]');
      return { label: b ? b.textContent.trim() : '', armedClass: b ? /is-armed/.test(b.className) : false };
    })()`);
    await ev(`(function(){ var b = document.querySelector('#treeInspector [data-discard-id]'); if (b) b.click(); return true; })()`);
    await sleep(600);
    result.afterMouse = await ev(`(function(){
      return { owned: state.ownedMagic.slice(),
        deck: document.querySelectorAll('#magicRow .mini-card.magic').length,
        toast: (document.getElementById('toast') || {}).textContent || '' };
    })()`);

    /* 5) 边界：只剩最后一张 → 按钮消失/提示；直接调用也拒绝 */
    result.boundary = await ev(`(function(){
      var left = state.ownedMagic.slice();
      var last = left[0];
      state.ownedMagic = [last];
      if (state.activeMagicId !== last) state.activeMagicId = last;
      renderDeck(); updateHUD();
      if (state.mode === 'skilltree') buildSkillTree(); else openPanel('skilltree');
      var n = document.querySelector('[data-tree-node="magic:' + last + '"]');
      if (n) n.click();
      var btn = document.querySelector('#treeInspector [data-discard-id]');
      var note = document.querySelector('#treeInspector .i-discard-note');
      var techNode = document.querySelector('[data-tree-node^="tech:"]');
      if (techNode) techNode.click();
      var techBtn = document.querySelector('#treeInspector [data-discard-id]');
      var res = discardSkill(last);
      return { lastCard: last, hasButton: !!btn, note: note ? note.textContent.trim() : '',
        techHasButton: !!techBtn, techDetail: (document.getElementById('treeInspector')||{}).textContent || '',
        discardResult: res, ownedAfter: state.ownedMagic.slice() };
    })()`);
    console.log('boundary', result.boundary);

    /* 只读探针自检：文件里确实存在新函数 */
    result.apiPresence = await ev(`({
      discardSkill: typeof discardSkill,
      canDiscardSkill: typeof canDiscardSkill,
      guide: !!document.getElementById('treeDiscardGuide')
    })`);
  } finally {
    fs.writeFileSync(path.join(OUT_DIR, 'discard_probe.json'), JSON.stringify(result, null, 2));
    close();
  }

  /* 控制台汇总，便于直接粘贴回报 */
  const pass = [];
  pass.push(['引导首次可见', result.guideFirst.visible === true]);
  pass.push(['引导二次隐藏', result.guideSecond.visible === false]);
  pass.push(['键盘选中出现按钮', result.kbSelected.hasButton === true]);
  pass.push(['键盘 Enter 武装', result.kbArmed.armedClass === true]);
  pass.push(['键盘丢弃生效', result.setup.ownedBefore.length - result.afterKeyboard.owned.length === 1]);
  pass.push(['兼容融合一并移除', result.afterKeyboard.fusions.indexOf(result.setup.fusionId) < 0]);
  pass.push(['卡组 DOM 同步 -1', result.setup.deckBefore - result.afterKeyboard.deck === 1]);
  pass.push(['鼠标选中出现按钮', result.mouseBefore.hasButton === true]);
  pass.push(['鼠标二次点击生效', result.afterMouse.owned.length === result.afterKeyboard.owned.length - 1]);
  pass.push(['最后一张无按钮', result.boundary.hasButton === false]);
  pass.push(['最后一张调用被拒', result.boundary.discardResult.ok === false && result.boundary.discardResult.reason === 'last-card']);
  pass.push(['科技无丢弃按钮', result.boundary.techHasButton === false]);
  pass.forEach(([name, ok]) => console.log((ok ? 'PASS ' : 'FAIL ') + name));
  console.log('RESULT: ' + (pass.every((x) => x[1]) ? 'PASS' : 'FAIL'));
  console.log('OUT:', path.join(OUT_DIR, 'discard_probe.json'));
}

main().catch((error) => { console.error(error); process.exit(1); });
