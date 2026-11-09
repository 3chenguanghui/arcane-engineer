// 入口路径以脚本自身目录（tools/）为基准，项目根 = 上一级目录
// P0-AOE 专项验收：真实浏览器（Edge headless + CDP）
// 用法：node arcane_p0aoe.js <html绝对路径> <截图输出目录>
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9731;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = process.argv[3] || path.join(__dirname, '..', '.screenshots', 'p0_aoe');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const profile = prepareProfile();
  fs.mkdirSync(OUT, { recursive: true });
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--allow-file-access-from-files', '--window-size=1600,1000', 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 浏览器还没起来 */ }
    await sleep(250);
  }
  if (!target) throw new Error('Edge 未就绪');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res, rej) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2200);

  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.text + ' :: ' + expression.slice(0, 80)
        + ' :: ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    }
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };

  const report = { assertions: [], notes: {} };
  const check = (name, ok, detail) => {
    report.assertions.push({ name, ok: !!ok, detail: detail === undefined ? null : detail });
  };

  // 进入战斗
  await ev("document.getElementById('btnStart').click(); true");
  await sleep(900);
  check('开局进入战斗', (await ev('state.mode')) === 'playing', await ev('state.mode'));

  // 测试用重置：直接清空实体，不触发清房（出生房不刷怪，安全）
  const resetArena = async () => {
    await ev(`(function(){
      state.enemies.length = 0;
      state.projectiles.length = 0;
      state.bullets.length = 0;
      state.floats.length = 0;
      state.cooldowns = {};
      state.player.aether = state.player.aetherMax;
      state.player.hp = state.player.hpMax;
      state.combo.count = 0;
      state.combo.timer = 0;
      state.lastExplosion = null;
      state.lastHit = null;
      state.explosionStats = { count: 0, totalHits: 0, bestHits: 0 };
      return true;
    })()`);
    await sleep(120);
    // 暴力清空敌人可能让战斗房判定为"已清"并弹出奖励，选掉它回到 playing
    await ev(`(function(){
      var s = window.__roamDebug.getState();
      if (s.mode === 'reward' && s.options && s.options.length) {
        window.__roamDebug.chooseReward(s.options[0]);
        return 'chosen';
      }
      return s.mode;
    })()`);
    await sleep(300);
  };

  // 在玩家右侧摆 N 只静止敌人（绑定到当前房间，避免它们乱跑影响命中统计）
  const placeEnemies = async (count, spacing, hp) => {
    return ev(`(function(){
      var roomId = state.currentRoomId;
      var ids = [];
      for (var i = 0; i < ${count}; i += 1) {
        var id = window.__roamDebug.spawnEnemy('assembler', 72 + i * ${spacing}, (i % 2 === 0 ? 10 : -10));
        ids.push(id);
      }
      ids.forEach(function(id){
        var e = state.enemies.find(function(x){ return x.id === id; });
        if (e) {
          e.roomId = roomId;
          e.speed = 0;                 // 静止，保证爆炸命中数可复现
          if (${hp} > 0) { e.hp = ${hp}; e.hpMax = ${hp}; }
        }
      });
      return ids;
    })()`);
  };

  // ========== 场景 1：普通火球的小范围爆炸 ==========
  await resetArena();
  await placeEnemies(3, 32, 0);
  await ev('window.__roamDebug.setMouseAim(0); true');
  await sleep(220);
  await ev('window.__roamDebug.cast(); true');
  await sleep(120);
  await shot('01_fireball_blast.png');
  await sleep(420);
  const exp1 = await ev('window.__roamDebug.getState().lastExplosion');
  check('普通火球命中后触发爆炸', !!exp1, exp1);
  check('普通火球爆炸半径 = 82', exp1 && exp1.radius === 82, exp1 && exp1.radius);
  check('普通火球一次命中 ≥2 只', exp1 && exp1.hits >= 2, exp1 && exp1.hits);
  report.notes.fireballHits = exp1 ? exp1.hits : 0;

  // ========== 场景 2：融合「爆炸新星」 ==========
  await resetArena();
  await ev("window.__roamDebug.grantTech('field'); true");
  const fusedNova = await ev('window.__roamDebug.fuse()');
  const fusionList = await ev('window.__roamDebug.getState().fusions');
  check('解锁爆炸新星', fusedNova === true && fusionList.indexOf('novaBurst') >= 0, fusionList);
  await placeEnemies(5, 40, 0);
  await ev('window.__roamDebug.setMouseAim(0); state.cooldowns = {}; state.player.aether = state.player.aetherMax; true');
  await sleep(220);
  await ev('window.__roamDebug.cast(); true');
  await sleep(140);
  await shot('02_nova_burst.png');
  await sleep(450);
  const exp2 = await ev('window.__roamDebug.getState().lastExplosion');
  check('爆炸新星半径 = 128', exp2 && exp2.radius === 128, exp2 && exp2.radius);
  check('爆炸新星一次命中 ≥3 只', exp2 && exp2.hits >= 3, exp2 && exp2.hits);
  report.notes.novaHits = exp2 ? exp2.hits : 0;

  // ========== 场景 3：融合「连锁扩散」 ==========
  await resetArena();
  await ev("window.__roamDebug.grantMagic('bolt'); window.__roamDebug.selectMagic('bolt'); true");
  const fusedChain = await ev('window.__roamDebug.fuse()');
  const fusionList2 = await ev('window.__roamDebug.getState().fusions');
  check('解锁连锁扩散', fusedChain === true && fusionList2.indexOf('chainSpread') >= 0, fusionList2);
  await placeEnemies(4, 46, 0);
  await ev('state.cooldowns = {}; state.player.aether = state.player.aetherMax; true');
  await ev('window.__roamDebug.cast(); true');
  await sleep(160);
  await shot('03_chain_spread.png');
  await sleep(400);
  const exp3 = await ev('window.__roamDebug.getState().lastExplosion');
  const stats3 = await ev('window.__roamDebug.getState().explosionStats');
  check('连锁扩散落点爆炸半径 = 96', exp3 && exp3.radius === 96, exp3 && exp3.radius);
  // 连锁每一跳都会炸：看"单次最高命中"与"累计命中"，不只看最后一次落点
  check('连锁扩散单次最高命中 ≥2 只', stats3 && stats3.bestHits >= 2, stats3);
  check('连锁扩散累计爆炸 ≥2 次（每跳都炸）', stats3 && stats3.count >= 2, stats3);
  report.notes.chainStats = stats3;

  // ========== 场景 4：一次炸死 5+ 只 → 多杀反馈 + 连杀奖励 ==========
  await resetArena();
  await ev("window.__roamDebug.selectMagic('fireball'); state.cooldowns = {}; state.player.aether = 70; true");
  await placeEnemies(6, 26, 1);
  const beforeAether = await ev('state.player.aether');
  const beforeKills = await ev('state.kills');
  await ev('window.__roamDebug.setMouseAim(0); true');
  await sleep(220);
  await ev('window.__roamDebug.cast(); true');
  await sleep(420);
  // 先读数据再截图：截图在 headless 下耗时较长，会把 0.9s 的飘字等过期
  const exp4 = await ev('window.__roamDebug.getState().lastExplosion');
  const combo4 = await ev('window.__roamDebug.getState().combo');
  const afterAether = await ev('state.player.aether');
  const kills4 = await ev('state.kills');
  const hasBurstFloat = await ev("state.floats.some(function(f){ return f.text.indexOf('爆裂') === 0; })");
  const hitsStop = await ev('state.hitStop');
  await shot('04_multikill.png');
  check('一发炸死 ≥5 只', exp4 && exp4.hits >= 5, exp4 && exp4.hits);
  check('爆炸确实击杀 ≥5 只', kills4 - beforeKills >= 5, { before: beforeKills, after: kills4 });
  check('多杀飘字「爆裂 ×N」出现', hasBurstFloat, hasBurstFloat);
  check('连杀计数 ≥5', combo4 && combo4.count >= 5, combo4);
  // 净变化 = -15（火球耗能）+18（5 连奖励）= +3 左右（含自然回复）
  check('连杀奖励奥能到账（净 +3）', afterAether - beforeAether >= 2,
    { before: beforeAether, after: afterAether, delta: afterAether - beforeAether });
  check('爆炸顿帧为有限数值（非 NaN）', Number.isFinite(hitsStop), hitsStop);
  report.notes.multikillHits = exp4 ? exp4.hits : 0;
  report.notes.multikillKills = kills4;
  report.notes.aetherBefore = beforeAether;
  report.notes.aetherAfter = afterAether;
  report.notes.combo = combo4;

  // ========== 汇总：帧率 / 报错 / 回归关键状态 ==========
  await sleep(400);
  const st = await ev('window.__roamDebug.getState()');
  report.notes.fps = st.fps;
  check('帧率 ≥60', st.fps >= 60, st.fps);
  const errors = await ev('window.__roamDebug.errors()');
  check('运行无报错', Array.isArray(errors) && errors.length === 0, errors);
  report.notes.errors = errors;
  report.notes.mode = st.mode;
  report.notes.rooms = st.rooms ? st.rooms.length : 0;
  report.notes.enemiesBound = st.enemyList.every((e) => e.roomId >= 0);

  await shot('05_final_state.png');
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  const failed = report.assertions.filter((a) => !a.ok);
  console.log(JSON.stringify(report, null, 2));
  console.log('\n==== 结果：' + (report.assertions.length - failed.length) + '/' + report.assertions.length
    + ' 通过 ====');
  if (failed.length) console.log('失败项：' + failed.map((a) => a.name).join(' | '));
  ws.close();
  killEdge(edge);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => { console.error('FATAL', err); process.exit(2); });
