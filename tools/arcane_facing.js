// 入口路径以脚本自身目录（tools/）为基准，项目根 = 上一级目录
﻿// M1 朝向系统专项验收：八方向 / 静止保持 / 开火保持 / 锁定目标 / 撞墙 / 受击 / 设置开关 / 4 姿态截图
//   node arcane_facing.js <html> <截图目录>
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9756;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = process.argv[3] || path.join(__dirname, '..', '.screenshots', 'facing');
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
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2400);
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const shot = async (name, clip) => {
    const params = { format: 'png' };
    if (clip) params.clip = clip;
    const r = await send('Page.captureScreenshot', params);
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };
  const report = { assertions: [], notes: {} };
  const check = (name, ok, detail) => report.assertions.push({ name, ok: !!ok, detail });
  
  /* ---------- 0. 开局：关掉辅助瞄准，避免锁定干扰八方向测试 ---------- */
  await ev("document.getElementById('btnStart').click(); true");
  await sleep(900);
  // H2 升级弹窗会暂停世界、改变朝向采样时机；本脚本只验证八方向朝向，关掉成长开关
  await ev("window.__roamDebug.xp.setEnabled(false); true");
  await ev("window.__roamDebug.setAimMode('off'); true");
  await sleep(300);
  await ev('window.__roamDebug.setMouseAim(0); true');

  /* ---------- 1. 八方向：按住按键 0.4s，读显示朝向 ---------- */
  const dirs = [
    { name: '东 E', keys: { right: true }, deg: 0 },
    { name: '东南 SE', keys: { right: true, down: true }, deg: 45 },
    { name: '南 S', keys: { down: true }, deg: 90 },
    { name: '西南 SW', keys: { left: true, down: true }, deg: 135 },
    { name: '西 W', keys: { left: true }, deg: 180 },
    { name: '西北 NW', keys: { left: true, up: true }, deg: -135 },
    { name: '北 N', keys: { up: true }, deg: -90 },
    { name: '东北 NE', keys: { right: true, up: true }, deg: -45 }
  ];
  const table = [];
  for (const d of dirs) {
    await ev(`window.__roamDebug.setKeys(${JSON.stringify(d.keys)})`);
    await sleep(420);
    const st = await ev('window.__roamDebug.facingState()');
    const expected = ((d.deg + 540) % 360) - 180;
    const diff = Math.abs(((st.deg - expected + 540) % 360) - 180);
    table.push({ 方向: d.name, 期望角度: expected, 实测角度: st.deg, 差值: Number(diff.toFixed(1)), dir: st.dir, 来源: st.source });
    check(`八方向 · ${d.name}`, diff <= 2 && st.source === 'move', { expected, got: st.deg, diff });
  }
  report.notes.eightDirs = table;
  await shot('01_walk_southeast.png');

  /* ---------- 2. 静止保持：松手后 0.7s 朝向不变、不自动归位 ---------- */
  // 先清场，避免敌人接触击退把玩家速度方向写进朝向（曾造成偶发 flake）
  // 注意：这里直接清空敌人列表，不能走 killAllEnemies —— 后者会串联 checkFloorClear()
  // 弹出"清层三选一"奖励弹窗，把世界暂停在 reward 模式，后续所有朝向断言都会读到冻结值
  await ev("(function(){ if (state.enemies.length) state.enemies.length = 0; return 0; })()");
  await sleep(150);
  // 先回到房间中心，避免上一段随机走位把玩家顶到墙上：
  // 贴墙滑动的残余速度会把 makeDirection 改写成单轴方向，导致"静止保持"偶发读到 90°
  const idleSpot = await ev(`(function(){
    var r = state.rooms[state.currentRoomId] || state.rooms[0];
    if (!r) return null;
    state.player.x = r.cx; state.player.y = r.cy;
    state.player.vx = 0; state.player.vy = 0;
    return { x: r.cx, y: r.cy };
  })()`);
  await ev("window.__roamDebug.setKeys({ right: true, down: true }); true");
  await sleep(420);
  const beforeIdle = await ev('window.__roamDebug.facingState()');
  await ev("window.__roamDebug.setKeys({}); window.__roamDebug.setMouseAim(3.14159); true");
  await sleep(750);
  const afterIdle = await ev('window.__roamDebug.facingState()');
  check('静止后保持最后朝向（不被鼠标拽回）',
    Math.abs(((afterIdle.deg - beforeIdle.deg + 540) % 360) - 180) <= 2 && afterIdle.source === 'idle',
    { before: beforeIdle.deg, after: afterIdle.deg, source: afterIdle.source });
  report.notes.idle = { before: beforeIdle, after: afterIdle, spot: idleSpot };

  /* ---------- 3. 开火保持：移动朝北、准心朝东，开火后 0.45s 保持攻击方向 ---------- */
  await ev("window.__roamDebug.setMouseAim(0); window.__roamDebug.setKeys({ up: true }); true");
  await sleep(450);
  const beforeCast = await ev('window.__roamDebug.facingState()');
  const castOk = await ev('window.__roamDebug.setAether(999); window.__roamDebug.cast()');
  await sleep(40);
  const justCast = await ev('window.__roamDebug.facingState()');
  await sleep(240);
  const duringHold = await ev('window.__roamDebug.facingState()');
  // 开火保持是按"世界时间"递减的，慢动作 / 顿帧会把它拉长；
  // 这里改成轮询等到 hold 走完（最多 1.8s 真实时间），避免用固定 sleep 卡边界
  let afterHold = duringHold;
  for (let i = 0; i < 30; i += 1) {
    await sleep(60);
    afterHold = await ev('window.__roamDebug.facingState()');
    if (afterHold.hold <= 0 && afterHold.source !== 'attack') break;
  }
  // 朝向是限速平滑旋转的：hold 归零那一帧还停在攻击角，再等 0.5s 让它转到移动方向
  await sleep(500);
  afterHold = await ev('window.__roamDebug.facingState()');
  const attackDeg = justCast.attackAngle * 180 / Math.PI;
  const diffFromAttack = (st) => Math.abs(((st.deg - attackDeg + 540) % 360) - 180);
  check('开火前：朝移动方向（北）', Math.abs(beforeCast.deg + 90) <= 2 && beforeCast.source === 'move', beforeCast);
  check('开火成功（火球可用）', castOk === true, castOk);
  check('开火瞬间记录攻击方向并进入保持（hold ≈ 0.41s）',
    justCast.source === 'attack' && justCast.hold > 0.3 && justCast.hold <= 0.45, justCast);
  check('开火后 0.28s：身体停在攻击方向',
    diffFromAttack(duringHold) <= 3 && duringHold.source === 'attack' && duringHold.hold > 0, duringHold);
  check('0.45s 之后恢复朝移动方向（北）',
    Math.abs(afterHold.deg + 90) <= 3 && afterHold.source === 'move', afterHold);
  report.notes.attackHold = { beforeCast, justCast, duringHold, afterHold, attackDeg: Number(attackDeg.toFixed(1)) };

  /* ---------- 4. 撞墙：贴墙按输入方向仍按输入算 ---------- */
  const wall = await ev(`(function(){
    var p = state.player, r = p.radius;
    // 从玩家位置向左找一个紧贴墙的可站立点（范围放宽到 500px，避免停在走廊里找不到墙）
    for (var step = 2; step < 500; step += 2) {
      var x = p.x - step;
      if (!isWalkableCircle(x, p.y, r)) {
        for (var back = 2; back <= 30; back += 2) {
          if (isWalkableCircle(x + back, p.y, r)) {
            p.x = x + back; p.y = p.y; p.vx = 0; p.vy = 0;
            return { ok: true, x: p.x, y: p.y };
          }
        }
        return { ok: false, reason: 'no-stand-point' };
      }
    }
    return { ok: false, reason: 'no-wall' };
  })()`);
  if (wall.ok) {
    await ev("window.__roamDebug.setKeys({ left: true }); true");
    await sleep(500);
    const blocked = await ev(`(function(){
      return { facing: window.__roamDebug.facingState(), x: state.player.x, vx: state.player.vx };
    })()`);
    check('撞墙：朝向仍按输入（西 180°），不按实际位移', Math.abs(Math.abs(blocked.facing.deg) - 180) <= 2 && blocked.facing.source === 'move',
      { deg: blocked.facing.deg, vx: blocked.vx });
    report.notes.wall = blocked;
  } else {
    check('撞墙专项：找到贴墙点', false, wall);
  }

  /* ---------- 5. 受击不改朝向 ---------- */
  await ev("window.__roamDebug.setKeys({ right: true }); true");
  await sleep(420);
  const beforeHit = await ev('window.__roamDebug.facingState()');
  await ev('window.__roamDebug.damagePlayer(5)');
  await sleep(120);
  const afterHit = await ev('window.__roamDebug.facingState()');
  check('受击不强行改朝向', Math.abs(((afterHit.deg - beforeHit.deg + 540) % 360) - 180) <= 2,
    { before: beforeHit.deg, after: afterHit.deg });

  /* ---------- 6. 锁定目标：优先级高于移动 ---------- */
  await ev("window.__roamDebug.setKeys({}); window.__roamDebug.setAimMode('weak'); true");
  await sleep(200);
  const enemyId = await ev("window.__roamDebug.spawnEnemy('wanderer', 190, 0)");
  await ev("window.__roamDebug.setMouseAim(0); true");
  await sleep(400);
  const locked = await ev('window.__roamDebug.aimState()');
  await ev("window.__roamDebug.setKeys({ up: true }); true");
  await sleep(450);
  const lockFacing = await ev('window.__roamDebug.facingState()');
  // 玩家在这 450ms 里一直往北走，敌人从"正东"变成"东南"是正常的；
  // 所以期望角度要用"采样那一刻玩家→目标"的真实角度，而不是写死 0°
  const lockTargetDeg = await ev(`(function(){
    var e = state.enemies.filter(function(item){ return item.id === ${locked.targetId}; })[0];
    if (!e) return null;
    return Math.atan2(e.y - state.player.y, e.x - state.player.x) * 180 / Math.PI;
  })()`);
  const lockDiff = lockTargetDeg == null ? 999
    : Math.abs(((lockFacing.deg - lockTargetDeg + 540) % 360) - 180);
  check('有锁定目标时：朝向目标（东），压过移动方向（北）',
    locked.locked === true && lockDiff <= 3 && lockFacing.source === 'lock',
    { locked: locked.locked, facing: lockFacing, targetDeg: lockTargetDeg, diff: lockDiff });
  report.notes.lock = { aim: locked, facing: lockFacing, targetDeg: lockTargetDeg, diff: lockDiff };
  await shot('02_facing_lock.png');

  /* ---------- 7. 「始终朝准心」开关 ---------- */
  await ev("window.__roamDebug.setKeys({}); window.__roamDebug.setAimMode('off'); true");
  await sleep(300);
  await ev("window.__roamDebug.setMouseAim(-1.5708); window.__roamDebug.setKeys({ right: true }); true");
  await sleep(450);
  const followMove = await ev('window.__roamDebug.facingState()');
  await ev("window.__roamDebug.openPanel('settings'); true");
  await sleep(450);
  const settings = await ev(`(function(){
    var t = document.getElementById('alwaysAimToggle');
    return {
      hasToggle: !!t,
      checked: t && t.getAttribute('aria-checked'),
      stateText: (document.getElementById('alwaysAimStateText') || {}).textContent,
      mode: state.mode
    };
  })()`);
  await shot('03_settings_facing.png');
  const toggled = await ev(`(function(){
    document.getElementById('alwaysAimToggle').click();
    return { on: state.meta.alwaysAim, aria: document.getElementById('alwaysAimToggle').getAttribute('aria-checked'),
      text: document.getElementById('alwaysAimStateText').textContent };
  })()`);
  await ev("window.__roamDebug.closePanel('settings'); true");
  await sleep(200);
  // 角色一直在向东走，准心指向会随位置轻微漂移，所以拿 aim.angle 做基准而不是固定 -90°
  const aimFacing = await ev('window.__roamDebug.facingState()');
  const aimNow = await ev('window.__roamDebug.aimState()');
  const aimDeg = aimNow.angle * 180 / Math.PI;
  const aimDiff = Math.abs(((aimFacing.deg - aimDeg + 540) % 360) - 180);
  const moveDiff = Math.abs(((aimFacing.deg - 0 + 540) % 360) - 180);
  check('设置页有「始终朝准心」开关且默认为关', settings.hasToggle === true && settings.checked === 'false', settings);
  check('开关点击后状态与文案同步', toggled.on === true && toggled.aria === 'true' && toggled.text === '始终朝准心', toggled);
  check('打开开关后：朝向准心，压过移动方向（东）',
    aimFacing.source === 'aim' && aimDiff <= 3 && moveDiff >= 45, { aimFacing, aimDeg, aimDiff, moveDiff });
  report.notes.alwaysAim = { followMove, settings, toggled, aimFacing, aimDeg, aimDiff, moveDiff };
  await ev("window.__roamDebug.setAlwaysAim(false); window.__roamDebug.setKeys({}); true");
  await sleep(400);

  /* ---------- 8. 四个姿态截图（正 / 背 / 左 / 右） ---------- */
  await ev("window.__roamDebug.setKeys({}); window.__roamDebug.setAimMode('off'); true");
  await sleep(300);
  const poses = [
    { name: '04_pose_east.png', angle: 0 },
    { name: '05_pose_west.png', angle: Math.PI },
    { name: '06_pose_south.png', angle: Math.PI / 2 },
    { name: '07_pose_north.png', angle: -Math.PI / 2 }
  ];
  for (const p of poses) {
    await ev(`window.__roamDebug.setFacing(${p.angle}); true`);
    await sleep(260);
    const clip = await ev(`(function(){
      var p = state.player, c = state.cam;
      return { x: Math.max(0, p.x - c.x - 130), y: Math.max(0, p.y - c.y - 130), width: 260, height: 260, scale: 3 };
    })()`);
    await shot(p.name, clip);
  }

  /* ---------- 9. 面板打开仍冻结世界与计时（回归） ---------- */
  const e0 = await ev('state.elapsed');
  await ev("window.__roamDebug.openPanel('rules'); true");
  await sleep(500);
  const e1 = await ev('state.elapsed');
  await ev("window.__roamDebug.closePanel('rules'); true");
  check('打开面板时 elapsed 冻结（朝向不会在暂停中乱转）', Math.abs(e1 - e0) < 0.02, { e0, e1 });

  /* ---------- 10. 帧率与错误 ---------- */
  await sleep(300);
  const fps = await ev(`new Promise(function(res){
    var n = 0, t0 = performance.now();
    function tick(){ n += 1; if (performance.now() - t0 < 1000) requestAnimationFrame(tick); else res({ fps: n, ms: performance.now() - t0 }); }
    requestAnimationFrame(tick);
  })`);
  const errors = await ev('window.__roamDebug.errors()');
  check('帧率 ≥ 60', fps.fps >= 60, fps);
  check('无运行时报错', Array.isArray(errors) && errors.length === 0, errors);
  report.notes.fps = fps;
  report.notes.errors = errors;

  const passed = report.assertions.filter((a) => a.ok).length;
  const total = report.assertions.length;
  report.summary = { passed, total, screenshots: OUT };
  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  ws.close();
  killEdge(edge);
  process.exit(passed === total ? 0 : 1);
}

main().catch((err) => { console.error('FAILED', err); process.exit(1); });


