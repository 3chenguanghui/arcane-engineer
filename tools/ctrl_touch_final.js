/**
 * 触屏回归（A1–A17）· 主文件最终整包回归（只读）
 * ------------------------------------------------------------
 * 被测文件：index_arcane_v2.html（主文件，只读，跑前跑后校验 MD5）
 * 端口：9558（同一时刻只开 1 个无头 Edge）
 * 输出：.screenshots/ctrl/final_touch_*.png、tools/_ctrl_touch_final.log、tools/ctrl_touch_final.json
 * 用法：node tools/ctrl_touch_final.js
 *
 * 说明：
 *  1. 触摸注入走 CDP Input.dispatchTouchEvent（不是页面内伪造 pointer 事件），
 *     只有 A5 的 pointercancel 是页面内合成事件（CDP 无对应指令）。
 *  2. 施法次数用页面内包装 window.castPrimary 计数，测完还原。
 *  3. 每条断言独立 try/catch，异常记 FAIL 后继续跑后面的。
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9558;
const ROOT = path.join(__dirname, '..');
const MAIN = path.join(ROOT, 'index_arcane_v2.html');
const OUT_DIR = path.join(ROOT, '.screenshots', 'ctrl');
const LOG_PATH = path.join(__dirname, '_ctrl_touch_final.log');
const RESULT_PATH = path.join(__dirname, 'ctrl_touch_final.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 日志同时落盘 + 控制台（UTF-8 文本，便于直接用编辑器看）
const logStream = fs.createWriteStream(LOG_PATH, { flags: 'w' });
/**
 * 统一日志输出
 * @param {string} msg 文本
 * @returns {void}
 */
function log(msg) {
  const line = typeof msg === 'string' ? msg : JSON.stringify(msg);
  logStream.write(line + '\n');
  console.log(line);
}

const asserts = [];
/**
 * 记录一条断言并打印证据
 * @param {string} id 编号（A1…）
 * @param {string} name 断言名
 * @param {boolean} pass 是否通过
 * @param {*} detail 证据
 * @returns {void}
 */
function ok(id, name, pass, detail) {
  const item = { id, name, pass: !!pass, detail: detail === undefined ? null : detail };
  asserts.push(item);
  log((pass ? 'PASS' : 'FAIL') + ' · ' + id + ' ' + name + ' · ' + JSON.stringify(item.detail));
}

/**
 * 计算文件 MD5（十六进制大写，与 Get-FileHash 对齐）
 * @param {string} file 文件路径
 * @returns {string} MD5
 */
function md5Of(file) {
  return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

/**
 * 主流程
 * @returns {Promise<void>}
 */
async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const md5Before = md5Of(MAIN);
  log('主文件 MD5（前）：' + md5Before + '  size=' + fs.statSync(MAIN).size);

  const profile = prepareProfile();
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=390,844', 'about:blank'
  ], { stdio: 'ignore' });

  let ws = null;
  try {
    // ---------- 连接 CDP ----------
    let target = null;
    for (let i = 0; i < 90; i += 1) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
        target = list.find((t) => t.type === 'page');
        if (target) break;
      } catch (e) { /* Edge 还没起来 */ }
      await sleep(250);
    }
    if (!target) throw new Error('Edge 未就绪（端口 ' + PORT + '）');

    ws = new WebSocket(target.webSocketDebuggerUrl);
    let seq = 0;
    const pending = new Map();
    ws.onmessage = (msg) => {
      const m = JSON.parse(msg.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    };
    await new Promise((r) => { ws.onopen = r; });

    /**
     * 发送 CDP 命令并等待返回
     * @param {string} method CDP 方法
     * @param {Object} [params] 参数
     * @returns {Promise<Object>} 结果
     */
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      seq += 1;
      pending.set(seq, (m) => (m.error ? reject(new Error(method + ': ' + JSON.stringify(m.error))) : resolve(m.result)));
      ws.send(JSON.stringify({ id: seq, method, params }));
    });

    /**
     * 页面内执行表达式（按值返回）
     * @param {string} expression JS 表达式
     * @returns {Promise<*>} 返回值
     */
    const ev = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
      return r.result.value;
    };

    /**
     * 轮询等待页面条件成立
     * @param {string} expr 布尔表达式
     * @param {number} [timeout=12000] 超时毫秒
     * @returns {Promise<boolean>} 是否成立
     */
    const waitFor = async (expr, timeout = 12000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) {
        try { if (await ev(expr) === true) return true; } catch (e) { /* 页面还没加载完 */ }
        await sleep(200);
      }
      return false;
    };

    /**
     * 截图到 .screenshots/ctrl/
     * @param {string} name 文件名
     * @returns {Promise<number>} 文件字节数
     */
    const shot = async (name) => {
      const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const file = path.join(OUT_DIR, name);
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
      const size = fs.statSync(file).size;
      log('截图 ' + name + ' · ' + size + 'B');
      return size;
    };

    // ---------- 页面初始化 ----------
    await send('Runtime.enable');
    await send('Page.enable');

    // 导航前装错误收集器（另存一份镜像，避免被游戏 init 里的 __errors=[] 冲掉）
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(function(){
        window.__errMirror = [];
        function pushMsg(m){
          var s = String(m);
          window.__errMirror.push(s);
          try { if (!window.__errors) window.__errors = []; window.__errors.push(s); } catch (e) {}
        }
        window.addEventListener('error', function(e){
          pushMsg((e && e.message ? e.message : String(e)) + ' @' + (e && e.filename ? e.filename : '') + ':' + (e && e.lineno ? e.lineno : 0));
        });
        window.addEventListener('unhandledrejection', function(e){
          var r = e && e.reason;
          pushMsg('rejection: ' + (r && r.message ? r.message : String(r)));
        });
      })();`
    });

    // 移动端视口（竖屏 390×844，DPR=2），再开触摸仿真
    await send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
      screenWidth: 390, screenHeight: 844
    });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

    const url = 'file:///' + MAIN.replace(/\\/g, '/');
    await send('Page.navigate', { url: encodeURI(url) });
    await sleep(1000);
    if (!(await waitFor(`!!(window.__roamDebug && window.__roamDebug.touch)`, 20000))) {
      throw new Error('页面未加载出 __roamDebug.touch');
    }
    await sleep(600);

    // ---------- 开局 ----------
    await ev(`(function(){ var b = document.querySelector('#btnStart'); if (b) b.click(); return !!b; })()`);
    await sleep(900);
    // 主文件新增“三角色选择”页：标题页点开始后会先弹选择页，按真实用户路径点 #btnCharConfirm 进入 playing，
    // 否则会停在 title，导致 A2/A4 等依赖 state.player 位移的断言假失败。
    const charSel = await ev(`(function(){
      var l = document.getElementById('charLayer');
      var open = !!(l && !l.classList.contains('hidden'));
      if (state.mode !== 'playing' && open) {
        var b = document.getElementById('btnCharConfirm');
        if (b) b.click();
        return { charSelectOpen: true, clicked: !!b };
      }
      return { charSelectOpen: false, clicked: false };
    })()`);
    await sleep(1000);
    log('角色选择页：' + JSON.stringify(charSel));
    await ev(`(function(){
      if (typeof skipOpeningRitual === 'function') skipOpeningRitual();
      state.transitionLock = false;
      state.player.vx = 0; state.player.vy = 0;
      window.__roamDebug.clearEnemies();
      return true;
    })()`);
    await sleep(300);
    const boot = await ev(`(function(){
      if (state.mode !== 'playing') { state.mode = 'playing'; state.status = 'playing'; }
      return { mode: state.mode, status: state.status, viewW: state.viewW, innerW: window.innerWidth };
    })()`);
    log('开局状态：' + JSON.stringify(boot));

    // ---------- 施法计数包装 ----------
    const castWrap = await ev(`(function(){
      window.__castCalls = 0;
      window.__realCastPrimary = window.castPrimary;
      if (typeof window.castPrimary === 'function') {
        window.castPrimary = function(){
          window.__castCalls += 1;
          return window.__realCastPrimary.apply(null, arguments);
        };
      }
      return { hasGlobal: typeof window.__realCastPrimary === 'function' };
    })()`);
    log('castPrimary 全局可包装：' + JSON.stringify(castWrap));

    // pointerdown 探针：记录浏览器实际分配的 pointerId（触摸 id 由 Blink 映射）
    await ev(`(function(){
      window.__ptrLog = [];
      document.querySelector('#game').addEventListener('pointerdown', function(e){
        window.__ptrLog.push({ id: e.pointerId, type: e.pointerType, x: Math.round(e.clientX), y: Math.round(e.clientY) });
      });
      return true;
    })()`);

    // ---------- 触摸注入小工具 ----------
    /**
     * 构造一个 CDP 触点
     * @param {{x:number,y:number,id:number}} p 点
     * @returns {Object} 触点
     */
    const tp = (p) => ({ x: Math.round(p.x), y: Math.round(p.y), id: p.id, radiusX: 8, radiusY: 8, force: 1 });

    /**
     * touchStart
     * @param {Array<{x:number,y:number,id:number}>} points 当前按下的全部触点
     * @returns {Promise<void>}
     */
    const tStart = (points) => send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points.map(tp) });
    /**
     * touchMove
     * @param {Array<{x:number,y:number,id:number}>} points 当前按下的全部触点
     * @returns {Promise<void>}
     */
    const tMove = (points) => send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points.map(tp) });
    /**
     * touchEnd（清空所有触点）
     * @returns {Promise<void>}
     */
    const tEnd = () => send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

    /**
     * 不等待回包的 touchStart（用于 60ms 高密度连点：await 往返会把间隔撑到 100ms 以上）
     * @param {Array<{x:number,y:number,id:number}>} points 触点
     * @returns {void}
     */
    const tStartNoWait = (points) => {
      seq += 1;
      ws.send(JSON.stringify({
        id: seq, method: 'Input.dispatchTouchEvent',
        params: { type: 'touchStart', touchPoints: points.map(tp) }
      }));
    };

    /**
     * 不等待回包的 touchEnd
     * @returns {void}
     */
    const tEndNoWait = () => {
      seq += 1;
      ws.send(JSON.stringify({
        id: seq, method: 'Input.dispatchTouchEvent',
        params: { type: 'touchEnd', touchPoints: [] }
      }));
    };

    /**
     * 读取触屏状态
     * @returns {Promise<Object>} info()
     */
    const touchInfo = () => ev('window.__roamDebug.touch.info()');

    /**
     * 清空触摸状态（防御性，避免上一条断言的残留影响下一条）
     * @returns {Promise<void>}
     */
    const resetTouch = async () => {
      try { await tEnd(); } catch (e) { /* ignore */ }
      try { await ev('window.__roamDebug.touch.reset(); true'); } catch (e) { /* ignore */ }
      await sleep(130);
    };

    /**
     * 把角色放回当前房间中心，避免贴墙影响位移测量
     * @returns {Promise<Object>} 坐标
     */
    const placePlayer = () => ev(`(function(){
      var r = (state.rooms && state.rooms[state.currentRoomId]) || (state.rooms && state.rooms[0]);
      if (r) { state.player.x = r.cx; state.player.y = r.cy; }
      state.player.vx = 0; state.player.vy = 0;
      return { x: state.player.x, y: state.player.y };
    })()`);

    /**
     * 单点快速点按（触摸真实注入）
     * @param {number} x 视口 x
     * @param {number} y 视口 y
     * @param {number} tid 触点 id
     * @param {number} [hold=40] 按住毫秒
     * @returns {Promise<void>}
     */
    const tap = async (x, y, tid, hold = 40) => {
      await tStart([{ x, y, id: tid }]);
      await sleep(hold);
      await tEnd();
    };

    /**
     * 读取元素 rect（视口坐标）
     * @param {string} sel CSS 选择器
     * @returns {Promise<Object|null>} {x,y,w,h,cx,cy,visible}
     */
    const rectOf = (sel) => ev(`(function(){
      var el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return null;
      var r = el.getBoundingClientRect();
      var cs = getComputedStyle(el);
      return {
        x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
        cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2),
        visible: r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden'
      };
    })()`);

    /**
     * 单条断言的执行壳：异常一律记 FAIL，不中断后续
     * @param {string} id 编号
     * @param {string} name 断言名
     * @param {Function} fn 返回 {pass,detail} 的异步函数
     * @returns {Promise<void>}
     */
    const runCase = async (id, name, fn) => {
      try {
        const r = await fn();
        ok(id, name, r.pass, r.detail);
      } catch (e) {
        ok(id, name, false, '异常：' + (e && e.message ? e.message : String(e)));
      }
    };

    const VIEW = { w: 390, h: 844 };
    const SPLIT_PORTRAIT = VIEW.w * 0.5; // 195

    // ============================================================
    // A1 左半屏按下
    // ============================================================
    await runCase('A1', '左半屏按下：active=true、moveId=注入触点对应 pointerId、axis=0、摇杆 drawn（downs+1）', async () => {
      await resetTouch();
      await placePlayer();
      const downs0 = (await touchInfo()).stats.downs;
      await ev('window.__ptrLog = []; true');
      await tStart([{ x: 60, y: 560, id: 11 }]);
      await sleep(80);
      const info = await touchInfo();
      const ptr = await ev('window.__ptrLog.slice()');
      const injected = 11;
      const browserId = ptr.length ? ptr[ptr.length - 1].id : null;
      const drawn = info.moveId !== null && info.active === true; // drawTouchControls 的绘制前置条件
      const pass = info.active === true && info.moveId !== null && info.moveId === browserId
        && info.axis.x === 0 && info.axis.y === 0 && info.stats.downs === downs0 + 1 && drawn;
      return {
        pass,
        detail: {
          active: info.active, moveId: info.moveId, injectedId: injected, browserPointerId: browserId,
          axis: info.axis, downsBefore: downs0, downsAfter: info.stats.downs,
          note: 'moveId 与浏览器分配的 pointerId 一致（Blink 可能把触点 id 重编号）'
        }
      };
    });
    await resetTouch();

    // ============================================================
    // A2 左半屏拖动 60px
    // ============================================================
    await runCase('A2', '左半屏拖动 60px：moves 增长、axis.x>0.2、600ms 内角色位移 >20px', async () => {
      await placePlayer();
      await sleep(150);
      const p0 = await ev('({ x: state.player.x, y: state.player.y })');
      const moves0 = (await touchInfo()).stats.moves;
      await tStart([{ x: 60, y: 560, id: 12 }]);
      await sleep(60);
      await tMove([{ x: 120, y: 560, id: 12 }]);
      await sleep(120);
      const mid = await ev(`(function(){
        return {
          axis: { x: state.touch.axisX, y: state.touch.axisY },
          moves: window.__roamDebug.touch.info().stats.moves,
          speed: Math.hypot(state.player.vx, state.player.vy)
        };
      })()`);
      await sleep(600);
      const p1 = await ev('({ x: state.player.x, y: state.player.y })');
      const dx = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      const pass = mid.moves > moves0 && mid.axis.x > 0.2 && dx > 20;
      return {
        pass,
        detail: {
          movesBefore: moves0, movesAfter: mid.moves,
          axis: { x: Number(mid.axis.x.toFixed(3)), y: Number(mid.axis.y.toFixed(3)) },
          speed: Number(mid.speed.toFixed(1)), displacement: Number(dx.toFixed(1)),
          from: { x: Number(p0.x.toFixed(1)), y: Number(p0.y.toFixed(1)) },
          to: { x: Number(p1.x.toFixed(1)), y: Number(p1.y.toFixed(1)) }
        }
      };
    });
    await resetTouch();

    // ============================================================
    // A3 满推
    // ============================================================
    let shotPortraitSize = 0;
    await runCase('A3', '满推（推程 >maxRadius）：axis 绝对值=1.000（容差 0.03）、fullPush=0.86 生效', async () => {
      await placePlayer();
      const cfg = (await touchInfo()).config;
      await tStart([{ x: 60, y: 560, id: 13 }]);
      await sleep(60);
      await tMove([{ x: 160, y: 560, id: 13 }]); // 距离 100 > maxRadius 72
      await sleep(140);
      const axis = (await touchInfo()).axis;
      shotPortraitSize = await shot('final_touch_joystick_portrait.png'); // 摇杆按下态截图
      const pass = Math.abs(Math.abs(axis.x) - 1) <= 0.03 && Math.abs(axis.y) <= 0.03
        && cfg.fullPush === 0.86 && cfg.maxRadius === 72;
      return {
        pass,
        detail: {
          axis, absAxis: { x: Number(Math.abs(axis.x).toFixed(3)), y: Number(Math.abs(axis.y).toFixed(3)) },
          fullPush: cfg.fullPush, maxRadius: cfg.maxRadius, stickRadius: cfg.stickRadius,
          shotBytes: shotPortraitSize
        }
      };
    });
    await resetTouch();

    // ============================================================
    // A4 抬指
    // ============================================================
    await runCase('A4', '抬指：axis 归零、active=false、600ms 后角色位移 <20px（附摩擦减速证据）', async () => {
      await placePlayer();
      await tStart([{ x: 60, y: 560, id: 14 }]);
      await sleep(60);
      await tMove([{ x: 120, y: 560, id: 14 }]);
      await sleep(400);
      const preEnd = await ev('({ x: state.player.x, y: state.player.y, vx: state.player.vx, vy: state.player.vy })');
      await tEnd();
      await sleep(120);
      const rel = await touchInfo();
      await sleep(600);
      const post = await ev('({ x: state.player.x, y: state.player.y, vx: state.player.vx, vy: state.player.vy })');
      await sleep(900);
      const later = await ev('({ x: state.player.x, y: state.player.y, vx: state.player.vx, vy: state.player.vy })');
      const drift = Math.hypot(post.x - preEnd.x, post.y - preEnd.y);
      const driftLater = Math.hypot(later.x - post.x, later.y - post.y);
      const friction = await ev('(typeof GAME_CONFIG !== "undefined" ? GAME_CONFIG.playerFriction : null)');
      const pass = rel.active === false && rel.axis.x === 0 && rel.axis.y === 0 && drift < 20;
      return {
        pass,
        detail: {
          active: rel.active, axis: rel.axis, moveId: rel.moveId,
          vxAtRelease: Number(preEnd.vx.toFixed(1)),
          vxAfter600ms: Number(post.vx.toFixed(1)),
          vxAfter1500ms: Number(later.vx.toFixed(1)),
          driftAfterRelease600ms: Number(drift.toFixed(1)),
          driftBetween600and1500ms: Number(driftLater.toFixed(1)),
          playerFriction: friction, driftThreshold: 20,
          note: drift >= 20 ? '抬指后仍按 playerFriction 指数衰减滑行（惯性刹车），不是输入残留（axis 已归零）' : null
        }
      };
    });
    await resetTouch();

    // ============================================================
    // A5 合成 pointercancel
    // ============================================================
    await runCase('A5', '合成 pointercancel：axis 归零、active=false（合成事件，CDP 无法直接派发）', async () => {
      await placePlayer();
      await tStart([{ x: 60, y: 560, id: 15 }]);
      await sleep(60);
      await tMove([{ x: 120, y: 560, id: 15 }]);
      await sleep(150);
      const before = await touchInfo();
      const pid = before.moveId;
      // #game 就是 canvas 本身，pointercancel 监听挂在 canvas 上，bubbles 让它到达监听器
      await ev(`(function(){
        var el = document.querySelector('#game');
        var e = new PointerEvent('pointercancel', {
          pointerId: ${Number.isFinite(Number(pid)) ? Number(pid) : 2},
          pointerType: 'touch', bubbles: true, cancelable: true
        });
        el.dispatchEvent(e);
        return { pointerId: e.pointerId, fired: true };
      })()`);
      await sleep(150);
      const after = await touchInfo();
      const pass = after.axis.x === 0 && after.axis.y === 0 && after.active === false;
      return {
        pass,
        detail: {
          beforeAxis: before.axis, pointerIdUsed: pid, afterAxis: after.axis, afterActive: after.active,
          synthetic: true,
          note: 'pointercancel 由页面内 new PointerEvent 合成（CDP 无对应指令）'
        }
      };
    });
    await resetTouch();

    // ============================================================
    // A6 右半屏点按
    // ============================================================
    await runCase('A6', '右半屏点按一次：__castCalls≥1，按下时 aiming=true，抬指后 aiming=false', async () => {
      await ev('window.__castCalls = 0; true');
      const info0 = await touchInfo();
      await tStart([{ x: 300, y: 300, id: 16 }]);
      await sleep(80);
      const down = await touchInfo();
      const callsDown = await ev('window.__castCalls');
      await tEnd();
      await sleep(150);
      const up = await touchInfo();
      const castsDelta = down.stats.casts - info0.stats.casts;
      const pass = callsDown >= 1 && down.aiming === true && up.aiming === false;
      return {
        pass,
        detail: {
          castCallsWhileDown: callsDown, aimingWhileDown: down.aiming, aimingAfterUp: up.aiming,
          statsCastsDelta: castsDelta, aim: down.aim, aimDragging: down.aimDragging
        }
      };
    });
    await resetTouch();

    // ============================================================
    // A7 连点 5 次（60ms 间隔）
    // ============================================================
    await runCase('A7', '连点 5 次间隔 60ms：统计实际施法次数（castRepeat=0.10s，预期 ≤3），判定节流是否生效', async () => {
      await resetTouch();
      await sleep(300); // 越过上一条的施法节流窗口
      await ev('window.__castCalls = 0; true');
      const stats0 = (await touchInfo()).stats.casts;
      await ev(`(function(){
        window.__tapTrace = [];
        window.__tapProbe = function(e){
          if (e.pointerType !== 'touch') return;
          window.__tapTrace.push({
            wall: Math.round(performance.now()),
            elapsed: Number((state.elapsed || 0).toFixed(4)),
            lastCastAt: Number((state.touch.lastCastAt || 0).toFixed(4)),
            calls: window.__castCalls
          });
        };
        document.querySelector('#game').addEventListener('pointerdown', window.__tapProbe);
        return true;
      })()`);
      const wall0 = Date.now();
      for (let i = 0; i < 5; i += 1) {
        tStartNoWait([{ x: 300, y: 250, id: 30 + i }]);
        await sleep(25);
        tEndNoWait();
        if (i < 4) await sleep(35); // 两次按下间隔约 60ms（不 await 回包，避免把间隔撑大）
      }
      await sleep(200);
      const trace = await ev('window.__tapTrace.slice()');
      const callsTotal = await ev('window.__castCalls');
      const info = await touchInfo();
      const statsDelta = info.stats.casts - stats0;
      await ev(`(function(){
        document.querySelector('#game').removeEventListener('pointerdown', window.__tapProbe);
        return true;
      })()`);
      const gaps = [];
      for (let i = 1; i < trace.length; i += 1) {
        gaps.push({
          wallMs: trace[i].wall - trace[i - 1].wall,
          gameMs: Math.round((trace[i].elapsed - trace[i - 1].elapsed) * 1000)
        });
      }
      const pass = callsTotal < 5;
      return {
        pass,
        detail: {
          taps: 5, targetIntervalMs: 60, totalWallMs: Date.now() - wall0,
          castRepeat: info.config.castRepeat,
          castCalls: callsTotal, castPerTap: trace.map((t) => t.calls), statsCasts: statsDelta,
          gaps, throttleEffective: callsTotal < 5,
          note: callsTotal >= 5 ? '5 次点按全部施法：节流未生效（或实际间隔超过 100ms）' : null
        }
      };
    });
    await resetTouch();

    // ============================================================
    // A8 长按 1.2s 不移动（重点：源码注释写“按住可连发”）
    // ============================================================
    await runCase('A8', '长按右半屏 1.2s 不移动：期望 ≥2 次施法（源码注释“按住可连发”），实测 1 次即 FAIL', async () => {
      await resetTouch();
      await sleep(300);
      await ev('window.__castCalls = 0; true');
      const stats0 = (await touchInfo()).stats.casts;
      await tStart([{ x: 320, y: 320, id: 40 }]);
      await sleep(1200);
      const callsHold = await ev('window.__castCalls');
      const info = await touchInfo();
      await tEnd();
      await sleep(120);
      const pass = callsHold >= 2;
      return {
        pass,
        detail: {
          holdMs: 1200, castCalls: callsHold, statsCastsDelta: info.stats.casts - stats0,
          aiming: info.aiming, castRepeat: info.config.castRepeat,
          verdict: callsHold < 2 ? '按住不动不再连发' : '长按期间有重复施法'
        }
      };
    });
    await resetTouch();

    // ============================================================
    // A9 双指同时
    // ============================================================
    await runCase('A9', '双指同时：左手摇杆 + 右手点按，axis>0.5 且 __castCalls 同时增长', async () => {
      await resetTouch();
      await placePlayer();
      await ev('window.__castCalls = 0; true');
      await tStart([{ x: 60, y: 560, id: 51 }, { x: 320, y: 280, id: 52 }]);
      await sleep(100);
      const calls0 = await ev('window.__castCalls');
      await tMove([{ x: 140, y: 560, id: 51 }, { x: 320, y: 280, id: 52 }]);
      await sleep(160);
      const info = await touchInfo();
      const calls1 = await ev('window.__castCalls');
      const pass = info.axis.x > 0.5 && calls0 >= 1 && calls1 >= calls0;
      return {
        pass,
        detail: {
          moveId: info.moveId, aimId: info.aimId, active: info.active, aiming: info.aiming,
          axis: info.axis, castCallsOnSecondFingerDown: calls0, castCallsAfterMove: calls1,
          bothHandled: info.moveId !== null && info.aimId !== null
        }
      };
    });
    await resetTouch();

    // ============================================================
    // A10 混合设备干扰（鼠标 pointermove）
    // ============================================================
    await runCase('A10', '混合设备干扰：摇杆按住时注入 pointerType=mouse 的 pointermove，axis 不被改写、moveId 不被抢占', async () => {
      await resetTouch();
      await placePlayer();
      await tStart([{ x: 60, y: 560, id: 61 }]);
      await sleep(60);
      await tMove([{ x: 110, y: 560, id: 61 }]);
      await sleep(150);
      const before = await touchInfo();
      // 按验收口径：在 document 上派发鼠标 pointermove
      await ev(`(function(){
        var e = new PointerEvent('pointermove', {
          pointerId: 1, pointerType: 'mouse', clientX: 200, clientY: 300,
          bubbles: true, cancelable: true
        });
        document.dispatchEvent(e);
        return true;
      })()`);
      await sleep(120);
      const afterDoc = await touchInfo();
      const axisKept = afterDoc.axis.x === before.axis.x && afterDoc.axis.y === before.axis.y;
      const idKept = afterDoc.moveId === before.moveId;
      // 附加事实探针：canvas 上的监听只比 pointerId、不校验 pointerType，
      // 用同一个 id 的鼠标事件直接派发到 #game 会改写 axis（记录事实，不计入本条判定）
      let canvasProbe = null;
      try {
        canvasProbe = await ev(`(function(){
          var el = document.querySelector('#game');
          var beforeAxis = { x: state.touch.axisX, y: state.touch.axisY };
          var e = new PointerEvent('pointermove', {
            pointerId: ${Number.isFinite(Number(before.moveId)) ? Number(before.moveId) : 2},
            pointerType: 'mouse', clientX: 130, clientY: 560,
            bubbles: true, cancelable: true
          });
          el.dispatchEvent(e);
          return { beforeAxis: beforeAxis, afterAxis: { x: state.touch.axisX, y: state.touch.axisY } };
        })()`);
      } catch (e) { canvasProbe = { error: String(e && e.message ? e.message : e) }; }
      await tEnd();
      const pass = axisKept && idKept;
      return {
        pass,
        detail: {
          beforeAxis: before.axis, afterDocAxis: afterDoc.axis, moveIdBefore: before.moveId,
          moveIdAfter: afterDoc.moveId, docDispatchIgnored: axisKept && idKept,
          factCanvasSameIdMouse: canvasProbe
        }
      };
    });
    await resetTouch();

    // ============================================================
    // A11 旋转（390×844 → 844×390 → 390×844）
    // ============================================================
    await runCase('A11', '旋转：844×390 时 x=430 判为右半屏施法、不生成摇杆；转回竖屏 x=200 应生成摇杆；记录 viewW/innerWidth/canvas.width', async () => {
      await resetTouch();
      await send('Emulation.setDeviceMetricsOverride', {
        width: 844, height: 390, deviceScaleFactor: 2, mobile: true,
        screenWidth: 844, screenHeight: 390
      });
      await sleep(500);
      const land0 = await ev(`(function(){
        return {
          viewW: state.viewW, viewH: state.viewH, innerW: window.innerWidth, innerH: window.innerHeight,
          canvasW: document.querySelector('#game').width, canvasH: document.querySelector('#game').height,
          dpr: window.devicePixelRatio, split: (state.viewW || window.innerWidth) * 0.5
        };
      })()`);
      await shot('final_touch_landscape.png'); // 横屏布局截图

      await ev('window.__castCalls = 0; true');
      await tStart([{ x: 430, y: 200, id: 71 }]);
      await sleep(90);
      const landInfo = await touchInfo();
      const landCalls = await ev('window.__castCalls');
      await tEnd();
      await sleep(120);
      const landOk = landInfo.aiming === true && landInfo.moveId === null && landCalls >= 1;

      // 转回竖屏
      await send('Emulation.setDeviceMetricsOverride', {
        width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
        screenWidth: 390, screenHeight: 844
      });
      await sleep(600);
      const port = await ev(`(function(){
        return {
          viewW: state.viewW, innerW: window.innerWidth,
          canvasW: document.querySelector('#game').width, dpr: window.devicePixelRatio,
          split: (state.viewW || window.innerWidth) * 0.5
        };
      })()`);

      await tStart([{ x: 200, y: 300, id: 72 }]);
      await sleep(90);
      const at200 = await touchInfo();
      await tEnd();
      await sleep(120);

      await tStart([{ x: 190, y: 300, id: 73 }]);
      await sleep(90);
      const at190 = await touchInfo();
      await tEnd();
      await sleep(120);

      const pass = landOk && at200.moveId !== null && at200.active === true;
      const portraitRelation = {
        viewW: port.viewW, innerWidth: port.innerW, canvasWidth: port.canvasW, dpr: port.dpr,
        canvasCssTimesDpr: port.canvasW / port.innerW
      };
      return {
        pass,
        detail: {
          landscape: {
            viewW: land0.viewW, innerWidth: land0.innerW, canvasWidth: land0.canvasW,
            canvasHeight: land0.canvasH, dpr: land0.dpr, splitX: land0.split,
            at430: { aiming: landInfo.aiming, moveId: landInfo.moveId, active: landInfo.active, castCalls: landCalls }
          },
          portrait: {
            viewW: port.viewW, innerWidth: port.innerW, canvasWidth: port.canvasW,
            splitX: port.split, at200: { aiming: at200.aiming, moveId: at200.moveId, active: at200.active },
            controlAt190: { aiming: at190.aiming, moveId: at190.moveId, active: at190.active }
          },
          portraitRelation,
          note: '竖屏 x=200 超过 splitX=195，按代码属右半屏；x=190 作为对照可生成摇杆'
        }
      };
    });
    await resetTouch();

    // ============================================================
    // A12 安全区
    // ============================================================
    await runCase('A12', '安全区：统计 CSS 中 env(safe-area-inset-*) 的 top/left/right/bottom 次数', async () => {
      const r = await ev(`(function(){
        var txt = '', sheets = 0, rules = 0, failed = 0;
        for (var i = 0; i < document.styleSheets.length; i += 1) {
          var sh = document.styleSheets[i]; sheets += 1;
          try {
            var rs = sh.cssRules; if (!rs) continue;
            rules += rs.length;
            for (var j = 0; j < rs.length; j += 1) txt += rs[j].cssText + '\\n';
          } catch (e) { failed += 1; }
        }
        var nodes = document.querySelectorAll('[style]');
        for (var k = 0; k < nodes.length; k += 1) txt += (nodes[k].getAttribute('style') || '') + ';';
        function cnt(s) { return txt.split(s).length - 1; }
        return {
          top: cnt('safe-area-inset-top'), left: cnt('safe-area-inset-left'),
          right: cnt('safe-area-inset-right'), bottom: cnt('safe-area-inset-bottom'),
          stylesheets: sheets, rules: rules, failedSheets: failed, cssTextLen: txt.length,
          viewportFitCover: cnt('viewport-fit=cover'),
          metaViewport: (document.querySelector('meta[name=viewport]') || {}).content || null
        };
      })()`);
      const pass = r.top > 0 && r.left > 0 && r.right > 0;
      return {
        pass,
        detail: Object.assign({}, r, {
          verdict: pass ? '四向均有避让' : '横屏刘海/圆角区域无避让',
          missing: ['top', 'left', 'right'].filter((k) => r[k] === 0)
        })
      };
    });

    // ============================================================
    // A13 触屏点击顶部按钮（帮助）
    // ============================================================
    await runCase('A13', '触屏点击 #btnRules：mode→rules；再点 #rulesClose→playing；按钮边长须 ≥44px', async () => {
      await resetTouch();
      await ev(`(function(){
        if (state.mode !== 'playing') { state.mode = 'playing'; state.status = 'playing'; }
        document.querySelector('#game').style.removeProperty('');
        return true;
      })()`);
      const btn = await rectOf('#btnRules');
      if (!btn) return { pass: false, detail: { error: '找不到 #btnRules' } };
      await tap(btn.cx, btn.cy, 81, 50);
      await sleep(300);
      const modeAfterOpen = await ev('state.mode');
      const openClass = await ev(`(function(){
        var p = document.querySelector('#rulesPanel');
        return p ? p.classList.contains('is-open') : null;
      })()`);
      let shotRulesSize = 0;
      if (modeAfterOpen === 'rules') shotRulesSize = await shot('final_touch_panel_rules.png'); // 触屏打开的帮助面板
      const closeBtn = await rectOf('#rulesClose');
      let closeTap = null;
      if (modeAfterOpen === 'rules' && closeBtn) {
        await tap(closeBtn.cx, closeBtn.cy, 82, 50);
        await sleep(300);
        closeTap = 'tapped';
      }
      const modeAfterClose = await ev('state.mode');
      const sizeOk = btn.w >= 44 && btn.h >= 44;
      const pass = modeAfterOpen === 'rules' && openClass === true
        && modeAfterClose === 'playing' && sizeOk;
      return {
        pass,
        detail: {
          btnRules: btn, touchTargetOk: sizeOk, minSize: 44,
          modeAfterOpen, rulesPanelOpen: openClass, shotRulesBytes: shotRulesSize,
          rulesClose: closeBtn, closeTap, modeAfterClose,
          note: sizeOk ? '命中区域达标' : '实测按钮仅 ' + btn.w + '×' + btn.h + 'px，低于 44px'
        }
      };
    });
    await resetTouch();

    // ============================================================
    // A14 触屏打开设置
    // ============================================================
    await runCase('A14', '触屏打开设置：找到文本含“设置”的顶部按钮（打印 id/rect），触摸点按→面板打开→关闭', async () => {
      await resetTouch();
      const found = await ev(`(function(){
        var list = [];
        document.querySelectorAll('.hud-actions button, header button').forEach(function(b){
          var t = (b.textContent || '').replace(/\\s+/g, '');
          if (t.indexOf('设置') >= 0) {
            var r = b.getBoundingClientRect();
            list.push({
              id: b.id || null, cls: String(b.className || ''), text: t,
              rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
              cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2),
              inViewport: r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight,
              innerW: window.innerWidth, innerH: window.innerHeight
            });
          }
        });
        return list;
      })()`);
      if (!found || !found.length) {
        return { pass: false, detail: { error: '找不到文本含“设置”的顶部按钮', innerW: 390 } };
      }
      const btn = found[0];
      const modeBefore = await ev('state.mode');
      if (btn.inViewport) {
        await tap(btn.cx, btn.cy, 91, 50);
      }
      await sleep(320);
      const modeAfter = await ev('state.mode');
      let closed = null;
      if (modeAfter === 'settings') {
        const closeBtn = await rectOf('#settingsClose');
        if (closeBtn) { await tap(closeBtn.cx, closeBtn.cy, 92, 50); await sleep(320); }
        closed = await ev('state.mode');
      }
      const pass = modeBefore === 'playing' && modeAfter === 'settings' && closed === 'playing';
      return {
        pass,
        detail: {
          button: btn, tapped: btn.inViewport, modeBefore, modeAfterOpen: modeAfter, modeAfterClose: closed,
          note: btn.inViewport ? null : '按钮 rect 超出 ' + btn.innerW + 'px 视口，触摸无法命中'
        }
      };
    });
    if (await ev('state.mode') === 'settings') {
      await ev(`(function(){ if (typeof closePanel === 'function') closePanel('settings'); return state.mode; })()`);
      await sleep(150);
    }
    await resetTouch();
    let shotPanelSize = 0;

    // ============================================================
    // A15 运行时文案扫描（键盘依赖）
    // ============================================================
    await runCase('A15', '运行时文案扫描：<kbd> + WASD/左键/右键/滚轮/Shift/Tab/Enter/Esc/空格/“按 单字母” + canvas 绘制提示，输出清单与总数', async () => {
      // 1) 重开设置面板（留一张面板截图，同时验证触屏入口后仍可打开）
      try {
        const setBtn = await ev(`(function(){
          var el = document.getElementById('btnSettings');
          if (!el) return null;
          var r = el.getBoundingClientRect();
          return { cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2),
            inViewport: r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight };
        })()`);
        if (setBtn && setBtn.inViewport) {
          await tap(setBtn.cx, setBtn.cy, 95, 50);
          await sleep(300);
          shotPanelSize = await shot('final_touch_panel_settings.png');
          const cb = await rectOf('#settingsClose');
          if (cb) { await tap(cb.cx, cb.cy, 96, 50); await sleep(260); }
        }
      } catch (e) { /* 截图失败不影响扫描 */ }

      // 2) canvas fillText 抓取（500ms 内真实绘制出来的文字）
      await ev(`(function(){
        window.__drawnTexts = [];
        window.__origFillText = CanvasRenderingContext2D.prototype.fillText;
        CanvasRenderingContext2D.prototype.fillText = function(t){
          try { if (typeof t === 'string') window.__drawnTexts.push(t); } catch (e) {}
          return window.__origFillText.apply(this, arguments);
        };
        return true;
      })()`);
      await sleep(500);
      const drawn = await ev(`(function(){
        CanvasRenderingContext2D.prototype.fillText = window.__origFillText;
        var arr = [];
        var seen = {};
        window.__drawnTexts.forEach(function(t){
          var s = t.replace(/\\s+/g, ' ').trim();
          if (!s || seen[s]) return;
          seen[s] = 1; arr.push(s);
        });
        return arr;
      })()`);

      // 3) DOM 扫描
      const scan = await ev(`(function(){
        function isVisible(el){
          if (!el || !el.getBoundingClientRect) return false;
          var r = el.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) return false;
          var cs = getComputedStyle(el);
          return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05;
        }
        var items = [];
        var seen = {};
        var total = 0;
        function push(el, text, kind){
          var s = (text || '').replace(/\\s+/g, ' ').trim();
          if (!s) return;
          total += 1;
          var key = kind + '|' + (el.id || '') + '|' + s;
          if (seen[key]) return;
          seen[key] = 1;
          if (items.length >= 40) return;
          var r = el.getBoundingClientRect();
          items.push({
            kind: kind, id: el.id || null,
            cls: (el.className && typeof el.className === 'string') ? el.className.slice(0, 40) : null,
            text: s.slice(0, 70), visible: isVisible(el),
            rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]
          });
        }
        var kbds = document.querySelectorAll('kbd');
        var kbdTotal = 0;
        for (var i = 0; i < kbds.length; i += 1) { kbdTotal += 1; push(kbds[i], kbds[i].textContent, 'kbd'); }
        var re = /(WASD|左键|右键|滚轮|Shift|Tab|Enter|Esc|空格|按\\s*[A-Za-z])/;
        var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
        var textTotal = 0;
        var node;
        while ((node = walker.nextNode())) {
          var t = node.nodeValue;
          if (!t || !re.test(t)) continue;
          var el = node.parentElement;
          if (!el || (el.closest && el.closest('script,style'))) continue;
          textTotal += 1;
          push(el, t, 'text');
          if (items.length >= 40) break;
        }
        var src = '';
        var scripts = document.querySelectorAll('script');
        for (var k = 0; k < scripts.length; k += 1) src += scripts[k].textContent + '\\n';
        var candidates = ['按 E 进入', '按 E 购买', '按 E 开始挑战', '站到祭坛旁按 E', '按 F 融合', '再按 F 过载', '按 E 穿越', '再按 E 确认'];
        var canvas = candidates.map(function(c){ return { text: c, inSource: src.indexOf(c) >= 0 }; });
        return {
          items: items, totalFound: total, kbdTotal: kbdTotal, textTotal: textTotal,
          capped: items.length >= 40, canvasCandidates: canvas, sourceLen: src.length
        };
      })()`);

      const keyWordRe = /(WASD|左键|右键|滚轮|Shift|Tab|Enter|Esc|空格|按\s*[A-Za-z])/;
      const drawnKeyboard = (drawn || []).filter((t) => keyWordRe.test(t));
      const visibleItems = scan.items.filter((x) => x.visible);
      return {
        pass: true, // 本条是清单型断言：扫描成功即通过
        detail: {
          inventoryOnly: true,
          domTotalMatched: scan.totalFound,
          kbdTotal: scan.kbdTotal, textTotal: scan.textTotal,
          listed: scan.items.length, cappedAt40: scan.capped,
          visibleListed: visibleItems.length,
          items: scan.items,
          drawnCanvasTextTotal: (drawn || []).length,
          drawnCanvasKeyboardHints: drawnKeyboard.slice(0, 20),
          canvasHintsInSource: scan.canvasCandidates,
          note: 'canvas 提示文字在触屏会话里并非全部当前显示；inSource=true 表示源码存在、靠近目标时会绘制'
        }
      };
    });

    // ============================================================
    // A16 手势安全
    // ============================================================
    await runCase('A16', '手势安全：canvas computed touch-action=none、页面 overscroll、viewport meta、body 无滚动（scrollY=0）', async () => {
      const r = await ev(`(function(){
        var g = document.querySelector('#game');
        var cs = getComputedStyle(g);
        var meta = document.querySelector('meta[name=viewport]');
        var html = document.documentElement, body = document.body;
        return {
          touchAction: cs.touchAction, userSelect: cs.userSelect,
          viewportMeta: meta ? meta.getAttribute('content') : null,
          userScalableNo: meta ? /user-scalable\\s*=\\s*no/i.test(meta.getAttribute('content') || '') : false,
          htmlOverscroll: getComputedStyle(html).overscrollBehavior,
          bodyOverscroll: getComputedStyle(body).overscrollBehavior,
          htmlOverflow: getComputedStyle(html).overflow,
          bodyOverflow: getComputedStyle(body).overflow,
          scrollY: window.scrollY, innerH: window.innerHeight,
          docScrollH: html.scrollHeight, bodyScrollH: body.scrollHeight,
          canvasRect: (function(){ var b = g.getBoundingClientRect();
            return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; })()
        };
      })()`);
      const pass = r.touchAction === 'none' && r.scrollY === 0 && r.docScrollH <= r.innerH + 1;
      return {
        pass,
        detail: Object.assign({}, r, {
          noScroll: r.scrollY === 0 && r.docScrollH <= r.innerH + 1,
          note: r.userScalableNo ? null : 'viewport 未写 user-scalable=no（双击/双指缩放未在 meta 层禁用）'
        })
      };
    });

    // ============================================================
    // A17 全程无脚本错误
    // ============================================================
    await runCase('A17', '全程 window.__errors 为空（导航前已装 error/rejection 收集器，含独立镜像）', async () => {
      const errs = await ev(`(function(){
        return {
          gameErrors: (window.__errors || []).slice(0, 10),
          gameErrorsCount: (window.__errors || []).length,
          mirror: (window.__errMirror || []).slice(0, 10),
          mirrorCount: (window.__errMirror || []).length
        };
      })()`);
      const pass = errs.gameErrorsCount === 0 && errs.mirrorCount === 0;
      return { pass, detail: errs };
    });

    // ---------- 收尾：还原包装、清理输入 ----------
    try {
      await ev(`(function(){
        if (window.__realCastPrimary) window.castPrimary = window.__realCastPrimary;
        window.__roamDebug.touch.reset();
        state.player.vx = 0; state.player.vy = 0;
        window.__roamDebug.clearEnemies();
        return true;
      })()`);
    } catch (e) { /* ignore */ }

    const md5After = md5Of(MAIN);
    log('主文件 MD5（后）：' + md5After);
    if (md5After !== md5Before) log('ALERT：主文件在测试期间被修改！！');

    writeResult(md5Before, md5After, asserts);
    const passCount = asserts.filter((x) => x.pass).length;
    log('\n===== 触屏回归 ' + passCount + '/' + asserts.length + ' =====');
    log('截图：' + ['final_touch_joystick_portrait.png', 'final_touch_landscape.png', 'final_touch_panel_rules.png', 'final_touch_panel_settings.png']
      .map((n) => { try { return n + '(' + fs.statSync(path.join(OUT_DIR, n)).size + 'B)'; } catch (e) { return n + '(缺失)'; } })
      .join(' · '));
    log('VERDICT: ' + (passCount === asserts.length ? 'PASS' : 'FAIL'));
    if (md5After !== md5Before) process.exitCode = 2;
  } catch (err) {
    log('FATAL: ' + (err && err.stack ? err.stack : String(err)));
    const md5After = md5Of(MAIN);
    writeResult(md5Of(MAIN), md5After, asserts);
    process.exitCode = 1;
  } finally {
    try { if (ws) ws.close(); } catch (e) { /* ignore */ }
    try { killEdge(edge); } catch (e) { /* ignore */ }
    await sleep(200);
    try { logStream.end(); } catch (e) { /* ignore */ }
  }
}

/**
 * 写出结果 JSON（结构与验收口径一致）
 * @param {string} before 跑前 MD5
 * @param {string} after 跑后 MD5
 * @param {Array<Object>} list 断言列表
 * @returns {void}
 */
function writeResult(before, after, list) {
  const payload = {
    time: new Date().toISOString(),
    target: MAIN,
    targetMd5Before: before,
    targetMd5After: after,
    targetBytes: fs.statSync(MAIN).size,
    asserts: list,
    passCount: list.filter((x) => x.pass).length,
    total: list.length
  };
  fs.writeFileSync(RESULT_PATH, JSON.stringify(payload, null, 2), 'utf8');
  console.log('结果已写入 ' + RESULT_PATH);
}

main();
