// 入口路径以脚本自身目录（tools/）为基准，项目根 = 上一级目录
﻿// 把「世界底色 + 房间地板」整块替换为：静态场景烘焙（材质/墙体/光照/主题装饰）
const fs = require('fs');
const FILE = process.argv[2] || path.join(__dirname, '..', 'index_arcane_v2.html');
let src = fs.readFileSync(FILE, 'utf8');

const START = '/**\n * 世界底色：深底 + 科技网格 + 边缘辉光\n */';
const END = '/**\n * 画房间中央符文圈与角落技术节点（纯装饰）\n */';
const a = src.indexOf(START);
const b = src.indexOf(END);
if (a < 0 || b < 0 || b < a) { console.error('marker not found', a, b); process.exit(1); }

const block = String.raw`/* ============================================================
   场景静态层（烘焙）
   ------------------------------------------------------------
   每层生成时把地板材质、墙体结构、装饰与房间光一次性画进离屏画布，
   运行期每帧只做一次 drawImage —— 材质细节变多，帧率也不会被拖垮。
   ============================================================ */

let sceneCanvas = null;   // 整层静态场景底图
let sceneScale = 1;       // 底图分辨率倍率（≤1.5，兼顾清晰度与显存）

/**
 * 取离屏底图的 2D 上下文；首次调用按世界尺寸创建，分辨率随 DPR 轻微提升
 * @returns {CanvasRenderingContext2D} 已按 sceneScale 缩放的上下文
 */
function ensureSceneCanvas() {
  const W = GAME_CONFIG.worldWidth;
  const H = GAME_CONFIG.worldHeight;
  sceneScale = Math.min(Math.max(window.devicePixelRatio || 1, 1), 1.5);
  if (!sceneCanvas) sceneCanvas = document.createElement('canvas');
  const pixelW = Math.round(W * sceneScale);
  const pixelH = Math.round(H * sceneScale);
  if (sceneCanvas.width !== pixelW || sceneCanvas.height !== pixelH) {
    sceneCanvas.width = pixelW;
    sceneCanvas.height = pixelH;
  }
  const g = sceneCanvas.getContext('2d');
  g.setTransform(sceneScale, 0, 0, sceneScale, 0, 0);
  return g;
}

/**
 * 每帧把烘焙好的静态底图贴回主画布（相机位移已由外层 translate 处理）
 */
function drawScene() {
  if (!sceneCanvas) return;
  ctx.drawImage(sceneCanvas, 0, 0, GAME_CONFIG.worldWidth, GAME_CONFIG.worldHeight);
}

/**
 * 烘焙整层静态场景：底色 → 走廊 → 房间材质 → 光照 → 墙体 → 装饰
 */
function bakeScene() {
  const g = ensureSceneCanvas();
  const theme = getTheme(state.floor);
  const W = GAME_CONFIG.worldWidth;
  const H = GAME_CONFIG.worldHeight;

  g.clearRect(0, 0, W, H);
  state.themeId = theme.id;
  state.sceneProps = { lights: [], debris: [] };

  paintWorldBase(g, theme);

  // 走廊先铺：更暗的金属踏板，和房间地面明确区分
  state.walkRects.forEach((rect) => {
    const isCorridor = Math.min(rect.w, rect.h) <= GAME_CONFIG.corridorWidth + 8;
    if (!isCorridor) return;
    paintCorridor(g, rect, theme);
    paintWallStructure(g, rect, theme, false);
  });

  // 房间：分层材质（底色 + 地砖 + 噪点 + 污渍）→ 主光源 → 墙厚/接缝 → 角柱 → 主题装饰
  state.rooms.forEach((room, index) => {
    paintRoomFloor(g, room, theme);
    paintRoomLight(g, room, theme);
    paintWallStructure(g, room, theme, true);
    paintPillars(g, room);
    paintThemeProps(g, room, theme);
    paintRoomCorners(g, room, index);
  });

  // 地面裂纹（静态，烘焙一次）
  state.atmosphere.cracks.forEach((crack) => {
    g.strokeStyle = 'rgba(176, 133, 255, 0.13)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(crack.x1, crack.y1);
    g.lineTo(crack.x2, crack.y2);
    g.stroke();
  });

  paintMapBorder(g);
}

/**
 * 世界底座：深色底 + 对角环境色 + 双层工程网格 + 大块暗斑
 * @param {CanvasRenderingContext2D} g 目标上下文
 * @param {Object} theme 当前楼层主题
 */
function paintWorldBase(g, theme) {
  const W = GAME_CONFIG.worldWidth;
  const H = GAME_CONFIG.worldHeight;

  g.fillStyle = theme.floorBase;
  g.fillRect(0, 0, W, H);

  // 对角环境色：左上偏冷、右下偏紫，避免整屏只有一个色相
  const wash = g.createLinearGradient(0, 0, W, H);
  wash.addColorStop(0, 'rgba(20, 50, 82, 0.45)');
  wash.addColorStop(0.5, 'rgba(8, 14, 26, 0.16)');
  wash.addColorStop(1, 'rgba(48, 24, 70, 0.4)');
  g.fillStyle = wash;
  g.fillRect(0, 0, W, H);

  // 60px 细网格 + 180px 粗网格，像工程底图
  g.strokeStyle = 'rgba(86, 150, 210, 0.04)';
  g.lineWidth = 1;
  for (let x = 0; x <= W; x += 60) {
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
  }
  for (let y = 0; y <= H; y += 60) {
    g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
  }
  g.strokeStyle = 'rgba(86, 150, 210, 0.07)';
  for (let x = 0; x <= W; x += 180) {
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
  }
  for (let y = 0; y <= H; y += 180) {
    g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
  }

  // 墙外暗区的大块污渍：打破“纯色底板”的均匀感
  for (let i = 0; i < 26; i += 1) {
    const x = rand(0, W);
    const y = rand(0, H);
    const r = rand(40, 120);
    const blot = g.createRadialGradient(x, y, 2, x, y, r);
    blot.addColorStop(0, 'rgba(0, 0, 0, 0.22)');
    blot.addColorStop(1, 'rgba(0, 0, 0, 0)');
    g.fillStyle = blot;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
}

/**
 * 地图边界：双色描边 + 刻度，提示“不可越过”
 * @param {CanvasRenderingContext2D} g 目标上下文
 */
function paintMapBorder(g) {
  const W = GAME_CONFIG.worldWidth;
  const H = GAME_CONFIG.worldHeight;
  g.strokeStyle = 'rgba(62, 230, 255, 0.2)';
  g.lineWidth = 2;
  g.strokeRect(1, 1, W - 2, H - 2);
  g.strokeStyle = 'rgba(176, 133, 255, 0.1)';
  g.lineWidth = 6;
  g.strokeRect(8, 8, W - 16, H - 16);
}

/**
 * 走廊地面：更暗的金属踏板 + 细条纹 + 中线能量槽
 * @param {CanvasRenderingContext2D} g 目标上下文
 * @param {Object} rect 走廊矩形
 * @param {Object} theme 当前楼层主题
 */
function paintCorridor(g, rect, theme) {
  const grad = g.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.h);
  grad.addColorStop(0, 'rgba(9, 16, 28, 0.985)');
  grad.addColorStop(1, 'rgba(4, 9, 16, 0.985)');
  g.fillStyle = grad;
  roundRectPath(g, rect.x, rect.y, rect.w, rect.h, 5);
  g.fill();

  g.save();
  roundRectPath(g, rect.x, rect.y, rect.w, rect.h, 5);
  g.clip();

  // 金属踏板条纹：沿走廊长边排列
  g.strokeStyle = 'rgba(96, 146, 196, 0.1)';
  g.lineWidth = 1;
  if (rect.w >= rect.h) {
    for (let x = rect.x + 10; x < rect.x + rect.w - 6; x += 20) {
      g.beginPath(); g.moveTo(x, rect.y + 7); g.lineTo(x, rect.y + rect.h - 7); g.stroke();
    }
  } else {
    for (let y = rect.y + 10; y < rect.y + rect.h - 6; y += 20) {
      g.beginPath(); g.moveTo(rect.x + 7, y); g.lineTo(rect.x + rect.w - 7, y); g.stroke();
    }
  }

  // 中线能量槽：淡色微光，强化“这是一条通道”
  g.strokeStyle = 'rgba(' + theme.accent + ', 0.15)';
  g.lineWidth = 2;
  g.beginPath();
  if (rect.w >= rect.h) {
    g.moveTo(rect.x + 8, rect.y + rect.h / 2);
    g.lineTo(rect.x + rect.w - 8, rect.y + rect.h / 2);
  } else {
    g.moveTo(rect.x + rect.w / 2, rect.y + 8);
    g.lineTo(rect.x + rect.w / 2, rect.y + rect.h - 8);
  }
  g.stroke();
  g.restore();
}

/**
 * 房间地面分层材质：底色渐变 + 交错地砖 + 噪点 + 磨损污渍
 * @param {CanvasRenderingContext2D} g 目标上下文
 * @param {Object} room 房间矩形
 * @param {Object} theme 当前楼层主题
 */
function paintRoomFloor(g, room, theme) {
  const base = g.createLinearGradient(room.x, room.y, room.x, room.y + room.h);
  base.addColorStop(0, theme.floorAlt);
  base.addColorStop(1, theme.floorBase);
  g.fillStyle = base;
  roundRectPath(g, room.x, room.y, room.w, room.h, 10);
  g.fill();

  g.save();
  roundRectPath(g, room.x, room.y, room.w, room.h, 10);
  g.clip();

  // 地砖：64px 网格，交错明暗，右下压一道砖缝
  const tile = 64;
  const cols = Math.ceil((room.w - 12) / tile);
  const rows = Math.ceil((room.h - 12) / tile);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = room.x + 6 + col * tile;
      const y = room.y + 6 + row * tile;
      const even = (row + col) % 2 === 0;
      g.fillStyle = 'rgba(255, 255, 255, ' + (even ? theme.tileAlpha : theme.tileAlpha * 0.38).toFixed(3) + ')';
      g.fillRect(x, y, tile - 2, tile - 2);
      g.fillStyle = 'rgba(0, 0, 0, 0.16)';
      g.fillRect(x, y + tile - 2, tile - 2, 2);
      g.fillRect(x + tile - 2, y, 2, tile - 2);
    }
  }

  // 材质噪点：每间房 120 颗 1.5px 微点，模拟粗糙表面
  for (let i = 0; i < 120; i += 1) {
    const px = rand(room.x + 8, room.x + room.w - 8);
    const py = rand(room.y + 8, room.y + room.h - 8);
    g.fillStyle = 'rgba(255, 255, 255, ' + rand(0, theme.noise).toFixed(3) + ')';
    g.fillRect(px, py, 1.5, 1.5);
  }

  // 磨损污渍：5 团径向暗斑
  for (let i = 0; i < 5; i += 1) {
    const px = rand(room.x + 44, room.x + room.w - 44);
    const py = rand(room.y + 44, room.y + room.h - 44);
    const radius = rand(26, 66);
    const stain = g.createRadialGradient(px, py, 2, px, py, radius);
    stain.addColorStop(0, theme.stain);
    stain.addColorStop(1, 'rgba(0, 0, 0, 0)');
    g.fillStyle = stain;
    g.beginPath(); g.arc(px, py, radius, 0, Math.PI * 2); g.fill();
  }

  g.restore();
}

/**
 * 房间主光源：中心一团柔和径向光，玩家在光区、走廊落在暗区
 * @param {CanvasRenderingContext2D} g 目标上下文
 * @param {Object} room 房间矩形
 * @param {Object} theme 当前楼层主题
 */
function paintRoomLight(g, room, theme) {
  const color = theme.light;
  const radius = Math.max(room.w, room.h) * 0.82;
  const cx = room.cx;
  const cy = room.cy - room.h * 0.08;

  g.save();
  roundRectPath(g, room.x, room.y, room.w, room.h, 10);
  g.clip();
  const light = g.createRadialGradient(cx, cy, 10, cx, cy, radius);
  light.addColorStop(0, 'rgba(' + color[0] + ', ' + color[1] + ', ' + color[2] + ', 0.22)');
  light.addColorStop(0.52, 'rgba(' + color[0] + ', ' + color[1] + ', ' + color[2] + ', 0.08)');
  light.addColorStop(1, 'rgba(0, 0, 0, 0)');
  g.fillStyle = light;
  g.fillRect(room.x, room.y, room.w, room.h);
  g.restore();
}

/**
 * 墙体结构：顶面受光、底部阴影、左右侧面、面板接缝、能量槽
 * @param {CanvasRenderingContext2D} g 目标上下文
 * @param {Object} rect 房间或走廊矩形
 * @param {Object} theme 当前楼层主题
 * @param {boolean} withGroove 是否画内侧能量槽（房间为 true，走廊为 false）
 */
function paintWallStructure(g, rect, theme, withGroove) {
  const r = 8;

  // 顶部受光斜面
  const top = g.createLinearGradient(0, rect.y, 0, rect.y + 7);
  top.addColorStop(0, theme.wallTop);
  top.addColorStop(1, 'rgba(0, 0, 0, 0)');
  g.fillStyle = top;
  g.fillRect(rect.x + 3, rect.y, rect.w - 6, 7);

  // 底部阴影（墙厚的视觉重量）
  const bottom = g.createLinearGradient(0, rect.y + rect.h - 10, 0, rect.y + rect.h);
  bottom.addColorStop(0, 'rgba(0, 0, 0, 0)');
  bottom.addColorStop(1, theme.wallDark);
  g.fillRect(rect.x + 3, rect.y + rect.h - 10, rect.w - 6, 10);

  // 左右侧面
  g.fillStyle = theme.wallSide;
  g.fillRect(rect.x, rect.y + 3, 4, rect.h - 6);
  g.fillRect(rect.x + rect.w - 4, rect.y + 3, 4, rect.h - 6);

  // 面板接缝（顶部每隔 46px 一道短竖线）
  g.strokeStyle = theme.seam;
  g.lineWidth = 1;
  for (let x = rect.x + 26; x < rect.x + rect.w - 14; x += 46) {
    g.beginPath();
    g.moveTo(x, rect.y + 2);
    g.lineTo(x, rect.y + 11);
    g.stroke();
  }

  if (withGroove) {
    g.strokeStyle = 'rgba(' + theme.accent + ', 0.16)';
    g.lineWidth = 1.4;
    roundRectPath(g, rect.x + r + 2, rect.y + r + 2, rect.w - 2 * r - 4, rect.h - 2 * r - 4, 6);
    g.stroke();
  }

  // 外轮廓：先深压边，再极淡冷光
  g.strokeStyle = 'rgba(3, 7, 14, 0.9)';
  g.lineWidth = 4;
  roundRectPath(g, rect.x, rect.y, rect.w, rect.h, withGroove ? 10 : 5);
  g.stroke();
  g.strokeStyle = 'rgba(' + theme.accent + ', 0.12)';
  g.lineWidth = 1;
  roundRectPath(g, rect.x, rect.y, rect.w, rect.h, withGroove ? 10 : 5);
  g.stroke();
}

/**
 * 房间角落立柱：柱身 + 顶端受光 + 地面投影，用最小几何做出厚度
 * @param {CanvasRenderingContext2D} g 目标上下文
 * @param {Object} room 房间矩形
 */
function paintPillars(g, room) {
  const w = 6;
  const h = 24;
  const inset = 10;
  const points = [
    [room.x + inset, room.y + inset],
    [room.x + room.w - inset - w, room.y + inset],
    [room.x + inset, room.y + room.h - inset - h],
    [room.x + room.w - inset - w, room.y + room.h - inset - h]
  ];
  points.forEach((point) => {
    const x = point[0];
    const y = point[1];
    g.fillStyle = 'rgba(0, 0, 0, 0.26)';
    g.beginPath();
    g.ellipse(x + w / 2 + 3, y + h + 2, w * 1.25, 3.5, 0, 0, Math.PI * 2);
    g.fill();

    const body = g.createLinearGradient(x, 0, x + w, 0);
    body.addColorStop(0, 'rgba(136, 190, 240, 0.32)');
    body.addColorStop(0.45, 'rgba(34, 62, 98, 0.6)');
    body.addColorStop(1, 'rgba(6, 12, 22, 0.78)');
    g.fillStyle = body;
    roundRectPath(g, x, y, w, h, 2);
    g.fill();

    g.fillStyle = 'rgba(186, 228, 255, 0.34)';
    g.fillRect(x + 1, y + 1, w - 2, 2);
  });
}

/**
 * 房间四角线形角标 + 房间编号
 * @param {CanvasRenderingContext2D} g 目标上下文
 * @param {Object} room 房间矩形
 * @param {number} index 房间序号
 */
function paintRoomCorners(g, room, index) {
  const len = 22;
  g.strokeStyle = 'rgba(176, 133, 255, 0.34)';
  g.lineWidth = 1.4;
  const corners = [
    [room.x + 6, room.y + 6, 1, 1],
    [room.x + room.w - 6, room.y + 6, -1, 1],
    [room.x + 6, room.y + room.h - 6, 1, -1],
    [room.x + room.w - 6, room.y + room.h - 6, -1, -1]
  ];
  corners.forEach((corner) => {
    g.beginPath();
    g.moveTo(corner[0], corner[1] + corner[3] * len);
    g.lineTo(corner[0], corner[1]);
    g.lineTo(corner[0] + corner[2] * len, corner[1]);
    g.stroke();
  });

  g.fillStyle = 'rgba(120, 170, 220, 0.22)';
  g.font = '9px "Cascadia Mono", Consolas, monospace';
  g.textAlign = 'left';
  g.fillText('ROOM ' + String(index + 1).padStart(2, '0'), room.x + 12, room.y + 20);
}

/**
 * 主题装饰（静态部分）：机械层的管道/控制台、符文层的阵纹/碑刻、虚空层的碎片阴影
 * @param {CanvasRenderingContext2D} g 目标上下文
 * @param {Object} room 房间矩形
 * @param {Object} theme 当前楼层主题
 */
function paintThemeProps(g, room, theme) {
  if (theme.prop === 'pipes') {
    // 顶部管道 + 接头指示灯
    const pipeY = room.y + 16;
    const len = room.w - 84;
    g.fillStyle = 'rgba(20, 34, 52, 0.92)';
    g.fillRect(room.x + 42, pipeY, len, 6);
    g.fillStyle = 'rgba(120, 180, 235, 0.18)';
    g.fillRect(room.x + 42, pipeY, len, 2);
    for (let x = room.x + 42; x <= room.x + 42 + len; x += 62) {
      g.fillStyle = 'rgba(28, 46, 68, 0.95)';
      g.fillRect(x - 3, pipeY - 3, 8, 12);
      state.sceneProps.lights.push({ x: x + 4, y: pipeY + 3, phase: rand(0, Math.PI * 2), kind: 'pipe' });
    }
    // 左下控制台 + 指示灯
    g.fillStyle = 'rgba(16, 28, 44, 0.96)';
    g.fillRect(room.x + 26, room.y + room.h - 54, 46, 26);
    g.fillStyle = 'rgba(62, 230, 255, 0.5)';
    g.fillRect(room.x + 32, room.y + room.h - 48, 12, 4);
    g.fillStyle = 'rgba(255, 194, 71, 0.42)';
    g.fillRect(room.x + 50, room.y + room.h - 48, 8, 4);
    return;
  }

  if (theme.prop === 'runes') {
    // 内圈符文阵：虚线方阵 + 四角碑刻
    g.save();
    g.strokeStyle = 'rgba(176, 133, 255, 0.2)';
    g.lineWidth = 1.2;
    g.setLineDash([4, 9]);
    g.strokeRect(room.x + 36, room.y + 34, room.w - 72, room.h - 68);
    g.restore();

    g.fillStyle = 'rgba(46, 32, 72, 0.95)';
    [[room.x + 28, room.y + 30], [room.x + room.w - 44, room.y + 30]].forEach((point) => {
      g.fillRect(point[0], point[1], 16, 22);
      g.fillStyle = 'rgba(176, 133, 255, 0.4)';
      g.fillRect(point[0] + 3, point[1] + 4, 10, 2);
      g.fillRect(point[0] + 3, point[1] + 9, 6, 2);
      g.fillStyle = 'rgba(46, 32, 72, 0.95)';
    });

    state.sceneProps.lights.push({ x: room.cx, y: room.cy, phase: rand(0, Math.PI * 2), kind: 'rune' });
    return;
  }

  // 虚空层：悬浮碎片（动态） + 地面阴影
  for (let i = 0; i < 3; i += 1) {
    const x = rand(room.x + 60, room.x + room.w - 60);
    const y = rand(room.y + 60, room.y + room.h - 60);
    const size = rand(3, 7);
    g.fillStyle = 'rgba(0, 0, 0, 0.28)';
    g.beginPath();
    g.ellipse(x + 6, y + 16, size * 1.5, size * 0.5, 0, 0, Math.PI * 2);
    g.fill();
    state.sceneProps.debris.push({
      x: x, y: y, size: size, phase: rand(0, Math.PI * 2), spin: rand(-0.4, 0.4)
    });
    state.sceneProps.lights.push({ x: x, y: y, phase: rand(0, Math.PI * 2), kind: 'shard' });
  }
}

`;

src = src.slice(0, a) + block + src.slice(b);
fs.writeFileSync(FILE, src, 'utf8');
console.log('scene block replaced, length', src.length);
