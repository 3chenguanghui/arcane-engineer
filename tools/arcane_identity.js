/**
 * 第 19 项 · 玩家与敌人形象辨识度验收（I1–I9）
 * 用法：node tools/arcane_identity.js
 * 端口：9543
 * 输出：.screenshots/art/identity-*.png、identity-result.json、identity-metrics.json
 *
 * 口径（与 .spec/identity.md 一致）：
 *   · 剪影差异 = |宽高比差| + |边缘复杂度差|/3 + |填充率差|（与 arcane_scene_art2 同一公式）
 *   · 主色差   = 60px 实测"饱和度最高 25% 像素"主色的 RGB 欧氏距离
 *   · 轮廓占比 = 剪影面积 / 包围盒面积（fill；越接近 1 = 越"实心块"，越低 = 越"碎"）
 * 所有读数通过 __roamDebug.unitSilhouetteAt(key, 60) 取得，与玩家实际看到的大小一致。
 * before = __roamDebug.identity.setEnabled(false)（上一版同族共用签名件）
 * after  = __roamDebug.identity.setEnabled(true) （逐个体签名件 + 配色去重）
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9543;
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const OUT_DIR = path.join(ROOT, '.screenshots', 'art');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const asserts = [];
/**
 * 记录一条断言并打印证据
 * @param {string} name 断言名
 * @param {boolean} pass 是否通过
 * @param {*} [detail] 证据
 * @returns {void}
 */
function ok(name, pass, detail) {
  asserts.push({ name, pass: !!pass, detail: detail === undefined ? null : detail });
  console.log((pass ? 'PASS' : 'FAIL') + ' · ' + name + (detail === undefined ? '' : ' · ' + JSON.stringify(detail)));
}

/**
 * RGB 欧氏距离
 * @param {{r:number,g:number,b:number}} a
 * @param {{r:number,g:number,b:number}} b
 * @returns {number} 距离
 */
function rgbDist(a, b) {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

/**
 * 剪影特征距离（与 arcane_scene_art2 同一口径）
 * @param {Object} a 剪影读数
 * @param {Object} b 剪影读数
 * @returns {number} 距离
 */
function silDist(a, b) {
  return Math.abs(a.aspect - b.aspect)
    + Math.abs(a.complexity - b.complexity) / 3
    + Math.abs(a.fill - b.fill);
}

/**
 * 两两最小距离 + 最差对 + 全部组合
 * @param {Array} items 单位读数（含 key）
 * @param {Function} dist 距离函数
 * @returns {{min:number,worst:string,all:Array}}
 */
function worstPair(items, dist) {
  let min = Infinity;
  let worst = null;
  const all = [];
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const d = dist(items[i], items[j]);
      all.push({ pair: items[i].key + '-' + items[j].key, d: Number(d.toFixed(3)) });
      if (d < min) { min = d; worst = items[i].key + '-' + items[j].key; }
    }
  }
  return { min: Number(min.toFixed(3)), worst, all };
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
   * 发送 CDP 命令并等待返回
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
  /**
   * 截图保存
   * @param {string} name 文件名
   * @returns {Promise<void>}
   */
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT_DIR, name), Buffer.from(r.data, 'base64'));
  };
  /**
   * 保存页面内生成的 canvas dataURL
   * @param {string} name 文件名
   * @param {Object} sheet {dataUrl}
   * @returns {void}
   */
  const saveSheet = (name, sheet) => {
    fs.writeFileSync(path.join(OUT_DIR, name), Buffer.from(sheet.dataUrl.split(',')[1], 'base64'));
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(1800);
  await ev(`(function(){ var b = document.querySelector('#btnStart'); if (b) b.click(); return true; })()`);
  await sleep(900);
  await ev(`(function(){
    if (typeof skipOpeningRitual === 'function') skipOpeningRitual();
    state.transitionLock = false;
    window.__roamDebug.clearEnemies();
    state.player.vx = 0; state.player.vy = 0;
    state.runSlot = 1;
    return { floor: state.floor, mode: state.mode, status: state.status };
  })()`);
  await sleep(300);

  // ---------- I0 配置 / 单位清单 ----------
  const info = await ev('__roamDebug.identity.info()');
  ok('I0 辨识度配置默认开启且阈值齐全', info.enabled === true && info.verify
    && info.verify.withinRegionSil > 0 && info.verify.crossRegionSil > 0,
  { enabled: info.enabled, verify: info.verify });

  const units = await ev('__roamDebug.identity.units()');
  const regions = { mech: [], rune: [], void: [] };
  units.forEach((u) => { if (regions[u.art]) regions[u.art].push(u); });
  console.log('\n=== 单位清单 ===');
  Object.keys(regions).forEach((r) => console.log(r + ' (' + regions[r].length + '): ' + regions[r].map((u) => u.id).join(', ')));

  // ---------- 读全部单位（before / after） ----------
  /**
   * 读一遍全部单位（60px 口径）
   * @returns {Promise<Object>} key → 剪影读数
   */
  const readAll = async () => {
    const out = { player: await ev('__roamDebug.identity.readOne("player", 60)') };
    for (const u of units) {
      out[u.id] = await ev(`__roamDebug.identity.readOne(${JSON.stringify(u.id)}, 60)`);
    }
    return out;
  };
  /**
   * 按"非召唤怪"过滤后的分区读数
   * @param {Object} metrics key → 读数
   * @returns {Object} 三区读数数组
   */
  const regionItems = (metrics) => {
    const out = {};
    ['mech', 'rune', 'void'].forEach((r) => {
      out[r] = regions[r]
        .filter((u) => !u.id.endsWith('grind') && !u.id.endsWith('phantom'))
        .map((u) => Object.assign({ key: u.id }, metrics[u.id] || {}))
        .filter((x) => x.aspect != null);
    });
    return out;
  };
  /**
   * 汇总一组读数：区内剪影/主色最小距离
   * @param {Object} metrics 全部读数
   * @returns {Object} 分区报告
   */
  const buildReport = (metrics) => {
    const items = regionItems(metrics);
    const report = {};
    ['mech', 'rune', 'void'].forEach((r) => {
      const sil = worstPair(items[r], silDist);
      const col = worstPair(items[r], (a, b) => rgbDist(a.accentColor, b.accentColor));
      report[r] = {
        count: items[r].length,
        silMin: sil.min, silWorst: sil.worst, silAll: sil.all,
        colorMin: Number(col.min.toFixed(1)), colorWorst: col.worst, colorAll: col.all
      };
    });
    const reps = ['mech', 'rune', 'void'].map((r) => {
      const u = regions[r][0];
      return u ? Object.assign({ key: u.id, family: r }, metrics[u.id] || {}) : null;
    }).filter((x) => x && x.aspect != null);
    const famItems = [Object.assign({ key: 'player' }, metrics.player || {})].concat(reps);
    const crossSil = worstPair(famItems, silDist);
    const crossCol = worstPair(famItems, (a, b) => rgbDist(a.accentColor, b.accentColor));
    const allItems = [Object.assign({ key: 'player' }, metrics.player || {})]
      .concat(units.map((u) => Object.assign({ key: u.id }, metrics[u.id] || {})))
      .filter((x) => x.aspect != null);
    let pSilMin = Infinity; let pSilWorst = null;
    let pColMin = Infinity; let pColWorst = null;
    allItems.filter((x) => x.key !== 'player').forEach((e) => {
      const ds = silDist(metrics.player, e);
      const dc = rgbDist(metrics.player.accentColor, e.accentColor);
      if (ds < pSilMin) { pSilMin = ds; pSilWorst = e.key; }
      if (dc < pColMin) { pColMin = dc; pColWorst = e.key; }
    });
    return {
      regions: report,
      crossSil, crossCol,
      playerSil: { min: Number(pSilMin.toFixed(3)), worst: pSilWorst },
      playerColor: { min: Number(pColMin.toFixed(1)), worst: pColWorst },
      allSil: worstPair(allItems, silDist),
      allColor: worstPair(allItems, (a, b) => rgbDist(a.accentColor, b.accentColor))
    };
  };

  // ---------- before（关闭逐个体变体） ----------
  await ev('__roamDebug.identity.setEnabled(false)');
  const before = await readAll();
  const repBefore = buildReport(before);

  // ---------- after（开启逐个体变体 + 配色去重） ----------
  await ev('__roamDebug.identity.setEnabled(true)');
  const after = await readAll();
  const repAfter = buildReport(after);

  // ---------- 逐单位读数表 ----------
  const table = [];
  Object.keys(after).forEach((key) => {
    const m = after[key];
    if (!m) { table.push({ key, missing: true }); return; }
    table.push({
      key, art: key === 'player' ? 'player' : (units.find((u) => u.id === key) || {}).art,
      aspect: m.aspect, complexity: m.complexity, fill: m.fill,
      bbox: m.bbox, accent: m.accentColor,
      silVsPrev: before[key] ? Number(silDist(before[key], m).toFixed(3)) : null
    });
  });
  console.log('\n=== 逐单位 60px 读数（after） ===');
  table.forEach((row) => {
    if (row.missing) { console.log(row.key + ' · 绘制失败'); return; }
    console.log(`${row.key.padEnd(14)} ${String(row.art).padEnd(6)} aspect=${row.aspect} cx=${row.complexity} 轮廓占比(fill)=${row.fill} bbox=${row.bbox.w}x${row.bbox.h} 主色=${row.accent.r},${row.accent.g},${row.accent.b}`);
  });

  console.log('\n=== 区内最小距离 before → after ===');
  ['mech', 'rune', 'void'].forEach((r) => {
    console.log(`${r}: 剪影 ${repBefore.regions[r].silMin} → ${repAfter.regions[r].silMin} (${repAfter.regions[r].silWorst})｜主色 ${repBefore.regions[r].colorMin} → ${repAfter.regions[r].colorMin} (${repAfter.regions[r].colorWorst})`);
  });
  console.log(`跨族剪影 ${repBefore.crossSil.min} → ${repAfter.crossSil.min} | 跨族主色 ${repBefore.crossCol.min} → ${repAfter.crossCol.min}`);
  console.log(`玩家 vs 任意敌人：剪影 ${repAfter.playerSil.min} (${repAfter.playerSil.worst})｜主色 ${repAfter.playerColor.min} (${repAfter.playerColor.worst})`);

  // ---------- I1 全单位绘制成功 ----------
  const missing = table.filter((x) => x.missing).map((x) => x.key);
  ok('I1 全部单位 60px 剪影可读（31 个非空）', table.length === 31 && missing.length === 0,
    { total: table.length, missing });

  // ---------- I2 / I3 区内辨别 ----------
  const v = info.verify;
  const silRegion = Object.keys(repAfter.regions).map((r) => ({ region: r, min: repAfter.regions[r].silMin, worst: repAfter.regions[r].silWorst }));
  ok('I2 三区内部每个敌人剪影可辨（min ≥ ' + v.withinRegionSil + '）',
    silRegion.every((x) => x.min >= v.withinRegionSil), silRegion);
  const colRegion = Object.keys(repAfter.regions).map((r) => ({ region: r, min: repAfter.regions[r].colorMin, worst: repAfter.regions[r].colorWorst }));
  ok('I3 三区内部主色不撞车（min ≥ ' + v.withinRegionColor + '）',
    colRegion.every((x) => x.min >= v.withinRegionColor), colRegion);

  // ---------- I4 / I5 跨族 ----------
  ok('I4 玩家 + 三族代表两两剪影可辨（min ≥ ' + v.crossRegionSil + '）',
    repAfter.crossSil.min >= v.crossRegionSil, repAfter.crossSil);
  ok('I5 玩家 + 三族代表两两主色可辨（min ≥ ' + v.crossRegionColor + '）',
    repAfter.crossCol.min >= v.crossRegionColor, repAfter.crossCol);

  // ---------- I6 玩家与任意敌人 ----------
  ok('I6 玩家与任意敌人的剪影/主色均可辨',
    repAfter.playerSil.min >= v.playerMinSil && repAfter.playerColor.min >= v.playerMinColor,
    { sil: repAfter.playerSil, color: repAfter.playerColor, need: { sil: v.playerMinSil, color: v.playerMinColor } });

  // ---------- I7 重绘确实带来可量化提升 ----------
  const beforeWorst = Math.min(...Object.keys(repBefore.regions).map((r) => repBefore.regions[r].silMin));
  const afterWorst = Math.min(...Object.keys(repAfter.regions).map((r) => repAfter.regions[r].silMin));
  ok('I7 重绘让最差剪影对提升 ≥ 0.08',
    afterWorst - beforeWorst >= 0.08,
    { beforeWorst, afterWorst, gain: Number((afterWorst - beforeWorst).toFixed(3) ) });

  // ---------- I8 before / after 对照图 ----------
  const sheetBefore = await ev('__roamDebug.identity.sheet(96)');
  saveSheet('identity-before.png', sheetBefore);
  const sheetAfter = await ev('__roamDebug.identity.sheet(96)');
  saveSheet('identity-after.png', sheetAfter);
  const sameSize = sheetBefore.w === sheetAfter.w && sheetBefore.h === sheetAfter.h;
  ok('I8 before/after 对照图尺寸一致且内容不同',
    sameSize && sheetBefore.dataUrl !== sheetAfter.dataUrl,
    { size: [sheetBefore.w, sheetBefore.h], beforeBytes: sheetBefore.dataUrl.length, afterBytes: sheetAfter.dataUrl.length });

  // ---------- I9 真实同屏：三区敌人 + 玩家 同房间 ----------
  /**
   * 摆好"同屏并排"场景：玩家 + 三区各一只，锁死移速只留绘制
   * @returns {Promise<Object>} 场景快照
   */
  const setupScene = async () => {
    await ev(`(function(){
      window.__roamDebug.clearEnemies();
      var p = state.player;
      p.x = state.rooms[state.currentRoomId] ? state.rooms[state.currentRoomId].cx : p.x;
      p.y = state.rooms[state.currentRoomId] ? state.rooms[state.currentRoomId].cy : p.y;
      return { x: Math.round(p.x), y: Math.round(p.y) };
    })()`);
    await ev(`(function(){
      ['assembler','runesprite','stalker'].forEach(function(id, i){
        window.__roamDebug.spawnThreat(id, 96 + i * 78, -8);
      });
      state.enemies.forEach(function(e){ e.speed = 0; e.vx = 0; e.vy = 0; e.frozenTime = 5; });
      return state.enemies.map(function(e){ return { typeId: e.typeId, x: Math.round(e.x), y: Math.round(e.y) }; });
    })()`);
    await sleep(260);
  };
  await ev('__roamDebug.identity.setEnabled(false)');
  await setupScene();
  await shot('identity-scene-before.png');
  await ev('__roamDebug.identity.setEnabled(true)');
  await setupScene();
  await shot('identity-scene-after.png');
  const sceneAfter = await ev(`(function(){
    return {
      enemies: state.enemies.map(function(e){ return e.typeId; }),
      draws: window.__roamDebug.renderAudit().playerDraws,
      player: { x: Math.round(state.player.x), y: Math.round(state.player.y) }
    };
  })()`);
  ok('I9 同屏并排场景：玩家 + 三区各一只同房间，玩家每帧只画一次',
    (sceneAfter.enemies || []).indexOf('assembler') >= 0
    && (sceneAfter.enemies || []).indexOf('runesprite') >= 0
    && (sceneAfter.enemies || []).indexOf('stalker') >= 0
    && sceneAfter.draws === 1,
  sceneAfter);

  // ---------- 汇总落盘 ----------
  const summary = {
    at: new Date().toISOString(),
    checks: asserts, pass: asserts.filter((c) => c.pass).length, total: asserts.length,
    runtimeErrors, info, units, table,
    before: { report: repBefore, metrics: before },
    after: { report: repAfter, metrics: after },
    sheets: { before: [sheetBefore.w, sheetBefore.h], after: [sheetAfter.w, sheetAfter.h] }
  };
  fs.writeFileSync(path.join(OUT_DIR, 'identity-result.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'identity-metrics.json'), JSON.stringify({ before, after }, null, 2));
  console.log('\nRESULT: ' + (asserts.filter((c) => !c.pass).length === 0 ? 'PASS' : 'FAIL') + '  ' + summary.pass + '/' + summary.total);
  if (runtimeErrors.length) console.log('运行时异常：' + runtimeErrors.slice(0, 3).join(' | '));
  ws.close();
  killEdge(edge);
}

main().catch((err) => {
  console.error('FATAL', err);
  if (typeof killEdge === 'function') { /* 子进程在 profile 钩子里统一清理 */ }
  process.exit(1);
});
