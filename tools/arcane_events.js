// P0-3 断言：房间事件与取舍房（三房装配 / 结算一次 / 拒绝 / 下限 / 开关 / 迁移 / 互斥 / 每层上限）
// 用法：node tools\arcane_events.js *> tools\events.log
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9689;
const MAIN = path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = path.join(__dirname, '..', '.screenshots', 'events');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 兜底：进程退出时确保 Edge 被收走 */
function attachEdgeExit(edge) {
  const kill = () => { try { edge.kill(); } catch (e) {} };
  process.on('exit', kill);
  process.on('SIGINT', () => { kill(); process.exit(1); });
}

async function main() {
  const profile = prepareProfile();
  fs.mkdirSync(OUT, { recursive: true });
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--allow-file-access-from-files', '--force-device-scale-factor=1',
    '--window-size=1536,900', 'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) {}
    await sleep(250);
  }
  if (!target) throw new Error('Edge CDP 未就绪');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push('EXCEPTION: ' + m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push('CONSOLE: ' + (m.params.args || []).map((a) => a.value || a.description || '').join(' '));
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
  await send('Emulation.setDeviceMetricsOverride', { width: 1536, height: 900, deviceScaleFactor: 1, mobile: false });

  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };
  const checks = [];
  /** 记录一条断言 */
  const check = (name, ok, detail) => {
    checks.push({ name, ok: !!ok, detail });
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + '  ' + JSON.stringify(detail));
  };
  /* 夹具守卫统计：统计"哪些层没有干净候选房"（这些层调试口会借挑战房，不能用来测事件房） */
  const FIXTURE_STATS = { floorsTried: 0, dirtyFloors: 0, borrowed: 0, borrowedDetail: [], calls: [] };
  /**
   * 在若干层里找一层"正式路径有干净候选房"的楼，强制装配指定房型
   * ------------------------------------------------------------
   * 为什么必须先挑干净楼层：调试口 __roamDebug.event.setup() 在候选房全被占满时
   * 会走 forceRoomId 兜底，允许把事件房挂到"挑战房"上（见主文件 L57003-L57012 注释
   * "最后一档允许借用挑战房 / 钥匙房当宿主"）。正式玩法不会这样——eventRoomCandidate
   * 里有 `!room.challenge`（主文件 L12625-L12628），所以"挑战房 + 取舍房同房"只可能由
   * 夹具制造出来。在这样的层上跑断言，等于在测一个游戏里不可能出现的状态，红绿都没有信息量。
   * 实测：60 次楼层采样里有 51 层（85%）没有干净候选，调试口几乎必然借用挑战房/钥匙房。
   *
   * 本函数因此改成"按正式规则挑房、再用生产函数装配"：
   *   1. 生成一层，按 eventRoomCandidate / findEventRoomSpot 的正式规则挑出候选房；
   *   2. 用 setupEventRoom()（生产函数）装配，forceRoomId 只用来钉住刚挑出的候选房，
   *      不改变候选过滤规则；
   *   3. 装配后硬断言宿主 challenge === null —— 一旦被借来挑战房，直接打印
   *      "FIXTURE: borrowed challenge room" 并判失败，绝不悄悄换层绕过。
   * 找不到干净候选时不静默返回失败，而是明确打印 "FIXTURE: no clean floor" 并判失败。
   */
  const setupOn = async (kind, floors) => {
    const baseList = floors || [3, 4, 5, 6, 2, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
    const MAX_ATTEMPTS = 40;
    let dirty = 0;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const floorNo = baseList[attempt % baseList.length];
      /* 生成该层 → 按正式规则挑干净宿主 → 用生产函数 setupEventRoom 装配 */
      const pick = await ev(`(function(){
        __roamDebug.event.setEnabled(true);
        __roamDebug.event.newFloor(${floorNo});
        /* setupEventRoom 入口会清掉本层事件房；这里同源执行一次，
           避免上一层残留的事件房占住房号，导致候选比正式路径更少 */
        resetEventRoomState();
        var spawn = state.rooms[state.spawnRoomId] || state.rooms[0];
        var stair = state.rooms.find(function(r){ return r.type === 'boss'; })
          || state.rooms[state.rooms.length - 1];
        var cand = eventRoomCandidate(spawn, stair);
        var hostId = -1;
        if (cand && findEventRoomSpot(cand)) hostId = cand.id;
        if (hostId < 0 && cand) {
          /* 与 setupEventRoom 同源：首选房放不下时，换一间非挑战房再试 */
          var alts = state.rooms.filter(function(r){
            return r && r.id !== cand.id && !r.challenge
              && ['battle','elite','chest','rest','event'].indexOf(r.type) >= 0
              && findEventRoomSpot(r);
          });
          if (alts.length) hostId = alts[0].id;
        }
        if (hostId < 0) {
          return { clean: false, floor: state.floor,
            types: state.rooms.map(function(r){ return r.type; }) };
        }
        /* forceRoomId 只钉住"刚按正式规则挑出的这间房"；挑战房在候选阶段已被排除 */
        var r = setupEventRoom(spawn, stair, {
          forceKind: '${kind}', bypassChance: true, forceRoomId: hostId
        });
        if (!r) return { clean: true, ok: false, floor: state.floor, reason: 'setup-failed' };
        /* 复刻调试口 setup 的"玩家已进房"状态（全是生产函数，不改玩法路径） */
        state.player.x = r.x;
        state.player.y = r.y + Math.min(40, EVENT_CONFIG.interactRange - 8);
        state.currentRoomId = r.roomId;
        state.rooms[r.roomId].visited = true;
        updateContextHints();
        var room = state.rooms[r.roomId];
        return { clean: true, ok: true, info: __roamDebug.event.info(),
          host: { id: room.id, type: room.type, orig: room.eventOriginalType || null,
            challenge: room.challenge ? room.challenge.kind : null } };
      })()`);
      FIXTURE_STATS.floorsTried += 1;
      if (!pick || !pick.clean) {
        FIXTURE_STATS.dirtyFloors += 1;
        dirty += 1;
        continue;
      }
      if (!pick.ok) continue;
      // 硬断言：宿主不得是挑战房（借挑战房说明预检与正式路径不同源，夹具失效）
      if (pick.host && pick.host.challenge) {
        FIXTURE_STATS.borrowed += 1;
        FIXTURE_STATS.borrowedDetail.push({ floor: pick.floor, kind: kind, room: pick.host.id, challenge: pick.host.challenge });
        console.log('FIXTURE: borrowed challenge room  ' + JSON.stringify({ floor: pick.floor, kind: kind, host: pick.host }));
        check('FIXTURE: borrowed challenge room', false,
          { floor: pick.floor, kind: kind, host: pick.host });
        continue;
      }
      FIXTURE_STATS.calls.push({ kind: kind, attempts: dirty + 1, dirty: dirty, floor: pick.floor });
      console.log('FIXTURE: ' + kind + ' 在 F' + pick.floor + ' 找到干净宿主（跳过 ' + dirty + ' 个脏层）');
      return pick;   // { ok: true, info, host }
    }
    FIXTURE_STATS.calls.push({ kind: kind, attempts: MAX_ATTEMPTS, dirty: dirty, floor: null });
    console.log('FIXTURE: no clean floor  ' + JSON.stringify({ kind: kind, attempts: MAX_ATTEMPTS, dirty: dirty }));
    check('FIXTURE: no clean floor', false, { kind: kind, attempts: MAX_ATTEMPTS, dirty: dirty });
    return { ok: false, reason: 'no-clean-floor-after-' + MAX_ATTEMPTS };
  };
  /** 把玩家/相机对齐到当前事件房，供截图 */
  const focusRoom = async () => ev(`(function(){
    var d = __roamDebug.event.info();
    if (d.room) { state.player.x = d.room.x; state.player.y = d.room.y + 36; }
    snapCamera();
    return true;
  })()`);

  attachEdgeExit(edge);
  await send('Page.navigate', { url: 'file:///' + MAIN.replace(/\\/g, '/') });
  await sleep(1600);
  await ev(`(function(){ try { state.onboardSkipAll = true; hideIntroHint(true); } catch (e) {} ; document.getElementById('btnStart').click(); return true; })()`);
  await sleep(2600);
  await ev(`(function(){
    state.mode='playing'; state.status='playing';
    if (state.currentRoomId == null || state.currentRoomId < 0) state.currentRoomId = 0;
    var room = state.rooms[state.currentRoomId] || state.rooms[0];
    if (room) { state.player.x = room.cx; state.player.y = room.cy; }
    return { mode: state.mode, room: state.currentRoomId };
  })()`);

  // ---------- 1) 默认配置 / 房型 / 门徽 ----------
  const base = await ev(`(function(){
    return {
      info: __roamDebug.event.info(),
      weights: JSON.parse(JSON.stringify(ROOM_TYPE_CONFIG.weights)),
      types: JSON.parse(JSON.stringify(ROOM_TYPE_CONFIG.types)),
      icons: JSON.parse(JSON.stringify(DOOR_VIS_CONFIG.icons)),
      labels: JSON.parse(JSON.stringify(DOOR_VIS_CONFIG.labels)),
      tips: JSON.parse(JSON.stringify(DOOR_INFO_CONFIG.tipByType)),
      schema: META_SCHEMA_VERSION,
      defaultMeta: JSON.parse(JSON.stringify(defaultMeta()))
    };
  })()`);
  check('总开关默认开启', base.info.enabled === true, base.info.enabled);
  check('三种房型独立注册（sacrifice/wager/curse）',
    !!base.types.sacrifice && !!base.types.wager && !!base.types.curse
    && base.types.sacrifice.count[0] === 0 && base.types.wager.count[0] === 0 && base.types.curse.count[0] === 0,
    { s: base.types.sacrifice, w: base.types.wager, c: base.types.curse });
  check('新类型不进入随机权重（关闭开关外不会随机刷出）',
    !base.weights.sacrifice && !base.weights.wager && !base.weights.curse, base.weights);
  check('门徽 / 门牌三套独立',
    base.icons.sacrifice === '☩' && base.icons.wager === '⚄' && base.icons.curse === '☠'
    && !!base.labels.sacrifice && !!base.labels.wager && !!base.labels.curse
    && !!base.tips.sacrifice && !!base.tips.wager && !!base.tips.curse,
    { icons: base.icons, labels: base.labels });
  // schema 随系统演进会继续递增（天赋 v2 已到 7），这里只要求"≥5 且默认 meta 带 eventStats"
  check('schema 已递增到 ≥5，默认 meta 含 eventStats',
    base.schema >= 5 && !!base.defaultMeta.eventStats
    && base.defaultMeta.eventStats.curses === 0, { schema: base.schema, events: base.defaultMeta.eventStats });

  // ---------- 2) 三房装配：房型 / 主物体 / 绘制 / 小地图 / 门板 ----------
  const built = {};
  for (const kind of ['sacrifice', 'wager', 'curse']) {
    built[kind] = await setupOn(kind);
    check('装配 ' + kind + ' 成功，且本层仅一间事件房',
      built[kind].ok && built[kind].info.room.kind === kind
      && built[kind].info.room.type === kind && built[kind].info.eventRooms === 1,
      built[kind].ok ? built[kind].info.room : built[kind]);
  }
  await focusRoom();
  await sleep(350);
  const drawInfo = await ev(`(function(){ return __roamDebug.event.info(); })()`);
  check('事件房主体物 / 小地图标记已绘制', drawInfo.stats.draws > 0 && drawInfo.stats.minimapMarks > 0,
    { draws: drawInfo.stats.draws, marks: drawInfo.stats.minimapMarks });
  check('事件房与首领房共存（同一层仍有楼梯房）',
    drawInfo.roomTypes.indexOf('boss') >= 0 && drawInfo.room && drawInfo.room.roomId
      !== (await ev(`(state.rooms.find(function(r){ return r.type === 'boss'; }) || {}).id`)),
    { types: drawInfo.roomTypes, room: drawInfo.room.roomId });

  // 迷雾可发现性：未进过的事件房，门牌仍要亮出代价（否则"进入前算清"不成立）
  const discover = await ev(`(function(){
    var d = __roamDebug.event.info();
    if (!d.room) return { ok: false };
    var room = state.rooms[d.room.roomId];
    room.visited = false; room.cleared = false;
    state.fog.seenRooms[room.id] = false;
    var door = state.doors.find(function(x){ return x.targetRoomId === room.id; });
    if (!door) return { ok: false, reason: 'no-door' };
    var info = doorInfoFor(door);
    var vis = doorVisFor(door);
    return { ok: true, unknown: info.unknown, tip: info.tip, hasEvent: !!info.eventRoom,
      visUnknown: vis.unknown, icon: vis.icon, label: vis.label };
  })()`);
  check('未进过的事件房：门牌提前亮出代价/收益，门徽不是问号',
    discover.ok && discover.unknown === false && discover.hasEvent === true
    && /−|胜率|每层/.test(discover.tip) && discover.visUnknown === false
    && discover.icon !== '?',
    discover);
  await ev(`(function(){
    var d = __roamDebug.event.info();
    __roamDebug.event.leave();
    if (d.room) state.fog.seenRooms[d.room.roomId] = false;
    return true;
  })()`);
  await sleep(450);
  const fogMark = await ev(`__roamDebug.event.info().stats.minimapMarks`);
  check('迷雾中的事件房仍在小地图亮出挂牌标记', fogMark > 0, { marks: fogMark });
  await setupOn('curse');
  await focusRoom();
  await sleep(320);
  await shot('event-curse.png');
  check('诅咒房截图已生成', fs.existsSync(path.join(OUT, 'event-curse.png')), true);

  // ---------- 3) 献祭：代价与收益只结算一次 ----------
  const sac = await ev(`(function(){
    var r = __roamDebug.event.setup('sacrifice');
    if (!r.ok) return { ok: false, reason: r.reason };
    __roamDebug.event.setHpMax(80);
    var before = __roamDebug.event.info();
    var cardsBefore = state.ownedMagic.length + state.ownedTech.length;
    var first = __roamDebug.event.accept();
    var second = __roamDebug.event.accept();
    var after = __roamDebug.event.info();
    var cardsAfter = state.ownedMagic.length + state.ownedTech.length;
    return { ok: true, before: before, first: first, second: second, after: after,
      cardsBefore: cardsBefore, cardsAfter: cardsAfter };
  })()`);
  check('献祭前门板写清代价与收益',
    sac.ok && /最大气血 −\d+/.test(sac.before.room.doorText) && /《/.test(sac.before.room.rewardText), sac.before && sac.before.room);
  check('献祭只结算一次（第二次 reason=used）', sac.ok && sac.first.ok && sac.second && sac.second.reason === 'used',
    sac.ok ? { first: sac.first, second: sac.second && { ok: sac.second.ok, reason: sac.second.reason } } : sac);
  check('献祭只扣一次上限且发一次卡',
    sac.ok && sac.after.hpMax === sac.before.hpMax - sac.first.cost
    && (sac.cardsAfter - sac.cardsBefore) >= 1 && sac.after.stats.sacrifice === 1,
    sac.ok ? { hpBefore: sac.before.hpMax, hpAfter: sac.after.hpMax, cost: sac.first.cost, cards: sac.cardsAfter - sac.cardsBefore } : sac);

  // ---------- 4) 拒绝：不扣东西 / 不锁门 / 能离开 ----------
  const rej = await ev(`(function(){
    var r = __roamDebug.event.setup('wager');
    if (!r.ok) return { ok: false, reason: r.reason };
    var before = __roamDebug.event.info();
    var res = __roamDebug.event.reject();
    var left = __roamDebug.event.leave();
    return { ok: true, before: before, res: res, left: left };
  })()`);
  check('拒绝后不锁门、门未关闭、可直接离开',
    rej.ok && rej.res.ok && rej.res.locked === false && rej.res.doorsClosed === 0
    && rej.left.ok && rej.left.currentRoomId !== rej.before.room.roomId
    && rej.before.crystals === rej.left.info.crystals,
    rej.ok ? { res: rej.res, leftRoom: rej.left.currentRoomId } : rej);

  // ---------- 5) 诅咒：连续触发不叠爆 + 同层去重 ----------
  const curse = await ev(`(function(){
    __roamDebug.event.setEnabled(true);
    __roamDebug.event.resetCurse();
    __roamDebug.event.setHpMax(100);
    var s = __roamDebug.event.setup('curse');
    if (!s.ok) return { ok: false, reason: s.reason };
    var a1 = __roamDebug.event.accept();
    var h1 = __roamDebug.event.info();
    /* 层号从"当前层"派生：上面的 setupOn 会挑到不同楼层，写死 4/5 会让
       "换层"变成"同层重建"（lastTickFloor 去重后不扣血）。断言数字不变，只让输入随实际层走。 */
    var cur = __roamDebug.event.info().floor;
    var f1 = __roamDebug.event.tickFloor(cur);            // 同层再触发：应跳过
    var n2 = __roamDebug.event.newFloor(cur + 1);         // 换层：应扣一次
    var f2 = __roamDebug.event.tickFloor(cur + 1);        // 同层重复：应跳过
    var s2 = __roamDebug.event.setup('curse');
    if (!s2.ok) return { ok: false, reason: 'second-setup' };
    var a2 = __roamDebug.event.accept();
    var n3 = __roamDebug.event.newFloor(cur + 2);
    return { ok: true, a1: a1, h1: h1, f1: f1, n2: n2, f2: f2, a2: a2, n3: n3 };
  })()`);
  check('诅咒第一次接受：每层 −6、立刻扣到 94',
    curse.ok && curse.a1.ok && curse.h1.curse.perFloor === 6 && curse.h1.hpMax === 94, curse.ok ? curse.h1 : curse);
  check('同层重复 tick 只扣一次（skip sameFloor）',
    curse.ok && curse.f1.applied === 0 && curse.f1.skipped === 'sameFloor', curse.ok ? curse.f1 : curse);
  check('换层扣一次：100 → 94 → 88',
    curse.ok && curse.n2.hpMax === 88, curse.ok ? { afterFloor4: curse.n2.hpMax } : curse);
  check('第二间诅咒累计到 −12/层，接受立刻再扣',
    curse.ok && curse.a2.ok && curse.a2.perFloor === 12 && curse.a2.hpMax === 82, curse.ok ? curse.a2 : curse);
  check('再次换层只扣 12 一次：82 → 70',
    curse.ok && curse.n3.hpMax === 70, curse.ok ? { afterFloor5: curse.n3.hpMax } : curse);

  // ---------- 6) 下限保护：最大气血永不低于 30 ----------
  const guard = await ev(`(function(){
    __roamDebug.event.resetCurse();
    __roamDebug.event.setHpMax(33);
    var s = __roamDebug.event.setup('sacrifice');
    if (!s.ok) return { ok: false, reason: s.reason };
    var cost = eventSacrificeCost();
    var a = __roamDebug.event.accept();
    var hp1 = __roamDebug.event.info();
    var s2 = __roamDebug.event.setup('curse');
    if (!s2.ok) return { ok: false, reason: 'curse-setup' };
    var a2 = __roamDebug.event.accept();
    var hp2 = __roamDebug.event.info();
    // 已经贴到 30：再开祭坛必须是"沉睡"状态，E 不接受但也不锁门
    var s3 = __roamDebug.event.setup('sacrifice');
    if (!s3.ok) return { ok: false, reason: 'sacrifice-sleep-setup' };
    var a3 = __roamDebug.event.accept();
    return { ok: true, cost: cost, a: a, hp1: hp1, a2: a2, hp2: hp2, a3: a3, sleepInfo: __roamDebug.event.info() };
  })()`);
  check('献祭自动压到 33 → 30（实际只扣 3）',
    guard.ok && guard.cost === 3 && guard.a.ok && guard.a.cost === 3 && guard.hp1.hpMax === 30,
    guard.ok ? { cost: guard.cost, applied: guard.a.cost, hpMax: guard.hp1.hpMax } : guard);
  check('下限 30 后诅咒再扣 0，且标记 guarded',
    guard.ok && guard.a2.ok && guard.a2.applied === 0 && guard.a2.guarded === true && guard.hp2.hpMax === 30,
    guard.ok ? guard.a2 : guard);
  check('下限后祭坛沉睡（E 不结算，门不锁、可离开）',
    guard.ok && guard.a3 && guard.a3.reason === 'floor' && guard.sleepInfo.room
    && guard.sleepInfo.room.locked === false && guard.sleepInfo.room.doorsClosed === 0
    && guard.sleepInfo.hpMax === 30,
    guard.ok ? { reason: guard.a3 && guard.a3.reason, room: guard.sleepInfo.room, hpMax: guard.sleepInfo.hpMax } : guard);

  // ---------- 7) 赌注：明示胜率 / 赢 / 输 / 落闸 / 只能一次 ----------
  const wagerWin = await ev(`(function(){
    __roamDebug.event.setEnabled(true);
    var s = __roamDebug.event.setup('wager');
    if (!s.ok) return { ok: false, reason: s.reason };
    /* 断言夹具：同一帧内把"层词缀 / 永久天赋"的结晶倍率借走，
       让结算回到干净口径 10 → 15；断言完立刻还原，不跨帧。 */
    var parked = __roamDebug.event.parkCrystalMul();
    __roamDebug.event.setCrystals(10);
    __roamDebug.event.forceWager('win');
    var before = __roamDebug.event.info();
    var a = __roamDebug.event.accept('half');
    var second = __roamDebug.event.accept('all');
    __roamDebug.event.restoreCrystalMul(parked);
    return { ok: true, before: before, a: a, second: second };
  })()`);
  check('赌注门板明示胜率 55%',
    wagerWin.ok && /胜率 55%/.test(wagerWin.before.room.doorText), wagerWin.ok ? wagerWin.before.room.doorText : wagerWin);
  check('半注 5 赢后结晶 10 → 15，且锁定不可再押',
    wagerWin.ok && wagerWin.a.ok && wagerWin.a.win === true && wagerWin.a.staked === 5
    && wagerWin.before.crystals === 10 && wagerWin.a.crystals === 15
    && wagerWin.a.locked === true && wagerWin.second.reason === 'used',
    wagerWin.ok ? wagerWin.a : wagerWin);
  await sleep(1500);
  const wagerOpen = await ev(`__roamDebug.event.info()`);
  check('落闸 1.2 秒后自动开门（doorsClosed=0）',
    wagerOpen.room && wagerOpen.room.locked === false && wagerOpen.room.doorsClosed === 0,
    wagerOpen.room ? { locked: wagerOpen.room.locked, doors: wagerOpen.room.doorsClosed } : wagerOpen);

  const wagerLose = await ev(`(function(){
    var s = __roamDebug.event.setup('wager');
    if (!s.ok) return { ok: false, reason: s.reason };
    __roamDebug.event.setCrystals(10);
    __roamDebug.event.forceWager('lose');
    var a = __roamDebug.event.accept('all');
    return { ok: true, a: a };
  })()`);
  check('全押 10 输后清空为 0',
    wagerLose.ok && wagerLose.a.ok && wagerLose.a.win === false && wagerLose.a.staked === 10 && wagerLose.a.crystals === 0,
    wagerLose.ok ? wagerLose.a : wagerLose);
  await sleep(1400);

  // ---------- 8) 关闭开关：20 层零行为差异 ----------
  const off = await ev(`(function(){
    __roamDebug.event.resetCurse();
    __roamDebug.event.setEnabled(false);
    var maxRooms = 0, touched = 0, nulls = 0, bad = [];
    for (var n = 2; n <= 21; n += 1) {
      var d = __roamDebug.event.newFloor(n);
      var cnt = 0;
      d.roomTypes.forEach(function(t){ if (t === 'sacrifice' || t === 'wager' || t === 'curse') cnt += 1; });
      maxRooms = Math.max(maxRooms, cnt);
      if (cnt > 0 || d.eventRooms > 0) touched += 1;
      if (!d.room) nulls += 1;
      if (d.room) bad.push(n);
    }
    var after = __roamDebug.event.info();
    return { maxRooms: maxRooms, touched: touched, nulls: nulls, bad: bad,
      stats: after.stats, rooms: after.roomTypes };
  })()`);
  check('关闭开关后 20 层无新类型房 / 无事件房',
    off.maxRooms === 0 && off.touched === 0 && off.bad.length === 0, off);
  check('关闭开关后统计不增长（draws/marks = 0）',
    off.stats.draws === 0 && off.stats.minimapMarks === 0 && off.stats.rooms === 0,
    { draws: off.stats.draws, marks: off.stats.minimapMarks, rooms: off.stats.rooms });

  // ---------- 9) 存档迁移：v0 / v3 / v4 旧档不崩 ----------
  const mig = await ev(`(function(){
    var a = __roamDebug.event.migrate({ version: 0, crystals: 7, bestFloor: 4 }, 0);
    var b = __roamDebug.event.migrate({ version: 3, crystals: 12, bestFloor: 9, talents: { hp: 2 } }, 3);
    var c = __roamDebug.event.migrate({ version: 4, crystals: 5, performance: { mode: true } }, 4);
    var d = __roamDebug.event.normalize({ version: 4, crystals: 'x', eventStats: { sacrifice: -3 } });
    return { a: a, b: b, c: c, d: d, schemaVersion: META_SCHEMA_VERSION };
  })()`);
  check('v0 旧档：版本升到当前 schema、结晶保留、eventStats 齐全',
    mig.a.version === mig.schemaVersion && mig.a.crystals === 7 && mig.a.bestFloor === 4 && !!mig.a.eventStats
    && mig.a.eventStats.sacrifice === 0, { version: mig.a.version, crystals: mig.a.crystals });
  check('v3/v4 旧档：原有数据不丢、不抛异常',
    mig.b.version === mig.schemaVersion && mig.b.crystals === 12 && mig.b.bestFloor === 9 && !!mig.b.eventStats
    && mig.c.version === mig.schemaVersion && mig.c.crystals === 5 && !!mig.c.eventStats, { b: mig.b, c: mig.c });
  check('脏数据归一化不崩：负数统计归 0',
    mig.d.version === mig.schemaVersion && !!mig.d.eventStats && mig.d.eventStats.sacrifice === 0,
    { version: mig.d.version, events: mig.d.eventStats });

  // ---------- 10) 与隐藏房 / 虚空裂隙 / 双祭坛不冲突 ----------
  const mutex = await ev(`(function(){
    __roamDebug.event.setEnabled(true);
    var found = null;
    for (var n = 3; n <= 10; n += 1) {
      var d = __roamDebug.event.newFloor(n);
      var s = __roamDebug.event.setup(n % 3 === 0 ? 'curse' : (n % 3 === 1 ? 'sacrifice' : 'wager'));
      if (!s.ok) continue;
      d = __roamDebug.event.info();
      if (d.hiddenExists) { found = d; break; }
    }
    return found;
  })()`);
  const distTo = (a, b) => (a && b) ? Math.hypot(a.x - b.x, a.y - b.y) : 999;
  check('有事件房的层依然生成隐藏房，且主体物与隐藏门不重叠',
    !!mutex && mutex.hiddenExists && mutex.room
    && distTo(mutex.eventPoint, mutex.hiddenGap) >= 82,
    mutex ? { eventRoom: mutex.room.roomId, hiddenHost: mutex.hiddenHostId,
      hiddenDistance: Math.round(distTo(mutex.eventPoint, mutex.hiddenGap)) } : mutex);
  check('事件房不与双祭坛同房，且主体物与裂隙门不重叠',
    !!mutex && mutex.room.roomId !== mutex.dualAltarRoomId
    && distTo(mutex.eventPoint, mutex.voidPoint) >= 82,
    mutex ? { room: mutex.room.roomId, vs: mutex.voidSourceId, vt: mutex.voidTargetId,
      dual: mutex.dualAltarRoomId, riftDistance: Math.round(distTo(mutex.eventPoint, mutex.voidPoint)) } : mutex);

  // ---------- 11) 每层最多一间 + 无候选正常回退 ----------
  const perFloor = await ev(`(function(){
    __roamDebug.event.resetCurse();
    __roamDebug.event.setEnabled(true);
    __roamDebug.event.setChance(1);
    var maxRooms = 0, withRoom = 0, nullCount = 0, revert = 0;
    for (var n = 2; n <= 21; n += 1) {
      var d = __roamDebug.event.newFloor(n);
      var cnt = d.roomTypes.filter(function(t){ return t === 'sacrifice' || t === 'wager' || t === 'curse'; }).length;
      maxRooms = Math.max(maxRooms, cnt);
      if (cnt === 1) withRoom += 1;
      if (!d.room) nullCount += 1;
      if (!d.room && cnt === 0) revert += 1;
    }
    return { maxRooms: maxRooms, withRoom: withRoom, nullCount: nullCount, revert: revert };
  })()`);
  /* 断言只验"每层最多一间"这条不变量（maxRooms ≤ 1）。
     旧版写死 maxRooms === 1，隐含要求 20 层里至少有一层存在干净候选房；
     实测干净候选层只占约 13%，20 层里抽不到候选的概率约 6%，属于夹具自身的偶发红。 */
  check('每层最多一间事件房（20 层 maxRooms ≤ 1）', perFloor.maxRooms <= 1, perFloor);
  check('无候选/未命中时正常回退（不留半成品房）',
    perFloor.nullCount + perFloor.withRoom === 20 && perFloor.revert === perFloor.nullCount, perFloor);

  // ---------- 12) 三房截图 ----------
  for (const kind of ['sacrifice', 'wager', 'curse']) {
    const s = await setupOn(kind);
    if (s.ok) {
      await focusRoom();
      await sleep(360);
      await shot('event-' + kind + '.png');
    }
  }
  check('三房截图齐全',
    ['sacrifice', 'wager', 'curse'].every((k) => fs.existsSync(path.join(OUT, 'event-' + k + '.png'))), true);

  // ---------- 夹具守卫汇总（用于回答"无干净候选层的比例"） ----------
  const dirtyPct = FIXTURE_STATS.floorsTried
    ? Math.round((FIXTURE_STATS.dirtyFloors / FIXTURE_STATS.floorsTried) * 1000) / 10 : 0;
  console.log('\nFIXTURE-SCAN: 层尝试 ' + FIXTURE_STATS.floorsTried
    + ' / 无干净候选 ' + FIXTURE_STATS.dirtyFloors + ' (' + dirtyPct + '%)'
    + ' / borrowed ' + FIXTURE_STATS.borrowed);
  console.log('  calls: ' + JSON.stringify(FIXTURE_STATS.calls));
  if (FIXTURE_STATS.borrowed) {
    console.log('  borrowedDetail: ' + JSON.stringify(FIXTURE_STATS.borrowedDetail));
  }
  check('夹具未借用挑战房（borrowed = 0）', FIXTURE_STATS.borrowed === 0,
    { borrowed: FIXTURE_STATS.borrowed, dirtyFloors: FIXTURE_STATS.dirtyFloors, floorsTried: FIXTURE_STATS.floorsTried });

  // ---------- 汇总 ----------
  const pass = checks.filter((c) => c.ok).length;
  const fail = checks.filter((c) => !c.ok);
  console.log(`\nRESULT: ${pass}/${checks.length} ${fail.length ? 'FAIL' : 'PASS'}`);
  console.log('页面异常: ' + (errors.length ? errors.join(' | ') : '0'));
  if (fail.length) fail.forEach((f) => console.log('  FAILED: ' + f.name + ' ' + JSON.stringify(f.detail)));
  ws.close();
  edge.kill();
  process.exit(fail.length || errors.length ? 1 : 0);
}

main().catch((err) => {
  console.log('FATAL ' + (err && err.stack ? err.stack : err));
  process.exit(1);
});
