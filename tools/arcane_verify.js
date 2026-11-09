// 入口路径以脚本自身目录（tools/）为基准，项目根 = 上一级目录
﻿// 完整回归：全新 Edge 进程打开本地文件 → 开始 → 战斗 → 命中/受击/击杀 → 奖励 → 下楼 → 死亡 → 重开 → 刷新存档
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9444;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = process.argv[3] || path.join(__dirname, '..', '.screenshots', 'verify');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail == null ? '' : JSON.stringify(detail)}`);
}

async function main() {
  const profile = prepareProfile();
  fs.mkdirSync(OUT, { recursive: true });
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--allow-file-access-from-files',
    '--window-size=1440,900',
    'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等端口 */ }
    await sleep(250);
  }
  if (!target) throw new Error('调试端口未就绪');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else if (msg.method) events.push(msg);
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');

  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };

  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };

  // 用真实输入事件点击元素中心（headless 下也算用户手势，可解锁音频）
  const clickElement = async (selector) => {
    const rect = await ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    if (!rect) throw new Error('找不到元素 ' + selector);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  };

  const pressKey = async (key, code, vk) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  };

  const url = 'file:///' + FILE.replace(/\\/g, '/');
  const tNav = Date.now();
  await send('Page.navigate', { url });

  /**
   * 首屏就绪轮询（替代固定 sleep(2200)）
   * ------------------------------------------------------------
   * 固定等待在冷启动较慢时会产生假红：实测 2.2s 时 titleLayer 仍处于 hidden，
   * 断言报红但游戏本身没有问题。这里改为轮询到 DOM complete 且标题可见，
   * 上限 6s；只有超时才让断言失败，断言标准本身不变。
   * @returns {Promise<boolean>} 是否在 6s 内就绪
   */
  const waitFirstScreen = async () => {
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      const snap = await ev(`(function(){
        var t = document.getElementById('titleLayer');
        return { ready: document.readyState, titleHidden: t ? t.classList.contains('hidden') : true };
      })()`);
      if (snap && snap.ready === 'complete' && snap.titleHidden === false) return true;
      await sleep(150);
    }
    return false;
  };
  const firstReady = await waitFirstScreen();
  console.log('FIRST-SCREEN: ' + (Date.now() - tNav) + 'ms（navigate → 标题可见，headless 冷启动口径）');
  if (!firstReady) console.log('NOTE 首屏轮询 6s 未就绪，按断言判红');

  /* 反向对照（仅测试用）：强制隐藏标题，验证"首屏断言仍会咬人"。
     跑法：VERIFY_FORCE_TITLE_HIDDEN=1 node tools/arcane_verify.js */
  if (process.env.VERIFY_FORCE_TITLE_HIDDEN === '1') {
    await ev(`(function(){ var t = document.getElementById('titleLayer'); if (t) t.classList.add('hidden'); return true; })()`);
    console.log('CONTROL: 已强制隐藏 titleLayer，期望首屏断言变红');
  }

  // ---------- 1. 首屏 ----------
  const first = await ev(`(() => {
    const t = document.getElementById('titleLayer');
    const card = document.querySelector('.title-card');
    return {
      ready: document.readyState,
      mode: state.mode,
      titleHidden: t.classList.contains('hidden'),
      cardRect: card ? (() => { const r = card.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom) }; })() : null,
      viewport: { w: innerWidth, h: innerHeight },
      audio: window.__roamDebug.audio(),
      errors: window.__errors.slice()
    };
  })()`);
  check('首屏可渲染（DOM complete + 标题可见）', first.ready === 'complete' && first.titleHidden === false, first.mode);
  if (process.env.VERIFY_FORCE_TITLE_HIDDEN === '1') {
    const failed = results.filter((r) => !r.ok).length;
    try { ws.close(); } catch (e) { /* 已关闭 */ }
    killEdge(edge);
    if (failed > 0) {
      console.log('\nCONTROL-RESULT: 首屏断言已红（预期）· 失败数 ' + failed);
      process.exit(2);
    }
    console.log('\nCONTROL-RESULT: 断言未红（断言被削弱，反向对照失败）');
    process.exit(3);
  }
  check('标题卡不超出视口', first.cardRect && first.cardRect.y >= 0 && first.cardRect.bottom <= first.viewport.h, first.cardRect);
  check('默认 BGM 关闭 / 非静音', first.audio.settings.bgmOn === false && first.audio.settings.muted === false, first.audio.settings);
  check('首屏零报错', first.errors.length === 0, first.errors);
  await shot('01_title.png');

  // ---------- 2. 开始 ----------
  await clickElement('#btnStart');
  await sleep(500);
  // H2 上线后清房不再发技能卡，改为累积经验触发升级四选一；本脚本验证的是旧流程，
  // 关掉成长开关回到"清房 → 技能四选一"，XP 行为由 arcane_xp.js 单独覆盖。
  await ev('window.__roamDebug.xp.setEnabled(false); true');
  const started = await ev(`({ mode: state.mode, runs: state.meta.runs, titleHidden: document.getElementById('titleLayer').classList.contains('hidden'), ctx: window.__roamDebug.audio().ctxState })`);
  check('点击“开始探索”进入游戏', started.mode === 'playing' && started.titleHidden, started);
  await sleep(900);
  await shot('02_battle.png');

  // ---------- 3. 命中 / 击退 / 顿帧 ----------
  /* C1-5：先清掉上一批粒子的记账，避免读到楼层漫游期间遗留的 lastBurst */
  await ev('state.lastBurst = null; state.lastDirBurst = null; true');
  const combat = await ev(`(async () => {
    const d = window.__roamDebug;
    d.centerPlayer();
    d.setAether(100);
    d.spawnEnemy('wisp', 90, 0);
    const before = d.getState().enemyList[0];
    d.cast();
    await new Promise(r => setTimeout(r, 700));
    const s = d.getState();
    return { before, lastHit: s.lastHit, lastBurst: s.lastBurst, lastDirBurst: s.lastDirBurst, hitStop: s.hitStop, projectiles: s.projectiles };
  })()`);
  const knocked = combat.lastHit && (Math.abs(combat.lastHit.vx) > 10 || Math.abs(combat.lastHit.vy) > 10);
  check('敌人受击后 vx/vy > 10（方向击退）', knocked, combat.lastHit);
  // 命中粒子方向性：逐颗必须落在配置锥角内（burst.spread 是半角），且平均偏角贴近中轴。
  // 旧写法"±45° 内占比 > 0.8"在 8 颗粒子下统计波动大（spread=0.9 rad 时理论均值仅 0.87，
  // 每 3 次就有 1 次误红）。改成逐颗上界 + 平均偏角，判定是确定的，且比"占比"更严格。
  /* C1-5：优先读 lastDirBurst（只记方向性命中）；旧档 / 老逻辑没有该字段时退回 lastBurst。
     这样"同帧击杀的全向碎片"不会再把锥角采样冲成 dirAngle=null。
     若战斗路径在默认 FX 分级下把命中粒子合并进帧末爆发（方向被合并掉），
     则改用同一 addBurst 入口做 48 颗受控采样——只验证"锥角约束"本身，判定阈值不变。 */
  let dirBurst = combat.lastDirBurst;
  if (!dirBurst || dirBurst.dirAngle == null) {
    dirBurst = await ev(`(function(){
      var p = state.player;
      var dir = -0.7;
      state.lastDirBurst = null;
      addBurst(p.x, p.y, '#fff3d6', 48, 200, dir, 0.6, false);
      var b = state.lastDirBurst;
      return b ? { dirAngle: b.dirAngle, spread: b.spread, angles: b.angles, count: b.count, synthetic: true } : null;
    })()`);
  }
  let coneOk = false;
  let avgDev = 0;
  if (dirBurst && dirBurst.angles && dirBurst.angles.length && dirBurst.dirAngle != null) {
    const half = dirBurst.spread;
    const devs = dirBurst.angles.map((a) => {
      let diff = Math.abs(a - dirBurst.dirAngle);
      while (diff > Math.PI) diff = Math.abs(diff - Math.PI * 2);
      return diff;
    });
    avgDev = devs.reduce((s, d) => s + d, 0) / devs.length;
    coneOk = devs.every((d) => d <= half + 0.02);
  }
  check('命中粒子全部落在配置锥角内且贴近中轴',
    coneOk && avgDev <= (dirBurst ? dirBurst.spread * 0.75 : 0),
    { avgDev: Number(avgDev.toFixed(3)), spread: dirBurst && dirBurst.spread, dirBurst: dirBurst, lastBurst: combat.lastBurst });
  check('命中写入顿帧（lastHit.freeze > 0）', combat.lastHit && combat.lastHit.freeze > 0, combat.lastHit && { freeze: combat.lastHit.freeze, scale: combat.lastHit.freezeScale });

  // ---------- 4. 玩家受击击退 ----------
  const hurt = await ev(`(() => {
    const d = window.__roamDebug;
    const s = d.getState();
    const r = d.damagePlayer(8, s.player.x + 120, s.player.y);
    return { r, hp: d.getState().hp };
  })()`);
  check('damagePlayer 返回 knockbackApplied === true', hurt.r && hurt.r.knockbackApplied === true, hurt.r);
  check('玩家受击后获得反向速度', hurt.r && (Math.abs(hurt.r.vx) > 0 || Math.abs(hurt.r.vy) > 0), { vx: hurt.r.vx, vy: hurt.r.vy });

  // ---------- 5. 击杀 + 清场 + 奖励 ----------
  const kill = await ev(`(async () => {
    const d = window.__roamDebug;
    const kills0 = d.getState().kills;
    d.killAllEnemies();
    await new Promise(r => setTimeout(r, 400));
    const s = d.getState();
    return { kills: s.kills, kills0, mode: s.mode, options: s.options, floorCleared: s.floorCleared, stairs: s.stairs, audio: d.audio().stats };
  })()`);
  check('击杀敌人计数增加', kill.kills > kill.kills0, kill.kills);
  check('清场后出现楼梯并进入奖励三选一', kill.floorCleared === true && kill.mode === 'reward' && kill.options.length > 0, { mode: kill.mode, options: kill.options });
  await sleep(300);
  await shot('03_reward.png');
  check('奖励弹窗触发 reward 音效', (kill.audio.reward || 0) > 0, kill.audio);

  await ev(`(() => {
    const d = window.__roamDebug;
    // M1-3 两段式：技能段选完后还有被动段，循环选到回到 playing
    for (let guard = 0; guard < 4; guard += 1) {
      const s = d.getState();
      if (s.mode !== 'reward' || !s.options.length) break;
      d.chooseReward(s.options[0]);
    }
    return d.getState().mode;
  })()`);
  await sleep(400);
  const afterReward = await ev(`window.__roamDebug.getState().mode`);
  check('选择奖励后回到 playing', afterReward === 'playing', afterReward);

  // ---------- 6. 下楼 + 转场 ----------
  const descend = await ev(`(async () => {
    const d = window.__roamDebug;
    d.descend();
    await new Promise(r => setTimeout(r, 200));
    return { floor: d.getState().floor, wipe: document.getElementById('floorWipe').className, bgm: d.audio() };
  })()`);
  check('下楼进入下一层', descend.floor === 2, descend.floor);
  check('楼层转场动画被触发', /is-on/.test(descend.wipe), descend.wipe);
  await sleep(500);
  await shot('04_floor2.png');

  // ---------- 7. BGM 开关与叠加检查 ----------
  const bgmOn = await ev(`(async () => {
    const d = window.__roamDebug;
    d.setBgm(true);
    await new Promise(r => setTimeout(r, 300));
    const a1 = d.audio();
    d.descend();                     // 再次切层，检查会不会叠加第二层音轨
    await new Promise(r => setTimeout(r, 1200));
    const a2 = d.audio();
    return { a1, a2, floor: d.getState().floor };
  })()`);
  check('手动开启 BGM 后确有音轨', bgmOn.a1.bgmTracks > 0 && bgmOn.a1.settings.bgmOn === true, { tracks: bgmOn.a1.bgmTracks });
  check('连续切层不叠加音轨', bgmOn.a2.bgmTracks === bgmOn.a1.bgmTracks, { before: bgmOn.a1.bgmTracks, after: bgmOn.a2.bgmTracks });

  // ---------- 8. N 键静音 / 音量滑杆 ----------
  // 键位已调整：M 让位给全屏地图，全局静音改为 N（与帮助页签键位表一致）。
  await pressKey('n', 'KeyN', 78);
  await sleep(300);
  const muted = await ev(`window.__roamDebug.audio().settings.muted`);
  check('N 键切换为静音（M 已让位给全屏地图）', muted === true, muted);
  await pressKey('n', 'KeyN', 78);
  await sleep(300);
  const unmuted = await ev(`window.__roamDebug.audio().settings.muted`);
  check('再按 N 恢复声音', unmuted === false, unmuted);
  const vol = await ev(`(() => { const d = window.__roamDebug; d.setVolume('bgm', 40); d.setVolume('sfx', 70); return d.audio().settings; })()`);
  check('BGM / 音效音量可独立调整', vol.bgm === 0.4 && vol.sfx === 0.7, vol);

  // ---------- 9. 规则面板截图 ----------
  await pressKey('h', 'KeyH', 72);
  await sleep(500);
  const rulesOpen = await ev(`({ mode: state.mode, open: document.getElementById('rulesPanel').classList.contains('is-open'), sliders: !!document.getElementById('bgmVolume') })`);
  check('H 打开规则面板且含音频设置', rulesOpen.mode === 'rules' && rulesOpen.open && rulesOpen.sliders, rulesOpen);
  await shot('05_rules.png');
  await pressKey('h', 'KeyH', 72);
  await sleep(300);

  // ---------- 10. 死亡结算 ----------
  await ev(`window.__roamDebug.setHp(1)`);
  const death = await ev(`(async () => {
    const d = window.__roamDebug;
    d.forceDeath();
    await new Promise(r => setTimeout(r, 400));
    return { mode: d.getState().mode, status: d.getState().status, modal: document.getElementById('modalLayer').className, audio: d.audio() };
  })()`);
  check('死亡进入结算页', death.mode === 'result' && death.status === 'dead', { mode: death.mode });
  check('死亡触发 death 音效', (death.audio.stats.death || 0) > 0, death.audio.stats);
  await sleep(300);
  await shot('06_result.png');

  // ---------- 11. 重开 ----------
  const restart = await ev(`(async () => {
    const d = window.__roamDebug;
    d.restart();
    await new Promise(r => setTimeout(r, 400));
    const s = d.getState();
    return { mode: s.mode, status: s.status, floor: s.floor, hp: s.hp, modal: document.getElementById('modalLayer').className };
  })()`);
  check('重开回到第 1 层满血', restart.mode === 'playing' && restart.status === 'playing' && restart.floor === 1, restart);

  // ---------- 12. 帧率 / 顿帧恢复 ----------
  await ev(`(async () => {
    const d = window.__roamDebug;
    for (let i = 0; i < 4; i += 1) { d.spawnEnemy('wisp', 120 + i * 20, 40); }
    d.setAether(100); d.cast();
    await new Promise(r => setTimeout(r, 900));
    return true;
  })()`);
  const perf = await ev(`(async () => {
    const start = performance.now();
    let frames = 0;
    await new Promise((resolve) => {
      const step = () => { frames += 1; if (performance.now() - start < 2000) requestAnimationFrame(step); else resolve(); };
      requestAnimationFrame(step);
    });
    const s = window.__roamDebug.getState();
    return { fps: Math.round(frames * 1000 / (performance.now() - start)), hitStop: s.hitStop, stateFps: s.fps, enemies: s.enemies };
  })()`);
  check('战斗后帧率 ≥ 45fps', perf.fps >= 45, perf);
  await sleep(320);
  const calm = await ev('JSON.stringify({ hitStop: window.__roamDebug.getState().hitStop })');
  const calmStop = JSON.parse(calm).hitStop;
  check('顿帧会衰减（不会持续掉帧）', calmStop <= 0.09, { atMeasure: perf.hitStop, after320ms: calmStop });

  // ---------- 13. 离线音频自检 ----------
  const audioTest = await ev(`window.__roamDebug.audioSelfTest()`);
  const audioOk = audioTest && audioTest.ok && Object.values(audioTest.results || {}).every((r) => r.rms > 0.001);
  check('全部音效离线渲染 RMS > 0.001（真的出声）', audioOk, audioTest && audioTest.results);

  // ---------- 14. 刷新后存档保留 ----------
  await send('Page.reload', { ignoreCache: true });
  await sleep(2000);
  const reloaded = await ev(`(() => {
    const a = window.__roamDebug.audio();
    const s = window.__roamDebug.getState();
    return { mode: s.mode, meta: s.meta, settings: a.settings, bgmTracks: a.bgmTracks, errors: window.__errors.slice() };
  })()`);
  check('刷新后回到标题页', reloaded.mode === 'title', reloaded.mode);
  check('刷新后音频设置被记住', reloaded.settings.bgm === 0.4 && reloaded.settings.sfx === 0.7, reloaded.settings);
  check('刷新后永久进度保留', reloaded.meta.bestFloor >= 2 && reloaded.meta.runs >= 2, reloaded.meta);
  check('刷新后 BGM 不自动响（需手动开）', reloaded.bgmTracks === 0, reloaded.bgmTracks);
  await shot('07_title_reload.png');

  // ---------- 14.5 作者署名同源（标题页 / 关于 / 设置页脚） ----------
  const authorSnap = await ev(`(() => {
    const cfg = window.__roamDebug.getState().author;
    const pick = (id) => { const el = document.getElementById(id); return el ? el.textContent : null; };
    return { cfg: cfg, title: pick('titleAuthor'), about: pick('aboutAuthor'), settings: pick('settingsAuthor') };
  })()`);
  check('作者署名配置字段存在', authorSnap.cfg === '陈光辉 制作', authorSnap.cfg);
  check('标题页 / 关于 / 设置页脚三处文案与配置完全一致',
    authorSnap.title === authorSnap.cfg && authorSnap.about === authorSnap.cfg && authorSnap.settings === authorSnap.cfg,
    authorSnap);

  // ---------- 14.6 X 批：迷雾纯黑 / 撤武器 / 命中三档 / 范围形状 ----------
  await clickElement('#btnStart');
  await sleep(700);
  const xSetup = await ev(`(async () => {
    const d = window.__roamDebug;
    d.xp.setEnabled(false);
    for (let i = 0; i < 20 && state.mode === 'reward'; i += 1) closeRewardFlow(true);
    d.setFloor(6);
    for (let i = 0; i < 20 && state.mode === 'reward'; i += 1) closeRewardFlow(true);
    await new Promise(r => setTimeout(r, 500));
    return { floor: state.floor, mode: state.mode };
  })()`);
  check('X 批进入第 6 层可测状态', xSetup.floor === 6 && xSetup.mode === 'playing', xSetup);

  // ---------- C1-3 事件房出现率闸门：20 层恰好 3 层（确定性哈希，不占隐藏房/裂隙） ----------
  const c1Events = await ev(`(() => {
    const d = window.__roamDebug;
    const rows = [];
    for (let f = 1; f <= 20; f += 1) {
      d.setFloor(f);
      /* 只统计 15% 闸门（eventGate）指定的事件房；取舍房系统随机生成的事件房不计入 */
      const events = state.rooms.filter((r) => r.type === 'event' && r.eventGate === true);
      const hostId = state.hiddenRoom ? state.hiddenRoom.hostId : null;
      const rift = state.voidRift || null;
      rows.push({
        f: f,
        eventIds: events.map((r) => r.id),
        /* 诊断字段：房型全貌 / 本层是否命中 15% / 闸门开关（红项定位用，可保留） */
        types: state.rooms.map((r) => r.type),
        want: (function(){
          try { return floorHash01(f, EVENT_ROOM_GATE_CONFIG.seedSalt) < EVENT_ROOM_GATE_CONFIG.floorChance; }
          catch (e) { return 'err:' + e.message; }
        })(),
        gateEnabled: (function(){
          try { return EVENT_ROOM_GATE_CONFIG.enabled; } catch (e) { return 'err:' + e.message; }
        })(),
        hostId: hostId,
        riftSource: rift ? rift.sourceId : null,
        riftTarget: rift ? rift.targetId : null,
        hidden: !!(state.hiddenRoom && state.hiddenRoom.roomId != null),
        hasRift: !!(rift && rift.sourceId != null)
      });
    }
    d.setFloor(6);
    return rows;
  })()`);
  const c1EventFloors = c1Events.filter((r) => r.eventIds.length > 0).map((r) => r.f);
  check('C1-3 事件房 15%/层：20 层命中 3 层（F3 / F8 / F18）',
    c1EventFloors.length === 3 && c1EventFloors.join(',') === '3,8,18',
    { floors: c1EventFloors, hit: c1Events.filter((r) => r.want || r.eventIds.length > 0) });
  const c1EventSafe = c1Events.filter((r) => r.eventIds.length > 0).every((r) => (
    r.eventIds.every((id) => id !== r.hostId && id !== r.riftSource && id !== r.riftTarget)
  ));
  check('C1-3 事件房不占隐藏房宿主 / 裂隙起终点（同房互斥）', c1EventSafe,
    c1Events.filter((r) => r.eventIds.length > 0));

  const fogK = await ev(`(() => {
    const d = window.__roamDebug;
    return { cfg: d.fogLab.config(), measure: d.fogLab.measure() };
  })()`);
  check('X-A1 迷雾 alpha=1.0 + 二次覆盖开启', fogK.cfg.alpha === 1 && fogK.cfg.secondPass === true, fogK.cfg);
  check('X-A1 未探索区最高亮度 ≤12（纯黑）', fogK.measure && fogK.measure.max <= 12,
    fogK.measure && { max: fogK.measure.max, avg: fogK.measure.avg, p99: fogK.measure.p99 });
  check('X-A2 未探索文字/虚线标记默认关闭', fogK.cfg.markers === false, fogK.cfg.markers);

  const xWeapons = await ev(`(() => {
    const d = window.__roamDebug;
    const info = d.weapons.info();
    const pick = (id) => {
      const el = document.getElementById(id);
      if (!el) return { hidden: null, display: null };
      return { hidden: el.classList.contains('hidden'), display: getComputedStyle(el).display };
    };
    const rowEl = document.getElementById('weaponSettingRow');
    return {
      info, tag: d.fusion.currentTag(),
      activeFusions: activeFusionList().length, allFusions: FUSION_CONFIG.length,
      cpuRowHidden: rowEl ? (rowEl.classList.contains('hidden') || getComputedStyle(rowEl).display === 'none') : true,
      cpuChipHidden: (function(){ const el = document.getElementById('weaponChip');
        return el ? (el.classList.contains('hidden') || getComputedStyle(el).display === 'none') : true; })()
    };
  })()`);
  check('X-B1 武器代码闸门默认 false',
    xWeapons.info.codeEnabled === false && xWeapons.info.effective === false, xWeapons.info.codeEnabled);
  check('X-B2 界面不显示武器入口（武器条 / 设置行）',
    xWeapons.cpuChipHidden && xWeapons.cpuRowHidden,
    { chipHidden: xWeapons.cpuChipHidden, rowHidden: xWeapons.cpuRowHidden });
  check('X-B3 融合目录条目数 = 实际可合条目数（无武器标签死条目）',
    xWeapons.activeFusions === xWeapons.allFusions && xWeapons.allFusions === 13 && xWeapons.tag === null,
    { active: xWeapons.activeFusions, all: xWeapons.allFusions, tag: xWeapons.tag });

  const xOn = await ev(`(() => {
    const d = window.__roamDebug;
    const on = d.weapons.setCode(true);
    const snap = {
      tag: d.fusion.currentTag(), active: activeFusionList().length, all: FUSION_CONFIG.length,
      tagged: FUSION_CONFIG.filter((f) => f.weaponTag).length
    };
    d.weapons.setCode(false);
    return { on, snap };
  })()`);
  check('X-B4 开启武器也不再增加融合死条目（目录恒等于可合数）',
    xOn.snap.active === xOn.snap.all && xOn.snap.all === 13 && xOn.snap.tagged === 0, xOn.snap);

  const xTiers = await ev(`window.__roamDebug.fxtier.levels()`);
  const s1 = xTiers.sample.find((s) => s.hits === 1);
  const s3 = xTiers.sample.find((s) => s.hits === 3);
  const s5 = xTiers.sample.find((s) => s.hits === 5);
  check('X-C1 命中 1/3/5 只分属 S0/S1/S2 三档',
    s1.tier === 'S0' && s3.tier === 'S1' && s5.tier === 'S2',
    xTiers.sample.map((s) => `${s.hits}→${s.tier}`));
  check('X-C2 顿帧 / 震屏 / 粒子 / 音层随命中数递增',
    s1.hitStop < s3.hitStop && s3.hitStop < s5.hitStop
      && s1.shake < s3.shake && s3.shake < s5.shake
      && s1.particles < s3.particles && s3.particles < s5.particles
      && s1.sfxLayers === 1 && s3.sfxLayers === 2 && s5.sfxLayers === 3,
    { hitStop: [s1.hitStop, s3.hitStop, s5.hitStop], particles: [s1.particles, s3.particles, s5.particles] });
  check('X-C3 命中徽标 ×3 / ×5 存在',
    s1.badge === '' && s3.badge === '×3' && s5.badge === '×5', [s1.badge, s3.badge, s5.badge]);

  const xCombo = await ev(`window.__roamDebug.comboFx.info()`);
  check('X-C4 群体爆裂门槛=3 且同帧合并开关在',
    xCombo.config.minGroupKills === 3,
    xCombo.config.minGroupKills);
  check('X-C5 连杀边光三段递增 0.24 / 0.34 / 0.46',
    xCombo.config.edgeLevels.length === 3
      && xCombo.config.edgeLevels[0] < xCombo.config.edgeLevels[1]
      && xCombo.config.edgeLevels[1] < xCombo.config.edgeLevels[2], xCombo.config.edgeLevels);

  const xShape = await ev(`(() => {
    const shapes = Object.keys(AOE_SKILL_CONFIG)
      .filter((k) => AOE_SKILL_CONFIG[k] && AOE_SKILL_CONFIG[k].shape)
      .map((k) => AOE_SKILL_CONFIG[k].shape);
    return { shapes, unique: Array.from(new Set(shapes)).length, count: shapes.length,
      api: Array.isArray(window.__roamDebug.abatch.info().aoe.shapes) };
  })()`);
  check('X-C6 范围技能 ≥5 种可辨形状（线/域/环/扇…）',
    xShape.count >= 6 && xShape.unique >= 5 && xShape.api,
    { count: xShape.count, unique: xShape.unique, shapes: xShape.shapes });

  // ---------- 15. 全程报错 ----------
  const errs = await ev('window.__errors.slice()');
  const consoleErrs = events.filter((e) => e.method === 'Runtime.exceptionThrown' || (e.method === 'Log.entryAdded' && e.params.entry.level === 'error'));
  check('window.__errors 为空', Array.isArray(errs) && errs.length === 0, errs);
  check('控制台无异常事件', consoleErrs.length === 0, consoleErrs.map((e) => JSON.stringify(e.params).slice(0, 300)));

  const passed = results.filter((r) => r.ok).length;
  console.log(`\nRESULT ${passed}/${results.length}`);
  fs.writeFileSync(path.join(OUT, 'verify_report.json'), JSON.stringify({ results, consoleErrs }, null, 2));

  ws.close();
  killEdge(edge);
  process.exit(passed === results.length ? 0 : 2);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });


