/**
 * 手柄回归 · CDP 只读脚本（G1–G20）· 主文件变体
 * ------------------------------------------------------------
 * 被测文件：index_arcane_v2.html（主文件，只读，绝不修改）
 * 输出：tools/ctrl_pad_main_result.json、tools/_ctrl_pad_main.log、.screenshots/ctrl/pad_main_*.png
 * 端口：9554（同一时刻只开一个无头 Edge）
 *
 * 说明：CI 没有真实手柄，通过 __roamDebug.gamepad.setFake() 注入虚拟手柄，
 * 走的是和真实设备同一条 pollGamepad 路径（不是另写模拟逻辑）。
 * 每条断言独立 try/catch，单条抛异常 → 记为 FAIL，后续断言继续跑。
 * 本文件仅替换被测路径/端口/输出名，G1–G20 断言与判据与 ctrl_pad_regress.js 完全一致。
 */
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9554;
const ROOT = path.join(__dirname, '..');
const SNAP = path.join(ROOT, 'index_arcane_v2.html');
const OUT_DIR = path.join(ROOT, '.screenshots', 'ctrl');
const LOG_FILE = path.join(__dirname, '_ctrl_pad_main.log');
const RESULT_FILE = path.join(__dirname, 'ctrl_pad_main_result.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 断言结果列表 */
const asserts = [];

/** 附加探针结果（不计入 G1–G20 表，仅作证据落盘） */
const extraProbes = [];

/**
 * 写一行日志（同时落盘 tools/_ctrl_pad_main.log）
 * @param {string} msg 日志内容
 * @returns {void}
 */
function log(msg = '') {
  const line = String(msg);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (e) { /* ignore */ }
  console.log(line);
}

/**
 * 记录一条附加探针（不进入 asserts，保证结果表仍为 20 行）
 * @param {string} id 探针编号
 * @param {*} detail 证据
 * @returns {void}
 */
function extraProbe(id, detail) {
  extraProbes.push({ id, detail: detail === undefined ? null : detail });
  log('[extra] ' + id + ' · ' + JSON.stringify(detail === undefined ? null : detail));
}

/**
 * 计算文件 MD5（大写十六进制，与 PowerShell Get-FileHash 口径一致）
 * @param {string} file 文件路径
 * @returns {string} MD5
 */
function md5(file) {
  return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

/**
 * 记录一条断言并打印证据
 * @param {string} id 编号（G1…G20）
 * @param {string} name 断言名
 * @param {boolean} pass 是否通过
 * @param {*} [detail] 证据
 * @returns {void}
 */
function record(id, name, pass, detail) {
  const fullName = String(name).indexOf(id + ' ') === 0 ? String(name) : id + ' ' + String(name);
  asserts.push({ id, name: fullName, pass: !!pass, detail: detail === undefined ? null : detail });
  log((pass ? 'PASS' : 'FAIL') + ' · ' + fullName + (detail === undefined ? '' : ' · ' + JSON.stringify(detail)));
}

/**
 * 执行一条断言：函数抛异常时自动记为 FAIL，不中断后续断言
 * @param {string} id 编号
 * @param {string} name 断言名
 * @param {Function} fn 返回 {pass, detail} 的异步函数
 * @returns {Promise<void>}
 */
async function check(id, name, fn) {
  try {
    const r = await fn();
    if (r && typeof r === 'object' && Object.prototype.hasOwnProperty.call(r, 'pass')) {
      record(id, name, r.pass, r.detail);
    } else {
      record(id, name, !!r, { value: r });
    }
  } catch (err) {
    record(id, name, false, { error: String((err && err.message) || err) });
  }
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(LOG_FILE, '');
  const md5Before = md5(SNAP);
  log('[md5] main before = ' + md5Before + ' · bytes=' + fs.statSync(SNAP).size);

  let edge = null;
  let ws = null;
  let profile = null;

  try {
    if (!fs.existsSync(SNAP)) throw new Error('主文件不存在：' + SNAP);

    let target = null;
    // Edge 偶发启动慢/首次握手失败：最多尝试 2 次（每次先杀掉上一棵进程树）
    for (let attempt = 1; attempt <= 2 && !target; attempt += 1) {
      if (edge) { try { killEdge(edge); } catch (e) { /* ignore */ } }
      await sleep(attempt === 1 ? 0 : 1200);
      profile = prepareProfile();
      edge = spawn(EDGE, [
        `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
        '--headless=new', '--no-first-run', '--no-default-browser-check',
        '--disable-extensions', '--allow-file-access-from-files',
        '--window-size=1440,900', 'about:blank'
      ], { stdio: 'ignore' });
      log('[edge] launch attempt ' + attempt + ' · pid=' + edge.pid + ' · profile=' + profile);

      for (let i = 0; i < 120; i += 1) {
        try {
          const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
          target = list.find((t) => t.type === 'page');
          if (target) break;
        } catch (e) { /* 等 Edge 起来 */ }
        await sleep(250);
      }
      if (!target) log('[edge] attempt ' + attempt + ' 未就绪');
    }
    if (!target) throw new Error('Edge 未就绪（9554，已重试 2 次）');
    log('[edge] ready · ' + target.id);

    ws = new WebSocket(target.webSocketDebuggerUrl);
    let seq = 0;
    const pending = new Map();
    ws.onmessage = (msg) => {
      const m = JSON.parse(msg.data);
      if (m.id && pending.has(m.id)) {
        pending.get(m.id)(m);
        pending.delete(m.id);
      }
    };
    await new Promise((r) => { ws.onopen = r; });

    /**
     * 发送 CDP 命令并等待返回
     * @param {string} method CDP 方法
     * @param {Object} [params] 参数
     * @returns {Promise<Object>}
     */
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      seq += 1;
      pending.set(seq, (m) => (m.error ? reject(new Error(method + ': ' + JSON.stringify(m.error))) : resolve(m.result)));
      ws.send(JSON.stringify({ id: seq, method, params }));
    });

    /**
     * 页面内执行表达式（returnByValue）
     * @param {string} expression JS 表达式
     * @returns {Promise<*>}
     */
    const ev = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };

    /**
     * 轮询等待页面表达式返回真值
     * @param {string} expression 布尔表达式
     * @param {number} [timeoutMs] 超时
     * @returns {Promise<*>}
     */
    const waitFor = async (expression, timeoutMs = 25000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < timeoutMs) {
        try {
          const v = await ev(expression);
          if (v) return v;
        } catch (e) { /* 页面还没加载完 */ }
        await sleep(250);
      }
      return null;
    };

    /**
     * 截图到 .screenshots/ctrl
     * @param {string} name 文件名
     * @returns {Promise<number>} 文件字节数
     */
    const shot = async (name) => {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      const file = path.join(OUT_DIR, name);
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
      const size = fs.statSync(file).size;
      log('[shot] ' + name + ' · ' + size + 'B');
      return size;
    };

    /**
     * 注入虚拟手柄（buttons 长度 17、axes 4 轴；buttons 为布尔数组）
     * @param {number} ax 左摇杆 X
     * @param {number} ay 左摇杆 Y
     * @param {number[]} [pressed] 按下的按钮索引
     * @returns {Promise<boolean>}
     */
    const setPad = (ax, ay, pressed = []) => ev(`(function(){
      var btns = [];
      for (var i = 0; i < 17; i += 1) btns.push(false);
      ${pressed.map((i) => `btns[${i}] = true;`).join('')}
      window.__roamDebug.gamepad.setFake({ id: 'Virtual Pad', axes: [${ax}, ${ay}, 0, 0], buttons: btns });
      return true;
    })()`);

    /**
     * 松开所有按钮并等一帧，避免"按下沿"状态串到下一条断言
     * @returns {Promise<void>}
     */
    const release = async () => {
      await setPad(0, 0, []);
      await sleep(150);
    };

    /**
     * 把运行时恢复到"游戏中、无面板、静止"的干净态（只改内存，不推进游戏）
     * @returns {Promise<boolean>}
     */
    const ensurePlaying = () => ev(`(function(){
      state.transitionLock = false;
      state.status = 'playing';
      state.mode = 'playing';
      state.panelReturnMode = null;
      if (typeof hideOtherPanels === 'function') hideOtherPanels(null);
      if (ui.modalLayer) {
        ui.modalLayer.classList.add('hidden');
        ui.modalLayer.setAttribute('aria-hidden', 'true');
      }
      state.keys = {};
      state.player.vx = 0; state.player.vy = 0;
      if (typeof weaponHoldFire !== 'undefined') weaponHoldFire = false;
      return true;
    })()`);

    /**
     * 清空顶部 toast，保证"断连是否有提示"的判据不会被上一条断言的残留 toast 污染
     * @returns {Promise<boolean>}
     */
    const clearToast = () => ev(`(function(){
      var t = document.getElementById('toast');
      if (t) { t.className = 'toast'; t.textContent = ''; }
      return true;
    })()`);

    /**
     * 读取手柄状态快照（连接、方向、动作计数、角色/战斗关键字段）
     * @returns {Promise<Object>}
     */
    const readState = () => ev(`(function(){
      var g = window.__roamDebug.gamepad;
      var legacyCd = 0;
      Object.keys(state.cooldowns || {}).forEach(function(k){ if (state.cooldowns[k] > 0) legacyCd += 1; });
      return {
        info: g.info(),
        legend: g.legend(),
        actions: g.actions(),
        mode: state.mode,
        status: state.status,
        speed: Number(Math.hypot(state.player.vx, state.player.vy).toFixed(2)),
        x: Number(state.player.x.toFixed(1)),
        y: Number(state.player.y.toFixed(1)),
        cd: legacyCd,
        castAnim: Number((state.player.castAnim || 0).toFixed(3)),
        dashTime: Number((state.player.dashTime || 0).toFixed(3)),
        dashCd: Number((state.player.dashCd || 0).toFixed(3)),
        swings: Number((state.weapon && state.weapon.stats ? state.weapon.stats.swings : 0)),
        weaponCd: Number((state.weapon ? state.weapon.cd : 0).toFixed(3)),
        deviceCooldown: Number((state.deviceCooldown || 0).toFixed(3)),
        dualFocus: Number((state.dual && state.dual.focus) || 0),
        dualSwitchCd: Number(((state.dual && state.dual.switchCd) || 0).toFixed(3)),
        fusions: (state.fusions || []).length,
        activeMagic: state.activeMagicId,
        unlocked: {
          device: isUnlocked('device'),
          parallel: isUnlocked('parallel'),
          fusion: isUnlocked('fusion')
        },
        padButtons: Object.keys(state.padButtons || {}).filter(function(k){ return state.padButtons[k]; }),
        keys: Object.assign({}, state.padKeys || {}),
        keyState: Object.assign({}, state.keys || {})
      };
    })()`);

    /**
     * 判断 padKeys 四个方向是否全为 false
     * @param {Object} keys padKeys
     * @returns {boolean}
     */
    const padKeysAllFalse = (keys) => ['left', 'right', 'up', 'down']
      .every((k) => !!keys && keys[k] === false);

    await send('Runtime.enable');
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: encodeURI('file:///' + SNAP.replace(/\\/g, '/')) });

    const booted = await waitFor(`typeof window.__roamDebug !== 'undefined' && typeof state !== 'undefined' && !!state.mode`, 30000);
    if (!booted) throw new Error('页面未完成初始化（state/__roamDebug 缺失）');
    log('[boot] ready, mode=' + (await ev(`state.mode`)));
    await sleep(600);

    // 开局：点 #btnStart，跳过开场演出，清空敌人
    await ev(`(function(){ var b = document.querySelector('#btnStart'); if (b) b.click(); return true; })()`);
    await sleep(1200);
    // 主文件新增“三角色选择”页：标题页点开始后先弹选择页（原快照没有这一步），
    // 按真实用户路径点 #btnCharConfirm 才能进入 playing；仅修复开局流程，不动任何断言。
    await ev(`(function(){
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
    await ev(`(function(){
      if (typeof skipOpeningRitual === 'function') skipOpeningRitual();
      state.transitionLock = false;
      state.player.vx = 0; state.player.vy = 0;
      window.__roamDebug.clearEnemies();
      window.__errors = [];
      return { mode: state.mode, card: state.activeMagicId };
    })()`);
    await sleep(600);
    log('[boot] after start, mode=' + (await ev(`state.mode`)) + ', card=' + (await ev(`state.activeMagicId`)));

    // ---------- G1 无手柄基线 ----------
    await check('G1', '无手柄基线：connected=false、padKeys 全 false、0.3s 速度<20、#padLegend hidden', async () => {
      await ev(`(function(){
        window.__roamDebug.gamepad.clearFake();
        state.keys = {};
        state.player.vx = 0; state.player.vy = 0;
        return true;
      })()`);
      await sleep(320);
      const s = await readState();
      const allFalse = padKeysAllFalse(s.info.keys);
      const pass = s.info.connected === false && allFalse && s.speed < 20 && s.legend.hidden === true;
      return {
        pass,
        detail: {
          connected: s.info.connected, keys: s.info.keys, speed: s.speed,
          legendHidden: s.legend.hidden, mode: s.mode
        }
      };
    });

    // ---------- G2 热插入 ----------
    await check('G2', '热插入：0.45s 内 connected=true、name 回显、图例显示且文案含“手柄已连接 / A 普攻 / LT 交互”', async () => {
      await setPad(0, 0, []);
      await sleep(450);
      const s = await readState();
      const text = s.legend.text || '';
      const textOk = text.indexOf('手柄已连接') >= 0 && text.indexOf('A 普攻') >= 0 && text.indexOf('LT 交互') >= 0;
      // “图例显示”不只查 hidden 属性，还要查真实可见性（computed display / 布局尺寸）
      const visExpr = `(function(){
        var el = document.getElementById('padLegend');
        if (!el) return { exists: false };
        var cs = getComputedStyle(el);
        var r = el.getBoundingClientRect();
        return {
          exists: true, hiddenAttr: !!el.hidden,
          display: cs.display, visibility: cs.visibility, opacity: cs.opacity,
          width: Math.round(r.width), height: Math.round(r.height),
          top: Math.round(r.top), bottom: Math.round(r.bottom),
          viewportH: window.innerHeight,
          bodyCompact: document.body.classList.contains('hud-compact')
        };
      })()`;
      const vis = await ev(visExpr);
      await shot('pad_main_connected.png');
      // 额外证据：临时展开紧凑 HUD，证明文案本身能渲染（随后立刻恢复默认）
      let expanded = null;
      try {
        await ev(`(function(){ window.__roamDebug.hud.set({ compact: false }); return true; })()`);
        await sleep(260);
        expanded = await ev(visExpr);
        await shot('pad_main_connected_legend_expanded.png');
        await ev(`(function(){ window.__roamDebug.hud.set({ compact: true }); return true; })()`);
        await sleep(220);
      } catch (e) {
        expanded = { error: String((e && e.message) || e) };
      }
      const rendered = !!(vis && vis.exists && vis.display !== 'none'
        && vis.width > 0 && vis.height > 0);
      const pass = s.info.connected === true && s.info.name === 'Virtual Pad'
        && s.legend.hidden === false && textOk && rendered;
      return {
        pass,
        detail: {
          connected: s.info.connected, name: s.info.name, legendHidden: s.legend.hidden,
          textMatched: { connectedWord: text.indexOf('手柄已连接') >= 0, aWord: text.indexOf('A 普攻') >= 0, ltWord: text.indexOf('LT 交互') >= 0 },
          legendText: text,
          visibilityDefaultHud: vis,
          visibilityAfterHudExpand: expanded,
          phenomenon: rendered
            ? '图例在默认 HUD 下真实可见'
            : 'legend.hidden=false 且文案正确，但默认 hud-compact 把 .deck-keys 整行 display:none，图例在画面上不可见'
        }
      };
    });

    // ---------- G3 摇杆移动 ----------
    await check('G3', '摇杆移动：axes[0]=0.9 → padKeys.right=true、0.55s 位移 ≥40px', async () => {
      await ev(`(function(){ state.keys = {}; state.player.vx = 0; state.player.vy = 0; return true; })()`);
      const x0 = await ev(`state.player.x`);
      await setPad(0.9, 0, []);
      await sleep(250);
      const mid = await readState();
      await sleep(300);
      const s = await readState();
      const dx = Number((s.x - x0).toFixed(1));
      const pass = s.info.keys.right === true && dx >= 40;
      return {
        pass,
        detail: { x0: Number(x0.toFixed(1)), x1: s.x, dx, keys: s.info.keys, midSpeed: mid.speed, midKeys: mid.info.keys }
      };
    });

    // ---------- G4 死区边界双侧 ----------
    await check('G4', '死区边界：0.20（<0.24）四向全 false；0.26 → right=true', async () => {
      await setPad(0.20, 0, []);
      await sleep(350);
      const low = await readState();
      await setPad(0.26, 0, []);
      await sleep(350);
      const high = await readState();
      const pass = padKeysAllFalse(low.info.keys) && high.info.keys.right === true;
      return {
        pass,
        detail: {
          'deadzone': 0.24,
          'read_0.20': low.info.keys,
          'read_0.26': high.info.keys,
          speedAfter020: low.speed
        }
      };
    });

    // ---------- G5 十字键 ----------
    await check('G5', '十字键：按下 15 → padKeys.right=true；按下 12 → up=true', async () => {
      await setPad(0, 0, [15]);
      await sleep(220);
      const right = await readState();
      await release();
      await setPad(0, 0, [12]);
      await sleep(220);
      const up = await readState();
      await release();
      const pass = right.info.keys.right === true && up.info.keys.up === true;
      return {
        pass,
        detail: { dpad15_right: right.info.keys, dpad12_up: up.info.keys, dpad15_buttons: right.padButtons }
      };
    });

    // ---------- G6 A → primary ----------
    await check('G6', 'A(0)→primary：actions.count+1、last=primary，且至少一个魔法进冷却或 castAnim>0', async () => {
      await ensurePlaying();
      await release();
      const before = await readState();
      await setPad(0, 0, [0]);
      await sleep(320);
      const s = await readState();
      await release();
      const pass = s.actions.count === before.actions.count + 1 && s.actions.last === 'primary'
        && (s.cd > 0 || s.castAnim > 0);
      return {
        pass,
        detail: {
          beforeCount: before.actions.count, afterCount: s.actions.count, last: s.actions.last,
          cooldownCount: s.cd, castAnim: s.castAnim, activeMagic: s.activeMagic
        }
      };
    });

    // ---------- G7 B → dash ----------
    await check('G7', 'B(1)→dash：dashCd 或 dashTime >0、last=dash', async () => {
      await ensurePlaying();
      await setPad(0, 0, [1]);
      await sleep(200);
      const s = await readState();
      await release();
      const pass = (s.dashTime > 0 || s.dashCd > 0) && s.actions.last === 'dash';
      return {
        pass,
        detail: { dashTime: s.dashTime, dashCd: s.dashCd, last: s.actions.last, count: s.actions.count }
      };
    });

    // ---------- G8 X → device ----------
    await check('G8', 'X(2)→device：last=device（未解锁时动作仍计数、无实际效果，记录 isUnlocked 与现象）', async () => {
      await ensurePlaying();
      await release();
      const before = await readState();
      await setPad(0, 0, [2]);
      await sleep(280);
      const s = await readState();
      await release();
      const unlocked = s.unlocked.device;
      const pass = s.actions.count === before.actions.count + 1 && s.actions.last === 'device';
      return {
        pass,
        detail: {
          beforeCount: before.actions.count, afterCount: s.actions.count, last: s.actions.last,
          isUnlocked_device: unlocked, deviceCooldown: s.deviceCooldown,
          phenomenon: unlocked
            ? '装置已解锁，deviceCooldown=' + s.deviceCooldown
            : '装置未解锁：动作已计数但 castDevice 被 isUnlocked 拦截，deviceCooldown=' + s.deviceCooldown
        }
      };
    });

    // ---------- G9 Y → weapon ----------
    await check('G9', 'Y(3)→weapon：state.weapon.stats.swings +1、last=weapon', async () => {
      await ensurePlaying();
      await release();
      const before = await readState();
      await setPad(0, 0, [3]);
      await sleep(280);
      const s = await readState();
      await release();
      await ev(`(function(){ if (typeof weaponHoldFire !== 'undefined') weaponHoldFire = false; return true; })()`);
      const cfg = await ev(`(function(){
        return {
          weaponCodeEnabled: !!WEAPON_CONFIG.enabled,
          metaWeaponsEnabled: state.meta ? state.meta.weaponsEnabled !== false : null,
          weaponId: state.weapon ? state.weapon.id : null
        };
      })()`);
      const pass = s.swings === before.swings + 1 && s.actions.last === 'weapon';
      return {
        pass,
        detail: {
          beforeSwings: before.swings, afterSwings: s.swings,
          last: s.actions.last, weaponCdAfter: s.weaponCd,
          WEAPON_CONFIG_enabled: cfg.weaponCodeEnabled,
          meta_weaponsEnabled: cfg.metaWeaponsEnabled,
          weaponId: cfg.weaponId,
          phenomenon: pass
            ? 'Y 键成功触发一次挥击'
            : (!cfg.weaponCodeEnabled
              ? '武器系统代码级总开关关闭（WEAPON_CONFIG.enabled=false，X 批裁决），last=weapon 但 weaponSwingNow 未执行，swings 保持 ' + s.swings
              : '挥击被冷却/前置条件拦截，last=weapon 但 swings 保持 ' + s.swings)
        }
      };
    });

    // ---------- G10 LB → swap、RB → fuse ----------
    await check('G10', 'LB(4)→swap、RB(5)→fuse：分别记录 last 与是否真的换相/融合（未解锁时只记 last）', async () => {
      await ensurePlaying();
      await release();

      const b4 = await readState();
      await setPad(0, 0, [4]);
      await sleep(280);
      const lb = await readState();
      await release();

      const b5 = await readState();
      await setPad(0, 0, [5]);
      await sleep(280);
      const rb = await readState();
      await release();

      const swapPass = lb.actions.count === b4.actions.count + 1 && lb.actions.last === 'swap';
      const fusePass = rb.actions.count === b5.actions.count + 1 && rb.actions.last === 'fuse';
      return {
        pass: swapPass && fusePass,
        detail: {
          swap: {
            pass: swapPass,
            last: lb.actions.last, count: lb.actions.count,
            isUnlocked_parallel: lb.unlocked.parallel,
            focusBefore: b4.dualFocus, focusAfter: lb.dualFocus,
            switchCdAfter: lb.dualSwitchCd,
            phenomenon: lb.unlocked.parallel
              ? '并联已解锁，focus ' + b4.dualFocus + '→' + lb.dualFocus
              : '并联未解锁：只计数不换相，focus 保持 ' + lb.dualFocus
          },
          fuse: {
            pass: fusePass,
            last: rb.actions.last, count: rb.actions.count,
            isUnlocked_fusion: rb.unlocked.fusion,
            fusionsBefore: b5.fusions, fusionsAfter: rb.fusions,
            phenomenon: rb.unlocked.fusion
              ? '融合已解锁，融合数 ' + b5.fusions + '→' + rb.fusions
                + (rb.fusions === b5.fusions ? '（当前无可融合配方/材料，tryFuse 无实际产物）' : '')
              : '融合未解锁：只计数不融合，融合数保持 ' + rb.fusions
          }
        }
      };
    });

    // ---------- G11 LT → descend、RT → skilltree ----------
    await check('G11', 'LT(6)→descend、RT(7)→skilltree：两个方向都测，last 正确', async () => {
      await ensurePlaying();
      await release();

      const b6 = await readState();
      await setPad(0, 0, [6]);
      await sleep(280);
      const lt = await readState();
      await release();

      const b7 = await readState();
      await setPad(0, 0, [7]);
      await sleep(280);
      const rt = await readState();
      await release();
      let closedMode = null;
      if (rt.mode === 'skilltree') {
        await setPad(0, 0, [7]);
        await sleep(280);
        const c = await readState();
        closedMode = c.mode;
        await release();
      }
      const ltPass = lt.actions.count === b6.actions.count + 1 && lt.actions.last === 'descend';
      const rtPass = rt.actions.count === b7.actions.count + 1 && rt.actions.last === 'skilltree';
      return {
        pass: ltPass && rtPass,
        detail: {
          lt: { pass: ltPass, last: lt.actions.last, count: lt.actions.count, modeAfter: lt.mode },
          rt: { pass: rtPass, last: rt.actions.last, count: rt.actions.count, modeAfter: rt.mode, modeAfterSecondPress: closedMode }
        }
      };
    });

    // ---------- G12 模拟扳机边界 ----------
    await check('G12', '模拟扳机边界：buttons[6]={pressed:false,value:0.65} → actions.count 是否变化（不变即 FAIL）', async () => {
      await ensurePlaying();
      await release();
      const before = await readState();
      await ev(`(function(){
        var btns = [];
        for (var i = 0; i < 17; i += 1) btns.push(false);
        btns[6] = { pressed: false, value: 0.65 };
        window.__roamDebug.gamepad.setFake({ id: 'Virtual Pad', axes: [0, 0, 0, 0], buttons: btns });
        return true;
      })()`);
      await sleep(320);
      const s = await readState();
      await release();
      const changed = s.actions.count !== before.actions.count;
      return {
        pass: changed,
        detail: {
          beforeCount: before.actions.count,
          afterCount: s.actions.count,
          last: s.actions.last,
          connected: s.info.connected,
          pressedRead: s.padButtons.indexOf('6') >= 0,
          injected: { pressed: false, value: 0.65 },
          phenomenon: changed
            ? '模拟量 0.65 触发了动作计数'
            : '扳机只认 pressed 布尔，模拟量 0.65 被忽略（actions.count 仍为 ' + s.actions.count + '）'
        }
      };
    });

    // ---------- 附加探针（不计入 G1–G20）：扳机阈值双侧 ----------
    try {
      await ensurePlaying();
      await release();
      const b65 = await readState();
      await ev(`(function(){
        var btns = [];
        for (var i = 0; i < 17; i += 1) btns.push(false);
        btns[6] = { pressed: false, value: 0.65 };
        window.__roamDebug.gamepad.setFake({ id: 'Virtual Pad', axes: [0, 0, 0, 0], buttons: btns });
        return true;
      })()`);
      await sleep(320);
      const a65 = await readState();
      await release();

      await ensurePlaying();
      await release();
      const b40 = await readState();
      await ev(`(function(){
        var btns = [];
        for (var i = 0; i < 17; i += 1) btns.push(false);
        btns[6] = { pressed: false, value: 0.40 };
        window.__roamDebug.gamepad.setFake({ id: 'Virtual Pad', axes: [0, 0, 0, 0], buttons: btns });
        return true;
      })()`);
      await sleep(320);
      const a40 = await readState();
      await release();

      extraProbe('P4.trigger_value_0.65', {
        beforeCount: b65.actions.count, afterCount: a65.actions.count,
        delta: a65.actions.count - b65.actions.count, last: a65.actions.last,
        pressedRead: a65.padButtons.indexOf('6') >= 0
      });
      extraProbe('P4.trigger_value_0.40', {
        beforeCount: b40.actions.count, afterCount: a40.actions.count,
        delta: a40.actions.count - b40.actions.count, last: a40.actions.last,
        pressedRead: a40.padButtons.indexOf('6') >= 0
      });
    } catch (e) {
      extraProbe('P4.trigger_error', { error: String((e && e.message) || e) });
    }

    // ---------- G13 长按 A ----------
    await check('G13', '长按 A 0.8s：动作只触发 1 次（按下沿检测）', async () => {
      await ensurePlaying();
      await release();
      const before = await readState();
      await setPad(0, 0, [0]);
      await sleep(450);
      const hold1 = await readState();
      await sleep(350);
      const hold2 = await readState();
      await release();
      const pass = hold1.actions.count === before.actions.count + 1 && hold2.actions.count === hold1.actions.count;
      return {
        pass,
        detail: {
          before: before.actions.count, after450ms: hold1.actions.count, after800ms: hold2.actions.count,
          last: hold2.actions.last
        }
      };
    });

    // ---------- G14 热拔 ----------
    await check('G14', '热拔（clearFake）：0.4s 内 padKeys 全 false、角色停走、图例隐藏；是否出现 toast/提示', async () => {
      await ensurePlaying();
      // 先记录并清掉"上一动作排队补播"的旧 toast（教学提示期间 showToast 会进 onboardPendingToast），
      // 否则无法判断拔线瞬间出现的提示到底是不是"断连提示"。
      const pendingBefore = await ev(`(function(){
        return {
          pendingToast: onboardPendingToast ? onboardPendingToast.message : null,
          hintVisible: typeof onboardHintVisible === 'function' ? onboardHintVisible() : null
        };
      })()`);
      await ev(`(function(){
        if (state && state.onboard) {
          state.onboard.queue = [];
          state.onboard.pending = [];
          state.onboard.modalHint = null;
        }
        if (typeof onboardHideHint === 'function') onboardHideHint(false);
        onboardPendingToast = null;
        if (ui.onboardHint) {
          ui.onboardHint.classList.remove('is-on');
          ui.onboardHint.setAttribute('aria-hidden', 'true');
        }
        return true;
      })()`);
      await sleep(120);
      await clearToast();
      await setPad(0.9, 0, []);
      await sleep(350);
      const moving = await readState();
      await ev(`window.__roamDebug.gamepad.clearFake(); true`);
      await sleep(420);
      const s = await readState();
      const toast = await ev(`(function(){
        var el = document.getElementById('toast');
        var nodes = Array.prototype.slice.call(document.querySelectorAll('#toast, .toast'));
        var visible = nodes.filter(function(n){
          return n && (n.className || '').indexOf('is-on') >= 0 && (n.textContent || '').trim().length > 0;
        });
        return {
          exists: !!el,
          visible: visible.length > 0,
          text: visible.length ? (visible[0].textContent || '') : '',
          className: el ? (el.className || '') : ''
        };
      })()`);
      const allFalse = padKeysAllFalse(s.info.keys);
      const core = s.info.connected === false && allFalse && s.speed < 20 && s.legend.hidden === true;
      const pass = core && toast.visible === true;
      return {
        pass,
        detail: {
          connected: s.info.connected, keys: s.info.keys, speedWhileUnplugged: s.speed,
          legendHidden: s.legend.hidden, speedBeforeUnplug: moving.speed,
          cleanedStaleToast: pendingBefore,
          toastVisible: toast.visible, toastText: toast.text, toastClass: toast.className,
          phenomenon: toast.visible
            ? '断连后有提示：' + toast.text
            : '断连无提示（仅图例消失，无 toast/声音），战斗中不易察觉'
        }
      };
    });

    // ---------- G15 断连后键盘不受影响 ----------
    await check('G15', '断连后键盘不受影响：handleKeyDown w → state.keys.up=true，handleKeyUp → false', async () => {
      await ensurePlaying();
      const r = await ev(`(function(){
        handleKeyDown({ key: 'w', preventDefault: function(){} });
        var down = !!state.keys.up;
        handleKeyUp({ key: 'w', preventDefault: function(){} });
        return { down: down, upAfter: !!state.keys.up };
      })()`);
      return { pass: r.down === true && r.upAfter === false, detail: r };
    });

    // ---------- G18 手柄暂停（rules） ----------
    await check('G18', '手柄暂停：按 8（rules）→ state.mode 变 rules；再按 8 → 关闭回 playing', async () => {
      await ensurePlaying();
      await release();
      await setPad(0, 0, [8]);
      await sleep(260);
      const first = await readState();
      await release();
      await setPad(0, 0, [8]);
      await sleep(260);
      const second = await readState();
      await release();
      const pass = first.mode === 'rules' && second.mode === 'playing';
      return {
        pass,
        detail: { modeAfterFirstPress: first.mode, modeAfterSecondPress: second.mode, lastAction: second.actions.last }
      };
    });

    // ---------- G19 手柄设置 ----------
    await check('G19', '手柄设置：按 11（settings）→ 面板打开；再按 11 → 关闭', async () => {
      await ensurePlaying();
      await release();
      await setPad(0, 0, [11]);
      await sleep(260);
      const first = await readState();
      const openDom = await ev(`(function(){
        var el = document.getElementById('settingsPanel');
        return { exists: !!el, isOpen: !!(el && el.classList.contains('is-open')) };
      })()`);
      await release();
      await setPad(0, 0, [11]);
      await sleep(260);
      const second = await readState();
      await release();
      const pass = first.mode === 'settings' && second.mode === 'playing';
      return {
        pass,
        detail: {
          modeAfterFirstPress: first.mode, panelOpenDom: openDom,
          modeAfterSecondPress: second.mode, lastAction: second.actions.last
        }
      };
    });

    // ---------- G20 手柄与键盘不互斥 ----------
    await check('G20', '手柄与键盘不互斥：键盘 d + 手柄 up 同时 true；拔手柄后键盘 right 仍 true', async () => {
      await ensurePlaying();
      await release();
      await ev(`(function(){ handleKeyDown({ key: 'd', preventDefault: function(){} }); return !!state.keys.right; })()`);
      await setPad(0, -0.9, []);
      await sleep(260);
      const both = await readState();
      await ev(`window.__roamDebug.gamepad.clearFake(); true`);
      await sleep(420);
      const after = await readState();
      const pass = both.keyState.right === true && both.info.keys.up === true
        && after.keyState.right === true && after.info.keys.up === false;
      return {
        pass,
        detail: {
          whileBoth: { keyboardRight: both.keyState.right, padUp: both.info.keys.up },
          afterUnplug: { keyboardRight: after.keyState.right, padUp: after.info.keys.up, connected: after.info.connected }
        }
      };
    });

    // ---------- G16 奖励选择 ----------
    await check('G16', '奖励三选一/四选一：临时 state.mode=reward，依次按 A/B/X/Y/LB/RB，chooseRewardByIndex 是否被调用', async () => {
      await ensurePlaying();
      await release();
      await setPad(0, 0, []);
      await sleep(200);
      // 真正把奖励弹窗显示出来（只为截图与判据，不推进楼层）
      await ev(`(function(){
        if (typeof openReward === 'function') { openReward('debug', 'skill'); }
        else { showRewardStage('skill'); }
        return { mode: state.mode, options: (state.upgradeOptions || []).length };
      })()`);
      await sleep(320);
      const panel = await ev(`(function(){
        var layer = ui.modalLayer;
        var cards = document.querySelectorAll('#modal [data-reward-key], .modal [data-reward-key]').length;
        return { mode: state.mode, options: (state.upgradeOptions || []).length, cards: cards,
          layerVisible: !!(layer && !layer.classList.contains('hidden')) };
      })()`);
      await shot('pad_main_reward_panel.png');

      const wrapped = await ev(`(function(){
        if (typeof chooseRewardByIndex !== 'function') return { ok: false, reason: 'chooseRewardByIndex 不存在' };
        if (!window.__padRewardOrig) {
          window.__padRewardOrig = chooseRewardByIndex;
          window.__padRewardCount = 0;
          var wrappedFn = function(i){
            window.__padRewardCount += 1;
            return window.__padRewardOrig.apply(this, arguments);
          };
          chooseRewardByIndex = wrappedFn;
        }
        return { ok: chooseRewardByIndex !== window.__padRewardOrig, count: window.__padRewardCount };
      })()`);

      const presses = [];
      const buttons = [0, 1, 2, 3, 4, 5];
      for (const idx of buttons) {
        await setPad(0, 0, [idx]);
        await sleep(220);
        const s = await readState();
        const callCount = await ev(`window.__padRewardCount === undefined ? 0 : window.__padRewardCount`);
        presses.push({ button: idx, last: s.actions.last, mode: s.mode, rewardCalls: callCount });
        await release();
      }
      const total = await ev(`window.__padRewardCount === undefined ? 0 : window.__padRewardCount`);
      const finalMode = await ev(`state.mode`);
      const pass = total > 0;
      return {
        pass,
        detail: {
          panel, wrapWorks: wrapped.ok, totalRewardCalls: total, finalMode,
          presses,
          phenomenon: pass
            ? '手柄按钮成功触发选卡，共 ' + total + ' 次'
            : '手柄在奖励界面完全选不了卡（动作只映射数字键 1–4，A/B/X/Y/LB/RB 未映射），chooseRewardByIndex 调用 0 次'
        }
      };
    });

    // ---------- G17 结算界面 ----------
    await check('G17', '结算界面：临时 state.mode=result，依次按 A/Start(9)/B，restartRun 是否被调用', async () => {
      await ev(`(function(){
        state.mode = 'result';
        state.panelReturnMode = null;
        if (typeof hideOtherPanels === 'function') hideOtherPanels(null);
        if (typeof showResult === 'function') showResult();
        return state.mode;
      })()`);
      await sleep(350);
      const panel = await ev(`(function(){
        var layer = ui.modalLayer;
        var btn = document.querySelector('[data-action="restart"]');
        return { mode: state.mode, layerVisible: !!(layer && !layer.classList.contains('hidden')), restartButton: !!btn };
      })()`);
      await shot('pad_main_result_panel.png');

      const wrapped = await ev(`(function(){
        if (typeof restartRun !== 'function') return { ok: false, reason: 'restartRun 不存在' };
        if (!window.__padRestartOrig) {
          window.__padRestartOrig = restartRun;
          window.__padRestartCount = 0;
          var wrappedFn = function(){
            window.__padRestartCount += 1;
            return window.__padRestartOrig.apply(this, arguments);
          };
          restartRun = wrappedFn;
        }
        return { ok: restartRun !== window.__padRestartOrig, count: window.__padRestartCount };
      })()`);

      const presses = [];
      for (const idx of [0, 9, 1]) {
        const modeBefore = await ev(`state.mode`);
        await setPad(0, 0, [idx]);
        await sleep(220);
        const callCount = await ev(`window.__padRestartCount === undefined ? 0 : window.__padRestartCount`);
        const s = await readState();
        presses.push({ button: idx, modeBefore, last: s.actions.last, modeAfter: s.mode, restartCalls: callCount });
        await release();
      }
      const total = await ev(`window.__padRestartCount === undefined ? 0 : window.__padRestartCount`);
      const pass = total > 0;
      return {
        pass,
        detail: {
          panel, wrapWorks: wrapped.ok, totalRestartCalls: total, presses,
          phenomenon: pass
            ? '手柄成功触发重开，共 ' + total + ' 次'
            : '死亡结算后手柄无法重开（动作表未映射 restart，A→primary / Start→start / B→dash 都被 result 分支忽略），只能去摸键盘 R'
        }
      };
    });

    // 收尾：reload 页面（不改文件，只重建运行时）
    log('[cleanup] reload page');
    try { await send('Page.reload', { ignoreCache: true }); } catch (e) { /* ignore */ }
    await sleep(800);
    try { ws.close(); } catch (e) { /* ignore */ }
    ws = null;
  } catch (err) {
    log('FATAL: ' + String((err && err.stack) || err));
  } finally {
    try { if (ws) ws.close(); } catch (e) { /* ignore */ }
    try { if (edge) killEdge(edge); } catch (e) { /* ignore */ }
    await sleep(250);
    try { if (profile) fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ }

    const md5After = md5(SNAP);
    let sizeAfter = 0;
    try { sizeAfter = fs.statSync(SNAP).size; } catch (e) { /* ignore */ }
    const passCount = asserts.filter((a) => a.pass).length;
    const payload = {
      time: new Date().toISOString(),
      target: SNAP,
      snapshotMd5Before: md5Before,
      snapshotMd5After: md5After,
      bytesAfter: sizeAfter,
      asserts,
      extraProbes,
      passCount,
      total: asserts.length
    };
    try { fs.writeFileSync(RESULT_FILE, JSON.stringify(payload, null, 2)); } catch (e) { log('写 result 失败：' + e); }

    log('[md5] main after   = ' + md5After + ' · bytes=' + sizeAfter);
    log('[md5] unchanged = ' + (md5After === md5Before));
    log('');
    log('===== ctrl_pad_main ' + passCount + '/' + asserts.length + ' =====');
    asserts.forEach((a) => log((a.pass ? 'PASS' : 'FAIL') + ' | ' + a.name));
    const verdict = asserts.length > 0 && passCount === asserts.length;
    log('VERDICT: ' + (verdict ? 'PASS' : 'FAIL'));
    process.exit(verdict ? 0 : 1);
  }
})();
