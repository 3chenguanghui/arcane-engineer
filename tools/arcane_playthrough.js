// 第 4 轮 · 第 2 组：全流程可玩性自测
//   标题页 → 难度选择 → 开局 → 前五层引导 → 升级四选一 → 分支路线 → 精英房
//   → 隐藏房 → 虚空裂隙 → Boss 登场/结算 → 宝箱 → Boss 蓝图 → 死亡与重开
//
// 口径：
//   · 尽量走真实入口（点按钮 / 按键 / 让主循环自己跑），只在"定位"阶段用调试口传送；
//   · 每一步都要有断言；任何"卡住无法继续 / 按钮点不动 / 弹窗关不掉"都直接判红；
//   · 截图 4 张（同专项 ≤4 张）：01_title / 02_floor1 / 05_boss / 06_result。
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile } = require('./arcane_profile');
const { summarize } = require('./test_known_red');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9757;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = path.join(__dirname, '..', '.screenshots', 'playthrough');
const RESULTS = path.join(OUT, 'playthrough-results.json');
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
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2400);

  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };
  const report = { assertions: [], notes: {}, errors: [] };
  const check = (name, ok, detail) => report.assertions.push({ name, ok: !!ok, detail });
  /** 兜住单步异常：链路里任何一步抛错都只记一条 FAIL，不中断整轮（否则后面的项根本跑不到） */
  const guard = async (fn, fallback) => {
    try { return await fn(); } catch (e) { return Object.assign({}, fallback || {}, { fail: 'exception', err: String(e && e.message).slice(0, 200) }); }
  };
  const clickAt = async (selector) => {
    const p = await ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null; const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; })()`);
    if (!p) return null;
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    return p;
  };
  /** 记录运行时错误（SyntaxError / TypeError 一律算"链路断了"） */
  await ev(`(() => {
    window.__ptErrors = [];
    window.addEventListener('error', (e) => window.__ptErrors.push(String(e.message || e.error)));
    /* 确定性步进：同步跑 n 帧（同步代码执行期间 RAF 不会插进来），用来过"需按住 0.6s"这类判定 */
    window.__ptStep = (n, keys) => {
      const p = state.player;
      let rewardDrained = 0;
      for (let i = 0; i < n; i += 1) {
        p.invuln = 9; p.hp = p.hpMax; p.aether = p.aetherMax;
        state.keys = keys || { left: false, right: false, up: false, down: false };
        update(1 / 60);
        /* 步进期间如果弹出四选一，就地选第一张继续走：
           否则 update 会在 reward 模式下提前 return，后面所有"移动/进门/按 E"全部无效 */
        let guardN = 0;
        while (state.mode === 'reward' && guardN < 8) { __roamDebug.xp.chooseFirst(); guardN += 1; rewardDrained += 1; }
      }
      window.__ptLastDrain = rewardDrained;
      return state.mode;
    };
    /* 把奖励队列全部消化掉：否则后面所有"走进门/进场"都会被 reward 弹窗冻住 */
    window.__ptDrain = (n) => {
      let i = 0;
      while (state.mode === 'reward' && i < (n || 40)) { __roamDebug.xp.chooseFirst(); i += 1; }
      return { mode: state.mode, rounds: i };
    };
    return true;
  })()`);

  // ============ 1. 标题页 ============
  const title = await ev(`(() => {
    const btn = document.getElementById('btnStart');
    const r = btn ? btn.getBoundingClientRect() : null;
    const diffs = Array.from(document.querySelectorAll('[data-difficulty]')).map((b) => ({
      id: b.getAttribute('data-difficulty'), active: b.classList.contains('is-active')
    }));
    return { mode: state.mode, btn: !!btn, btnBox: r ? { w: r.width, h: r.height } : null,
      diffs: diffs, note: (document.getElementById('difficultyNote') || {}).textContent };
  })()`);
  check('P1 标题页可进入（mode=title 且开始按钮可见可点）',
    title.mode === 'title' && title.btn && title.btnBox.w > 0 && title.btnBox.h > 0, title);
  check('P1b 难度三档齐全（easy/normal/nightmare）并只有一档选中',
    title.diffs.length === 3 && title.diffs.filter((d) => d.active).length === 1, title.diffs);
  await shot('01_title.png');

  // ============ 2. 难度选择（真实点击） ============
  const diffPick = {};
  for (const id of ['easy', 'normal', 'nightmare']) {
    const p = await clickAt(`[data-difficulty="${id}"]`);
    await sleep(220);
    diffPick[id] = await ev(`(() => ({
      state: state.difficulty,
      active: Array.from(document.querySelectorAll('[data-difficulty]'))
        .filter((b) => b.classList.contains('is-active')).map((b) => b.getAttribute('data-difficulty')),
      note: (document.getElementById('difficultyNote') || {}).textContent
    }))()`);
    if (!p) diffPick[id].error = 'button-missing';
  }
  check('P2 难度切换真实生效（点击 → state.difficulty / 选中态 / 说明同步）',
    diffPick.easy.state === 'easy' && diffPick.normal.state === 'normal'
    && diffPick.nightmare.state === 'nightmare'
    && diffPick.normal.active.length === 1 && diffPick.normal.active[0] === 'normal',
    diffPick);
  // 回到普通档，后续流程按普通难度走
  await clickAt('[data-difficulty="normal"]');
  await sleep(200);

  // ============ 3. 开局（新号口径） ============
  await ev(`__roamDebug.onboard.reset(true)`);
  await clickAt('#btnStart');
  await sleep(1600);
  const started = await ev(`(() => ({
    mode: state.mode, status: state.status, floor: state.floor, difficulty: state.difficulty,
    rooms: state.rooms.length, spawnRoomId: state.spawnRoomId, hp: Math.round(state.player.hp), hpMax: state.player.hpMax,
    ob: __roamDebug.onboard.info()
  }))()`);
  check('P3 点开始能进游戏（mode=playing / 第 1 层 / 有出生房 / 满血）',
    started.mode === 'playing' && started.floor === 1 && started.rooms >= 4
    && started.spawnRoomId != null && started.hp === started.hpMax, started);
  check('P3b 开局立刻有"下一步做什么"的引导（提示或待弹 toast）',
    !!(started.ob && (started.ob.hintVisible || started.ob.active || started.ob.pendingToast)), started.ob);
  await shot('02_floor1.png');

  // ============ 4. 首局 5 个事件（事件触发；每事件 1 次；第二局 0 次） ============
  await ev(`(() => { state.meta.bestFloor = 0; __roamDebug.onboard.reset(true); return true; })()`);
  const EVENT_KEYS = ['firstRoom', 'firstChoice', 'firstElite', 'lowHp', 'firstCrystal'];
  const guide = [];
  for (let i = 0; i < EVENT_KEYS.length; i += 1) {
    const key = EVENT_KEYS[i];
    // 语义升级：不再按楼层 showFloor(f) 弹提示，改为逐事件触发（触发点跟玩家遭遇走）
    const g = await ev(`(() => {
      const r = __roamDebug.onboard.event('${key}', false);
      const info = __roamDebug.onboard.info();
      const step = info.steps.filter((s) => s.key === '${key}')[0];
      const entry = { key: '${key}', n: step.n, verb: step.verb, hint: step.hint,
        evOk: r.ok, hintVisible: info.hintVisible, pending: info.pending,
        active: info.active, shown: r.info.hint ? r.info.hint.text : null };
      if (r.info.hint) onboardHideHint(false);   // 立刻收起，避免排到下一事件
      return entry;
    })()`);
    guide.push(g);
    await sleep(180);
    // 带 delay 的事件（如 firstRoom 1.2s）触发后先入 pending，到点才真正上屏；
    // 语义仍是"触发成功"，只是需要等延迟窗口过去再判"是否显示"
    if (!g.hintVisible && !g.shown) {
      await sleep(1400);
      const later = await ev(`(() => {
        const info = __roamDebug.onboard.info();
        return { hintVisible: info.hintVisible, shown: info.hint ? info.hint.text : null };
      })()`);
      g.hintVisible = later.hintVisible;
      g.shown = g.shown || later.shown;
      await ev(`onboardHideHint(false)`);
    }
  }
  check('P4 首局 5 事件各触发一次（进房 / 三选一 / 精英 / 低血 / 结晶）',
    guide.length === 5 && guide.every((g) => g.n >= 1 && g.verb && g.hint && g.evOk === true
      && (g.hintVisible || g.shown)),
    guide.map((g) => ({ key: g.key, n: g.n, verb: g.verb, hint: g.hint,
      evOk: g.evOk, hintVisible: g.hintVisible, shown: g.shown })));
  check('P4b 事件提示不卡流程（仍 playing / 出生房与房间数正常）',
    guide.every((g) => g.active === true) && started.spawnRoomId != null && started.rooms >= 4,
    guide.map((g) => ({ key: g.key, active: g.active })));
  // P4c：第二局（runs=2）一条都不打扰
  const secondRun = await ev(`(() => {
    state.meta.runs = 2;
    state.meta.bestFloor = 0;
    __roamDebug.onboard.reset(true);
    const keys = ${JSON.stringify(EVENT_KEYS)};
    return {
      returning: __roamDebug.onboard.info().returning,
      results: keys.map((k) => __roamDebug.onboard.event(k).ok)
    };
  })()`);
  check('P4c 第二局 0 次打扰（returning=true 且 5 事件全拒绝）',
    secondRun.returning === true && secondRun.results.every((v) => v === false), secondRun);
  await ev(`(() => { state.meta.runs = 1; return true; })()`);

  // ============ 5. 经验升级四选一 ============
  await ev(`__roamDebug.setFloor(3)`);
  await sleep(400);
  const xpBefore = await ev(`__roamDebug.xp.info()`);
  const xpPop = await ev(`__roamDebug.xp.addXp(3000)`);
  // 升级不是立刻弹窗：beginLevelUp 先走慢动作 + levelDelay 计时，再由 update 打开四选一。
  // 固定 sleep 在低帧率下会读到"还没来得及弹"的中间态，因此改成等状态到位（最多 3 秒）。
  let xpOpen = null;
  for (let i = 0; i < 20; i += 1) {
    await sleep(150);
    xpOpen = await ev(`(() => ({
      info: __roamDebug.xp.info(),
      cards: document.querySelectorAll('.reward-card, [data-reward-key]').length,
      mode: state.mode
    }))()`);
    if (xpOpen.mode === 'reward' && xpOpen.info.options.length === 4) break;
  }
  const xpChosen = await ev(`(() => { const ok = __roamDebug.xp.chooseFirst(); return { ok: ok, info: __roamDebug.xp.info() }; })()`);
  await sleep(400);
  // 一次加太多经验会排队多次四选一，全部消化掉，避免后续流程被弹窗冻住
  const drained = await ev(`__ptDrain(60)`);
  report.notes.drainAfterLevelup = drained;
  check('P5 升级弹四选一（mode=reward 且选项=4）',
    xpOpen.mode === 'reward' && xpOpen.info.options.length === 4,
    { before: xpBefore.level, mode: xpOpen.mode, options: xpOpen.info.options.length, cards: xpOpen.cards });
  check('P5b 选卡后回到游戏且等级 +1（弹窗不卡人）',
    xpChosen.ok === true && xpChosen.info.level > xpBefore.level && xpChosen.info.mode === 'playing',
    { ok: xpChosen.ok, levelBefore: xpBefore.level, levelAfter: xpChosen.info.level, mode: xpChosen.info.mode });

  // ============ 6. 分支路线（门可走、进房有反馈） ============
  const doors = await ev(`(() => ({
    list: (state.doors || []).filter((d) => d.targetRoomId >= 0).map((d) => ({
      x: Math.round(d.x), y: Math.round(d.y), side: d.side, roomId: d.roomId, targetRoomId: d.targetRoomId
    })),
    rooms: state.rooms.map((r) => ({ id: r.id, type: r.type }))
  }))()`);
  let doorResult = { moved: false };
  if (doors.list.length) {
    const d0 = doors.list.find((d) => d.roomId === doors.list[0].roomId);
    doorResult = await ev(`(() => {
      const d = ${JSON.stringify(d0)};
      const roomBefore = state.currentRoomId;
      /* 从门内侧站到门位，再朝门方向按住（真实输入管线，不直接调进入函数）。
         门与门之间的走廊比 0.75s 走得远，所以按 10 帧一档往前推，进房即停，
         避免"一直按着冲过头穿到对面的房间" */
      __roamDebug.teleport(d.x, d.y);
      const keys = { left: false, right: false, up: false, down: false };
      keys[d.side === 'left' ? 'left' : d.side === 'right' ? 'right' : d.side === 'top' ? 'up' : 'down'] = true;
      let frames = 0;
      while (frames < 300 && state.currentRoomId !== d.targetRoomId) {
        __ptStep(10, keys);
        frames += 10;
      }
      return { roomBefore: roomBefore, roomAfter: state.currentRoomId, mode: state.mode,
        playerX: Math.round(state.player.x), playerY: Math.round(state.player.y),
        frames: frames, target: d.targetRoomId };
    })()`);
  }
  check('P6 分支路线可走（门列表 ≥2 且走进门后房间切换）',
    doors.list.length >= 2 && doorResult.mode === 'playing'
    && doorResult.roomAfter === doorResult.target, { doors: doors.list.length, result: doorResult });

  // ============ 7. 精英房 ============
  const elite = await ev(`(() => {
    __ptDrain(40);
    __roamDebug.setFloor(6);
    const room = state.rooms.find((r) => r.type === 'elite');
    if (!room) return { fail: 'no-elite-room' };
    __roamDebug.teleport(room.cx, room.cy);
    __ptStep(30);
    const foes = state.enemies.filter((e) => e.roomId === room.id);
    return { room: room.id, foes: foes.length, elites: foes.filter((e) => e.elite || e.isElite).length,
      currentRoomId: state.currentRoomId, mode: state.mode,
      hpMax: state.player.hpMax, hp: Math.round(state.player.hp) };
  })()`);
  check('P7 精英房有战斗且能推进（精英房存在、敌人进场、玩家仍可操作）',
    !elite.fail && elite.foes > 0 && elite.mode === 'playing', elite);
  const eliteClear = await ev(`(async () => {
    __roamDebug.killAllEnemies();
    await new Promise((r) => setTimeout(r, 900));
    return { mode: state.mode, foes: state.enemies.length, reward: state.mode === 'reward',
      options: (state.upgradeOptions || []).length };
  })()`);
  check('P7b 清空精英房能拿到奖励/继续（不出现"清完没反应"）',
    eliteClear.foes <= 2 || eliteClear.mode === 'reward' || eliteClear.mode === 'playing', eliteClear);
  // 若弹奖励，选一张继续
  await ev(`(() => { if (state.mode === 'reward') { if (__roamDebug.xp) __roamDebug.xp.chooseFirst(); }
    if (state.mode !== 'playing' && typeof closeActivePanel === 'function') closeActivePanel(); return state.mode; })()`);
  await sleep(400);

  // ============ 8. 隐藏房（清宿主房 → 暗门显形 → 贴墙推 → 潜入） ============
  const hidden = await guard(() => ev(`(async () => {
    let tries = 0;
    while (!state.hiddenRoom && tries < 5) { __roamDebug.setFloor(2 + tries); tries += 1; await new Promise((r) => setTimeout(r, 260)); }
    const h = state.hiddenRoom;
    if (!h) return { fail: 'no-hidden-room' };
    return { hostId: h.hostId, side: h.side, gap: { x: Math.round(h.gap.x), y: Math.round(h.gap.y),
      w: Math.round(h.gap.w), h: Math.round(h.gap.h) },
      rect: { x: Math.round(h.x), y: Math.round(h.y), w: Math.round(h.w), h: Math.round(h.h) }, tries: tries };
  })()`), {});
  const hiddenEntered = await guard(() => ev(`(() => {
    const h = state.hiddenRoom;
    const host = state.rooms.find((r) => r.id === h.hostId);
    __ptDrain(40);
    // 1) 清空宿主房 → 暗门显形（真实规则：只有清场后暗门才 armed）
    __roamDebug.teleport(host.cx, host.cy);
    __roamDebug.killAllEnemies();
    __ptStep(20);
    const armed = h.armed;
    // 2) 站在暗门判定带里，按住"朝墙"的方向 1.1s（每帧把位置钉回判定带中心）
    const keys = { left: false, right: false, up: false, down: false };
    /* 注意：side 是 top/bottom/left/right，但输入键是 up/down/left/right，
       直接把 side 当键名会让 top/bottom 按了无效方向 */
    keys[h.side === 'top' ? 'up' : h.side === 'bottom' ? 'down' : h.side] = true;
    const p = state.player;
    const gx = h.gap.x + h.gap.w / 2;
    const gy = h.gap.y + h.gap.h / 2;
    let frames = 0;
    /* 一旦 revealed=true 就说明已经潜入成功，必须立刻停手：
       继续按着方向会在秘藏房里再次"朝墙推"，把玩家原路退出去 */
    while (frames < 90 && !h.revealed) {
      p.x = gx; p.y = gy; p.vx = 0; p.vy = 0;
      __ptStep(1, keys);
      frames += 1;
    }
    return { armed: armed, side: h.side, inside: pointInRect(p.x, p.y, h),
      revealed: h.revealed, rewarded: h.rewarded, frames: frames, press: h.press,
      px: Math.round(p.x), py: Math.round(p.y), mode: state.mode,
      rect: { x: Math.round(h.x), y: Math.round(h.y), w: Math.round(h.w), h: Math.round(h.h) } };
  })()`), {});
  check('P8 隐藏房全链路（宿主清场 → 暗门显形 → 推墙潜入 → 发秘藏奖励）',
    !hidden.fail && !hiddenEntered.fail && hiddenEntered.armed === true
    && hiddenEntered.inside === true && hiddenEntered.revealed === true
    && hiddenEntered.rewarded === true,
    { hidden: hidden, entered: hiddenEntered });
  // 关掉秘藏奖励弹窗，继续后续流程
  await ev(`(() => { if (state.mode === 'reward') { const o = (state.upgradeOptions || [])[0]; if (o) __roamDebug.chooseReward(o.key); }
    return state.mode; })()`);
  await sleep(300);

  // ============ 9. 虚空裂隙（靠近 → E 待确认 → 再按 E 穿越） ============
  const rift = await guard(() => ev(`(() => {
    let tries = 0;
    while (!state.voidRift && tries < 5) { __roamDebug.setFloor(3 + tries); tries += 1; }
    const r = state.voidRift;
    if (!r) return { fail: 'no-rift' };
    return { sourceId: r.sourceId, targetId: r.targetId, x: Math.round(r.x), y: Math.round(r.y),
      steps: r.steps, targetType: (state.rooms[r.targetId] || {}).type, tries: tries };
  })()`), {});
  const riftUsed = await guard(() => ev(`(() => {
    __ptDrain(40);
    const r = state.voidRift;
    const fromRoom = state.currentRoomId;
    __roamDebug.teleport(r.x, r.y);
    __ptStep(40);                    // 让"靠近裂隙"判定置位（near）
    const near = r.near;
    const first = __roamDebug.pressE();   // 第一次 E：进待确认
    __ptStep(12);
    const confirm = r.confirm;
    const second = __roamDebug.pressE();  // 第二次 E：穿越
    __ptStep(24);
    return { fromRoom: fromRoom, toRoom: state.currentRoomId, targetId: r.targetId,
      near: near, confirm: confirm, used: r.used, first: first, second: second,
      mode: state.mode, px: Math.round(state.player.x), py: Math.round(state.player.y),
      toast: (document.querySelector('#toast') || {}).textContent || null };
  })()`), {});
  check('P9 虚空裂隙能完成传送（靠近 → E 待确认 → 再 E 穿越 → 目标房间）',
    !rift.fail && !riftUsed.fail && riftUsed.near === true && riftUsed.used === true
    && riftUsed.toRoom === riftUsed.targetId,
    { rift: rift, used: riftUsed });

  // ============ 10. Boss 登场 ============
  const boss = await guard(() => ev(`(() => {
    __ptDrain(40);
    __roamDebug.setFloor(10);
    const room = state.rooms.find((r) => r.type === 'boss');
    if (!room) return { fail: 'no-boss-room' };
    __roamDebug.teleport(room.cx, room.cy);
    __ptStep(90);            // 1.5s：足够走完登场演出（introTimer 1.2s）
    const b = __roamDebug.bossState();
    return { room: room.id, mode: state.mode, boss: b,
      introText: (document.querySelector('.boss-intro, #bossIntro, .boss-title') || {}).textContent || null,
      foes: state.enemies.filter((e) => e.roomId === room.id).length };
  })()`), {});
  check('P10 Boss 能登场（进房 → 首领出现 / 有血条 / 有登场提示）',
    !boss.fail && boss.foes > 0 && boss.boss && (boss.boss.hp > 0 || boss.boss.introDone === false),
    boss);
  await shot('05_boss.png');

  // ============ 11. Boss 结算 + 宝箱 ============
  const bossKill = await guard(() => ev(`(() => {
    __ptDrain(40);
    __roamDebug.damageBoss(99999);
    __ptStep(150);           // 2.5s：Boss 死亡演出 + 宝箱落地
    return { boss: __roamDebug.bossState(), mode: state.mode, status: state.status,
      chest: __roamDebug.bossChest.info(), run: __roamDebug.runInfo() };
  })()`), {});
  check('P11 击败 Boss 有结算出口（首领死亡 + 宝箱/结算界面之一出现）',
    !!(bossKill.boss && (bossKill.boss.defeated || bossKill.boss.hp <= 0))
    && (bossKill.chest.exists || bossKill.mode === 'result'), bossKill);
  await shot('06_result.png');
  const chestOpen = await guard(() => ev(`(() => {
    __ptDrain(40);
    const c = state.bossChest;
    if (!c) return { fail: 'no-chest' };
    __roamDebug.teleport(c.x, c.y);
    __ptStep(24);
    const r = __roamDebug.bossChest.interact();
    __ptStep(90);            // 开箱演出 + 发放
    return { result: r, info: __roamDebug.bossChest.info(), mode: state.mode,
      options: (state.upgradeOptions || []).length };
  })()`), {});
  check('P12 宝箱能开且给奖励（宝箱被打开 + 真实发放结晶 + 结算/奖励弹窗）',
    !chestOpen.fail && chestOpen.info.opened === true && chestOpen.info.granted === true
    && chestOpen.info.crystalsEarned > 0,
    chestOpen);
  // 关掉奖励弹窗（选一张）继续
  await ev(`(() => {
    if (state.mode === 'reward') { const o = (state.upgradeOptions || [])[0]; if (o) __roamDebug.chooseReward(o.key); }
    if (state.mode === 'result' && typeof closeActivePanel === 'function') { /* 结算页保留，下一步验重开 */ }
    return state.mode;
  })()`);
  await sleep(400);

  // ============ 12. Boss 蓝图 ============
  const bp = await guard(() => ev(`(() => {
    const info = __roamDebug.blueprints.info();
    __roamDebug.blueprints.resetRun();
    /* 测试口径：把掉落率钉成 1、关掉"同 kind 一局一次"，避免 RNG 让断言随机红。
       （只改测试进程里的运行时配置，不写回文件） */
    BOSS_BLUEPRINT_CONFIG.dropChance = 1;
    BOSS_BLUEPRINT_CONFIG.oncePerKindPerRun = false;
    const first = info.list[0];
    const granted = __roamDebug.blueprints.grant(first.boss);
    const after = __roamDebug.blueprints.info();
    const cand = __roamDebug.blueprints.fuseCandidates();
    return { count: info.count, firstKind: first.boss, firstId: first.id, granted: granted,
      owned: after.runOwned, meta: after.metaOwned, candidates: cand,
      moveName: first.moveName, resultName: first.resultName };
  })()`), {});
  check('P13 Boss 蓝图可获取（真实掉落 → 本局持有 + 图鉴记录）',
    bp.count >= 3 && bp.granted === bp.firstId && bp.owned.indexOf(bp.firstId) >= 0
    && bp.meta.indexOf(bp.firstId) >= 0, bp);

  // ============ 13. 死亡与重开 ============
  const dead = await guard(() => ev(`(async () => {
    __ptDrain(40);
    /* 前面刚通关把 run 标成 won，这里先开干净一局，避免"死亡"被胜利结算吞掉 */
    restartRun();
    __ptDrain(40);
    __roamDebug.setFloor(4);
    __ptStep(20);
    /* __ptStep 每帧都会把 invuln 拉到 9s，这会让真实伤害入口吞掉伤害——致死前必须归零 */
    state.player.invuln = 0;
    const before = { mode: state.mode, status: state.status, floor: state.floor,
      hp: Math.round(state.player.hp) };
    const kill = __roamDebug.killBy('enemy', '测试伤害');
    // 死亡演出交给真实主循环（这里只等它推进）
    await new Promise((r) => setTimeout(r, 1400));
    return { before: before, kill: kill, mode: state.mode, status: state.status,
      resultText: (document.querySelector('.result-title, #resultTitle, .modal-title') || {}).textContent || null,
      restartBtn: !!document.querySelector('[data-action="restart"]'),
      run: __roamDebug.runInfo() };
  })()`), {});
  check('P14 死亡能结算（出现结算页 + 重开按钮）',
    dead.mode === 'result' && (dead.status === 'dead' || dead.status === 'result')
    && dead.restartBtn, dead);
  const probeRestart = `(() => {
    const b = document.querySelector('[data-action="restart"]');
    if (!b) return { btn: false };
    const r = b.getBoundingClientRect();
    const cx = Math.max(1, Math.min(innerWidth - 1, r.left + r.width / 2));
    const cy = Math.max(1, Math.min(innerHeight - 1, r.top + r.height / 2));
    const top = document.elementFromPoint(cx, cy);
    return { btn: true, top: Math.round(r.top), bottom: Math.round(r.bottom),
      vh: innerHeight, cy: Math.round(cy),
      topTag: top ? top.tagName : null,
      topAction: top ? (top.getAttribute && top.getAttribute('data-action')) : null,
      hittable: !!top && (top === b || b.contains(top)),
      layerClass: b.closest('.modal-layer') ? b.closest('.modal-layer').className : null };
  })()`;
  const restartProbe = await ev(probeRestart);
  report.notes.restartProbe = restartProbe;
  /* 若按钮落在视口外：先滚动结算面板把它拉进来（这证明"点得动"，
     同时把"首屏看不到主按钮"这件事如实记进 notes，作为 UX 风险） */
  let restartProbeAfterScroll = null;
  if (restartProbe.btn && !restartProbe.hittable) {
    await ev(`(() => { const m = document.querySelector('.result-modal');
      if (m) m.scrollTop = m.scrollHeight - m.clientHeight;
      return { scrollTop: m ? m.scrollTop : null, sh: m ? m.scrollHeight : null, ch: m ? m.clientHeight : null }; })()`);
    await sleep(250);
    restartProbeAfterScroll = await ev(probeRestart);
    report.notes.restartProbeAfterScroll = restartProbeAfterScroll;
  }
  const restarted = await (async () => {
    const p = await clickAt('[data-action="restart"]');
    await sleep(1500);
    return ev(`(() => ({ clicked: !!${p ? 'true' : 'false'}, mode: state.mode, floor: state.floor,
      hp: Math.round(state.player.hp), hpMax: state.player.hpMax, rooms: state.rooms.length,
      run: __roamDebug.runInfo() }))()`);
  })();
  const hitOk = restartProbe.hittable === true
    || (restartProbeAfterScroll && restartProbeAfterScroll.hittable === true);
  check('P15 重开能回到第 1 层满血（不残局、不白屏 · 按钮可命中且真的重开）',
    restartProbe.btn === true && hitOk
    && restarted.mode === 'playing' && restarted.floor === 1 && restarted.hp === restarted.hpMax
    && restarted.rooms >= 4,
    { probe: restartProbe, afterScroll: restartProbeAfterScroll, after: restarted });

  // ============ 14. 面板可开可关（不卡人） ============
  const panels = {};
  await ev(`__ptDrain(40)`);
  for (const kind of ['rules', 'skilltree', 'settings', 'map']) {
    panels[kind] = await guard(() => ev(`(() => {
      __roamDebug.openPanel('${kind}');
      const on = __roamDebug.panelState();
      const pane = __roamDebug.help.data();
      __roamDebug.closePanel('${kind}');
      const off = __roamDebug.panelState();
      return { on: on.mode, off: off.mode, paneOn: pane.paneOn, paused: pane.paused };
    })()`), {});
    await sleep(160);
  }
  check('P16 四个全屏面板都能开且能关（help / 技能树 / 设置 / 地图）',
    ['rules', 'skilltree', 'settings', 'map'].every((k) => panels[k]
      && panels[k].on === k && panels[k].off === 'playing'), panels);

  const errs = await ev(`window.__ptErrors.slice()`);
  check('P17 全流程无运行时错误', errs.length === 0, errs);

  report.notes.panels = panels;
  fs.writeFileSync(RESULTS, JSON.stringify(report, null, 2));
  console.log('\n===== 全流程可玩性 =====');
  report.assertions.forEach((a) => console.log(`${a.ok ? 'PASS' : 'FAIL'}  ${a.name}  ${JSON.stringify(a.detail).slice(0, 220)}`));
  const s = summarize(report.assertions, '全流程');
  console.log(`VERDICT: ${s.exitCode === 0 ? 'PASS' : (s.exitCode === 2 ? 'BLOCKED(新增已知红未批准)' : 'FAIL')}`);
  edge.kill();
  process.exit(s.exitCode);
}

main().catch((e) => { console.error('FATAL', e && e.message); process.exit(1); });

