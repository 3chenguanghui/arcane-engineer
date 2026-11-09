/* ============================================================
   烬 · 触屏键帽补丁（patch-touch-keycaps.js）
   ------------------------------------------------------------
   作用：触屏态下把 F / K / Shift / WASD / 左键 等键帽与短提示
        改成"动作中文词"；键鼠态一个字符都不改。

   硬约束：
     · 不新增任何 DOM 节点（不 append / 不建 style / 不建伪装元素）；
     · 只改已有节点的文本与内联样式；
     · 不读 navigator.userAgent / platform，iPad 报 Mac 也不会误判；
     · 不改布局尺寸、不改按键行为。

   触屏判定（两段）：
     第一段·能力：maxTouchPoints > 0 或 (any-pointer: coarse)
        → false：不挂监听、不扫描、不改文本（桌面永远原样）
        → true ：允许挂监听，但文案仍是键鼠版
     第二段·事实：真的收到 touchstart / pointerdown(pointerType=touch)
        → 收到后才把文案切成触屏版，并开始观察后续动态 DOM

   接入：放在主文件 body 末尾、touch.js 之后：
     script src="patch-touch-keycaps.js"
   回滚：删除这一行脚本标签即可；或 URL 加 ?touch=off 全程关闭。
   ============================================================ */
(function () {
  'use strict';

  /* ---------- KB1 · URL 开关：?touch=off 时连监听都不挂 ---------- */
  const params = new URLSearchParams(window.location.search || '');
  const MODE = String(params.get('touch') || '').toLowerCase();

  const RT = {
    capable: false,   // 第一段：是否有触摸能力
    sawTouch: false,  // 第二段：是否真的收到过触摸事件
    active: false,    // 两段都成立后才为 true
    hits: 0           // 本补丁累计改写的文本节点/元素数（调试用）
  };

  /** 调试口：始终暴露，便于验收断言；关闭态也能读到 active=false */
  const api = { apply: function () { return applyAll(); } };
  ['capable', 'sawTouch', 'active'].forEach(function (key) {
    Object.defineProperty(api, key, {
      enumerable: true,
      get: function () { return RT[key]; }
    });
  });
  Object.defineProperty(api, 'hits', {
    enumerable: true,
    get: function () { return RT.hits; }
  });
  window.__touchKeycaps = api;

  if (MODE === 'off') return;

  /* ---------- KB2 · 第一段：能力判断（不用 UA） ---------- */
  try {
    RT.capable = (Number(navigator.maxTouchPoints) > 0)
      || (typeof window.matchMedia === 'function'
        && window.matchMedia('(any-pointer: coarse)').matches);
  } catch (e) {
    RT.capable = false;
  }

  /* ---------- KB3 · 键帽映射表（只认整段匹配） ---------- */
  const KBD_MAP = {
    'WASD': '摇杆',
    '空格 / Shift': '闪避',
    'Shift / 空格': '闪避',
    '左键 / J': '普攻',
    '右键 / K': '装置',
    '左键': '普攻',
    '右键': '装置',
    '鼠标': '拖拽',
    '1–6': '卡组',
    '1-6': '卡组',
    'J': '普攻',
    'K': '装置',
    'Q': '武器',
    'E': '交互',
    'F': '融合',
    'H': '帮助',
    'M': '地图',
    'T': '技能树',
    'G': '图鉴',
    'O': '设置',
    'N': '静音',
    'V': '调试',
    'Tab': '换相',
    'Shift': '闪避',
    '空格': '闪避',
    'Enter': '确认',
    'R': '重开',
    'Esc': '关闭',
    'C': '继续',
    'WASD / 方向键': '摇杆'
  };

  /**
   * 归一化空白（含全角空格），用于"改前原文"精确比对
   * @param {*} value 任意文本
   * @returns {string} 归一化后的文本
   */
  function norm(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  /**
   * 把单个 kbd 键帽换成中文短词，并去掉药丸外观（内联样式，不建新节点）
   * @param {HTMLElement} el kbd 节点
   * @returns {boolean} 是否发生改写
   */
  function translateKbd(el) {
    if (!el) return false;
    const from = String(el.textContent || '').trim();
    if (!from) return false;
    const to = KBD_MAP[from];
    if (!to || to === from) return false;
    /* 按钮里的键帽只是装饰：按钮文字已经说明动作，隐藏比塞进重复词更干净 */
    if (el.closest('button, .btn')) {
      if (el.style.display !== 'none') {
        el.style.display = 'none';
        el.setAttribute('data-tg-kbd', 'hide');
        RT.hits += 1;
      }
      return true;
    }
    el.textContent = to;
    /* 中文词比单字母宽，去掉边框/底色，避免在窄键帽里溢出 */
    el.style.border = '0';
    el.style.background = 'none';
    el.style.boxShadow = 'none';
    el.style.padding = '0 1px';
    el.style.minWidth = '0';
    el.style.font = 'inherit';
    el.style.color = 'inherit';
    el.setAttribute('data-tg-kbd', '1');
    RT.hits += 1;
    return true;
  }

  /**
   * KB4 · 底部卡组键位整行：只在文本与原文精确一致时替换
   * @returns {boolean} 是否发生改写
   */
  function applyDeckKeys() {
    const row = document.querySelector('.deck-keys:not(#padLegend)');
    if (!row) return false;
    const want = '摇杆移动　右下：普攻 / 装置 / 闪避 / 融合 / 交互';
    if (norm(row.textContent) === norm(want)) return false;
    const orig = norm('左键 / J 主技能 右键 / K 装置 Q 近战 E 下楼 F 融合 H 暂停');
    if (norm(row.textContent) !== orig) return false;
    row.textContent = want;
    row.setAttribute('data-tg-keycap', 'deck');
    RT.hits += 1;
    return true;
  }

  /**
   * KB5 · 融合提示（含 kbd 子节点）：只在原文精确一致时整段改写
   * @returns {boolean} 是否发生改写
   */
  function applyFusionNote() {
    const note = document.getElementById('fusionNote');
    if (!note) return false;
    const orig = norm('集齐魔法与对应科技模块后按 F 融合');
    if (norm(note.textContent) !== orig) return false;
    note.textContent = '集齐魔法与对应科技模块后点融合键融合';
    note.setAttribute('data-tg-keycap', 'fusion-note');
    RT.hits += 1;
    return true;
  }

  /**
   * KB6 · 融合条第二格：纯文本，原文精确匹配
   * @returns {boolean} 是否发生改写
   */
  function applyFusionBar() {
    const bar = document.getElementById('fusionBar');
    if (!bar) return false;
    const span = bar.querySelector('span:not(.fb-label)');
    if (!span) return false;
    const orig = norm('集齐魔法 + 对应科技后按 F 融合');
    if (norm(span.textContent) !== orig) return false;
    span.textContent = '集齐魔法 + 对应科技后点融合键融合';
    RT.hits += 1;
    return true;
  }

  /**
   * KB7 · 三个技能条标题去掉键位字母
   * @returns {boolean} 是否发生改写
   */
  function applySkillChips() {
    const chips = document.querySelectorAll('.skill-chip > span');
    const map = { '主技能 J': '主技能', '装置 K': '装置', '武器 Q': '武器' };
    let changed = false;
    Array.prototype.forEach.call(chips, function (el) {
      const from = String(el.textContent || '').trim();
      const to = map[from];
      if (!to) return;
      el.textContent = to;
      RT.hits += 1;
      changed = true;
    });
    return changed;
  }

  /**
   * KB8 · 卡组小标题里的键位说明
   * @returns {boolean} 是否发生改写
   */
  function applyDeckTitles() {
    const items = document.querySelectorAll('.deck-title i');
    const map = {
      '数字键 1–6 切换': '点卡组切换',
      '点击选中装置 · K 触发': '点击选中装置 · 点装置键触发'
    };
    let changed = false;
    Array.prototype.forEach.call(items, function (el) {
      const from = String(el.textContent || '').trim();
      const to = map[from];
      if (!to) return;
      el.textContent = to;
      RT.hits += 1;
      changed = true;
    });
    return changed;
  }

  /**
   * KB9 · 顶部首次提示：提到 M / T 的地方换成人话
   * @returns {boolean} 是否发生改写
   */
  function applyIntroHint() {
    const title = document.getElementById('introHintText');
    if (title) {
      const orig = '按 M 看全屏地图 · 按 T 看技能树';
      if (String(title.textContent || '').trim() === orig) {
        title.textContent = '点地图键看全屏地图 · 点技能树键看天赋';
        RT.hits += 1;
      }
    }
    const sub = document.getElementById('introHintSub');
    if (sub) {
      const orig2 = '左下「地图」与右侧「技能树」按钮随时可点';
      if (String(sub.textContent || '').trim() === orig2) {
        sub.textContent = '右下「地图」与「图鉴」按钮随时可点';
        RT.hits += 1;
      }
    }
    return true;
  }

  /**
   * KB10 · 去掉数字角标与单字母角标（无数字键 / 字母键后它们只会暴露桌面键位）
   * @returns {boolean} 是否发生改写
   */
  function applySlotBadges() {
    const marks = document.querySelectorAll('.m-key');
    Array.prototype.forEach.call(marks, function (el) {
      if (el.style.display !== 'none') {
        el.style.display = 'none';
        RT.hits += 1;
      }
    });
    const letters = document.querySelectorAll('.hud-actions em, .dock-btn em');
    Array.prototype.forEach.call(letters, function (el) {
      const text = String(el.textContent || '').trim();
      if (!/^[A-Za-z0-9]$/.test(text)) return;
      if (el.style.display !== 'none') {
        el.style.display = 'none';
        RT.hits += 1;
      }
    });
    return true;
  }

  /**
   * 全量扫描一次：所有替换都按"改前原文精确匹配"执行，天然幂等
   * @returns {number} 累计改写数
   */
  function applyAll() {
    if (!RT.active) return 0;
    /* 先做整段替换：这些区域要求"改前原文"完整，必须在键帽翻译之前执行 */
    applyDeckKeys();
    applyFusionNote();
    applyFusionBar();
    /* 再做逐键帽翻译（按钮内的键帽直接隐藏） */
    Array.prototype.forEach.call(document.querySelectorAll('kbd'), translateKbd);
    applySkillChips();
    applyDeckTitles();
    applyIntroHint();
    applySlotBadges();
    return RT.hits;
  }

  /* ---------- KB11 · 动态 DOM 观察：只监听新增节点，rAF 去抖 ---------- */
  let scheduled = false;
  /**
   * 合并同一帧内的多次 DOM 变化，避免重复扫描
   * @returns {void}
   */
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(function () {
      scheduled = false;
      applyAll();
    });
  }

  /**
   * 启动观察器：游戏会动态重绘卡组 / 提示条，新增节点也要翻成触屏说法
   * @returns {void}
   */
  function startObserver() {
    if (!window.MutationObserver || !document.body) return;
    const mo = new MutationObserver(function (list) {
      for (let i = 0; i < list.length; i += 1) {
        if (list[i].type === 'childList' && list[i].addedNodes && list[i].addedNodes.length) {
          schedule();
          return;
        }
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  /**
   * 文案变化后让触屏层重算一次布局（卡组高度可能因换行变化）
   * @returns {void}
   */
  function refreshLayer() {
    try {
      if (window.__touchLayer && typeof window.__touchLayer.refresh === 'function') {
        window.__touchLayer.refresh();
      }
    } catch (e) { /* 触屏层未启用时忽略 */ }
  }

  /**
   * 第二段成立：收到真实触摸后才切换文案
   * @returns {void}
   */
  function activate() {
    if (!RT.capable || RT.active) return;
    RT.active = true;
    applyAll();
    startObserver();
    refreshLayer();
    /* 卡组换行可能发生在下一帧，再补一次重排 */
    window.setTimeout(refreshLayer, 360);
  }

  /**
   * 首个真实触摸事件：一旦收到就永久切到触屏文案
   * @returns {void}
   */
  function onFirstTouch() {
    if (RT.sawTouch) return;
    RT.sawTouch = true;
    activate();
  }

  /* 没有触摸能力的设备（桌面鼠标键盘）到此为止，绝不改写任何文本 */
  if (!RT.capable) return;

  window.addEventListener('touchstart', onFirstTouch, { capture: true, passive: true });
  window.addEventListener('pointerdown', function (e) {
    if (e && e.pointerType === 'touch') onFirstTouch();
  }, { capture: true, passive: true });
})();
