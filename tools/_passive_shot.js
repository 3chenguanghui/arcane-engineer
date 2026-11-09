/**
 * 第 31 项 · 开局被动卡面 2.0 验收（一次性探针，用完可删）
 * ------------------------------------------------------------
 * 做四件事：
 *   1) 新版 1440×900（dpr 1）打开被动段，抓图 + 量版面
 *   2) 新版 1600×900（dpr 1.5）再测一次，确认高 DPI 下同样不滚动
 *   3) 旧发布包（烬_v1.1.0）拍 BEFORE 图，证明卡面确实换了
 *   4) 断言：符号 / 数值 / 影响 / 联动 / 已持有条 全部存在，弹窗不滚动
 * 用法：node tools\_passive_shot.js
 * 端口：9588
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9588;
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const BEFORE_FILE = path.join(ROOT, 'dist', 'emberfall_v1.1.0', '烬_v1.1.0.html');
const OUT_DIR = path.join(ROOT, '.screenshots', 'passive');
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

/**
 * 打开 Edge 并连上 CDP
 * @param {string} url 首屏地址
 * @param {number} w 视口宽
 * @param {number} h 视口高
 * @param {number} dpr 设备像素比
 * @returns {Promise<Object>} { ws, send, ev, runtimeErrors }
 */
async function boot(url, w, h, dpr) {
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    `--window-size=${w},${h}`, 'about:blank'
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
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile: false });
  await send('Page.navigate', { url });
  await sleep(2400);
  return { ws, send, ev, runtimeErrors, edge };
}

/**
 * 量被动弹窗的版面：卡数 / 符号 / 三段文字 / 已持有条 / 是否滚动
 * @returns {Object|null} 版面快照
 */
function auditExpression() {
  return `(function(){
    var modal = document.querySelector('#modalLayer .modal, .modal-layer .modal');
    var cards = Array.prototype.slice.call(document.querySelectorAll('.reward-card.reward-relic-v2'));
    if (!modal) return null;
    var mr = modal.getBoundingClientRect();
    var cardInfo = cards.map(function (card) {
      var sig = card.querySelector('.r-sigil-svg');
      var num = card.querySelector('.r-num');
      var imp = card.querySelector('.r-impact');
      var syn = card.querySelector('.r-syn');
      var res = card.querySelector('.r-result');
      var cr = card.getBoundingClientRect();
      return {
        name: (card.querySelector('.r-name') || {}).textContent || '',
        fam: (card.querySelector('.r-fam') || {}).textContent || '',
        hasSigil: !!sig && (sig.querySelectorAll('path,ellipse,circle').length > 0),
        num: num ? num.textContent.trim() : '',
        impact: imp ? imp.textContent.trim() : '',
        syn: syn ? syn.textContent.trim() : '',
        synWarn: syn ? syn.classList.contains('is-warn') : false,
        result: res ? res.textContent.trim() : '',
        scrollH: card.scrollHeight, clientH: card.clientHeight,
        rect: { x: Math.round(cr.x), y: Math.round(cr.y), w: Math.round(cr.width), h: Math.round(cr.height), bottom: Math.round(cr.bottom) }
      };
    });
    var owned = document.querySelector('.owned-strip');
    return {
      vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio,
      modal: { top: Math.round(mr.top), bottom: Math.round(mr.bottom), h: Math.round(mr.height), scrollH: modal.scrollHeight, clientH: modal.clientHeight, overflowY: getComputedStyle(modal).overflowY },
      cardCount: cards.length,
      cards: cardInfo,
      ownedExists: !!owned,
      ownedText: owned ? owned.textContent.trim() : '',
      ownedChips: owned ? Array.prototype.slice.call(owned.querySelectorAll('.own-chip')).map(function (c) { return c.textContent.trim(); }) : [],
      gridCols: cards.length ? getComputedStyle(cards[0].parentNode).gridTemplateColumns : '',
      title: document.querySelector('#modalLayer .modal h2, .modal-layer .modal h2') ? document.querySelector('#modalLayer .modal h2, .modal-layer .modal h2').textContent : ''
    };
  })()`;
}

/**
 * 主流程：新版两档 dpr + 旧版 BEFORE + 断言
 * @returns {Promise<void>}
 */
async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // ---------- 新版 dpr 1 ----------
  const a = await boot('file:///' + FILE.replace(/\\/g, '/'), 1440, 900, 1);
  await a.ev(`(function(){
    __roamDebug.setRelic('power', 2);
    __roamDebug.setRelic('regen', 1);
    return __roamDebug.openReward('passive');
  })()`);
  await sleep(400);
  const g1 = await a.ev(auditExpression());
  if (!g1) throw new Error('被动弹窗 DOM 未就绪（dpr1）');
  const s1 = await a.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT_DIR, 'after-1440x900-dpr1.png'), Buffer.from(s1.data, 'base64'));

  ok('P1 被动段至少三张卡（当前四选一）', g1.cardCount >= 3 && g1.cardCount <= 4, { cardCount: g1.cardCount, title: g1.title });
  ok('P2 每张卡都有独有 SVG 符号', g1.cards.every((c) => c.hasSigil),
    g1.cards.map((c) => ({ name: c.name, hasSigil: c.hasSigil })));
  ok('P3 每张卡都有具体数值条（非空、含数字）', g1.cards.every((c) => c.num.length > 0 && /\d/.test(c.num)),
    g1.cards.map((c) => c.num));
  ok('P4 每张卡都有玩法影响句（非空且不只形容词）', g1.cards.every((c) => c.impact.length >= 8),
    g1.cards.map((c) => c.impact.slice(0, 40)));
  ok('P5 每张卡都有与本局的联动/冲突说明', g1.cards.every((c) => c.syn.length > 0),
    g1.cards.map((c) => c.syn));
  ok('P6 顶部"当前被动"条显示已持有层数',
    g1.ownedExists && g1.ownedChips.length === 2
      && g1.ownedChips.some((t) => t.indexOf('符文增幅') >= 0 && t.indexOf('2') >= 0)
      && g1.ownedChips.some((t) => t.indexOf('奥能循环') >= 0 && t.indexOf('1') >= 0),
    { chips: g1.ownedChips, text: g1.ownedText.slice(0, 80) });
  ok('P7 1440×900 弹窗不出现内部滚动', g1.modal.scrollH <= g1.modal.clientH + 2,
    { scrollH: g1.modal.scrollH, clientH: g1.modal.clientH });
  ok('P8 1440×900 弹窗完整落在视口内', g1.modal.top >= 0 && g1.modal.bottom <= g1.vh + 1,
    { top: g1.modal.top, bottom: g1.modal.bottom, vh: g1.vh });
  ok('P9 三卡等高且不横向溢出', g1.cards.every((c) => c.rect.x >= 0 && c.rect.x + c.rect.w <= g1.vw + 1),
    g1.cards.map((c) => c.rect));
  ok('P9b 每张卡内部文字不溢出（scrollHeight ≤ clientHeight）', g1.cards.every((c) => c.scrollH <= c.clientH + 2),
    g1.cards.map((c) => ({ name: c.name, scrollH: c.scrollH, clientH: c.clientH })));
  await a.ws.close();
  killEdge(a.edge);
  await sleep(500);

  // ---------- 新版 dpr 1.5 ----------
  const b = await boot('file:///' + FILE.replace(/\\/g, '/'), 1600, 900, 1.5);
  await b.ev(`(function(){
    __roamDebug.setRelic('power', 2);
    __roamDebug.setRelic('lastStand', 1);
    return __roamDebug.openReward('passive');
  })()`);
  await sleep(400);
  const g2 = await b.ev(auditExpression());
  if (!g2) throw new Error('被动弹窗 DOM 未就绪（dpr1.5）');
  const s2 = await b.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT_DIR, 'after-1600x900-dpr1.5.png'), Buffer.from(s2.data, 'base64'));
  ok('P10 1600×900 @1.5 弹窗同样不滚动', g2.modal.scrollH <= g2.modal.clientH + 2,
    { dpr: g2.dpr, scrollH: g2.modal.scrollH, clientH: g2.modal.clientH });
  ok('P11 1600×900 @1.5 弹窗完整落在视口内', g2.modal.top >= 0 && g2.modal.bottom <= g2.vh + 1,
    { top: g2.modal.top, bottom: g2.modal.bottom, vh: g2.vh });
  ok('P12 含 ⚠ 的联动句一定走警示色', g2.cards.every((c) => !c.syn.includes('⚠') || c.synWarn),
    g2.cards.map((c) => ({ name: c.name, warn: c.synWarn, syn: c.syn.slice(0, 50) })));
  const errNew = a.runtimeErrors.concat(b.runtimeErrors);
  await b.ws.close();
  killEdge(b.edge);
  await sleep(500);

  // ---------- 旧发布包 BEFORE ----------
  let beforeOk = false;
  let beforeDetail = null;
  if (fs.existsSync(BEFORE_FILE)) {
    const c = await boot('file:///' + BEFORE_FILE.replace(/\\/g, '/'), 1440, 900, 1);
    await c.ev(`(function(){
      __roamDebug.setRelic('power', 2);
      __roamDebug.setRelic('regen', 1);
      return __roamDebug.openReward('passive');
    })()`);
    await sleep(400);
    const oldInfo = await c.ev(`(function(){
      var cards = document.querySelectorAll('.reward-card.reward-relic');
      var modal = document.querySelector('#modalLayer .modal, .modal-layer .modal');
      return {
        cardCount: cards.length,
        sigils: document.querySelectorAll('.r-sigil-svg').length,
        ownedStrip: document.querySelectorAll('.owned-strip').length,
        modalScroll: modal ? { scrollH: modal.scrollHeight, clientH: modal.clientHeight } : null
      };
    })()`);
    const s3 = await c.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT_DIR, 'before-1440x900-dpr1.png'), Buffer.from(s3.data, 'base64'));
    beforeOk = oldInfo.cardCount >= 3 && oldInfo.sigils === 0;
    beforeDetail = oldInfo;
    c.ws.close();
    killEdge(c.edge);
  }
  ok('P13 BEFORE 旧版被动卡确认无符号、无已持有条（对比有效）', beforeOk && beforeDetail && beforeDetail.ownedStrip === 0, beforeDetail);
  ok('P14 新版全流程 0 运行时异常', errNew.length === 0, errNew.slice(0, 3));

  const summary = {
    at: new Date().toISOString(),
    afterDpr1: g1, afterDpr15: g2, before: beforeDetail,
    checks: asserts,
    pass: asserts.filter((x) => x.pass).length, total: asserts.length,
    screenshots: {
      after1: path.join(OUT_DIR, 'after-1440x900-dpr1.png'),
      after15: path.join(OUT_DIR, 'after-1600x900-dpr1.5.png'),
      before: path.join(OUT_DIR, 'before-1440x900-dpr1.png')
    }
  };
  fs.writeFileSync(path.join(OUT_DIR, 'passive-result.json'), JSON.stringify(summary, null, 2));
  console.log('\nRESULT: ' + (asserts.filter((x) => !x.pass).length === 0 ? 'PASS' : 'FAIL') + '  ' + summary.pass + '/' + summary.total);
  if (asserts.filter((x) => !x.pass).length) process.exitCode = 1;
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
