/**
 * 共享导航模块（页面侧注入用）
 * ------------------------------------------------------------
 * 背景：平衡采样 bot 的走位是"38px 贪心"——只看眼前一格能不能走、走完离目标更近。
 *       这种局部贪心在 F8 那种"房间中间有内墙/柱子、玩家出生在墙这一侧"的布局里会卡死：
 *       实测 75s 只打出 0.3–1.0 DPS，所有敌人都隔着墙（LOS 采样 12 点有 4–8 点不可站立）。
 *
 *       这不是游戏机制缺陷（玩家肉眼能看到墙、也能绕过去），而是量尺缺陷：
 *       它会把"仪器卡住"错误地记成"F8 清不掉"。
 *
 * 做法：28px 栅格 + BFS 流场。只在"连续 0.5s 打不出伤害"时接管方向，
 *       平时仍然用原来的贴脸/拉扯逻辑，保证老样本的可比性。
 *       栅格只在换房间时重建一次；BFS 每次约 400 格，成本可以忽略。
 *
 * 注入方式：宿主脚本把 NAV_SRC 插进 Runtime.evaluate 的表达式字符串里。
 * 注意本文件里不能出现反引号和 ${，否则会污染外层模板字符串。
 */

const NAV_SRC = `
window.__nav = {
  cache: null,
  /**
   * 为当前房间构建栅格（一次）
   * @param {Object} room 房间对象（x/y/w/h/id）
   * @returns {Object} 栅格缓存
   */
  build(room) {
    const cell = 16;
    const cols = Math.max(1, Math.ceil(room.w / cell));
    const rows = Math.max(1, Math.ceil(room.h / cell));
    const ok = new Uint8Array(cols * rows);
    let okCount = 0;
    for (let gy = 0; gy < rows; gy += 1) {
      for (let gx = 0; gx < cols; gx += 1) {
        const x = room.x + cell * 0.5 + gx * cell;
        const y = room.y + cell * 0.5 + gy * cell;
        // 半径必须和玩家实际碰撞半径一致（之前用 8，BFS 会把"玩家挤不过去的窄缝"当成可走，
        // 结果方向正确但人物贴着墙原地抖动 —— 这是 focus2/3 里 navTicks 很高却仍然卡死的原因）
        const free = __roamDebug.walkableAt(x, y, 14) ? 1 : 0;
        ok[gy * cols + gx] = free;
        okCount += free;
      }
    }
    this.cache = {
      key: room.id + ':' + Math.round(room.x) + ':' + Math.round(room.y)
        + ':' + Math.round(room.w) + ':' + Math.round(room.h),
      id: room.id, room: room, cell: cell, cols: cols, rows: rows, ok: ok,
      okCount: okCount,
      dist: new Int16Array(cols * rows), queue: new Int32Array(cols * rows)
    };
    return this.cache;
  },
  /**
   * 确保栅格与当前房间一致
   * ------------------------------------------------------------
   * 缓存键必须带上几何信息：房间 id 每层都从 0 重新编号，
   * 只按 id 比较会让"新一层同 id 的房间"复用上一层的旧栅格，
   * BFS 于是在一张不存在的几何上找路（方向指向墙里），表现为永久站桩。
   * @param {Object} room 房间
   * @returns {Object|null} 栅格缓存
   */
  ensure(room) {
    if (!room) return null;
    const key = room.id + ':' + Math.round(room.x) + ':' + Math.round(room.y)
      + ':' + Math.round(room.w) + ':' + Math.round(room.h);
    if (!this.cache || this.cache.key !== key) this.build(room);
    return this.cache;
  },
  /**
   * 世界坐标 → 栅格下标
   * @returns {number} 下标
   */
  cell(c, x, y) {
    const gx = Math.max(0, Math.min(c.cols - 1, Math.floor((x - c.room.x) / c.cell)));
    const gy = Math.max(0, Math.min(c.rows - 1, Math.floor((y - c.room.y) / c.cell)));
    return gy * c.cols + gx;
  },
  /**
   * 找到最近的可行走格（敌人可能贴着墙站）
   * @returns {number} 下标，找不到返回 -1
   */
  nearestOk(c, idx) {
    if (c.ok[idx]) return idx;
    const gx0 = idx % c.cols;
    const gy0 = Math.floor(idx / c.cols);
    for (let r = 1; r <= 4; r += 1) {
      for (let dy = -r; dy <= r; dy += 1) {
        for (let dx = -r; dx <= r; dx += 1) {
          const gx = gx0 + dx;
          const gy = gy0 + dy;
          if (gx < 0 || gy < 0 || gx >= c.cols || gy >= c.rows) continue;
          const i2 = gy * c.cols + gx;
          if (c.ok[i2]) return i2;
        }
      }
    }
    return -1;
  },
  /**
   * 以目标为源做 BFS，返回玩家下一步应走的方向
   * @param {number} tx 目标 x
   * @param {number} ty 目标 y
   * @returns {{x:number,y:number}|null} 单位方向（null = 走不过去 / 无需接管）
   */
  flowTo(tx, ty) {
    const c = this.cache;
    if (!c) return null;
    const start = this.nearestOk(c, this.cell(c, tx, ty));
    if (start < 0) return null;
    c.dist.fill(-1);
    let head = 0;
    let tail = 0;
    c.dist[start] = 0;
    c.queue[tail] = start;
    tail += 1;
    while (head < tail) {
      const cur = c.queue[head];
      head += 1;
      const d = c.dist[cur];
      const gx = cur % c.cols;
      const gy = Math.floor(cur / c.cols);
      if (gx > 0) { const n = cur - 1; if (c.ok[n] && c.dist[n] < 0) { c.dist[n] = d + 1; c.queue[tail] = n; tail += 1; } }
      if (gx + 1 < c.cols) { const n = cur + 1; if (c.ok[n] && c.dist[n] < 0) { c.dist[n] = d + 1; c.queue[tail] = n; tail += 1; } }
      if (gy > 0) { const n = cur - c.cols; if (c.ok[n] && c.dist[n] < 0) { c.dist[n] = d + 1; c.queue[tail] = n; tail += 1; } }
      if (gy + 1 < c.rows) { const n = cur + c.cols; if (c.ok[n] && c.dist[n] < 0) { c.dist[n] = d + 1; c.queue[tail] = n; tail += 1; } }
    }
    const p = state.player;
    let pIdx = this.cell(c, p.x, p.y);
    // 玩家脚下的格子可能因为半径判定被标成不可走（贴墙），退回"最近可行格"
    pIdx = this.nearestOk(c, pIdx);
    if (pIdx < 0) { this.stats = { ok: c.okCount, total: c.cols * c.rows, reach: 0, hasDir: false }; return null; }
    const gx = pIdx % c.cols;
    const gy = Math.floor(pIdx / c.cols);
    let best = -1;
    let bestD = c.dist[pIdx] >= 0 ? c.dist[pIdx] : 9999;
    const cand = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (let i = 0; i < cand.length; i += 1) {
      const nx = gx + cand[i][0];
      const ny = gy + cand[i][1];
      if (nx < 0 || ny < 0 || nx >= c.cols || ny >= c.rows) continue;
      const n2 = ny * c.cols + nx;
      if (!c.ok[n2]) continue;
      if (c.dist[n2] < 0) continue;
      if (c.dist[n2] < bestD) { bestD = c.dist[n2]; best = n2; }
    }
    if (best < 0) {
      // 记录可达性：reach 很少说明栅格被墙切碎了（半径/格子尺寸选错），便于下次直接定位
      let reach = 0;
      for (let i = 0; i < c.dist.length; i += 1) if (c.dist[i] >= 0) reach += 1;
      this.stats = { ok: c.okCount, total: c.cols * c.rows, reach: reach, hasDir: false,
        playerDist: c.dist[pIdx] };
      return null;
    }
    const bx = c.room.x + c.cell * 0.5 + (best % c.cols) * c.cell;
    const by = c.room.y + c.cell * 0.5 + Math.floor(best / c.cols) * c.cell;
    const dx = bx - p.x;
    const dy = by - p.y;
    const len = Math.hypot(dx, dy) || 1;
    this.stats = { ok: c.okCount, total: c.cols * c.rows, reach: -1, hasDir: true };
    return { x: dx / len, y: dy / len };
  }
};
`;

module.exports = { NAV_SRC };
