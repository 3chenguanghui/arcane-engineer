/**
 * 用当前主文件重建移动端工作副本（mobile/index_arcane_v2_mobile.html）
 * ------------------------------------------------------------
 * 背景：主文件每次由写者线重打版本（本次 v1.8.2 / 2026-11-11 20:25），
 *       工作副本如果还停在旧主文件上，测出来的结论就不是当前交付件。
 * 做法：
 *   1. 把「手机横屏触控层」整块注入体落盘成 patch/inject-block.html（只抽一次，之后复用）；
 *   2. 读取当前主文件，把注入块原样插到最后一个 </body> 之前；
 *   3. 自检：注入块逐字节存在、关键锚点各只出现一次、字节数 = 主文件 + 注入块。
 * 不修改主文件，只写 mobile/index_arcane_v2_mobile.html 与 patch/inject-block.html。
 * 用法：node mobile/tools/_build_mobile.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const MASTER = path.join(ROOT, 'index_arcane_v2.html');
const MOBILE = path.join(ROOT, 'mobile', 'index_arcane_v2_mobile.html');
const BLOCK_FILE = path.join(ROOT, 'mobile', 'patch', 'inject-block.html');

/**
 * 从旧的移动副本里切出注入块（从触控层说明注释开头，到 </script> 结束）
 * @param {string} html 旧移动副本全文
 * @returns {string} 注入块原文（含首尾换行前的全部字符）
 */
function extractBlock(html) {
  const styleAt = html.indexOf('<style id="arcm-style">');
  if (styleAt < 0) throw new Error('旧副本里找不到 <style id="arcm-style">');
  const commentAt = html.lastIndexOf('<!--', styleAt);
  if (commentAt < 0) throw new Error('旧副本里找不到注入块开头的注释');
  const goalAt = html.indexOf('<div id="arcmGoal"', styleAt);
  if (goalAt < 0) throw new Error('旧副本里找不到 #arcmGoal');
  const scriptEnd = html.indexOf('</script>', goalAt);
  if (scriptEnd < 0) throw new Error('旧副本里找不到注入块的 </script>');
  return html.slice(commentAt, scriptEnd + '</script>'.length);
}

/** 统计子串出现次数（自检用） */
function count(hay, needle) {
  let n = 0;
  let i = 0;
  for (;;) {
    const at = hay.indexOf(needle, i);
    if (at < 0) return n;
    n += 1;
    i = at + needle.length;
  }
}

const master = fs.readFileSync(MASTER, 'utf8');

/* 1) 取注入块：优先用已落盘的标准块，没有再从未重建的旧副本里抽 */
let block;
if (fs.existsSync(BLOCK_FILE)) {
  block = fs.readFileSync(BLOCK_FILE, 'utf8');
} else {
  block = extractBlock(fs.readFileSync(MOBILE, 'utf8'));
  fs.mkdirSync(path.dirname(BLOCK_FILE), { recursive: true });
  fs.writeFileSync(BLOCK_FILE, block, 'utf8');
  console.log('已抽出注入块 →', BLOCK_FILE, Buffer.byteLength(block), 'B');
}

/* 2) 插入到最后一个 </body> 之前 */
const bodyAt = master.lastIndexOf('</body>');
if (bodyAt < 0) throw new Error('主文件里找不到 </body>');
const out = master.slice(0, bodyAt) + block + '\n' + master.slice(bodyAt);

/* 3) 自检：块逐字节存在 + 锚点唯一 */
const missing = ['<style id="arcm-style">', '<div id="arcmShade"', '<div id="arcmStick"',
  '<div id="arcmPad"', '<button type="button" id="arcmDeckBtn"', '<div id="arcmGoal"']
  .filter((needle) => count(out, needle) !== 1);
if (missing.length) throw new Error('注入自检失败（缺失或重复）：' + missing.join(' / '));
if (out.indexOf(block) < 0) throw new Error('注入自检失败：注入块没有逐字节进入副本');
if (Buffer.byteLength(out) !== Buffer.byteLength(master) + Buffer.byteLength(block) + 1) {
  throw new Error('注入自检失败：字节数不等于 主文件 + 块 + 换行');
}

fs.writeFileSync(MOBILE, out, 'utf8');
console.log('主文件  ', Buffer.byteLength(master), 'B', master.split('\n').length, '行');
console.log('注入块  ', Buffer.byteLength(block), 'B', block.split('\n').length, '行');
console.log('新副本  ', Buffer.byteLength(out), 'B', out.split('\n').length, '行 →', MOBILE);
