/**
 * P0-3 通关链路验收：第 1 层 → 第 5 层首领 → 通关结算面板 → 重开
 * ----------------------------------------------------------------------------
 * 口径声明（报告里必须照抄，不许省略）：
 *   【自动化通关验证，非真人】
 *   本探针在页面内注入 __ptStep()：每帧把玩家 hp 拉满、invuln=9，
 *   并用 __roamDebug.damageBoss(999999) 直接扣首领血。
 *   它验证的是"链路是否通、面板是否正常"，**不代表真人难度手感**，
 *   也不得被引用为"有人通关了"。
 *
 * 为什么不用 setFloor 逐层跳：
 *   setFloor 会重新生成地图并丢掉本局状态（等级/结晶/连杀），
 *   那样跑出来的"一次通关"其实是 5 次独立开局拼起来的，结算数字没有意义。
 *   这里走真实下楼入口 interactStairs()（只把玩家传送到楼梯旁，省走路），
 *   楼层、等级、击杀、结晶都是同一局连续累积的。
 *
 * 断言（每条都打印证据）：
 *   C1 点开始能进第 1 层
 *   C2–C6 每层：首领房可进 → 首领登场 → 击杀 → 楼梯解锁（F1–F4 真的下楼到 f+1）
 *   C7 第 5 层首领倒下后进通关结算（.victory-modal）
 *   C8 结算数字正常（楼层 5 / 击杀数与运行态一致 / 面板三段核心数字非空）
 *   C9 重开按钮可命中且真的回到第 1 层满血
 *   C10 全程控制台零 JS 报错
 *
 * 用法：node tools/p0_clear_path.js
 * 产物：.screenshots/p0/clear-*.png、.screenshots/p0/p0-clear-path.json
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9611;
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'index_arcane_v2.html');
const OUT = path.join(ROOT, '.screenshots', 'p0');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const asserts = [];
/**
 * 记录一条断言并打印证据
 * @param {string} name 断言名
 * @param {boolean} pass 是否通过
 * @param {*} detail 证据对象
 * @returns {void}
 */
function ok(name, pass, detail) {
  asserts.push({ name, pass: !!pass, detail: detail === undefined ? null : detail });
  console.log((pass ? 'PASS' : 'FAIL') + ' · ' + name + (detail === undefined ? '' : ' · ' + JSON.stringify(detail)));
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=1440,900', 'about:blank'
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
  /** 控制台 / 未捕获异常收集（C10 的证据来源） */
  const consoleErrors = [];
  ws.onmessage = (msg) => {
    const m = JSON.parse(msg.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails || {};
      consoleErrors.push('exception: ' + (d.exception ? d.exception.description : d.text));
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      consoleErrors.push('console.error: ' + (m.params.args || []).map((a) => a.value || a.description || '').join(' '));
    }
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? reject(new Error(method + ': ' + JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  /**
   * 在页面里求值并取回值
   * @param {string} expression 页面内表达式
   * @returns {Promise<*>} 结果值
   */
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  /**
   * 截一张图到 .screenshots/p0/
   * @param {string} name 文件名
   * @returns {Promise<void>}
   */
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };
  /**
   * 按选择器取元素中心真实点击（走 CDP 输入，不是 el.click()）
   * @param {string} selector CSS 选择器
   * @returns {Promise<{x:number,y:number}|null>} 点击坐标
   */
  const clickAt = async (selector) => {
    const box = await ev(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return null;
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    if (!box) return null;
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    return box;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
  await sleep(2400);

  // ---------- 注入步进器（血量/无敌拉满 = 自动化口径，见文件头） ----------
  await ev(`(() => {
    window.__p0Errors = [];
    window.addEventListener('error', (e) => window.__p0Errors.push(String(e.message || e.error)));
    window.addEventListener('unhandledrejection', (e) => window.__p0Errors.push('reject: ' + String(e.reason)));
    /* 同步步进 n 帧：每次 update 前把 hp 拉满、给 9s 无敌（探针特权） */
    window.__ptStep = (n) => {
      const p = state.player;
      for (let i = 0; i < n; i += 1) {
        p.invuln = 9; p.hp = p.hpMax; p.aether = p.aetherMax;
        state.keys = { left: false, right: false, up: false, down: false };
        update(1 / 60);
        let g = 0;
        while (state.mode === 'reward' && g < 8) { __roamDebug.xp.chooseFirst(); g += 1; }
      }
      return state.mode;
    };
    /* 消化奖励队列，避免弹窗把下楼冻住 */
    window.__ptDrain = (n) => {
      let i = 0;
      while (state.mode === 'reward' && i < (n || 40)) { __roamDebug.xp.chooseFirst(); i += 1; }
      return state.mode;
    };
    return true;
  })()`);

  // ---------- C1 开局 ----------
  await ev(`__roamDebug.onboard.reset(true)`);
  await clickAt('[data-difficulty="normal"]');
  await sleep(200);
  await clickAt('#btnStart');
  await sleep(900);
  /* 三角色 C：点"开始"后先弹角色选择页（Esc 不可跳），必须选卡 + 确认才算真开局。
     这里走真实点击：点第一张卡 → 点"以此角色开始"。 */
  const charLayer = await ev(`(() => {
    const layer = document.getElementById('charLayer');
    if (!layer) return { exists: false };
    const open = !layer.classList.contains('hidden');
    const card = document.querySelector('#charGrid .char-card');
    return { exists: true, open: open,
      firstChar: card ? card.getAttribute('data-char-id') : null,
      confirm: !!document.getElementById('btnCharConfirm') };
  })()`);
  if (charLayer.open && charLayer.firstChar) {
    await clickAt(`#charGrid .char-card[data-char-id="${charLayer.firstChar}"]`);
    await sleep(220);
    await clickAt('#btnCharConfirm');
    await sleep(1500);
  }
  const started = await ev(`(() => ({
    mode: state.mode, status: state.status, floor: state.floor,
    hp: Math.round(state.player.hp), hpMax: state.player.hpMax,
    level: state.player.level, rooms: state.rooms.length,
    character: state.meta ? state.meta.characterId : null
  }))()`);
  ok('C1 点开始 → 选角色 → 进入第 1 层（mode=playing / floor=1 / 满血 / 有房间）',
    started.mode === 'playing' && started.status === 'playing' && started.floor === 1
    && started.hp === started.hpMax && started.rooms >= 4, { charLayer, started });
  await shot('clear-01-floor1.png');

  const floors = [];
  const perFloor = async (f) => {
    // 1) 进首领房：传送到房心，等登场演出（introTimer 1.2s）
    const enter = await ev(`(() => {
      __ptDrain(40);
      const room = state.rooms.find((r) => r.type === 'boss');
      if (!room) return { fail: 'no-boss-room' };
      const tp = __roamDebug.teleport(room.cx, room.cy);
      __ptStep(90);
      const b = __roamDebug.bossState();
      return {
        room: room.id, tp: tp, currentRoomId: state.currentRoomId, cleared: !!room.cleared,
        mode: state.mode, status: state.status, floor: state.floor,
        level: state.player.level, playerHp: Math.round(state.player.hp), hpMax: state.player.hpMax,
        boss: b ? { hp: Math.round(b.enemy ? b.enemy.hp : (b.hp || 0)),
                    hpMax: Math.round(b.enemy ? b.enemy.hpMax : (b.hpMax || 0)),
                    introDone: b.introDone === undefined ? null : b.introDone,
                    kind: b.kind || (b.enemy && b.enemy.bossKind) || null } : null,
        foes: state.enemies.filter((e) => e.roomId === room.id).length,
        bossFlag: state.boss ? { roomId: state.boss.roomId, defeated: !!state.boss.defeated } : null
      };
    })()`);
    // 2) 击杀首领
    const kill = await ev(`(() => {
      const hit = __roamDebug.damageBoss(999999);
      __ptStep(150);
      const b = __roamDebug.bossState();
      return {
        mode: state.mode, status: state.status, floor: state.floor,
        defeated: !!(state.boss && state.boss.defeated),
        bossHp: b && b.enemy ? Math.round(b.enemy.hp) : null,
        stairsActive: !!(state.stairs && state.stairs.active),
        modal: __roamDebug.runInfo().modalKind,
        modalVisible: __roamDebug.runInfo().modalVisible,
        victoryTimer: __roamDebug.runInfo().victoryTimer
      };
    })()`);
    const row = { floor: f, enter, kill };
    console.log('FLOOR ' + f + ' ' + JSON.stringify({ enter: enter, kill: kill }));
    // 3) 开首领宝箱（P5 设计：死怪先落地实体宝箱，开箱才发奖/计时通关）
    row.chest = await ev(`(() => {
      __ptDrain(40);
      const c = state.bossChest;
      if (!c) return { exists: false };
      __roamDebug.teleport(c.x, c.y);
      __ptStep(24);
      const r = __roamDebug.bossChest.interact();
      __ptStep(90);
      __ptDrain(40);
      return { exists: true, result: r, info: __roamDebug.bossChest.info(),
               victoryTimer: Number((state.victoryTimer || 0).toFixed(2)) };
    })()`);
    if (f < 5) {
      row.descend = await ev(`(() => {
        __ptDrain(40);
        const from = state.floor;
        /* 开放层（F3 起可能出现）：楼梯只认钥匙，杀首领不解锁。
           真实玩法要去钥匙房逐间收；这里用官方测试口 collectAll() 走同一条
           grantOpenFloorKey 路径补齐，属于自动化特权（报告里标注）。 */
        const keys = (state.openFloor && state.openFloor.active && state.openFloor.stairsLocked)
          ? __roamDebug.openFloor.collectAll() : null;
        const tp = state.stairs ? __roamDebug.teleport(state.stairs.x, state.stairs.y) : false;
        __ptStep(30);
        const d = state.stairs ? Math.round(Math.hypot(state.player.x - state.stairs.x,
          state.player.y - state.stairs.y)) : -1;
        const gate = {
          from: from, tp: tp, dist: d, mode: state.mode, status: state.status,
          floorCleared: !!state.floorCleared,
          bossDefeated: !!(state.boss && state.boss.defeated),
          stairsActive: !!(state.stairs && state.stairs.active),
          openFloor: !!(state.openFloor && state.openFloor.active),
          keys: keys ? { needed: keys.state.keysNeeded, found: keys.state.keysFound,
                         locked: keys.state.stairsLocked } : null,
          toast: (document.querySelector('#toast, .toast') || {}).textContent || null
        };
        const moved = interactStairs();
        __ptStep(90);
        __ptDrain(40);
        return Object.assign(gate, { moved: moved, to: state.floor,
          level: state.player.level, crystals: state.crystalsEarned || 0 });
      })()`);
      ok('C' + (f + 1) + ' F' + f + ' 首领：登场 → 击杀 → 宝箱 → 真实下楼到 F' + (f + 1),
        !enter.fail && !!enter.boss && enter.boss.hp > 0
        && kill.defeated === true
        && row.descend.moved === true && row.descend.to === f + 1 && row.descend.mode === 'playing',
        { bossHp: enter.boss && enter.boss.hp, bossHpMax: enter.boss && enter.boss.hpMax,
          level: enter.level, foes: enter.foes, chest: row.chest && row.chest.info,
          descend: row.descend });
    } else {
      // 4) F5：等通关面板（victoryDelay 0.6s + 演出）
      row.result = await ev(`(async () => {
        const t0 = performance.now();
        while (state.mode !== 'result' && performance.now() - t0 < 8000) {
          __ptStep(10);
          await new Promise((r) => setTimeout(r, 60));
        }
        const modal = document.querySelector('.victory-modal');
        const sum = Array.from(document.querySelectorAll('.victory-modal .result-summary > div'))
          .map((d) => d.textContent.replace(/\\s+/g, ' ').trim());
        const stats = Array.from(document.querySelectorAll('.victory-modal .result-stat'))
          .map((d) => d.textContent.replace(/\\s+/g, ' ').trim());
        return {
          mode: state.mode, status: state.status, floor: state.floor,
          runCompleted: !!state.runCompleted, clears: state.meta.clears || 0,
          modalClass: modal ? modal.className : null,
          kicker: (document.querySelector('.victory-modal .modal-kicker') || {}).textContent || null,
          title: (document.querySelector('.victory-modal h2') || {}).textContent || null,
          summary: sum, stats: stats.slice(0, 10),
          kills: state.kills, crystalsEarned: state.crystalsEarned || 0,
          restartBtn: !!document.querySelector('.victory-modal [data-action="restart"]'),
          endlessBtn: !!document.querySelector('.victory-modal [data-action="endless"]'),
          runInfo: __roamDebug.runInfo()
        };
      })()`);
      ok('C6 F5 首领倒下 → 通关结算面板出现（victory-modal / RUN COMPLETE / 本局完成）',
        row.result.mode === 'result' && !!row.result.modalClass
        && String(row.result.modalClass).indexOf('victory-modal') >= 0
        && row.result.runCompleted === true
        && String(row.result.kicker || '').indexOf('RUN COMPLETE') >= 0
        && String(row.result.title || '').indexOf('本局完成') >= 0,
        { modalClass: row.result.modalClass, kicker: row.result.kicker,
          title: row.result.title, runInfo: row.result.runInfo });
      ok('C7 结算数字正常（到达楼层=5 / 击杀>0 且与运行态一致 / 核心三段非空）',
        row.result.floor === 5
        && String(row.result.summary.join(' ')).indexOf('到达楼层 5') >= 0
        && row.result.kills > 0
        && String(row.result.summary.join(' ')).indexOf('击杀 ' + row.result.kills) >= 0
        && row.result.summary.length === 3,
        { floor: row.result.floor, kills: row.result.kills,
          summary: row.result.summary, stats: row.result.stats,
          crystalsEarned: row.result.crystalsEarned });
      await shot('clear-05-victory.png');
    }
    floors.push(row);
    return row;
  };

  for (let f = 1; f <= 5; f += 1) {
    await perFloor(f);
    if (f === 1) await shot('clear-02-boss1.png');
  }

  // ---------- C9 重开按钮 ----------
  const btnProbe = await ev(`(() => {
    const b = document.querySelector('.victory-modal [data-action="restart"]');
    if (!b) return { btn: false };
    const r = b.getBoundingClientRect();
    const cx = Math.max(1, Math.min(innerWidth - 1, r.left + r.width / 2));
    const cy = Math.max(1, Math.min(innerHeight - 1, r.top + r.height / 2));
    const top = document.elementFromPoint(cx, cy);
    return { btn: true, cx: Math.round(cx), cy: Math.round(cy),
      hittable: !!top && (top === b || b.contains(top)),
      topAction: top && top.getAttribute ? top.getAttribute('data-action') : null };
  })()`);
  if (btnProbe.btn && !btnProbe.hittable) {
    await ev(`(() => { const m = document.querySelector('.victory-modal');
      if (m) m.scrollTop = m.scrollHeight - m.clientHeight; return true; })()`);
    await sleep(250);
  }
  const clicked = await clickAt('.victory-modal [data-action="restart"]');
  await sleep(1600);
  const restarted = await ev(`(() => ({
    mode: state.mode, status: state.status, floor: state.floor,
    hp: Math.round(state.player.hp), hpMax: state.player.hpMax,
    rooms: state.rooms.length, level: state.player.level,
    modalVisible: __roamDebug.runInfo().modalVisible
  }))()`);
  ok('C8 重开按钮可命中且真的回到第 1 层满血（不残局 / 面板已关）',
    btnProbe.btn === true && btnProbe.hittable === true && !!clicked
    && restarted.mode === 'playing' && restarted.floor === 1
    && restarted.hp === restarted.hpMax && restarted.rooms >= 4,
    { probe: btnProbe, restarted });
  await shot('clear-06-restart.png');

  // ---------- C10 零报错 ----------
  const pageErrs = await ev(`window.__p0Errors.slice()`);
  const allErrs = consoleErrors.concat(pageErrs || []);
  ok('C9 全程控制台零 JS 报错', allErrs.length === 0, { errors: allErrs });

  const passed = asserts.filter((a) => a.pass).length;
  const summary = {
    caption: '自动化通关验证，非真人',
    calibr: { playerHp: '每帧拉满', invuln: '9s（探针特权）', bossDamage: 'damageBoss(999999)' },
    total: asserts.length, passed, failed: asserts.length - passed,
    asserts, floors
  };
  fs.writeFileSync(path.join(OUT, 'p0-clear-path.json'), JSON.stringify(summary, null, 2));
  console.log(`\n===== P0-3 通关链路 ${passed}/${asserts.length}（自动化通关验证，非真人） =====`);
  ws.close();
  killEdge(edge);
  process.exit(passed === asserts.length ? 0 : 1);
}

main().catch((e) => { console.error('ERR', e && (e.stack || e.message)); process.exit(1); });
