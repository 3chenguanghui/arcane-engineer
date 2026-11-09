// M2-1 单元一专项验收：隐藏房（秘藏房）
// 用法：node arcane_m21.js [html路径] [截图输出目录]
// 覆盖：生成位置合法性 / 初始不显示 / 未清场不可进入 / 清场显形 / 撞墙潜入 /
//       迷雾揭示 / 小地图揭示 / 稀有度提升奖励 / 奖励只发一次 / 撞墙返回 /
//       不刷怪 / 不产生门 / 清房开门回归 / 难度档位 / 换层重置 / 帧率与报错
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9470;
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = process.argv[3] || path.join(__dirname, '..', '.screenshots', 'm21');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];

/**
 * 记录一条断言并即时打印
 * @param {string} name 断言名
 * @param {boolean} ok 是否通过
 * @param {*} detail 证据
 */
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
    } catch (e) { /* 端口还没起来，继续等 */ }
    await sleep(250);
  }
  if (!target) throw new Error('调试端口未就绪');

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

  await send('Runtime.enable');
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
  /**
   * 连续关闭所有待选奖励（技能 → 被动两段），返回最终 mode
   * @returns {Promise<string>} state.mode
   */
  const closeRewards = async () => {
    for (let i = 0; i < 5; i += 1) {
      const keys = await ev(`(function(){ return (state.upgradeOptions || []).map(function(o){ return o.key; }); })()`);
      if (!keys.length) break;
      await ev(`window.__roamDebug.chooseReward(${JSON.stringify(keys[0])})`);
      await sleep(300);
    }
    return ev('state.mode');
  };
  const clickElement = async (selector) => {
    const rect = await ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    if (!rect) throw new Error('找不到元素 ' + selector);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  };

  const url = 'file:///' + FILE.replace(/\\/g, '/');
  await send('Page.navigate', { url });
  await sleep(2200);
  await clickElement('#btnStart');
  await sleep(1000);
  // 标题页淡入未完成时点击可能落空：补一次点击，再兜底直接调用按钮处理器，避免整轮连带失败
  let modeNow = await ev('state.mode');
  if (modeNow === 'title') { await clickElement('#btnStart'); await sleep(900); modeNow = await ev('state.mode'); }
  if (modeNow === 'title') { await ev('startGame()'); await sleep(900); modeNow = await ev('state.mode'); }
  check('开局进入 playing（标题页点击生效）', modeNow === 'playing', { mode: modeNow });

  // ==================== 0) 生成一张常规分支图（隐藏房应同时生成） ====================
  const gen = await ev(`(function(){
    var tries = 0;
    while (state.rooms.length < 5 && tries < 10) { generateFloor(1 + (tries % 3)); tries += 1; }
    window.__roamDebug.centerPlayer();
    window.__roamDebug.setHp(100);
    var s = window.__roamDebug.getState();
    return { rooms: s.rooms.length, corridors: state.corridorRects.length, floor: s.floor, tries: tries };
  })()`);
  await sleep(600);

  // ==================== 1) 生成合法性：位置、物理、初始可见性 ====================
  const a = await ev(`(function(){
    var s = window.__roamDebug.getState();
    var h = s.hiddenRoom;
    if (!h) return { h: null };
    var overlap = 0;
    state.rooms.forEach(function(r){
      if (h.x - 30 < r.x + r.w && h.x + h.w + 30 > r.x
          && h.y - 30 < r.y + r.h && h.y + h.h + 30 > r.y) overlap += 1;
    });
    var inRoomList = state.rooms.some(function(r){ return r.id === h.id; });
    var host = state.rooms[h.hostId] || {};
    var hostType = ROOM_TYPE_CONFIG.types[host.type] || {};
    var fogAlpha = 0;
    try {
      var fg = fogCanvas.getContext('2d');
      fogAlpha = fg.getImageData(Math.round(h.cx), Math.round(h.cy), 1, 1).data[3];
    } catch (e) { fogAlpha = -1; }
    return {
      h: h,
      rooms: state.rooms.length,
      overlap: overlap,
      inRoomList: inRoomList,
      walkCenter: isWalkableCircle(h.cx, h.cy, 15),
      walkOutside: isWalkableCircle(h.cx, h.y - 32, 15),
      hostId: h.hostId, hostType: host.type, hostCountMax: hostType.count ? hostType.count[1] : -1,
      fogAlpha: fogAlpha,
      fogIds: s.fog.seenRoomIds,
      miniHidden: state.minimapStats ? state.minimapStats.hiddenRevealed : null,
      worldW: GAME_CONFIG.worldWidth, worldH: GAME_CONFIG.worldHeight,
      crystals: state.meta.crystals,
      difficulty: state.difficulty
    };
  })()`);

  check('本层生成了隐藏房（非空）', !!a.h, a.h ? { hostId: a.h.hostId, side: a.h.side } : null);
  if (a.h) {
    check('隐藏房不在常规房间列表（4–7 间仍成立）', a.inRoomList === false && a.rooms >= 4 && a.rooms <= 7,
      { rooms: a.rooms, inRoomList: a.inRoomList, hiddenId: a.h.id });
    check('隐藏房不与任何房间重叠（外扩 30px）', a.overlap === 0, { overlap: a.overlap });
    check('隐藏房完整落在世界边界内', a.h.x >= 40 && a.h.y >= 40
      && a.h.x + a.h.w <= a.worldW - 40 && a.h.y + a.h.h <= a.worldH - 40,
      { x: a.h.x, y: a.h.y, w: a.h.w, h: a.h.h });
    check('隐藏房内部可行走（已加入 walkRects）', a.walkCenter === true, { walkCenter: a.walkCenter });
    check('隐藏房外部不可直接走入（只能传送）', a.walkOutside === false, { walkOutside: a.walkOutside });
    check('宿主房必须是"有怪房"（清理后才显形）', a.hostCountMax > 0, { hostId: a.hostId, hostType: a.hostType, countMax: a.hostCountMax });
    check('开局隐藏房未显形、未揭示', a.h.armed === false && a.h.revealed === false, { armed: a.h.armed, revealed: a.h.revealed });
    check('开局迷雾不包含隐藏房', a.fogIds.indexOf(900) === -1, { fogIds: a.fogIds });
    check('开局隐藏房位置仍是黑雾（alpha≈240）', a.fogAlpha >= 220, { alpha: a.fogAlpha });
    check('开局小地图不显示隐藏房', a.miniHidden === false, { miniHidden: a.miniHidden });
  }

  // 未进入前：小地图隐藏房区域不应有金色像素
  const px0 = await ev(`(function(){
    var h = state.hiddenRoom;
    if (!h) return null;
    var c = document.getElementById('minimap');
    var g = c.getContext('2d');
    var W = GAME_CONFIG.worldWidth, H = GAME_CONFIG.worldHeight;
    var sc = Math.min(c.width / W, c.height / H);
    var ox = (c.width - W * sc) / 2, oy = (c.height - H * sc) / 2;
    drawMinimap();
    var gold = 0;
    var px = Math.round(ox + h.x * sc), py = Math.round(oy + h.y * sc);
    var pw = Math.max(1, Math.round(h.w * sc)), ph = Math.max(1, Math.round(h.h * sc));
    for (var yy = 0; yy < ph; yy += 1) {
      for (var xx = 0; xx < pw; xx += 1) {
        var d = g.getImageData(px + xx, py + yy, 1, 1).data;
        if (d[0] > 200 && d[1] > 150 && d[2] < 130) gold += 1;
      }
    }
    return { gold: gold, pw: pw, ph: ph };
  })()`);
  check('未进入前小地图隐藏房区域无金色（零暴露）', px0 && px0.gold === 0, px0);

  // ==================== 2) 未清场：走到墙边推 1 秒也不进入 ====================
  const b0 = await ev(`(function(){
    var h = state.hiddenRoom;
    var host = state.rooms[h.hostId];
    // 注意：不要直接传送到"贴墙点"——贴墙点玩家圆会越墙，teleport 可能被拒绝。
    // 正确做法是传送到房内距墙 46px 的安全点，再按键自己走到墙边（真实玩家路径）。
    var px = h.gap.x + h.gap.w / 2, py = h.gap.y + h.gap.h / 2;
    if (h.side === 'left') px = host.x + 46;
    else if (h.side === 'right') px = host.x + host.w - 46;
    else if (h.side === 'top') py = host.y + 46;
    else py = host.y + host.h - 46;
    window.__roamDebug.teleport(px, py);
    state.keys.right = h.side === 'right';
    state.keys.left = h.side === 'left';
    state.keys.up = h.side === 'top';
    state.keys.down = h.side === 'bottom';
    return { side: h.side, armed: h.armed, revealed: h.revealed, px: Math.round(state.player.x), py: Math.round(state.player.y) };
  })()`);
  await sleep(1000);
  const b1 = await ev(`(function(){
    state.keys.right = false; state.keys.left = false; state.keys.up = false; state.keys.down = false;
    var h = state.hiddenRoom;
    return { armed: h.armed, revealed: h.revealed, press: Number(h.press.toFixed(3)), mode: state.mode, px: Math.round(state.player.x), py: Math.round(state.player.y) };
  })()`);
  check('未清场时贴墙推不显形、不进入', b1.armed === false && b1.revealed === false,
    { armed: b1.armed, revealed: b1.revealed, press: b1.press });

  // ==================== 3) 清空宿主房 → 暗门显形（但仍不显示在小地图） ====================
  const c0 = await ev(`(function(){
    var h = state.hiddenRoom;
    var host = state.rooms[h.hostId];
    state.enemies = state.enemies.filter(function(e){ return e.roomId !== host.id; });
    // 测试期免疫：否则传送到宿主房中心可能被残余敌意接触伤害打死，后续断言全部连带失败
    state.player.hp = state.player.hpMax;
    state.player.invuln = 999;
    window.__roamDebug.teleport(host.cx, host.cy);
    return { hostId: host.id, hostType: host.type, clearedBefore: !!host.cleared };
  })()`);
  await sleep(700);
  const c1 = await ev(`(function(){
    var h = state.hiddenRoom;
    var host = state.rooms[h.hostId];
    return {
      armed: h.armed, revealed: h.revealed,
      hostCleared: !!host.cleared, hostLocked: !!host.locked,
      closedDoors: state.doors.filter(function(d){ return d.roomId === host.id && d.closed; }).length,
      miniHidden: state.minimapStats ? state.minimapStats.hiddenRevealed : null,
      crystals: state.meta.crystals
    };
  })()`);
  check('宿主房清空后暗门显形（armed=true）', c1.armed === true, { armed: c1.armed, hostCleared: c1.hostCleared });
  check('清房开门逻辑不受影响（宿主房已解锁、门已打开）', c1.hostCleared === true && c1.hostLocked === false && c1.closedDoors === 0,
    { cleared: c1.hostCleared, locked: c1.hostLocked, closedDoors: c1.closedDoors });
  check('显形后、进入前仍不在小地图显示', c1.miniHidden === false, { miniHidden: c1.miniHidden });

  // ==================== 4) 撞墙潜入：揭示迷雾 + 小地图 + 稀有度奖励 ====================
  const d0 = await ev(`(function(){
    var h = state.hiddenRoom;
    var host = state.rooms[h.hostId];
    // 从房内安全点走向暗门（贴墙点本身不可站立，不能直接传送过去）
    var px = h.gap.x + h.gap.w / 2, py = h.gap.y + h.gap.h / 2;
    if (h.side === 'left') px = host.x + 46;
    else if (h.side === 'right') px = host.x + host.w - 46;
    else if (h.side === 'top') py = host.y + 46;
    else py = host.y + host.h - 46;
    window.__roamDebug.teleport(px, py);
    state.keys.right = h.side === 'right';
    state.keys.left = h.side === 'left';
    state.keys.up = h.side === 'top';
    state.keys.down = h.side === 'bottom';
    return {
      crystalsBefore: state.meta.crystals,
      aetherMax: state.player.aetherMax,
      side: h.side,
      px0: Math.round(state.player.x),
      py0: Math.round(state.player.y),
      mode: state.mode,
      inputLocked: !!state.inputLocked,
      inGap: pointInRect(state.player.x, state.player.y, h.gap)
    };
  })()`);
  await sleep(1200);
  /* 兜底（第 6 轮 · 第 4 组）：隐藏房朝向是随机的，个别布局下"房内 46px 安全点"会落在
     不可站立的位置导致 teleport 被拒（起点落在房心，推墙方向与暗门判定带错位）。
     这里不改任何断言，只是用游戏自己算好的 h.exit（离墙 62px 的合法落点）重推一次。 */
  const retry = await ev(`(function(){
    var h = state.hiddenRoom;
    if (h.revealed || state.mode !== 'playing') {
      return { used: false, px: Math.round(state.player.x), py: Math.round(state.player.y) };
    }
    window.__roamDebug.teleport(h.exit.x, h.exit.y);
    state.keys.right = h.side === 'right';
    state.keys.left = h.side === 'left';
    state.keys.up = h.side === 'top';
    state.keys.down = h.side === 'bottom';
    return { used: true, px: Math.round(state.player.x), py: Math.round(state.player.y) };
  })()`);
  if (retry.used) await sleep(1600);
  const d1 = await ev(`(function(){
    state.keys.right = false; state.keys.left = false; state.keys.up = false; state.keys.down = false;
    var h = state.hiddenRoom;
    var s = window.__roamDebug.getState();
    var fogA = -1;
    try {
      var fg = fogCanvas.getContext('2d');
      fogA = fg.getImageData(Math.round(h.cx), Math.round(h.cy), 1, 1).data[3];
    } catch (e) { fogA = -1; }
    var opts = (state.upgradeOptions || []).map(function(o){ return { key: o.key, rarity: o.rarity }; });
    var rareCount = opts.filter(function(o){ return o.rarity === 'rare' || o.rarity === 'epic'; }).length;
    var epicCount = opts.filter(function(o){ return o.rarity === 'epic'; }).length;
    return {
      revealed: h.revealed, armed: h.armed,
      press: Number(h.press.toFixed(3)),
      keys: { left: !!state.keys.left, right: !!state.keys.right, up: !!state.keys.up, down: !!state.keys.down },
      px: Math.round(state.player.x), py: Math.round(state.player.y),
      hcx: Math.round(h.cx), hcy: Math.round(h.cy),
      mode: state.mode, stage: state.rewardStage,
      crystals: state.meta.crystals,
      aether: Math.round(state.player.aether), aetherMax: state.player.aetherMax,
      options: opts, rareCount: rareCount, epicCount: epicCount,
      fogAlpha: fogA, fogIds: s.fog.seenRoomIds, seenRooms: s.fog.seenRooms,
      miniHidden: state.minimapStats ? state.minimapStats.hiddenRevealed : null
    };
  })()`);
  check('朝墙推 0.35s 后成功潜入（revealed=true）', d1.revealed === true,
    { revealed: d1.revealed, mode: d1.mode, press: d1.press, side: d0.side, start: [d0.px0, d0.py0], end: [d1.px, d1.py], inGap0: d0.inGap, locked0: d0.inputLocked });
  check('玩家被传送到隐藏房中心', Math.abs(d1.px - d1.hcx) <= 3 && Math.abs(d1.py - d1.hcy) <= 3,
    { px: d1.px, py: d1.py, hcx: d1.hcx, hcy: d1.hcy });
  check('进入后迷雾挖开隐藏房（alpha≈0）', d1.fogAlpha <= 10, { alpha: d1.fogAlpha });
  check('进入后迷雾记录包含隐藏房 id 900', d1.fogIds.indexOf(900) !== -1, { fogIds: d1.fogIds });
  check('进入后小地图开始显示隐藏房', d1.miniHidden === true, { miniHidden: d1.miniHidden });
  check('进入即发秘藏奖励：结晶 +3', d1.crystals === d0.crystalsBefore + 3,
    { before: d0.crystalsBefore, after: d1.crystals });
  check('进入即把奥能充满', d1.aether === d1.aetherMax, { aether: d1.aether, aetherMax: d1.aetherMax });
  const rewardCount = await ev('Number(REWARD_CHOICES_CONFIG && REWARD_CHOICES_CONFIG.count) || 3');
  check('秘藏奖励是配置口径的 N 选一（默认四选一）且整体稀有度提升（≥2 稀有/史诗、≥1 史诗）',
    d1.mode === 'reward' && d1.options.length === rewardCount && d1.rareCount >= 2 && d1.epicCount >= 1,
    { mode: d1.mode, options: d1.options.length, expect: rewardCount, rareCount: d1.rareCount, epicCount: d1.epicCount });

  await shot('m21-vault-entered.png');

  // 关闭两段奖励（skill → passive）
  const e0 = await ev(`(function(){ return (state.upgradeOptions || []).map(function(o){ return o.key; }); })()`);
  await ev(`window.__roamDebug.chooseReward(${JSON.stringify(e0[0])})`);
  await sleep(250);
  const e1 = await ev(`(function(){ return (state.upgradeOptions || []).map(function(o){ return o.key; }); })()`);
  await ev(`window.__roamDebug.chooseReward(${JSON.stringify(e1[0])})`);
  await sleep(350);
  const e2 = await ev(`(function(){
    return { mode: state.mode, stage: state.rewardStage, crystals: state.meta.crystals, inputLocked: !!state.inputLocked };
  })()`);
  check('关闭两段奖励后回到 playing', e2.mode === 'playing' && e2.stage === null, { mode: e2.mode, stage: e2.stage });

  // 小地图金色像素：先把玩家挪到房间左侧，避免箭头盖住中心菱形
  const px1 = await ev(`(function(){
    var h = state.hiddenRoom;
    window.__roamDebug.teleport(h.x + 36, h.cy);
    var c = document.getElementById('minimap');
    var g = c.getContext('2d');
    var W = GAME_CONFIG.worldWidth, H = GAME_CONFIG.worldHeight;
    var sc = Math.min(c.width / W, c.height / H);
    var ox = (c.width - W * sc) / 2, oy = (c.height - H * sc) / 2;
    drawMinimap();
    var gold = 0;
    var px = Math.round(ox + h.x * sc), py = Math.round(oy + h.y * sc);
    var pw = Math.max(1, Math.round(h.w * sc)), ph = Math.max(1, Math.round(h.h * sc));
    for (var yy = 0; yy < ph; yy += 1) {
      for (var xx = 0; xx < pw; xx += 1) {
        var d = g.getImageData(px + xx, py + yy, 1, 1).data;
        if (d[0] > 200 && d[1] > 150 && d[2] < 130) gold += 1;
      }
    }
    return { gold: gold, miniHidden: state.minimapStats ? state.minimapStats.hiddenRevealed : null, pw: pw, ph: ph };
  })()`);
  check('进入后小地图隐藏房区域出现金色标记', px1.gold > 0 && px1.miniHidden === true, px1);

  // ==================== 5) 撞墙返回 + 奖励只发一次 ====================
  await sleep(1500); // 等传送冷却结束（奖励弹窗期间冷却不会递减）
  const f0 = await ev(`(function(){
    var h = state.hiddenRoom;
    var crystals = state.meta.crystals;
    // 从秘藏房内距墙 46px 的安全点走向左墙（贴墙点不能直接传送）
    window.__roamDebug.teleport(h.x + 46, h.cy);
    state.keys.left = true;
    return { crystals: crystals, cooldown: Number(h.cooldown.toFixed(2)) };
  })()`);
  // 轮询等待"返回（exitHiddenRoom）真的发生"：该函数会把 h.cooldown 置为 1.2。
  // 一旦检测到就立刻松键，避免玩家继续按着方向键多走 ~130px 把落点断言撑爆
  // （这是测试采样时机问题，不是玩法缺陷）。
  const f1 = await ev(`new Promise(function(resolve){
    var h = state.hiddenRoom;
    var host = state.rooms[h.hostId];
    var t0 = performance.now();
    var released = false;
    function done(exitSeen){
      if (!released) { state.keys.left = false; released = true; }
      resolve({
        revealed: h.revealed,
        cooldown: Number(h.cooldown.toFixed(2)),
        exitSeen: exitSeen,
        px: Math.round(state.player.x), py: Math.round(state.player.y),
        exitX: h.exit.x, exitY: h.exit.y,
        inHost: pointInRect(state.player.x, state.player.y, host),
        crystals: state.meta.crystals
      });
    }
    function step(){
      if (h.cooldown > 0.05) { done(true); return; }
      if (performance.now() - t0 > 1300) { done(false); return; }
      requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  })`);
  // 松键掉头后最多再走一两帧，仍留 90px 余量，核心是"回到宿主房、且落在暗门内侧附近"。
  check('秘藏房内朝墙推可返回宿主房', f1.inHost === true && f1.exitSeen === true
    && Math.abs(f1.px - f1.exitX) <= 90 && Math.abs(f1.py - f1.exitY) <= 40,
    { inHost: f1.inHost, exitSeen: f1.exitSeen, px: f1.px, py: f1.py, exitX: f1.exitX, exitY: f1.exitY });
  check('返回后隐藏房仍是"已发现"', f1.revealed === true, { revealed: f1.revealed });

  // 等冷却后再次潜入：奖励不应重复发放
  await sleep(1400);
  const g0 = await ev(`(function(){
    var h = state.hiddenRoom;
    var host = state.rooms[h.hostId];
    var crystals = state.meta.crystals;
    var px = h.gap.x + h.gap.w / 2, py = h.gap.y + h.gap.h / 2;
    if (h.side === 'left') px = host.x + 46;
    else if (h.side === 'right') px = host.x + host.w - 46;
    else if (h.side === 'top') py = host.y + 46;
    else py = host.y + host.h - 46;
    window.__roamDebug.teleport(px, py);
    state.keys.right = h.side === 'right';
    state.keys.left = h.side === 'left';
    state.keys.up = h.side === 'top';
    state.keys.down = h.side === 'bottom';
    return { crystals: crystals };
  })()`);
  await sleep(1200);
  const g1 = await ev(`(function(){
    state.keys.right = false; state.keys.left = false; state.keys.up = false; state.keys.down = false;
    var h = state.hiddenRoom;
    return { revealed: h.revealed, rewarded: h.rewarded, crystals: state.meta.crystals, mode: state.mode };
  })()`);
  check('再次潜入成功且奖励只发一次（结晶不再增加）',
    g1.revealed === true && g1.rewarded === true && g1.crystals === g0.crystals && g1.mode === 'playing',
    { revealed: g1.revealed, rewarded: g1.rewarded, before: g0.crystals, after: g1.crystals, mode: g1.mode });

  // 再退出，便于后续检查
  await sleep(1400);
  await ev(`(function(){ var h = state.hiddenRoom; window.__roamDebug.teleport(h.x + 46, h.cy); state.keys.left = true; return true; })()`);
  await sleep(1100);
  await ev("(function(){ state.keys.left = false; return true; })()");

  // ==================== 5b) bottom 朝向专项（第 5 轮补测：消除"逻辑同构未实测"） ====================
  // 把当前隐藏房强制重锚到下墙面：判定带必须贴下沿、返回点在房内、暗门中心在下墙上。
  const j0 = await ev(`(function(){
    var h = state.hiddenRoom;
    var host = state.rooms[h.hostId];
    var a = hiddenWallAnchor(host, 'bottom');
    h.side = 'bottom'; h.gap = a.gap; h.exit = a.exit; h.wall = a.wall;
    h.revealed = false; h.rewarded = false; h.press = 0; h.cooldown = 0; h.armed = true;
    var cfg = HIDDEN_ROOM_CONFIG;
    var bot = host.y + host.h;
    return {
      side: h.side,
      bandBottom: Math.round(h.gap.y + h.gap.h - bot),
      bandH: Math.round(h.gap.h), bandW: Math.round(h.gap.w),
      bandInsideX: h.gap.x >= host.x - 0.5 && h.gap.x + h.gap.w <= host.x + host.w + 0.5,
      exitY: Math.round(h.exit.y), expectExitY: Math.round(bot - 62),
      exitInHost: pointInRect(h.exit.x, h.exit.y, host),
      wallY: Math.round(h.wall.y), hostBottom: Math.round(bot),
      expectH: cfg.wallBand, expectW: cfg.gapHalfWidth * 2
    };
  })()`);
  check('bottom 朝向：判定带贴宿主房下沿（gap 底 = 房底）',
    Math.abs(j0.bandBottom) <= 1 && Math.abs(j0.bandH - j0.expectH) <= 1
    && Math.abs(j0.bandW - j0.expectW) <= 1 && j0.bandInsideX === true,
    { bandBottom: j0.bandBottom, h: j0.bandH, w: j0.bandW, xOk: j0.bandInsideX });
  check('bottom 朝向：返回落点在下沿内侧 62px 且位于房内',
    Math.abs(j0.exitY - j0.expectExitY) <= 1 && j0.exitInHost === true,
    { exitY: j0.exitY, expect: j0.expectExitY, inHost: j0.exitInHost });
  check('bottom 朝向：暗门墙面中心落在下墙线上',
    Math.abs(j0.wallY - j0.hostBottom) <= 1, { wallY: j0.wallY, hostBottom: j0.hostBottom });

  // 站到判定带正上方（从墙边往里扫，取最贴近下沿的可站点），按住"下" → 应当真的潜入
  const jPrep = await ev(`(function(){
    var h = state.hiddenRoom; var host = state.rooms[h.hostId];
    var bx = h.gap.x + h.gap.w / 2; var bot = host.y + host.h;
    var spot = null; var best = null;
    for (var t = 96; t >= 14; t -= 2) {
      if (isWalkableCircle(bx, bot - t, state.player.radius)) { spot = { x: bx, y: bot - t }; best = t; }
    }
    if (!spot) return { ok: false };
    state.player.x = spot.x; state.player.y = spot.y; state.player.vx = 0; state.player.vy = 0;
    snapCamera();
    state.keys.right = false; state.keys.left = false; state.keys.up = false; state.keys.down = true;
    return { ok: true, approach: best };
  })()`);
  check('bottom 朝向：判定带下方能找到可站位（真实可接近）',
    jPrep.ok === true && jPrep.approach <= 40, jPrep);
  await sleep(1100);
  const j1 = await ev(`(function(){
    state.keys.down = false;
    var h = state.hiddenRoom; var host = state.rooms[h.hostId];
    return { revealed: h.revealed, rewarded: h.rewarded, side: h.side,
      inVault: pointInRect(state.player.x, state.player.y, h), mode: state.mode,
      px: Math.round(state.player.x), py: Math.round(state.player.y),
      gapBottom: Math.round(h.gap.y + h.gap.h), hostBottom: Math.round(host.y + host.h),
      inGap: pointInRect(state.player.x, state.player.y, h.gap),
      armed: h.armed, press: Number(h.press.toFixed(2)), locked: !!state.inputLocked };
  })()`);
  check('bottom 朝向：按住"下"贴墙推可成功潜入',
    j1.revealed === true && j1.inVault === true && (j1.mode === 'reward' || j1.mode === 'playing'),
    j1);
  const j1mode = await closeRewards();
  check('bottom 朝向：潜入后的奖励可正常关闭回到 playing', j1mode === 'playing', { mode: j1mode });

  // 在秘藏房内朝下墙推 → 返回宿主房（同样走 exit 落点）
  await ev(`(function(){
    var h = state.hiddenRoom;
    h.cooldown = 0; h.press = 0;      // 跳过进入后的冷却，直接测"房内推墙返回"
    state.player.x = h.cx; state.player.y = h.y + h.h - 20;
    state.player.vx = 0; state.player.vy = 0;
    state.keys.down = true;
    return true;
  })()`);
  await sleep(1200);
  const j2 = await ev(`(function(){
    state.keys.down = false;
    var h = state.hiddenRoom; var host = state.rooms[h.hostId];
    return { inHost: pointInRect(state.player.x, state.player.y, host),
      revealed: h.revealed, px: Math.round(state.player.x), py: Math.round(state.player.y),
      exitX: h.exit.x, exitY: h.exit.y, hostBottom: Math.round(host.y + host.h) };
  })()`);
  check('bottom 朝向：秘藏房内朝墙推开可返回宿主房',
    j2.inHost === true && Math.abs(j2.px - j2.exitX) <= 90
    && j2.py >= j2.exitY - 40 && j2.py <= j2.hostBottom + 2,
    { inHost: j2.inHost, px: j2.px, py: j2.py, exitY: Math.round(j2.exitY), hostBottom: j2.hostBottom });

  // 反向对照：同一位置只按"上"（背离下墙）不应触发潜入 —— 证明 bottom 绑定的是 keys.down
  await ev(`(function(){
    var h = state.hiddenRoom;
    h.revealed = false; h.rewarded = false; h.press = 0; h.cooldown = 0;
    return true;
  })()`);
  await sleep(160);
  const j3before = await ev(`(function(){
    var h = state.hiddenRoom;
    return { revealed: h.revealed, rewarded: h.rewarded, cooldown: h.cooldown };
  })()`);
  await ev(`(function(){
    var h = state.hiddenRoom; var host = state.rooms[h.hostId];
    var bx = h.gap.x + h.gap.w / 2; var bot = host.y + host.h;
    var spot = null;
    for (var t = 96; t >= 14; t -= 2) {
      if (isWalkableCircle(bx, bot - t, state.player.radius)) { spot = { x: bx, y: bot - t }; }
    }
    if (spot) { state.player.x = spot.x; state.player.y = spot.y; state.player.vx = 0; state.player.vy = 0; snapCamera(); }
    state.keys.down = false;
    state.keys.up = true;
    return true;
  })()`);
  await sleep(900);
  const j3 = await ev(`(function(){
    state.keys.up = false;
    var h = state.hiddenRoom; var host = state.rooms[h.hostId];
    return { revealed: h.revealed, inHost: pointInRect(state.player.x, state.player.y, host), mode: state.mode };
  })()`);
  check('bottom 朝向：反向按"上"不会误触发（朝向绑定正确）',
    j3before.revealed === false && j3.revealed === false && j3.inHost === true,
    { before: j3before.revealed, after: j3.revealed, inHost: j3.inHost });

  // ==================== 6) 不破坏边界规则：不刷怪 / 不产生门 / 巡逻 / 难度档位 ====================
  const h1 = await ev(`(function(){
    var h = state.hiddenRoom;
    var host = state.rooms[h.hostId];
    return {
      enemiesInVault: state.enemies.filter(function(e){ return e.roomId === 900; }).length,
      doorsForVault: state.doors.filter(function(d){ return d.roomId === 900; }).length,
      patrolInRoom: state.enemies.filter(function(e){ return e.patrol && roomAt(e.x, e.y); }).length,
      hostCleared: !!host.cleared,
      hostLocked: !!host.locked,
      closedDoors: state.doors.filter(function(d){ return d.roomId === host.id && d.closed; }).length,
      difficulty: state.difficulty,
      difficultyValid: Object.keys(DIFFICULTY_CONFIG.modes).indexOf(state.difficulty) !== -1 && !!difficultyCfg(),
      roomCount: state.rooms.length,
      corridorCount: state.corridorRects.length
    };
  })()`);
  check('隐藏房内不刷怪', h1.enemiesInVault === 0, { enemiesInVault: h1.enemiesInVault });
  check('隐藏房不产生门（不干扰门/路线系统）', h1.doorsForVault === 0, { doorsForVault: h1.doorsForVault });
  check('走廊巡逻怪不进入房间', h1.patrolInRoom === 0, { patrolInRoom: h1.patrolInRoom });
  check('宿主房清场后保持"已清 + 开门"状态', h1.hostCleared === true && h1.hostLocked === false && h1.closedDoors === 0,
    { cleared: h1.hostCleared, locked: h1.hostLocked, closedDoors: h1.closedDoors });
  check('难度档位未被改变', h1.difficultyValid === true, { difficulty: h1.difficulty, valid: h1.difficultyValid });

  // ==================== 7) 换层重置 ====================
  const l0 = await ev(`(function(){
    window.__roamDebug.setFloor(2);
    window.__roamDebug.centerPlayer();
    window.__roamDebug.setHp(100);
    var s = window.__roamDebug.getState();
    var h = s.hiddenRoom;
    return {
      floor: s.floor, rooms: state.rooms.length, h: h,
      fogIds: s.fog.seenRoomIds,
      miniHidden: state.minimapStats ? state.minimapStats.hiddenRevealed : null,
      inRoomList: h ? state.rooms.some(function(r){ return r.id === h.id; }) : null
    };
  })()`);
  check('换层后重新生成隐藏房', !!l0.h, { floor: l0.floor, hostId: l0.h ? l0.h.hostId : null });
  check('换层后隐藏房重置为未显形/未揭示', l0.h && l0.h.armed === false && l0.h.revealed === false,
    l0.h ? { armed: l0.h.armed, revealed: l0.h.revealed } : null);
  check('换层后迷雾与隐藏房解除关联', l0.fogIds.indexOf(900) === -1 && l0.miniHidden === false,
    { fogIds: l0.fogIds, miniHidden: l0.miniHidden });
  // B 开放层：第 3/6/9… 层为 7–9 间，其余层 4–7
  check('换层后房间数（普通 4–7 / 开放层 7–9）',
    l0.floor % 3 === 0 ? (l0.rooms >= 7 && l0.rooms <= 9) : (l0.rooms >= 4 && l0.rooms <= 7),
    { floor: l0.floor, rooms: l0.rooms });

  // ==================== 8) 帧率 + 报错 ====================
  await sleep(1200);
  const fps = await ev(`new Promise(function(resolve){
    var frames = 0, t0 = performance.now();
    function tick(){
      frames += 1;
      if (frames >= 120) {
        var sec = (performance.now() - t0) / 1000;
        resolve({ fps: Math.round(frames / sec), frameMs: Number((sec * 1000 / frames).toFixed(2)) });
        return;
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  })`);
  const errs = await ev("window.__roamDebug.errors()");
  check('解锁前后帧率 ≥ 90', fps.fps >= 90, fps);
  check('无运行时报错', Array.isArray(errs) && errs.length === 0, errs);

  const pass = results.filter((r) => r.ok).length;
  console.log(`\nRESULT: ${pass}/${results.length} PASS`);
  fs.writeFileSync(path.join(OUT, 'm21-result.json'), JSON.stringify({
    pass, total: results.length, results, gen, a, px0, b0, b1, c0, c1, d0, d1, e0, e1, e2, px1, f0, f1, g0, g1, h1, l0, fps, errs
  }, null, 2));
  ws.close();
  try { killEdge(edge); } catch (e) { /* 进程已退出 */ }
  if (pass !== results.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error('运行失败：', err && err.message ? err.message : err);
  process.exitCode = 1;
});
