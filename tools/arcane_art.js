// M3 素材化专项验收：角色 / 三类敌人辨识度层
// 用法：node tools/arcane_art.js [html路径] [截图输出目录]
// 覆盖：配置与族色唯一性 / 关闭时"环=地板"（before）/ 打开时"环↔地板"对比与三族色相差（after）/
//       玩家与三敌同屏可分辨 / before-after 截图 / 零报错
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9531;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = process.argv[3] || path.join(__dirname, '..', '.screenshots', 'm3art');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
// 全局持有 Edge 句柄：任何异常都要能把它杀干净，避免残留进程占内存
let EDGE_PROC = null;

/** 记录一条断言并打印 */
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail == null ? '' : JSON.stringify(detail)}`);
}

/** 把 #rrggbb 转成色相角，用于比较族色是否可区分 */
function hueOfHex(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  if (d === 0) return 0;
  let h;
  if (mx === r) h = 60 * (((g - b) / d) % 6);
  else if (mx === g) h = 60 * ((b - r) / d + 2);
  else h = 60 * ((r - g) / d + 4);
  return (h + 360) % 360;
}

/** 两个色相角之间的最短距离（0–180） */
function hueGap(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** 两组 RGB 的欧氏距离（0–441） */
function rgbDist(a, b) {
  if (!a || !b) return -1;
  return Math.round(Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2));
}

async function main() {
  const profile = prepareProfile();
  fs.mkdirSync(OUT, { recursive: true });
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });
  EDGE_PROC = edge;

  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等待端口 */ }
    await sleep(250);
  }
  if (!target) throw new Error('调试端口未就绪');

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
    pending.set(seq, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + r.exceptionDetails.text + ' '
      + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
    return Buffer.from(r.data, 'base64').length;
  };
  const clickElement = async (selector) => {
    const rect = await ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    if (!rect) throw new Error('找不到元素 ' + selector);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  };

  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2200);
  await clickElement('#btnStart');
  await sleep(800);
  // C 批判定是"素材本身的辨识度"：先关掉 D 批后处理（泛光会抬高亮度、污染色相采样），
  // 保证 before/after 的像素采样可重复；截图也在无后处理下取，避免两批效果互相干扰。
  await ev(`window.__roamDebug.setPostFx(false); true`);
  await sleep(300);

  /* ---------- 0) 配置检查：四族颜色必须互不撞色 ---------- */
  const cfg = await ev(`(function(){
    var a = window.__roamDebug.art.info();
    return { enabled: a.enabled, scale: a.scale, families: a.config.families,
      ringGap: a.config.ringGap, badgeSize: a.config.badgeSize };
  })()`);
  check('辨识度层默认开启', cfg.enabled === true, { enabled: cfg.enabled });
  check('四族配置齐全（玩家 + 机械 / 符文 / 虚空）',
    ['player', 'mech', 'rune', 'void'].every((f) => cfg.families[f] && cfg.families[f].ring),
    Object.keys(cfg.families));
  const famHues = Object.keys(cfg.families).map((f) => ({ f, hue: Math.round(hueOfHex(cfg.families[f].ring)) }));
  const pairGaps = [];
  for (let i = 0; i < famHues.length; i += 1) {
    for (let j = i + 1; j < famHues.length; j += 1) {
      pairGaps.push({ a: famHues[i].f, b: famHues[j].f, gap: Math.round(hueGap(famHues[i].hue, famHues[j].hue)) });
    }
  }
  check('四族族色在色相上全部可区分（任意两族 ≥ 40°）',
    pairGaps.every((p) => p.gap >= 40), { famHues, minGap: Math.min(...pairGaps.map((p) => p.gap)), pairGaps });

  /* ---------- 1) 布置同屏场景：玩家 + 三类敌人，相机居中 ---------- */
  const setup = await ev(`(function(){
    var room = state.rooms.filter(function(r){ return r.type !== 'start'; })[0] || state.rooms[0];
    state.enemies.length = 0;
    var px = room.cx, py = room.cy;
    window.__roamDebug.setPlayerPos(px, py);
    state.player.invuln = 99999;
    state.player.hp = state.player.hpMax;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var vw = ctx.canvas.width / dpr, vh = ctx.canvas.height / dpr;
    state.cam.x = px - vw / 2;
    state.cam.y = py - vh / 2;
    var list = [
      { id: 'assembler', dx: 120, dy: 0 },
      { id: 'runesprite', dx: -120, dy: 0 },
      { id: 'stalker', dx: 0, dy: 105 }
    ];
    list.forEach(function(it){
      var e = spawnEnemy(it.id, px + it.dx, py + it.dy, state.floor);
      // 冻住：只测"静态辨识度"，位置必须固定
      e.speed = 0; e.windup = 0; e.hp = e.hpMax;
    });
    return { room: { cx: px, cy: py, type: room.type }, floor: state.floor,
      enemies: state.enemies.map(function(e){ return { id: e.typeId, art: e.art, x: e.x, y: e.y, r: e.radius }; }),
      cam: { x: state.cam.x, y: state.cam.y }, vw: vw, vh: vh };
  })()`);
  await sleep(600);
  check('同屏生成了玩家 + 三类敌人（机械 / 符文 / 虚空）',
    setup.enemies.length === 3
      && new Set(setup.enemies.map((e) => e.art)).size === 3,
    setup.enemies.map((e) => ({ id: e.id, art: e.art })));

  // 页面内统一的测量函数：重绘一帧后，数出"族色环带 / 族徽"里属于该族的像素
  const MEASURE_EXPR = `(function(){
    // 每次测量前把三类敌人钉在"相机中心周围"的固定位置：
    // 否则它们会被 AI 推走、或房间/相机抖动导致采样窗口落到画布外（表现为全 0）。
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var vw = ctx.canvas.width / dpr, vh = ctx.canvas.height / dpr;
    var ccx = state.cam.x + vw / 2, ccy = state.cam.y + vh / 2;
    var OFF = { mech: [92, -18], rune: [-92, -18], void: [0, 92] };
    // 玩家也钉在相机中心：否则被击退/位移后采样窗口可能落到画布外或压到敌人
    window.__roamDebug.setPlayerPos(ccx, ccy);
    state.enemies.forEach(function(e){
      var o = OFF[e.art];
      if (o) { e.x = ccx + o[0]; e.y = ccy + o[1]; }
    });
    render();
    var a = window.__roamDebug.art;
    var cfg = a.info().config;
    function hueOf(hex){ var n = parseInt(hex.slice(1), 16); return rgbToHue((n >> 16) & 255, (n >> 8) & 255, n & 255); }
    var out = { enemies: {}, configHue: {} };
    Object.keys(cfg.families).forEach(function(f){ out.configHue[f] = Math.round(hueOf(cfg.families[f].ring)); });
    out.player = {
      ring: a.regionHue(state.player.x, state.player.y, 20, out.configHue.player, 'ring', 22, 0),
      badge: a.regionHue(state.player.x, state.player.y, 20, out.configHue.player, 'badge', 22, 0)
    };
    state.enemies.forEach(function(e){
      var fam = e.art;
      var bn = cfg.families[fam].ringBonus || 0;
      out.enemies[fam] = {
        ring: a.regionHue(e.x, e.y, e.radius, out.configHue[fam], 'ring', 22, bn),
        badge: a.regionHue(e.x, e.y, e.radius, out.configHue[fam], 'badge', 22, bn)
      };
    });
    return out;
  })()`;

  /* ---------- 2) before：关闭辨识度层，环带里应该没有族色像素 ---------- */
  await ev(`window.__roamDebug.art.toggle(false)`);
  const before = await ev(MEASURE_EXPR);
  const beforeShot = await shot('art-before.png');

  const beforeCounts = Object.keys(before.enemies).map((k) => ({
    fam: k, ringPx: before.enemies[k].ring.count, badgePx: before.enemies[k].badge.count
  }));

  /* ---------- 3) after：打开辨识度层，族色像素成片出现 + 三族色相拉得开 ---------- */
  await ev(`window.__roamDebug.art.toggle(true)`);
  const after = await ev(MEASURE_EXPR);
  const afterShot = await shot('art-after.png');

  const afterCounts = Object.keys(after.enemies).map((k) => ({
    fam: k, ringPx: after.enemies[k].ring.count, badgePx: after.enemies[k].badge.count,
    meanHue: after.enemies[k].ring.meanHue
  }));
  check('打开后：每族族色环带内族色像素 ≥ 30（环真的画出来了）',
    afterCounts.every((x) => x.ringPx >= 30), afterCounts);
  check('打开后：每族族徽区域族色像素 ≥ 4（小尺寸也能读出符号）',
    afterCounts.every((x) => x.badgePx >= 4), afterCounts);

  // 注：符文精灵 / 虚空潜行者本身就是发光体，光晕会周期性伸到环半径附近，
  // 所以"关闭态基线"不稳定（实测 0%–46% 之间跳动），不能当硬阈值。
  // 改为只保留**提升量**（下一节的 delta ≥ +25）与"关闭后玩家环带归零"，这两项不受光晕影响。
  const beforeRatio = afterCounts.map((x) => {
    const b = beforeCounts.find((y) => y.fam === x.fam);
    return {
      fam: x.fam, before: b.ringPx, after: x.ringPx,
      ratio: Math.round((b.ringPx / Math.max(1, x.ringPx)) * 100) / 100,
      gainX: Math.round((x.ringPx / Math.max(1, b.ringPx)) * 10) / 10
    };
  });

  const afterHues = afterCounts.map((x) => x.meanHue).filter((h) => h != null);
  const afterGaps = [];
  for (let i = 0; i < afterHues.length; i += 1) {
    for (let j = i + 1; j < afterHues.length; j += 1) afterGaps.push(Math.round(hueGap(afterHues[i], afterHues[j])));
  }
  check('打开后：三族实测色相任意两族 ≥ 50°（同屏一眼分族）',
    afterGaps.length === 3 && afterGaps.every((g) => g >= 50), { hues: afterHues, gaps: afterGaps });

  const playerGaps = afterCounts.map((x) => Math.round(hueGap(after.player.ring.meanHue, x.meanHue)));
  check('打开后：玩家实测族色与三类敌人全部 ≥ 40°（不会把自己和怪看混）',
    after.player.ring.count >= 30 && playerGaps.every((g) => g >= 40),
    { playerPx: after.player.ring.count, playerHue: after.player.ring.meanHue, gaps: playerGaps });

  /* ---------- 3.5) C 批：60px 缩放下的像素签名（主色 + 轮廓外接框） ---------- */
  // 用 __roamDebug.unitSilhouette：把单位单独画在透明离屏画布上量特征，
  // 尺度无关，等价于"缩到 60px 后还能不能分开"，不受背景亮度影响。
  await ev(`window.__roamDebug.art.toggle(true); true`);
  const KEYS = { player: 'player', mech: 'assembler', rune: 'runesprite', void: 'stalker' };
  const sig = {};
  const idc = {};
  for (const k of Object.keys(KEYS)) {
    sig[k] = await ev(`window.__roamDebug.unitSilhouette('${KEYS[k]}', 60)`);
    idc[k] = await ev(`window.__roamDebug.unitIdentityColor('${KEYS[k]}', 60)`);
  }
  const unitKeys = ['mech', 'rune', 'void'];
  check('60px 采样：玩家与三敌都取到非空剪影（离屏透明画布直绘，不受背景干扰）',
    !!sig.player && sig.player.area >= 60 && unitKeys.every((k) => sig[k] && sig[k].area >= 60),
    { playerArea: sig.player && sig.player.area, enemyArea: unitKeys.map((k) => sig[k] && sig[k].area) });
  check('60px 采样：四族识别主色都取到非空像素',
    !!idc.player && idc.player.px >= 40 && unitKeys.every((k) => idc[k] && idc[k].px >= 40),
    { px: { player: idc.player && idc.player.px, ...unitKeys.reduce((o, k) => { o[k] = idc[k] && idc[k].px; return o; }, {}) } });

  const colorDist = (a, b) => Math.round(Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2));
  const playerDists = unitKeys.map((k) => ({ fam: k, dist: colorDist(idc.player.color, idc[k].color), hue: idc[k].hue }));
  const famPairs = [];
  for (let i = 0; i < unitKeys.length; i += 1) {
    for (let j = i + 1; j < unitKeys.length; j += 1) {
      famPairs.push({ a: unitKeys[i], b: unitKeys[j], dist: colorDist(idc[unitKeys[i]].color, idc[unitKeys[j]].color) });
    }
  }
  check('60px 主色：玩家与三类敌人识别主色 RGB 距离全部 ≥ 40（不是一堆同色小人）',
    playerDists.every((x) => x.dist >= 40), { playerDists, playerColor: idc.player.color });
  check('60px 主色：三敌互相识别主色 RGB 距离全部 ≥ 30',
    famPairs.every((x) => x.dist >= 30), famPairs);

  // 轮廓外接框：宽高比 + 填充率 + 边缘复杂度，三者都要有差异
  const aspects = ['player', ...unitKeys].map((k) => ({ k, aspect: sig[k].aspect, w: sig[k].bbox.w, h: sig[k].bbox.h, fill: sig[k].fill, complexity: sig[k].complexity }));
  const maxAspect = Math.max.apply(null, aspects.map((x) => x.aspect));
  const minAspect = Math.min.apply(null, aspects.map((x) => x.aspect));
  check('60px 轮廓：宽高比跨度 ≥ 0.10（外接框形状有差异）',
    maxAspect - minAspect >= 0.10, aspects);
  const fills = aspects.map((x) => x.fill);
  check('60px 轮廓：填充率跨度 ≥ 0.04（不是同一套圆形底子只换颜色）',
    Math.max.apply(null, fills) - Math.min.apply(null, fills) >= 0.04, aspects);
  const comps = aspects.map((x) => x.complexity);
  check('60px 轮廓：边缘复杂度跨度 ≥ 0.10（轮廓细节有差异）',
    Math.max.apply(null, comps) - Math.min.apply(null, comps) >= 0.10, aspects);

  /* ---------- 4) 提升量：after 必须明显优于 before ---------- */
  const gain = Object.keys(after.enemies).map((k) => ({
    fam: k,
    before: before.enemies[k].ring.count,
    after: after.enemies[k].ring.count,
    delta: after.enemies[k].ring.count - before.enemies[k].ring.count
  }));
  check('辨识度提升量：每一族族色像素至少 +25（不是肉眼"感觉更好"）',
    gain.every((g) => g.delta >= 25), gain);
  check('before/after 截图都 > 100KB（真实渲染，不是空图）',
    beforeShot > 100 * 1024 && afterShot > 100 * 1024, { beforeShot, afterShot });

  /* ---------- 5) A/B 关闭后完全回到旧画面 ---------- */
  await ev(`window.__roamDebug.art.toggle(false)`);
  const off = await ev(`(function(){
    render();
    var cfg = window.__roamDebug.art.info().config;
    var n = parseInt(cfg.families.player.ring.slice(1), 16);
    return window.__roamDebug.art.regionHue(state.player.x, state.player.y, 20,
      rgbToHue((n >> 16) & 255, (n >> 8) & 255, n & 255), 'ring');
  })()`);
  check('总开关关闭后：玩家环带族色像素立刻归零（A/B 可逆）',
    off.count <= 4, off);
  await ev(`window.__roamDebug.art.toggle(true)`);

  const errs = await ev('window.__roamDebug.errors()');
  check('无运行时报错', Array.isArray(errs) && errs.length === 0, errs);

  const pass = results.filter((r) => r.ok).length;
  console.log(`\nRESULT: ${pass}/${results.length} PASS`);
  fs.writeFileSync(path.join(OUT, 'm3art-result.json'), JSON.stringify({
    pass, total: results.length, results, cfg, famHues, pairGaps, setup, before, after, gain, beforeHash: beforeShot, afterHash: afterShot, errs
  }, null, 2));
  ws.close();
  try { killEdge(edge); } catch (e) { /* 已退出 */ }
  if (pass !== results.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error('运行失败：', err && err.message ? err.message : err);
  // 出错也必须把 Edge 杀干净，否则进程会挂在 WebSocket 上不退出并占内存
  try { if (EDGE_PROC) killEdge(EDGE_PROC); } catch (e) { /* 已退出 */ }
  process.exit(1);
});
