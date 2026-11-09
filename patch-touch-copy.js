/* ============================================================
   烬 · 首局教学文案补丁（patch-touch-copy.js）
   ------------------------------------------------------------
   作用：触屏态下把"按 F 攻击 / 按 Shift 闪避 / WASD 移动 / 按 E 下楼"
        等教学与情境提示换成人话（点右下攻击键 / 点闪避键 / 摇杆移动…）。

   硬约束：
     · 不新增 DOM 节点；
     · 只改文本与数据数组里的字符串（ONBOARD_STEPS 的元素，不换数组）；
     · 不读 navigator.userAgent / platform；
     · 不改布局尺寸、不改按键行为。

   触屏判定（两段）：
     能力：maxTouchPoints > 0 或 (any-pointer: coarse) → 不满足则直接退出；
     事实：真实 touchstart / pointerdown(pointerType=touch) 后才切换文案。

   接入：放在主文件 body 末尾、patch-touch-keycaps.js 之后：
     script src="patch-touch-copy.js"
   回滚：删除这一行脚本标签即可；或 URL 加 ?touch=off 全程关闭。
   ============================================================ */
(function () {
  'use strict';

  /* ---------- CP1 · URL 开关 + 调试口 ---------- */
  const params = new URLSearchParams(window.location.search || '');
  const MODE = String(params.get('touch') || '').toLowerCase();

  const RT = {
    capable: false,
    sawTouch: false,
    active: false,
    hits: 0
  };

  const api = {
    apply: function () { return applyAll(); },
    translate: function (text) { return translateString(text); }
  };
  ['capable', 'sawTouch', 'active', 'hits'].forEach(function (key) {
    Object.defineProperty(api, key, {
      enumerable: true,
      get: function () { return RT[key]; }
    });
  });
  window.__touchCopy = api;

  if (MODE === 'off') return;

  /* ---------- CP2 · 第一段：能力判断（不用 UA） ---------- */
  try {
    RT.capable = (Number(navigator.maxTouchPoints) > 0)
      || (typeof window.matchMedia === 'function'
        && window.matchMedia('(any-pointer: coarse)').matches);
  } catch (e) {
    RT.capable = false;
  }

  /* ---------- CP3 · 整段精确映射（键位 → 人话） ---------- */
  const TEXT_MAP = {
    /* 首局五层卡 */
    'WASD 移动，左键开火': '摇杆移动，点攻击键',
    '按 F 融合主技能': '点融合键合成主技能',
    'K 装置，Shift 跑': '点装置键召唤，闪避键冲刺',
    /* 首局三步情境提示 */
    'WASD 移动': '摇杆移动',
    '方向键同样可用；撞墙会贴着滑行。': '摇杆推到底，撞墙会贴着滑行。',
    '左键 施法': '点攻击键施法',
    '朝鼠标方向释放主技能，消耗奥能。': '朝准星方向释放主技能，消耗奥能。',
    '空格 影步': '点闪避键冲刺',
    /* 楼层 / 卡组说明 */
    '第 1 层：WASD 移动 · 左键 / J 施法 · 清场后按 E 下楼': '第 1 层：摇杆移动 · 点攻击键施法 · 清场后点交互键下楼',
    /* 融合相关 */
    '集齐魔法 + 对应科技后按 F 融合': '集齐魔法 + 对应科技后点融合键融合',
    '再按 F 过载': '再点融合键过载',
    '可按 F 融合': '可点融合键合成',
    '按 F 使用': '点融合键使用',
    '两个模块齐备，按 F 立即融合': '两个模块齐备，点融合键立即合成',
    '按 F 装配': '点融合键装配',
    '获得后按 F 融合激活': '点融合键激活',
    /* 施法说明 */
    '按 J / 左键释放': '点攻击键释放'
  };

  /* ---------- CP4 · 通用键位短语（只替换"按 X "这类句式） ---------- */
  const KEY_RULES = [
    [/左键 \/ J/g, '攻击键'],
    [/右键 \/ K/g, '装置键'],
    [/Shift \/ 空格/g, '闪避键'],
    [/空格 \/ Shift/g, '闪避键'],
    [/按 E /g, '点交互键'],
    [/按 F /g, '点融合键'],
    [/按 R /g, '点重开键'],
    [/按 C /g, '点继续键'],
    [/按 M /g, '点地图键'],
    [/按 T /g, '点技能树键'],
    [/按 H /g, '点帮助键'],
    [/按 J /g, '点攻击键'],
    [/按 K /g, '点装置键'],
    [/按 Q /g, '点武器键'],
    [/按 Shift /g, '点闪避键'],
    [/按 Esc /g, '点关闭键'],
    [/左键 /g, '攻击键 '],
    [/右键 /g, '装置键 '],
    [/WASD/g, '摇杆'],
    [/数字键 1–\d+/g, '卡组'],
    [/空格 /g, '闪避键 ']
  ];

  /**
   * 把一段文案翻译成触屏说法（先整段精确匹配，再套键位短语规则）
   * @param {string} input 原始文案
   * @returns {string} 触屏文案
   */
  function translateString(input) {
    const text = String(input == null ? '' : input);
    if (!text) return text;
    const whole = TEXT_MAP[text.trim()];
    if (whole) return whole;
    let out = text;
    for (let i = 0; i < KEY_RULES.length; i += 1) {
      out = out.replace(KEY_RULES[i][0], KEY_RULES[i][1]);
    }
    return out;
  }

  /* ---------- CP5 · ONBOARD_STEPS：改元素 hint，不换数组 ----------
     锚点：const ONBOARD_STEPS（主文件顶层常量）
     约束：hint 必须 ≤ ONBOARD_CONFIG.hintMaxChars（12 字）
     新文案字数：9 / 9 / 12 / 8 / 8 */
  const STEP_HINTS = {
    moveAttack: '摇杆移动，点攻击键',
    fusion: '点融合键合成主技能',
    techDash: '点装置键召唤，闪避键冲刺'
  };

  /**
   * 改写五层教学数据里的 hint（幂等；route / meta 不改）
   * @returns {boolean} 是否发生改写
   */
  function patchOnboardSteps() {
    let steps = null;
    try {
      /* top-level const 在全局词法环境里，跨脚本可直接按名读取 */
      steps = ONBOARD_STEPS;
    } catch (e) {
      steps = null;
    }
    if (!steps || typeof steps.length !== 'number') return false;
    let changed = false;
    for (let i = 0; i < steps.length; i += 1) {
      const step = steps[i];
      if (!step || !step.key) continue;
      const next = STEP_HINTS[step.key];
      if (!next || step.hint === next) continue;
      step.hint = next;
      RT.hits += 1;
      changed = true;
    }
    return changed;
  }

  /* ---------- CP6 · 情境提示：包装 updateContextHints ----------
     锚点：function updateContextHints()
     原函数每帧只写 DOM 不参与玩法；包装后只多做一次文本翻译。 */
  /**
   * 把 #contextHint 的主标题与副标题翻成触屏说法（每帧幂等）
   * @returns {void}
   */
  function translateContextHint() {
    const el = document.getElementById('contextHint');
    if (!el) return;
    ['b', 'span'].forEach(function (tag) {
      const node = el.querySelector(tag);
      if (!node) return;
      const text = String(node.textContent || '').trim();
      if (!text) return;
      const next = translateString(text);
      if (next !== text) {
        node.textContent = next;
        RT.hits += 1;
      }
    });
  }

  /**
   * 包装主文件的情境提示刷新函数（只加后置翻译，不改原逻辑）
   * @returns {void}
   */
  function wrapContextHints() {
    const orig = window.updateContextHints;
    if (typeof orig !== 'function' || orig.__tgCopyWrapped) return;
    const wrapped = function () {
      const result = orig.apply(this, arguments);
      translateContextHint();
      return result;
    };
    wrapped.__tgCopyWrapped = true;
    window.updateContextHints = wrapped;
  }

  /* ---------- CP7 · 静态文本节点扫描 ----------
     跳过 SCRIPT / STYLE / CODE / TEXTAREA / KBD 与键帽补丁已接管的区域；
     每处替换都要求"改前原文"能精确匹配才动手，天然幂等。 */
  /**
   * 遍历全页文本节点并翻译
   * @returns {void}
   */
  function walkTextNodes() {
    if (!document.body) return;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        const tag = parent.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'CODE'
          || tag === 'TEXTAREA' || tag === 'KBD') return NodeFilter.FILTER_REJECT;
        /* 这些区域由键帽补丁负责整段替换，避免拆坏它的精确匹配 */
        if (parent.closest('.deck-keys, .skill-chip, #fusionNote, #introHint, #contextHint')) {
          return NodeFilter.FILTER_REJECT;
        }
        if (parent.isContentEditable) return NodeFilter.FILTER_REJECT;
        const text = node.nodeValue;
        if (!text || !text.trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    }, false);

    const nodes = [];
    let node = walker.nextNode();
    while (node) {
      nodes.push(node);
      node = walker.nextNode();
    }
    nodes.forEach(function (item) {
      const text = item.nodeValue;
      const next = translateString(text);
      if (next !== text) {
        item.nodeValue = next;
        RT.hits += 1;
      }
    });
  }

  /**
   * 整块重写一个元素（用于被 kbd 拆散、无法逐文本节点替换的说明句）
   * @param {HTMLElement} el 目标元素
   * @param {string} text 触屏全文
   * @returns {boolean} 是否发生改写
   */
  function rewriteBlock(el, text) {
    if (!el) return false;
    const cur = String(el.textContent || '').replace(/\s+/g, ' ').trim();
    if (cur === text) return false;
    el.textContent = text;
    el.setAttribute('data-tg-copy', 'block');
    RT.hits += 1;
    return true;
  }

  /* ---------- CP6b · 被 kbd 拆散的说明句：整块换掉 ----------
     锚点：`.help-note` / `.map-tip` / `.result-hint`
     这些句子中间夹着 `<kbd>`，逐节点替换会留下“按 关闭 或同名快捷键”这类残句。 */
  /**
   * 重写帮助页脚注、地图提示、结算提示里的键位说明
   * @returns {void}
   */
  function patchSpecialBlocks() {
    const help = document.querySelector('.help-note');
    if (help && /同名快捷键/.test(String(help.textContent || ''))) {
      rewriteBlock(help, '面板（帮助 / 技能树 / 设置 / 地图）互斥，打开即暂停世界与计时；点关闭按钮关闭。');
    }
    const mapTip = document.querySelector('.map-tip');
    if (mapTip && /滚轮缩放/.test(String(mapTip.textContent || ''))) {
      rewriteBlock(mapTip, '双指缩放 · 拖拽平移 · 点地图键关闭');
    }
    Array.prototype.forEach.call(document.querySelectorAll('.result-hint'), function (el) {
      const text = String(el.textContent || '');
      if (text.indexOf('按 R 或点上方按钮重开') >= 0) {
        rewriteBlock(el, '点重开键或点上方按钮重开；右下系统键可看帮助、技能树、设置。');
      } else if (text.indexOf('随时可按 E 下楼') >= 0) {
        rewriteBlock(el, '无尽模式下楼层继续增长，随时可点交互键下楼；点重开键仍然可以重开。');
      }
    });
  }

  /**
   * 全量应用一次（数据 + 情境提示 + 静态文本）
   * @returns {number} 累计改写数
   */
  function applyAll() {
    if (!RT.active) return 0;
    patchOnboardSteps();
    wrapContextHints();
    translateContextHint();
    patchSpecialBlocks();
    walkTextNodes();
    return RT.hits;
  }

  /* ---------- CP8 · 动态 DOM 观察：120ms 合并，避免每帧扫描 ---------- */
  let timer = 0;
  /**
   * 合并短时间内的多次 DOM 变化
   * @returns {void}
   */
  function schedule() {
    if (timer) return;
    timer = window.setTimeout(function () {
      timer = 0;
      applyAll();
    }, 120);
  }

  /**
   * 观察新增节点（游戏会用 innerHTML 重绘提示 / 卡面）
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
   * 让触屏层重算布局（提示条显隐 / 卡组换行会影响上移量）
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
    window.setTimeout(refreshLayer, 360);
  }

  /**
   * 首个真实触摸事件
   * @returns {void}
   */
  function onFirstTouch() {
    if (RT.sawTouch) return;
    RT.sawTouch = true;
    activate();
  }

  if (!RT.capable) return;

  window.addEventListener('touchstart', onFirstTouch, { capture: true, passive: true });
  window.addEventListener('pointerdown', function (e) {
    if (e && e.pointerType === 'touch') onFirstTouch();
  }, { capture: true, passive: true });
})();
