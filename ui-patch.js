/* ============================================================
   烬 · UI 补丁包 v1.0 · ui-patch.js
   ------------------------------------------------------------
   职责：
     1) 内联 12 个技能 / 状态图标 + 1 个准心（纯 SVG path，零外部请求）；
     2) 暴露 window.JJUI.icon(name, size) 取任意尺寸的图标 HTML；
     3) 暴露 window.JJUI.apply() 一次性把补丁 class 挂到现有 DOM 上。
   依赖：0（不引任何库），可在 file:// 下双击运行。
   ============================================================ */
(function (global) {
  'use strict';

  var VERSION = '1.0.0';
  var SPRITE_ID = 'jjSprite';

  /* ------------------------------------------------------------
     图标数据：viewBox 统一 24×24，绘制区留 3px 安全边。
     线宽不写死在 path 上 —— 由 icon() 按「尺寸 × 0.073」换算后
     通过 <svg style="stroke-width:..."> 继承下去，满足
     ui-kit §8.1 的 clamp(1.2px, 尺寸×0.073, 2.5px)。
     ------------------------------------------------------------ */
  var ICONS = {
    /* 1. 火焰（火球 / 喷火锥 / 燃烧） */
    flame: '<g fill="none" stroke="currentColor" stroke-linejoin="round">'
      + '<path d="M12 3.2c2.4 3.1 3.9 4.9 4.6 6.6.7 1.7.4 3.4-.5 4.8a5.2 5.2 0 0 1-8.9 0c-.9-1.4-1.2-3.1-.5-4.8.8-1.9 2.3-3.4 4.2-5.4.2 1.7.7 2.7 1.7 3.4.2-1.6.3-3 .4-4.6z"/>'
      + '</g>',
    /* 2. 冰霜（冰环 / 冻结）：六向雪花 */
    frost: '<g fill="none" stroke="currentColor" stroke-linecap="round">'
      + '<path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9"/>'
      + '<path d="M12 6.4l2.1-2.1M12 6.4L9.9 4.3M12 17.6l2.1 2.1M12 17.6l-2.1 2.1" opacity=".75"/>'
      + '</g>',
    /* 3. 雷击（雷击 / 符文雷 / 感电） */
    bolt: '<g fill="none" stroke="currentColor" stroke-linejoin="round">'
      + '<path d="M13.4 2.6 5.6 13.4h5.2L9.8 21.4l7.8-10.8h-5.2z"/>'
      + '</g>',
    /* 4. 地雷（地雷 / 陷阱） */
    mine: '<g fill="none" stroke="currentColor" stroke-linecap="round">'
      + '<circle cx="12" cy="12" r="3.2"/>'
      + '<path d="M12 3v3.2M12 17.8V21M3 12h3.2M17.8 12H21M5.6 5.6l2.3 2.3M16.1 16.1l2.3 2.3M18.4 5.6l-2.3 2.3M7.9 16.1l-2.3 2.3"/>'
      + '</g>',
    /* 5. 奥术池（奥术雷池 / 地面持续伤害） */
    pool: '<g fill="none" stroke="currentColor" stroke-linecap="round">'
      + '<path d="M3 8.4c2.2 0 2.2-1.6 4.5-1.6S9.7 8.4 12 8.4s2.2-1.6 4.5-1.6S18.7 8.4 21 8.4"/>'
      + '<path d="M3 13c2.2 0 2.2-1.6 4.5-1.6S9.7 13 12 13s2.2-1.6 4.5-1.6S18.7 13 21 13"/>'
      + '<path d="M3 17.6c2.2 0 2.2-1.6 4.5-1.6S9.7 17.6 12 17.6s2.2-1.6 4.5-1.6S18.7 17.6 21 17.6"/>'
      + '</g>',
    /* 6. 喷火锥（锥形范围） */
    cone: '<g fill="none" stroke="currentColor" stroke-linejoin="round">'
      + '<path d="M4 5.4h10.2L21 12l-6.8 6.6H4l4.4-6.6z"/>'
      + '<path d="M9.4 10.2l1.4 1.8-1.4 1.8" stroke-linecap="round" opacity=".7"/>'
      + '</g>',
    /* 7. 护盾（护盾 / 力场） */
    shield: '<g fill="none" stroke="currentColor" stroke-linejoin="round">'
      + '<path d="M12 3.4 19 6v5.6c0 4.4-3 7.3-7 9-4-1.7-7-4.6-7-9V6z"/>'
      + '<path d="M9 12.2l2 2 4-4.4" stroke-linecap="round"/>'
      + '</g>',
    /* 8. 蓄能（电池 + 闪电） */
    charge: '<g fill="none" stroke="currentColor">'
      + '<rect x="4" y="6" width="13" height="12" rx="2"/>'
      + '<path d="M17 10h3v4h-3"/>'
      + '<path d="M11.4 8.2 9 12.4h3l-1.4 3.4" stroke-linecap="round"/>'
      + '</g>',
    /* 9. 回旋刃（导轨短刃 / 物理） */
    blade: '<g fill="none" stroke="currentColor" stroke-linecap="round">'
      + '<path d="M4 20 17.6 6.4M14.2 4.2l5.6 5.6M6.8 17.2l-2.6 2.6"/>'
      + '</g>',
    /* 10. 治疗（外圈 + 十字） */
    heal: '<g fill="none" stroke="currentColor" stroke-linecap="round">'
      + '<circle cx="12" cy="12" r="8.4" opacity=".72"/>'
      + '<path d="M12 6.6v10.8M6.6 12h10.8"/>'
      + '</g>',
    /* 11. 中毒（液滴 + 气泡） */
    poison: '<g fill="none" stroke="currentColor" stroke-linejoin="round">'
      + '<path d="M12 3.4c3.2 4.4 5.6 7.4 5.6 10.4a5.6 5.6 0 0 1-11.2 0c0-3 2.4-6 5.6-10.4z"/>'
      + '<circle cx="10" cy="14.8" r="1.15" fill="currentColor" stroke="none"/>'
      + '<circle cx="14.2" cy="12.6" r="0.9" fill="currentColor" stroke="none"/>'
      + '</g>',
    /* 12. 虚空（坍缩黑洞 / 拉拽）：外环 + 向心弧 + 核心 */
    void: '<g fill="none" stroke="currentColor" stroke-linecap="round">'
      + '<circle cx="12" cy="12" r="8.4" opacity=".65"/>'
      + '<path d="M5.4 9.2a6.9 6.9 0 0 1 11.8-1.4M6.6 15.4a6.2 6.2 0 0 0 10.4-.8"/>'
      + '<circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/>'
      + '</g>',
    /* 准心（13 / 独立于 12 个技能图标） */
    cursor: '<g fill="none" stroke="currentColor" stroke-linecap="round">'
      + '<circle cx="12" cy="12" r="5.4"/>'
      + '<path d="M12 2.4v3.2M12 18.4v3.2M2.4 12h3.2M18.4 12h3.2"/>'
      + '<circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/>'
      + '</g>'
  };

  var ICON_NAMES = Object.keys(ICONS);

  /**
   * 把内联图标库注入文档（只注入一次）。
   * 说明：用 <symbol> + <use>，path 直接在 HTML 里，不走 base64，
   *       所以断网、双击打开都可用，且体积不膨胀。
   */
  function ensureSprite() {
    if (typeof document === 'undefined') return null;
    var exists = document.getElementById(SPRITE_ID);
    if (exists) return exists;

    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('id', SPRITE_ID);
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.style.position = 'absolute';
    svg.style.overflow = 'hidden';

    var html = '<defs>';
    ICON_NAMES.forEach(function (name) {
      html += '<symbol id="jj-i-' + name + '" viewBox="0 0 24 24">' + ICONS[name] + '</symbol>';
    });
    html += '</defs>';
    svg.innerHTML = html;

    var host = document.body || document.documentElement;
    host.insertBefore(svg, host.firstChild);
    return svg;
  }

  /**
   * 取一个内联 SVG 图标。
   * @param {string} name 图标名（flame/frost/bolt/mine/pool/cone/shield/charge/blade/heal/poison/void/cursor）
   * @param {number} [size=24] 渲染尺寸（px）
   * @returns {string} 可直接插入 DOM 的 SVG 字符串；未知名称返回空串
   */
  function icon(name, size) {
    if (!ICONS[name]) return '';
    var s = Number(size) || 24;
    ensureSprite();

    /* 视觉线宽按 ui-kit §8.1：clamp(1.2, 尺寸×0.073, 2.5)；
       path 使用 viewBox 单位，所以再乘 24/s 换算回绘制单位。 */
    var visual = Math.min(2.5, Math.max(1.2, s * 0.073));
    var unit = visual * 24 / s;

    return '<svg class="jj-icon" width="' + s + '" height="' + s + '"'
      + ' viewBox="0 0 24 24" style="stroke-width:' + unit.toFixed(2) + '"'
      + ' aria-hidden="true" focusable="false">'
      + '<use href="#jj-i-' + name + '"/></svg>';
  }

  /**
   * 一次性把补丁 class 挂到现有 DOM 上。
   * 只加 class、不移动节点、不改事件与玩法逻辑；
   * 真正的视觉全部由 ui-patch.css 的 body.jj-ui 作用域承担。
   * @param {Object} [options] 保留参数位（当前无额外开关）
   * @returns {Object} 各组件命中数量，便于接入时自检
   */
  function apply(options) {
    var opts = options || {};
    if (typeof document === 'undefined' || !document.body) {
      return { ok: false, reason: 'document.body 未就绪' };
    }

    ensureSprite();
    document.body.classList.add('jj-ui');

    var map = [
      ['.hud-top', 'jj-hud-top'],
      ['.bar', 'jj-bar'],
      ['.skill-chip', 'jj-chip'],
      ['.hud-deck', 'jj-deck'],
      ['.card-row', 'jj-deck-row'],
      ['.mini-card', 'jj-deck-card'],
      ['.floor-panel', 'jj-floor'],
      ['.minimap-panel', 'jj-map'],
      ['.modal-layer.is-reward', 'jj-reward-layer'],
      ['.modal-layer.is-reward .modal', 'jj-strip'],
      ['.reward-grid', 'jj-card-row'],
      ['.reward-card', 'jj-card'],
      ['.result-modal', 'jj-result'],
      ['.tower-voice', 'jj-death-bar'],
      ['.result-stats', 'jj-stat-grid'],
      ['.result-stat', 'jj-stat'],
      ['.result-modal [data-action="restart"]', 'jj-restart'],
      ['.settings-panel', 'jj-settings'],
      ['.settings-box', 'jj-settings-box'],
      ['.setting-row', 'jj-setting-row'],
      ['.switch', 'jj-switch'],
      ['.aim-modes', 'jj-seg']
    ];

    var counts = {};
    map.forEach(function (pair) {
      var nodes = document.querySelectorAll(pair[0]);
      counts[pair[1]] = nodes.length;
      for (var i = 0; i < nodes.length; i += 1) {
        nodes[i].classList.add(pair[1]);
      }
    });

    if (opts.richLabel) {
      /* 预留扩展位：目前不插入任何节点，保持 DOM 结构与主文件一致 */
      counts.richLabel = 0;
    }

    return {
      ok: true,
      version: VERSION,
      icons: ICON_NAMES.length,
      counts: counts
    };
  }

  /**
   * 回退：只摘掉 body 上的 jj-ui。
   * 补丁 CSS 全部挂在 body.jj-ui 下，所以一步即可恢复原界面；
   * 先前挂上的 jj-* class 不会产生副作用，可留可删。
   */
  function revert() {
    if (typeof document !== 'undefined' && document.body) {
      document.body.classList.remove('jj-ui');
    }
    return { ok: true, ui: false };
  }

  /**
   * 取图标 sprite 的 DOM（调试用，例如确认 <symbol> 是否已注入）。
   */
  function sprite() {
    return ensureSprite();
  }

  global.JJUI = {
    version: VERSION,
    icons: ICON_NAMES.slice(),
    icon: icon,
    apply: apply,
    revert: revert,
    sprite: sprite
  };
})(window);
