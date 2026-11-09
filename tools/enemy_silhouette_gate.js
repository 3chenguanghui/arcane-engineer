/**
 * 敌人剪影门禁（28 对距离矩阵）
 * ============================================================
 * 用途：把「8 个兵种」的剪影做成可复跑的几何门禁。
 *   1) 正上方投影：把每个兵种用游戏内真实绘制函数画到 256px 离屏画布，
 *      等比缩到 64px，得到二值轮廓图；
 *   2) 正前方投影：沿兵种朝向轴做行宽剖面（32 段），等价于正视 billboard 轮廓；
 *   3) 两两距离：顶视图用"95 分位对称 Hausdorff 距离"（轮廓最远差异，
 *      对"多一根角/一条尾"敏感；均值切角仅作辅助诊断），
 *      正视图用"行宽剖面平均差"，合成距离 = 0.65 * 顶视 H95 + 0.35 * 正视。
 *
 * 口径：
 *   · 顶视 H95 按 64px 画布归一化，所以结果是无量纲的 0~1 附近数值；
 *   · 50% 档 = 先缩到 128px 再缩到 64px，模拟玩家把画面缩一半后丢失细节；
 *   · 阈值 0.09：任意一对 < 0.09 判不合格；
 *   · alpha >= 45 视为本体（与游戏内 silhouetteMetricOf 同一口径）。
 *
 * 安全约束：
 *   · 本脚本绝不写主文件。它先复制一份临时快照到主文件同目录，
 *     验证完在 finally 里删除；主文件只读。
 *   · 默认只开一个无头 Edge，跑完即杀；可用独立 profile 避免与其他线抢锁。
 *
 * 用法：
 *   node tools/enemy_silhouette_gate.js
 *   node tools/enemy_silhouette_gate.js --file "D:\...\index_arcane_v2.html"
 *   node tools/enemy_silhouette_gate.js --json ".screenshots/art/enemy-silhouette-gate.json"
 *
 * 退出码：0 = 全部 >= 0.09；1 = 存在不合格对；2 = 环境/读取失败。
 */
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9553;
const ROOT = path.join(__dirname, '..');
const DEFAULT_FILE = path.join(ROOT, 'index_arcane_v2.html');
const THRESHOLD = 0.09;
const CANON = 64;          // 顶视轮廓归一化边长（像素）
const PROFILE_BINS = 32;   // 正视图行宽剖面段数
const W_TOP = 0.65;        // 顶视权重
const W_FRONT = 0.35;      // 正视权重

/* 8 个兵种：前五层会实际遇到的 8 个基础类型。
   「自爆熔核」映射到 voidbishop：它是全表唯一"濒死自爆"的兵种，
   外形是尖顶六边冠 + 深色内核；如果想改测炉心祭司，把 id 换成
   forgepriest 即可，其余代码不用动。 */
const ROSTER = [
  { id: 'wanderer',   name: '游荡体' },
  { id: 'shooter',    name: '射手傀儡' },
  { id: 'phaser',     name: '相位兽' },
  { id: 'runesprite', name: '符灵' },
  { id: 'graveter',   name: '碑卫' },
  { id: 'hexer',      name: '咒术体' },
  { id: 'forgepriest',name: '炉心祭司' },
  { id: 'voidbishop', name: '虚空主教（自爆熔核）' }
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 读取文件并一次性算出字节数 / MD5（单快照，避免"先取长度再算哈希"的撕裂读数）
 * @param {string} file 文件绝对路径
 * @returns {{bytes:number, md5:string, buf:Buffer}}
 */
function snapshotRead(file) {
  const buf = fs.readFileSync(file);
  const md5 = crypto.createHash('md5').update(buf).digest('hex').toUpperCase();
  return { bytes: buf.length, md5, buf };
}

/**
 * 解析命令行参数（只支持 --file / --json 两个可选参数）
 * @returns {{file:string, json:string}}
 */
function parseArgs() {
  const argv = process.argv.slice(2);
  let file = DEFAULT_FILE;
  let json = path.join(ROOT, '.screenshots', 'art', 'enemy-silhouette-gate.json');
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--file' && argv[i + 1]) file = path.resolve(argv[i + 1]);
    if (argv[i] === '--json' && argv[i + 1]) json = path.resolve(argv[i + 1]);
  }
  return { file, json };
}

/**
 * 准备独立 profile 目录（不与其他测试线共用 .testprofile 锁）
 * @param {string} tag 本次运行的唯一标签
 * @returns {string} profile 路径
 */
function prepareProfile(tag) {
  const dir = path.join(ROOT, '.testprofile_silh', tag);
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * 在 Windows 上结束整棵 Edge 进程树
 * @param {import('child_process').ChildProcess|null} proc Edge 子进程
 * @returns {void}
 */
function killEdge(proc) {
  if (!proc) return;
  try { spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { /* 已退出 */ }
}

/**
 * 把一串掩码像素转成轮廓点集（4 邻域任一为空即视为轮廓）
 * @param {Uint8Array} mask 64×64 二值图
 * @param {number} box 边长
 * @returns {Array<{x:number,y:number}>}
 */
function contourOf(mask, box) {
  const out = [];
  for (let y = 0; y < box; y += 1) {
    for (let x = 0; x < box; x += 1) {
      if (!mask[y * box + x]) continue;
      const up = y > 0 ? mask[(y - 1) * box + x] : 0;
      const down = y < box - 1 ? mask[(y + 1) * box + x] : 0;
      const left = x > 0 ? mask[y * box + x - 1] : 0;
      const right = x < box - 1 ? mask[y * box + x + 1] : 0;
      if (!up || !down || !left || !right) out.push({ x, y });
    }
  }
  return out;
}

/**
 * 单个点到目标点集的最小欧氏距离
 * @param {{x:number,y:number}} p 源点
 * @param {Array<{x:number,y:number}>} pts 目标点集
 * @returns {number} 距离（像素）
 */
function nearestDist(p, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length; i += 1) {
    const dx = p.x - pts[i].x;
    const dy = p.y - pts[i].y;
    const d2 = dx * dx + dy * dy;
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}

/**
 * 95 分位对称 Hausdorff 距离（顶视投影，主判据）
 * 说明：均值切角会把"多出来的一根角/一条尾"摊平到所有轮廓点里，对辨识度不敏感；
 *      取 95 分位等价于问"轮廓上最不像的那 5% 差多远"，正是玩家用来认形状的判据。
 * @param {Uint8Array} a 掩码 A
 * @param {Uint8Array} b 掩码 B
 * @param {number} box 边长
 * @returns {number} 归一化距离
 */
function hausdorff95(a, b, box) {
  const ca = contourOf(a, box);
  const cb = contourOf(b, box);
  if (!ca.length || !cb.length) return 1;
  const da = ca.map((p) => nearestDist(p, cb)).sort((x, y) => x - y);
  const db = cb.map((p) => nearestDist(p, ca)).sort((x, y) => x - y);
  const pick = (arr) => arr[Math.min(arr.length - 1, Math.ceil(arr.length * 0.95) - 1)];
  return Math.max(pick(da), pick(db)) / box;
}

/**
 * 对称切角距离（顶视投影，辅助诊断：看整体偏移，不看末端差异）
 * @param {Uint8Array} a 掩码 A
 * @param {Uint8Array} b 掩码 B
 * @param {number} box 边长
 * @returns {number} 归一化距离
 */
function chamferTop(a, b, box) {
  const ca = contourOf(a, box);
  const cb = contourOf(b, box);
  if (!ca.length || !cb.length) return 1;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < ca.length; i += 1) sa += nearestDist(ca[i], cb);
  for (let i = 0; i < cb.length; i += 1) sb += nearestDist(cb[i], ca);
  const mean = (sa / ca.length + sb / cb.length) / 2;
  return mean / box;
}

/**
 * 行宽剖面（正视投影）：每一行有多少个实心像素，按该图自己的最大行宽归一化
 * @param {Uint8Array} mask 掩码
 * @param {number} box 边长
 * @param {number} bins 段数
 * @returns {number[]} 长度 bins 的剖面
 */
function frontProfile(mask, box, bins) {
  // 先找包围盒与最大行宽
  let minY = box; let maxY = -1; let maxW = 1;
  for (let y = 0; y < box; y += 1) {
    let count = 0;
    for (let x = 0; x < box; x += 1) if (mask[y * box + x]) count += 1;
    if (count > 0) {
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (count > maxW) maxW = count;
    }
  }
  if (maxY < 0) return new Array(bins).fill(0);
  const h = maxY - minY + 1;
  const out = new Array(bins).fill(0);
  const acc = new Array(bins).fill(0);
  for (let y = minY; y <= maxY; y += 1) {
    const bin = Math.min(bins - 1, Math.floor(((y - minY) / h) * bins));
    let count = 0;
    for (let x = 0; x < box; x += 1) if (mask[y * box + x]) count += 1;
    acc[bin] += count / maxW;
    out[bin] += 1;
  }
  for (let i = 0; i < bins; i += 1) out[i] = out[i] ? acc[i] / out[i] : 0;
  return out;
}

/**
 * 两条剖面的平均绝对差（正视投影距离）
 * @param {number[]} a 剖面 A
 * @param {number[]} b 剖面 B
 * @returns {number} 距离
 */
function profileDist(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

/**
 * 感知亮度（Rec.709），用于灰度撞车检查
 * @param {number} r 红
 * @param {number} g 绿
 * @param {number} b 蓝
 * @returns {number} 0~255
 */
function lum709(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * 页面内抓取掩码：只在离屏画布上调用游戏真实的 drawUnitForSilhouette，
 * 不复制任何绘制逻辑；返回 64×64 二值图、包围盒、平均色与高光色。
 * @param {Array<{id:string}>} roster 兵种清单
 * @returns {Array<Object>} 抓取结果
 */
async function grabMasks(ev, roster) {
  const expr = `(function(){
    const roster = ${JSON.stringify(roster)};
    const CANON = ${CANON};
    const KEY0 = 'silh_gate_';
    /**
     * 把某个兵种画到 256px 原生画布，再等比缩到目标 box
     * @param {string} key 兵种 id
     * @param {number} preBox 预渲染边长（256=100%，128=50%）
     * @returns {Object|null} 掩码与颜色统计
     */
    function raster(key, preBox) {
      const native = document.createElement('canvas');
      native.width = 256; native.height = 256;
      const gN = native.getContext('2d');
      const prev = ctx;
      ctx = gN;
      gN.clearRect(0, 0, 256, 256);
      gN.save();
      gN.translate(128, 128);
      let ok = false;
      try { ok = drawUnitForSilhouette(key); } catch (err) { ok = false; }
      gN.restore();
      ctx = prev;
      if (!ok) return null;
      const nat = silhouetteMetricOf(gN, 256, key);
      if (!nat) return null;
      // 100% 档：256 → 64；50% 档：256 → 128 → 64（模拟缩一半后丢失细节）
      const mid = document.createElement('canvas');
      const mk = (preBox * 0.94) / Math.max(nat.bbox.w, nat.bbox.h);
      mid.width = preBox; mid.height = preBox;
      const gm = mid.getContext('2d');
      gm.imageSmoothingEnabled = true;
      gm.drawImage(native, 0, 0, 256, 256, (preBox - 256 * mk) / 2, (preBox - 256 * mk) / 2, 256 * mk, 256 * mk);
      const out = document.createElement('canvas');
      out.width = CANON; out.height = CANON;
      const go = out.getContext('2d');
      go.imageSmoothingEnabled = true;
      go.drawImage(mid, 0, 0, preBox, preBox, 0, 0, CANON, CANON);
      const data = go.getImageData(0, 0, CANON, CANON).data;
      const mask = new Uint8Array(CANON * CANON);
      let area = 0; let sr = 0, sg = 0, sb = 0;
      const lit = [];
      for (let y = 0; y < CANON; y += 1) {
        for (let x = 0; x < CANON; x += 1) {
          const i = (y * CANON + x) * 4;
          if (data[i + 3] >= 45) {
            mask[y * CANON + x] = 1;
            area += 1;
            sr += data[i]; sg += data[i + 1]; sb += data[i + 2];
            lit.push({ lum: 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2], r: data[i], g: data[i + 1], b: data[i + 2] });
          }
        }
      }
      if (!area) return null;
      lit.sort((p, q) => q.lum - p.lum);
      const topN = Math.max(1, Math.round(lit.length * 0.3));
      let gr = 0, gg = 0, gb = 0;
      for (let k = 0; k < topN; k += 1) { gr += lit[k].r; gg += lit[k].g; gb += lit[k].b; }
      return {
        key,
        mask: Array.from(mask),
        area,
        meanColor: { r: Math.round(sr / area), g: Math.round(sg / area), b: Math.round(sb / area) },
        glowColor: { r: Math.round(gr / topN), g: Math.round(gg / topN), b: Math.round(gb / topN) },
        naturalBBox: nat.bbox
      };
    }
    if (typeof state !== 'undefined') {
      state.elapsed = 0; state.time = 0;
      if (state.artV2) state.artV2.enabled = true;
    }
    const out = { units: [], errors: [] };
    roster.forEach((item) => {
      try {
        const a = raster(item.id, 256);
        const b = raster(item.id, 128);
        if (!a || !b) { out.errors.push(item.id); return; }
        // 旧口径对照：游戏自带的 unitSilhouetteAt(60)（宽高比/边缘复杂度/填充率）
        let m60 = null;
        try { m60 = window.__roamDebug.unitSilhouetteAt(item.id, 60); } catch (err) { m60 = null; }
        out.units.push({ id: item.id, name: item.name, at100: a, at50: b, m60 });
      } catch (err) { out.errors.push(item.id + ': ' + String(err)); }
    });
    return out;
  })()`;
  return ev(expr);
}

/**
 * 主流程：快照 → 启动无头 Edge → 抓掩码 → 算 28 对 → 输出报告
 * @returns {Promise<number>} 进程退出码
 */
async function main() {
  const { file, json } = parseArgs();
  if (!fs.existsSync(file)) {
    console.error('FAIL · 主文件不存在: ' + file);
    return 2;
  }
  if (!fs.existsSync(EDGE)) {
    console.error('FAIL · 未找到 Edge: ' + EDGE);
    return 2;
  }

  const snap = snapshotRead(file);
  console.log('=== 敌人剪影门禁 ===');
  console.log('主文件(只读): ' + file);
  console.log('字节=' + snap.bytes + ' MD5=' + snap.md5);

  // 复制到主文件同目录，保证 file:// 相对路径行为与主文件一致；跑完删除
  const tmp = path.join(path.dirname(file), '.silh_snapshot_' + snap.md5.slice(0, 8) + '.html');
  fs.writeFileSync(tmp, snap.buf);
  const tmpMd5 = snapshotRead(tmp).md5;
  if (tmpMd5 !== snap.md5) {
    console.error('FAIL · 快照 MD5 与主文件不一致，停止');
    try { fs.unlinkSync(tmp); } catch (e) { /* ignore */ }
    return 2;
  }

  const profile = prepareProfile('silh_' + snap.md5.slice(0, 8) + '_' + Date.now());
  let edge = null;
  let ws = null;
  let result = 2;
  try {
    edge = spawn(EDGE, [
      `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
      '--headless=new', '--no-first-run', '--no-default-browser-check',
      '--disable-extensions', '--allow-file-access-from-files',
      '--disable-gpu', '--window-size=420,420', 'about:blank'
    ], { stdio: 'ignore' });

    let target = null;
    for (let i = 0; i < 120; i += 1) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
        target = list.find((t) => t.type === 'page');
        if (target) break;
      } catch (e) { /* Edge 还在启动 */ }
      await sleep(250);
    }
    if (!target) throw new Error('Edge 未就绪');

    ws = new WebSocket(target.webSocketDebuggerUrl);
    let seq = 0;
    const pending = new Map();
    ws.onmessage = (msg) => {
      const m = JSON.parse(msg.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    };
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

    /**
     * 发送 CDP 命令
     * @param {string} method 方法名
     * @param {Object} [params] 参数
     * @returns {Promise<Object>}
     */
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      seq += 1;
      pending.set(seq, (m) => (m.error ? reject(new Error(method + ': ' + JSON.stringify(m.error))) : resolve(m.result)));
      ws.send(JSON.stringify({ id: seq, method, params }));
    });
    /**
     * 页面内执行表达式
     * @param {string} expression JS 表达式
     * @returns {Promise<*>}
     */
    const ev = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };

    await send('Runtime.enable');
    await send('Page.enable');
    await send('Page.navigate', { url: 'file:///' + tmp.replace(/\\/g, '/') });
    for (let i = 0; i < 80; i += 1) {
      const ready = await ev(`(typeof drawUnitForSilhouette === 'function' && typeof silhouetteMetricOf === 'function' && typeof ENEMY_CONFIG !== 'undefined')`);
      if (ready) break;
      await sleep(250);
    }
    const ready = await ev(`(typeof drawUnitForSilhouette === 'function')`);
    if (!ready) throw new Error('页面未就绪（drawUnitForSilhouette 不存在）');

    console.log('\n=== 兵种映射（8 个，前五层基础类型） ===');
    ROSTER.forEach((u, i) => console.log(`  ${i + 1}. ${u.id.padEnd(12)} ${u.name}`));

    const grabbed = await grabMasks(ev, ROSTER);
    if (!grabbed || grabbed.errors.length) throw new Error('抓取失败: ' + JSON.stringify(grabbed && grabbed.errors));

    // ---------- 计算 28 对 ----------
    const scaleName = ['at100', 'at50'];
    const reports = {};
    scaleName.forEach((sk) => {
      const units = grabbed.units.map((u) => u[sk]);
      const matrix = [];
      for (let i = 0; i < units.length; i += 1) {
        matrix[i] = [];
        for (let j = 0; j < units.length; j += 1) matrix[i][j] = 0;
      }
      const pairs = [];
      for (let i = 0; i < units.length; i += 1) {
        for (let j = i + 1; j < units.length; j += 1) {
          const A = new Uint8Array(units[i].mask);
          const B = new Uint8Array(units[j].mask);
          const h95 = hausdorff95(A, B, CANON);
          const top = chamferTop(A, B, CANON);
          const front = profileDist(frontProfile(A, CANON, PROFILE_BINS), frontProfile(B, CANON, PROFILE_BINS));
          const d = W_TOP * h95 + W_FRONT * front;
          matrix[i][j] = d; matrix[j][i] = d;
          pairs.push({
            pair: ROSTER[i].id + ' / ' + ROSTER[j].id,
            a: ROSTER[i].name, b: ROSTER[j].name,
            d: Number(d.toFixed(4)),
            h95: Number(h95.toFixed(4)),
            meanTop: Number(top.toFixed(4)),
            front: Number(front.toFixed(4))
          });
        }
      }
      pairs.sort((p, q) => p.d - q.d);
      const fails = pairs.filter((p) => p.d < THRESHOLD);
      reports[sk] = { matrix, pairs, fails, min: pairs[0], max: pairs[pairs.length - 1] };
    });

    // ---------- 打印 100% 主矩阵 ----------
    const r100 = reports.at100;
    console.log('\n=== 28 对距离矩阵（100%，阈值 ' + THRESHOLD + '） ===');
    console.log('序号 兵种'.padEnd(20) + ROSTER.map((u, i) => String(i + 1).padStart(6)).join(''));
    ROSTER.forEach((u, i) => {
      const row = String(i + 1).padStart(2) + ' ' + u.id;
      const cells = ROSTER.map((v, j) => (j <= i ? '     -' : r100.matrix[i][j].toFixed(3).padStart(6))).join('');
      console.log(row.padEnd(20) + cells);
    });
    console.log('\n最近一对: ' + r100.min.pair + ' = ' + r100.min.d.toFixed(4)
      + '（H95 ' + r100.min.h95.toFixed(4) + ' / 正视 ' + r100.min.front.toFixed(4) + ' / 均值切角 ' + r100.min.meanTop.toFixed(4) + '）');
    console.log('最远一对: ' + r100.max.pair + ' = ' + r100.max.d.toFixed(4));
    console.log('不合格(<' + THRESHOLD + '): ' + (r100.fails.length ? r100.fails.map((p) => p.pair + '=' + p.d.toFixed(4)).join('; ') : '无'));

    // ---------- 打印 50% 矩阵 ----------
    const r50 = reports.at50;
    console.log('\n=== 28 对距离矩阵（50%，阈值 ' + THRESHOLD + '） ===');
    console.log('序号 兵种'.padEnd(20) + ROSTER.map((u, i) => String(i + 1).padStart(6)).join(''));
    ROSTER.forEach((u, i) => {
      const row = String(i + 1).padStart(2) + ' ' + u.id;
      const cells = ROSTER.map((v, j) => (j <= i ? '     -' : r50.matrix[i][j].toFixed(3).padStart(6))).join('');
      console.log(row.padEnd(20) + cells);
    });
    console.log('\n最近一对: ' + r50.min.pair + ' = ' + r50.min.d.toFixed(4)
      + '（H95 ' + r50.min.h95.toFixed(4) + ' / 正视 ' + r50.min.front.toFixed(4) + '）');
    console.log('不合格(<' + THRESHOLD + '): ' + (r50.fails.length ? r50.fails.map((p) => p.pair + '=' + p.d.toFixed(4)).join('; ') : '无'));

    // ---------- 明细表（全 28 对，按距离升序） ----------
    console.log('\n=== 全 28 对明细（100% 口径，升序） ===');
    r100.pairs.forEach((p) => console.log('  ' + p.d.toFixed(4) + '  ' + p.pair
      + '  [H95 ' + p.h95.toFixed(4) + ' / 正视 ' + p.front.toFixed(4) + ' / 均值切角 ' + p.meanTop.toFixed(4) + ']'));

    // ---------- 灰度亮度撞车（辅助，不作为门禁） ----------
    console.log('\n=== 灰度亮度（均值 / 高光 30%） ===');
    const lumRows = grabbed.units.map((u) => ({
      id: u.id, name: u.name,
      mean: Number(lum709(u.at100.meanColor.r, u.at100.meanColor.g, u.at100.meanColor.b).toFixed(2)),
      glow: Number(lum709(u.at100.glowColor.r, u.at100.glowColor.g, u.at100.glowColor.b).toFixed(2))
    }));
    lumRows.forEach((r) => console.log('  ' + r.id.padEnd(12) + ' mean=' + r.mean.toFixed(2).padStart(7) + '  glow=' + r.glow.toFixed(2).padStart(7)));
    const lumPairs = [];
    for (let i = 0; i < lumRows.length; i += 1) {
      for (let j = i + 1; j < lumRows.length; j += 1) {
        lumPairs.push({ pair: lumRows[i].id + ' / ' + lumRows[j].id, dMean: Math.abs(lumRows[i].mean - lumRows[j].mean), dGlow: Math.abs(lumRows[i].glow - lumRows[j].glow) });
      }
    }
    lumPairs.sort((a, b) => a.dGlow - b.dGlow);
    console.log('  亮度最接近的 6 对（按高光口径）:');
    lumPairs.slice(0, 6).forEach((p) => console.log('    ' + p.pair + ' Δglow=' + p.dGlow.toFixed(2) + ' Δmean=' + p.dMean.toFixed(2)));

    // ---------- 旧口径对照（宽高比 + 边缘复杂度/3 + 填充率） ----------
    const oldUnits = grabbed.units.filter((u) => u.m60);
    const oldPairs = [];
    for (let i = 0; i < oldUnits.length; i += 1) {
      for (let j = i + 1; j < oldUnits.length; j += 1) {
        const a = oldUnits[i].m60;
        const b = oldUnits[j].m60;
        const d = Math.abs(a.aspect - b.aspect) + Math.abs(a.complexity - b.complexity) / 3 + Math.abs(a.fill - b.fill);
        oldPairs.push({ pair: oldUnits[i].id + ' / ' + oldUnits[j].id, d: Number(d.toFixed(4)) });
      }
    }
    oldPairs.sort((p, q) => p.d - q.d);
    console.log('\n=== 旧口径对照（unitSilhouetteAt 60px 特征距离，升序前 6） ===');
    oldPairs.slice(0, 6).forEach((p) => console.log('  ' + p.d.toFixed(4) + '  ' + p.pair));
    console.log('  旧口径最近一对: ' + oldPairs[0].pair + ' = ' + oldPairs[0].d.toFixed(4));

    // ---------- 落盘 JSON ----------
    const payload = {
      file, sourceBytes: snap.bytes, sourceMd5: snap.md5,
      threshold: THRESHOLD, canon: CANON, weights: { top: W_TOP, front: W_FRONT },
      roster: ROSTER,
      at100: { pairs: r100.pairs, fails: r100.fails, min: r100.min, max: r100.max },
      at50: { pairs: r50.pairs, fails: r50.fails, min: r50.min, max: r50.max },
      luminance: { units: lumRows, pairs: lumPairs },
      legacyFeatureMetric: { pairs: oldPairs, min: oldPairs[0] || null },
      createdAt: new Date().toISOString()
    };
    fs.mkdirSync(path.dirname(json), { recursive: true });
    fs.writeFileSync(json, JSON.stringify(payload, null, 2), 'utf8');
    console.log('\n结果 JSON: ' + json);

    const totalFails = new Set([...r100.fails.map((p) => p.pair), ...r50.fails.map((p) => p.pair)]);
    result = totalFails.size ? 1 : 0;
    console.log('\n' + (result === 0 ? 'PASS' : 'FAIL') + ' · 不合格对数=' + totalFails.size);
  } catch (err) {
    console.error('FAIL · ' + (err && err.message ? err.message : String(err)));
    result = 2;
  } finally {
    try { if (ws) ws.close(); } catch (e) { /* ignore */ }
    killEdge(edge);
    await sleep(300);
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch (e) { /* ignore */ }
    try { fs.unlinkSync(tmp); } catch (e) { /* ignore */ }
  }
  return result;
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error(err);
  process.exit(2);
});
