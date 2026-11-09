/**
 * 门宽证据探针：量"门洞几何宽度 / 有效可走带 / 玩家碰撞半径"，
 * 并用三种真人式切入（斜切 / 贴墙 / 冲刺）验证不会卡门。
 * 用法：node tools\_door_probe.js   （端口 9592）
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9592;
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const OUT = path.join(ROOT, '.screenshots', 'door');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 启动无头 Edge 并连上 CDP
 * @returns {Promise<Object>} { send, ev, ws, edge }
 */
async function boot() {
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--window-size=1600,900', 'about:blank'
  ], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 90; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等 */ }
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
    pending.set(seq, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
    return r.result.value;
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2400);
  return { send, ev, ws, edge };
}

/**
 * 注入页面内测量工具：门洞法向/切向、可走带扫描、三种切入动作
 * @returns {Promise<boolean>} 是否注入成功
 */
const INSTALL = `(() => {
  function doorAxes(d) {
    if (d.side === 'top') return { nx: 0, ny: -1, tx: 1, ty: 0 };
    if (d.side === 'bottom') return { nx: 0, ny: 1, tx: 1, ty: 0 };
    if (d.side === 'left') return { nx: -1, ny: 0, tx: 0, ty: 1 };
    return { nx: 1, ny: 0, tx: 0, ty: 1 };
  }
  function walk(x, y) { try { return !!__roamDebug.walkableAt(x, y); } catch (e) { return false; } }
  /* 沿门洞切向扫一条线，找出包含门中心的那段连续可走区间（即"玩家中心能站的有效带"） */
  function scanBand(d, offN) {
    var ax = doorAxes(d);
    var t = -70, minT = 99, maxT = -99, run = false;
    for (; t <= 70; t += 1) {
      var x = d.x + ax.tx * t + ax.nx * offN;
      var y = d.y + ax.ty * t + ax.ny * offN;
      var w = walk(x, y);
      if (w && Math.abs(t) <= 34) { run = true; if (t < minT) minT = t; if (t > maxT) maxT = t; }
    }
    return { min: minT, max: maxT, band: (maxT - minT + 1) };
  }
  /* 在多个法向偏移上扫同一道门，取最宽的一段：
     门中心坐标是"走廊与房间边重叠段的中点"，可能偏离走廊中线几像素，
     固定用 0 偏移会扫到墙里得到空带（曾出现 band = -197 的假样本）。 */
  function bestBand(d, offs) {
    var best = null;
    for (var i = 0; i < offs.length; i += 1) {
      var b = scanBand(d, offs[i]);
      if (!best || b.band > best.band) best = { off: offs[i], min: b.min, max: b.max, band: b.band };
    }
    return best;
  }
  function reset(x, y, angle) {
    state.player.x = x; state.player.y = y;
    state.player.dashTime = 0; state.player.dashCd = 0; state.player.invuln = 0;
    state.player.hp = state.player.hpMax;
    state.keys = { left: false, right: false, up: false, down: false };
    __roamDebug.setAimExact(angle);
  }
  function press(dx, dy) {
    state.keys = { left: dx < -0.25, right: dx > 0.25, up: dy < -0.25, down: dy > 0.25 };
  }
  /* 跑 N 帧，返回沿门法向的位移（>0 表示已进房） */
  function run(dirX, dirY, frames, dashAt) {
    var ax = null;
    for (var f = 0; f < frames; f += 1) {
      press(dirX, dirY);
      if (dashAt >= 0 && f === dashAt) startDash();
      update(1 / 60);
      if (state.mode !== 'playing') break;
    }
    return f;
  }
  window.__doorProbe = {
    doors: function () {
      return (state.doors || []).map(function (d, i) {
        return { i: i, roomId: d.roomId, side: d.side, x: Math.round(d.x), y: Math.round(d.y), closed: !!d.closed };
      });
    },
    /**
     * 量一个门：门洞几何宽（走廊厚）+ 两侧可走带
     * @param {number} idx 门序号
     * @returns {Object}
     */
    measure: function (idx) {
      var d = state.doors[idx];
      var radius = GAME_CONFIG.playerRadius;
      /* 门洞线上（房间入口两侧墙体之间）的"玩家中心可站带" */
      var wall = bestBand(d, [0, 10, -10, 18, -18, 26, -26]);
      var outside = scanBand(d, 34);   /* 走廊侧 34px */
      var inside = scanBand(d, -34);   /* 房间侧 34px */
      return {
        side: d.side, roomId: d.roomId, x: Math.round(d.x), y: Math.round(d.y), closed: !!d.closed,
        corridorWidth: GAME_CONFIG.corridorWidth, playerRadius: radius,
        outside: outside, wall: wall, inside: inside,
        /* 物理间隙 = 中心可站带 + 两侧各一个半径（这就是入口实际留出的墙缝） */
        gapPx: wall.band + radius * 2,
        band: wall.band,
        ratioOpening: +(GAME_CONFIG.corridorWidth / (radius * 2)).toFixed(2),
        ratioBand: +(wall.band / (radius * 2)).toFixed(2),
        ratioGap: +((wall.band + radius * 2) / (radius * 2)).toFixed(2)
      };
    },
    /**
     * 三种真人式切入
     * @param {number} idx 门序号
     * @param {string} mode cut | hug | dash
     * @returns {Object} 是否进房 / 帧数 / 进入后所在房
     */
    enter: function (idx, mode) {
      var d = state.doors[idx];
      var ax = doorAxes(d);
      var m = this.measure(idx);
      var half = Math.max(20, Math.round(m.band / 2) - 2);
      var from0 = state.currentRoomId, frames = 0, ok = false, progress = 0;
      var tOff = mode === 'cut' ? Math.round(half * 0.75) : (mode === 'hug' ? half : 0);
      /* 起点：优先从门外远处出发，但走廊/房间可能没那么深，逐级回缩到第一个可站的点 */
      var cands = mode === 'dash' ? [120, 100, 84, 70, 56, 44] : [80, 64, 50, 38, 30];
      var nOff = null;
      for (var ci = 0; ci < cands.length; ci += 1) {
        var nx0 = d.x + ax.nx * cands[ci] + ax.tx * tOff;
        var ny0 = d.y + ax.ny * cands[ci] + ax.ty * tOff;
        if (walk(nx0, ny0)) { nOff = cands[ci]; break; }
      }
      if (nOff == null) nOff = 30;
      var sx = d.x + ax.nx * nOff + ax.tx * tOff;
      var sy = d.y + ax.ny * nOff + ax.ty * tOff;
      var startOk = walk(sx, sy), mode0 = state.mode, status0 = state.status, pos5 = null;
      /* 成功判据：真正穿过门线（起点在门外 nOff 像素，推进 nOff 到门线，再多 20px 才算进房），
         或 currentRoomId 直接变成这扇门所属的房间 */
      
      var wantProgress = nOff + 20;
      reset(sx, sy, Math.atan2(-ax.ny, -ax.nx));
      var step = function (dx, dy, f) {
        press(dx, dy);
        if (f === 6 && mode === 'dash') startDash();
        update(1 / 60);
        frames += 1;
        if (f === 5) pos5 = { x: Math.round(state.player.x), y: Math.round(state.player.y) };
        progress = (state.player.x - sx) * (-ax.nx) + (state.player.y - sy) * (-ax.ny);
        var entered = (from0 !== d.roomId) && (state.currentRoomId === d.roomId);
        if (entered || progress >= wantProgress) { ok = true; return true; }
        return false;
      };
      if (mode === 'cut') {
        /* 斜切：带横向分量追着门中心走 */
        for (var i = 0; i < 160 && !ok; i += 1) step(-ax.nx - ax.tx * 0.55, -ax.ny - ax.ty * 0.55, i);
      } else if (mode === 'hug') {
        /* 贴墙：贴着门框一侧直穿（横向带一点压墙分量，模拟真人蹭门框） */
        for (var j = 0; j < 160 && !ok; j += 1) step(-ax.nx + ax.tx * 0.15, -ax.ny + ax.ty * 0.15, j);
      } else {
        /* 冲刺：先走几帧对准，第 6 帧起步冲刺 */
        for (var k = 0; k < 160 && !ok; k += 1) step(-ax.nx, -ax.ny, k);
      }
      state.keys = { left: false, right: false, up: false, down: false };
      return { mode: mode, ok: ok, frames: frames, progress: Math.round(progress), from: from0, to: state.currentRoomId,
        startT: tOff, nOff: nOff, want: wantProgress, band: m.band, startOk: startOk, mode0: mode0, status0: status0, pos5: pos5,
        endX: Math.round(state.player.x), endY: Math.round(state.player.y), sx: Math.round(sx), sy: Math.round(sy) };
    },
    /**
     * 把当前房间"打到可自由走动的状态"：
     * 清怪 → 逐帧推进 → 期间弹出的升级/被动奖励全部选掉（或直接跳过被动），
     * 直到连续 24 帧都停在 playing 且没有升级慢动作残留。
     * 之前的 calm 只调 chooseFirst 不推进帧，升级奖励是在之后几帧才弹出的，
     * 结果 enter() 一开始就处在 reward 模式，update() 不移动角色 → 全部 0 位移。
     */
    settle: function (maxSteps) {
      var max = maxSteps || 2400, n = 0, quiet = 0;
      try { __roamDebug.killAllEnemies(); } catch (e) {}
      while (n < max) {
        n += 1;
        if (state.mode === 'reward') {
          var chosen = false;
          try { chosen = __roamDebug.xp.chooseFirst(); } catch (e) {}
          if (!chosen) {
            try { closeRewardFlow(true); } catch (e2) { state.mode = 'playing'; }
          }
          quiet = 0;
          continue;
        }
        update(1 / 60);
        quiet = (state.mode === 'playing') ? quiet + 1 : 0;
        if (quiet >= 24 && !(state.levelSlowT > 0)) break;
      }
      /* 清掉排队中的升级，避免下一个动作中途又弹窗 */
      if (state.xpPending) state.xpPending = 0;
      return {
        steps: n, mode: state.mode, status: state.status, floor: state.floor,
        cur: state.currentRoomId,
        closedDoors: (state.doors || []).filter(function (d) { return d.closed; }).length,
        alive: state.enemies.filter(function (e) { return e.hp > 0; }).length
      };
    },
    setup: function (floor) {
      __roamDebug.setFloor(floor);
      state.player.hpMax = Math.max(state.player.hpMax, 240);
      state.player.hp = state.player.hpMax;
      return { floor: state.floor, rooms: state.rooms.length, doors: (state.doors || []).length };
    }
  };
  return true;
})()`;

/**
 * 主流程：5 层 × 每层 2 个门，量宽度；再在 3 个门上各跑三种切入
 * @returns {Promise<void>}
 */
async function main() {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const h = await boot();
  const checks = [];
  const ok = (name, pass, detail) => { checks.push({ name, pass, detail }); console.log((pass ? 'PASS' : 'FAIL') + ' · ' + name + ' · ' + JSON.stringify(detail)); };
  try {
    const btn = await h.ev(`(() => { var b = document.getElementById('btnStart'); var r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await h.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: btn.x, y: btn.y, button: 'left', clickCount: 1 });
    await h.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: btn.x, y: btn.y, button: 'left', clickCount: 1 });
    await sleep(1400);
    console.log('注入:', await h.ev(INSTALL));

    const floors = [1, 2, 3, 5, 8];
    const measures = [];
    for (const f of floors) {
      await h.ev(`__doorProbe.setup(${f})`);
      const settled = await h.ev(`__doorProbe.settle()`);
      if (settled.mode !== 'playing') console.log('  ! F' + f + ' settle 后仍是 ' + settled.mode);
      const doors = (await h.ev(`__doorProbe.doors()`)).filter((d) => !d.closed);
      const picks = doors.slice(0, 2);
      for (const d of picks) {
        const m = await h.ev(`__doorProbe.measure(${d.i})`);
        /* 空带样本（<30px）说明门中心偏出走廊中线，换门再量，不把假数据算进平均值 */
        if (m.band < 30) { console.log('  - F' + f + ' 门#' + d.i + ' 空带 ' + m.band + 'px，跳过'); continue; }
        measures.push({ floor: f, i: d.i, ...m });
        console.log('F' + f + ' 门#' + d.i + ' · ' + m.side + ' · 中心可站带 ' + m.band + 'px · 入口墙缝 ' + m.gapPx + 'px · 洞 ' + m.corridorWidth + 'px · 比值 带' + m.ratioBand + 'x/缝' + m.ratioGap + 'x/洞' + m.ratioOpening + 'x');
      }
    }
    const bands = measures.map((m) => m.band);
    const avg = Math.round(bands.reduce((a, b) => a + b, 0) / bands.length);
    ok('G1 门洞几何宽度 / 玩家直径 ≥ 3（96 / 30）', measures.every((m) => m.ratioOpening >= 3), { samples: measures.length, ratio: measures[0].ratioOpening });
    /* 判据：中心可走带 ≥ 2 倍玩家直径（60px）→ 双向会车级别的余量，真人不会蹭墙卡住 */
    ok('G2 中心可走带 ≥ 2×玩家直径（≥60px）', Math.min.apply(null, bands) >= 60, { min: Math.min.apply(null, bands), avg, samples: bands.length });

    /* 三种切入：挑 3 个门（不同楼层/朝向） */
    const targets = [measures[0], measures[Math.floor(measures.length / 2)], measures[measures.length - 1]];
    const enterResults = [];
    for (const t of targets) {
      await h.ev(`__doorProbe.setup(${t.floor})`);
      const calmState = await h.ev(`__doorProbe.settle()`);
      console.log('  F' + t.floor + ' 状态 ' + JSON.stringify(calmState));
      for (const mode of ['cut', 'hug', 'dash']) {
        /* 每种切入前都重新 settle：上一次切入可能已触发战斗/奖励，必须在同一起点条件下比 */
        const st2 = await h.ev(`__doorProbe.settle()`);
        if (st2.mode !== 'playing') console.log('  ! ' + mode + ' 前状态 ' + st2.mode);
        const r = await h.ev(`__doorProbe.enter(${t.i}, '${mode}')`);
        enterResults.push({ floor: t.floor, side: t.side, ...r });
        console.log('F' + t.floor + ' 门(' + t.side + ') ' + mode + ' → ' + (r.ok ? '进房 ' + r.frames + '帧' : '未进房 ' + r.frames + '帧')
          + ' · prog ' + r.progress + '/' + r.want + ' · 起点 ' + r.nOff + 'px 可站 ' + r.startOk
          + ' · 房间 ' + r.from + '→' + r.to + ' · pos5 ' + JSON.stringify(r.pos5) + ' · end ' + r.endX + ',' + r.endY);
      }
    }
    ok('G3 三种真人切入（斜切/贴墙/冲刺）全部进房', enterResults.every((r) => r.ok), { runs: enterResults.map((r) => ({ side: r.side, mode: r.mode, ok: r.ok, frames: r.frames })) });

    fs.writeFileSync(path.join(OUT, 'door-result.json'), JSON.stringify({ measures, enterResults, checks }, null, 2));
    const failed = checks.filter((c) => !c.pass).length;
    console.log('\nRESULT: ' + (failed ? 'FAIL' : 'PASS') + '  ' + (checks.length - failed) + '/' + checks.length);
    if (failed) process.exitCode = 1;
  } finally {
    h.ws.close();
    killEdge(h.edge);
  }
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
