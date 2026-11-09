// P1 · 虚影专项探针（真实窗口 1600×900，dpr 1 与 1.5 各测一次）
// ------------------------------------------------------------
// 目的：不靠肉眼推断，直接在"玩家周围 ±120px"的像素窗口里回答三件事：
//   ① 默认画面里，玩家本体之外还有多少"玩家形状的额外亮块"（虚影量化）；
//   ② 逐个关掉候选来源（泛光/色差/CRT/暗角/迷雾/氛围/远景/像素特效/武器层），
//      哪一个关掉后额外亮块归零 —— 二分定位根因；
//   ③ 输出 before/after 局部放大截图 + 数值，供人工复核。
//
// 关键手法：把"玩家本体"当作差分基准
//   bg  = 关掉全部候选来源、并且临时把 drawPlayer 换成空函数（纯背景）
//   ref = 关掉全部候选来源、正常画玩家（只剩一份本体）
//   tst = 打开某个候选来源、正常画玩家
//   extra(tst) = (tst - bg) 里"不属于 ref 本体"的额外亮块
// 这样地板网格/固定装饰会被 bg 抵消，剩下的额外亮块只可能来自候选来源。
//
// 用法：node tools\arcane_ghost.js  →  结果写到 .screenshots/ghost/
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prepareProfile, killEdge } = require('./arcane_profile');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9585;                      // 独占端口，避免与其它验收脚本抢 CDP
const FILE = path.join(__dirname, '..', 'index_arcane_v2.html');
const OUT = path.join(__dirname, '..', '.screenshots', 'ghost');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let EDGE_PROC = null;          // 模块级：成功/失败都能结束整棵 Edge 进程树

/** 记录一条断言（成功/失败同格式，便于日志检索） */
function ok(name, pass, detail) {
  results.push({ name, pass: !!pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} · ${name}` + (detail === undefined ? '' : ' · ' + JSON.stringify(detail)));
}

/**
 * 在页面里安装探针工具（只暴露必要方法，避免污染游戏命名空间）
 * ------------------------------------------------------------
 * · stub(name, on)  把某个绘制函数临时换成空函数，用于"单项关闭"
 * · setFlags(o)     切开四个后处理分项
 * · capture(tag)    固定时间 → render → 抓玩家周围 ±120px 的亮度数组
 * · analyze(tag)    与 bg / ref 差分：统计本体面积、额外亮块面积、额外亮块重心
 */
const INSTALL_PROBE = `(function(){
  var R_CSS = 120;                 // 用户要求的口径：玩家周围 ±120 CSS 像素
  var store = {};
  var stubs = {};
  function lumOf(d, i) { return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; }
  var probe = {
    store: store,
    /** 临时关闭某个绘制函数（on=true 关闭，on=false 恢复） */
    stub: function(name, on) {
      if (on) {
        if (!stubs[name]) { stubs[name] = window[name]; window[name] = function(){}; }
      } else if (stubs[name]) {
        window[name] = stubs[name]; delete stubs[name];
      }
      return !!on;
    },
    /** 四个后处理分项（bloom/chroma/crt/vignette） */
    setFlags: function(o) {
      if (!state.meta.postfx) state.meta.postfx = {};
      if (o.bloom != null) state.meta.postfx.bloom = !!o.bloom;
      if (o.chroma != null) state.meta.postfx.chroma = !!o.chroma;
      if (o.crt != null) state.meta.postfx.crt = !!o.crt;
      if (o.vignette != null) state.meta.postfx.vignette = !!o.vignette;
      return JSON.parse(JSON.stringify(state.meta.postfx));
    },
    /** 玩家当前的设备像素包围框（以玩家屏幕坐标为中心，含 ±120 CSS 的取样半径） */
    box: function() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var z = cameraZoom();
      // 玩家屏幕坐标：与 render() 的变换链一致（dpr → cameraZoom → 平移 -cam）
      var pcx = Math.round((state.player.x - state.cam.x) * z * dpr);
      var pcy = Math.round((state.player.y - state.cam.y) * z * dpr);
      var r = Math.round(R_CSS * dpr);
      var x = Math.max(0, pcx - r);
      var y = Math.max(0, pcy - r);
      var w = Math.min(canvas.width - x, r * 2);
      var h = Math.min(canvas.height - y, r * 2);
      return { x: x, y: y, w: w, h: h, dpr: dpr, zoom: z, pcx: pcx, pcy: pcy, cx: pcx - x, cy: pcy - y };
    },
    /** 渲染一帧并把窗口亮度存进 store[tag]（同时返回极值，便于快速判断） */
    capture: function(tag) {
      state.elapsed = 12.0;        // 固定动画相位：多次截图之间角色姿态完全一致
      // 清掉会污染取样窗口的瞬时层（挑战环 / 飘字 / 无敌环），只留角色与地板
      if (state.rings) state.rings.length = 0;
      if (state.floats) state.floats.length = 0;
      state.player.invuln = 0;
      render();
      var b = this.box();
      var c = canvas.getContext('2d');
      var img = c.getImageData(b.x, b.y, b.w, b.h);
      var lum = new Uint8Array(b.w * b.h);
      var max = 0, sum = 0;
      for (var i = 0, p = 0; i < lum.length; i += 1, p += 4) {
        var v = lumOf(img.data, p);
        lum[i] = v > 255 ? 255 : (v < 0 ? 0 : Math.round(v));
        if (lum[i] > max) max = lum[i];
        sum += lum[i];
      }
      store[tag] = { w: b.w, h: b.h, lum: lum, box: b };
      // 诊断：记录相机与画布变换，定位高 DPI 下"本体像素错位"的根因
      var tf = c.getTransform ? c.getTransform() : null;
      return {
        tag: tag, w: b.w, h: b.h, max: max, mean: Math.round(sum / lum.length), box: b,
        cam: [Math.round(state.cam.x * 100) / 100, Math.round(state.cam.y * 100) / 100],
        pl: [Math.round(state.player.x * 100) / 100, Math.round(state.player.y * 100) / 100],
        tr: tf ? [tf.a, tf.b, tf.c, tf.d, Math.round(tf.e * 100) / 100, Math.round(tf.f * 100) / 100] : null
      };
    },
    /** 把某个 tag 的窗口裁出来放大 3 倍（最近邻），返回 PNG dataURL，供脚本落盘 */
    crop: function(tag) {
      var s = store[tag];
      if (!s) return null;
      var off = document.createElement('canvas');
      off.width = s.w * 3; off.height = s.h * 3;
      var g = off.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.drawImage(canvas, s.box.x, s.box.y, s.w, s.h, 0, 0, off.width, off.height);
      return off.toDataURL('image/png');
    },
    /** 对 tag 做差分分析：本体面积 / 额外亮块面积与重心 */
    analyze: function(tag) {
      var t = store[tag], r = store.ref, g = store.bg;
      if (!t || !r || !g) return null;
      var w = t.w, h = t.h, n = w * h;
      // ① 本体掩膜：ref 与 bg 的"绝对差" ≥ 18（同时包含比地板亮的法杖/光点，
      //    和比地板暗的深色斗篷——只要"因玩家而改变"就算本体）。
      //    这里不能用 ref-bg>0：斗篷比地板暗，会被漏掉，导致掩膜只剩半透明光效。
      var body = new Uint8Array(n);
      var bodyArea = 0, bodyE = 0;
      var minX = w, maxX = 0, minY = h, maxY = 0;
      for (var i = 0; i < n; i += 1) {
        var d0 = Math.abs(r.lum[i] - g.lum[i]);
        if (d0 >= 18) {
          body[i] = 1; bodyArea += 1; bodyE += d0;
          var bx = i % w, by = Math.floor(i / w);
          if (bx < minX) minX = bx;
          if (bx > maxX) maxX = bx;
          if (by < minY) minY = by;
          if (by > maxY) maxY = by;
        }
      }
      // ② 本体"二次曝光量"：默认画面(t) 与全关画面(ref) 在本体像素上的亮度差。
      //    泛光若在实体之前合成，本体像素应当 0 变化；若在实体之后整帧叠回，
      //    这里会出现显著的正向提亮 —— 这就是虚影的像素级证据。
      var bodyLiftSum = 0, bodyLiftAbs = 0, bodyBad6 = 0;
      // 分档强度：阈值越高，"实心像素"越纯（半透明光效/阴影会被排除）
      var THS = [40, 60, 80, 100];
      var strong = THS.map(function(th) { return { th: th, cnt: 0, sum: 0, bad: 0 }; });
      for (var bi = 0; bi < n; bi += 1) {
        if (!body[bi]) continue;
        var dv2 = t.lum[bi] - r.lum[bi];
        bodyLiftSum += dv2;
        bodyLiftAbs += Math.abs(dv2);
        if (Math.abs(dv2) > 6) bodyBad6 += 1;
        var own = Math.abs(r.lum[bi] - g.lum[bi]);
        for (var si = 0; si < strong.length; si += 1) {
          if (own >= strong[si].th) {
            strong[si].cnt += 1; strong[si].sum += Math.abs(dv2);
            if (Math.abs(dv2) > 6) strong[si].bad += 1;
          }
        }
      }
      strong = strong.map(function(s) {
        return { th: s.th, cnt: s.cnt, meanAbs: s.cnt ? Math.round((s.sum / s.cnt) * 100) / 100 : 0, badRatio6: s.cnt ? Math.round((s.bad / s.cnt) * 10000) / 10000 : 0 };
      });
      // ② 本体掩膜膨胀 6 设备像素（把抗锯齿/描边算进本体，避免把边缘当虚影）
      var dil = new Uint8Array(n);
      var RAD = 6;
      for (var yy = 0; yy < h; yy += 1) {
        for (var xx = 0; xx < w; xx += 1) {
          if (!body[yy * w + xx]) continue;
          for (var dy = -RAD; dy <= RAD; dy += 1) {
            for (var dx = -RAD; dx <= RAD; dx += 1) {
              var nx = xx + dx, ny = yy + dy;
              if (nx >= 0 && ny >= 0 && nx < w && ny < h) dil[ny * w + nx] = 1;
            }
          }
        }
      }
      // ③ 额外亮块：tst 比 bg 亮 18，但落在膨胀本体之外
      var extra = new Uint8Array(n);
      var extraArea = 0, extraE = 0, ex = 0, ey = 0, peak = 0;
      for (var j = 0; j < n; j += 1) {
        if (dil[j]) continue;
        var d1 = Math.max(0, t.lum[j] - g.lum[j]);
        if (d1 >= 18) {
          extra[j] = 1; extraArea += 1; extraE += d1;
          ex += (j % w); ey += Math.floor(j / w);
          if (d1 > peak) peak = d1;
        }
      }
      // ②b 紧身框（36×52 CSS px，只框住玩家自己的精灵，不含周围被照亮的地板）
      //     这是最严格的"本体是否被二次曝光"口径：地板抬亮不会计入这里。
      var tw = Math.round(18 * t.box.dpr), th = Math.round(26 * t.box.dpr);
      var tcx = t.box.cx, tcy = t.box.cy;
      var tightAbs = 0, tightSigned = 0, tightCnt = 0, tightBad = 0;
      for (var ty = Math.max(0, tcy - th); ty <= Math.min(h - 1, tcy + th); ty += 1) {
        for (var tx = Math.max(0, tcx - tw); tx <= Math.min(w - 1, tcx + tw); tx += 1) {
          var ti = ty * w + tx;
          var tv = t.lum[ti] - r.lum[ti];
          tightSigned += tv; tightAbs += Math.abs(tv); tightCnt += 1;
          if (Math.abs(tv) > 6) tightBad += 1;
        }
      }
      // ③b 额外亮度的"近身浓度"：虚影会紧贴本体（光环），背景泛光则是均匀抬亮。
      var b0 = t.box, pcx0 = b0.cx, pcy0 = b0.cy, radNear = 40 * b0.dpr;
      var nearSum = 0, nearCnt = 0, allSum2 = 0, allCnt = 0;
      for (var q0 = 0; q0 < n; q0 += 1) {
        if (!extra[q0]) continue;
        var dv3 = Math.max(0, t.lum[q0] - g.lum[q0]);
        allSum2 += dv3; allCnt += 1;
        var qx = q0 % w, qy = Math.floor(q0 / w);
        if (Math.sqrt(Math.pow(qx - pcx0, 2) + Math.pow(qy - pcy0, 2)) <= radNear) { nearSum += dv3; nearCnt += 1; }
      }
      // ④ 额外亮块的连通域：只有"成块"（面积 ≥ 本体 8%）才算虚影候选，噪点不算
      var seen = new Uint8Array(n), blobs = [];
      for (var k = 0; k < n; k += 1) {
        if (!extra[k] || seen[k]) continue;
        var q = [k], head = 0, area = 0, sx = 0, sy = 0;
        seen[k] = 1;
        while (head < q.length) {
          var idx = q[head]; head += 1;
          var bx = idx % w, by = Math.floor(idx / w);
          area += 1; sx += bx; sy += by;
          if (bx > 0 && extra[idx - 1] && !seen[idx - 1]) { seen[idx - 1] = 1; q.push(idx - 1); }
          if (bx < w - 1 && extra[idx + 1] && !seen[idx + 1]) { seen[idx + 1] = 1; q.push(idx + 1); }
          if (by > 0 && extra[idx - w] && !seen[idx - w]) { seen[idx - w] = 1; q.push(idx - w); }
          if (by < h - 1 && extra[idx + w] && !seen[idx + w]) { seen[idx + w] = 1; q.push(idx + w); }
        }
        if (area >= Math.max(24, bodyArea * 0.08)) {
          blobs.push({ area: area, x: Math.round(sx / area), y: Math.round(sy / area) });
        }
      }
      var box = t.box;
      var pcx = box.cx, pcy = box.cy;   // box.cx/cy 已经是"相对取样窗口左上角"的玩家坐标
      var offs = blobs.map(function(bl) {
        return { area: bl.area, dist: Math.round(Math.sqrt(Math.pow(bl.x - pcx, 2) + Math.pow(bl.y - pcy, 2)) * 10) / 10, x: bl.x, y: bl.y };
      });
      return {
        bodyArea: bodyArea, bodyE: bodyE,
        bodyBBox: bodyArea ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null,
        bodyLiftSigned: bodyArea ? Math.round((bodyLiftSum / bodyArea) * 100) / 100 : 0,
        bodyLiftAbs: bodyArea ? Math.round((bodyLiftAbs / bodyArea) * 100) / 100 : 0,
        bodyBadRatio6: bodyArea ? Math.round((bodyBad6 / bodyArea) * 10000) / 10000 : 0,
        tightLiftAbs: tightCnt ? Math.round((tightAbs / tightCnt) * 100) / 100 : 0,
        tightLiftSigned: tightCnt ? Math.round((tightSigned / tightCnt) * 100) / 100 : 0,
        tightBadRatio6: tightCnt ? Math.round((tightBad / tightCnt) * 10000) / 10000 : 0,
        strong: strong,
        extraArea: extraArea, extraE: extraE,
        extraRatio: bodyE > 0 ? Math.round((extraE / bodyE) * 1000) / 1000 : 0,
        peak: peak,
        extraMeanAll: allCnt ? Math.round((allSum2 / allCnt) * 10) / 10 : 0,
        extraMeanNear: nearCnt ? Math.round((nearSum / nearCnt) * 10) / 10 : 0,
        nearRatio: allCnt && nearCnt ? Math.round(((nearSum / nearCnt) / (allSum2 / allCnt)) * 100) / 100 : 0,
        centroid: extraArea ? { x: Math.round(ex / extraArea), y: Math.round(ey / extraArea), dist: Math.round(Math.sqrt(Math.pow(ex / extraArea - pcx, 2) + Math.pow(ey / extraArea - pcy, 2)) * 10) / 10 } : null,
        blobs: offs,
        playerCenter: { x: pcx, y: pcy }
      };
    },
    /**
     * 生成"差异可视化图"：把两个 tag 的窗口亮度差放大 gain 倍画成灰度图
     * 用来人工确认差异到底落在"玩家形状"上，还是只落在背景地板上
     * @param {string} tagA 画面 A
     * @param {string} tagB 画面 B
     * @param {number} gain 放大倍数（默认 6）
     * @returns {string|null} PNG dataURL
     */
    diffImage: function(tagA, tagB, gain) {
      var a = store[tagA], b = store[tagB];
      if (!a || !b) return null;
      var g = gain || 6;
      var off = document.createElement('canvas');
      off.width = a.w * 3; off.height = a.h * 3;
      var octx = off.getContext('2d');
      var img = octx.createImageData(a.w, a.h);
      for (var i = 0; i < a.w * a.h; i += 1) {
        var dv = Math.min(255, Math.abs(a.lum[i] - b.lum[i]) * g);
        img.data[i * 4] = dv; img.data[i * 4 + 1] = dv; img.data[i * 4 + 2] = dv; img.data[i * 4 + 3] = 255;
      }
      var tmp = document.createElement('canvas');
      tmp.width = a.w; tmp.height = a.h;
      tmp.getContext('2d').putImageData(img, 0, 0);
      octx.imageSmoothingEnabled = false;
      octx.drawImage(tmp, 0, 0, off.width, off.height);
      return off.toDataURL('image/png');
    },
    /**
     * 结构顺序证明：临时包装 bloom / player 两个绘制函数，渲染一帧后返回调用顺序
     * 期望：['bloom', 'player'] —— 泛光在实体之前，玩家只画一次（单次曝光）
     * @returns {Array<string>} 绘制顺序
     */
    orderCheck: function() {
      var seq = [];
      var ob = window.drawBackgroundBloom, op = window.drawPlayer;
      window.drawBackgroundBloom = function() { seq.push('bloom'); return ob.apply(this, arguments); };
      window.drawPlayer = function() { seq.push('player'); return op.apply(this, arguments); };
      state.elapsed = 12.0;
      render();
      window.drawBackgroundBloom = ob; window.drawPlayer = op;
      return seq;
    },
    compareBody: function(tagA, tagB) {
      var a = store[tagA], b = store[tagB], r = store.ref, g = store.bg;
      if (!a || !b || !r || !g) return null;
      var n = a.w * a.h;
      var bodyPx = 0, bad6 = 0, bad12 = 0, sumAbs = 0;
      var bgPx = 0, bgLiftSum = 0, hiPx = 0, hiLiftSum = 0;
      for (var i = 0; i < n; i += 1) {
        var own = Math.abs(r.lum[i] - g.lum[i]);
        if (own >= 18) {
          bodyPx += 1;
          var dv = Math.abs(a.lum[i] - b.lum[i]);
          sumAbs += dv;
          if (dv > 6) bad6 += 1;
          if (dv > 12) bad12 += 1;
        } else if (r.lum[i] < 45) {
          // 暗部（地板/墙）：旧版整帧泛光会把这里整体抬亮（灰雾）
          bgPx += 1;
          bgLiftSum += (a.lum[i] - b.lum[i]);
        }
        // 高光像素（灯/火焰/符文）：修好后仍应被泛光照亮，用来证明"没把泛光删掉"
        if (b.lum[i] >= 150) {
          hiPx += 1; hiLiftSum += (a.lum[i] - b.lum[i]);
        }
      }
      return {
        bodyPx: bodyPx,
        bad6: bad6, bad12: bad12,
        badRatio6: bodyPx ? Math.round((bad6 / bodyPx) * 10000) / 10000 : 0,
        meanAbs: bodyPx ? Math.round((sumAbs / bodyPx) * 100) / 100 : 0,
        bgPx: bgPx,
        bgLift: bgPx ? Math.round((bgLiftSum / bgPx) * 100) / 100 : 0,
        hiPx: hiPx,
        hiLift: hiPx ? Math.round((hiLiftSum / hiPx) * 100) / 100 : 0
      };
    }
  };
  window.__ghostProbe = probe;
  return true;
})()`;

async function main() {
  const profile = prepareProfile();
  fs.mkdirSync(OUT, { recursive: true });

  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless=new',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--allow-file-access-from-files', '--window-size=1600,900', 'about:blank'
  ], { stdio: 'ignore' });
  EDGE_PROC = edge;

  let target = null;
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* 等端口 */ }
    await sleep(250);
  }
  if (!target) throw new Error('调试端口未就绪');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0; const pending = new Map(); const errors = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.text);
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res, rej) => {
    seq += 1;
    pending.set(seq, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');

  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };
  const saveCrop = async (tag, name) => {
    const url = await ev(`window.__ghostProbe.crop('${tag}')`);
    if (!url) return 0;
    const buf = Buffer.from(String(url).split(',')[1], 'base64');
    fs.writeFileSync(path.join(OUT, name), buf);
    return buf.length;
  };
  const saveDiff = async (a, b, gain, name) => {
    const url = await ev(`window.__ghostProbe.diffImage('${a}','${b}',${gain})`);
    if (!url) return 0;
    const buf = Buffer.from(String(url).split(',')[1], 'base64');
    fs.writeFileSync(path.join(OUT, name), buf);
    return buf.length;
  };

  for (const dpr of [1, 1.5]) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1600, height: 900, deviceScaleFactor: dpr, mobile: false
    });
    await send('Page.navigate', { url: 'file:///' + FILE.replace(/\\/g, '/') });
    await sleep(1700);

    await ev(`document.getElementById('btnStart').click(); true`);
    await sleep(900);
    await ev(`(function(){
      state.onboardSkipAll = true; try { hideIntroHint(true); } catch (e) {}
      window.__roamDebug.setFloor(2);
      // 关掉升级弹窗链路：本轮只测渲染，避免"技能四选一"遮住画面
      try { XP_CONFIG.enabled = false; } catch (e) {}
      // 把可能残留的奖励弹窗逐段跳掉，直到回到 playing
      (function(){
        var guard = 0;
        while (state.mode === 'reward' && guard < 8) { closeRewardFlow(true); guard += 1; }
      })();
      // 选一间"最靠近地图中心"的已生成房间并传送过去：相机不会被地图边界钳制，
      // 玩家必然落在屏幕中心附近，取样本窗口不会截到黑边
      (function(){
        var avgX = 0, avgY = 0;
        state.rooms.forEach(function(r){ avgX += r.cx; avgY += r.cy; });
        avgX /= Math.max(1, state.rooms.length); avgY /= Math.max(1, state.rooms.length);
        var best = null, bestD = Infinity;
        state.rooms.forEach(function(r){
          var d = Math.pow(r.cx - avgX, 2) + Math.pow(r.cy - avgY, 2);
          if (d < bestD) { bestD = d; best = r; }
        });
        if (best && !window.__roamDebug.teleport(best.cx, best.cy)) window.__roamDebug.centerPlayer();
      })();
      // 静默清场：不触发击杀掉落 / 飘字，保证取样窗口里只有玩家与地板网格
      state.enemies.length = 0;
      if (state.floats) state.floats.length = 0;
      if (state.pickups) state.pickups.length = 0;
      if (state.rings) state.rings.length = 0;
      state.player.invuln = 99999;
      state.player.hp = state.player.hpMax;
      state.afterimages.length = 0;
      if (state.meta) state.meta.motionTrail = false;
      return { floor: state.floor, mode: state.mode, enemies: state.enemies.length, canvas: [canvas.width, canvas.height], dpr: window.devicePixelRatio };
    })()`);
    await sleep(400);
    // 冻结主循环的 update/render：之后所有画面都由探针手动 render()，
    // 避免粒子/动画在两次采样之间推进导致"假差异"
    await ev(`try { crashState.halted = true; } catch (e) {} true`);

    await ev(INSTALL_PROBE);
    const ctxInfo = await ev(`({ dpr: Math.min(window.devicePixelRatio||1,2), canvas: [canvas.width, canvas.height], view: [state.viewW, state.viewH], zoom: cameraZoom() })`);
    console.log(`\n===== dpr=${dpr} 实测窗口 =====`);
    console.log('窗口读数 ' + JSON.stringify(ctxInfo));

    // ---------- 1) 建立三张基准图 ----------
    // alloff：四项后处理全关 + 迷雾/氛围/远景/像素特效/武器层全部临时关闭
    const ALL_OFF = `(function(){
      window.__ghostProbe.setFlags({ bloom:false, chroma:false, crt:false, vignette:false });
      ['drawFog','drawAtmosphere','drawVoidDepth','drawVoidApron','drawPixelFxWorld','drawPixelFxScreen','drawWeaponHeld','drawWeaponFx'].forEach(function(n){ window.__ghostProbe.stub(n, true); });
      state.afterimages.length = 0;
      return true;
    })()`;
    await ev(ALL_OFF);
    await ev(`window.__ghostProbe.stub('drawPlayer', true); true`);
    const bg = await ev(`window.__ghostProbe.capture('bg')`);
    await ev(`window.__ghostProbe.stub('drawPlayer', false); true`);
    const ref = await ev(`window.__ghostProbe.capture('ref')`);
    console.log('基准 bg ' + JSON.stringify(bg));
    console.log('基准 ref ' + JSON.stringify(ref));
    // 确定性自检：同一状态连续渲染两次，若本体像素也对不上，说明采样本身有非确定性
    await ev(`window.__ghostProbe.capture('ref2'); true`);
    console.log('确定性 ref2↔ref ' + JSON.stringify(await ev(`window.__ghostProbe.compareBody('ref2','ref')`)));

    // ---------- 2) 逐项打开候选来源并抓图 ----------
    const cases = [
      { tag: 'default', name: '默认（泛光+暗角）', open: `window.__ghostProbe.setFlags({ bloom:true, chroma:false, crt:false, vignette:true });` },
      { tag: 'bloom', name: '仅泛光', open: `window.__ghostProbe.setFlags({ bloom:true, chroma:false, crt:false, vignette:false });` },
      { tag: 'vignette', name: '仅暗角', open: `window.__ghostProbe.setFlags({ bloom:false, chroma:false, crt:false, vignette:true });` },
      { tag: 'chroma', name: '仅色差', open: `window.__ghostProbe.setFlags({ bloom:false, chroma:true, crt:false, vignette:false });` },
      { tag: 'crt', name: '仅CRT', open: `window.__ghostProbe.setFlags({ bloom:false, chroma:false, crt:true, vignette:false });` },
      { tag: 'fog', name: '仅迷雾', open: `window.__ghostProbe.stub('drawFog', false);` },
      { tag: 'atmo', name: '仅氛围雾团/提灯', open: `window.__ghostProbe.stub('drawAtmosphere', false);` },
      { tag: 'void', name: '仅远景两层', open: `window.__ghostProbe.stub('drawVoidDepth', false); window.__ghostProbe.stub('drawVoidApron', false);` },
      { tag: 'pixelfx', name: '仅像素特效层', open: `window.__ghostProbe.stub('drawPixelFxWorld', false); window.__ghostProbe.stub('drawPixelFxScreen', false);` },
      { tag: 'weapon', name: '仅武器持握/刀光', open: `window.__ghostProbe.stub('drawWeaponHeld', false); window.__ghostProbe.stub('drawWeaponFx', false);` }
    ];

    const rows = [];
    for (const c of cases) {
      // 每项从 alloff 干净起步，避免叠加影响
      await ev(ALL_OFF);
      await ev(c.open);
      const cap = await ev(`window.__ghostProbe.capture('${c.tag}')`);
      const ana = await ev(`window.__ghostProbe.analyze('${c.tag}')`);
      rows.push({ tag: c.tag, name: c.name, cap, ana });
      console.log(`${c.name}` + ' · ' + JSON.stringify(ana));
      await saveCrop(c.tag, `crop-dpr${dpr}-${c.tag}.png`);
    }

    // ---------- 3) before/after 全屏 + 局部 ----------
    await ev(ALL_OFF);
    await ev(`window.__ghostProbe.setFlags({ bloom:false, chroma:false, crt:false, vignette:false }); true`);
    await ev(`window.__ghostProbe.capture('alloff'); true`);
    await saveCrop('alloff', `crop-dpr${dpr}-alloff.png`);
    await shot(`full-dpr${dpr}-alloff.png`);
    await ev(`window.__ghostProbe.setFlags({ bloom:true, chroma:false, crt:false, vignette:true }); true`);
    const d2cap = await ev(`window.__ghostProbe.capture('default2')`);
    console.log('default2 采样读数 ' + JSON.stringify(d2cap));
    await saveCrop('default2', `crop-dpr${dpr}-default.png`);
    await saveDiff('default2', 'alloff', 6, `diff-dpr${dpr}-default-vs-alloff.png`);
    await saveDiff('default2', 'ref', 6, `diff-dpr${dpr}-default-vs-ref.png`);
    await saveDiff('ref', 'alloff', 6, `diff-dpr${dpr}-ref-vs-alloff.png`);
    console.log('ref↔alloff ' + JSON.stringify(await ev(`window.__ghostProbe.compareBody('ref','alloff')`)));
    await shot(`full-dpr${dpr}-default.png`);

    // ---------- 4) 像素级证明：默认设置下只有一份本体 ----------
    const dAna = await ev(`window.__ghostProbe.analyze('default2')`);
    const cmp = await ev(`window.__ghostProbe.compareBody('default2', 'alloff')`);
    // 结构证明：泛光必须在玩家之前合成，且玩家只绘制一次
    const order = await ev(`window.__ghostProbe.orderCheck()`);
    ok(`dpr=${dpr} · 绘制顺序为"泛光 → 玩家"且玩家只画一次`,
      order.length === 2 && order[0] === 'bloom' && order[1] === 'player', { order });
    // 像素证明：只统计"实心本体像素"（ref-bg 对比度 ≥ 80），排除半透明光效与阴影
    const s80 = dAna.strong.find((s) => s.th === 80);
    ok(`dpr=${dpr} · 实心本体像素零二次曝光（平均|Δ| < 1.0 且 |Δ|>6 比例 < 5%）`,
      s80 && s80.meanAbs < 1.0 && s80.badRatio6 < 0.05, { strong80: s80 });
    ok(`dpr=${dpr} · 暗部不再被整帧泛光抬成灰雾（暗部提亮 < 1.0）`,
      cmp && Math.abs(cmp.bgLift) < 1.0, { bgLift: cmp && cmp.bgLift });
    ok(`dpr=${dpr} · 泛光仍在工作（高光像素平均提亮 ≥ 1.0）`,
      cmp && cmp.hiLift >= 1.0, { hiLift: cmp && cmp.hiLift, hiPx: cmp && cmp.hiPx });

    fs.writeFileSync(path.join(OUT, `ghost-dpr${dpr}-result.json`), JSON.stringify({ ctxInfo, bg, ref, rows, defaultAna: dAna }, null, 2));
  }

  ok('运行期无页面异常', errors.length === 0, errors.slice(0, 4));
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\nRESULT: ${failed === 0 ? 'PASS' : 'FAIL'} (${results.length - failed}/${results.length})`);
  ws.close();
  try { killEdge(edge); } catch (e) { /* 已退出 */ }
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error('FATAL', err && err.stack ? err.stack : err);
  try { if (EDGE_PROC) killEdge(EDGE_PROC); } catch (e) { /* 已退出 */ }
  process.exit(1);
});
