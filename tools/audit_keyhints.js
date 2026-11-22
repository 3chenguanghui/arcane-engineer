/**
 * 键位提示审计：把界面上所有"教玩家按什么键"的文字抓出来，再和真实键位表对照
 * 用法：node tools/audit_keyhints.js
 * 输出：lab/player8/keyhints.json + 控制台表格
 *
 * 为什么需要：玩家反馈"界面显示 F8/F1 这类不存在的东西"。要分清三种情况：
 *   ① 文案写着某个键，实际没绑定（真 bug）
 *   ② 文案没错，但看起来像快捷键（例如楼层徽标 F1）
 *   ③ 一个动作有两个不同提示（F / L 混用）
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9743;
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const OUT = path.join(ROOT, 'lab', 'player8', 'keyhints.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 主流程：开局后遍历 DOM 抓键位提示，再读真实键位映射 */
async function main() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${prepareProfile()}`, '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--allow-file-access-from-files', '--window-size=1600,1000', 'about:blank',
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等 Edge */ }
    await sleep(250);
  }
  if (!target) throw new Error('调试端口未就绪');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0;
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq;
    const onMsg = (m) => {
      const d = JSON.parse(m.data);
      if (d.id !== id) return;
      ws.removeEventListener('message', onMsg);
      if (d.error) rej(new Error(method + ' ' + JSON.stringify(d.error)));
      else res(d.result);
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  for (let i = 0; i < 80; i += 1) {
    if (await ev("!!document.getElementById('btnStart') && typeof startGame === 'function'")) break;
    await sleep(250);
  }
  await ev("(function(){ __charSkipPick = true; __charPickedThisBoot = true;"
    + " if (typeof closeCharSelect === 'function') closeCharSelect(); startGame(); return 1; })()");
  await sleep(1200);

  const dump = await ev(`(function(){
    var out = { kbd: [], hints: [], badge: null, keymap: null, helpKeys: null };
    document.querySelectorAll('kbd').forEach(function(el){
      var vis = el.offsetParent !== null || getComputedStyle(el).display !== 'none';
      if (!vis) return;
      var box = el.closest('.hint, .dock, .hud-actions, .panel, .modal, .row, li, div') || el.parentElement;
      out.kbd.push({ key: el.textContent.trim(), ctx: (box ? box.textContent : '').replace(/\\s+/g,' ').trim().slice(0, 90) });
    });
    // 顶部按钮 / 底部卡槽里"字母 + 动作"的提示
    document.querySelectorAll('[class*=hint],[class*=dock],[class*=key],[data-key]').forEach(function(el){
      if (el.offsetParent === null) return;
      var t = (el.textContent||'').replace(/\\s+/g,' ').trim();
      if (t && t.length < 40) out.hints.push({ cls: el.className, text: t });
    });
    var b = document.getElementById('minimapFloor');
    out.badge = b ? b.textContent : null;
    // 真实键位：把 KEY_ACTION_MAP 与全局 keydown 里认的键都抓出来
    try { out.keymap = Object.keys(KEY_ACTION_MAP || {}); } catch(e) { out.keymap = 'ERR:' + e.message; }
    try { out.actionOfF = (KEY_ACTION_MAP && (KEY_ACTION_MAP['f'] || KEY_ACTION_MAP['F'])) || null;
          out.actionOfL = (KEY_ACTION_MAP && (KEY_ACTION_MAP['l'] || KEY_ACTION_MAP['L'])) || null; } catch(e) {}
    return out;
  })()`);

  fs.writeFileSync(OUT, JSON.stringify(dump, null, 2), 'utf8');
  console.log('badge=', dump.badge);
  console.log('keymap=', JSON.stringify(dump.keymap));
  console.log('f->', dump.actionOfF, ' l->', dump.actionOfL);
  console.log('--- kbd ---');
  dump.kbd.forEach(function (k) { console.log(JSON.stringify(k)); });
  console.log('--- hints ---');
  dump.hints.forEach(function (h) { console.log(h.cls + ' :: ' + h.text); });
  try { ws.close(); } catch (e) { /* ignore */ }
  try { edge.kill(); } catch (e) { /* ignore */ }
}

main().catch((e) => { console.error('FAIL', e.message); process.exitCode = 1; });
