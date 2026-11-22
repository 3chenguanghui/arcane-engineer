// 诊断：页面加载后各就绪信号的真实状态（只读，不改游戏文件）
const path = require('path');
const { openPreview } = require(path.join(__dirname, '..', 'tools', 'preview_cdp'));

// 在页面内读取：DOM 状态、state 绑定、标题层类名、调试对象
const EXPR = `(function(){
  var t = document.getElementById('titleLayer');
  var hasState = false;
  try { hasState = (typeof state !== 'undefined'); } catch (e) { hasState = 'TDZ'; }
  return {
    ready: document.readyState,
    hasState: hasState,
    titleClass: t ? t.className : null,
    debug: typeof window.__roamDebug,
    errors: (window.__errors || []).slice(0, 5)
  };
})()`;

(async () => {
  const r = await openPreview('index_arcane_v2.html', EXPR, { waitMs: 3000, timeoutMs: 40000 });
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
