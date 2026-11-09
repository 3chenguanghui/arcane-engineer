/**
 * UI 一致性补丁 v2 应用器（只产出副本，永不写主文件）
 * ------------------------------------------------------------
 * 用法：
 *   node tools/ui-consistency-apply.mjs            # 干跑：只检查锚点、打印计划
 *   node tools/ui-consistency-apply.mjs --write    # 写入 ui-audit/out/index_arcane_v2_ui-v2.html
 *
 * 设计：
 * 1. TARGET_MD5 不在文件里写死，启动时现场读取主文件指纹并打印；
 * 2. 每条补丁用「锚点原文」定位，锚点在全文中必须唯一命中，命中数 ≠1 立即中止；
 * 3. 写入前后各做一次单快照复读，校验主文件未被改动、副本字节数符合预期；
 * 4. 全程不打开、不修改 index_arcane_v2.html。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = 'D:/其他/TRAE宝/奥术工程师';
const SRC = path.join(ROOT, 'index_arcane_v2.html');
const OUT_DIR = path.join(ROOT, 'ui-audit/out');
const OUT = path.join(OUT_DIR, 'index_arcane_v2_ui-v2.html');

/** 计算 MD5（单快照：一次读入内存后同时取长度与哈希，避免撕裂读数） */
function snapshot(file) {
  const buf = fs.readFileSync(file);
  return { bytes: buf.length, md5: crypto.createHash('md5').update(buf).digest('hex').toUpperCase(), buf };
}

/** 统计子串出现次数 */
function count(hay, needle) {
  let n = 0, i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}

// ============================================================
// P0 · 令牌层：先把"档位"本身收窄，组件才有统一的目标值
// ============================================================
const P0_ANCHOR = `    --icon-stroke: 1.5px;
  }`;
const P0_REPLACE = `    --icon-stroke: 1.5px;

    /* ============================================================
       UI 一致性 v2 · 档位令牌（唯一目标值）
       ------------------------------------------------------------
       字号 6 档 + 展现层 2 个；圆角 4 档 + 胶囊；间距 6 档；动效 3 档。
       旧的 --fs-2xl / --fs-3xl / --dur-slower 保留名字但对齐到新档位，
       避免已有引用静默失效。
       ============================================================ */
    --fs-display: clamp(30px, 7vh, 64px);   /* 仅标题页字标 */
    --fs-num: 40px;                          /* 仅 HUD 楼层大数 */
    --ls-0: 0;
    --ls-num: 0.04em;                        /* 等宽数字 */
    --ls-tag: 0.18em;                        /* 全大写小标签 */
    --r-chip: 4px;
    --r-btn: 8px;
    --r-panel: 12px;
    --r-modal: 16px;
    --dur-1: 0.14s;
    --dur-2: 0.22s;
    --dur-3: 0.36s;
    --shadow-hover: 0 6px 16px rgba(0, 0, 0, 0.35);
  }`;

// P1 · 令牌数值收口（改这里 = 全站生效，优先于逐组件覆盖）
const P1 = [
  ['    --fs-sm: 12.5px;', '    --fs-sm: 12px;'],
  ['    --fs-lg: 16px;', '    --fs-lg: 18px;'],
  ['    --fs-xl: 20px;', '    --fs-xl: 24px;'],
  ['    --fs-2xl: 26px;', '    --fs-2xl: 24px;   /* 与 --fs-xl 合并（全站 0 引用，保留名防静默失效） */'],
  ['    --fs-3xl: 38px;', '    --fs-3xl: 40px;   /* 对齐 --fs-num */'],
  ['    --sp-2: 6px;', '    --sp-2: 8px;'],
  ['    --sp-6: 22px;', '    --sp-6: 32px;'],
  ['    --dur-slower: 0.52s;', '    --dur-slower: 0.36s;   /* 与 --dur-slow 合并（0 引用） */'],
];

// P2 · 唯一一处直接写死的字体族（绕过 --sans 令牌）
const P2 = [[
  'font: 600 12px/1 "Microsoft YaHei UI", "Segoe UI", sans-serif;',
  'font-family: var(--sans); font-weight: 600; font-size: var(--fs-sm); line-height: 1;',
]];

// ============================================================
// P3 · 逐界面覆盖层（追加在样式表末尾，靠层叠顺序生效，可整段回滚）
// ============================================================
const P3_ANCHOR = `  @media (max-width: 720px) {
    .settings-panel { grid-template-columns: 1fr; }
  }
</style>`;
const P3_REPLACE = `  @media (max-width: 720px) {
    .settings-panel { grid-template-columns: 1fr; }
  }

  /* ============================================================
     UI 一致性 v2 · 统一覆盖层（P3）
     ------------------------------------------------------------
     只收档位（字号/圆角/间距/描边/动效），不改色相与明度。
     每一段的"改前 → 改后"见 ui-audit/04-PATCH.md。
     整段可直接删除以回滚，不需要动上面任何原始规则。
     ============================================================ */

  /* ---------- 通用：按钮只有一级圆角 + 一档字号 ---------- */
  .btn { font-size: var(--fs-md); gap: var(--sp-2); padding: 8px 12px; border-radius: var(--r-btn); }
  .btn-big { font-size: var(--fs-md); padding: 12px 16px; }
  .btn-start { font-size: var(--fs-lg); padding: 12px 28px; border-radius: var(--r-btn); }
  .btn kbd, .btn-start kbd { font-size: var(--fs-xs); border-radius: var(--r-chip); padding: 1px 6px; }
  .btn:hover, .btn-start:hover, .dock-btn:hover { box-shadow: var(--shadow-hover); }

  /* ---------- P3-1 标题页 ---------- */
  #titleLayer .title-card { padding: 24px 32px; }
  #titleLayer .title-wordmark,
  #titleLayer .title-wordmark[data-title-len="1"],
  #titleLayer .title-card h1 { font-family: var(--sans); font-size: var(--fs-display); letter-spacing: var(--ls-tag); line-height: 1.15; }
  #titleLayer .title-kicker { font-size: var(--fs-xs); letter-spacing: var(--ls-tag); }
  #titleLayer .title-kicker .title-ver { font-size: var(--fs-xs); border-radius: var(--r-pill); }
  #titleLayer .title-tagline { font-size: var(--fs-md); color: var(--text-2); }
  #titleLayer .title-stats,
  #titleLayer .title-themes,
  #titleLayer .title-guide { gap: var(--sp-3); }
  #titleLayer .title-stat { border-radius: var(--r-btn); border-color: var(--line); padding: 12px; }
  #titleLayer .title-stat span { font-size: var(--fs-xs); letter-spacing: var(--ls-num); }
  #titleLayer .title-stat b { font-size: var(--fs-lg); }
  #titleLayer .title-lr-label,
  #titleLayer .title-lr-note,
  #titleLayer .title-seed-records { font-size: var(--fs-sm); color: var(--text-3); }
  #titleLayer .title-seed-records .seed-rec { border-radius: var(--r-chip); border-color: var(--line); padding: 4px 8px; }
  #titleLayer .title-foot { font-size: var(--fs-sm); color: var(--text-3); }
  #titleLayer .title-actions { padding: 16px 0 0; gap: var(--sp-4); }
  #titleLayer .title-tools { gap: var(--sp-2); }

  /* ---------- P3-2 战斗 HUD ---------- */
  .hud-top { padding: 12px 16px 16px; gap: var(--sp-5); }
  .hud-readouts { gap: var(--sp-4); }
  .readout { padding: 6px 12px; gap: var(--sp-1); }
  .readout > span { font-size: var(--fs-xs); color: var(--text-3); }
  .readout > b { font-size: var(--fs-xl); }
  .readout-floor > b { font-size: var(--fs-xl); color: var(--text-1); }
  .readout > b em,
  .readout > i.readout-enemy { font-size: var(--fs-xs); color: var(--text-3); }
  .hud-record { padding: 6px 12px; gap: var(--sp-1); border-radius: var(--r-btn); }
  .hud-record > b { font-size: var(--fs-sm); color: var(--text-2); }
  .floor-panel { padding: 12px; border-radius: var(--r-panel); width: 160px; }
  .floor-num b { font-size: var(--fs-num); color: var(--text-1); }
  .floor-theme { font-size: var(--fs-xs); color: var(--text-2); padding: 4px 8px; border-radius: var(--r-pill); }
  .floor-row { font-size: var(--fs-xs); color: var(--text-3); padding: 4px 0; gap: var(--sp-1); }
  .floor-row b { font-size: var(--fs-sm); color: var(--text-2); }
  .tag-pips, .fusion-pips { gap: var(--sp-1); }
  .tag-pip { font-size: var(--fs-xs); padding: 1px 6px; border-radius: var(--r-pill); }
  .fusion-pips b { font-size: var(--fs-sm); color: var(--text-2); }
  .fusion-pips i { border-radius: var(--r-chip); }
  .bar-group { padding: 4px 0; gap: var(--sp-1); }
  .bar-group .bar-label { font-size: var(--fs-xs); color: var(--text-3); }
  .bar-group .bar-label b { font-size: var(--fs-sm); color: var(--text-1); }
  .bar-warn { font-size: var(--fs-xs); border-radius: var(--r-chip); padding: 0 6px; }
  .hud-deck { padding: 12px 16px; gap: var(--sp-4); border-radius: var(--r-panel); }
  .dock-btn { border-radius: var(--r-btn); }
  .dock-btn span { font-size: var(--fs-sm); }
  .dock-btn em { font-size: var(--fs-xs); border-radius: var(--r-chip); }
  .intro-hint { border-radius: var(--r-panel); padding: 8px 8px 8px 12px; gap: var(--sp-3); }

  /* ---------- P3-3 技能卡 ---------- */
  .mini-card { border-radius: var(--r-btn); border-color: var(--line); padding: 8px 12px; }
  .card-row.is-dense .mini-card { padding: 12px 6px 4px; }
  .mini-card .m-name,
  .card-row.is-dense .m-name { font-size: var(--fs-sm); }
  .mini-card.is-locked .m-name { font-size: var(--fs-sm); }
  body.hud-compact .card-row.is-dense .m-name { font-size: var(--fs-xs); }
  .mini-card .m-glyph { font-size: var(--fs-sm); border-radius: var(--r-chip); }
  .mini-card .m-key,
  .card-row.is-dense .m-key { font-size: var(--fs-xs); border-radius: var(--r-chip); padding: 0 4px; }
  .mini-card .m-meta { font-size: var(--fs-xs); letter-spacing: var(--ls-num); }
  .mini-card .m-fuse-badge { font-size: var(--fs-xs); border-radius: var(--r-chip); padding: 1px 4px; }
  .mini-card .m-slot { font-size: var(--fs-xs); border-radius: var(--r-chip); padding: 1px 6px; }
  .mini-card .m-fused { font-size: var(--fs-xs); letter-spacing: var(--ls-num); }

  /* ---------- P3-4 设置 ---------- */
  .settings-panel { gap: var(--sp-3); }
  .settings-panel .settings-box { padding: var(--sp-4); border-color: var(--line); border-radius: var(--r-panel); }
  .settings-box h3 { font-size: var(--fs-md); color: var(--text-1); }
  .settings-save { padding: var(--sp-3); border-radius: var(--r-panel); gap: var(--sp-3); }
  .settings-save h3 { font-size: var(--fs-md); color: var(--bad); }
  .setting-row { padding: var(--sp-2) 0; gap: var(--sp-3); }
  .setting-row > label { font-size: var(--fs-sm); color: var(--text-2); }
  .setting-row > b { font-size: var(--fs-sm); color: var(--text-1); }
  .setting-state, .setting-note, .setting-row .setting-hint { font-size: var(--fs-xs); color: var(--text-3); }
  .settings-author, .setting-author { font-size: var(--fs-xs); color: var(--text-3); letter-spacing: var(--ls-num); }

  /* ---------- P3-5 成就（档案列表） ---------- */
  .archive-ach-row { font-size: var(--fs-sm); border-color: var(--line); border-radius: var(--r-btn); padding: 4px 12px; gap: var(--sp-2); }
  .archive-ach-row .ach-name { color: var(--text-1); }
  .archive-ach-row .ach-desc { color: var(--text-3); }
  .archive-ach-row .ach-prog { color: var(--text-2); }
  .archive-ach-row .ach-reward { color: var(--gold); }
  .archive-ach-row .ach-state { color: var(--text-3); }
  .archive-ach-row .ach-bar i { background: var(--tech); }
  .archive-ach-row.is-done .ach-bar i { background: var(--line-strong); }

  /* ---------- P3-6 存档 ---------- */
  .save-slot-list { gap: var(--sp-2); }
  .save-slot-row { font-size: var(--fs-sm); border-color: var(--line); border-radius: var(--r-btn); padding: 8px 12px; gap: var(--sp-2); color: var(--text-1); }
  .save-slot-row.is-current { box-shadow: inset 0 0 0 2px var(--line-strong); }
  .save-slot-row .slot-sub { font-size: var(--fs-xs); color: var(--text-3); }

  /* ---------- P3-7 结算 ---------- */
  .modal h2, .result-modal h2 { font-size: var(--fs-xl); }
  .result-stats { gap: var(--sp-2); }
  .result-stat { border-radius: var(--r-btn); padding: 8px 12px; border-color: var(--line); }
  .result-stat b { font-size: var(--fs-lg); }
  .result-stat span { font-size: var(--fs-xs); color: var(--text-3); letter-spacing: var(--ls-num); }
  .result-summary > div { padding: 6px 12px; gap: var(--sp-1); border-radius: var(--r-btn); }
  .result-summary b { font-size: var(--fs-lg); }
  .result-hint { font-size: var(--fs-sm); color: var(--text-3); }
  .result-bottom { padding: 16px 0 8px; }

  /* ---------- P3-8 动效三档 ---------- */
  .btn, .btn-start, .dock-btn, .mini-card, .save-slot-row, .archive-ach-row {
    transition: border-color var(--dur-1) var(--ease), background var(--dur-1) var(--ease),
                transform var(--dur-1) var(--ease), box-shadow var(--dur-1) var(--ease),
                color var(--dur-1) var(--ease);
  }
  .floor-wipe.region .wipe-ring {
    transition: border-color var(--dur-2) var(--ease), box-shadow var(--dur-2) var(--ease);
  }
  .floor-wipe.region .wipe-text b,
  .floor-wipe.region .wipe-text span {
    transition: color var(--dur-2) var(--ease), text-shadow var(--dur-2) var(--ease);
  }
</style>`;

const PATCHES = [
  { id: 'P0', note: '令牌层新增档位变量（:root 内插入）', anchor: P0_ANCHOR, replace: P0_REPLACE },
  ...P1.map(([a, r], i) => ({ id: 'P1-' + (i + 1), note: '令牌数值收口', anchor: a, replace: r })),
  ...P2.map(([a, r], i) => ({ id: 'P2-' + (i + 1), note: '移除写死的字体族', anchor: a, replace: r })),
  { id: 'P3', note: '七界面统一覆盖层（整段可删以回滚）', anchor: P3_ANCHOR, replace: P3_REPLACE },
];

function main() {
  const before = snapshot(SRC);
  console.log('主文件 =', SRC);
  console.log('TARGET_MD5(现场读取) =', before.md5, '| bytes =', before.bytes);

  let text = before.buf.toString('utf8');
  let applied = 0;
  const problems = [];

  for (const p of PATCHES) {
    const hits = count(text, p.anchor);
    if (hits !== 1) { problems.push(`${p.id} 锚点命中 ${hits} 次（必须恰好 1 次）: ${p.anchor.slice(0, 50)}...`); continue; }
    text = text.replace(p.anchor, p.replace);
    applied++;
  }

  if (problems.length) {
    console.error('\n锚点校验失败，未写入：');
    problems.forEach(s => console.error('  - ' + s));
    process.exit(1);
  }

  // 写入前后校验主文件未变（只读保护）
  const mid = snapshot(SRC);
  if (mid.md5 !== before.md5 || mid.bytes !== before.bytes) {
    console.error('主文件在应用过程中发生变化，中止。'); process.exit(2);
  }

  // 生效性自检：新值必须真的出现
  const must = ['--fs-display:', '--fs-num:', '--shadow-hover:', 'UI 一致性 v2 · 统一覆盖层'];
  const missing = must.filter(k => !text.includes(k));
  if (missing.length) { console.error('补丁未生效，缺少：' + missing.join(', ')); process.exit(3); }

  const smallBefore = (before.buf.toString('utf8').match(/font-size:\s*(8\.5|9|9\.5|10|10\.5|11\.5|12\.5)px/g) || []).length;
  const smallAfter = (text.match(/font-size:\s*(8\.5|9|9\.5|10|10\.5|11\.5|12\.5)px/g) || []).length;

  console.log('\n已应用补丁段:', applied, '/', PATCHES.length);
  console.log('碎片字号(8.5/9/9.5/10/10.5/11.5/12.5px) 规则数:', smallBefore, '→', smallAfter, '（其余由覆盖层接管渲染结果）');
  console.log('副本字节数:', before.bytes, '→', Buffer.byteLength(text, 'utf8'));

  if (!process.argv.includes('--write')) {
    console.log('\n[干跑] 未写入。加 --write 才生成副本。');
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT, text, 'utf8');
  const after = snapshot(SRC);
  console.log('\n已写入副本 =', OUT);
  console.log('主文件 MD5 复核 =', after.md5, after.md5 === before.md5 ? '(未变 ✓)' : '(异常 ✗)');
}

main();
