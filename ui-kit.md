# 烬 · UI Kit 规格（v1.6）

> 适用对象：`index_arcane_v2.html`（Canvas 2D，单文件零依赖）。
> 本文件只给规格，**不改主文件**。对照图见 [ui-kit.html](.screenshots/art/ui-kit.html) / `ui-kit.png`（1500×4225，整页截图）。
> 所有数值可直接抄进现有 `:root` 令牌；组件里不允许再写裸值。

---

## 0. 一句话结论

1. **色板不换，做收口**：基底一条 `ink-900…500` 冷色阶，每层最多 2 个强调色；高饱和只给前景。
2. **一套令牌**：圆角 4/8/12/16/999，间距 4/6/8/12/16/22/32，字重 400/600/700，描边 1px 面板 / 2.5px 实体。
3. **单一光源**：全部来自左上（材质渐变 `160deg`，内高光 `inset 0 1px 0 rgba(255,255,255,.08)`）；暗角 **0.35**，只压四角、中心不压。
4. **素材**：核心图标/准心**全部自绘内联 SVG**（0 请求、0 打包体积增量）；外部 CC0 素材只作比例参考，不整包引入。

---

## 1. 令牌总表（复制即用）

```css
/* ============================================================
   烬 · UI 令牌（唯一来源）
   说明：颜色只收窄层级，不改色相；组件禁止写裸值。
   ============================================================ */
:root{
  /* --- 基底：四层共用一条冷色阶 --- */
  --ink-900:#070a12;   /* 最暗底 / 描边外沿 */
  --ink-800:#0b1220;   /* 地面基底 */
  --ink-700:#101a2c;   /* 面板次底 / 砖缝底 */
  --ink-600:#16233a;   /* 卡面顶部 / 墙体侧面 */
  --ink-500:#1e2f4d;   /* HUD 面板 / 墙体顶光 */
  --line-ink:#0a0d16;  /* 统一实体描边（2.5px） */

  /* --- 文字（暗底高对比，最弱一级仍 ≥ 4.5:1）--- */
  --t1:#eaf5ff;  --t2:#c3d7ef;  --t3:#a8bfdc;  --muted:#93a6c4;

  /* --- 语义强调 --- */
  --tech:#5ce6ff;  --magic:#b085ff;  --void:#78f0d6;  --deep:#77aaff;
  --fire:#ff8a3d;  --ice:#8fdcff;   --bolt:#ffe066;  --poison:#7ee081;
  --gold:#ffc247;  --good:#47e8a7;  --bad:#ff6b7f;

  /* --- 稀有度（与语义色解耦）--- */
  --rar-common:#9fb0c8;  --rar-rare:#4aa8ff;  --rar-epic:#b47cff;  --rar-relic:#ffc247;
  --rar-common-line:rgba(159,176,200,.34);
  --rar-rare-line:rgba(74,168,255,.46);
  --rar-epic-line:rgba(180,124,255,.55);
  --rar-relic-line:rgba(255,194,71,.55);

  /* --- 圆角（大 16 / 中 12 / 小 8 / 徽章 4 / 胶囊 999）--- */
  --r-xs:4px; --r-sm:8px; --r-md:12px; --r-lg:16px; --r-pill:999px;

  /* --- 间距：4 的倍数，全部 UI 只从这里取 --- */
  --sp-1:4px; --sp-2:6px; --sp-3:8px; --sp-4:12px; --sp-5:16px; --sp-6:22px; --sp-7:32px;

  /* --- 字号 / 字重：正文 400 / 标题 600 / 数字 700 等宽 --- */
  --fs-xs:11px; --fs-sm:12.5px; --fs-md:14px; --fs-lg:16px;
  --fs-xl:20px; --fs-2xl:26px; --fs-3xl:38px;
  --sans:"Microsoft YaHei UI","Microsoft YaHei","PingFang SC","Segoe UI",system-ui,sans-serif;
  --mono:"Cascadia Mono","Consolas","Courier New",monospace;

  /* --- 描边 / 材质 / 阴影（单一光源：左上）--- */
  --line:rgba(140,178,228,.20);
  --line-strong:rgba(120,190,255,.46);
  --sheen:linear-gradient(160deg,rgba(255,255,255,.10),rgba(255,255,255,0) 42%);
  --inner:inset 0 1px 0 rgba(255,255,255,.08),inset 0 -18px 32px rgba(0,0,0,.35);
  --shadow-panel:0 18px 46px rgba(0,0,0,.55);
  --shadow-pop:0 28px 80px rgba(0,0,0,.66);

  /* --- 暗角：只压四角，中心透明 --- */
  --vignette:.35;
  /* --- 动效 --- */
  --ease:cubic-bezier(.2,.9,.25,1);
  --dur-fast:.14s; --dur:.22s; --dur-slow:.36s;
}
```

**暗角写法**（Canvas 或 DOM 覆盖层均可）：

```css
/* 四角压暗 0.35，中心 52% 以内完全不压，保证地面纹理可见 */
.vignette{
  position:absolute; inset:0; pointer-events:none;
  background:radial-gradient(ellipse 78% 68% at 50% 46%,
    transparent 52%, rgba(0,0,0,var(--vignette)) 100%);
}
```

> 口径说明：定调板早期写 0.18，本轮统一按 **0.35**。0.35 只作用在四角，中央 0，不影响可读性；若实机地面偏暗，只回收这一个值到 0.28，不动其它令牌。

---

## 2. 素材筛选（CC0 / CC BY 核实结果）

> 体积、尺寸来自官方页或第三方文件清单；标 `≈` 为均值/推算。**本项目要求零外部请求**，最终只有"内联 SVG / 小 PNG"两种形态。

| 素材 | 作者 / 来源 | 许可 | 格式 · 尺寸 | 体积 | 判断 |
|---|---|---|---|---|---|
| **Kenney UI Pack 2.0** | Kenney Vleugels · [kenney.nl/assets/ui-pack](https://kenney.nl/assets/ui-pack) | **CC0 1.0**（无需署名） | PNG + 矢量源；button/panel/slider；430 文件；5 套配色 | ≈2.6KB/件；整包 **1.1MB** | **半值得**：只借 panel/window 的 9-slice 边距当尺子；原图偏厚边、暖色，直接打包会和 1px 冷描边冲突。 |
| **Kenney Game Icons** | Kenney · [kenney.nl/assets/game-icons](https://kenney.nl/assets/game-icons) | **CC0** | PNG **50×50**，105 件 | 单件实测 `arrowDown.png` **809B**；整包 **0.82MB** | **不值得**：内容是方向/手柄/提示符，不是技能图标，只能当按键提示。 |
| **Kenney Board Game Icons** | Kenney · [kenney.nl/assets/board-game-icons](https://kenney.nl/assets/board-game-icons) | **CC0** | 位图 + 矢量 + 图集，250 图标 | ≈4.1KB/件；整包 **1,015KB** | **半值得**：卡牌/骰子/资源符号够用，但缺元素与法术，凑不齐本项目的技能族。 |
| **Kenney Cursor Pack** | Kenney · [kenney.nl/assets/cursor-pack](https://kenney.nl/assets/cursor-pack) | **CC0** | 位图 + 矢量，180 文件 | ≈4.1KB/件；整包 **729KB** | **只取 1 件**：系统箭头可用；游戏内准心自绘 SVG 更省、更像霓虹十字。 |
| **game-icons.net** | Lorc / Delapouite / Skoll 等，4180 个 | **CC BY 3.0**（**必须署名**） | 单色 SVG，`viewBox 0 0 512 512`，另供 PNG | ≈2–10KB/个 | **值得但限量**：质量最高、天生单色好改色；代价是游戏内要有作者 + 许可证链接。 |
| **496 Pixel Art Icons** | Henrique Lazarini (7Soul1) · [OpenGameArt](https://opengameart.org/content/496-pixel-art-icons-for-medievalfantasy-rpg) | **CC0**（第三方两处佐证） | 16×16 PNG，496 个 | 原页未给整包数字 | **不值得**：16px 像素颗粒与冷色霓虹矢量风冲突。 |
| **Skill, item and spell icons** | Paulius Jurgelevičius · [OpenGameArt](https://opengameart.org/content/skill-item-and-spell-icons) | **CC0**（Exiled Kingdoms 鸣谢页 + Debian copyright 佐证） | PNG（含 .jpg），**边框已烘焙进图** | 原页未给整包数字 | **不值得**：社区确认边框去不掉，做不了霓虹描边。 |
| **Fantasy UI Borders** | Kenney · [kenney.nl/assets/fantasy-ui-borders](https://kenney.nl/assets/fantasy-ui-borders) | **CC0** | 9-slice 边角件，130+ | ≈2.7KB/件；整包 **350KB** | **只借结构**：棕木雕花与冷霓虹冲突，必须像素级重绘。 |

### 体积红线（单文件内联）

| 形态 | 上限 | 说明 |
|---|---|---|
| SVG | **≤ 8KB/个**（推荐 2–5KB） | 走 `<symbol>` 内联 path，不走 base64；base64 会再膨胀 ≈33%。 |
| PNG 32×32 单色 | **≤ 1KB/件** | 超过就不如自绘。 |
| PNG 64×64 单色 | **≤ 4KB/件** | 仅用于必须的纹理/光标。 |
| 全套预算 | **60–100KB，硬上限 150KB** | 12 技能 + 4 状态 + 1 卡框 + 1 光标。当前主文件 2.6MB，1.5% 以内可接受。 |

### 结论

- **核心 12 个技能/状态图标 + 1 个准心：自绘内联 SVG**（第 8 节给了画布与线宽），体积≈0 新增请求。
- **卡牌边框：CSS 绘制**（1px 边 + 12px 圆角 + 内高光），比 9-slice 更贴令牌。
- **只有需要复杂剪影时才用 game-icons.net**，一次不超过 6–10 个，并在设置页署名：
  `图标：Lorc / Delapouite · game-icons.net · CC BY 3.0`。若产品不接受任何署名，全部退回自绘。
- OpenGameArt 两个 CC0 包均因风格/烘焙边框**不采用**。

---

## 3. 三选一卡条（Reward Strip）

### 3.1 容器

| 项 | 值 | 说明 |
|---|---|---|
| 宽度 | `min(960px, 94vw)` | 与现有 `--modal-w` 一致 |
| 贴底 | `bottom:14px`（安全区再 +`env(safe-area-inset-bottom)`） | 不遮战场 |
| 内边距 | `18px 22px 20px` | 旧 24px 四周，改为上窄下宽 |
| 圆角 | `--r-lg` 16px | 旧 16，保留 |
| 背景 | `linear-gradient(180deg, rgba(13,20,36,.94), rgba(7,10,18,.98))` | 旧 `rgba(10,18,28,.92)`，提亮一档 |
| 边框 | `1px solid rgba(140,178,228,.34)` | 旧 `rgba(84,140,180,.45)`，降低饱和 |
| 阴影 | `0 -8px 32px rgba(0,0,0,.55)` | 向上投影，强调"贴底一条" |

```css
/* 卡条容器：不压暗、不模糊，战场保持可见 */
.reward-strip{
  position:absolute; left:50%; bottom:14px; transform:translateX(-50%);
  width:min(960px,94vw); padding:18px 22px 20px;
  border-radius:var(--r-lg); border:1px solid rgba(140,178,228,.34);
  background:linear-gradient(180deg,rgba(13,20,36,.94),rgba(7,10,18,.98));
  box-shadow:0 -8px 32px rgba(0,0,0,.55);
}
```

### 3.2 卡头

- 左：`CHOOSE ONE`（11px 等宽、`letter-spacing:.2em`、`--tech`）
- 中：标题 16px / 700 / `--t1`
- 右：提示 11px 等宽 / `--muted`（`按 1 / 2 / 3 或点击`）
- 与卡网格间距 10px

### 3.3 卡体

| 项 | 值 | 旧值 | 差异 |
|---|---|---|---|
| 网格 | 3 列，`gap:12px` | 3 列 14px（贴底态 8px） | 统一 12 |
| 圆角 | **12px** | 11px | 归到 `--r-md` |
| 最小高度 | **176px** | 148px | +28，给图标砖与数值行 |
| 内边距 | `13px 14px 12px` | 9/10px | 恢复可读留白 |
| 左侧色条 | **4px**，稀有度色 + `0 0 14px -2px` 光 | 3px，类型色，`opacity:.6` | 从"类型"改"稀有度" |
| 边框 | 1px 稀有度线（见令牌） | `--surface-line` 统一灰 | 稀有度第一眼可分 |
| 图标砖 | **44×44**，10px 圆角，8% 同色底，1px 38% 同色边 | 44×44，仅 1px 边 | 暗底上"浮字"变实体 |
| 名称 | 16px / 700，行高 1.3 | 14px / 700 | +2px |
| 类型副行 | 11px 等宽 / `--t3` | 无（只有胶囊） | 名称下有稳定锚点 |
| 描述 | 12px / 1.55，最多 2 行 | 11.5px / 1.45 | 可读性提升 |
| 底部行 | 上边 1px `rgba(140,178,228,.14)`，数值 12px 等宽 700 `--void`，右侧堆叠 11px `--muted` | 只有 11px 单行 | 数值可扫读 |
| 稀有度胶囊 | 高 20px，`padding:2px 8px`，11px 等宽，10% 同色底 + 1px 同色边 | 类型胶囊，同色描边 | 稀有度语义 |

```css
/* 卡体：内容结构不变，只改规格 */
.reward-card{
  position:relative; display:flex; flex-direction:column; gap:8px;
  min-height:176px; padding:13px 14px 12px;
  border-radius:var(--r-md); overflow:hidden;
  border:1px solid var(--rc-line);
  background:var(--sheen),linear-gradient(180deg,var(--ink-600),var(--ink-800));
  box-shadow:var(--inner); color:var(--rc);
}
/* 左侧 4px 稀有度条：比旧 3px 更实，并带 14px 同色外发光 */
.reward-card::before{
  content:""; position:absolute; left:0; top:0; bottom:0; width:4px;
  background:var(--rc); box-shadow:0 0 14px -2px var(--rc);
}
/* 顶部柔光：与全局单一光源一致（左上 → 右下 160deg） */
.reward-card::after{
  content:""; position:absolute; inset:0; pointer-events:none;
  background:radial-gradient(240px 110px at 50% 0%,rgba(255,255,255,.06),transparent 70%);
}
```

### 3.4 状态与交互

| 状态 | 表现 | 数值 |
|---|---|---|
| 默认 | 稀有度边 + 色条 | 见上 |
| 悬停 | `translateY(-3px)`，边框换 `--gold` | `box-shadow:var(--inner),0 14px 34px rgba(0,0,0,.45)`，`140ms` |
| 按下 | `translateY(-1px) scale(.99)` | `140ms` |
| 键盘焦点 | 2px 金色外框，偏移 2px | `outline:2px solid var(--gold); outline-offset:2px` |
| 已选/禁用 | 透明度 0.55，禁用态不响应 hover | `cursor:not-allowed` |
| 数字键 | 1/2/3 与右上角键帽一一对应 | 键帽 20×20，5px 圆角 |

### 3.5 文案规则

- 名称 ≤ 8 字；类型副行固定"魔法/科技/融合 + 玩法类"。
- 描述 ≤ 2 行（约 28 字），超出省略号，不缩字号。
- 底部数值只允许"一个主数值 + 一个堆叠/唯一标记"，不堆第三行。

### 3.6 响应式

| 宽度 | 规则 |
|---|---|
| ≥1280 | 3 列，卡条 960 |
| 1024–1279 | 3 列，卡条 94vw，卡最小宽 260 |
| <1024 | 3 列横向滚动（`overflow-x:auto; scroll-snap-type:x mandatory`），卡宽 260 |
| 高度 ≤820 | 卡条 `max-height:46vh; overflow:auto`，卡最小高度降到 148 |

---

## 4. HUD

### 4.1 顶部条

| 区域 | 尺寸 | 内容 |
|---|---|---|
| 整条 | 高 **64px**，左右 18px，底部渐隐到透明 | `linear-gradient(180deg,rgba(7,10,18,.96),rgba(7,10,18,.52) 72%,transparent)` |
| 品牌 | 宽 176px | 22px / 800 / `letter-spacing:.14em`；副标 10.5px 等宽 `--muted` |
| 生命组 | 宽 **172px** | 标签 10.5px 等宽（`letter-spacing:.1em`）+ 右侧数值 11.5px 等宽 700 |
| 奥能组 | 宽 172px | 同上 |
| 状态三连 | 每枚高 26px，`gap:6px` | 元素 / 护盾 / 蓄能，见 4.4 |
| 动作区 | 按钮高 30px，`gap:6px` | 图标 16px，文字 11.5px，主按钮青边 + 18px 外发光 |

**血条 / 蓝条**：高 **10px**，`--r-pill`，`background:rgba(90,130,180,.14)`，1px `rgba(120,170,230,.20)` 边，内阴影 `inset 0 1px 3px rgba(0,0,0,.5)`；填充用渐变，另叠 20% 刻度线。

```css
/* 血条：20% 一格，把"还剩多少"变成可数的格子 */
.bar{ position:relative; height:10px; border-radius:var(--r-pill); overflow:hidden;
  background:rgba(90,130,180,.14); border:1px solid rgba(120,170,230,.20);
  box-shadow:inset 0 1px 3px rgba(0,0,0,.5); }
.bar.hp > i{ background:linear-gradient(90deg,#ff6b7f,#ffc247); }
.bar.ae > i{ background:linear-gradient(90deg,var(--tech),var(--magic)); }
.bar > .ticks{ position:absolute; inset:0;
  background:repeating-linear-gradient(90deg,transparent 0 calc(20% - 1px),
    rgba(0,0,0,.55) calc(20% - 1px) 20%); }
```

### 4.2 左侧楼层板

| 项 | 值 |
|---|---|
| 位置 | `left:18px; top:76px` |
| 宽 | **176px**（旧 158） |
| 内边距 | `11px 13px 12px`，圆角 12px |
| 左上角标 | 16×16 的 L 形青线（1px，`rgba(92,230,255,.4)`） |
| 楼层号 | 32px 等宽 700，`#d9fbff`，`text-shadow:0 0 18px rgba(92,230,255,.3)` |
| 行 | 高 24px，`padding:5px 0`，上边 1px 虚线 `rgba(140,178,228,.14)` |
| 行文字 | 左 11px `--t3`；右 11.5px 等宽 600 `--t2` |

### 4.3 小地图 / 卡组

- 小地图：右上，宽 **204px**，画布 124px 高，9px 内边距，圆角 12px；图例 4 色：玩家 `#8ff6ff`、敌人 `#ff6b7f`、楼梯 `#ffc247`、掉落 `#3ee6ff`。
- 卡组：左右 18px、底 12px、内边距 `10px 12px`，圆角 12px；标题行 10px 等宽，卡片 **6 列**，`gap:6px`，卡高 **68px**，图标 22px，名称 10.5px。
- 卡组状态：
  - 选中：1px 金边 + `0 0 18px rgba(255,194,71,.22)`
  - 冷却：整卡压 `rgba(3,8,16,.62)`，右下 20px 环形倒计时（`conic-gradient`）
  - 禁用：虚线边、图标 26% 透明、`grayscale(1)`

### 4.4 状态图标（元素 / 护盾 / 蓄能）

| 状态 | 形状 | 颜色 | 底色 | 文案 |
|---|---|---|---|---|
| 元素附着 | 火焰/雪花/折线/滴（按元素） | 元素色 | 同色 8% | `燃烧 3s` 等 |
| 护盾 | 盾形 + 对勾 | `#77aaff` | 同色 8% | `护盾 42` |
| 蓄能 | 电池 + 闪电 | `#ffc247` | 同色 8% | `蓄能 ×2` |

```css
/* 状态胶囊：高 26px，图标 14px，数值等宽 */
.status-chip{
  display:inline-flex; align-items:center; gap:5px; height:26px; padding:0 8px;
  border-radius:var(--r-sm);
  border:1px solid color-mix(in srgb,var(--c) 42%,transparent);
  background:color-mix(in srgb,var(--c) 8%,transparent);
  color:var(--c); font-size:11px;
}
.status-chip b{ font-family:var(--mono); font-size:11px; font-weight:700; color:var(--t2); }
```

### 4.5 新旧差异（对照图重点）

| 维度 | 改前 | 改后 |
|---|---|---|
| 血条 | 11px 连续条，无数值锚点 | 10px + 20% 刻度，数值右对齐等宽 |
| 信息结构 | 顶部 readout 松散，楼层另开一块 | 三区固定（品牌 / 条+状态 / 动作） |
| 状态 | 无元素/护盾/蓄能图标 | 26px 三连胶囊，颜色 + 形状双编码 |
| 卡组 | 4 张大幅拉伸，信息稀 | 6 列 68px，选中/冷却/禁用三态明确 |
| 圆角 | 8/12/16 混用 | 面板 12 / 弹窗 16 / 小件 8 |
| 暗角 | 0.22 | 0.35（只压四角） |

---

## 5. 结算面板

| 项 | 值 |
|---|---|
| 宽度 | **760px**（旧 720） |
| 内边距 | `24px 26px`，圆角 16px |
| 背景 | 顶部紫光 12% + 材质 + `#131e33→#0d1424` |
| 死因条 | 高 38px，左 3px `--bad`，底 `linear-gradient(90deg,rgba(255,107,127,.12),rgba(255,107,127,.02))`，文字 13px/600 `#ffdbe0`，右侧种子 10.5px 等宽 |
| 主数值 | 38px 等宽 700 `--gold`，上方 `RUN ENDED` 11px 等宽 `--tech` |
| 数据格 | 3 列 `gap:10px`；格内 `9px 10px`，圆角 8px，边框 1px `--line`，底 `#0d1424→#0a101c` |
| 格标签 | 11px `--muted`；格数值 17px 等宽 700 `--t1`；收益类 `--gold` |
| 复盘块 | 1px `rgba(255,107,127,.30)` 边、圆角 8、内边距 `10px 12px`；"结论" 12px `#ffd7dc`，"证据/细节" 11.5px `--t3` |
| 主按钮 | 高 **44px**，圆角 8px，青边 55%，渐变底；`position:sticky; bottom:0` |
| 提示 | 11px `--muted`，距按钮 9px |

```css
/* 结算：先结论，后数字；收益统一金色 */
.result-panel{ width:min(760px,94vw); padding:24px 26px;
  border-radius:var(--r-lg); border:1px solid var(--line-strong);
  background:radial-gradient(600px 220px at 50% 0%,rgba(176,133,255,.12),transparent 70%),
    var(--sheen),linear-gradient(180deg,var(--ink-600),var(--ink-800));
  box-shadow:var(--shadow-pop),var(--inner); text-align:center; }
.result-hero b{ font-family:var(--mono); font-size:var(--fs-3xl); color:var(--gold); }
.result-stat{ padding:9px 10px; border:1px solid var(--line); border-radius:var(--r-sm);
  background:linear-gradient(180deg,var(--ink-800),#0a101c); text-align:left; }
.result-stat b{ font-family:var(--mono); font-size:17px; font-weight:700; color:var(--t1); }
.result-stat.gold b{ color:var(--gold); }
```

**新旧差异**：旧页把 7–9 个数字平铺成 3 列小格，先看到的是格子；新页顺序是 `死因 → 楼层大字 → 数据 → 复盘 → 重开`，并保证重开按钮一屏可见（sticky）。

---

## 6. 设置页

| 项 | 值 |
|---|---|
| 面板 | 宽 `min(880px,94vw)`，内边距 18px，圆角 16px |
| 布局 | 2 列网格 `gap:12px`；危险条 `grid-column:1/-1` |
| 分块 | 内边距 `13px 15px 14px`，圆角 12px，1px `--line`，底 `#16233a→#080e18` |
| 分块头 | 编号 10.5px 等宽 `--tech` + 标题 12.5px/600 + 右侧状态 10.5px 等宽 `--muted` |
| 行 | 最小高 **40px**，`gap:12px`，上边 1px 虚线 `rgba(140,178,228,.14)` |
| 标签 | 宽 88px，12px `--t2` |
| 滑杆 | 轨道 4px / 圆角 999；已填部分 `--tech`，未填 `rgba(120,160,200,.18)`；滑钮 14px 圆，白底 + 1px 青边 |
| 开关 | **40×22px**，圆角 999；关 `rgba(90,120,160,.22)`，开 `rgba(92,230,255,.30)` + 14px 青光；滑钮 16px，开时右移 18px |
| 分段控件 | 边框 1px `--line`，圆角 8px，段间 1px 分隔；选中 16% 青底 + 600 字重 |
| 危险条 | 1px `rgba(255,107,127,.34)`，底 `rgba(38,12,18,.40)`，按钮红边 |
| 矮窗口 | `max-height:820px` 时两列；`grid-column` 危险条整行；分块内边距降到 `10px 12px` |

```css
/* 设置行：40px 行高，把旧 30px 的"挤"拉开 */
.setting-row{ display:flex; align-items:center; gap:12px; min-height:40px;
  border-top:1px dashed rgba(140,178,228,.14); }
.setting-row:first-of-type{ border-top:0; }
.setting-row > label{ width:88px; flex:none; font-size:12px; color:var(--t2); }
/* 开关：40×22，滑钮 16，开态右移 18 */
.switch{ position:relative; width:40px; height:22px; border-radius:var(--r-pill);
  border:1px solid var(--line-strong); background:rgba(90,120,160,.22); }
.switch::after{ content:""; position:absolute; left:2px; top:2px; width:16px; height:16px;
  border-radius:50%; background:#8ea8c8; transition:transform var(--dur) var(--ease); }
.switch[aria-checked="true"]{ background:rgba(92,230,255,.30); border-color:var(--tech);
  box-shadow:0 0 14px rgba(92,230,255,.28); }
.switch[aria-checked="true"]::after{ transform:translateX(18px); background:#e9feff; }
```

---

## 7. 技能 / 元素 / 状态配色映射

> 对比度按 WCAG 2.1 相对亮度公式实测，基准为地面 `#0b1220`，括号内为面板 `#1e2f4d`。全部 ≥ 4.5:1，满足 AA。

### 7.1 技能族

| 技能 / 类别 | 主色 HEX | 对比度（ink-800 / ink-500） | 依据 |
|---|---|---|---|
| 火球 / 喷火锥 / 燃烧 | `#ff8a3d` | **7.98 / 5.71** | 暖橙是唯一允许的暖色填充，与金 `#ffc247`（11.64）明度差明显，不误认 |
| 冰环 / 冻结 | `#8fdcff` | **12.35 / 8.83** | 冰是"高亮青"，比科技青 `#5ce6ff` 更浅，靠雪花形状区分 |
| 雷击 / 符文雷 / 感电 | `#ffe066` | **14.36 / 10.27** | 全场最高明度，只做瞬时反馈，不做大面积底 |
| 奥术雷池 / 奥术 | `#b085ff` | **6.82 / 4.87** | 紫在暗底最易糊；小字改用 `#c9a6ff`（**9.26 / 6.62**） |
| 回旋刃 / 导轨短刃 | `#c3d7ef` | **12.74 / 9.11** | 物理系用中性冷白，不占元素色 |
| 护盾 / 力场 | `#77aaff` | **8.00 / 5.72** | 比稀有蓝 `#4aa8ff`（7.43）亮一档，避免和"稀有度"混淆 |
| 蓄能 / 过载 / 金币 | `#ffc247` | **11.64 / 8.32** | 唯一暖金，只给收益、蓄能与可拾取物 |
| 治疗 | `#47e8a7` | **11.92 / 8.52** | 与金色相差 70°，配十字形状 |
| 中毒 | `#7ee081` | **11.47 / 8.20** | 配"滴"形，不与治疗十字混 |

### 7.2 状态 / 稀有度

| 语义 | HEX | 对比度（ink-800） | 备注 |
|---|---|---|---|
| 护盾 | `#77aaff` | 8.00 | 盾形 + 对勾 |
| 蓄能 | `#ffc247` | 11.64 | 电池 + 闪电 |
| 危险 / 死亡 | `#ff6b7f` | 6.83 | 只给危险与失败，不给普通稀有度 |
| 普通 | `#9fb0c8` | 8.49 | 边框 34% |
| 稀有 | `#4aa8ff` | 7.43 | 边框 46% |
| 史诗 | `#b47cff` | 6.48 | 边框 55%；**小字用 `#c9a6ff`（9.26）** |
| 遗物 | `#ffc247` | 11.64 | 边框 55% |

### 7.3 为什么在深色背景上可读

1. **明度差优先**：所有强调色相对 `#0b1220` 的对比度 ≥ 6.4:1，正文与数值 ≥ 12:1；即使暗角 0.35 压暗四角，中心信息仍不降级。
2. **双重编码**：颜色只做"加速识别"，语义同时由形状承担（火=焰、冰=雪花、雷=折线、护盾=盾、蓄能=电池）。色盲用户不依赖色相也能区分。
3. **稀有度不靠色相单挑**：稀有度同时有 4px 色条 + 胶囊文字（普通/稀有/史诗/遗物），灰度下仍能按位置与文字读出。
4. **小字规避陷阱**：`#b47cff` 在 `#1e2f4d` 上只有 4.63:1，贴 AA 下限；11px 小字一律换 `#c9a6ff`（6.62:1）。
5. **暖色限量**：同屏暖色（橙/金）不超过 3 处，避免与地面洗色互抢。

---

## 8. 图标规范

### 8.1 网格与线宽

| 项 | 规则 |
|---|---|
| 画布 | `viewBox="0 0 24 24"`，内容留 3px 安全边（实际绘制区 18×18） |
| 线宽 | **1.75px**（24px 渲染时）；缩放时按 `尺寸 × 0.073` 换算，clamp 到 `1.2–2.5px` |
| 端点 | `stroke-linecap:round`，`stroke-linejoin:round` |
| 填充 | 默认 `fill:none`；允许 **8% 同色填充**做体块，不允许渐变/阴影 |
| 颜色 | 单色 `currentColor`；一个图标只用一种强调色 |
| 禁用 | 不用 emoji、不用位图、不用多色描边 |

### 8.2 内联方式（零请求）

```html
<!-- 一次定义，多处 <use>；path 直接进 HTML，不走 base64 -->
<svg width="0" height="0" aria-hidden="true">
  <defs>
    <symbol id="i-flame" viewBox="0 0 24 24">
      <path d="..." stroke="currentColor" stroke-width="1.75"
            fill="none" stroke-linejoin="round"/>
    </symbol>
  </defs>
</svg>
<svg class="icon" style="color:var(--fire)"><use href="#i-flame"/></svg>
```

### 8.3 尺寸对照

| 场景 | 渲染尺寸 | 视觉线宽 | 颜色 |
|---|---|---|---|
| 顶部按钮 | 16px | 1.2px | `--t2` |
| 状态胶囊 | 14px | 1.2px | 状态色 |
| 卡组 | 22px | 1.6px | 技能色 |
| 奖励卡图标砖 | 24px（砖 44px） | 1.75px | 技能色 |
| 结算/技能树大图 | 44–48px | 2.5px | 技能色 |

---

## 9. 落地顺序与验收

### 9.1 建议改动顺序（每步可独立回滚）

1. 令牌补 `--ink-* / --rar-*-line / --vignette`，组件替换裸值（不改布局）。
2. 卡条：圆角 11→12、卡高 148→176、4px 稀有度条、图标砖、底部数值行。
3. HUD：血条刻度、状态三连、卡组六列三态。
4. 结算：死因条 + 主数值 + 数据格 + sticky 按钮。
5. 设置：两列网格 + 40px 行高 + 40×22 开关。
6. 图标：先用现有字符/SVG 占位，再逐个换自绘 SVG。

### 9.2 验收清单（全绿才算完成）

- [ ] 组件 CSS 中无裸 `border-radius` / `padding` / `font-size`（全部走令牌）。
- [ ] 卡条在 1440×900 与 1280×720 下均贴底一条，不遮住玩家与主要敌人。
- [ ] 卡条三张卡在 1280 宽下不换行、不截断名称；描述最多 2 行。
- [ ] 血条 20% 刻度在 2K dpr2 下仍清晰（1px 黑线不糊）。
- [ ] 状态三连在深色地面 + 0.35 暗角下可读，14px 图标不糊。
- [ ] 结算重开按钮在 720px 高窗口内一屏可点（sticky 生效）。
- [ ] 设置页 820px 高窗口无滚动即可看到危险条。
- [ ] 键盘焦点 2px 金色框在深底可见；1/2/3 选卡可用。
- [ ] 所有强调色对比度 ≥ 4.5:1（本文件第 7 节数值）。
- [ ] 新增图标总体积 ≤ 150KB（推荐 60–100KB）。
- [ ] 断网、双击打开，无任何外部请求（DevTools Network 仅 file://）。
- [ ] `index_arcane_v2.html` 玩法逻辑零改动（只动渲染/CSS）。

---

## 10. 边界

- 本文与对照图**不进入游戏包体**；未修改 `index_arcane_v2.html`。
- 所有图形由 HTML/CSS + 内联 SVG 绘制，无外部字体、图片、脚本。
- 外部素材若最终引入，必须在此处补记：来源链接、作者、许可证全文与内联体积。
