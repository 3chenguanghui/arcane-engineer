// P1 断言：可读性与复盘（复盘账目同源 / 标签规则 / 色盲冗余 / 信息分层 / 开关零差异）
// 用法：node tools\arcane_p1.js *> tools\p1.log
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9691;
const MAIN = path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = path.join(__dirname, '..', '.screenshots', 'p1');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 兜底：进程退出时确保 Edge 被收走 */
function attachEdgeExit(edge) {
  const kill = () => { try { edge.kill(); } catch (e) {} };
  process.on('exit', kill);
  process.on('SIGINT', () => { kill(); process.exit(1); });
}

async function main() {
  const profile = prepareProfile();
  fs.mkdirSync(OUT, { recursive: true });
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--allow-file-access-from-files', '--force-device-scale-factor=1',
    '--window-size=1536,900', 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) {}
    await sleep(250);
  }
  if (!target) throw new Error('Edge CDP 未就绪');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push('EXCEPTION: ' + m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push('CONSOLE: ' + (m.params.args || []).map((a) => a.value || a.description || '').join(' '));
    }
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res, rej) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1536, height: 900, deviceScaleFactor: 1, mobile: false });

  /** 求值：表达式异常会直接抛出，避免静默 PASS */
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    }
    return r.result.value;
  };
  const checks = [];
  /** 记录一条断言 */
  const check = (name, ok, detail) => {
    checks.push({ name, ok: !!ok, detail });
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + '  ' + JSON.stringify(detail));
  };

  attachEdgeExit(edge);
  await send('Page.navigate', { url: 'file:///' + MAIN.replace(/\\/g, '/') });
  await sleep(1600);
  await ev(`(function(){ try { state.onboardSkipAll = true; hideIntroHint(true); } catch (e) {} ; document.getElementById('btnStart').click(); return true; })()`);
  await sleep(2600);
  await ev(`(function(){
    state.mode = 'playing'; state.status = 'playing';
    if (state.currentRoomId == null || state.currentRoomId < 0) state.currentRoomId = 0;
    var room = state.rooms[state.currentRoomId] || state.rooms[0];
    if (room) { state.player.x = room.cx; state.player.y = room.cy; }
    state.player.hp = state.player.hpMax = 99999;
    __roamDebug.p1.setEnabled(true);
    __roamDebug.p1.setReview(true);
    __roamDebug.p1.setLayers(true);
    __roamDebug.p1.setInfoMode('standard');
    __roamDebug.p1.setColorblind(false);
    return { mode: state.mode, room: state.currentRoomId, floor: state.floor };
  })()`);

  // ---------- 1) 承伤账目与真实扣血同源 ----------
  const a1 = await ev(`(function(){
    var p1 = __roamDebug.p1;
    p1.reset();
    state.player.hp = state.player.hpMax = 99999;
    var sum = 0, hits = 0;
    var cases = [['bullet','弩手',null], ['contact','刃兽',null], ['contact','刃兽',null],
                 ['contact','刺针',null], ['charge','冲锋者',null], ['hazard','地刺',null],
                 ['barrel','爆炸桶',null]];
    for (var i = 0; i < cases.length; i += 1) {
      var before = state.player.hp;
      var r = p1.damagePlayer(30, cases[i][0], cases[i][1], cases[i][2]);
      sum += (before - state.player.hp);
      hits += 1;
    }
    var info = p1.info();
    return {
      appliedSum: Math.round(sum),
      ledgerTotal: info.ledger ? info.ledger.incoming.total : -1,
      hits: info.ledger ? info.ledger.incoming.hits : -1,
      expectHits: hits,
      byCat: info.ledger ? info.ledger.incoming.byCat : null
    };
  })()`);
  check('A1 承伤账目 = 真实扣血之和', a1.appliedSum === a1.ledgerTotal && a1.hits === a1.expectHits, a1);

  // ---------- 2) 输出账目与真实掉血同源 ----------
  const a2 = await ev(`(function(){
    var p1 = __roamDebug.p1;
    p1.reset();
    state.player.critChance = 0;
    state.player.critMult = 1;
    var e = spawnEnemy(ENEMY_CONFIG[0].id, state.player.x + 120, state.player.y, state.floor);
    state.enemies = [e];
    e.hpMax = 999999; e.hp = 999999; e.shieldHp = 0; e.mark = null;
    var magicId = MAGIC_CONFIG[0].id;
    var fusionId = (typeof FUSION_CONFIG !== 'undefined' && FUSION_CONFIG.length) ? FUSION_CONFIG[0].id : null;
    // 每次调用返回“真实掉血”，累加后与账目对比（同源校验）
    var real = p1.damageEnemy(100, magicId, 0).dealt;
    real += p1.damageEnemy(100, magicId, 0).dealt;
    if (fusionId) real += p1.damageEnemy(100, fusionId, 0).dealt;
    var info = p1.info();
    var total = info.ledger ? info.ledger.outgoing.total : -1;
    var ids = info.ledger ? Object.keys(info.ledger.outgoing.byId) : [];
    var fusionBucket = fusionId && info.ledger ? info.ledger.outgoing.byId[fusionId] : null;
    return {
      realLoss: Math.round(real), ledgerTotal: total, ids: ids,
      fusionMarked: fusionBucket ? fusionBucket.fusion === true : true,
      fusionName: fusionBucket ? fusionBucket.name : null
    };
  })()`);
  check('A2 输出账目 = 真实掉血（含护盾）', a2.realLoss === a2.ledgerTotal && a2.ids.length >= 2 && a2.fusionMarked, a2);

  // ---------- 3) 页面占比与账目同源 ----------
  const a3Ledger = await ev(`(function(){
    var p1 = __roamDebug.p1;
    p1.reset();
    var L = state.p1Ledger;
    L.incoming.total = 1000;
    L.incoming.hits = 12;
    L.incoming.byCat = { boss: 100, melee: 520, ranged: 160, env: 120, self: 80, other: 20 };
    L.incoming.hitsByCat = { boss: 1, melee: 6, ranged: 2, env: 2, self: 1, other: 0 };
    L.incoming.meleeNames = { '刃兽': 4, '刺针': 2 };
    L.outgoing.total = 900;
    L.outgoing.byId = {
      'fireball': { dmg: 400, name: '火球', fusion: false },
      'frost': { dmg: 300, name: '霜环', fusion: false },
      'fuse_x': { dmg: 200, name: '融合示例', fusion: true }
    };
    var html = p1.showAgain();
    return { html: html, shares: p1.info().shares };
  })()`);
  {
    const html = a3Ledger.html || '';
    const shareRe = /data-p1-share="([^"]+)"\s+data-p1-pct="([0-9]+)"\s+data-p1-value="([0-9]+)"/g;
    const seen = [];
    let m;
    while ((m = shareRe.exec(html)) !== null) seen.push({ key: m[1], pct: Number(m[2]), value: Number(m[3]) });
    const sumIn = seen.filter((s) => s.key.indexOf('in:') === 0).reduce((a, s) => a + s.pct, 0);
    const sumOut = seen.filter((s) => s.key.indexOf('out:') === 0).reduce((a, s) => a + s.pct, 0);
    let match = seen.length >= 6;
    if (match) {
      const inList = (a3Ledger.shares.incoming.list || []);
      const outList = (a3Ledger.shares.outgoing.list || []);
      const all = inList.concat(outList);
      seen.forEach((s) => {
        const prefix = s.key.split(':')[0] + ':';
        const id = s.key.slice(prefix.length);
        const hit = all.find((x) => x.key === id && prefix === (s.key.indexOf('in:') === 0 ? 'in:' : 'out:'));
        if (!hit || hit.pct !== s.pct || hit.value !== s.value) match = false;
      });
    }
    check('A3 页面占比 = 账目现算（且和为 100）',
      match && sumIn === 100 && sumOut === 100,
      { segments: seen.length, sumIn, sumOut, shares: a3Ledger.shares });
  }

  // ---------- 4) 标签规则可解释 ----------
  const a4 = await ev(`(function(){
    var p1 = __roamDebug.p1;
    var out = {};
    function build(cats, names, hits) {
      p1.reset();
      var L = state.p1Ledger;
      L.incoming.total = cats.reduce(function(a, b){ return a + b; }, 0);
      L.incoming.byCat = { boss:0, melee:0, ranged:0, env:0, self:0, other:0 };
      L.incoming.meleeNames = {};
      var keys = ['boss','melee','ranged','env','self','other'];
      cats.forEach(function(v, i){ L.incoming.byCat[keys[i]] = v; });
      if (names) L.incoming.meleeNames = names;
      L.incoming.hitsByCat = { boss:0, melee:0, ranged:0, env:0, self:0, other:0 };
      L.incoming.hitsByCat.melee = hits || 0;
      return p1.verdict();
    }
    out.boss = build([600, 400, 0, 0, 0, 0], null, 0);
    out.melee = build([0, 700, 200, 100, 0, 0], { '刃兽': 3, '刺针': 2, '裂爪': 1 }, 6);
    out.ranged = build([0, 150, 800, 50, 0, 0], null, 0);
    out.self = build([0, 200, 100, 100, 500, 100], null, 0);
    out.env = build([0, 200, 100, 650, 50, 0], null, 0);
    return out;
  })()`);
  {
    const tagOk = a4.boss.tag === 'boss' && a4.melee.tag === 'melee' && a4.ranged.tag === 'ranged'
      && a4.self.tag === 'self' && a4.env.tag === 'env';
    const ruleOk = a4.boss.rule.indexOf('≥40%') >= 0 && a4.melee.rule.indexOf('≥50%') >= 0
      && a4.ranged.rule.indexOf('≥45%') >= 0 && a4.self.rule.indexOf('≥30%') >= 0
      && a4.env.rule.indexOf('≥45%') >= 0;
    check('A4 五类死因标签按阈值判定且带规则句', tagOk && ruleOk, {
      tags: [a4.boss.tag, a4.melee.tag, a4.ranged.tag, a4.self.tag, a4.env.tag],
      rules: [a4.boss.rule, a4.melee.rule, a4.ranged.rule, a4.self.rule, a4.env.rule]
    });
  }

  // ---------- 5) 空账目不崩、无 NaN ----------
  const a5 = await ev(`(function(){
    var p1 = __roamDebug.p1;
    p1.reset();
    var v = p1.verdict();
    var html = p1.showAgain();
    return { tag: v.tag, label: v.label, hasNaN: html.indexOf('NaN') >= 0, htmlLen: html.length };
  })()`);
  check('A5 空账目 = 未知 / 页面无 NaN', a5.tag === 'unknown' && !a5.hasNaN, a5);

  // ---------- 6) 通关页只插输出构成，不插死因 ----------
  const a6 = await ev(`(function(){
    var p1 = __roamDebug.p1;
    var L = state.p1Ledger;
    L.outgoing.total = 500;
    L.outgoing.byId = { 'fireball': { dmg: 500, name: '火球', fusion: false } };
    showVictory();
    var html = ui.modal ? ui.modal.innerHTML : '';
    return {
      hasReview: html.indexOf('data-p1-review="win"') >= 0,
      hasTag: html.indexOf('data-p1-tag=') >= 0,
      hasOutBar: html.indexOf('data-p1-bar="out"') >= 0
    };
  })()`);
  check('A6 通关页有输出构成、无死因标签', a6.hasReview && !a6.hasTag && a6.hasOutBar, a6);
  await ev(`(function(){ state.status='playing'; state.mode='playing'; return true; })()`);

  // ---------- 7) 色盲开关：冗余编码即时叠加 ----------
  const cbOn = await ev(`(function(){
    var p1 = __roamDebug.p1;
    p1.reset();
    p1.setColorblind(true);
    var fake = { x: state.player.x, y: state.player.y - 40, radius: 18, elite: false, affix: null,
      elem: { fire: 3, ice: 3, thunder: 3 }, elemOrder: ['fire','ice','thunder'] };
    drawElementStatusIcons(fake);
    fake.execTimer = 2;
    drawExecutionMark(fake, 0);
    // 事件门徽：临时把 0 号房改成献祭，画完立刻还原（不污染小地图 / 楼层数据）
    var rid = state.rooms[0].id;
    var oldType = state.rooms[0].type;
    state.rooms[0].type = 'sacrifice';
    drawDoorPlate({ x: state.player.x + 60, y: state.player.y + 60, targetRoomId: rid },
      { text: '献祭', color: '#ff9a5e', locked: false, revisited: false });
    state.rooms[0].type = oldType;
    // 首领 HUD：临时塞一个最小 boss，画完还原（避免后续帧读缺字段崩）
    var bossBackup = state.boss;
    state.boss = { hp: 2000, hpMax: 4200, name: '测试首领', title: 'TEST', color: '#ff5c7a',
      accent: '#ffb0c0', introDone: true, phase: 1, defeated: false, line: null, hazards: [], zones: [] };
    drawBossHud();
    state.boss = bossBackup || null;
    var e1 = spawnEnemy(ENEMY_CONFIG[0].id, state.player.x + 120, state.player.y, state.floor);
    var e2 = spawnEnemy(ENEMY_CONFIG[0].id, state.player.x + 180, state.player.y + 20, state.floor, { elite: true });
    state.enemies = [e1, e2];
    e1.hp = e1.hpMax * 0.5; e2.hp = e2.hpMax * 0.5;
    drawEnemies();
    return { stats: p1.renderStats(), cb: READABILITY_CONFIG.a11y.colorblind };
  })()`);
  check('B7 色盲模式：血条 / 徽记 / 处决 / 门徽 / 首领条全部叠加冗余',
    cbOn.cb === true && cbOn.stats.badgeTextures >= 3 && cbOn.stats.execDoubleRing >= 1
    && cbOn.stats.doorBadges >= 1 && cbOn.stats.bossBars >= 1
    && cbOn.stats.hpBars >= 2 && cbOn.stats.hpBarsElite >= 1, cbOn.stats);

  const cbOff = await ev(`(function(){
    var p1 = __roamDebug.p1;
    p1.reset();
    p1.setColorblind(false);
    var fake = { x: state.player.x, y: state.player.y - 40, radius: 18, elite: false, affix: null,
      elem: { fire: 3, ice: 3, thunder: 3 }, elemOrder: ['fire','ice','thunder'] };
    drawElementStatusIcons(fake);
    fake.execTimer = 2;
    drawExecutionMark(fake, 0);
    var rid = state.rooms[0].id;
    var oldType = state.rooms[0].type;
    state.rooms[0].type = 'sacrifice';
    drawDoorPlate({ x: state.player.x + 60, y: state.player.y + 60, targetRoomId: rid },
      { text: '献祭', color: '#ff9a5e', locked: false, revisited: false });
    state.rooms[0].type = oldType;
    var bossBackup = state.boss;
    state.boss = { hp: 2000, hpMax: 4200, name: '测试首领', title: 'TEST', color: '#ff5c7a',
      accent: '#ffb0c0', introDone: true, phase: 1, defeated: false, line: null, hazards: [], zones: [] };
    drawBossHud();
    state.boss = bossBackup || null;
    drawEnemies();
    return p1.renderStats();
  })()`);
  check('B8 关闭色盲：冗余计数归零（原路径不变）',
    cbOff.badgeTextures === 0 && cbOff.execDoubleRing === 0 && cbOff.doorBadges === 0
    && cbOff.bossBars === 0 && cbOff.hpBars >= 2, cbOff);

  const b9 = await ev(`(function(){ return __roamDebug.p1.badgeSignatures(); })()`);
  {
    const keys = {};
    let ok = b9.length >= 3;
    b9.forEach((s) => {
      const sig = s.shape + '|' + s.texture + '|' + s.glyph;
      if (keys[sig]) ok = false;
      keys[sig] = true;
    });
    const core = b9.filter((s) => ['fire', 'ice', 'thunder'].indexOf(s.kind) >= 0);
    const coreSigs = core.map((s) => s.shape + '|' + s.texture + '|' + s.glyph);
    check('B9 三种元素徽记三元组两两不同（灰度可区分）',
      ok && core.length === 3 && new Set(coreSigs).size === 3, { all: b9, coreSigs });
  }

  // ---------- 10) 威胁判定 ----------
  const c10 = await ev(`(function(){
    var p1 = __roamDebug.p1;
    p1.setInfoMode('standard');
    p1.setLayers(true);
    p1.setColorblind(false);
    var far = spawnEnemy(ENEMY_CONFIG[0].id, state.player.x + 600, state.player.y, state.floor);
    var mid = spawnEnemy(ENEMY_CONFIG[0].id, state.player.x + 90, state.player.y, state.floor);
    var high = spawnEnemy(ENEMY_CONFIG[0].id, state.player.x + 140, state.player.y + 40, state.floor);
    state.enemies = [far, mid, high];
    far.hp = far.hpMax; far.windup = 0; far.aiV2 = null; far.elem = { fire: 2 }; far.elemOrder = ['fire']; far.execTimer = 2;
    mid.hp = mid.hpMax * 0.5; mid.windup = 0; mid.aiV2 = null; mid.elem = { ice: 2 }; mid.elemOrder = ['ice']; mid.execTimer = 2;
    high.hp = high.hpMax; high.windup = 1.2; high.aiV2 = null; high.elem = { thunder: 2 }; high.elemOrder = ['thunder']; high.execTimer = 2;
    var threats = [p1.threatOf(0), p1.threatOf(1), p1.threatOf(2)];
    p1.reset();
    drawEnemies();
    var std = p1.renderStats();
    p1.setInfoMode('minimal');
    p1.reset();
    drawEnemies();
    var min = p1.renderStats();
    p1.setInfoMode('full');
    p1.reset();
    drawEnemies();
    var full = p1.renderStats();
    return { threats: threats, std: std, min: min, full: full };
  })()`);
  {
    const t = c10.threats || [];
    const threatOk = t[0].level === 'low' && t[1].level === 'mid' && t[2].level === 'high';
    check('C10 威胁判定 低 / 中 / 高 正确',
      threatOk, { levels: t.map((x) => x.level), reasons: t.map((x) => x.reason) });
    check('C10b standard 档：低威胁淡出条、徽记与处决收起',
      c10.std.fadedBars >= 1 && c10.std.badges === 2 && c10.std.execMarks === 2 && c10.std.hpBars >= 2,
      c10.std);
    check('C10c minimal 档：低威胁浮层归零、高威胁仍完整',
      c10.min.hiddenBars >= 1 && c10.min.hpBars === 1 && c10.min.badges === 2 && c10.min.execMarks === 2,
      c10.min);
    check('C10d full 档：三层都完整（低威胁也有徽记 / 处决）',
      c10.full.badges === 3 && c10.full.execMarks === 3, c10.full);
  }

  // ---------- 12) 分层开关关闭 = 旧观感 ----------
  const c12 = await ev(`(function(){
    var p1 = __roamDebug.p1;
    p1.setInfoMode('standard');
    p1.setLayers(false);
    p1.reset();
    drawEnemies();
    var off = p1.renderStats();
    return { off: off, floor: state.floor, playerX: state.player.x };
  })()`);
  check('C12 分层关闭：计数回到旧路径（无淡出 / 隐藏 / 无分层统计）',
    c12.off.fadedBars === 0 && c12.off.hiddenBars === 0 && c12.off.threatHigh === 0
    && c12.off.threatMid === 0 && c12.off.threatLow === 0
    && c12.off.badges === c10.full.badges && c12.off.execMarks === c10.full.execMarks, c12.off);

  // ---------- 13) 开关即时生效（同一局，不换层） ----------
  const c13 = await ev(`(function(){
    var p1 = __roamDebug.p1;
    p1.setLayers(true);
    p1.setInfoMode('standard');
    p1.reset();
    drawEnemies();
    var before = p1.renderStats();
    var floorBefore = state.floor, roomBefore = state.currentRoomId;
    p1.setInfoMode('minimal');
    p1.reset();
    drawEnemies();
    var after = p1.renderStats();
    return {
      before: before, after: after,
      floorSame: state.floor === floorBefore && state.currentRoomId === roomBefore,
      mo: READABILITY_CONFIG.layers.mode
    };
  })()`);
  check('C13 同局切换档位：下一帧立即生效且不换层',
    c13.before.fadedBars >= 1 && c13.after.hiddenBars >= 1 && c13.after.fadedBars === 0
    && c13.floorSame && c13.mo === 'minimal', c13);

  // ---------- 14) 父开关：关闭后结算 DOM 零差异 ----------
  const d14 = await ev(`(function(){
    var p1 = __roamDebug.p1;
    p1.setInfoMode('standard');
    p1.setReview(true);
    p1.setEnabled(true);
    var L = state.p1Ledger;
    L.incoming.total = 1000;
    L.incoming.byCat = { boss: 0, melee: 600, ranged: 200, env: 100, self: 100, other: 0 };
    L.incoming.hits = 9;
    L.incoming.meleeNames = { '刃兽': 5 };
    L.outgoing.total = 800;
    L.outgoing.byId = { 'fireball': { dmg: 800, name: '火球', fusion: false } };
    var on = p1.showAgain();
    var reviewStr = p1.reviewString ? p1.reviewString() : '';
    p1.setEnabled(false);
    var off = p1.showAgain();
    return {
      onHasReview: on.indexOf('p1-review') >= 0,
      offHasReview: off.indexOf('p1-review') >= 0,
      reviewStrLen: reviewStr.length,
      reviewInOn: reviewStr.length > 0 && on.indexOf(reviewStr) >= 0,
      strippedSame: reviewStr.length > 0 ? on.replace(reviewStr, '') === off : false,
      ledgerNull: state.p1Ledger === null,
      lenOn: on.length, lenOff: off.length
    };
  })()`);
  check('D14 父开关关闭：复盘 DOM 被完整移除且其余逐字符一致',
    d14.onHasReview && !d14.offHasReview && d14.reviewInOn && d14.strippedSame && d14.ledgerNull, d14);

  // ---------- 15) 页面异常 / 截图 ----------
  await ev(`(function(){
    __roamDebug.p1.setEnabled(true);
    __roamDebug.p1.setReview(true);
    __roamDebug.p1.setColorblind(true);
    __roamDebug.p1.setInfoMode('standard');
    state.status = 'lose';
    showResult();
    return true;
  })()`);
  await sleep(300);
  {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, 'p1-result-colorblind.png'), Buffer.from(r.data, 'base64'));
  }
  await ev(`(function(){ state.status='playing'; state.mode='playing'; __roamDebug.p1.setColorblind(false); return true; })()`);
  await sleep(200);
  {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, 'p1-play-standard.png'), Buffer.from(r.data, 'base64'));
  }
  check('E15 页面异常 0', errors.length === 0, errors.slice(0, 5));

  const passed = checks.filter((c) => c.ok).length;
  console.log(`RESULT: ${passed}/${checks.length} ${passed === checks.length ? 'PASS' : 'FAIL'}`);
  ws.close();
  edge.kill();
  if (passed !== checks.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error('FATAL', err && err.stack || err);
  process.exit(1);
});
