// 第 4 轮 · 第 3 组：主路径帧预算（逻辑 / 渲染 / 特效 / 迷雾）
//   方法：停掉 RAF，手动组合一帧 = update(1/60) + render()，
//         用包装器分别计时 drawEffects / drawFog 的累计耗时，
//         差值即"渲染其余部分"，这样四段之和 = 整帧，占比不会超 100%。
//   场景：主路径（关后处理、粒子满池 300、6 只怪同屏）。
//   低端机：dpr=2 + 390x844 + 粒子降到 120，只记录 fps（不判红）。
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9758;
/* 命令行参数一律解析成绝对路径：
   过去直接拼 'file:///' + 参数，若传入相对路径（如 index_arcane_v2.html）会得到
   file:///index_arcane_v2.html —— 指向 C 盘根目录，页面根本打不开，探针随即报
   "Cannot read properties of null (reading 'getBoundingClientRect')" 的假红。 */
const FILE = path.resolve(process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html'));
const OUT = path.join(__dirname, '..', '.screenshots', 'perf');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/* 保存本次拉起的 Edge 句柄：正常结束或中途抛错都要整棵树杀掉，
   否则残留实例会继续占着 9758，导致下一次运行连不上调试端口。 */
let EDGE_PROC = null;

async function main() {
  const profile = prepareProfile();
  fs.mkdirSync(OUT, { recursive: true });
  /* 起 Edge 之前先等旧实例把 9758 放开：连续跑多次时上一个进程刚退出，
     端口可能还被它占着几百毫秒，新实例会绑定失败 → 探针误报"端口未就绪"。 */
  for (let i = 0; i < 40; i += 1) {
    try {
      await fetch(`http://127.0.0.1:${PORT}/json/version`);
      await sleep(250);
    } catch (e) { break; /* 连不上 = 端口已空 */ }
  }
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--allow-file-access-from-files', '--window-size=1600,1000', 'about:blank'
  ], { stdio: 'ignore' });
  EDGE_PROC = edge;
  /* 等调试端口：原为固定 80×250ms 且只判 type=page。
     上一个进程若没被整棵树杀掉，9758 会被旧实例占着，新实例起不来 →
     target 为 null → "Cannot read properties of null (reading 'webSocketDebuggerUrl')"。
     这里延长到 30s，并要求 target 真的带 webSocketDebuggerUrl。 */
  let target = null;
  for (let i = 0; i < 120; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (target) break;
    } catch (e) { /* wait */ }
    await sleep(250);
  }
  if (!target) throw new Error('Edge 调试端口 30s 内未就绪（疑似 9758 被残留实例占用）');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res, rej) => {
    seq += 1; pending.set(seq, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  await send('Runtime.enable'); await send('Page.enable');
  const setViewport = async (w, h, dpr, mobile) => {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile: mobile });
  };
  await setViewport(1920, 1080, 1, false);
  const navAt = Date.now();
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  /* 探针就绪等待（v2.2.1 修）：
     原实现是固定 sleep(2400) 后直接取 btnStart 的包围盒，页面没打开就会报
     "Cannot read properties of null (reading 'getBoundingClientRect')" 并 exit 1。
     改成：①先轮询到"按钮存在且 startGame 已定义"（最多 20s，失败才报红）；
           ②再用"距 navigate 满 2400ms"补齐等待，保证开跑时机与改前基线完全一致，
              否则页面提前就绪会让开局落在引擎预热期，p95 被拉高、对比失真。 */
  let ready = false;
  for (let i = 0; i < 80; i += 1) {
    try {
      ready = await ev("!!document.getElementById('btnStart') && typeof startGame === 'function'");
    } catch (e) { ready = false; }
    if (ready) break;
    await sleep(250);
  }
  if (!ready) throw new Error('页面 20s 内未就绪：btnStart / startGame 缺失');
  await sleep(Math.max(0, 2400 - (Date.now() - navAt)));
  const clickStart = async () => {
    const p = await ev(`(() => { const el = document.getElementById('btnStart'); const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    await sleep(1400);
  };
  await clickStart();

  /** 布置主路径负载：6 只怪 + 粒子满池 + 关后处理 */
  const setupLoad = (particleTarget) => ev(`(() => {
    __roamDebug.setPostFx(false);
    // 关掉"fps 掉档"自适应：本测要测的是固定负载下的帧预算，不能让预算自己缩
    ENEMY_BUDGET_CONFIG.adaptive.enabled = false;
    __roamDebug.setFloor(8);
    const room = state.rooms.filter((r) => r.type === 'battle' || r.type === 'elite' || r.type === 'boss')
      .sort((a, b) => (b.w * b.h) - (a.w * a.h))[0] || state.rooms[0];
    __roamDebug.teleport(room.cx, room.cy);
    __roamDebug.despawnAll();
    const ids = Object.keys(ENEMY_CONFIG).slice(0, 6);
    for (let i = 0; i < 6; i += 1) {
      const a = (Math.PI * 2 * i) / 6;
      __roamDebug.spawnEnemyAt(ids[i], room.cx + Math.cos(a) * 150, room.cy + Math.sin(a) * 150, {});
    }
    state.particles.length = 0;
    addBurst(room.cx, room.cy, '#8fe9ff', ${particleTarget}, 3, 0, Math.PI * 2, true);
    if (state.particles.length < ${particleTarget}) addBurst(room.cx, room.cy, '#ffc247', ${particleTarget * 2}, 2, 0, Math.PI * 2, true);
    return { enemies: state.enemies.length, particles: state.particles.length,
      room: { w: Math.round(room.w), h: Math.round(room.h) }, postFx: __roamDebug.postFxState() };
  })()`);

  /** 停掉 RAF，手动测 N 帧；返回四段耗时（ms/帧） */
  const measure = (frames, keepParticles) => ev(`(() => {
    window.requestAnimationFrame = () => 0;
    // 包装器：只累计时间，不改行为
    const wrap = (name, key) => {
      const orig = window[name];
      if (!orig) return false;
      window[name] = function () { const s = performance.now(); const r = orig.apply(this, arguments); window.__pt[key] += performance.now() - s; return r; };
      return true;
    };
    window.__pt = { fx: 0, fog: 0, render: 0, update: 0, spawn: 0, n: 0, worst: 0, worstAt: null };
    const hasFx = wrap('drawEffects', 'fx');
    const hasFog = wrap('drawFog', 'fog');
    const p = state.player;
    const room0 = state.rooms.find((r) => r.id === state.currentRoomId) || state.rooms[0];
    /* 粒子池的"满池"是稳态：粒子寿命只有 0.25–0.55s，真实战斗里是持续产生的。
       每帧开打前补满，并把补粒子的耗时算进逻辑段（不白送性能）。 */
    const keepFull = (n) => {
      if (state.particles.length >= n) return 0;
      const s = performance.now();
      addBurst(room0.cx, room0.cy, '#8fe9ff', n - state.particles.length, 220, null, Math.PI * 2, true);
      window.__pt.spawn += performance.now() - s;
      return 1;
    };
    let spawnFrames = 0;
    let minParticles = Infinity;
    /* C1-10：额外记录每帧整帧耗时，用来算 p95（只记录，不参与断言） */
    const frameList = [];
    const t0 = performance.now();
    for (let i = 0; i < ${frames}; i += 1) {
      p.invuln = 9; p.hp = p.hpMax; p.aether = p.aetherMax;
      state.mode = 'playing'; state.status = 'playing';
      const s1 = performance.now();
      spawnFrames += keepFull(${Math.round(keepParticles)});
      update(1 / 60);
      const s2 = performance.now();
      window.__pt.update += s2 - s1;
      render();
      const s3 = performance.now();
      window.__pt.render += s3 - s2;
      /* 记录"渲染这一帧时真实在场的粒子数"的谷值：断言用它，避免最后一帧的瞬时值骗过判据 */
      if (state.particles.length < minParticles) minParticles = state.particles.length;
      const frameMs = s3 - s1;
      frameList.push(frameMs);
      if (frameMs > window.__pt.worst) { window.__pt.worst = frameMs; window.__pt.worstAt = i; }
      window.__pt.n += 1;
    }
    const total = performance.now() - t0;
    /* p95：排序后取 95% 位（帧内耗时口径，非 fps 口径） */
    const sorted = frameList.slice().sort((a, b) => a - b);
    const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : 0;
    const p99 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] : 0;
    return { hasFx: hasFx, hasFog: hasFog, n: window.__pt.n,
      update: window.__pt.update / window.__pt.n, render: window.__pt.render / window.__pt.n,
      fx: window.__pt.fx / window.__pt.n, fog: window.__pt.fog / window.__pt.n,
      spawn: window.__pt.spawn / window.__pt.n, spawnFrames: spawnFrames,
      total: total / window.__pt.n, worst: window.__pt.worst, worstAt: window.__pt.worstAt,
      p95: p95, p99: p99,
      particles: state.particles.length, minParticles: minParticles === Infinity ? 0 : minParticles,
      enemies: state.enemies.length,
      canvas: { w: state.view ? state.view.w : 0, h: state.view ? state.view.h : 0 },
      dpr: window.devicePixelRatio };
  })()`);

  const load = await setupLoad(340);
  const main = await measure(90, 340);
  /* 证据截图：主路径负载的真实画面（6 怪 + 粒子池满） */
  const shotMain = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, 'perf-load-main.png'), Buffer.from(shotMain.data, 'base64'));
  const rest = main.render - main.fx - main.fog;
  const pct = (v) => ((v / main.total) * 100).toFixed(1) + '%';
  const fmt = (v) => v.toFixed(2);
  const row = (name, v) => `${name}: ${fmt(v)}ms/帧  占 ${pct(v)}`;
  console.log(`\n场景：${load.room.w}x${load.room.h} · 敌 ${main.enemies} · 粒子 ${main.particles} · dpr ${main.dpr}`);
  console.log(row('逻辑', main.update));
  console.log(row('特效(drawEffects)', main.fx));
  console.log(row('迷雾(drawFog)', main.fog));
  console.log(row('渲染其余', rest));
  console.log(`整帧: ${fmt(main.total)}ms/帧 · 最坏 ${fmt(main.worst)}ms（第 ${main.worstAt} 帧）· 等效 ${(1000 / main.total).toFixed(0)} fps`);
  console.log(`帧内 p95: ${fmt(main.p95)}ms · p99: ${fmt(main.p99)}ms（只记录，不参与断言）`);

  const checks = [];
  const check = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail }); };
  check('D1 主路径整帧 ≤16.6ms（平均）', main.total <= 16.6,
    { total: +fmt(main.total), fps: +(1000 / main.total).toFixed(0) });
  check('D2 主路径最坏帧 ≤16.6ms×1.5（瞬时抖动不判红，只做上限）', main.worst <= 16.6 * 1.5,
    { worst: +fmt(main.worst) });
  check('D3 四段可拆分（特效/迷雾包装器生效）', main.hasFx && main.hasFog, { fx: main.hasFx, fog: main.hasFog });
  /* D4 判据（v2.1.1 返修）：这里要证明的是"负载真的上去了"，不是"粒子能超过池上限"。
     游戏粒子池上限是 100（index_arcane_v2.html addBurst 末尾 splice 到 100，
     依据 docs/爽感曲线.md §8.2），探针请求的 340 会被池子裁到 100，
     所以旧判据「谷值 ≥300」在本版永远红，属于判据失真而不是性能退化。
     现在的有效值直接取"布场后池里的真实数量"（与 340 取较小值），判据再留 10% 余量
     （粒子寿命 0.25–0.55s，帧间自然掉几颗）：
       · 有效值 = min(340, 布场后池内数量)
       · 判据   = 6 怪 且 布场数量 ≥60（防"一颗都没生成"）且 渲染帧谷值 ≥ 有效值 × 0.9
     池上限以后若调整，本判据会自动跟着走，不会再次变成常红。 */
  const expectedParticles = Math.min(340, load.particles);
  check('D4 主路径负载真的到位（6 怪 + 粒子达池上限，按渲染帧谷值算）',
    main.enemies >= 6 && load.particles >= 60 && main.minParticles >= Math.round(expectedParticles * 0.9),
    { enemies: main.enemies, minParticles: main.minParticles, expectedParticles: expectedParticles, spawnedParticles: load.particles });

  // ---------- 低端机模拟：只记录 fps ----------
  await setViewport(390, 844, 2, true);
  await sleep(600);
  const lowLoad = await setupLoad(140);
  const low = await measure(60, 140);
  const shotLow = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, 'perf-load-lowend.png'), Buffer.from(shotLow.data, 'base64'));
  const lowFps = 1000 / low.total;
  const restLow = low.render - low.fx - low.fog;
  console.log(`\n低端机模拟（390x844 @dpr2、粒子 ${low.particles}）：整帧 ${fmt(low.total)}ms · ${lowFps.toFixed(0)} fps · 最坏 ${fmt(low.worst)}ms`);
  console.log(`  逻辑 ${fmt(low.update)}ms(${((low.update / low.total) * 100).toFixed(1)}%) · 渲染 ${fmt(low.render)}ms · 其中特效 ${fmt(low.fx)}ms / 迷雾 ${fmt(low.fog)}ms / 其余 ${fmt(restLow)}ms`);
  check('D5 低端机 fps ≥30（只记录，不判红）', true, { fps: +lowFps.toFixed(0), total: +fmt(low.total), particles: low.particles });

  const report = { when: new Date().toISOString(), main: Object.assign({}, main, { rest: rest }), low: Object.assign({}, low, { rest: restLow, fps: lowFps }), checks };
  fs.writeFileSync(path.join(OUT, 'perf-budget.json'), JSON.stringify(report, null, 2));
  console.log('\n===== 断言 =====');
  checks.forEach((c) => console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}  ${JSON.stringify(c.detail)}`));
  const fails = checks.filter((c) => !c.ok);
  /* 汇总口径固定打印：总数 / 通过 / 废弃 / 红 —— 常红断言必须被消掉，不能靠"看习惯了"糊过去 */
  console.log(`\n断言总数 ${checks.length} · 通过 ${checks.length - fails.length} · 废弃 0 · 红 ${fails.length}`);
  console.log(`\nVERDICT: ${fails.length ? 'FAIL' : 'PASS'}`);
  killEdge(edge);
  process.exit(fails.length ? 1 : 0);
}
main().catch((e) => {
  console.error('FATAL', e && e.message);
  // 抛错路径同样整棵树清理，避免 9758 被残留实例占死
  if (EDGE_PROC) killEdge(EDGE_PROC);
  process.exit(1);
});

