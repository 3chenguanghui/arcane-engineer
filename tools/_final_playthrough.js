/**
 * 收口试玩探针（真实走一遍：第 1 层 → 第 2 层 → 第 3 层首领 → 下楼到第 4 层）
 * ------------------------------------------------------------
 * 为什么要有它：
 *   语法检查只能证明"能编译"，证明不了"能玩"。这个脚本用无头 Edge 真开主文件，
 *   真按 W 键、真进每一间房、真清怪、真开三选一、真走到楼梯按 E，全程收集
 *   console error / 未捕获异常，最后输出 JSON 报告。
 *
 * 用法：
 *   node tools/_final_playthrough.js
 *   产物：.screenshots/final_playthrough/report.json + 关键节点截图
 *
 * 说明：
 *   · 清怪用 killEnemy()（真实击杀流程，含掉落/清房判定），不是直接改数组；
 *   · 传送用 teleportSpiral()：房心/楼梯点常常是墙或装饰，不可站立，
 *     螺旋找最近可站立点，避免"人没站到楼梯边就按 E"的假失败；
 *   · 第 3 层首领先用真实施法打 5 下，再用 damageBoss 分块扣血走完二阶段与死亡流程。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const OUT = path.join(ROOT, '.screenshots', 'final_playthrough');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 启动无头 Edge 并建立 CDP 会话
 * 同时订阅页面异常 / console.error，作为"报错刷屏"的证据
 * @returns {Promise<{ev:Function,shot:Function,send:Function,pushed:Array,close:Function}>}
 */
async function boot() {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = prepareProfile();
  const port = 10320 + Math.floor(Math.random() * 120);
  const proc = spawn(EDGE, [
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--window-size=1600,1000', 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 160; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl) || null;
    } catch (e) { /* 端口还没起来 */ }
    if (target) break;
    await sleep(250);
  }
  if (!target) throw new Error('Edge 调试端口未就绪');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const pushed = [];
  ws.onmessage = (raw) => {
    const m = JSON.parse(raw.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    /* 页面异常（未捕获 throw / Promise reject） */
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails || {};
      pushed.push({
        kind: 'exception',
        text: d.text || '',
        desc: (d.exception && (d.exception.description || d.exception.value)) || '',
        url: d.url || '',
        line: d.lineNumber
      });
    }
    /* console.error / console.assert */
    if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'assert')) {
      const args = (m.params.args || []).map((a) => (
        a.value !== undefined ? String(a.value) : String(a.description || a.type || '')
      ));
      pushed.push({ kind: 'console.' + m.params.type, text: args.join(' ').slice(0, 600) });
    }
    /* 浏览器层错误（资源加载失败等） */
    if (m.method === 'Log.entryAdded' && m.params.entry && m.params.entry.level === 'error') {
      pushed.push({ kind: 'log', text: String(m.params.entry.text || '').slice(0, 400) });
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
  await send('Log.enable');
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });

  /** 在页面里求值（页面异常直接抛出来，便于定位） */
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error('页面求值异常: ' + d.text + ' :: ' + expression.slice(0, 90) + ' :: '
        + ((d.exception && d.exception.description) || ''));
    }
    return r.result.value;
  };
  /** 截图（PNG 落到产物目录） */
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };
  const close = () => {
    try { ws.close(); } catch (e) { /* 忽略 */ }
    try { killEdge(proc); } catch (e) { /* 忽略 */ }
  };

  return { ev, shot, send, pushed, close };
}

/** 轮询等待条件成立（页面内表达式返回真） */
async function waitFor(ev, expr, timeoutMs, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    let v = null;
    try { v = await ev(expr); } catch (e) { v = null; }
    if (v) return v;
    await sleep(250);
  }
  throw new Error('等待超时: ' + label + ' (' + timeoutMs + 'ms)');
}

/**
 * 把界面收敛回 playing：
 * 奖励面板自动选第一张；其他面板关掉；返回最终 mode
 */
async function settle(ev) {
  for (let i = 0; i < 12; i += 1) {
    const mode = await ev('state.mode');
    if (mode === 'playing') return mode;
    if (mode === 'reward') {
      await ev(`(function(){
        var o = (state.upgradeOptions && state.upgradeOptions[0]) || null;
        if (o) { window.__roamDebug.chooseReward(o.key); return true; }
        return false;
      })()`);
      await sleep(500);
      continue;
    }
    if (mode === 'result') return mode;
    await ev('(function(){ try { return window.__roamDebug.closePanel(state.mode); } catch (e) { return false; } })()');
    await sleep(250);
  }
  return ev('state.mode');
}

/**
 * 螺旋找可站立点并传送（房心/楼梯点不可站立时不会被误判为"进不去"）
 * @param {Function} ev 页面求值
 * @param {number} x 目标 x
 * @param {number} y 目标 y
 * @returns {Promise<{ok:boolean,x:number,y:number,dist:number}>} 传送结果与落点到目标的距离
 */
async function teleportSpiral(ev, x, y) {
  const r = await ev(`(function(){
    var pts = [[0,0]];
    var rs = [40, 80, 120, 170, 230, 300];
    for (var k = 0; k < rs.length; k += 1) {
      for (var a = 0; a < 8; a += 1) {
        var ang = Math.PI * 2 * a / 8;
        pts.push([Math.cos(ang) * rs[k], Math.sin(ang) * rs[k]]);
      }
    }
    for (var i = 0; i < pts.length; i += 1) {
      var tx = ${x} + pts[i][0], ty = ${y} + pts[i][1];
      if (window.__roamDebug.teleport(tx, ty)) {
        return { ok: true, x: state.player.x, y: state.player.y };
      }
    }
    return { ok: false, x: state.player.x, y: state.player.y };
  })()`);
  await sleep(260);
  return { ...r, dist: Math.round(Math.hypot(r.x - x, r.y - y)) };
}

/**
 * 清一间房：反复杀该房敌人直到 room.cleared 为真
 * （房间是分波刷怪的，进场立刻杀完会留下后一波，必须等"已清房"标记）
 * @param {Function} ev 页面求值
 * @param {number} roomId 房间 id
 * @param {number} budgetMs 最长等待
 * @returns {Promise<{killed:number,cleared:boolean}>}
 */
async function clearRoomUntilCleared(ev, roomId, budgetMs = 7000) {
  let killed = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < budgetMs) {
    killed += await ev(`(function(){
      var list = state.enemies.filter(function(e){ return e.roomId === ${roomId}; });
      var n = list.length;
      list.forEach(function(e){ killEnemy(e); });
      return n;
    })()`);
    const cleared = await ev(`!!(state.rooms[${roomId}] && state.rooms[${roomId}].cleared)`);
    if (cleared) return { killed, cleared: true };
    await sleep(320);
  }
  return { killed, cleared: false };
}

/**
 * 在楼梯旁按 E 直到真的换层（中间遇到奖励弹窗先收掉）
 * @param {Function} ev 页面求值
 * @param {number} fromFloor 当前层
 * @returns {Promise<{ok:boolean,modeAtPress:string,toast:string,tries:number}>}
 */
async function pressStairsUntilDescend(ev, fromFloor) {
  let toast = '';
  let modeAtPress = '';
  for (let i = 0; i < 4; i += 1) {
    await settle(ev);
    const st = await ev('({x: state.stairs.x, y: state.stairs.y, active: state.stairs.active})');
    await teleportSpiral(ev, st.x, st.y);
    modeAtPress = await ev('state.mode');
    await ev('window.__roamDebug.pressE(); true');
    const ok = await waitFor(ev, `state.floor === ${fromFloor + 1}`, 12000, '换层')
      .then(() => true).catch(() => false);
    toast = await ev('(function(){ var t=document.querySelector(".toast"); return t ? t.textContent : ""; })()');
    if (ok) return { ok: true, modeAtPress, toast, tries: i + 1 };
    await sleep(600);
  }
  return { ok: false, modeAtPress, toast, tries: 4 };
}

/** 主流程 */
async function main() {
  const h = await boot();
  const { ev, shot, pushed } = h;
  const report = { checks: [], floors: [], errors: [] };
  /** 记录一条断言 */
  const check = (name, ok, detail) => {
    report.checks.push({ name, ok: !!ok, detail: detail === undefined ? null : detail });
    console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail === undefined ? '' : '  ' + JSON.stringify(detail)));
  };

  try {
    /* ---------- 0. 载入 ---------- */
    const t0 = Date.now();
    await waitFor(ev, "typeof state !== 'undefined' && state && typeof state.mode === 'string'", 45000, '脚本就绪');
    report.bootMs = Date.now() - t0;
    const ver = await ev('(typeof GAME_CONFIG !== "undefined" && GAME_CONFIG.version) || ""');
    check('载入完成，脚本就绪', true, { bootMs: report.bootMs, version: ver });
    await shot('00_title.png');

    /* ---------- 1. 开局：开始 → 选角色 → 确认 ---------- */
    check('标题页"开始探索"按钮存在', await ev("!!document.getElementById('btnStart')"));
    await ev("document.getElementById('btnStart').click(); true");
    await sleep(600);
    const charOpen = await ev("(function(){ var el=document.getElementById('charLayer'); return !!el && !el.classList.contains('hidden'); })()");
    if (charOpen) {
      /* 点第一张角色卡（监听在 mousedown 上），再点确认 */
      const picked = await ev(`(function(){
        var grid = document.getElementById('charGrid');
        var card = grid && grid.querySelector('button, [role="radio"], .char-card, [data-char-id]');
        if (!card && grid) card = grid.firstElementChild;
        if (card) {
          card.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          card.click();
        }
        var armed = (typeof __charArmed !== 'undefined') ? __charArmed : null;
        var b = document.getElementById('btnCharConfirm');
        if (b) b.click();
        return { card: !!card, armed: armed };
      })()`);
      report.charPick = picked;
    }
    /* 兜底：若仍在标题/选角，直接走游戏内的"选角色"入口 */
    await sleep(700);
    if ((await ev('state.mode')) !== 'playing') {
      if (await ev("(function(){ var el=document.getElementById('charLayer'); return !!el && !el.classList.contains('hidden'); })()")) {
        await ev('(function(){ chooseCharacter(CHARACTER_CONFIG.ids[0]); return true; })()');
      } else {
        await ev('window.__roamDebug.start(); true');
      }
    }
    const mode1 = await waitFor(ev, "state.mode === 'playing'", 25000, '进入 playing').then(() => 'playing').catch(() => 'timeout');
    check('点击开始进入游戏', mode1 === 'playing', { mode: mode1, charPick: report.charPick || null });
    await sleep(900);
    await shot('01_start.png');

    /* ---------- 2. 真实按键移动 ---------- */
    const p0 = await ev('({x: state.player.x, y: state.player.y})');
    await h.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87, nativeVirtualKeyCode: 87 });
    await sleep(520);
    await h.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87, nativeVirtualKeyCode: 87 });
    await sleep(150);
    const p1 = await ev('({x: state.player.x, y: state.player.y})');
    const moved = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    check('W 键能让角色移动', moved > 8, { moved: Math.round(moved) });

    /* ---------- 3. 一层层真实走（第 1、2 层走完就下楼，第 3 层清完房留首领） ---------- */
    for (const floorNo of [1, 2, 3]) {
      const nowFloor = await ev('state.floor');
      const snap = await ev(`(function(){
        var s = state;
        return {
          floor: s.floor, mode: s.mode, hp: Math.round(s.player.hp), hpMax: s.player.hpMax,
          roomCount: s.rooms.length, enemyCount: s.enemies.length,
          rooms: s.rooms.map(function(r){ return { id: r.id, type: r.type, cx: r.cx, cy: r.cy, cleared: !!r.cleared }; })
        };
      })()`);
      check('第 ' + floorNo + ' 层已加载', snap.floor === floorNo && snap.roomCount >= 4, {
        floor: snap.floor, roomCount: snap.roomCount, enemyCount: snap.enemyCount
      });
      const cur = { floor: floorNo, rooms: snap.roomCount, enemiesAtEntry: snap.enemyCount, visited: 0, cleared: 0 };
      report.floors.push(cur);

      const isFinalFloor = floorNo === 3;
      for (const room of snap.rooms) {
        if (room.type === 'start') continue;
        if (isFinalFloor && room.type === 'boss') continue; // 首领留到第 4 步专门打
        const tp = await teleportSpiral(ev, room.cx, room.cy);
        if (!tp.ok) {
          check('第 ' + floorNo + ' 层进入房间 ' + room.id + '（' + room.type + '）', false, { tp });
          continue;
        }
        cur.visited += 1;
        const res = await clearRoomUntilCleared(ev, room.id);
        if (res.cleared) cur.cleared += 1;
        await sleep(110);
      }
      if (nowFloor !== floorNo) { check('第 ' + floorNo + ' 层楼层校验', false, { nowFloor }); break; }
      if (isFinalFloor) break; // 第 3 层：首领与下楼在下面单独做

      {
        let m = await settle(ev);
        if (m !== 'playing' && m !== 'reward') {
          await ev('window.__roamDebug.killAllEnemies(); true');
          await sleep(700);
          m = await settle(ev);
        }
        /* 兜底扫尾：仍有残余怪就再清一遍（走真实 killEnemy） */
        for (let i = 0; i < 4 && (await ev('state.enemies.length')) > 0; i += 1) {
          await ev('window.__roamDebug.killAllEnemies(); true');
          await sleep(450);
        }
        const left = await ev('state.enemies.length');
        check('第 ' + floorNo + ' 层清场后回到 playing', m === 'playing', { mode: m });
        check('第 ' + floorNo + ' 层敌人已清空', left === 0, { left });
        await shot('0' + (floorNo + 1) + '_floor' + floorNo + '_clear.png');

        /* 真实走到楼梯旁按 E（遇到奖励弹窗先收掉再按） */
        const st = await ev('({x: state.stairs.x, y: state.stairs.y, active: state.stairs.active})');
        check('第 ' + floorNo + ' 层楼梯已激活', st.active === true, st);
        const dt = await pressStairsUntilDescend(ev, floorNo);
        const after = await ev('({floor: state.floor, mode: state.mode, hp: Math.round(state.player.hp), hpMax: state.player.hpMax})');
        check('第 ' + floorNo + ' 层按 E 成功下楼', dt.ok && after.floor === floorNo + 1,
          { ...dt, after });
        cur.descend = { ...after, ...dt };
      }
    }

    /* ---------- 4. 第 3 层首领 ---------- */
    const cur3 = report.floors.find((f) => f.floor === 3);
    const f3 = await ev(`(function(){
      var bossRoom = state.rooms.find(function(r){ return r.type === 'boss'; }) || null;
      return { floor: state.floor, bossRoom: bossRoom ? { id: bossRoom.id, cx: bossRoom.cx, cy: bossRoom.cy } : null,
               boss: window.__roamDebug.bossState() };
    })()`);
    check('第 3 层存在首领房', f3.floor === 3 && !!f3.bossRoom, { floor: f3.floor, bossRoom: f3.bossRoom });
    if (f3.bossRoom) {
      /* 先收掉第 3 层探索途中残留的奖励弹窗，再进首领房触发登场 */
      const mBefore = await settle(ev);
      check('进首领房前界面处于 playing', mBefore === 'playing', { mode: mBefore });
      const tp = await teleportSpiral(ev, f3.bossRoom.cx, f3.bossRoom.cy);
      let intro = false;
      for (let i = 0; i < 80; i += 1) {
        if (await ev('!!(state.boss && state.boss.introDone)')) { intro = true; break; }
        if (i === 10 || i === 30) await settle(ev);
        await sleep(250);
      }
      check('首领登场完成', intro, {
        stairsDist: tp.dist,
        openFloor: await ev('!!(state.openFloor && state.openFloor.active)'),
        boss: await ev('window.__roamDebug.bossState()')
      });
      await shot('04_boss_start.png');

      /* 站到首领附近并锁定朝向，保证真实施法能命中 */
      const pos = await ev(`(function(){
        var b = state.boss;
        var e = b && state.enemies.find(function(x){ return x.id === b.enemyId; });
        if (!e) return null;
        var pts = [[-260, 0], [260, 0], [0, -260], [0, 260], [-180, -180]];
        for (var i = 0; i < pts.length; i += 1) {
          if (window.__roamDebug.teleport(e.x + pts[i][0], e.y + pts[i][1])) {
            var ang = Math.atan2(e.y - state.player.y, e.x - state.player.x);
            if (state.aim) { state.aim.targetId = e.id; state.aim.angle = ang; state.aim.rawAngle = ang; state.aim.locked = true; }
            return { x: state.player.x, y: state.player.y, dist: Math.round(Math.hypot(e.x - state.player.x, e.y - state.player.y)) };
          }
        }
        return null;
      })()`);
      await sleep(300);
      const bs0 = await ev('window.__roamDebug.bossState()');
      /* 真实施法 5 下（冷却 0.55–2.2s，留足间隔） */
      let casts = 0;
      for (let i = 0; i < 5; i += 1) {
        const ok = await ev('window.__roamDebug.cast()');
        if (ok) casts += 1;
        await sleep(700);
      }
      const bs1 = await ev('window.__roamDebug.bossState()');
      const hpDropped = !!(bs0 && bs1 && bs1.hp < bs0.hp);
      check('对首领真实施法有反馈', (casts > 0 || hpDropped) && bs1 && bs1.hpMax > 0,
        { casts, hpStart: bs0 && bs0.hp, hpNow: bs1 && bs1.hp, hpDropped });

      /* 分块扣血：每块约 6%，走真实二阶段与死亡流程 */
      const hpMax = (bs1 && bs1.hpMax) || 600;
      const chunk = Math.max(20, Math.ceil(hpMax * 0.06));
      let killed = false;
      for (let i = 0; i < 40; i += 1) {
        const b = await ev(`window.__roamDebug.damageBoss(${chunk})`);
        if (!b) break;
        if (b.hp <= 0 || b.defeated) { killed = true; break; }
        await sleep(110);
      }
      await sleep(800);
      const bossDone = await ev('(function(){ return { defeated: !!(state.boss && state.boss.defeated), hp: state.boss ? state.boss.hp : null, stairsActive: !!(state.stairs && state.stairs.active), chest: !!state.bossChest }; })()');
      check('首领已被击杀', killed && bossDone.defeated, { hpMax, chunk, bossDone });
      await shot('05_boss_dead.png');
      if (cur3) cur3.boss = { hpMax, chunk, casts, bossDone };

      /* ---------- 5. 首领死后下楼 ---------- */
      /* 先收掉首领宝箱/奖励弹窗，并清掉残余杂兵（真实玩法里这些房间本来就已清） */
      for (let i = 0; i < 4 && (await ev('state.enemies.length')) > 0; i += 1) {
        await ev('window.__roamDebug.killAllEnemies(); true');
        await sleep(400);
      }
      const m = await settle(ev);
      check('首领战后界面回到 playing', m === 'playing', { mode: m });
      const st = await ev('({x: state.stairs.x, y: state.stairs.y, active: state.stairs.active})');
      check('首领死后楼梯可用', st.active === true, st);
      const dt3 = await pressStairsUntilDescend(ev, 3);
      const f4 = await ev('({floor: state.floor, mode: state.mode, rooms: state.rooms.length, enemies: state.enemies.length})');
      check('首领死后按 E 成功下楼到第 4 层', dt3.ok && f4.floor === 4, { ...dt3, after: f4 });
      if (cur3) cur3.descend = { ...f4, ...dt3 };
      await shot('06_floor4.png');
    }

    /* ---------- 6. 技能树 / 融合 / 丢弃（内存态，不动存档） ---------- */
    const opened = await ev("window.__roamDebug.openPanel('skilltree')");
    const tree = await ev('window.__roamDebug.treeState()');
    check('技能树能打开', opened === true && tree && tree.nodes && tree.nodes.length > 0,
      { opened, nodes: tree && tree.nodes ? tree.nodes.length : 0 });
    await shot('07_skilltree.png');
    await ev("window.__roamDebug.closePanel('skilltree'); true");
    await sleep(250);

    await ev("window.__roamDebug.grantMagic('bolt'); window.__roamDebug.grantTech('capacitor'); true");
    await sleep(250);
    const fBefore = await ev('state.fusions.length');
    await ev('window.__roamDebug.fuse(); true');
    await sleep(450);
    const fAfter = await ev('state.fusions.length');
    check('技能融合可执行（雷击+电容）', fAfter > fBefore, { before: fBefore, after: fAfter, fusions: await ev('state.fusions.slice()') });

    const discardApi = await ev('({ discard: typeof discardSkill, can: typeof canDiscardSkill })');
    check('丢弃技能接口在位（不改动其行为）', discardApi.discard === 'function' && discardApi.can === 'function', discardApi);

    /* ---------- 7. 错误汇总 ---------- */
    const pageErrors = await ev('(window.__errors || [])');
    const noise = /favicon/i;
    const ex = pushed.filter((e) => !noise.test(e.text || '') && !noise.test(e.desc || ''));
    report.errors = { captured: ex, pageErrors };
    check('控制台无 error / 无未捕获异常', ex.length === 0 && pageErrors.length === 0,
      { captured: ex.length, pageErrors: pageErrors.length });
    if (ex.length) console.log('捕获到的错误明细:', JSON.stringify(ex, null, 2));
  } catch (e) {
    report.fatal = String((e && e.stack) || e);
    console.error('FATAL', report.fatal);
  } finally {
    h.close();
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
    const failed = report.checks.filter((c) => !c.ok);
    console.log('\n===== 汇总 =====');
    console.log('检查项: ' + report.checks.length + '，失败: ' + failed.length);
    console.log('报告: ' + path.join(OUT, 'report.json'));
    if (report.fatal) console.log('致命错误: ' + report.fatal);
    process.exit(failed.length || report.fatal ? 1 : 0);
  }
}

main();
