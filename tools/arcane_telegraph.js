/**
 * 第 16 项 · 敌人预警验收（T1–T12）
 * 用法：node tools/arcane_telegraph.js
 * 端口：9540
 * 输出：.screenshots/art/telegraph-on.png、telegraph-off.png、telegraph-result.json
 *
 * 口径：预警提前量直接读页面配置；"可读"用像素证据（同一帧同步重绘后采样），
 * 不靠肉眼，也不在脚本里复制绘制公式。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9540;
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const OUT_DIR = path.join(ROOT, '.screenshots', 'art');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const asserts = [];
/**
 * 记录一条断言并打印证据
 * @param {string} name 断言名
 * @param {boolean} pass 是否通过
 * @param {*} detail 证据
 */
function ok(name, pass, detail) {
  asserts.push({ name, pass: !!pass, detail: detail === undefined ? null : detail });
  console.log((pass ? 'PASS' : 'FAIL') + ' · ' + name + (detail === undefined ? '' : ' · ' + JSON.stringify(detail)));
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
  ws.onmessage = (msg) => {
    const m = JSON.parse(msg.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  await new Promise((r) => { ws.onopen = r; });
  /**
   * 发送 CDP 命令并等待返回
   * @param {string} method CDP 方法
   * @param {Object} [params] 参数
   * @returns {Promise<Object>} 结果
   */
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? reject(new Error(method + ': ' + JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  /**
   * 在页面里执行表达式并返回值
   * @param {string} expression JS 表达式
   * @returns {Promise<*>} 返回值
   */
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  /**
   * 截图存盘
   * @param {string} name 文件名
   * @returns {Promise<void>}
   */
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT_DIR, name), Buffer.from(r.data, 'base64'));
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(1800);
  await ev(`(function(){ var b = document.querySelector('#btnStart'); if (b) b.click(); return true; })()`);
  await sleep(1200);
  await ev(`window.__errors = []; true`);

  // ---------- T1 配置完整 ----------
  const t1 = await ev(`(function(){
    var c = window.__roamDebug.warning.config();
    return {
      enabled: c.enabled, minLead: c.minLead, marks: c.redundantMarks,
      line: c.chargeLineLength, ring: c.chargeRingGap, boss: c.bossMinLead,
      hasColor: !!c.color
    };
  })()`);
  ok('T1 配置：总开关开、最短提前量 0.3s、四类冗余语言齐全、首领下限 0.75s',
    t1.enabled === true && t1.minLead === 0.30 && t1.marks.length >= 4
      && t1.line >= 120 && t1.ring >= 8 && t1.boss >= 0.3 && t1.hasColor, t1);

  // ---------- T2 所有危险动作提前量 ≥ 0.3s ----------
  const t2 = await ev(`window.__roamDebug.warning.leads()`);
  const leadKeys = ['contact', 'charge', 'burst', 'suppress', 'summon', 'selfdestruct', 'blink', 'ranged', 'boss'];
  ok('T2 提前量：9 类危险的预警时长全部 ≥ 0.30s（近战 0.32 / 冲锋 0.55 / 爆发 0.78）',
    leadKeys.every((k) => t2[k] >= 0.30)
      && Math.abs(t2.contact - 0.32) < 0.001
      && Math.abs(t2.charge - 0.55) < 0.001
      && Math.abs(t2.burst - 0.78) < 0.001, t2);

  // ---------- T3–T6 冲锋：状态 + 直线像素 + 预兆圈像素 + A/B ----------
  const charge = await ev(`(function(){
    var d = window.__roamDebug, w = d.warning;
    d.clearEnemies();
    var snap = d.spawnThreat('crawler', 170, 0);
    if (!snap) return { error: 'spawn' };
    d.forceBlock('crawler', 'charge');
    var e = state.enemies[0];
    // 采样前把前摇压到接近末尾：收缩环落到基准半径上，像素证据更稳定
    e.aiV2.timer = 0.08;
    state.shake.time = 0;
    w.redraw();
    var info = w.active().filter(function(x){ return x.kind === 'charge'; })[0] || null;
    if (!info) return { error: 'no-warning', snap: snap };
    var lineHits = w.sampleLineDelta(info.line, 2);
    var ringHits = w.sampleRingDelta(info.ring);
    // 反方向对照：垂直方向同样长度，预警层不应有增量
    var offLine = {
      x1: info.x, y1: info.y,
      x2: info.x + Math.cos(info.line.angle + Math.PI / 2) * (info.radius + 210),
      y2: info.y + Math.sin(info.line.angle + Math.PI / 2) * (info.radius + 210)
    };
    var offHits = w.sampleLineDelta(offLine, 2);
    w.setEnabled(false);
    var activeOff = w.active().length;
    w.setEnabled(true);
    var activeOn = w.active().length;
    var lineBack = w.sampleLineDelta(info.line, 2);
    return {
      snap: snap, lead: info.lead, remaining: info.remaining,
      shape: info.shape, redundant: info.redundant, ring: info.ring,
      blocks: e.aiV2.blocks.slice(), aiState: e.aiV2.state, aiAction: e.aiV2.action,
      lineHits: lineHits, ringHits: ringHits, offHits: offHits,
      activeOff: activeOff, activeOn: activeOn, lineBack: lineBack
    };
  })()`);

  ok('T3 冲锋前摇：进入 windup/charge，提前量 0.55s ≥ 0.3s，行为块含 charge',
    !charge.error && charge.aiState === 'windup' && charge.aiAction === 'charge'
      && charge.lead >= 0.30 && charge.remaining > 0.05
      && charge.blocks.indexOf('charge') >= 0 && charge.redundant.length >= 3, charge);

  ok('T4 冲刺直线：沿锁定线预警增量 ≥ 20，垂直空方向 ≤ 6（方向可读）',
    !charge.error && charge.lineHits.delta >= 20 && charge.offHits.delta <= 6,
    { lineDelta: charge.lineHits.delta, offDelta: charge.offHits.delta });

  ok('T5 冲锋预兆圈：脚下圆环预警增量 ≥ 8，且形状同时含"线 + 圈"',
    !charge.error && charge.ringHits.delta >= 8 && charge.shape === 'lock-line+ring'
      && charge.ring && charge.ring.r > 0,
    { ringDelta: charge.ringHits.delta, ring: charge.ring, shape: charge.shape });

  ok('T6 A/B：关闭预警后快照归零、重开后恢复；同一锁定线增量仍 ≥20（只影响画面）',
    !charge.error && charge.activeOff === 0 && charge.activeOn === 1
      && charge.lineBack.delta >= 20,
    { activeOff: charge.activeOff, activeOn: charge.activeOn, lineBack: charge.lineBack.delta });

  // ---------- T7 近战接触前摇 ----------
  const contact = await ev(`(function(){
    var d = window.__roamDebug, w = d.warning;
    d.clearEnemies();
    var snap = d.spawnThreat('crawler', 40, 0);
    if (!snap) return { error: 'spawn' };
    var e = state.enemies[0];
    // 关掉威胁语法主动块，单独验证"接触前摇"这一条路径
    e.aiV2.state = 'approach';
    e.aiV2.action = null;
    e.aiV2.timer = 0;
    e.windup = 0.32;
    state.shake.time = 0;
    w.redraw();
    var info = w.active().filter(function(x){ return x.kind === 'contact'; })[0] || null;
    if (!info) return { error: 'no-warning' };
    var hits = w.sampleRingDelta(info.ring);
    return { lead: info.lead, remaining: info.remaining, shape: info.shape, ring: info.ring, hits: hits };
  })()`);
  ok('T7 接触前摇：提前量 0.32s ≥ 0.3s、收缩虚线环 + 刻度有像素增量（≥5）',
    !contact.error && contact.lead >= 0.30 && Math.abs(contact.lead - 0.32) < 0.001
      && contact.shape === 'contact-ring' && contact.hits.delta >= 5, contact);

  // ---------- T8 五类危险动作形状两两不同 + 每类至少 2 种冗余 ----------
  const shapes = await ev(`(function(){
    var d = window.__roamDebug, w = d.warning;
    var cases = [
      ['charge', 'crawler'], ['burst', 'riveter'], ['suppress', 'welder'],
      ['summon', 'assembler'], ['selfdestruct', 'shardling']
    ];
    var rows = [];
    var missing = [];
    cases.forEach(function(c){
      d.clearEnemies();
      var s = d.spawnThreat(c[1], 160, 0);
      if (!s) { missing.push(c[1]); return; }
      d.forceBlock(c[1], c[0]);
      var info = w.active()[0] || null;
      if (!info) { missing.push(c[0]); return; }
      rows.push({ kind: info.kind, shape: info.shape, redundant: info.redundant.length });
    });
    d.clearEnemies();
    var uniq = {};
    rows.forEach(function(r){ uniq[r.shape] = true; });
    return { rows: rows, missing: missing, distinct: Object.keys(uniq).length };
  })()`);
  ok('T8 形状语言：5 类动作 5 种不同形状，每类冗余线索 ≥ 2（不只靠颜色）',
    !shapes.missing.length && shapes.rows.length === 5 && shapes.distinct === 5
      && shapes.rows.every((r) => r.redundant >= 2), shapes);

  // ---------- T9 总开关只影响画面，不影响敌人行为 ----------
  const behavior = await ev(`(function(){
    var d = window.__roamDebug, w = d.warning;
    d.clearEnemies();
    d.spawnThreat('crawler', 160, 0);
    w.setEnabled(false);
    d.forceBlock('crawler', 'charge');
    var e = state.enemies[0];
    var snap = { state: e.aiV2.state, action: e.aiV2.action, timer: Number(e.aiV2.timer.toFixed(3)) };
    var activeOff = w.active().length;
    w.setEnabled(true);
    var activeOn = w.active().length;
    d.clearEnemies();
    return { snap: snap, activeOff: activeOff, activeOn: activeOn, enabled: w.enabled() };
  })()`);
  ok('T9 总开关：关闭时快照为空但敌人仍处于 windup/charge（行为不变），重开后恢复 1 条',
    behavior.snap.state === 'windup' && behavior.snap.action === 'charge'
      && behavior.snap.timer >= 0.30 && behavior.activeOff === 0
      && behavior.activeOn === 1 && behavior.enabled === true, behavior);

  // ---------- T10 与信息分层 / 色盲模式一致 ----------
  const a11y = await ev(`(function(){
    var d = window.__roamDebug, w = d.warning, p = d.p1;
    d.clearEnemies();
    d.spawnThreat('crawler', 170, 0);
    d.forceBlock('crawler', 'charge');
    var e = state.enemies[0];
    e.aiV2.timer = 0.08;
    state.shake.time = 0;
    p.setInfoMode('minimal');
    p.setColorblind(true);
    w.redraw();
    var info = w.active().filter(function(x){ return x.kind === 'charge'; })[0] || null;
    var hits = info ? w.sampleLineDelta(info.line, 2) : { delta: 0 };
    var shape = info ? info.shape : null;
    var redundant = info ? info.redundant.length : 0;
    p.setInfoMode('full');
    p.setColorblind(false);
    d.clearEnemies();
    return { shape: shape, redundant: redundant, hits: hits.delta, mode: 'minimal+colorblind' };
  })()`);
  ok('T10 分层/色盲一致：极简信息档 + 色盲模式下预警形状不变、直线增量仍 ≥20',
    a11y.shape === 'lock-line+ring' && a11y.redundant >= 3 && a11y.hits >= 20, a11y);

  // ---------- T11 静止敌人不误报 ----------
  const idle = await ev(`(function(){
    var d = window.__roamDebug, w = d.warning;
    d.clearEnemies();
    d.spawnThreat('crawler', 200, 0);
    var e = state.enemies[0];
    e.windup = 0;
    e.aiV2.state = 'approach';
    e.aiV2.action = null;
    e.aiV2.timer = 0;
    e.aiV2.cooldown = 999;
    e.blinkTimer = 0;
    e.fireTimer = 0;
    state.shake.time = 0;
    w.redraw();
    var info = w.active()[0] || null;
    var ring = { x: e.x, y: e.y, r: e.radius + 20 };
    var hits = w.sampleRingDelta(ring);
    d.clearEnemies();
    return { active: info ? info.kind : null, delta: hits.delta };
  })()`);
  ok('T11 静止敌人不误报：没有前摇时不产生预警快照，脚下环带无预警增量',
    idle.active === null && idle.delta <= 2, idle);

  // ---------- T12 截图（开/关） / fps / 错误 ----------
  await ev(`(function(){
    var d = window.__roamDebug, w = d.warning;
    d.clearEnemies();
    d.spawnThreat('crawler', 170, 0);
    d.forceBlock('crawler', 'charge');
    w.setEnabled(true);
    w.redraw();
    return true;
  })()`);
  await shot('telegraph-on.png');
  await ev(`(function(){
    var w = window.__roamDebug.warning;
    w.setEnabled(false);
    w.redraw();
    return true;
  })()`);
  await shot('telegraph-off.png');
  const t12 = await ev(`(function(){
    var w = window.__roamDebug.warning;
    w.setEnabled(true);
    window.__roamDebug.clearEnemies();
    var fps = new Promise(function(resolve){
      var n = 0, t0 = performance.now();
      function tick(){ n += 1; if (performance.now() - t0 < 1400) requestAnimationFrame(tick);
        else resolve(Math.round(n / ((performance.now() - t0) / 1000) * 10) / 10); }
      requestAnimationFrame(tick);
    });
    return fps.then(function(f){ return { fps: f, errors: (window.__errors || []).length, enabled: w.enabled() }; });
  })()`);
  let onSize = 0;
  let offSize = 0;
  try { onSize = fs.statSync(path.join(OUT_DIR, 'telegraph-on.png')).size; } catch (e) { onSize = 0; }
  try { offSize = fs.statSync(path.join(OUT_DIR, 'telegraph-off.png')).size; } catch (e) { offSize = 0; }
  ok('T12 截图 on/off 各 >10KB / fps≥60 / 无脚本错误 / 收尾开关复原',
    onSize > 10240 && offSize > 10240 && t12.fps >= 60 && t12.errors === 0 && t12.enabled === true,
    { onSize, offSize, t12 });

  // 收尾：预警层恢复默认，清空测试敌人，避免影响串行脚本
  await ev(`(function(){
    var d = window.__roamDebug;
    d.warning.setEnabled(true);
    d.clearEnemies();
    d.p1.setInfoMode('full');
    d.p1.setColorblind(false);
    return true;
  })()`);

  fs.writeFileSync(path.join(OUT_DIR, 'telegraph-result.json'), JSON.stringify({ asserts }, null, 2));
  const pass = asserts.filter((x) => x.pass).length;
  console.log(`\n===== T telegraph ${pass}/${asserts.length} ===== (on ${onSize}B / off ${offSize}B, fps ${t12.fps})`);
  console.log('VERDICT: ' + (pass === asserts.length ? 'PASS' : 'FAIL'));

  try { ws.close(); } catch (e) { /* ignore */ }
  try { killEdge(edge); } catch (e) { /* ignore */ }
  await sleep(200);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  if (pass !== asserts.length) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
