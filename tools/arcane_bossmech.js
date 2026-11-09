/**
 * 第 25 项 · 大区专属首领机制专项断言（端口 9582）
 * ------------------------------------------------------------
 * 验证三件事：
 *   B1 配置：三大区（mech/rune/void）各有 phase1 / phase2，6 个机制 id 互不相同，
 *          tell 非空、预警窗口 ≥0.5s，且各有"转换信号"文案；
 *   B2–B4 一阶段机制：机械核心过载 / 符文三连刻印 / 虚空单引力井 真实可触发；
 *   B5–B7 二阶段机制 + 转换信号：50% 血自动切形态，无敌 ≥1.0s，
 *          机械=护甲熔毁+熔渣、符文=四枚逆序刻印、虚空=双生井（第二口带 pull）；
 *   B8 HUD / 调试快照能读到当前阶段名，证明玩家和验收脚本都"看得见"。
 * 用法：node tools/arcane_bossmech.js
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9582;
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const OUT_DIR = path.join(ROOT, '.screenshots', 'bossmech');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const asserts = [];
/** 本次启动的 Edge 进程（脚本结束/报错都要连同子树一起结束，避免残留占端口与 profile） */
let edgeProc = null;
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
 * 主流程：无头 Edge → 逐项采集证据 → 写 result.json
 * @returns {Promise<void>}
 */
async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const profile = prepareProfile();
  edgeProc = spawn(EDGE, [
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

  // ---------- 页面内实验台：走真实 spawnBoss / updateBossEnemy / updateBossSignature ----------
  await ev(`(function(){
    window.__mechLab = {
      spawn: function(floor) {
        state.player.x = 900; state.player.y = 600;
        state.player.hp = state.player.hpMax || 100;
        state.player.invuln = 0; state.player.shield = 0;
        state.enemies.length = 0; state.bullets.length = 0;
        state.projectiles.length = 0; state.aoeZones.length = 0; state.mines.length = 0;
        state.boss = null;
        var room = { id: 0, type: 'boss', x: 200, y: 200, w: 600, h: 400, cx: 500, cy: 400 };
        var boss = spawnBoss(room, floor);
        state.boss.started = true; state.boss.intro = false; state.boss.transition = 0;
        boss.started = true; boss.intro = false; boss.invulnTimer = 0; boss.sigTimer = 0;
        return boss;
      },
      conf: function(boss) {
        return BOSS_CONFIG.kinds.find(function(k){ return k.id === boss.bossKind; });
      },
      haz: function() {
        return state.boss.hazards.map(function(h){
          return { reversed: !!h.reversed, total: Number((h.total || 0).toFixed(2)),
            well: !!h.well, pull: h.pull || 0, molten: !!h.molten };
        });
      },
      p1: function(floor) {
        var boss = this.spawn(floor);
        var conf = this.conf(boss);
        boss.sigTimer = 0; boss.telegraph = null;
        updateBossSignature(boss, conf, 0.016);
        return {
          kind: boss.bossKind, mechPhase: boss.mechPhase,
          tg: boss.telegraph ? { kind: boss.telegraph.kind, coreAfter: boss.telegraph.coreAfter || 0,
            pull: boss.telegraph.pull || 0 } : null,
          hazards: this.haz()
        };
      },
      p2: function(floor) {
        var boss = this.spawn(floor);
        var conf = this.conf(boss);
        state.boss.fightTime = 5;
        boss.hp = boss.hpMax * 0.49;
        updateBossEnemy(boss, 0.016);
        var info = {
          kind: boss.bossKind, phase2: !!boss.phase2, mechPhase: boss.mechPhase,
          name: boss.mechName, tell: boss.mechTell,
          invuln: Number((boss.invulnTimer || 0).toFixed(3)),
          signalLine: state.boss.signalLine, signalAt: state.boss.signalAt,
          lineText: state.boss.line ? state.boss.line.text : null,
          armorBroken: !!boss.armorBroken, coreOpen: Number((boss.coreOpen || 0).toFixed(2))
        };
        state.boss.hazards.length = 0;
        boss.sigTimer = 0; boss.telegraph = null;
        if (boss.bossKind === 'mech') {
          resolveBossTelegraph(boss, conf, { kind: 'slam', x: boss.x, y: boss.y, radius: 100 });
        } else {
          updateBossSignature(boss, conf, 0.016);
        }
        var tg = boss.telegraph;
        return {
          info: info,
          tg: tg ? { kind: tg.kind, pull: tg.pull || 0 } : null,
          hazards: this.haz(),
          snap: bossDebugSnapshot()
        };
      }
    };
    return true;
  })()`);

  // ============================================================
  // B1：配置形状 + 大区归属
  // ============================================================
  const b1 = await ev(`(function(){
    var cfg = REGION_BOSS_MECH_CONFIG;
    var kinds = cfg.kinds;
    var ids = [];
    var detail = {};
    var ok = true;
    ['mech','rune','void'].forEach(function(k){
      var kk = kinds[k];
      detail[k] = { p1: kk.phase1.id, p2: kk.phase2.id,
        tell1: kk.phase1.tell.length, tell2: kk.phase2.tell.length,
        signal: kk.signal, window1: kk.phase1.window, window2: kk.phase2.window };
      if (!kk || !kk.phase1 || !kk.phase2) { ok = false; return; }
      if (kk.phase1.id === kk.phase2.id) ok = false;
      if (!kk.phase1.tell || !kk.phase2.tell) ok = false;
      if (!kk.signal || !kk.signalLine) ok = false;
      if ((kk.phase1.window || 0) < 0.5 || (kk.phase2.window || 0) < 0.5) ok = false;
      ids.push(kk.phase1.id, kk.phase2.id);
    });
    return {
      ok: ok,
      detail: detail,
      unique: ids.filter(function(v,i){ return ids.indexOf(v) === i; }).length,
      total: ids.length,
      regionBoss: {
        f6: regionOf(6).boss, f12: regionOf(12).boss, f18: regionOf(18).boss
      },
      threshold: cfg.phaseThreshold,
      guard: cfg.transitionGuard
    };
  })()`);
  ok('B1 三区各 2 阶段、6 个机制 id 互不相同、tell 非空、窗口 ≥0.5s',
    b1.ok && b1.unique === b1.total && b1.total === 6
      && b1.regionBoss.f6 === 'mech' && b1.regionBoss.f12 === 'rune' && b1.regionBoss.f18 === 'void'
      && b1.threshold === 0.5 && b1.guard >= 1.0,
    b1);

  // ============================================================
  // B2：机械 P1 —— 核心过载（一圈弹 → 核心暴露窗口）
  // ============================================================
  const b2 = await ev(`window.__mechLab.p1(6)`);
  ok('B2 机械一阶段：核心过载预警为 ring，且预告 coreAfter > 0',
    b2.kind === 'mech' && b2.mechPhase === 1
      && b2.tg && b2.tg.kind === 'ring' && b2.tg.coreAfter > 0,
    b2);

  // ============================================================
  // B3：符文 P1 —— 三枚刻印沿射线依次引爆（近→远）
  // ============================================================
  const b3 = await ev(`window.__mechLab.p1(12)`);
  const runeAsc = b3.hazards.length === 3
    && b3.hazards[0].total < b3.hazards[1].total && b3.hazards[1].total < b3.hazards[2].total
    && b3.hazards.every((h) => h.reversed === false);
  ok('B3 符文一阶段：3 枚刻印，正向（近先炸）递增',
    b3.kind === 'rune' && b3.mechPhase === 1 && runeAsc, b3);

  // ============================================================
  // B4：虚空 P1 —— 单引力井（pull = 150）
  // ============================================================
  const b4 = await ev(`window.__mechLab.p1(18)`);
  ok('B4 虚空一阶段：singularity 单井，牵引 150，无第二口井',
    b4.kind === 'void' && b4.mechPhase === 1
      && b4.tg && b4.tg.kind === 'singularity' && b4.tg.pull === 150
      && b4.hazards.length === 0,
    b4);

  // ============================================================
  // B5：机械 P2 —— 50% 血自动切形态 + 护甲熔毁 + 熔渣追猎
  // ============================================================
  const b5 = await ev(`window.__mechLab.p2(6)`);
  const molten = b5.hazards.filter((h) => h.molten).length;
  ok('B5 机械二阶段：自动切形态、无敌 ≥1.0s、护甲熔毁核心常开、震波留 3 处熔渣',
    b5.info.kind === 'mech' && b5.info.phase2 && b5.info.mechPhase === 2
      && b5.info.armorBroken && b5.info.coreOpen > 0
      && b5.info.invuln >= 1.0 && b5.info.signalAt > 0
      && b5.info.lineText && b5.info.lineText.indexOf('核心') >= 0
      && molten === 3,
    { info: b5.info, molten: molten, hazards: b5.hazards });

  // ============================================================
  // B6：符文 P2 —— 刻印逆向（4 枚，远先炸）
  // ============================================================
  const b6 = await ev(`window.__mechLab.p2(12)`);
  const runeDesc = b6.hazards.length === 4
    && b6.hazards.every((h) => h.reversed === true)
    && b6.hazards[0].total > b6.hazards[1].total
    && b6.hazards[1].total > b6.hazards[2].total
    && b6.hazards[2].total > b6.hazards[3].total;
  ok('B6 符文二阶段：4 枚刻印、全部逆序（远先炸）、转换信号含"刻印"',
    b6.info.kind === 'rune' && b6.info.phase2 && b6.info.mechPhase === 2
      && b6.info.invuln >= 1.0 && b6.info.signalAt > 0
      && b6.info.lineText && b6.info.lineText.indexOf('刻印') >= 0
      && runeDesc,
    { info: b6.info, hazards: b6.hazards });

  // ============================================================
  // B7：虚空 P2 —— 双生引力井（第二口井带 pull = 170）
  // ============================================================
  const b7 = await ev(`window.__mechLab.p2(18)`);
  const wells = b7.hazards.filter((h) => h.well);
  ok('B7 虚空二阶段：singularity 牵引 170 + 第二口 well 井（pull 170）',
    b7.info.kind === 'void' && b7.info.phase2 && b7.info.mechPhase === 2
      && b7.info.invuln >= 1.0 && b7.info.signalAt > 0
      && b7.info.lineText && b7.info.lineText.indexOf('中心') >= 0
      && b7.tg && b7.tg.pull === 170
      && wells.length === 1 && wells[0].pull === 170,
    { info: b7.info, tg: b7.tg, hazards: b7.hazards });

  // ============================================================
  // B8：HUD / 快照可读阶段名（玩家与脚本都"看得见"当前机制）
  // ============================================================
  const b8 = await ev(`(function(){
    var boss = window.__mechLab.spawn(6);
    var conf = window.__mechLab.conf(boss);
    state.boss.fightTime = 5;
    boss.hp = boss.hpMax * 0.49;
    updateBossEnemy(boss, 0.016);
    var before = window.__errors.length;
    try { drawBossHud(); } catch (e) { window.__errors.push('hud:' + e.message); }
    var snap = bossDebugSnapshot();
    return { errors: window.__errors.length - before, snap: snap,
      mechName: state.boss.mechName, hudLabel: (state.boss.mechPhase === 2 ? 'P2 · ' : 'P1 · ') + state.boss.mechName };
  })()`);
  ok('B8 HUD 与调试快照能读到二阶段机制名（drawBossHud 不报错）',
    b8.errors === 0 && b8.snap && b8.snap.mechPhase === 2
      && b8.snap.mechName && b8.snap.mechName.length > 0
      && b8.hudLabel.indexOf('P2 ·') === 0,
    { errors: b8.errors, mechName: b8.snap && b8.snap.mechName, hudLabel: b8.hudLabel, signalAt: b8.snap && b8.snap.signalAt });

  const pageErrors = await ev(`window.__errors.slice()`);
  ok('B9 全流程无页面异常', pageErrors.length === 0, { errors: pageErrors });

  const bytes = await shot('boss-mech-p2.png');

  const result = { port: PORT, asserts, pageErrors, screenshotBytes: bytes,
    verdict: asserts.every((a) => a.pass) ? 'PASS' : 'FAIL' };
  fs.writeFileSync(path.join(__dirname, 'arcane_bossmech-result.json'), JSON.stringify(result, null, 2));
  console.log('VERDICT: ' + result.verdict + ' (' + asserts.filter((a) => a.pass).length + '/' + asserts.length + ')');
  ws.close();
  killEdge(edgeProc);
  if (result.verdict !== 'PASS') process.exitCode = 1;
}

main().catch((e) => { console.error('FATAL', e); killEdge(edgeProc); process.exitCode = 1; });
