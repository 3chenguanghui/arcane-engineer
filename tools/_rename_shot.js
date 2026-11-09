/**
 * 第 29 项 · 改名「烬」标题页版面验收（一次性探针，用完可删）
 * ------------------------------------------------------------
 * 只做两件事：
 *   1) 真实窗口 1440×900 打开标题页，抓图存 .screenshots/rename/
 *   2) 量标题卡与主标题的几何关系，证明单字标题"不溢出、不换行、不出滚动"
 * 用法：node tools\_rename_shot.js
 * 端口：9586
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9586;
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const OUT_DIR = path.join(ROOT, '.screenshots', 'rename');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const asserts = [];
/**
 * 记录断言并输出证据
 * @param {string} name 断言名
 * @param {boolean} pass 是否通过
 * @param {*} [detail] 证据
 * @returns {void}
 */
function ok(name, pass, detail) {
  asserts.push({ name, pass: !!pass, detail: detail === undefined ? null : detail });
  console.log((pass ? 'PASS' : 'FAIL') + ' · ' + name + ' · ' + JSON.stringify(detail));
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
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
    } catch (e) { /* 等 Edge 起来 */ }
    await sleep(250);
  }
  if (!target) throw new Error('Edge 未就绪');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const runtimeErrors = [];
  ws.onmessage = (msg) => {
    const m = JSON.parse(msg.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params && m.params.exceptionDetails;
      runtimeErrors.push((d && d.exception && (d.exception.description || d.exception.value)) || (d && d.text) || 'unknown');
    }
  };
  await new Promise((r) => { ws.onopen = r; });
  /**
   * 发送 CDP 命令
   * @param {string} method CDP 方法
   * @param {Object} [params] 参数
   * @returns {Promise<Object>}
   */
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? reject(new Error(method + ': ' + JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  /**
   * 页面内执行表达式
   * @param {string} expression JS 表达式
   * @returns {Promise<*>}
   */
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2200);

  const geom = await ev(`(function(){
    var word = document.getElementById('titleWordmark');
    var card = document.querySelector('.title-card-v8');
    var layer = document.getElementById('titleLayer');
    if (!word || !card) return null;
    var wr = word.getBoundingClientRect();
    var cr = card.getBoundingClientRect();
    var cs = getComputedStyle(word);
    var cardCs = getComputedStyle(card);
    return {
      text: word.textContent.trim(),
      lenAttr: word.getAttribute('data-title-len'),
      fontSize: parseFloat(cs.fontSize),
      letterSpacing: parseFloat(cs.letterSpacing),
      lines: Math.round(wr.height / parseFloat(cs.lineHeight || cs.fontSize)),
      word: { x: wr.x, y: wr.y, w: wr.width, h: wr.height, right: wr.right, bottom: wr.bottom },
      card: { x: cr.x, y: cr.y, w: cr.width, h: cr.height, right: cr.right, bottom: cr.bottom },
      cardScroll: { scrollH: card.scrollHeight, clientH: card.clientHeight },
      overflowX: cardCs.overflowX, overflowY: cardCs.overflowY,
      layerHidden: layer ? layer.classList.contains('hidden') : null,
      docTitle: document.title,
      vw: innerWidth, vh: innerHeight
    };
  })()`);
  if (!geom) throw new Error('标题页 DOM 未就绪');

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT_DIR, 'title-1440x900.png'), Buffer.from(shot.data, 'base64'));

  const insideX = geom.word.x >= geom.card.x - 1 && geom.word.right <= geom.card.right + 1;
  const insideY = geom.word.y >= geom.card.y - 1 && geom.word.bottom <= geom.card.bottom + 1;
  ok('R1 主标题文字为单字「烬」且字数属性为 1', geom.text === '烬' && geom.lenAttr === '1', { text: geom.text, lenAttr: geom.lenAttr });
  ok('R2 单字标题放大了字号并拉开字距',
    geom.fontSize >= 56 && geom.letterSpacing >= geom.fontSize * 0.15,
    { fontSize: geom.fontSize, letterSpacing: geom.letterSpacing });
  ok('R3 标题不换行（只占一行）', geom.lines === 1, { lines: geom.lines, wordH: geom.word.h });
  ok('R4 标题在标题卡内，无横向/纵向溢出', insideX && insideY,
    { word: geom.word, card: geom.card, insideX, insideY });
  ok('R5 标题卡无内部滚动条', geom.cardScroll.scrollH <= geom.cardScroll.clientH + 2, geom.cardScroll);
  ok('R6 标题页处于可见状态且 document.title 正确',
    geom.layerHidden === false && geom.docTitle === '烬 · Emberfall',
    { layerHidden: geom.layerHidden, docTitle: geom.docTitle });
  ok('R7 全流程 0 运行时异常', runtimeErrors.length === 0, runtimeErrors.slice(0, 3));

  const summary = {
    at: new Date().toISOString(), geom, checks: asserts,
    pass: asserts.filter((c) => c.pass).length, total: asserts.length,
    runtimeErrors, screenshot: path.join(OUT_DIR, 'title-1440x900.png')
  };
  fs.writeFileSync(path.join(OUT_DIR, 'rename-result.json'), JSON.stringify(summary, null, 2));
  console.log('\nRESULT: ' + (asserts.filter((c) => !c.pass).length === 0 ? 'PASS' : 'FAIL') + '  ' + summary.pass + '/' + summary.total);
  ws.close();
  killEdge(edge);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
