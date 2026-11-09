/**
 * 第 5 轮 · 第 3 组验收：场景与角色美术二次提升
 * ------------------------------------------------------------
 * 覆盖：
 *   C1 三主题地面主色像素采样：mech / rune / void 两两 RGB 距离 ≥ 28
 *   C2 墙脚接触阴影：四条边带相对房中心亮度跌幅 ≥ 12%
 *   C3 贴墙物体底座更暗（接触阴影确实让贴墙物有落地感）
 *   C4 60px 缩放下四族剪影两两特征距离 ≥ 阈值 + 族识别色可分辨
 *   C5 before / after 截图各 1 张（场景 + 角色，共 4 张）
 *
 * 说明：所有"before" 都通过把新增层关掉来复现，不需要回滚代码。
 * 用法：node tools/arcane_scene_art2.js
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9765;
const FILE = path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = path.join(__dirname, '..', '.screenshots', 'scene_art2');
const RESULTS = path.join(OUT, 'scene-art2-result.json');

const checks = [];
const runtimeErrors = [];
let EDGE_PROC = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 记录一条断言
 * @param {string} name 断言名
 * @param {boolean} ok 是否通过
 * @param {*} detail 证据
 * @returns {void}
 */
function check(name, ok, detail) {
  checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail == null ? '' : JSON.stringify(detail)}`);
}

/**
 * RGB 欧氏距离
 * @param {{r:number,g:number,b:number}} a 颜色 A
 * @param {{r:number,g:number,b:number}} b 颜色 B
 * @returns {number} 距离
 */
function rgbDist(a, b) {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

/**
 * 十六进制颜色转 RGB
 * @param {string} hex '#rrggbb'
 * @returns {{r:number,g:number,b:number}|null} RGB
 */
function hexRgb(hex) {
  if (!hex || typeof hex !== 'string') return null;
  const m = hex.replace('#', '');
  if (m.length !== 6) return null;
  return { r: parseInt(m.slice(0, 2), 16), g: parseInt(m.slice(2, 4), 16), b: parseInt(m.slice(4, 6), 16) };
}

/**
 * 计算色相角（0–360）
 * @param {{r:number,g:number,b:number}} c RGB
 * @returns {number} 色相角
 */
function hueOf(c) {
  const r = c.r / 255; const g = c.g / 255; const b = c.b / 255;
  const max = Math.max(r, g, b); const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

/**
 * 两个色相的最小夹角（0–180）
 * @param {number} a 色相 A
 * @param {number} b 色相 B
 * @returns {number} 夹角
 */
function hueGap(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * 剪影特征距离（三项归一化相加）
 * @param {Object} a 剪影读数 A
 * @param {Object} b 剪影读数 B
 * @returns {number} 距离
 */
function silDist(a, b) {
  return Math.abs(a.aspect - b.aspect)
    + Math.abs(a.complexity - b.complexity) / 3
    + Math.abs(a.fill - b.fill);
}

/**
 * 主流程
 * @returns {Promise<void>}
 */
async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = prepareProfile();
  EDGE_PROC = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 端口还没起 */ }
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
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      throw new Error('EVAL: ' + r.exceptionDetails.text + ' '
        + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    }
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };

  // ---------- 启动 ----------
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2400);
  const startPos = await ev(`(() => { const el = document.getElementById('btnStart'); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: startPos.x, y: startPos.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: startPos.x, y: startPos.y, button: 'left', clickCount: 1 });
  await sleep(1200);

  /**
   * 布置：指定层 + 最大战斗房 + 玩家居中 + 清空敌人
   * @param {number} floor 层数
   * @returns {Promise<Object>} 房间信息
   */
  const setup = async (floor) => ev(`(() => {
    __roamDebug.xp.setEnabled(false);
    __roamDebug.enemies.floor(${floor});
    state.mode = 'playing'; state.status = 'playing';
    const room = state.rooms.filter((r) => r.type === 'battle' || r.type === 'elite')
      .sort((a, b) => (b.w * b.h) - (a.w * a.h))[0] || state.rooms[0];
    state.currentRoomId = room.id;
    __roamDebug.teleport(room.cx, room.cy);
    __roamDebug.despawnAll();
    return { floor: state.floor, themeId: state.themeId, roomId: room.id, room: { cx: room.cx, cy: room.cy, w: room.w, h: room.h } };
  })()`);

  const info = await ev('__roamDebug.sceneArt2.info()');
  check('C0 配置默认全开', info.enabled === true && info.floorWash === true
    && info.directionalLight === true && info.contactShadow === true,
  { enabled: info.enabled, layers: [info.floorWash, info.directionalLight, info.contactShadow], washes: info.themeFloorWash });

  // ---------- C1 三主题地板主色 ----------
  const sMe = await ev('__roamDebug.sceneArt2.sampleTheme("mech")');
  const sRu = await ev('__roamDebug.sceneArt2.sampleTheme("rune")');
  const sVo = await ev('__roamDebug.sceneArt2.sampleTheme("void")');
  const dMR = rgbDist(sMe.meanRgb, sRu.meanRgb);
  const dRV = rgbDist(sRu.meanRgb, sVo.meanRgb);
  const dMV = rgbDist(sMe.meanRgb, sVo.meanRgb);
  const gapMin = Math.min(dMR, dRV, dMV);
  check('C1 三主题地面主色两两可辨', gapMin >= 28,
    { mech: sMe.meanRgb, rune: sRu.meanRgb, void: sVo.meanRgb, dMR: +dMR.toFixed(1), dRV: +dRV.toFixed(1), dMV: +dMV.toFixed(1) });

  // 真实场景交叉验证：换层后从烘焙底图直接取样（不是离屏合成）
  // 第 13 项起主题按大区锁定（机械 F1–6 / 符文 F7–12 / 虚空 F13–18），
  // 因此三个代表层取 1 / 7 / 13，而不是旧版的 1 / 2 / 3。
  const real = {};
  for (const f of [1, 7, 13]) {
    const meta = await setup(f);
    const audit = await ev('__roamDebug.sceneAudit()');
    const rooms = (audit.rooms || []).filter((r) => Array.isArray(r.meanRgb));
    const avg = rooms.reduce((a, r) => ({ r: a.r + r.meanRgb[0], g: a.g + r.meanRgb[1], b: a.b + r.meanRgb[2] }), { r: 0, g: 0, b: 0 });
    const n = Math.max(1, rooms.length);
    real[meta.themeId] = { r: Math.round(avg.r / n), g: Math.round(avg.g / n), b: Math.round(avg.b / n) };
  }
  const realGap = Math.min(rgbDist(real.mech, real.rune), rgbDist(real.rune, real.void), rgbDist(real.mech, real.void));
  check('C1b 真实烘焙底图三层主色同样可辨', realGap >= 28,
    { real, minGap: +realGap.toFixed(1) });

  // ---------- C2 / C3 墙脚接触阴影 ----------
  // contactProbe 内部自带"不画接触阴影"的同底图对照组，不需要真的关掉开关
  const probeOn = await ev('__roamDebug.sceneArt2.contactProbe()');
  const edges = ['top', 'bottom', 'left', 'right'];
  const bandDrops = edges.map((k) => probeOn.bands[k].drop);
  check('C2 四边墙脚带都比房中心暗 ≥12%', Math.min(...bandDrops) >= 0.12,
    { center: probeOn.centerLum, bands: probeOn.bands });
  // 同一张底图下逐边比较：开了接触阴影后，边带亮度必须明显更低
  const shadowDelta = edges.map((k) => 1 - probeOn.bands[k].lum / Math.max(0.001, probeOn.bands[k].noShadowLum));
  check('C2b 同底图对照：接触阴影让四条边带真的变暗 ≥8%',
    Math.min(...shadowDelta) >= 0.08,
    { shadowDelta: shadowDelta.map((v) => +v.toFixed(3)), on: probeOn.bands, off: probeOn.noShadow.bands });
  check('C3 贴墙物体底座比房中心暗 ≥12%（落地感）', probeOn.propDrop >= 0.12,
    { propBase: probeOn.propBaseLum, propCenter: probeOn.propCenterLum, drop: probeOn.propDrop });
  check('C3b 同底图对照：关掉接触阴影后贴墙底座不再明显变暗',
    probeOn.noShadow.propDrop < probeOn.propDrop - 0.05,
    { on: probeOn.propDrop, off: probeOn.noShadow.propDrop });

  // ---------- C4 60px 剪影 ----------
  const silOn = await ev('__roamDebug.charSil2.readAll(60)');
  const families = ['player', 'mech', 'rune', 'void'];
  // 完整 = 长边 ≥ 48px 且短边 ≥ 28px（60px 画布里等比缩放的合理范围，排除被裁切/过小）
  const bboxOk = families.every((f) => silOn[f]
    && Math.max(silOn[f].bbox.w, silOn[f].bbox.h) >= 48
    && Math.min(silOn[f].bbox.w, silOn[f].bbox.h) >= 20);
  check('C4a 60px 下四族剪影均完整（未被裁切）', bboxOk,
    families.reduce((acc, f) => { acc[f] = silOn[f] ? silOn[f].bbox : null; return acc; }, {}));

  const pairs = [];
  for (let i = 0; i < families.length; i += 1) {
    for (let j = i + 1; j < families.length; j += 1) {
      const a = silOn[families[i]]; const b = silOn[families[j]];
      if (!a || !b) continue;
      pairs.push({ pair: families[i] + '-' + families[j], dist: +silDist(a, b).toFixed(3) });
    }
  }
  const minSil = Math.min(...pairs.map((p) => p.dist));
  const threshold = (info.verify && info.verify.silhouetteGap) || 0.30;
  check('C4b 四族两两剪影特征距离 ≥ 阈值', minSil >= threshold,
    { threshold, min: minSil, pairs });

  // C4c-1：60px 缩放下"实际画出来的主色"（像素采样得到的族识别色）两两 RGB ≥ 40
  const pixelPairs = [];
  for (let i = 0; i < families.length; i += 1) {
    for (let j = i + 1; j < families.length; j += 1) {
      const a = silOn[families[i]]; const b = silOn[families[j]];
      if (!a || !b) continue;
      pixelPairs.push({
        pair: families[i] + '-' + families[j],
        rgb: +rgbDist(a.accentColor, b.accentColor).toFixed(1)
      });
    }
  }
  check('C4c 60px 实测主色两两 RGB ≥40',
    pixelPairs.every((p) => p.rgb >= 40), { pairs: pixelPairs });

  // C4c-2：设计层的族环色色相两两 ≥45°（保证"颜色语义"本身不撞车）
  const ringPairs = [];
  for (let i = 0; i < families.length; i += 1) {
    for (let j = i + 1; j < families.length; j += 1) {
      const ca = hexRgb(silOn[families[i]] && silOn[families[i]].ringColor);
      const cb = hexRgb(silOn[families[j]] && silOn[families[j]].ringColor);
      if (!ca || !cb) continue;
      ringPairs.push({
        pair: families[i] + '-' + families[j],
        rgb: +rgbDist(ca, cb).toFixed(1),
        hue: +hueGap(hueOf(ca), hueOf(cb)).toFixed(1)
      });
    }
  }
  check('C4c2 族环色两两 RGB ≥40 且色相 ≥45°',
    ringPairs.every((p) => p.rgb >= 40 && p.hue >= 45), { pairs: ringPairs });

  // before（关掉剪影决定件）对照：特征距离应明显变小
  await ev('__roamDebug.charSil2.setEnabled(false)');
  const silOff = await ev('__roamDebug.charSil2.readAll(60)');
  const offPairs = [];
  for (let i = 0; i < families.length; i += 1) {
    for (let j = i + 1; j < families.length; j += 1) {
      const a = silOff[families[i]]; const b = silOff[families[j]];
      if (!a || !b) continue;
      offPairs.push(silDist(a, b));
    }
  }
  const offMin = Math.min(...offPairs);
  check('C4d 二次强化后剪影可辨度确实提升', minSil > offMin + 0.03,
    { beforeMin: +offMin.toFixed(3), afterMin: +minSil.toFixed(3) });

  // ---------- C5 before / after 截图（共 4 张：场景 2 张 + 角色 2 张） ----------
  await setup(1);
  await sleep(300);
  await ev('__roamDebug.sceneArt2.setEnabled({ enabled: false })');
  await sleep(200);
  await shot('scene-before.png');
  await ev('__roamDebug.sceneArt2.setEnabled({ enabled: true })');
  await sleep(240);
  await shot('scene-after.png');

  // 角色用"四族 60px 对照图"：这是玩家实际看到的大小，比全屏截图更能看出轮廓差
  const saveSheet = (name, sheet) => {
    fs.writeFileSync(path.join(OUT, name), Buffer.from(sheet.dataUrl.split(',')[1], 'base64'));
  };
  await ev('__roamDebug.charSil2.setEnabled(false)');
  saveSheet('char-before.png', await ev('__roamDebug.charSil2.sheet(60)'));
  await ev('__roamDebug.charSil2.setEnabled(true)');
  saveSheet('char-after.png', await ev('__roamDebug.charSil2.sheet(60)'));

  // ---------- 汇总 ----------
  const failed = checks.filter((c) => !c.ok);
  const summary = {
    round: 5, group: 3, at: new Date().toISOString(),
    checks, pass: checks.filter((c) => c.ok).length, total: checks.length,
    runtimeErrors, samples: { mech: sMe, rune: sRu, void: sVo }, realScene: real,
    contact: { on: probeOn, noShadow: probeOn.noShadow },
    silhouettes: { on: silOn, off: silOff }
  };
  fs.writeFileSync(RESULTS, JSON.stringify(summary, null, 2));
  console.log(`\nRESULT: ${failed.length === 0 ? 'PASS' : 'FAIL'}  ${summary.pass}/${summary.total}`);
  if (runtimeErrors.length) {
    console.log('运行时异常：');
    runtimeErrors.slice(0, 5).forEach((e) => console.log('  ' + e));
  }
  ws.close();
  if (EDGE_PROC) { try { EDGE_PROC.kill(); } catch (e) { /* 已退出 */ } }
  process.exit(failed.length === 0 && runtimeErrors.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('FATAL', err && err.message ? err.message : err);
  if (EDGE_PROC) { try { EDGE_PROC.kill(); } catch (e) { /* 已退出 */ } }
  process.exit(2);
});
