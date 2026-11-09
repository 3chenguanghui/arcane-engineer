/**
 * 第 14 项 · 挑战等级 1–10 验收（CL1–CL13）
 * 用法：node tools/arcane_challengelevels.js
 * 端口：9531
 * 输出：.screenshots/art/challengelevels.png、challengelevels-result.json
 *
 * 口径：所有“逐级比对”都用 challengeLv.metrics 在同一颗种子、同一层生成临时局，
 * 只改挑战等级；不复制倍率逻辑，测的就是玩家实际会遇到的数值。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9531;
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

  // ---------- CL1 配置 ----------
  const cl1 = await ev(`window.__roamDebug.challengeLv.info()`);
  const levelIds = cl1.levels.map((l) => l.id);
  ok('CL1 十级配置：maxLevel=10、每级 rule/short 非空、1–4 级 id 保持旧进阶',
    cl1.enabled === true && cl1.maxLevel === 10 && cl1.levels.length === 10
      && levelIds.slice(0, 4).join(',') === 'swarm,affix,toll,third'
      && cl1.levels.every((l) => l.rule.length > 6 && l.short.length > 3)
      && cl1.displayName === '挑战等级', cl1);

  // ---------- CL2 未解锁夹紧 / 解锁 / 回退 ----------
  const cl2 = await ev(`(function(){
    var c = window.__roamDebug.challengeLv;
    c.set(0);
    var before = c.set(5);              // 未解锁 → 夹回 0
    var unlocked = c.unlock(10);        // 真实解锁上限
    var at7 = c.set(7);                 // 选中 7
    var stored = JSON.parse(localStorage.getItem(GAME_CONFIG.metaKey) || '{}');
    var back = c.set(0);                // 回退 0
    var storedBack = JSON.parse(localStorage.getItem(GAME_CONFIG.metaKey) || '{}');
    return { before: before, unlocked: unlocked, at7: at7,
      storedU: stored.ascensionUnlocked, storedC: stored.ascension,
      back: back, storedBack: storedBack.ascension };
  })()`);
  ok('CL2 未解锁夹回 0、解锁到 10、可选 7 并持久化、回退 0 一致',
    cl2.before.current === 0 && cl2.unlocked === 10 && cl2.at7.current === 7
      && cl2.storedU === 10 && cl2.storedC === 7
      && cl2.back.current === 0 && cl2.storedBack === 0, cl2);

  // ---------- CL3 1–4 级旧规则不回归 ----------
  // F2 的战斗房数量 3 未顶到 enemyCountCap，能真实观测“每间 +1”；
  // 精英房在 F8 处观测（F2 的精英路线房叠了 1.4× 数量倍率，不适合做 1:1 证据）。
  // 统计口径用“房间计划敌数”，排除走廊巡逻怪（roomId=-2 不属于任何房间）。
  await ev(`window.__roamDebug.challengeLv.set(0)`);
  const m20 = await ev(`window.__roamDebug.challengeLv.metrics(2, 0)`);
  const m21 = await ev(`window.__roamDebug.challengeLv.metrics(2, 1)`);
  const e80 = await ev(`window.__roamDebug.challengeLv.metrics(8, 0)`);
  const e81 = await ev(`window.__roamDebug.challengeLv.metrics(8, 1)`);
  const cl3a = { battleDelta: m21.battleRoomEnemies - m20.battleRoomEnemies, battleRooms: m20.battleRooms,
    eliteDelta: e81.eliteRoomEnemies - e80.eliteRoomEnemies, eliteRooms: e80.eliteRooms,
    trace: m20.roomTrace + ' || ' + m21.roomTrace };
  ok('CL3a 挑战 1「敌潮」：战斗房与精英房各 +1 敌人',
    cl3a.battleRooms > 0 && cl3a.battleDelta === cl3a.battleRooms
      && cl3a.eliteRooms > 0 && cl3a.eliteDelta === cl3a.eliteRooms, cl3a);

  const m82 = await ev(`window.__roamDebug.challengeLv.metrics(8, 2)`);
  const cl3b = { elites: m82.elites, affix2: m82.eliteAffix2 };
  ok('CL3b 挑战 2「精英强化」：全部精英带第 2 条词缀',
    m82.elites > 0 && m82.eliteAffix2 === m82.elites, cl3b);

  const cl3c = await ev(`(function(){
    var c = window.__roamDebug.challengeLv;
    c.set(2);
    var c2 = eventSacrificeCost();
    var w2 = ascensionWagerChance();
    var curse2 = eventCursePerFloor();
    c.set(3);
    return { c2: c2, c3: eventSacrificeCost(), w2: w2, w3: ascensionWagerChance(),
      curse2: curse2, curse3: eventCursePerFloor(), text: eventWagerChanceText() };
  })()`);
  ok('CL3c 挑战 3「代价加重」：献祭代价 ×1.5、赌注 −8%、诅咒更痛',
    cl3c.c3 > cl3c.c2 && cl3c.w3 < cl3c.w2 && cl3c.curse3 >= cl3c.curse2, cl3c);

  const cl3d = await ev(`(function(){
    var c = window.__roamDebug.challengeLv;
    c.set(3);
    window.__roamDebug.execute.spawn('boss', 1);
    var b = state.enemies.find(function(e){ return e.isBoss; });
    b.phase2 = true; b.phase = 2;       // 先进入二阶段，才允许判定三阶段
    enterBossPhase3(b);
    var at3 = !!(b && b.phase3);
    c.set(4);
    window.__roamDebug.execute.spawn('boss', 1);
    var b2 = state.enemies.find(function(e){ return e.isBoss; });
    b2.phase2 = true; b2.phase = 2;
    var dmgBefore = b2.damage;
    enterBossPhase3(b2);
    return { at3: at3, at4: !!(b2 && b2.phase3), phase: b2 ? b2.phase : null,
      dmgBefore: dmgBefore, dmgAfter: b2 ? b2.damage : 0 };
  })()`);
  ok('CL3d 挑战 4「首领三阶段」：仅 4 级生效且伤害提升',
    cl3d.at3 === false && cl3d.at4 === true && cl3d.phase === 3 && cl3d.dmgAfter > cl3d.dmgBefore, cl3d);

  // ---------- CL4 挑战 5「疾行」 ----------
  const m84 = await ev(`window.__roamDebug.challengeLv.metrics(8, 4)`);
  const m85 = await ev(`window.__roamDebug.challengeLv.metrics(8, 5)`);
  const ratio85 = m84.avgSpeed > 0 ? m85.avgSpeed / m84.avgSpeed : 0;
  ok('CL4 挑战 5「疾行」：敌均速 ×1.10（±2%）',
    ratio85 >= 1.08 && ratio85 <= 1.12, { lv4: m84.avgSpeed, lv5: m85.avgSpeed, ratio: Math.round(ratio85 * 1000) / 1000 });

  // ---------- CL5 挑战 6「硬化」 ----------
  const d5 = await ev(`window.__roamDebug.challengeLv.damageProbe(5)`);
  const d6 = await ev(`window.__roamDebug.challengeLv.damageProbe(6)`);
  const ratio86 = d5.dealt > 0 ? d6.dealt / d5.dealt : 0;
  ok('CL5 挑战 6「硬化」：同一发伤害 ×0.88（±2%）',
    d5.ok && d6.ok && ratio86 >= 0.86 && ratio86 <= 0.90,
    { lv5: d5.dealt, lv6: d6.dealt, ratio: Math.round(ratio86 * 1000) / 1000 });

  // ---------- CL6 挑战 7「壁垒」 ----------
  const m86 = await ev(`window.__roamDebug.challengeLv.metrics(8, 6)`);
  const m87 = await ev(`window.__roamDebug.challengeLv.metrics(8, 7)`);
  const shieldDelta = m87.eliteShield - m86.eliteShield;
  const expectShield = Math.round(m86.eliteHp * 0.15);
  ok('CL6 挑战 7「壁垒」：精英额外护盾 ≈ 15% 精英总血（±4%）',
    m87.elites > 0 && shieldDelta > 0 && Math.abs(shieldDelta - expectShield) <= Math.max(10, expectShield * 0.04),
    { elites: m87.elites, lv6Shield: m86.eliteShield, lv7Shield: m87.eliteShield, delta: shieldDelta, expect: expectShield });

  // ---------- CL7 挑战 8「高压」 ----------
  // 接触伤害基数只有 3–6，单只四舍五入会把 +12% 抹成 +0/+25%，
  // 因此取 F15 全房均伤：构成在 7→8 级不变（只有伤害倍率变化），均值足以分辨 12%。
  const m157 = await ev(`window.__roamDebug.challengeLv.metrics(15, 7)`);
  const m158 = await ev(`window.__roamDebug.challengeLv.metrics(15, 8)`);
  const ratio88 = m157.avgDamage > 0 ? m158.avgDamage / m157.avgDamage : 0;
  ok('CL7 挑战 8「高压」：F15 敌均接触伤害 ×1.12（±4%，含小整数取整误差）',
    m157.enemies === m158.enemies && ratio88 >= 1.08 && ratio88 <= 1.16,
    { lv7: m157.avgDamage, lv8: m158.avgDamage, ratio: Math.round(ratio88 * 1000) / 1000 });

  // ---------- CL8 挑战 9「围猎」 ----------
  const m88 = await ev(`window.__roamDebug.challengeLv.metrics(8, 8)`);
  const m89 = await ev(`window.__roamDebug.challengeLv.metrics(8, 9)`);
  const delta9 = m89.eliteRoomEnemies - m88.eliteRoomEnemies;
  ok('CL8 挑战 9「围猎」：精英房每间再 +1 名敌人',
    m88.eliteRooms > 0 && delta9 === m88.eliteRooms,
    { rooms: m88.eliteRooms, lv8: m88.eliteRoomEnemies, lv9: m89.eliteRoomEnemies, delta: delta9 });

  // ---------- CL9 挑战 10「终局」 ----------
  const b9 = await ev(`window.__roamDebug.challengeLv.metrics(6, 9)`);
  const b10 = await ev(`window.__roamDebug.challengeLv.metrics(6, 10)`);
  const ratioBoss = b9.bossHpMax > 0 ? b10.bossHpMax / b9.bossHpMax : 0;
  ok('CL9 挑战 10「终局」：首领最大生命 ×1.25（±2%）',
    ratioBoss >= 1.23 && ratioBoss <= 1.27, { lv9: b9.bossHpMax, lv10: b10.bossHpMax, ratio: Math.round(ratioBoss * 1000) / 1000 });

  // ---------- CL10 全区域可用（机械 / 符文 / 虚空 / 深度） ----------
  const areas = await ev(`(function(){
    var c = window.__roamDebug.challengeLv;
    return [1, 8, 15, 20, 25].map(function(f){
      var easy = c.metrics(f, 0, 'easy');
      var hard = c.metrics(f, 0, 'nightmare');
      var base = c.metrics(f, 0, 'normal');
      var s4 = c.metrics(f, 4);        // 4→5 只改速度倍率，敌人构成完全一致
      var s5 = c.metrics(f, 5);
      return { floor: f, baseHp: base.totalHp, easyHp: easy.totalHp, hardHp: hard.totalHp,
        diffRatio: base.totalHp > 0 ? Math.round(hard.totalHp / base.totalHp * 100) / 100 : 0,
        lv4Speed: s4.avgSpeed, lv5Speed: s5.avgSpeed,
        speedRatio: s4.avgSpeed > 0 ? Math.round(s5.avgSpeed / s4.avgSpeed * 100) / 100 : 0 };
    });
  })()`);
  // F1 是教学层（G 批固定标准难度），三档难度指标只要求 F8 起的四大区 / 深度；
  // 挑战等级（挑战 5 的 +10% 速度）必须在每一层生效，包括 F1。
  const difficultyOk = areas.filter((x) => x.floor >= 8)
    .every((x) => x.diffRatio >= 1.05);
  const challengeOk = areas.every((x) => x.speedRatio >= 1.08 && x.speedRatio <= 1.12);
  ok('CL10 三档难度（F8+）与挑战 5（F1/F8/F15/F20/F25）全部生效（无“某大区没难度”）',
    difficultyOk && challengeOk, areas);

  // ---------- CL11 局内快照携带挑战等级 ----------
  const cl11 = await ev(`(function(){
    var p = window.__roamDebug.p2;
    var c = window.__roamDebug.challengeLv;
    c.set(7);
    p.saveNow(1);
    var slot = p.slotInfo(1);
    var data = p.slotData(1);
    c.set(0);
    p.loadSlot(1);
    var after = p.info().ascension.current;
    return { slotAsc: slot ? slot.ascension : null, dataAsc: data ? data.ascension : null, after: after };
  })()`);
  ok('CL11 局内存档含挑战等级 7，读回仍为 7',
    cl11.slotAsc === 7 && cl11.dataAsc === 7 && cl11.after === 7, cl11);

  // ---------- CL12 结算行 + 档案留档 ----------
  const cl12 = await ev(`(function(){
    var c = window.__roamDebug.challengeLv;
    c.set(7);
    var a = c.recordClear(7);
    var b = c.recordClear(7);
    var stored = JSON.parse(localStorage.getItem(GAME_CONFIG.metaKey) || '{}');
    return { first: a.count, second: b.count, html: c.resultHtml(),
      storedCount: stored.challengeCleared ? stored.challengeCleared['7'] : null,
      schema: stored.version };
  })()`);
  ok('CL12 结算页显示“挑战等级 7 级”，档案 challengeCleared["7"] 累计并持久化',
    cl12.first === 1 && cl12.second === 2 && cl12.storedCount === 2 && cl12.schema === 9
      && cl12.html.indexOf('挑战等级') >= 0 && cl12.html.indexOf('7 级') >= 0, cl12);

  // ---------- CL13 总开关关闭零差异 ----------
  const cl13 = await ev(`(function(){
    var c = window.__roamDebug.challengeLv;
    c.setEnabled(true);
    var base = c.metrics(8, 0);
    var top = c.metrics(8, 10);
    c.setEnabled(false);
    var off = c.metrics(8, 10);
    var offInfo = c.info();
    var hidden = document.getElementById('ascensionModes').classList.contains('hidden');
    c.setEnabled(true);
    return { base: base.enemies + '/' + base.totalHp + '/' + base.avgSpeed,
      top: top.enemies + '/' + top.totalHp + '/' + top.avgSpeed,
      off: off.enemies + '/' + off.totalHp + '/' + off.avgSpeed,
      offCurrent: offInfo.current, hidden: hidden };
  })()`);
  ok('CL13 关闭开关：等级恒 0、指标回到基线、标题行隐藏（重开恢复）',
    cl13.base === cl13.off && cl13.offCurrent === 0 && cl13.hidden === true
      && cl13.top !== cl13.base, cl13);

  // ---------- CL14 截图 / fps / 错误 ----------
  await ev(`window.__roamDebug.challengeLv.set(3); true`);
  await sleep(700);
  await shot('challengelevels.png');
  const cl14 = await ev(`(function(){
    var fps = new Promise(function(resolve){
      var n = 0, t0 = performance.now();
      function tick(){ n += 1; if (performance.now() - t0 < 1400) requestAnimationFrame(tick);
        else resolve(Math.round(n / ((performance.now() - t0) / 1000) * 10) / 10); }
      requestAnimationFrame(tick);
    });
    return fps.then(function(f){ return { fps: f, errors: (window.__errors || []).length }; });
  })()`);
  let shotSize = 0;
  try { shotSize = fs.statSync(path.join(OUT_DIR, 'challengelevels.png')).size; } catch (e) { shotSize = 0; }
  ok('CL14 截图 >10KB / fps≥60 / 无脚本错误',
    shotSize > 10240 && cl14.fps >= 60 && cl14.errors === 0, { shot: shotSize, cl14 });

  // 收尾：把挑战等级归零，避免影响后续串行脚本
  await ev(`window.__roamDebug.challengeLv.set(0); true`);

  fs.writeFileSync(path.join(OUT_DIR, 'challengelevels-result.json'), JSON.stringify({ asserts }, null, 2));
  const pass = asserts.filter((x) => x.pass).length;
  console.log(`\n===== CL challengelevels ${pass}/${asserts.length} ===== (shot ${shotSize}B, fps ${cl14.fps})`);

  try { ws.close(); } catch (e) { /* ignore */ }
  try { killEdge(edge); } catch (e) { /* ignore */ }
  await sleep(200);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  if (pass !== asserts.length) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
