/* ============================================================================
 * C1-12 第 3 步 · 卡面质感 A/B（同机位）
 * ----------------------------------------------------------------------------
 * before = 已打包的 v1.5.6（dist/emberfall_v1.5.6/烬_v1.5.6.html）
 * after  = 当前主文件 index_arcane_v2.html
 * 流程完全一致：起局 → 固定 Math.random 序列 → openReward('levelup','skill')
 *              → 等动画结束 → 1440×900 全屏截图 + 卡条区域裁剪图
 * 固定随机序列的作用：两次加载抽到同样的 4 张卡/同样稀有度，A/B 只差质感。
 * 用法：node tools/_card_ab.js
 * ============================================================================ */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9788;
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, '.screenshots', 'art', 'step7');
const FILES = {
  before: path.join(ROOT, 'dist', 'emberfall_v1.5.6', '烬_v1.5.6.html'),
  after: path.join(ROOT, 'index_arcane_v2.html')
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 打开一个文件并在同一机位截图
 * @param {string} file Html 路径
 * @param {string} tag before / after
 * @returns {Promise<Object>} 截图文���信息
 */
async function shootOne(file, tag) {
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 90; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等端口 */ }
    await sleep(250);
  }
  if (!target) throw new Error('Edge 未就绪');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (msg) => {
    const m = JSON.parse(msg.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text);
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
  const shot = async (name, clip) => {
    const params = clip
      ? { format: 'png', clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale: 1 } }
      : { format: 'png' };
    const r = await send('Page.captureScreenshot', params);
    const p = path.join(OUT, name);
    fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
    return fs.statSync(p).size;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + file.replace(/\\/g, '/') });
  await sleep(2200);

  await ev('document.getElementById("btnStart").click(); true');
  await sleep(900);
  /* 固定随机序列：两次加载都抽到同一组卡与同一稀有度 */
  await ev(`(function(){
    window.__rnd = Math.random;
    var seqv = [0.12, 0.37, 0.62, 0.87];
    var i = 0;
    Math.random = function(){ return seqv[i++ % 4]; };
    return true;
  })()`);
  await ev('openReward("levelup", "skill"); true');
  await sleep(700);

  const grid = await ev(`(function(){
    var g = document.querySelector('.reward-grid');
    if (!g) return null;
    var r = g.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  })()`);
  const full = await shot('reward-' + tag + '.png');
  const crop = grid ? await shot('cards-' + tag + '.png', grid) : 0;

  /* 取几张卡的实际计算样式，作为"质感真的生效"的数字证据 */
  const style = await ev(`(function(){
    var c = document.querySelector('.reward-card');
    if (!c) return null;
    var cs = getComputedStyle(c);
    var res = document.querySelector('.reward-card .r-result');
    return { shadow: cs.boxShadow, radius: cs.borderRadius, resultColor: res ? getComputedStyle(res).color : '',
      nameSize: getComputedStyle(document.querySelector('.reward-card .r-name')).fontSize, cards: document.querySelectorAll('.reward-card').length };
  })()`);

  ws.close();
  killEdge(edge);
  await sleep(600);
  return { full, crop, grid, style, errors };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  if (!fs.existsSync(FILES.before)) throw new Error('缺少 v1.5.6 打包文件，先跑 arcane_package');
  const before = await shootOne(FILES.before, 'before');
  const after = await shootOne(FILES.after, 'after');
  console.log(JSON.stringify({ before, after, out: OUT }, null, 2));
  console.log('RESULT: ' + (before.style && after.style && before.style.cards === 4 && after.style.cards === 4 ? 'PASS' : 'FAIL'));
})().catch((e) => { console.error('FATAL', e && e.stack ? e.stack : e); killEdge(); process.exit(1); });
