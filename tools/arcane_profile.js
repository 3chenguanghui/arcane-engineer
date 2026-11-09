/**
 * 测试用 Edge profile 统一管理（防止 Temp 目录泄漏）
 * ------------------------------------------------------------
 * 根因：每个测试脚本原来自建 `os.tmpdir()/edge-xxx-*` 临时 profile 且从不清理，
 * 导致 Temp 下堆积上千个 profile 目录、几十 GB 空间。
 * 现在统一改为：
 *   1. 固定复用 `<项目根>/.testprofile/edge`（不再写 Temp）；
 *   2. 每次启动前先删掉上一次残留，保证 localStorage 等状态干净（等价于"全新 profile"）；
 *   3. 注册 process exit 钩子，正常退出 / process.exit(1) / 抛错都会同步清理；
 *   4. `killEdge()` 在 Windows 上用 taskkill /T /F 结束整棵 Edge 进程树，
 *      避免主进程退出后子进程继续占用 profile 目录。
 * 用法：`const { prepareProfile, killEdge } = require('./arcane_profile');`
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

/* 允许用环境变量指定独立 profile 根目录：
   多人/多线并发时会抢同一个 .testprofile 锁，导致 Edge 起不来（调试端口未就绪）。
   不设该变量时行为与原来完全一致，仍在项目根 .testprofile 下。 */
const PROFILE_ROOT = process.env.ARCANE_PROFILE_ROOT
  ? path.resolve(process.env.ARCANE_PROFILE_ROOT)
  : path.join(__dirname, '..', '.testprofile');
const PROFILE_DIR = path.join(PROFILE_ROOT, 'edge');
let exitHookBound = false;

/**
 * 删除一个目录（Windows 上文件可能被 Edge 短暂占用，带重试）
 * @param {string} dir 目录
 * @returns {boolean} 是否删除成功
 */
function rmDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 12, retryDelay: 250 });
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * 退出时清理固定 profile（同步执行，process.exit 也会触发）
 * @returns {void}
 */
function cleanupProfile() {
  rmDir(PROFILE_DIR);
  // 连空的根目录一起收掉，避免项目里留下一个空的 .testprofile
  try { fs.rmdirSync(PROFILE_ROOT); } catch (error) { /* 非空或已被占用 */ }
}

/**
 * 准备一个干净、固定路径的测试 profile
 * @returns {string} profile 目录
 */
function prepareProfile() {
  if (!exitHookBound) {
    // 只绑定一次：进程以任何方式退出时都清掉 .testprofile/edge
    process.on('exit', cleanupProfile);
    exitHookBound = true;
  }
  rmDir(PROFILE_DIR);
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  return PROFILE_DIR;
}

/**
 * 同步睡眠（主线程可用，避免清理时引入异步流程）
 * @param {number} ms 毫秒
 * @returns {void}
 */
function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch (error) {
    const until = Date.now() + ms;
    while (Date.now() < until) { /* 忙等兜底 */ }
  }
}

/**
 * 结束测试启动的 Edge（整棵进程树），并等它释放 profile 锁后立刻删除
 * ------------------------------------------------------------
 * 注意：Windows 上 taskkill 返回时子进程可能还没完全退出，
 * 直接删 profile 会失败并留下缓存。这里做同步重试（最多约 3 秒），
 * 确保"脚本结束即清理"，而不是等下一次 prepareProfile 才复用。
 * @param {import('child_process').ChildProcess} edge Edge 子进程
 * @returns {void}
 */
function killEdge(edge) {
  if (!edge) return;
  try {
    if (process.platform === 'win32' && edge.pid) {
      spawnSync('taskkill', ['/PID', String(edge.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      edge.kill('SIGKILL');
    }
  } catch (error) {
    try { edge.kill(); } catch (ignored) { /* 已退出 */ }
  }
  for (let i = 0; i < 12; i += 1) {
    if (rmDir(PROFILE_DIR)) break;
    sleepSync(250);
  }
  try { fs.rmdirSync(PROFILE_ROOT); } catch (error) { /* 非空 */ }
}

/**
 * 自动挂载断言分类器
 * ------------------------------------------------------------
 * 所有测试脚本都会 require 本文件，因此在这一处安装即可全局生效：
 * 把 fps / 帧率 这类"负载敏感"断言改判为 PERF(只记录、不判失败)，
 * 功能类断言保持 PASS/FAIL 判红。详见 `tools/arcane_assert.js`。
 */
require('./arcane_assert').installPerfClassifier();

module.exports = { PROFILE_ROOT, PROFILE_DIR, prepareProfile, cleanupProfile, killEdge };
