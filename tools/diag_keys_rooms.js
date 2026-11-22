/**
 * v2.2.7 探针：技能卡键位标签 + 选房候选重复
 * ------------------------------------------------------------
 * 用法：node tools/diag_keys_rooms.js [目标html相对路径]
 *   默认读交付件 delivery/烬-奥术工程师-试玩版.html（"实机"口径）
 * 输出：
 *   lab/player8/v227_probe_before.png   三张卡 + F 角标的截图
 *   lab/player8/key_room_probe.json     全部读数
 *
 * 只读：不写存档、不改游戏数据；只在内存里临时发牌/改房间标记用于造场景。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9771;
const ROOT = path.join(__dirname, '..');
const TARGET = path.resolve(ROOT, process.argv[2] || path.join('delivery', '烬-奥术工程师-试玩版.html'));
const OUTDIR = path.join(ROOT, 'lab', 'player8');
const OUTJSON = path.join(OUTDIR, 'key_room_probe.json');
const OUTFMT = process.argv[3] || 'before';
const SHOT = path.join(OUTDIR, 'v227_probe_' + OUTFMT + '.png');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 起一个无头 Edge 并连上 CDP，返回 { send, ev, shot } */
async function boot() {
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${prepareProfile()}`, '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--allow-file-access-from-files', '--window-size=1920,1080', 'about:blank',
  ], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 120; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (target) break;
    } catch (e) { /* 等端口 */ }
    await sleep(250);
  }
  if (!target) throw new Error('Edge 调试端口未就绪');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.method === 'Runtime.exceptionThrown') {
      const e = d.params.exceptionDetails || {};
      events.push({ t: Date.now(), text: (e.exception && (e.exception.description || e.exception.value)) || e.text });
    } else if (d.method === 'Log.entryAdded') {
      events.push({ t: Date.now(), text: 'LOG ' + (d.params.entry.text || '') });
    }
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res, rej) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? rej(new Error(method + ' ' + JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 500));
    return r.result.value;
  };
  const shot = async (file) => {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(s.data, 'base64'));
  };
  return { edge, send, ev, shot, events, close: () => { try { ws.close(); } catch (e) { /* */ } killEdge(edge); } };
}

/** 发一次真实键盘事件（走 CDP Input，和真人按键同一条输入管线） */
async function press(send, key, code, vk) {
  const base = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
  await send('Input.dispatchKeyEvent', Object.assign({ type: 'rawKeyDown' }, base));
  await send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, base));
  await sleep(350);
}

/** 读"按键前后"的可观测状态：投射物数 / 蓝量 / 冷却文本 / 选房浮层 / 焦点 */
const OBS = `(() => ({
  projectiles: state.projectiles.length,
  mp: Math.round(state.player.mp),
  activeMagic: state.activeMagicId,
  cdText: Array.prototype.map.call(document.querySelectorAll('[data-cdtext]'), function (e) { return e.textContent; }).join('|'),
  pickerOpen: !!roomPickerOpen,
  activeEl: (document.activeElement && (document.activeElement.id || document.activeElement.tagName)) || '',
  mode: state.mode
}))()`;

/** 主流程 */
async function main() {
  fs.mkdirSync(OUTDIR, { recursive: true });
  const { send, ev, shot, events, close } = await boot();
  const result = { target: TARGET, at: new Date().toISOString(), labels: null, keymap: null, keys: [], rooms: [] };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  const url = 'file:///' + TARGET.replace(/\\/g, '/');
  await send('Page.navigate', { url: url });
  let ready = false;
  for (let i = 0; i < 160; i += 1) {
    if (await ev("!!document.getElementById('btnStart') && typeof startGame === 'function'")) { ready = true; break; }
    await sleep(250);
  }
  if (!ready) {
    const diag = await ev("({ url: location.href, state: document.readyState, title: document.title, body: (document.body ? document.body.id : ''), hasBtn: !!document.getElementById('btnStart') })");
    throw new Error('页面没就绪 ' + JSON.stringify(diag) + ' target=' + TARGET + ' url=' + url);
  }
  await ev("document.getElementById('btnStart').click()");
  await sleep(600);
  await ev("const c=document.querySelector('.char-card'); if(c) c.click();");
  await sleep(300);
  await ev("const b=document.getElementById('btnCharConfirm'); if(b) b.click();");
  await sleep(1800);

  /* L0：主循环活性 + 回访记录器是否真的在写（entries 从不增长就说明 visited 没人写） */
  result.live = await ev(`(() => new Promise(function (res) {
    var t0 = state.elapsed, e0 = BACKTRACK_STATS.entries, v0 = JSON.stringify(state.backtrack ? state.backtrack.visited : {});
    setTimeout(function () {
      res({ dElapsed: Math.round((state.elapsed - t0) * 1000) / 1000, entries0: e0,
        entries1: BACKTRACK_STATS.entries,
        btCurrent: state.backtrack ? state.backtrack.currentRoomId : null,
        visited0: v0, visited1: JSON.stringify(state.backtrack ? state.backtrack.visited : {}),
        backtrackEnabled: BACKTRACK_CONFIG.enabled });
    }, 500);
  }))()`);

  /* ---------- 1. 造出"三张卡"的场面（玩家截图里的样子） ---------- */
  await ev(`(() => {
    state.ownedMagic = MAGIC_CONFIG.slice(0, 3).map(function (m) { return m.id; });
    state.cardFloor = {};
    MAGIC_CONFIG.slice(0, 3).forEach(function (m, i) { state.cardFloor['magic:' + m.id] = i + 1; });
    renderDeck();
    return state.ownedMagic;
  })()`);
  await sleep(500);
  await shot(SHOT);

  /* ---------- 2. 卡面标签来源：m-key / m-floor 分别是什么 ---------- */
  result.labels = await ev(`(() => {
    var cards = Array.prototype.map.call(document.querySelectorAll('.mini-card'), function (card) {
      var k = card.querySelector('.m-key');
      var f = card.querySelector('.m-floor');
      var r = card.getBoundingClientRect();
      return {
        id: card.dataset.magicId || card.dataset.techId || '',
        name: (card.querySelector('.m-name') || {}).textContent || '',
        keyBadge: k ? k.textContent : null,
        floorBadge: f ? f.textContent : null,
        floorBadgeTitle: f ? f.title : '',
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
      };
    });
    /* 全页面扫"纯 F+数字"的可见文本，逐个报出处 */
    var fTexts = [];
    document.querySelectorAll('body *').forEach(function (el) {
      if (el.children.length) return;
      var t = (el.textContent || '').trim();
      if (!/^F\\d+$/.test(t)) return;
      if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return;
      var r = el.getBoundingClientRect();
      fTexts.push({ text: t, cls: el.className, x: Math.round(r.x), y: Math.round(r.y),
        parent: (el.parentElement ? el.parentElement.className : '') });
    });
    return { cards: cards, fTexts: fTexts, magicCount: MAGIC_CONFIG.length, owned: state.ownedMagic };
  })()`);

  /* ---------- 3. 键位真身：F1/F2/F3 与 1/2/3 分别映射到什么动作 ---------- */
  result.keymap = await ev(`(() => {
    var mk = function (key, code) { return keyToAction({ key: key, code: code, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, repeat: false }); };
    return {
      F1: mk('F1', 'F1'), F2: mk('F2', 'F2'), F3: mk('F3', 'F3'),
      Digit1: mk('1', 'Digit1'), Digit2: mk('2', 'Digit2'), Digit3: mk('3', 'Digit3'),
      pickerKey: ROOM_PICKER_CONFIG.key,
      deckKeys: MAGIC_CONFIG.map(function (m, i) { return (i + 1) + '=' + m.name; })
    };
  })()`);

  /* ---------- 4. 真按一遍：F1 / F2 / F3（再补 1 / 2 做阳性对照） ---------- */
  const seq = [
    ['F1', 'F1', 112], ['F2', 'F2', 113], ['F3', 'F3', 114], ['1', 'Digit1', 49], ['q', 'KeyQ', 81]
  ];
  for (let i = 0; i < seq.length; i += 1) {
    const [key, code, vk] = seq[i];
    /* 先按 Esc 关掉可能被 Q 打开的浮层，保证单项隔离 */
    await press(send, 'q', 'KeyQ', 81);
    await press(send, 'q', 'KeyQ', 81);
    const before = await ev(OBS);
    await press(send, key, code, vk);
    const after = await ev(OBS);
    result.keys.push({ key: key, before: before, after: after,
      changedProjectiles: after.projectiles - before.projectiles,
      changedMp: after.mp - before.mp });
  }

  /* ---------- 5. 选房候选：按玩家真实路径走 ---------- */
  /**
   * 快照：当前所在房 + 候选列表（每间带上 visited / cleared / 是否相邻）+ fallback + 提示文案
   * @param {string} tag 场景标签
   */
  const snapRoom = async (tag) => ev(`(() => {
    if (!roomPickerOpen) openRoomPicker(); else renderRoomPicker();
    var cur = state.rooms[state.currentRoomId] || {};
    var ids = nextRoomChoices();
    var cards = Array.prototype.map.call(document.querySelectorAll('#roomPickerList button'), function (b) {
      return { id: Number(b.dataset.roomId), text: (b.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 70) };
    });
    return {
      tag: ${JSON.stringify(tag)},
      cur: state.currentRoomId, curType: cur.type,
      curVisited: !!cur.visited, curCleared: !!cur.cleared,
      fallback: roomChoiceFallback,
      title: (document.getElementById('roomPickerTitle') || {}).textContent || '',
      note: (document.getElementById('roomPickerNote') || {}).textContent || '',
      choices: ids.map(function (id) {
        var r = state.rooms[id] || {};
        return { id: id, type: r.type, visited: !!r.visited, cleared: !!r.cleared,
          adjacent: roomsAreNeighbors(state.currentRoomId, id) };
      }),
      cards: cards
    };
  })()`);

  const closePicker = () => ev("(() => { if (typeof closeRoomPicker === 'function') closeRoomPicker(); return 1; })()");
  result.rooms.push(await snapRoom('A 出生房 · 刚开局'));
  await closePicker();

  /* A2：玩家真实路径——进一间"不用打怪"的房（休整/宝箱/事件），不清理，再走回出生房。
     改前 rest 房没有 cleared，visited 又没人写 → 它会重新出现在候选里（这就是玩家看到的现象）。 */
  const soft = (result.rooms[0].choices || []).find(function (c) {
    return ['rest', 'chest', 'event', 'shop', 'puzzle'].indexOf(c.type) >= 0;
  });
  if (soft) {
    await ev(`(() => { pickRoomFromOverlay(${soft.id}); return 1; })()`);
    await sleep(900);
    result.softEnter = await ev(`(() => { var r = state.rooms[${soft.id}]; return { cur: state.currentRoomId, visited: !!r.visited, cleared: !!r.cleared }; })()`);
    await ev(`(() => { pickRoomFromOverlay(state.spawnRoomId); return 1; })()`);
    await sleep(900);
    result.softBack = await ev("state.currentRoomId");
    result.rooms.push(await snapRoom('A2 进过非战斗房 ' + soft.id + ' 又回出生房 · 它是否又出现'));
    await closePicker();
  }

  /* 真实走一步：用 pickRoomFromOverlay（和玩家点卡片同一个入口） */
  const stepId = result.rooms[0].choices.length ? result.rooms[0].choices[0].id : -1;
  const moved = await ev(`(() => { pickRoomFromOverlay(${stepId}); return state.currentRoomId; })()`);
  await sleep(700);
  const afterMove = await ev("({cur: state.currentRoomId, visited: !!(state.rooms[state.currentRoomId]||{}).visited})");
  /* 追问：传送之后 visited 到底有没有被写、由谁写（trackBacktrack 每帧都会调） */
  result.moveTrace = [];
  for (let i = 0; i < 8; i += 1) {
    result.moveTrace.push(await ev(`(() => {
      var cur = state.rooms[state.currentRoomId] || {};
      var at = (typeof roomAt === 'function') ? roomAt(state.player.x, state.player.y) : null;
      return { t: ${i} * 200, cur: state.currentRoomId, roomAt: at ? at.id : -1,
        curVisited: !!cur.visited, curCleared: !!cur.cleared,
        btVisited: !!(state.backtrack && state.backtrack.visited[cur.id]),
        btCurrent: state.backtrack ? state.backtrack.currentRoomId : null,
        btKeys: state.backtrack ? Object.keys(state.backtrack.visited).join(',') : '',
        sameObj: at ? (state.rooms[state.currentRoomId] === at) : null,
        entries: (typeof BACKTRACK_STATS === 'object') ? BACKTRACK_STATS.entries : -1,
        status: state.status, mode: state.mode };
    })()`));
    await sleep(200);
  }
  /* 追问 2：手动调 trackBacktrack 会不会写；updateRoomLogic 每帧到底有没有被调 */
  result.manualBacktrack = await ev(`(() => {
    var before = !!state.rooms[1].visited;
    if (typeof trackBacktrack === 'function') trackBacktrack(state.rooms[1]);
    return { before: before, after: !!state.rooms[1].visited,
      entries: BACKTRACK_STATS.entries, visited: JSON.stringify(state.backtrack.visited) };
  })()`);
  result.loopCalls = await ev(`(() => new Promise(function (res) {
    window.__rlCount = 0;
    var orig = window.__rlOrig || updateRoomLogic;
    window.__rlOrig = orig;
    try {
      updateRoomLogic = function (dt) { window.__rlCount += 1; return orig(dt); };
    } catch (e) { return res({ wrapError: String(e) }); }
    setTimeout(function () { res({ calls: window.__rlCount }); }, 500);
  }))()`);
  /* 追问 3：手动调一次 updateRoomLogic，看"进房链"本身能不能写 visited */
  result.manualRoomLogic = await ev(`(() => {
    var e0 = BACKTRACK_STATS.entries, v0 = !!state.rooms[1].visited;
    var err = '';
    try { updateRoomLogic(0.016); } catch (e) { err = String(e); }
    return { err: err, entries0: e0, entries1: BACKTRACK_STATS.entries,
      visited0: v0, visited1: !!state.rooms[1].visited, cur: state.currentRoomId };
  })()`);
  /* 清房（把该房敌人标死），模拟玩家打完 */
  await ev(`(() => {
    var r = state.rooms[state.currentRoomId];
    r.cleared = true; r.locked = false;
    (state.enemies || []).forEach(function (e) { if (e && e.roomId === r.id) { e.dead = true; e.hp = 0; } });
    return 1;
  })()`);
  result.rooms.push(await snapRoom('B 第一间已清 · 正常层'));
  result.stepMove = { pick: stepId, movedReturn: moved, afterMove: afterMove };
  await closePicker();

  /* 走到"只剩最后一间"：把除当前房外的内容房全部标成 visited + cleared */
  await ev(`(() => {
    var keep = -1;
    state.rooms.forEach(function (r) {
      if (r.id === state.currentRoomId || r.type === 'boss' || r.id === state.spawnRoomId) return;
      if (keep < 0 && roomNeighbors(state.currentRoomId).indexOf(r.id) >= 0) { keep = r.id; return; }
      r.visited = true; r.cleared = true;
      if (state.backtrack) state.backtrack.visited[r.id] = true;
    });
    window.__keepRoom = keep;
    return keep;
  })()`);
  result.rooms.push(await snapRoom('C 只剩 1 间未走（正常应只剩它）'));
  await closePicker();

  /* 把最后一间也标成走过 → 触发"回访候选" */
  await ev(`(() => {
    state.rooms.forEach(function (r) {
      if (r.id === state.currentRoomId) return;
      r.visited = true; r.cleared = true;
      if (state.backtrack) state.backtrack.visited[r.id] = true;
    });
    return 1;
  })()`);
  result.rooms.push(await snapRoom('D 全层走完 · 回访候选'));
  await closePicker();

  /* 首领房清完：进 Boss 房并标清 */
  await ev(`(() => {
    var boss = state.rooms.find(function (r) { return r.type === 'boss'; });
    if (!boss) return 'no-boss';
    state.currentRoomId = boss.id; boss.visited = true; boss.cleared = true;
    if (state.backtrack) state.backtrack.visited[boss.id] = true;
    (state.enemies || []).forEach(function (e) { if (e && e.roomId === boss.id) { e.dead = true; e.hp = 0; } });
    return boss.id;
  })()`);
  result.rooms.push(await snapRoom('E 首领房已清 · 下楼前'));
  await closePicker();

  /* 下楼后再看一次（下楼本身走 descendFloor，可能被转场拦，读到的层数如实记录） */
  const floorBefore = await ev("state.floor");
  await ev("(() => { if (typeof descendFloor === 'function') descendFloor(); return 1; })()");
  await sleep(1400);
  const floorAfter = await ev("state.floor");
  result.descend = { before: floorBefore, after: floorAfter };
  result.rooms.push(await snapRoom('F 下楼后 · 新一层出生房'));
  await closePicker();

  fs.writeFileSync(OUTJSON, JSON.stringify(result, null, 2), 'utf8');
  console.log('SHOT', SHOT);
  console.log('JSON', OUTJSON);
  console.log('EVENTS', events.length, JSON.stringify(events.slice(0, 3)).slice(0, 600));
  console.log(JSON.stringify({ labels: result.labels, keymap: result.keymap }, null, 2));
  result.keys.forEach(function (k) {
    console.log('KEY', k.key, 'proj', k.changedProjectiles, 'mp', k.changedMp,
      'picker', k.after.pickerOpen, 'focus', k.after.activeEl);
  });
  result.rooms.forEach(function (r) {
    console.log('ROOM', r.tag, 'cur', r.cur, r.curType, 'fallback', r.fallback,
      'choices', JSON.stringify(r.choices), 'note', JSON.stringify(r.note));
  });
  console.log('DESCEND', JSON.stringify(result.descend), 'MOVE', JSON.stringify(result.stepMove));
  close();
}

main().catch((e) => { console.error('FATAL', e && e.message); process.exit(1); });
