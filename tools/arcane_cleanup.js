/**
 * 清理测试遗留的 Edge profile（Temp 下的 edge-* 目录）
 * ------------------------------------------------------------
 * 背景：旧测试脚本每次用 `fs.mkdtempSync(os.tmpdir()/edge-xxx-)` 新建 profile 且从不清理，
 * 长期累积出上千个目录 / 几十 GB。脚本已统一改为复用 `.testprofile/edge`，
 * 本工具用于清理历史残留，也可作为 CI 收尾步骤。
 *
 * 用法：
 *   node tools/arcane_cleanup.js            # 只统计，不删除（dry-run）
 *   node tools/arcane_cleanup.js --apply    # 真正删除
 *   node tools/arcane_cleanup.js --apply --limit 200   # 只处理前 200 个目录
 *   node tools/arcane_cleanup.js --list     # 列出前 20 个目录名与大小
 *
 * 安全边界：只匹配 Temp 下**名字以 `edge-` 开头**的目录（历史脚本的命名），
 * 不碰用户自己的 Edge 目录，也不碰项目内的 `.testprofile`（由测试脚本自己清）。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const args = process.argv.slice(2);
const APPLY = args.indexOf('--apply') >= 0;
const LIST = args.indexOf('--list') >= 0;
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? Math.max(1, Number(args[limitIdx + 1]) || 0) : 0;
const TMP = os.tmpdir();
const LEGACY_RE = /^edge-[a-z0-9]+-/i;

/**
 * 递归统计目录大小与文件数
 * @param {string} dir 目录
 * @returns {{bytes:number, files:number}} 统计结果
 */
function measure(dir) {
  let bytes = 0;
  let files = 0;
  let stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch (error) {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else {
        files += 1;
        try { bytes += fs.statSync(full).size; } catch (error) { /* 文件消失 */ }
      }
    }
  }
  return { bytes, files };
}

/**
 * 删除一个目录（带重试，Windows 上常被残留进程占用）
 * @param {string} dir 目录
 * @returns {boolean} 是否成功
 */
function removeDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * 主流程：扫描、统计、按需删除
 * @returns {void}
 */
function main() {
  let dirs = [];
  try {
    dirs = fs.readdirSync(TMP, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && LEGACY_RE.test(entry.name))
      .map((entry) => path.join(TMP, entry.name));
  } catch (error) {
    console.error('读取 Temp 失败：' + error.message);
    process.exit(1);
  }

  const plan = LIMIT ? dirs.slice(0, LIMIT) : dirs;
  let totalBytes = 0;
  let totalFiles = 0;
  const rows = [];
  for (const dir of plan) {
    const stat = measure(dir);
    totalBytes += stat.bytes;
    totalFiles += stat.files;
    rows.push({ dir, bytes: stat.bytes, files: stat.files });
  }

  const mb = (n) => (n / 1024 / 1024).toFixed(1) + 'MB';
  console.log('Temp 路径：' + TMP);
  console.log('遗留 profile 目录：' + dirs.length + (LIMIT ? '（本次只处理前 ' + LIMIT + ' 个）' : ''));
  console.log('本次统计：' + plan.length + ' 个 / ' + totalFiles + ' 文件 / ' + mb(totalBytes));
  if (LIST) {
    rows.slice()
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 20)
      .forEach((row) => console.log('  ' + mb(row.bytes) + ' · ' + row.files + ' 文件 · ' + path.basename(row.dir)));
  }

  if (!APPLY) {
    console.log('dry-run：未删除。加 --apply 才会真正清理。');
    return;
  }

  let removed = 0;
  let failed = 0;
  for (const row of rows) {
    if (removeDir(row.dir)) removed += 1;
    else failed += 1;
  }
  console.log('已删除：' + removed + ' 个目录' + (failed ? '，失败 ' + failed + ' 个（可能仍被进程占用，稍后重跑）' : ''));
}

main();
