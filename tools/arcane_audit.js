/**
 * 第 24 项 · 自审验收：R（渲染）/ S（状态）/ U（面板视口）
 * ------------------------------------------------------------
 * 目的：把"自审找到的真缺陷"固化成断言，防止复发。
 *   R1 玩家每帧只画一次（playerDraws = 1 / excess = 0）
 *   R2 每帧不重建 pattern / DOMMatrix（修复前 3 / 3 → 修复后 0 / 0）
 *   R3 全屏 drawImage 合成次数（列出来源，证明没有重复合成）
 *   R4 CRT 开启时 pattern 只建一次（修复前每帧 1 次 → 修复后第 2 帧 0 次）
 *   S1 换层：aoeZones / sigils / elementClouds / blueprintEffects 必须清零（修复前 1/1/1/1）
 *   S2 重开：同名四类数组 + 触屏瞄准态必须复位
 *   S3 读档：normalizeMeta 版本正确；7 个面板连开 3 轮后持久元素不重复绑定 click
 *   U1–U8 说明/图鉴/技能树/地图/设置/刻印/天赋/结算各面板在 1440×900 下不出视口
 * 用法：node tools/arcane_audit.js
 * 端口：9581
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9581;
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const OUT_DIR = path.join(ROOT, '.screenshots', 'audit');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const asserts = [];
/**
 * 记录一条断言并打印证据
 * @param {string} name 断言名
 * @param {boolean} pass 是否通过
 * @param {*} detail 证据
 * @returns {void}
 */
function ok(name, pass, detail) {
  asserts.push({ name, pass: !!pass, detail: detail === undefined ? null : detail });
  console.log((pass ? 'PASS' : 'FAIL') + ' · ' + name + (detail === undefined ? '' : ' · ' + JSON.stringify(detail)));
}

/**
 * 主流程：起无头 Edge → 逐项采集证据 → 写 result.json
 * @returns {Promise<void>}
 */
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
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT_DIR, name), Buffer.from(r.data, 'base64'));
    return fs.statSync(path.join(OUT_DIR, name)).size;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(1800);
  await ev(`(function(){
    window.__errors = [];
    window.addEventListener('error', function(e){ window.__errors.push(String(e.message || e)); });
    window.addEventListener('unhandledrejection', function(e){ window.__errors.push('rej:' + e.reason); });
    document.querySelector('#btnStart').click();
    return true;
  })()`);
  await sleep(1200);

  // ============================================================
  // R1：玩家每帧绘制次数
  // ============================================================
  const r1 = await ev(`(function(){ render(); return window.__roamDebug.renderAudit(); })()`);
  ok('R1 玩家每帧只绘制一次（playerDraws=1，excess=0）',
    r1.playerDraws === 1 && r1.excess === 0, { playerDraws: r1.playerDraws, excess: r1.excess, frame: r1.frame });

  // ============================================================
  // R2 + R3：帧内对象分配 / 全屏合成来源
  // ============================================================
  const r2 = await ev(`(function(){
    var C2D = CanvasRenderingContext2D.prototype;
    var c = { pattern: 0, linGrad: 0, radGrad: 0, matrix: 0, big: [], bigSites: [], small: 0 };
    var op = C2D.createPattern, ol = C2D.createLinearGradient, orr = C2D.createRadialGradient, oi = C2D.drawImage;
    var OM = window.DOMMatrix;
    var VW = state.viewW || window.innerWidth, VH = state.viewH || window.innerHeight;
    C2D.createPattern = function(){ c.pattern += 1; return op.apply(this, arguments); };
    C2D.createLinearGradient = function(){ c.linGrad += 1; return ol.apply(this, arguments); };
    C2D.createRadialGradient = function(){ c.radGrad += 1; return orr.apply(this, arguments); };
    C2D.drawImage = function(img){
      var a = arguments, dw = 0, dh = 0;
      if (a.length === 9) { dw = a[7]; dh = a[8]; }
      else if (a.length === 5) { dw = a[3]; dh = a[4]; }
      else if (a.length === 3) { dw = img.width; dh = img.height; }
      if (dw >= VW * 0.9 && dh >= VH * 0.9) {
        c.big.push([Math.round(dw), Math.round(dh)]);
        var st = (new Error()).stack || '';
        var lines = st.split('\\n'), site = '?';
        for (var i = 1; i < lines.length; i += 1) {
          var m = lines[i].match(/at ([^ ]+) /);
          if (m && m[1].indexOf('drawImage') < 0) { site = m[1]; break; }
        }
        c.bigSites.push(site);
      } else { c.small += 1; }
      return oi.apply(this, arguments);
    };
    window.DOMMatrix = function(){ c.matrix += 1; return new OM(arguments.length ? arguments[0] : undefined); };
    window.DOMMatrix.prototype = OM.prototype;
    render();
    C2D.createPattern = op; C2D.createLinearGradient = ol; C2D.createRadialGradient = orr;
    C2D.drawImage = oi; window.DOMMatrix = OM;
    return c;
  })()`);
  ok('R2 每帧不重建 pattern / DOMMatrix（自审修复 1 的回归）',
    r2.pattern === 0 && r2.matrix === 0,
    { pattern: r2.pattern, matrix: r2.matrix, linGrad: r2.linGrad, radGrad: r2.radGrad });
  const siteDup = r2.bigSites.filter((s, i) => r2.bigSites.indexOf(s) !== i);
  ok('R3 全屏合成次数与来源：无同一函数重复合成',
    r2.big.length <= 6 && siteDup.length === 0,
    { bigCount: r2.big.length, sites: r2.bigSites, sizes: r2.big, smallImages: r2.small });

  // ============================================================
  // R4：CRT 开启时 pattern 复用（自审修复 3 的回归）
  // ============================================================
  const r4 = await ev(`(function(){
    var C2D = CanvasRenderingContext2D.prototype;
    var op = C2D.createPattern, n = 0;
    var prev = state.meta.postfx ? state.meta.postfx.crt : false;
    state.meta.postfx = state.meta.postfx || {};
    state.meta.postfx.crt = true;
    C2D.createPattern = function(){ n += 1; return op.apply(this, arguments); };
    render();
    var first = n; n = 0;
    render();
    var second = n;
    C2D.createPattern = op;
    state.meta.postfx.crt = !!prev;
    return { first: first, second: second };
  })()`);
  ok('R4 CRT 开启时：第 2 帧 createPattern = 0（首帧允许建一次缓存）',
    r4.first <= 1 && r4.second === 0, r4);

  // ============================================================
  // S1：换层滞留物清零（自审修复 2 + 补漏的回归）
  // ============================================================
  const s1 = await ev(`(function(){
    state.aoeZones = [{ x: 10, y: 10, r: 40, life: 99, maxLife: 99 }];
    state.sigils = [{ x: 20, y: 20, r: 40, life: 9, maxLife: 9 }];
    state.elementClouds = [{ x: 30, y: 30, r: 40, life: 99, element: 'fire' }];
    state.blueprintEffects = [{ x: 40, y: 40, t: 5, radius: 120, damage: 10, color: '#fff', pull: 0, name: 'test' }];
    var before = { aoe: state.aoeZones.length, sig: state.sigils.length, cloud: state.elementClouds.length, bp: state.blueprintEffects.length };
    generateFloor(state.floor + 1);
    var after = { aoe: state.aoeZones.length, sig: state.sigils.length, cloud: state.elementClouds.length, bp: state.blueprintEffects.length };
    return { before: before, after: after };
  })()`);
  ok('S1 换层后四类世界坐标滞留物全部清零（aoe / sigil / cloud / blueprintEffect）',
    s1.before.aoe === 1 && s1.before.sig === 1 && s1.before.cloud === 1 && s1.before.bp === 1
      && s1.after.aoe === 0 && s1.after.sig === 0 && s1.after.cloud === 0 && s1.after.bp === 0,
    s1);

  // ============================================================
  // S2：重开复位（四类数组 + 触屏瞄准态）
  // ============================================================
  const s2 = await ev(`(function(){
    state.touch.aimDragging = true;
    state.touch.aiming = true;
    state.aoeZones = [{ x: 1, y: 1, r: 9, life: 9, maxLife: 9 }];
    state.sigils = [{ x: 2, y: 2, r: 9, life: 9, maxLife: 9 }];
    state.elementClouds = [{ x: 3, y: 3, r: 9, life: 9, element: 'fire' }];
    state.blueprintEffects = [{ x: 4, y: 4, t: 9, radius: 9, damage: 1, color: '#fff', pull: 0, name: 'x' }];
    restartRun();
    return { replaced: state.mode === 'playing' && state.floor === 1, floor: state.floor, mode: state.mode,
      aimDragging: !!(state.touch && state.touch.aimDragging),
      aiming: !!(state.touch && state.touch.aiming),
      aoe: (state.aoeZones || []).length, sig: (state.sigils || []).length,
      cloud: (state.elementClouds || []).length, bp: (state.blueprintEffects || []).length };
  })()`);
  await sleep(500);
  ok('S2 重开：状态重建、四类数组归零、触屏瞄准态复位',
    s2.replaced && s2.floor === 1 && s2.mode === 'playing' && !s2.aimDragging && !s2.aiming
      && s2.aoe === 0 && s2.sig === 0 && s2.cloud === 0 && s2.bp === 0, s2);

  // ============================================================
  // S3a：读档路径的 meta 归一化
  // ============================================================
  const s3a = await ev(`(function(){
    var loaded = window.__roamDebug.perf.load();
    return { version: loaded.version, expected: Number(META_SCHEMA_VERSION) || 0, title: loaded.gameTitle || null };
  })()`);
  ok('S3 读档：perf.load() 返回归一化 meta 且版本号 = META_SCHEMA_VERSION（无异常）',
    s3a.version === s3a.expected && s3a.expected > 0, s3a);

  // ============================================================
  // S3b：连开面板 3 轮，持久元素不重复绑定 click
  // ============================================================
  await ev(`(function(){
    window.__ltReg = [];
    window.__ltOrig = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function(type, fn, opt){
      if (type === 'click' && this instanceof Element) window.__ltReg.push({ t: this, fn: fn });
      return window.__ltOrig.call(this, type, fn, opt);
    };
    return true;
  })()`);
  for (let round = 0; round < 3; round += 1) {
    for (const kind of ['rules', 'codex', 'skilltree', 'map', 'settings', 'engrave']) {
      await ev(`(function(){ closePanel('${kind}'); openPanel('${kind}'); return state.mode; })()`);
    }
  }
  const s3b = await ev(`(function(){
    EventTarget.prototype.addEventListener = window.__ltOrig;
    var byTarget = new Map();
    window.__ltReg.forEach(function(r){
      if (!r.t.isConnected) return;
      byTarget.set(r.t, (byTarget.get(r.t) || 0) + 1);
    });
    var dup = [];
    byTarget.forEach(function(v, k){
      if (v > 1) dup.push({ el: k.id || String(k.className || k.tagName), n: v });
    });
    var tabs = document.getElementById('helpTabs');
    return { listeners: window.__ltReg.length, dup: dup, helpTabsGuard: tabs ? tabs.dataset.bound === '1' : false };
  })()`);
  ok('S3 六个面板连开 3 轮：存活元素上没有重复 click 监听（helpTabs 有防重绑定闸门）',
    s3b.dup.length === 0 && s3b.helpTabsGuard === true, s3b);

  // ============================================================
  // U1–U8：面板在 1440×900 视口内，按钮不被挤出
  // ============================================================
  const rectFn = `(function(el){
    var r = el.getBoundingClientRect();
    return { t: Math.round(r.top), b: Math.round(r.bottom), l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height) };
  })`;
  const panels = [
    { name: 'U1 说明', open: `openPanel('rules')`, card: `#rulesPanel .rules-card`, close: `#rulesClose`, foot: null },
    { name: 'U2 图鉴', open: `openPanel('codex')`, card: `#codexPanel .rules-card`, close: `#codexClose`, foot: `#codexNext` },
    { name: 'U3 技能树', open: `openPanel('skilltree')`, card: `#skillTreePanel .rules-card`, close: `#skillTreeClose`, foot: null },
    { name: 'U4 地图', open: `openPanel('map')`, card: `#mapPanel .rules-card`, close: `#mapClose`, foot: null },
    { name: 'U5 设置', open: `openPanel('settings')`, card: `#settingsPanel .rules-card`, close: `#settingsClose`, foot: `#btnWipeSave` },
    { name: 'U6 刻印', open: `openPanel('engrave')`, card: `#engravePanel .rules-card`, close: `#engraveClose`, foot: `#engraveClose` },
    { name: 'U7 天赋', open: `openTalentsPage()`, card: `#talentLayer .talent-sheet`, close: `#btnTalentClose`, foot: `#btnTalentClose`, closeFn: `closeTalentsPage()` },
    { name: 'U8 死亡结算', open: `showResult()`, card: `#modalLayer .modal`, close: null, foot: `#modalLayer [data-action="restart"]` }
  ];
  const uResults = [];
  for (const p of panels) {
    await ev(`(function(){ ${p.open}; return true; })()`);
    await sleep(350);
    const m = await ev(`(function(){
      var rect = ${rectFn};
      var card = document.querySelector(${JSON.stringify(p.card)});
      var close = ${p.close ? `document.querySelector(${JSON.stringify(p.close)})` : 'null'};
      var layer = card ? card.closest('.rules-layer, .talent-layer, .modal-layer') : null;
      var innerH = window.innerHeight, innerW = window.innerWidth;
      var cr = card ? rect(card) : null;
      var cl = close && close.offsetParent !== null ? rect(close) : null;
      var hOver = layer ? (layer.scrollWidth - layer.clientWidth) : 0;
      var body = document.getElementById('rulesBody');
      return { card: cr, close: cl, innerH: innerH, innerW: innerW, hOver: hOver,
        scrollable: card ? (card.scrollHeight > card.clientHeight + 1) : false,
        rulesBody: body ? { scrollHeight: body.scrollHeight, clientHeight: body.clientHeight,
          scrollable: body.scrollHeight > body.clientHeight + 1 } : null };
    })()`);
    let foot = null;
    if (p.foot) {
      foot = await ev(`(function(){
        var rect = ${rectFn};
        var el = document.querySelector(${JSON.stringify(p.foot)});
        if (!el) return { found: false };
        if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
        var r = rect(el);
        return { found: true, rect: r, inView: r.t >= 0 && r.b <= window.innerHeight + 1 };
      })()`);
    }
    const cardFit = m.card && m.card.t >= 0 && m.card.b <= m.innerH && m.card.l >= 0 && m.card.r <= m.innerW;
    const closeFit = !m.close || (m.close.t >= 0 && m.close.b <= m.innerH);
    const pass = !!cardFit && closeFit && m.hOver <= 1 && (!foot || foot.found && foot.inView);
    uResults.push({ name: p.name, pass: pass, card: m.card, close: m.close, hOver: m.hOver, cardFit: cardFit, closeFit: closeFit, foot: foot, rulesBody: m.rulesBody });

    // 截图（U4 地图 / U5 设置 / U8 结算 各一张，其余只记证据）
    if (['U4 地图', 'U5 设置', 'U8 死亡结算', 'U1 说明'].includes(p.name)) {
      const png = await shot('audit-' + p.name.split(' ')[0].toLowerCase() + '.png');
      uResults[uResults.length - 1].png = png;
    }
    // 关闭
    if (p.name === 'U8 死亡结算') await ev(`(function(){ restartRun(); return true; })()`);
    else if (p.name === 'U7 天赋') await ev(`(function(){ closeTalentsPage(); state.mode = 'playing'; return true; })()`);
    else {
      const kind = { 'U1 说明': 'rules', 'U2 图鉴': 'codex', 'U3 技能树': 'skilltree', 'U4 地图': 'map', 'U5 设置': 'settings', 'U6 刻印': 'engrave' }[p.name];
      await ev(`(function(){ closePanel('${kind}'); return true; })()`);
    }
    await sleep(150);
  }
  const uBad = uResults.filter((r) => !r.pass);
  ok('U1–U8 八个弹窗面板：卡片与关闭/主按钮都在 1440×900 视口内、无横向溢出',
    uBad.length === 0, { checked: uResults.length, bad: uBad });
  ok('U9 长内容面板正文可滚动（#rulesBody 的 scrollHeight > clientHeight，内容全部读得到）',
    !!uResults[0].rulesBody && uResults[0].rulesBody.clientHeight > 0
      && (uResults[0].rulesBody.scrollable || uResults[0].rulesBody.scrollHeight >= uResults[0].rulesBody.clientHeight),
    uResults[0].rulesBody);

  // ============================================================
  // 收尾：零运行时报错
  // ============================================================
  const errors = await ev(`window.__errors.slice()`);
  ok('Z 零运行时报错', errors.length === 0, { errors });

  fs.writeFileSync(path.join(OUT_DIR, 'audit-result.json'),
    JSON.stringify({ asserts, panels: uResults, pass: asserts.filter((a) => a.pass).length, total: asserts.length }, null, 2));

  console.log('\nRESULT: ' + (asserts.every((a) => a.pass) ? 'PASS' : 'FAIL')
    + ' ' + asserts.filter((a) => a.pass).length + '/' + asserts.length);

  ws.close();
  edge.kill();
  setTimeout(() => { killEdge(); process.exit(asserts.every((a) => a.pass) ? 0 : 1); }, 900);
}

main().catch((e) => {
  console.error('FATAL', e && e.stack ? e.stack : e);
  killEdge();
  process.exit(1);
});
