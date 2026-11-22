/**
 * 楼梯交互半径实测：从房间角落朝楼梯逐像素推进，记录"最后一次失败"与"首次成功"的距离
 * ------------------------------------------------------------
 * 用法：node tools/arcane_stair_probe.js [输出后缀]
 * 端口：9544
 * 输出：.screenshots/art/stair-range-<后缀>.json
 *
 * 口径：
 *   lastFail  = 逐像素逼近时 interactStairs() 仍返回 false 的距离（越小说明越贴边才失败）
 *   trigger   = interactStairs() 首次返回 true 的距离（这就是"实际触发距离"）
 *   wallGap   = 楼梯到首领房四条边的最小距离（用来证明 96 不可能隔墙触发）
 * 两个视口各走两个对角，走位由代码逐像素推进，不靠人手也不会卡住。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9544;
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const OUT_DIR = path.join(ROOT, '.screenshots', 'art');
const TAG = process.argv[2] || 'run';

const VIEWPORTS = [
  { name: '500x683@1.5', width: 500, height: 683, dpr: 1.5, mobile: true },
  { name: '1280x720@1', width: 1280, height: 720, dpr: 1, mobile: false }
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=1280,900', 'about:blank'
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
    if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 600));
    return r.result.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');

  const results = [];
  for (const vp of VIEWPORTS) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: vp.width, height: vp.height, deviceScaleFactor: vp.dpr, mobile: vp.mobile
    });
    await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
    // 3.2MB 单文件，解析+绑定 UI 可能要 4–6 秒；以前 2.2 秒就点 #btnStart，
    // 那时监听器还没挂上，点击被吞掉，state.mode 一直是 'title'（这就是上一版测不到触发的原因）。
    for (let i = 0; i < 60; i += 1) {
      const ready = await ev(`typeof startGame === 'function'`);
      if (ready) break;
      await sleep(250);
    }
    // 新档首局会先弹"角色选择"：startGame 会 return false 并把选择页打开，
    // 必须 chooseCharacter 一次才真正进入 playing（否则整轮都在 title 下空跑）。
    await ev(`(function(){
      if (state.mode === 'title') {
        startGame();
        if (state.mode === 'title' && typeof chooseCharacter === 'function' && CHARACTER_CONFIG) {
          chooseCharacter(CHARACTER_CONFIG.ids[0]);
        }
      }
      return state.mode;
    })()`);
    for (let i = 0; i < 60; i += 1) {
      const m = await ev(`state.mode`);
      if (m === 'playing') break;
      await sleep(200);
    }
    await sleep(600);
    await ev(`(function(){ state.player.hpMax = 99999; state.player.hp = 99999; return state.mode; })()`);

    const range = await ev(`(typeof STAIR_INTERACT_RANGE === 'number' ? STAIR_INTERACT_RANGE : null)`);
    const corners = [];

    /* 两个对角：左上角内侧 / 右下角内侧（各留 40px，避免正好压在墙里） */
    for (const corner of ['topleft', 'bottomright']) {
      const r = await ev(`(function(){
        var f = state.floor;
        window.__roamDebug.setFloor(f + 3);
        var rooms = state.rooms;
        var boss = state.boss ? rooms[state.boss.roomId] : null;
        if (!boss || !state.stairs) return { ok: false, why: 'no boss room' };
        var sx = state.stairs.x, sy = state.stairs.y;
        var wallGap = Math.min(sx - boss.x, boss.x + boss.w - sx, sy - boss.y, boss.y + boss.h - sy);
        var px = ${corner === 'topleft' ? 'boss.x + 40' : 'boss.x + boss.w - 40'};
        var py = ${corner === 'topleft' ? 'boss.y + 40' : 'boss.y + boss.h - 40'};
        // 先把"下楼门槛"清掉，确保失败/成功只由距离决定
        // （开放层还要钥匙，这里一并关掉；我们只测距离阈值，不测钥匙/清场逻辑）
        state.floorCleared = true;
        if (state.boss) state.boss.defeated = true;
        state.status = 'playing';
        if (state.openFloor) { state.openFloor.active = false; state.openFloor.stairsLocked = false; }
        window.__roamDebug.teleport(px, py);
        var dist = function(a, b, c, d){ return Math.hypot(c - a, d - b); };
        var lastFail = null, trigger = null, steps = 0;
        for (var d = 260; d >= 20; d -= 1) {
          var t = d / 260;
          var tx = sx + (px - sx) * t;
          var ty = sy + (py - sy) * t;
          window.__roamDebug.teleport(tx, ty);
          var real = dist(state.player.x, state.player.y, sx, sy);
          var ok = false;
          if (typeof interactStairs === 'function') ok = !!interactStairs();
          steps += 1;
          if (ok) { trigger = Math.round(real * 10) / 10; break; }
          lastFail = Math.round(real * 10) / 10;
        }
        return {
          ok: !!trigger, lastFail: lastFail, trigger: trigger, wallGap: Math.round(wallGap),
          steps: steps, floorBefore: f, bossId: boss.id,
          diag: {
            mode: state.mode, status: state.status,
            hasStairs: !!state.stairs,
            floorCleared: !!state.floorCleared,
            bossDefeated: !!(state.boss && state.boss.defeated),
            openActive: !!(state.openFloor && state.openFloor.active),
            openLocked: !!(state.openFloor && state.openFloor.stairsLocked),
            lastDist: lastFail,
            rangeConst: (typeof STAIR_INTERACT_RANGE === 'number' ? STAIR_INTERACT_RANGE : 'missing')
          }
        };
      })()`);
      corners.push({ corner, ...r });
      await sleep(400);
    }

    results.push({ viewport: vp.name, range, corners });
    const line = corners.map((c) => c.corner + ' fail@' + c.lastFail + ' → ok@' + c.trigger).join(' | ');
    console.log('VP', vp.name, 'range', range, '|', line, '| wallGap', corners[0] && corners[0].wallGap);
  }

  const outFile = path.join(OUT_DIR, 'stair-range-' + TAG + '.json');
  fs.writeFileSync(outFile, JSON.stringify({ tag: TAG, results }, null, 2));

  /* 同类阈值清单：只做清点，不修改（是否放宽交给用户拍板） */
  const others = await ev(`(function(){
    function pick(name, value){ return name + '=' + value; }
    var out = [];
    try { out.push(pick('DUAL_ALTAR.interactRange', DUAL_ALTAR_CONFIG.interactRange)); } catch (e) {}
    try { out.push(pick('EVENT.interactRange', EVENT_CONFIG.interactRange)); } catch (e) {}
    try { out.push(pick('FULL_CLEAR.interactRange', FULL_CLEAR_BONUS_CONFIG.interactRange)); } catch (e) {}
    try { out.push(pick('U11.interactRange', U11_CONFIG.interactRange)); } catch (e) {}
    try { out.push(pick('ENGRAVE.interactRange', ENGRAVE_CONFIG.interactRange)); } catch (e) {}
    try { out.push(pick('ROOM_ENTRY.confirmRadius', ROOM_ENTRY.confirmRadius)); } catch (e) {}
    try { out.push(pick('ROOM_PICKER.maxChoices', ROOM_PICKER_CONFIG.maxChoices)); } catch (e) {}
    try { out.push(pick('STAIR', STAIR_INTERACT_RANGE)); } catch (e) {}
    return out;
  })()`);
  console.log('THRESHOLDS', others.join(' | '));
  console.log('OUT', outFile);
  ws.close();
  killEdge(edge);
  process.exit(0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
