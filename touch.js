/* ============================================================
   烬 · 触屏 / 移动端适配层（touch.js）
   ------------------------------------------------------------
   设计原则：
     1) 零外部请求：不加载任何图片 / 字体 / 脚本，所有样式与 DOM 由本文件生成；
     2) 不改主文件：只依赖主文件已有的 window 键盘监听与 Canvas 指针监听；
     3) 单文件模块：整段代码包在一个 IIFE 里，不污染全局（只暴露 window.__touchLayer 调试口）；
     4) 可关闭：URL 带 ?touch=off 时本文件完全不启动。

   接入方式（在主文件 body 末尾追加一行脚本标签）：
     script src="touch.js" —— 放在 body 结束标签之前即可；
   注意：本文件会被整套内联进演示页，因此注释中不出现完整的脚本结束标签。

   实现思路：
     · 左下固定摇杆：把手指位移换算成"推程 → 死区 → 加速曲线"，
       再以合成 PointerEvent（pointerType=touch）喂给主文件已有的
       "左半屏摇杆"逻辑，因此角色的加减速、撞墙滑动全部沿用原手感；
     · 右下技能键：把按钮按下翻译成合成 KeyboardEvent，
       让主文件的 J / Shift / Q / K / E / F 等真实入口被触发；
     · 长按看说明：把只能 hover 的 .tal-tip 与 title 属性改成"按住 380ms 显示"；
     · 视口与手势安全：注入 viewport、touch-action、安全区与手势拦截。
   ============================================================ */
(function () {
  'use strict';

  /* ============================================================
     一、配置区（需要调手感 / 调大小就只改这里）
     ============================================================ */
  const CONFIG = {
    /** 摇杆死区：推程比例小于它不产生移动（0.08 = 防拇指微抖） */
    stickDeadZone: 0.08,
    /** 满推阈值：推程比例到它即全速（0.86 = 拇指不必推到边） */
    stickFullPush: 0.86,
    /** 加速曲线：t^1.15，越小越跟手、越大越线性 */
    stickCurve: 1.15,
    /** 普攻按钮长按连发的间隔（毫秒）；单发由游戏冷却自行限制 */
    repeatMs: 110,
    /** 长按显示说明所需的按住时长（毫秒） */
    longPressMs: 380,
    /** 长按后松开，说明保留多久（毫秒） */
    tipLingerMs: 1600,
    /** 地图双指捏合每一步的缩放比例（主文件每格 12%） */
    pinchStep: 0.12,
    /** 摇杆热区外扩：底盘之外再给 12px 容错，拇指按偏也能移动 */
    stickHotZone: 12,
    /** 重开按钮需要按住多久才真正重开（毫秒，防误触丢进度） */
    restartHoldMs: 800,
    /** 触屏上隐藏主文件左下/右侧的码头按钮（由本层提供同等入口） */
    hideDocks: true,
    /** 窄屏（宽 ≤900 或高 ≤500）隐藏右侧小地图，给技能键让位；全屏地图仍可开 */
    hideMinimapNarrow: true,
    /** 注入更严格的 viewport（禁止双指缩放页面） */
    lockViewport: true
  };

  /* ============================================================
     二、URL 开关与运行状态
     ============================================================ */
  const params = new URLSearchParams(window.location.search || '');
  const MODE = String(params.get('touch') || '').toLowerCase();
  const RT = {
    /** 是否已启动（?touch=off 或纯桌面环境为 false） */
    enabled: false,
    /** 启动原因：query-on / coarse / points / off */
    reason: '',
    /** 摇杆运行时状态 */
    stick: {
      id: null,          // 当前负责移动的真实 pointerId
      synId: 9101,       // 发给主文件 Canvas 的合成 pointerId
      active: false,
      baseX: 0,
      baseY: 0,
      lastX: 0,
      lastY: 0,
      push: 0,
      strength: 0,
      dirX: 0,
      dirY: 0,
      /** 按下时缓存的底盘几何，避免每帧 pointermove 触发重排 */
      rectCache: null
    },
    /** 当前按住的动作按钮（用于页面隐藏时统一释放） */
    held: new Set(),
    /** 统计（验收脚本直接读取） */
    stats: {
      downs: 0,
      moves: 0,
      ups: 0,
      keydowns: 0,
      keyups: 0,
      longPress: 0,
      pinches: 0,
      /** 长按后吞掉的 click 次数：避免"看说明"被当成"购买/选卡" */
      clickSwallowed: 0,
      /** 重开按钮的短按取消次数与真正触发次数 */
      restartSkipped: 0,
      restartFired: 0
    },
    /** 最近一次合成键盘事件，便于测试取证 */
    lastKey: null
  };

  /* 指向本层 DOM 与样式，boot 时填充 */
  let layerEl = null;
  let stickEl = null;
  let knobEl = null;
  let tipEl = null;

  /* 游戏侧触屏配置缓存（来自主文件 __roamDebug.touch.info().config） */
  let gameCfgCache = null;
  let gameCfgAt = 0;

  /* ============================================================
     三、通用小工具
     ============================================================ */

  /**
   * 读取主文件当前的触屏参数（带 1 秒缓存，避免每帧调用调试口）
   * @returns {Object|null} { deadZone, fullPush, moveCurve, maxRadius }
   */
  function readGameTouchCfg() {
    const now = performance.now();
    if (gameCfgCache && now - gameCfgAt < 1000) return gameCfgCache;
    try {
      const dbg = window.__roamDebug;
      if (dbg && dbg.touch && typeof dbg.touch.info === 'function') {
        const info = dbg.touch.info();
        if (info && info.config) {
          gameCfgCache = info.config;
          gameCfgAt = now;
          return gameCfgCache;
        }
      }
    } catch (err) {
      /* 主文件还没初始化完时静默降级 */
    }
    return null;
  }

  /**
   * 把"推程比例"换算成"移动强度"：死区归零，死区到满推之间按曲线重映射
   * @param {number} push 推程比例 0–1
   * @returns {number} 移动强度 0–1
   */
  function strengthFromPush(push) {
    const dz = CONFIG.stickDeadZone;
    const fp = Math.max(dz + 0.02, CONFIG.stickFullPush);
    const p = Math.max(0, Math.min(1, Number(push) || 0));
    if (p <= dz) return 0;
    const t = Math.min(1, (p - dz) / (fp - dz));
    return Math.pow(t, Math.max(0.4, CONFIG.stickCurve));
  }

  /**
   * 反解主文件曲线：把目标强度 s 换算成主文件需要的原始推程比例 p
   * ------------------------------------------------------------
   * 主文件内部会再算一次 ((p-dz)/(fp-dz))^curve；这里先取反函数，
   * 避免"我们一条曲线 + 主文件一条曲线"叠成双重加速。
   * @param {number} strength 目标移动强度 0–1
   * @returns {number} 原始推程比例 0–1
   */
  function invertGameCurve(strength) {
    if (strength <= 0) return 0;
    const g = readGameTouchCfg();
    if (!g) return Math.min(1, strength);
    const dz = Number(g.deadZone) || CONFIG.stickDeadZone;
    const fp = Math.max(dz + 0.02, Number(g.fullPush) || CONFIG.stickFullPush);
    const mc = Math.max(0.4, Number(g.moveCurve) || CONFIG.stickCurve);
    return Math.min(1, dz + (fp - dz) * Math.pow(strength, 1 / mc));
  }

  /**
   * 向游戏 Canvas 派发合成指针事件（pointerType=touch，主文件才会接管）
   * @param {string} type pointerdown / pointermove / pointerup
   * @param {number} id 合成 pointerId
   * @param {number} x 画布内横坐标（CSS 像素）
   * @param {number} y 画布内纵坐标（CSS 像素）
   * @returns {void}
   */
  function sendCanvasPointer(type, id, x, y) {
    const canvas = document.getElementById('game');
    if (!canvas || typeof window.PointerEvent !== 'function') return;
    const ev = new window.PointerEvent(type, {
      pointerId: id,
      pointerType: 'touch',
      isPrimary: true,
      clientX: x,
      clientY: y,
      button: type === 'pointerdown' ? 0 : -1,
      buttons: type === 'pointerup' ? 0 : 1,
      bubbles: true,
      cancelable: true
    });
    canvas.dispatchEvent(ev);
  }

  /**
   * 派发合成键盘事件，复用主文件真实按键入口
   * @param {KeyboardEvent} type 'keydown' / 'keyup'
   * @param {{key:string, code:string}} spec 键位描述
   * @returns {void}
   */
  function sendKey(type, spec) {
    if (!spec) return;
    const ev = new window.KeyboardEvent(type, {
      key: spec.key,
      code: spec.code,
      bubbles: true,
      cancelable: true
    });
    window.dispatchEvent(ev);
    RT.stats[type === 'keydown' ? 'keydowns' : 'keyups'] += 1;
    RT.lastKey = { type: type, key: spec.key, at: Math.round(performance.now()) };
  }

  /**
   * 生成一个带中文说明的按钮节点（不使用任何 emoji / 外部字体）
   * @param {string} label 主标签
   * @param {string} hint 键位提示
   * @param {string} cls 额外类名
   * @returns {HTMLButtonElement} 按钮节点
   */
  function makeButton(label, hint, cls) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tg-btn' + (cls ? ' ' + cls : '');
    btn.setAttribute('aria-label', label + '（' + hint + '）');
    const b = document.createElement('b');
    b.textContent = label;
    const i = document.createElement('i');
    i.textContent = hint;
    btn.appendChild(b);
    btn.appendChild(i);
    return btn;
  }

  /* ============================================================
     四、样式注入
     ============================================================ */

  /**
   * 注入整层样式：摇杆、按钮、长按说明、手势安全
   * @returns {HTMLStyleElement} 样式节点
   */
  function injectStyles() {
    const style = document.createElement('style');
    style.id = 'tg-touch-style';
    style.textContent = [
      /* ---------- 全局手势安全 ---------- */
      'html, body { overscroll-behavior: none; }',
      'body.tg-touch { -webkit-touch-callout: none; }',
      'body.tg-touch #game, body.tg-touch #mapCanvas { touch-action: none; }',
      'body.tg-touch button, body.tg-touch .mini-card, body.tg-touch .reward-card,',
      'body.tg-touch .tal-card { touch-action: manipulation; -webkit-user-select: none; user-select: none; }',
      'body.tg-touch input, body.tg-touch textarea { -webkit-user-select: text; user-select: text; touch-action: auto; }',
      /* 窄屏首次提示条：主文件的 span 会被 flex 压成逐字竖排，这里允许整段换行 */
      'body.tg-touch .intro-hint { max-width: calc(100vw - 20px); flex-wrap: wrap; row-gap: 2px; }',
      'body.tg-touch .intro-hint span { flex: 1 1 150px; min-width: 150px; white-space: normal; }',
      /* 390px 竖屏：顶部 HUD 原本会溢出右边缘（技能树按钮点不到），这里压缩到一行 */
      '@media (max-width: 560px) {',
      '  body.tg-touch .hud-top { gap: 8px; padding: 8px 9px 10px; }',
      '  body.tg-touch .brand { min-width: 0; }',
      '  body.tg-touch .brand .sub { display: none; }',
      '  body.tg-touch .hud-readouts { gap: 8px; }',
      '  body.tg-touch .hud-readouts .bar-group { width: 108px; }',
      '  body.tg-touch .hud-record { display: none; }',
      '  body.tg-touch .hud-actions { gap: 5px; }',
      '  body.tg-touch .hud-actions .btn { padding: 6px; gap: 0; }',
      '  body.tg-touch .hud-actions .btn span, body.tg-touch .hud-actions .btn kbd { display: none; }',
      '  body.tg-touch .hud-actions .btn svg { width: 15px; height: 15px; }',
      '}',
      /* 情境提示条原本贴在卡组上沿，正好压住触屏操作区：由 layout 算出上移量 */
      'body.tg-touch #contextHint { transform: translateY(calc(-1 * var(--tg-lift, 0px))); }',
      /* 五层目标卡默认贴在右侧中部，会压住触屏操作区：窄屏挪到左上角 */
      'body.tg-touch #onboardHint { left: 12px; right: auto; top: 168px; transform: none; max-width: 180px; font-size: 11px; padding: 6px 9px; }',
      '@media (orientation: landscape) and (max-height: 460px) {',
      '  body.tg-touch #onboardHint { top: 62px; max-width: 168px; }',
      '}',
      /* 码头按钮会与固定摇杆/技能键重叠，触屏由本层提供同等入口 */
      CONFIG.hideDocks ? 'body.tg-touch #btnMapDock, body.tg-touch #btnSkillDock { display: none !important; }' : '',
      /* 顶部设置/重开与右下系统键重复，隐藏后由本层统一提供，避免矮横屏上下重叠 */
      CONFIG.hideDocks ? 'body.tg-touch #btnSettings, body.tg-touch #btnRestart { display: none !important; }' : '',
      /* 窄屏隐藏右侧小地图：右下角要留给技能键，全屏地图仍可用「地图」键打开 */
      CONFIG.hideMinimapNarrow
        ? '@media (max-width: 900px), (max-height: 500px) { body.tg-touch .minimap-panel { display: none !important; } }'
        : '',

      /* ---------- 整层容器 ---------- */
      '.tg-layer {',
      '  position: fixed; inset: 0; z-index: 32; pointer-events: none;',
      '  font-family: "PingFang SC", "Microsoft YaHei", sans-serif;',
      '  --tg-stick: 144px; --tg-knob: 54px; --tg-btn: 78px; --tg-primary: 104px;',
      '  --tg-gap: 10px; --tg-sys: 48px; --tg-bottom: 92px; --tg-pad-right: 12px;',
      '  --tg-hot: 12px;',
      '  touch-action: none; -webkit-user-select: none; user-select: none;',
      '}',
      '.tg-layer.tg-hidden { display: none; }',

      /* ---------- 左下固定摇杆 ---------- */
      '.tg-stick {',
      '  position: absolute; pointer-events: auto; touch-action: none;',
      '  left: calc(14px + env(safe-area-inset-left));',
      '  bottom: calc(var(--tg-bottom) + env(safe-area-inset-bottom));',
      '  width: var(--tg-stick); height: var(--tg-stick);',
      '}',
      /* 透明热区：视觉仍是 126–144px 底盘，但手指按偏 12px 也能抓住摇杆 */
      '.tg-stick::before {',
      '  content: ""; position: absolute; inset: calc(-1 * var(--tg-hot)); border-radius: 50%;',
      '}',
      '.tg-stick-ring {',
      '  position: absolute; inset: 0; border-radius: 50%;',
      '  border: 1.5px solid rgba(62, 230, 255, 0.42);',
      '  background: radial-gradient(circle at 50% 45%, rgba(10, 26, 40, 0.62), rgba(6, 14, 24, 0.30) 72%);',
      '  box-shadow: inset 0 0 18px rgba(62, 230, 255, 0.10), 0 6px 18px rgba(0, 0, 0, 0.38);',
      '}',
      '.tg-stick-ring::after {',
      '  content: ""; position: absolute; inset: 18%; border-radius: 50%;',
      '  border: 1px dashed rgba(143, 233, 255, 0.22);',
      '}',
      '.tg-stick-knob {',
      '  position: absolute; left: 50%; top: 50%; width: var(--tg-knob); height: var(--tg-knob);',
      '  margin: calc(var(--tg-knob) / -2) 0 0 calc(var(--tg-knob) / -2); border-radius: 50%;',
      '  background: radial-gradient(circle at 36% 32%, #e2f8ff, rgba(62, 230, 255, 0.62) 72%);',
      '  border: 1.5px solid rgba(226, 248, 255, 0.88);',
      '  box-shadow: 0 0 14px rgba(62, 230, 255, 0.34);',
      '  will-change: transform; pointer-events: none;',
      '}',

      /* ---------- 右下操作区 ---------- */
      '.tg-pad {',
      '  position: absolute; display: flex; flex-direction: column; align-items: flex-end; gap: 8px;',
      '  right: calc(var(--tg-pad-right) + env(safe-area-inset-right));',
      '  bottom: calc(var(--tg-bottom) + env(safe-area-inset-bottom));',
      '  pointer-events: none; touch-action: none;',
      '}',
      '.tg-system { display: flex; gap: 6px; pointer-events: auto; }',
      '.tg-system .tg-btn {',
      '  width: var(--tg-sys); height: calc(var(--tg-sys) * 0.86); min-height: 36px; border-radius: 10px;',
      '}',
      '.tg-system .tg-btn b { font-size: 11px; }',
      '.tg-system .tg-btn i { font-size: 8px; }',
      '.tg-grid {',
      '  display: grid; pointer-events: none; touch-action: none;',
      '  grid-template-columns: var(--tg-btn) var(--tg-btn) var(--tg-primary);',
      '  grid-template-rows: var(--tg-btn) var(--tg-btn);',
      '  gap: var(--tg-gap);',
      '}',
      '.tg-btn {',
      '  pointer-events: auto; touch-action: none; display: flex; flex-direction: column;',
      '  align-items: center; justify-content: center; gap: 1px; padding: 0;',
      '  border-radius: 14px; border: 1px solid rgba(96, 190, 235, 0.46);',
      '  background: linear-gradient(180deg, rgba(20, 40, 58, 0.86), rgba(7, 14, 24, 0.90));',
      '  color: #cfefff; font-family: inherit; cursor: pointer;',
      '  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.42), inset 0 0 10px rgba(62, 230, 255, 0.10);',
      '  transition: transform 0.08s ease, border-color 0.08s ease, box-shadow 0.08s ease;',
      '}',
      '.tg-btn b { font-size: 13px; font-weight: 600; letter-spacing: 0.04em; }',
      '.tg-btn i { font-style: normal; font-size: 9px; color: #8fe4ff; opacity: 0.86; }',
      '.tg-btn.is-pressed {',
      '  transform: scale(0.94); border-color: rgba(143, 233, 255, 0.92);',
      '  background: linear-gradient(180deg, rgba(32, 66, 92, 0.92), rgba(12, 26, 40, 0.94));',
      '  box-shadow: 0 0 18px rgba(62, 230, 255, 0.34), inset 0 0 14px rgba(62, 230, 255, 0.20);',
      '}',
      '.tg-grid .tg-btn--primary {',
      '  grid-column: 3; grid-row: 2; width: var(--tg-primary); border-radius: 18px;',
      '  border-color: rgba(255, 209, 102, 0.48);',
      '  background: linear-gradient(180deg, rgba(58, 44, 16, 0.86), rgba(22, 15, 6, 0.92));',
      '}',
      '.tg-grid .tg-btn--primary b { font-size: 17px; color: #ffe2a2; }',
      '.tg-grid .tg-btn--primary i { color: #ffc247; }',
      '.tg-grid .tg-btn--primary.is-pressed { border-color: rgba(255, 209, 102, 0.95); box-shadow: 0 0 20px rgba(255, 196, 71, 0.34); }',

      /* ---------- 长按说明 ---------- */
      '.tal-card.tg-tip-on .tal-tip { opacity: 1; visibility: visible; }',
      '.tg-tip {',
      '  position: fixed; z-index: 33; max-width: 240px; padding: 7px 9px;',
      '  border-radius: 8px; border: 1px solid rgba(143, 233, 255, 0.55);',
      '  background: rgba(6, 16, 26, 0.96); color: #dff4ff; font-size: 11px; line-height: 1.5;',
      '  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.5); pointer-events: none; display: none;',
      '}',

      /* ---------- 尺寸档位：竖屏 / 矮横屏 / 大屏 ---------- */
      '@media (orientation: portrait) and (max-width: 560px) {',
      '  .tg-layer { --tg-stick: 126px; --tg-knob: 48px; --tg-btn: 64px; --tg-primary: 88px; --tg-gap: 8px; --tg-sys: 42px; }',
      '}',
      '@media (orientation: landscape) and (max-height: 460px) {',
      '  .tg-layer { --tg-stick: 132px; --tg-knob: 50px; --tg-btn: 60px; --tg-primary: 84px; --tg-gap: 8px; --tg-sys: 44px; }',
      '  .tg-system .tg-btn { width: var(--tg-sys); height: 34px; min-height: 0; }',
      /* 390px 高的横屏：卡组占掉一半屏幕，视觉缩到 62%（底部对齐）让出操作区 */
      '  body.tg-touch .hud-deck { transform: scale(0.62); transform-origin: bottom center; }',
      /* 矮横屏没有纵向余量：提示条固定在"首屏提示与卡组之间"的空白带，避免上移后撞首屏提示 */
      '  body.tg-touch #contextHint { top: 42vh; bottom: auto; left: 50%; right: auto; transform: translateX(-50%); max-width: 46vw; }',
      /* 首屏提示的第二行在矮横屏会把标题撑成两行、压到装置键，只保留主句 */
      '  body.tg-touch #introHintSub { display: none; }',
      '}'
    ].join('\n');
    document.head.appendChild(style);
    return style;
  }

  /**
   * 注入 / 强更 viewport：禁止页面被双指缩放，并启用刘海安全区
   * ------------------------------------------------------------
   * 只改 meta 的 content 属性，不改主文件源码；刷新后同样生效。
   * @returns {void}
   */
  function injectViewport() {
    if (!CONFIG.lockViewport) return;
    let meta = document.querySelector('meta[name="viewport"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'viewport';
      document.head.appendChild(meta);
    }
    meta.setAttribute('content',
      'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover');
  }

  /* ============================================================
     五、DOM 构建
     ============================================================ */

  /**
   * 构建整层 DOM（摇杆 + 系统键 + 动作键 + 长按浮层）
   * @returns {void}
   */
  function buildDom() {
    layerEl = document.createElement('div');
    layerEl.className = 'tg-layer tg-hidden';
    layerEl.id = 'tgTouchLayer';

    /* 左下固定摇杆 */
    stickEl = document.createElement('div');
    stickEl.className = 'tg-stick';
    stickEl.setAttribute('role', 'button');
    stickEl.setAttribute('aria-label', '移动摇杆');
    const ring = document.createElement('div');
    ring.className = 'tg-stick-ring';
    knobEl = document.createElement('div');
    knobEl.className = 'tg-stick-knob';
    stickEl.appendChild(ring);
    stickEl.appendChild(knobEl);

    /* 右下操作区 */
    const pad = document.createElement('div');
    pad.className = 'tg-pad';

    /* 系统键：替代被隐藏的码头/顶部按钮，保留地图、图鉴、设置、重开入口 */
    const system = document.createElement('div');
    system.className = 'tg-system';
    const sysDefs = [
      { label: '地图', hint: '全屏', spec: { key: 'm', code: 'KeyM' } },
      { label: '图鉴', hint: '查看', spec: { key: 'g', code: 'KeyG' } },
      { label: '设置', hint: '调整', spec: { key: 'o', code: 'KeyO' } },
      /* 重开会让当前局立刻作废：触屏改成按住 0.8 秒才生效，防手滑 */
      { label: '重开', hint: '长按', spec: { key: 'r', code: 'KeyR' }, confirm: true }
    ];
    sysDefs.forEach((def) => {
      const btn = makeButton(def.label, def.hint);
      if (def.confirm) bindHoldConfirm(btn, def.spec);
      else bindTapKey(btn, def.spec);
      system.appendChild(btn);
    });

    /* 动作键：上排 装置 / 武器 / 闪避；下排 融合 / 交互 / 普攻 */
    const grid = document.createElement('div');
    grid.className = 'tg-grid';
    const actDefs = [
      { label: '装置', hint: '召唤', spec: { key: 'k', code: 'KeyK' } },
      { label: '武器', hint: '长按', spec: { key: 'q', code: 'KeyQ' }, hold: true },
      { label: '闪避', hint: '冲刺', spec: { key: 'Shift', code: 'ShiftLeft' }, tap: true },
      { label: '融合', hint: '合成', spec: { key: 'f', code: 'KeyF' } },
      { label: '交互', hint: '拾取', spec: { key: 'e', code: 'KeyE' } },
      { label: '普攻', hint: '按住连发', spec: { key: 'j', code: 'KeyJ' }, primary: true, repeat: true }
    ];
    actDefs.forEach((def) => {
      const btn = makeButton(def.label, def.hint, def.primary ? 'tg-btn--primary' : '');
      if (def.repeat) {
        bindRepeatKey(btn, def.spec);
      } else if (def.hold) {
        bindHoldKey(btn, def.spec);
      } else {
        bindTapKey(btn, def.spec);
      }
      grid.appendChild(btn);
    });

    pad.appendChild(system);
    pad.appendChild(grid);
    layerEl.appendChild(stickEl);
    layerEl.appendChild(pad);

    /* 长按 title 属性的浮层（融合标识等） */
    tipEl = document.createElement('div');
    tipEl.className = 'tg-tip';
    layerEl.appendChild(tipEl);

    document.body.appendChild(layerEl);
    document.body.classList.add('tg-touch');
  }

  /* ============================================================
     六、摇杆交互
     ============================================================ */

  /**
   * 更新旋钮位置与摇杆状态，并把强度翻译给游戏 Canvas
   * @param {number} clientX 手指横坐标
   * @param {number} clientY 手指纵坐标
   * @returns {void}
   */
  function updateStick(clientX, clientY) {
    const st = RT.stick;
    if (st.id === null) return;
    /* 几何在按下时缓存：pointermove 里不再读取 DOM，避免每帧强制重排 */
    const rect = st.rectCache || stickEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const knobR = Number(rect.knobR) || knobEl.getBoundingClientRect().width / 2;
    const maxR = Math.max(18, rect.width / 2 - knobR - 2);

    const dx = clientX - cx;
    const dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    const push = maxR > 0 ? Math.min(1, dist / maxR) : 0;
    const strength = strengthFromPush(push);

    let dirX = 0;
    let dirY = 0;
    if (dist > 0.0001) {
      dirX = dx / dist;
      dirY = dy / dist;
    }

    /* 旋钮视觉：死区内不动，死区外最多推到 maxR */
    const visualDist = Math.min(maxR, dist) * (push <= CONFIG.stickDeadZone ? 0 : 1);
    knobEl.style.transform = 'translate3d(' + (dirX * visualDist).toFixed(2) + 'px, '
      + (dirY * visualDist).toFixed(2) + 'px, 0)';

    /* 给游戏的合成推程：反解主文件曲线，让最终强度正好等于 strength */
    const rawPush = invertGameCurve(strength);
    const g = readGameTouchCfg();
    const gameMax = Math.max(20, Number(g && g.maxRadius) || 72);
    const gameDist = rawPush * gameMax;
    const gameX = cx + dirX * gameDist;
    const gameY = cy + dirY * gameDist;

    st.push = push;
    st.strength = strength;
    st.dirX = dirX;
    st.dirY = dirY;
    st.lastX = gameX;
    st.lastY = gameY;
    RT.stats.moves += 1;

    sendCanvasPointer('pointermove', st.synId, gameX, gameY);
  }

  /**
   * 摇杆按下：只认第一根手指，其余手指忽略（多指不互相干扰）
   * @param {PointerEvent} event 指针事件
   * @returns {void}
   */
  function onStickDown(event) {
    if (event.pointerType === 'mouse') return;
    event.preventDefault();
    event.stopPropagation();
    if (RT.stick.id !== null) return; // 已有手指在控制移动
    const rect = stickEl.getBoundingClientRect();
    if (rect.width <= 0) return;

    RT.stick.id = event.pointerId;
    RT.stick.active = true;
    RT.stick.rectCache = {
      left: rect.left, top: rect.top, width: rect.width, height: rect.height,
      knobR: knobEl.getBoundingClientRect().width / 2
    };
    RT.stick.baseX = rect.left + rect.width / 2;
    RT.stick.baseY = rect.top + rect.height / 2;
    RT.stick.lastX = RT.stick.baseX;
    RT.stick.lastY = RT.stick.baseY;
    RT.stats.downs += 1;

    sendCanvasPointer('pointerdown', RT.stick.synId, RT.stick.baseX, RT.stick.baseY);
    try { stickEl.setPointerCapture(event.pointerId); } catch (err) { /* 合成事件没有捕获权 */ }
    updateStick(event.clientX, event.clientY);
  }

  /**
   * 摇杆拖动：手指可能移出底盘，document 级监听保证仍然跟手
   * @param {PointerEvent} event 指针事件
   * @returns {void}
   */
  function onStickMove(event) {
    if (event.pointerId !== RT.stick.id) return;
    event.preventDefault();
    updateStick(event.clientX, event.clientY);
  }

  /**
   * 摇杆抬起：清空输入并让主文件松开摇杆，避免"手指走了角色还在走"
   * @returns {void}
   */
  function onStickUp() {
    if (RT.stick.id === null) return;
    const x = RT.stick.lastX;
    const y = RT.stick.lastY;
    sendCanvasPointer('pointerup', RT.stick.synId, x, y);
    RT.stick.id = null;
    RT.stick.active = false;
    RT.stick.push = 0;
    RT.stick.strength = 0;
    RT.stick.dirX = 0;
    RT.stick.dirY = 0;
    RT.stats.ups += 1;
    knobEl.style.transform = 'translate3d(0px, 0px, 0)';
  }

  /* ============================================================
     七、按钮交互
     ============================================================ */

  /**
   * 一次性按键：按下即触发，抬起补 keyup（闪避 / 装置 / 交互 / 融合 / 系统键）
   * @param {HTMLElement} btn 按钮
   * @param {{key:string, code:string}} spec 键位
   * @returns {void}
   */
  function bindTapKey(btn, spec) {
    let pid = null;
    btn.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse') return;
      event.preventDefault();
      event.stopPropagation();
      if (pid !== null) return;
      pid = event.pointerId;
      btn.classList.add('is-pressed');
      RT.held.add(btn);
      sendKey('keydown', spec);
      try { btn.setPointerCapture(event.pointerId); } catch (err) { /* 合成事件 */ }
    });
    const release = (event) => {
      if (pid === null || (event && event.pointerId !== pid)) return;
      pid = null;
      btn.classList.remove('is-pressed');
      RT.held.delete(btn);
      sendKey('keyup', spec);
    };
    /* 供 resetInputs 统一释放：切面板/切后台时能停掉连发与长按计时 */
    btn.__tgRelease = release;
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
  }

  /**
   * 按住型按键：按下 keydown、松开 keyup（武器 Q 由主文件自动连发）
   * @param {HTMLElement} btn 按钮
   * @param {{key:string, code:string}} spec 键位
   * @returns {void}
   */
  function bindHoldKey(btn, spec) {
    let pid = null;
    btn.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse') return;
      event.preventDefault();
      event.stopPropagation();
      if (pid !== null) return;
      pid = event.pointerId;
      btn.classList.add('is-pressed');
      RT.held.add(btn);
      sendKey('keydown', spec);
      try { btn.setPointerCapture(event.pointerId); } catch (err) { /* 合成事件 */ }
    });
    const release = (event) => {
      if (pid === null || (event && event.pointerId !== pid)) return;
      pid = null;
      btn.classList.remove('is-pressed');
      RT.held.delete(btn);
      sendKey('keyup', spec);
    };
    /* 供 resetInputs 统一释放：切面板/切后台时能停掉连发与长按计时 */
    btn.__tgRelease = release;
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
  }

  /**
   * 连发型按键：按住后按 repeatMs 周期补发 keydown（普攻）
   * @param {HTMLElement} btn 按钮
   * @param {{key:string, code:string}} spec 键位
   * @returns {void}
   */
  function bindRepeatKey(btn, spec) {
    let pid = null;
    let timer = 0;
    btn.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse') return;
      event.preventDefault();
      event.stopPropagation();
      if (pid !== null) return;
      pid = event.pointerId;
      btn.classList.add('is-pressed');
      RT.held.add(btn);
      sendKey('keydown', spec);
      timer = window.setInterval(() => sendKey('keydown', spec), CONFIG.repeatMs);
      try { btn.setPointerCapture(event.pointerId); } catch (err) { /* 合成事件 */ }
    });
    const release = (event) => {
      if (pid === null || (event && event.pointerId !== pid)) return;
      pid = null;
      btn.classList.remove('is-pressed');
      RT.held.delete(btn);
      if (timer) window.clearInterval(timer);
      timer = 0;
      sendKey('keyup', spec);
    };
    /* 供 resetInputs 统一释放：切面板/切后台时能停掉连发与长按计时 */
    btn.__tgRelease = release;
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
  }

  /**
   * 长按确认型按键：按住 restartHoldMs 才真正派发 keydown（重开防误触）
   * 短按只提示"继续按住"，不向游戏发 R。
   * @param {HTMLElement} btn 按钮
   * @param {{key:string, code:string}} spec 键位
   * @returns {void}
   */
  function bindHoldConfirm(btn, spec) {
    let pid = null;
    let timer = 0;
    let fired = false;
    const release = (event) => {
      if (pid === null || (event && event.pointerId !== pid)) return;
      const didFire = fired;
      pid = null;
      fired = false;
      if (timer) window.clearTimeout(timer);
      timer = 0;
      btn.classList.remove('is-pressed');
      RT.held.delete(btn);
      hideTitleTip();
      if (didFire) sendKey('keyup', spec);
      else RT.stats.restartSkipped += 1;
    };
    btn.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse') return;
      event.preventDefault();
      event.stopPropagation();
      if (pid !== null) return;
      pid = event.pointerId;
      fired = false;
      btn.classList.add('is-pressed');
      RT.held.add(btn);
      const r = btn.getBoundingClientRect();
      showTitleTip('继续按住 0.8 秒重开本局', r.left + r.width / 2, r.top);
      timer = window.setTimeout(() => {
        timer = 0;
        fired = true;
        RT.stats.restartFired += 1;
        hideTitleTip();
        sendKey('keydown', spec);
      }, CONFIG.restartHoldMs);
      try { btn.setPointerCapture(event.pointerId); } catch (err) { /* 合成事件 */ }
    });
    /* 供 resetInputs 统一释放：切面板/切后台时能停掉连发与长按计时 */
    btn.__tgRelease = release;
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
  }

  /* ============================================================
     八、长按显示说明（把 hover 改成按住）
     ============================================================ */
  /**
   * 在指定位置显示一条短说明（用于融合标识的 title 属性）
   * @param {string} text 说明文字
   * @param {number} clientX 参照点横坐标
   * @param {number} clientY 参照点纵坐标
   * @returns {void}
   */
  function showTitleTip(text, clientX, clientY) {
    if (!tipEl || !text) return;
    tipEl.textContent = text;
    tipEl.style.display = 'block';
    const w = tipEl.offsetWidth || 160;
    const h = tipEl.offsetHeight || 30;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, clientX - w / 2));
    const top = Math.max(8, clientY - h - 12);
    tipEl.style.left = Math.round(left) + 'px';
    tipEl.style.top = Math.round(top) + 'px';
  }

  /**
   * 隐藏 title 浮层
   * @returns {void}
   */
  function hideTitleTip() {
    if (tipEl) tipEl.style.display = 'none';
  }

  /**
   * 安装长按逻辑：
   *   1) 永久天赋卡 .tal-card → 高亮 .tal-tip（桌面只能 hover）；
   *   2) 融合标识 i[title] → 用本层浮层显示名字；
   *   3) 手指移动超过 14px 视为滚动/拖动，取消长按。
   * @returns {void}
   */
  function installLongPress() {
    let timer = 0;
    let mode = '';
    let target = null;
    let startX = 0;
    let startY = 0;
    let shown = false;
    let lingerTimer = 0;
    /* 长按看说明后，浏览器还会补一个 click；置位后吞掉它，避免误买/误选 */
    let swallowClick = false;

    /**
     * 清理所有长按状态与高亮
     * @param {boolean} keepShown 是否保留已显示的说明
     * @returns {void}
     */
    const clear = (keepShown) => {
      if (timer) window.clearTimeout(timer);
      timer = 0;
      if (target && mode === 'tal') target.classList.remove('tg-tip-on');
      if (!keepShown) hideTitleTip();
      if (!keepShown) shown = false;
    };

    document.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse') return;
      if (!event.target || !event.target.closest) return;
      const card = event.target.closest('.tal-card');
      const pip = event.target.closest('#hudFusion i[title]');
      if (!card && !pip) {
        /* 触屏没有"移开鼠标"这回事：点空白要立刻收起说明 */
        const openCard = document.querySelector('.tal-card.tg-tip-on');
        if (openCard) openCard.classList.remove('tg-tip-on');
        hideTitleTip();
        shown = false;
        return;
      }
      clear(false);
      if (lingerTimer) window.clearTimeout(lingerTimer);
      mode = card ? 'tal' : 'pip';
      target = card || pip;
      startX = event.clientX;
      startY = event.clientY;
      timer = window.setTimeout(() => {
        timer = 0;
        if (mode === 'tal' && target) {
          target.classList.add('tg-tip-on');
          shown = true;
          swallowClick = true;
          RT.stats.longPress += 1;
        } else if (mode === 'pip' && target) {
          showTitleTip(target.getAttribute('title'), startX, startY);
          shown = true;
          swallowClick = true;
          RT.stats.longPress += 1;
        }
      }, CONFIG.longPressMs);
    }, true);

    document.addEventListener('pointermove', (event) => {
      if (event.pointerType === 'mouse' || !mode) return;
      if (Math.hypot(event.clientX - startX, event.clientY - startY) > 14) clear(true);
    }, true);

    document.addEventListener('pointerup', () => {
      if (!mode) return;
      const wasShown = shown;
      if (timer) window.clearTimeout(timer);
      timer = 0;
      if (mode === 'tal' && target && wasShown) {
        /* 松开后再保留一会儿，方便阅读；下次点按会立刻换内容 */
        lingerTimer = window.setTimeout(() => {
          if (target) target.classList.remove('tg-tip-on');
          shown = false;
        }, CONFIG.tipLingerMs);
      } else {
        hideTitleTip();
        shown = false;
      }
      mode = '';
      target = null;
      /* click 紧跟 pointerup 派发；下一个宏任务再复位，避免吞掉后续正常点击 */
      window.setTimeout(() => { swallowClick = false; }, 0);
    }, true);

    document.addEventListener('pointercancel', () => {
      if (lingerTimer) window.clearTimeout(lingerTimer);
      clear(false);
      mode = '';
      target = null;
      shown = false;
      swallowClick = false;
    }, true);

    /* 捕获阶段吞掉长按后补发的 click：看说明不等于选卡/购买 */
    document.addEventListener('click', (event) => {
      if (!swallowClick) return;
      swallowClick = false;
      event.preventDefault();
      event.stopPropagation();
      RT.stats.clickSwallowed += 1;
    }, true);
  }

  /* ============================================================
     九、地图双指捏合（把 pinch 翻译成主文件的 wheel 缩放）
     ============================================================ */

  /**
   * 在 #mapCanvas 上监听双指距离变化，派发 wheel 事件实现缩放
   * @returns {void}
   */
  function installMapPinch() {
    const map = document.getElementById('mapCanvas');
    if (!map) return;
    const points = new Map();
    let lastDist = 0;
    let lastAt = 0;

    /**
     * 计算当前两指距离
     * @returns {number} 距离（px），少于两指返回 0
     */
    const distance = () => {
      const list = Array.from(points.values());
      if (list.length < 2) return 0;
      return Math.hypot(list[0].x - list[1].x, list[0].y - list[1].y);
    };

    map.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse') return;
      points.set(event.pointerId, { x: event.clientX, y: event.clientY });
      lastDist = distance();
    }, { passive: true });

    map.addEventListener('pointermove', (event) => {
      if (event.pointerType === 'mouse' || !points.has(event.pointerId)) return;
      points.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const dist = distance();
      if (!lastDist || !dist) { lastDist = dist; return; }
      const ratio = dist / lastDist;
      lastDist = dist;
      const now = performance.now();
      if (now - lastAt < 90) return;
      if (ratio > 1 + CONFIG.pinchStep) {
        lastAt = now;
        RT.stats.pinches += 1;
        map.dispatchEvent(new window.WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }));
      } else if (ratio < 1 - CONFIG.pinchStep) {
        lastAt = now;
        RT.stats.pinches += 1;
        map.dispatchEvent(new window.WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }));
      }
    }, { passive: true });

    const drop = (event) => {
      points.delete(event.pointerId);
      lastDist = distance();
    };
    map.addEventListener('pointerup', drop, { passive: true });
    map.addEventListener('pointercancel', drop, { passive: true });
  }

  /* ============================================================
     十、布局、显隐与整体复位
     ============================================================ */

  /**
   * 计算操作区底边与右边：避开底部卡组与右侧小地图，避免相互遮挡
   * @returns {void}
   */
  function layout() {
    if (!layerEl) return;
    /* 视口 / 卡组位置变了，下次按下重新量摇杆几何 */
    RT.stick.rectCache = null;

    let bottom = 14;
    const deck = document.querySelector('.hud-deck');
    const body = document.body;
    if (deck && !body.classList.contains('hud-minimal')) {
      const style = window.getComputedStyle(deck);
      const rect = deck.getBoundingClientRect();
      if (style.display !== 'none' && style.visibility !== 'hidden' && rect.height > 0) {
        bottom = Math.max(14, Math.round(window.innerHeight - rect.top + 8));
      }
    }
    layerEl.style.setProperty('--tg-bottom', bottom + 'px');

    let padRight = 12;
    const mini = document.querySelector('.minimap-panel');
    if (mini) {
      const style = window.getComputedStyle(mini);
      const rect = mini.getBoundingClientRect();
      /* 小地图只在右侧出现时才需要让位（竖屏窄屏通常 display:none） */
      if (style.display !== 'none' && rect.width > 0 && rect.left > window.innerWidth * 0.5) {
        padRight = Math.max(12, Math.round(window.innerWidth - rect.left + 10));
      }
    }
    layerEl.style.setProperty('--tg-pad-right', padRight + 'px');

    /* 情境提示条的 inline bottom 由主文件写在卡组上沿，这里整体上移避开操作区。
       系统键（地图/图鉴/设置/重开）坐落在操作区上方，提示条居中时同样会压到它，
       因此取"操作区顶"与"系统键行顶"更靠上的那个作为避让边界。 */
    const hint = document.querySelector('#contextHint');
    const pad = layerEl.querySelector('.tg-pad');
    const sys = layerEl.querySelector('.tg-system');
    let lift = 0;
    if (hint && pad && !hint.classList.contains('hidden')) {
      const bottomPx = parseFloat(hint.style.bottom);
      const rawBottom = window.innerHeight - (Number.isFinite(bottomPx) ? bottomPx : 96);
      const padTop = pad.getBoundingClientRect().top;
      const sysTop = sys ? sys.getBoundingClientRect().top : Infinity;
      lift = Math.max(0, Math.round(rawBottom + 8 - Math.min(padTop, sysTop)));
    }
    document.documentElement.style.setProperty('--tg-lift', lift + 'px');
  }

  /**
   * 统一释放所有输入：摇杆归零、按住的按钮补 keyup（切后台/隐藏操作层时调用）
   * @returns {void}
   */
  function resetInputs() {
    onStickUp();
    Array.from(RT.held).forEach((btn) => {
      /* 按钮释放函数会顺带清掉连发定时器，避免隐藏操作层后还在补发 J */
      if (typeof btn.__tgRelease === 'function') btn.__tgRelease();
      btn.classList.remove('is-pressed');
      RT.held.delete(btn);
    });
    /* 无法从按钮反查键位，直接补一轮常见 keyup，主文件对多余 keyup 是幂等的 */
    ['j', 'q', 'k', 'e', 'f', 'Shift', 'Tab', 'm', 't', 'g', 'o'].forEach((key) => {
      window.dispatchEvent(new window.KeyboardEvent('keyup', { key: key, bubbles: true, cancelable: true }));
    });
    hideTitleTip();
    document.querySelectorAll('.tal-card.tg-tip-on').forEach((card) => card.classList.remove('tg-tip-on'));
  }

  /**
   * 每次布局变化后刷新"该不该显示操作层"：
   * 标题页 / 奖励弹窗 / 全屏面板打开时隐藏，避免误触。
   * @returns {void}
   */
  function refreshVisibility() {
    if (!layerEl) return;
    const title = document.getElementById('titleLayer');
    const modal = document.getElementById('modalLayer');
    const titleVisible = title ? !title.classList.contains('hidden') : false;
    const modalVisible = modal ? !modal.classList.contains('hidden') : false;
    const panelOpen = !!document.querySelector('.rules-layer.is-open');
    const show = RT.enabled && !titleVisible && !modalVisible && !panelOpen;
    const wasHidden = layerEl.classList.contains('tg-hidden');
    layerEl.classList.toggle('tg-hidden', !show);
    if (!show && !wasHidden) resetInputs();
    if (show) layout();
  }

  /**
   * 浏览器切后台 / 失焦时，释放所有按住状态，避免回来时角色自己走
   * @returns {void}
   */
  function onBlur() {
    resetInputs();
  }

  /* ============================================================
     十一、启动
     ============================================================ */

  /**
   * 判断是否触屏设备
   * @returns {boolean} 是否有触摸能力
   */
  function isTouchDevice() {
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return true;
    if (navigator.maxTouchPoints && navigator.maxTouchPoints > 0) return true;
    return 'ontouchstart' in window;
  }

  /**
   * 启动触屏层
   * @returns {void}
   */
  function boot() {
    window.__touchLayer = window.__touchLayer || {};
    window.__touchLayer.config = CONFIG;

    if (MODE === 'off') {
      RT.reason = 'off';
      window.__touchLayer.enabled = false;
      window.__touchLayer.reason = 'off';
      return;
    }
    if (MODE !== 'on' && !isTouchDevice()) {
      RT.reason = 'desktop';
      window.__touchLayer.enabled = false;
      window.__touchLayer.reason = 'desktop';
      return;
    }

    RT.enabled = true;
    RT.reason = MODE === 'on' ? 'query-on' : 'touch-device';

    injectViewport();
    injectStyles();
    buildDom();
    layout();
    refreshVisibility();

    /* 摇杆：元素级按下 + document 级移动/抬起（移出底盘也能跟手） */
    stickEl.addEventListener('pointerdown', onStickDown, { passive: false });
    document.addEventListener('pointermove', onStickMove, { passive: false });
    document.addEventListener('pointerup', onStickUp, { passive: true });
    document.addEventListener('pointercancel', onStickUp, { passive: true });

    /* 长按说明 + 地图捏合 */
    installLongPress();
    installMapPinch();

    /* 视口 / 布局刷新 */
    let resizeRaf = 0;
    const onResize = () => {
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = 0;
        layout();
        refreshVisibility();
      });
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);

    /* 页面隐藏 / 失焦时释放输入 */
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', () => { if (document.hidden) onBlur(); });
    window.addEventListener('pagehide', onBlur);

    /* iOS Safari 手势拦截（双指缩放页面） */
    document.addEventListener('gesturestart', (event) => event.preventDefault(), { passive: false });

    /* 每 200ms 检查一次界面模式；比 MutationObserver 全树监听便宜很多 */
    window.setInterval(refreshVisibility, 200);

    /* 调试 / 验收口 */
    window.__touchLayer.enabled = true;
    window.__touchLayer.reason = RT.reason;
    window.__touchLayer.info = function () {
      const rects = {};
      const all = layerEl ? layerEl.querySelectorAll('.tg-btn') : [];
      all.forEach((btn) => {
        const r = btn.getBoundingClientRect();
        const label = btn.querySelector('b') ? btn.querySelector('b').textContent : '';
        rects[label] = { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
      });
      const stickRect = stickEl ? stickEl.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
      return {
        enabled: RT.enabled,
        reason: RT.reason,
        hidden: !!(layerEl && layerEl.classList.contains('tg-hidden')),
        config: CONFIG,
        stick: {
          active: RT.stick.active,
          id: RT.stick.id,
          push: Number(RT.stick.push.toFixed(3)),
          strength: Number(RT.stick.strength.toFixed(3)),
          dirX: Number(RT.stick.dirX.toFixed(3)),
          dirY: Number(RT.stick.dirY.toFixed(3)),
          rect: {
            x: Math.round(stickRect.left), y: Math.round(stickRect.top),
            w: Math.round(stickRect.width), h: Math.round(stickRect.height)
          }
        },
        buttons: rects,
        stats: Object.assign({}, RT.stats),
        lastKey: RT.lastKey
      };
    };
    window.__touchLayer.reset = resetInputs;
    window.__touchLayer.refresh = refreshVisibility;
  }

  /* 主文件在 body 末尾同步执行 init()；本文件被追加在它之后，DOM 已就绪 */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
