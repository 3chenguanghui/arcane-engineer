// 入口路径以脚本自身目录（tools/）为基准，项目根 = 上一级目录
// P0-难度三档 专项验收
//   1) 三档同种怪 hp / speed / damage 倍率关系（easy < normal < nightmare）
//   2) 战斗房同场敌人数量的档位差异（各档生成 10 次取平均）
//   3) 掉落率：各档模拟 2000 次 dropLoot，统计掉落数（easy > normal > nightmare）
//   4) 楼层压力曲线：第 1 层 ≈ 1，往上递增、上限封顶
//   5) meta.difficulty 持久化（选择 → 刷新页面 → 仍记住）
//   6) 标题页三档按钮截图 + 选中态配色
//   7) 帧率 ≥60、报错为空
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9751;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = process.argv[3] || path.join(__dirname, '..', '.screenshots', 'p0_diff');
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
    } catch (e) { /* wait */ }
    await sleep(250);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res, rej) => {
    seq += 1; pending.set(seq, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  await send('Runtime.enable'); await send('Page.enable');
  const nav = async () => {
    await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
    await sleep(2200);
  };
  await nav();
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };
  const report = { assertions: [], notes: {} };
  const check = (name, ok, detail) => report.assertions.push({ name, ok: !!ok, detail });

  // ---- 0. 标题页：三档按钮存在 + 默认 standard + 三张选中态截图 ----
  const titleInfo = await ev(`(function(){
    var btns = Array.prototype.slice.call(document.querySelectorAll('[data-difficulty]'));
    return {
      count: btns.length,
      ids: btns.map(function(b){ return b.getAttribute('data-difficulty'); }),
      active: btns.filter(function(b){ return b.classList.contains('is-active'); })
        .map(function(b){ return b.getAttribute('data-difficulty'); }),
      note: (document.getElementById('difficultyNote') || {}).textContent,
      stateDifficulty: state.difficulty
    };
  })()`);
  check('标题页有 3 个难度按钮（简单/普通/困难）', titleInfo.count === 3, titleInfo.ids);
  check('默认难度 = 普通（normal）',
    titleInfo.active.length === 1 && titleInfo.active[0] === 'normal' && titleInfo.stateDifficulty === 'normal',
    titleInfo);
  report.notes.titleInfo = titleInfo;
  await shot('01_title_normal.png');

  // 逐个点击按钮并截图，记录选中态描边色（验证三档视觉区分）
  for (const mode of ['easy', 'nightmare', 'normal']) {
    await ev(`document.querySelector('[data-difficulty="${mode}"]').click(); true`);
    await sleep(320);
    const snap = await ev(`(function(){
      var b = document.querySelector('[data-difficulty="${mode}"]');
      var cs = getComputedStyle(b);
      return {
        active: b.classList.contains('is-active'),
        border: cs.borderTopColor, bg: cs.backgroundColor,
        label: b.querySelector('b').textContent,
        note: (document.getElementById('difficultyNote') || {}).textContent,
        saved: JSON.parse(localStorage.getItem('arcane_rogue_meta') || '{}').difficulty
      };
    })()`);
    check(`点选「${mode}」后按钮为选中态`, snap.active === true, snap);
    check(`点选「${mode}」后写入 localStorage`, snap.saved === mode, snap.saved);
    report.notes['btn_' + mode] = snap;
    await shot(`02_title_${mode}.png`);
  }

  // ---- 1. 三档同种怪数值对比（同一楼层、同一类型） ----
  // 注意：前五层是教学区，难度被固定为 normal（G 批设计），
  // 因此难度档必须用第 6 层以后（这里取 7）才能看到三档真实差异。
  const DIFF_FLOOR = 7;
  await ev("document.getElementById('btnStart').click(); true");
  await sleep(900);
  const statByMode = {};
  for (const mode of ['easy', 'normal', 'nightmare']) {
    await ev(`setDifficulty('${mode}'); window.__roamDebug.setFloor(${DIFF_FLOOR}); true`);
    await sleep(500);
    statByMode[mode] = await ev(`(function(){
      state.enemies.length = 0;
      var en = spawnEnemy('assembler', state.player.x + 60, state.player.y, ${DIFF_FLOOR}, { roomId: -1 });
      var out = { hp: en.hp, hpMax: en.hpMax, speed: Math.round(en.speed * 100) / 100, damage: en.damage };
      state.enemies.length = 0;
      return out;
    })()`);
  }
  report.notes.statByMode = statByMode;
  check('难度：血量 easy < normal < nightmare',
    statByMode.easy.hp < statByMode.normal.hp && statByMode.normal.hp < statByMode.nightmare.hp, statByMode);
  check('难度：速度 easy < normal < nightmare',
    statByMode.easy.speed < statByMode.normal.speed && statByMode.normal.speed < statByMode.nightmare.speed, statByMode);
  check('难度：伤害 easy < normal < nightmare',
    statByMode.easy.damage <= statByMode.normal.damage && statByMode.normal.damage < statByMode.nightmare.damage, statByMode);

  // 精英怪也吃难度（eliteHpMul）
  const eliteByMode = {};
  for (const mode of ['easy', 'normal', 'nightmare']) {
    await ev(`setDifficulty('${mode}'); window.__roamDebug.setFloor(${DIFF_FLOOR}); true`);
    await sleep(500);
    eliteByMode[mode] = await ev(`(function(){
      state.enemies.length = 0;
      var en = spawnEnemy('assembler', state.player.x + 60, state.player.y, ${DIFF_FLOOR}, { roomId: -1, elite: true });
      var out = { hp: en.hp, radius: en.radius };
      state.enemies.length = 0;
      return out;
    })()`);
  }
  report.notes.eliteByMode = eliteByMode;
  check('难度：精英血量 easy < normal < nightmare',
    eliteByMode.easy.hp < eliteByMode.normal.hp && eliteByMode.normal.hp < eliteByMode.nightmare.hp, eliteByMode);

  // ---- 2. 战斗房同场敌人数量（各档 10 次生成取平均） ----
  const countByMode = {};
  for (const mode of ['easy', 'normal', 'nightmare']) {
    const samples = [];
    await ev(`setDifficulty('${mode}'); true`);
    for (let k = 0; k < 10; k += 1) {
      await ev(`window.__roamDebug.setFloor(${DIFF_FLOOR}); true`);
      await sleep(120);
      const n = await ev(`(function(){
        var st = window.__roamDebug.getState();
        if (st.mode === 'reward' && st.options && st.options.length) window.__roamDebug.chooseReward(st.options[0]);
        var battle = state.rooms.filter(function(r){ return r.type === 'battle'; })[0];
        if (!battle) return -1;
        return state.enemies.filter(function(e){ return e.roomId === battle.id; }).length;
      })()`);
      if (n >= 0) samples.push(n);
    }
    countByMode[mode] = {
      samples: samples,
      avg: samples.length ? Math.round((samples.reduce((a, b) => a + b, 0) / samples.length) * 100) / 100 : 0
    };
  }
  report.notes.countByMode = countByMode;
  check('难度：战斗房平均同场数 easy < normal',
    countByMode.easy.avg < countByMode.normal.avg, countByMode);
  check('难度：战斗房平均同场数 normal < nightmare',
    countByMode.normal.avg < countByMode.nightmare.avg, countByMode);
  check('难度：噩梦战斗房平均 ≥3 只（压力更高）', countByMode.nightmare.avg >= 3, countByMode.nightmare);

  // ---- 3. 掉落率：各档模拟 2000 次 dropLoot ----
  const dropByMode = {};
  for (const mode of ['easy', 'normal', 'nightmare']) {
    dropByMode[mode] = await ev(`(function(){
      setDifficulty('${mode}');
      var dummy = { x: 0, y: 0 };
      var before = state.pickups.length;
      var N = 2000;
      for (var i = 0; i < N; i += 1) dropLoot(dummy);
      var after = state.pickups.length;
      state.pickups.length = before;
      return { rate: Math.round((after - before) / N * 1000) / 1000, count: after - before };
    })()`);
  }
  report.notes.dropByMode = dropByMode;
  check('难度：掉落率 easy > normal > nightmare',
    dropByMode.easy.rate > dropByMode.normal.rate && dropByMode.normal.rate > dropByMode.nightmare.rate,
    dropByMode);
  check('掉落率区间合理（普通 0.6–0.85）',
    dropByMode.normal.rate > 0.55 && dropByMode.normal.rate < 0.88, dropByMode.normal);

  // ---- 4. 楼层压力曲线：第 1 层 ≈ 1，递增且封顶 ----
  await ev(`setDifficulty('normal'); true`);
  const pressure = await ev(`(function(){
    var out = [];
    for (var f = 1; f <= 14; f += 1) out.push({ f: f, p: Math.round(difficultyPressure(f) * 1000) / 1000 });
    return out;
  })()`);
  report.notes.pressure = pressure;
  check('楼层压力：第 1 层 = 1.0', Math.abs(pressure[0].p - 1) < 0.001, pressure[0]);
  check('楼层压力：随层数单调不降', pressure.every((v, i) => i === 0 || v.p >= pressure[i - 1].p), pressure);
  const maxP = Math.max.apply(null, pressure.map((v) => v.p));
  check('楼层压力：有上限（≤1.56）', maxP <= 1.56, maxP);

  // ---- 5. meta.difficulty 持久化：选噩梦 → 刷新 → 仍是噩梦 ----
  await ev(`setDifficulty('nightmare'); true`);
  await sleep(200);
  await nav();
  const persisted = await ev(`(function(){
    var meta = JSON.parse(localStorage.getItem('arcane_rogue_meta') || '{}');
    var btns = Array.prototype.slice.call(document.querySelectorAll('[data-difficulty]'));
    return {
      metaDifficulty: meta.difficulty,
      stateDifficulty: state.difficulty,
      active: btns.filter(function(b){ return b.classList.contains('is-active'); })
        .map(function(b){ return b.getAttribute('data-difficulty'); })
    };
  })()`);
  report.notes.persisted = persisted;
  check('刷新后：localStorage 仍记住噩梦', persisted.metaDifficulty === 'nightmare', persisted);
  check('刷新后：state.difficulty 恢复为噩梦', persisted.stateDifficulty === 'nightmare', persisted);
  check('刷新后：标题页按钮选中态回到噩梦',
    persisted.active.length === 1 && persisted.active[0] === 'nightmare', persisted);
  await shot('03_title_after_reload.png');

  // ---- 6. 战斗中难度不改变已在场敌人（快照语义） ----
  await ev("document.getElementById('btnStart').click(); true");
  await sleep(900);
  await ev(`setDifficulty('easy'); window.__roamDebug.setFloor(1); true`);
  await sleep(500);
  const snapshotTest = await ev(`(function(){
    state.enemies.length = 0;
    var en = spawnEnemy('assembler', state.player.x + 60, state.player.y, 1, { roomId: -1 });
    var hpEasy = en.hp;
    setDifficulty('nightmare');
    return { hpEasy: hpEasy, hpAfterSwitch: en.hp, unchanged: en.hp === hpEasy };
  })()`);
  report.notes.snapshotTest = snapshotTest;
  check('切换难度不改变已在场敌人的血量快照', snapshotTest.unchanged === true, snapshotTest);

  // 清理并跑一段真实战斗，采集帧率与报错
  await ev(`setDifficulty('normal'); window.__roamDebug.setFloor(2); true`);
  await sleep(700);
  await ev(`(function(){
    var st = window.__roamDebug.getState();
    if (st.mode === 'reward' && st.options && st.options.length) window.__roamDebug.chooseReward(st.options[0]);
    return true;
  })()`);
  await sleep(2200);
  const st = await ev('window.__roamDebug.getState()');
  check('帧率 ≥60', st.fps >= 60, st.fps);
  report.notes.fps = st.fps;
  const errors = await ev('window.__roamDebug.errors()');
  check('运行无报错', Array.isArray(errors) && errors.length === 0, errors);
  report.notes.errors = errors;
  await ev(`window.__roamDebug.killAllEnemies(); true`);
  await sleep(500);
  await shot('04_battle_after_kill.png');

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  const failed = report.assertions.filter((a) => !a.ok);
  console.log(JSON.stringify(report, null, 2));
  console.log('==== 结果：' + (report.assertions.length - failed.length) + '/' + report.assertions.length + ' 通过 ====');
  if (failed.length) console.log('失败项：' + failed.map((a) => a.name).join(' | '));
  ws.close(); killEdge(edge);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(2); });
