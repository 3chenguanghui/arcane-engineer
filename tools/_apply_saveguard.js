// 临时：按 SAVE_GUARD_PATCH.md 六段顺序落地（锚点必须各命中 1 次）
// 段 6 为整段替换：先备份原段与整文件，替换后回读核对
// 用法：node tools\_apply_saveguard.js；验完即删
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const MAIN = path.join(ROOT, 'index_arcane_v2.html');
const DOC = path.join(ROOT, 'SAVE_GUARD_PATCH.md');

/** 计算文件 MD5（大写） */
function md5Of(file) {
  return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

const doc = fs.readFileSync(DOC, 'utf8');

/**
 * 从文档中抽取第 n 段的代码块（优先 SEG 标记，其次「插入内容」）
 * @param {number} n 段号
 * @returns {string} 代码文本（含结尾换行）
 */
function pickSegment(n) {
  const start = doc.indexOf('### 段 ' + n);
  const nextTag = n === 6 ? '## 四、字节增量汇总' : ('### 段 ' + (n + 1));
  const end = doc.indexOf(nextTag, start + 1);
  if (start < 0 || end < 0) throw new Error('文档段定位失败: ' + n);
  const sec = doc.slice(start, end);
  const marker = sec.indexOf('<!-- SEG' + n + ' -->');
  const codeStart = sec.indexOf('```js\n', marker >= 0 ? marker : sec.indexOf('**插入内容'));
  if (codeStart < 0) throw new Error('段 ' + n + ' 找不到代码块');
  const bodyStart = codeStart + 6;
  const bodyEnd = sec.indexOf('\n```', bodyStart);
  if (bodyEnd < 0) throw new Error('段 ' + n + ' 代码块未闭合');
  return sec.slice(bodyStart, bodyEnd) + '\n';
}

const SEG1_ANCHOR = '  state = createInitialState();\n  // 先进入标题界面：此时不推进世界、不计入局数，等玩家点击“开始探索”';
const SEG2_ANCHOR = '// 页面脚本在 body 末尾，DOM 已经就绪，可以直接启动';
const SEG5_ANCHOR = "function saveRunSlot(slot, reason) {\n  if (!SAVE_SLOTS_CONFIG.enabled) return { ok: false, error: 'disabled' };\n";
const SEG3_OLD = `function saveMeta() {
  if (metaFallbackClean || metaExternalChanged) return;
  const write = () => window.localStorage.setItem(GAME_CONFIG.metaKey, JSON.stringify(state.meta));
  try {
    write();
  } catch (error) {
    try {
      const store = readRunSlotStore();
      const keys = Object.keys(store.slots || {});
      if (keys.length) {
        keys.sort((a, b) => ((store.slots[a] || {}).savedAt || 0) - ((store.slots[b] || {}).savedAt || 0));
        delete store.slots[keys[0]];
        writeRunSlotStore(store);
        write();
        showToast('存储空间不足：已清理最旧的局内存档以保住永久进度', 'warn');
        return;
      }
    } catch (retryError) {
      /* 二次失败走下面统一提示 */
    }
    showToast('存储空间不足：本次永久进度未能保存，请清理浏览器站点数据后重试', 'warn');
  }
}`;
const SEG4_OLD = `function writeRunSlotStore(store) {
  try {
    localStorage.setItem(SAVE_SLOTS_CONFIG.key, JSON.stringify(store));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error && error.name === 'QuotaExceededError' ? 'quota' : 'write' };
  }
}`;
const SEG6_OLD = `/* v1.7.0 存档兼容（R2）：另一个标签页写档时，本页立刻停止写 meta。
   监听器只做止损，不做合并——整对象写盘没有修订号，合并属于下一版的结构改动。 */
window.addEventListener('storage', (event) => {
  if (!event || event.key !== GAME_CONFIG.metaKey || !event.newValue) return;
  if (metaExternalChanged) return;
  metaExternalChanged = true;
  showToast('检测到另一标签页更新了存档：本页已停止写入，请刷新后继续', 'warn');
});`;

const before = { bytes: fs.statSync(MAIN).size, md5: md5Of(MAIN) };
let html = fs.readFileSync(MAIN, 'utf8');

/** 单段替换：锚点必须唯一，否则抛错停止 */
function replaceOnce(label, anchor, replacement) {
  const hits = html.split(anchor).length - 1;
  if (hits !== 1) throw new Error(label + ' 锚点命中 ' + hits + ' 次，停止');
  html = html.replace(anchor, () => replacement);
  console.log('  ' + label + ' OK');
}

// 段 1：init 里先拿写权
replaceOnce('SEG1', SEG1_ANCHOR, pickSegment(1) + SEG1_ANCHOR);
// 段 2：SaveGuard 模块
replaceOnce('SEG2', SEG2_ANCHOR, pickSegment(2) + '\n' + SEG2_ANCHOR);
// 段 3：saveMeta 整函数替换
replaceOnce('SEG3', SEG3_OLD, pickSegment(3).replace(/\n$/, ''));
// 段 4：writeRunSlotStore 整函数替换
replaceOnce('SEG4', SEG4_OLD, pickSegment(4).replace(/\n$/, ''));
// 段 5：saveRunSlot 只读提示（插在第一行之后）
replaceOnce('SEG5', SEG5_ANCHOR, "function saveRunSlot(slot, reason) {\n  if (!SAVE_SLOTS_CONFIG.enabled) return { ok: false, error: 'disabled' };\n" + pickSegment(5));
// 段 6：storage 监听整段替换（先备份原段与整文件）
const stamp = Date.now();
const bakDir = path.join(ROOT, '.saveguard_backup');
fs.mkdirSync(bakDir, { recursive: true });
fs.writeFileSync(path.join(bakDir, 'seg6_original_' + stamp + '.txt'), SEG6_OLD + '\n', 'utf8');
fs.writeFileSync(path.join(bakDir, 'full_before_' + stamp + '.html'), fs.readFileSync(MAIN), 'utf8');
replaceOnce('SEG6', SEG6_OLD, pickSegment(6).replace(/\n$/, ''));

fs.writeFileSync(MAIN, html, 'utf8');
const after = { bytes: fs.statSync(MAIN).size, md5: md5Of(MAIN) };
console.log(`SAVEGUARD: ${before.bytes} / ${before.md5} → ${after.bytes} / ${after.md5}  Δ${after.bytes - before.bytes}`);
