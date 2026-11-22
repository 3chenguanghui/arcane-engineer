# 技能线 · 手感与可读性（skill-feel-v1）规格

```
TARGET_FILE = index_arcane_v2.html
TARGET_SIZE = 2,947,258 B          （开工实测一致）
TARGET_MD5  = ADE53A18E96D758E531B5C53BB8FB13E
SIM_FILES   = tools/sim_panel/sim.js、tools/sim_panel/config.js（本批禁止修改）
BACKUP      = backup/index-pre-skillfeel.html
```

> 本规格只覆盖「技能手感 / 可读性 / 体检表」三件事，分三次上报，不合并。
> 核心红线：**零新增随机数**、**零数值改动**、**零新外部资源**。

---

## 一、勘察结论（已读代码事实）

| 事实 | 位置 | 影响 |
|---|---|---|
| 21 条技能全部 `color: '#b085ff'` | `MAGIC_CONFIG` L10229–L10371 | 卡面无法靠颜色区分技能 |
| 5 条技能共用 `vfx.type: 'bolt'`（bolt / arcanePool / pulseShock / pierceLance / riftStep） | 同上 | 世界里全是折线光束，互不可辨 |
| ice 3 条、fire 3 条、rune 3 条、heal 2 条 颜色几乎同色 | 同上 | 同屏叠放时糊成一片 |
| 环形状只有 `ring / hex / rune / shockwave` 四种 | `drawRingShape` L38393 | 没有形状语言可分配 |
| `addRing` 无描边（casing）、无朝向 | L40419 | 亮环压在同色背景/同色环上直接消失 |
| `addBurst` / `addSparks` / `nextSfxVariation` 全部调用 `rand()` | L40485 / L40568 / L39452 | **新代码绝对不能调用它们，否则新增随机数** |
| 每次非融合施法统一 `playSfx('cast', 0.5)` | `castSlot` L42549 | 21 条技能施法音完全一样；与元素音同帧叠成糊音 |
| `castBlade` 用 `playSfx('ui')`（界面点击音）当施法音 | L43007 | 掷刃听起来像点按钮 |
| `castMine` 用 `playSfx('frost')` | L43111 | 布雷听起来像冰系技能，元素判断错误 |
| 卡 CSS `::after` 已被占用，`::before` 空闲 | L890 | 可用 `::before` 做左缘辨识色条 |
| 稀有/史诗技能施法时 `FX_TIER_CONFIG.vis.T1.rMul = 1.85` | L39691 | 签名环若走 `addRing` 会被放大 1.85 倍，故签名环**直接 push**、不走 `addRing` |

---

## 二、第 1 项：技能手感与表现（不改数值、不新增随机数）

### 2.1 新增 `SKILL_SIG` 辨识签名表

位置：`SKILL_POOL_CONFIG` 之后（约 L10402）。

```js
const SKILL_SIG = {
  fireball:   { shape: 'chevron',  color: '#ff8a3d', size: 24, dir: true,  sfxRate: 0.94, sfxVol: 0.85 },
  /* ... 21 条，见第 3 项表格 ... */
};
```

字段含义（全部为表现参数，不参与任何伤害/冷却计算）：

| 字段 | 含义 |
|---|---|
| `shape` | 形状语言（见 2.2） |
| `color` | 该技能的辨识主色（战斗中 + 卡面左缘条共用） |
| `size` | 签名基础半径（px） |
| `dir` | 是否随瞄准方向旋转（投射/线/锥 = true） |
| `sfxRate` | 施法音的**音高倍率**（只改参数，不新增调用） |
| `sfxVol` | 施法音的**音量倍率**（同技能已有元素音时压低，避免糊音） |

### 2.2 `drawRingShape` 增加形状分支（纯几何、零随机）

新增 `SIG_SHAPES` 归一化路径表 + `drawSigShape(ring, radius, alpha)`：

- 复刻逻辑：所有点都是 `半径 × 归一化坐标`，无 `Math.random`、无 `rand()`。
- 描边两遍：先 `rgba(4,8,14,0.55)`、线宽 +3（**暗底描边 casing**），再按主色描一遍。
  → 同屏多技能叠放时，每个环都有暗边，不会互相"吃掉"。
- 形状清单（20 种，每种 ≥ 2 个可区分几何特征）：

| shape | 几何 | 用途 |
|---|---|---|
| `chevron` | 单箭头折线 | 投射类 |
| `hexring` | 双同心六边形 | 自身冰环 |
| `zigzag` | 双向折线×2 | 连锁雷 |
| `crossring` | 虚线圈 + 十字 | 治疗 |
| `boomerang` | 对向双箭头 | 回旋 |
| `star4` | 四芒星 | 布雷 |
| `rift` | 三层锯齿横线 | 地裂 |
| `square` | 方 + 内旋 45° 方 | 落点域 |
| `orbit` | 三同心弧 + 4 刻点 | 轨道环带 |
| `spiral` | 阿基米德螺线（24 点） | 坍缩 |
| `cone` | 72° 扇弧 + 两条半径 | 喷火锥 |
| `snow` | 六向雪枝 | 冰霜环 |
| `push` | 双环 + 4 外推箭头 | 斥力脉冲 |
| `lance` | 双平行线 + 尖端 | 贯穿 |
| `target` | 三同心环 + 超长十字准星 | 天陨 |
| `brand` | 三角 + 中心点 | 烙印 |
| `shield` | 六边形盾 + 内向 V | 守护 |
| `diamond` | 双菱形 + 中轴 | 位移 |
| `seal` | 圆 + 4 短外刺 | 霜封印 |
| `hammerMark` | 菱形 + 4 短射线 | 重锤 |

`drawRingShape` 顶部插入：
```js
if (SIG_SHAPES[ring.shape]) { drawSigShape(ring, radius, alpha); return; }
```
`dir: true` 的形状按 `ring.dir` 旋转，其余不旋转。

### 2.3 `addRing` 记录朝向与暗底描边

`addRing` 内 `state.rings.push({...})` 增加两个字段（**不改任何调用点**）：
```js
dir: 0,
casing: !!(state && state.fxTierNow != null)   // 仅在技能施法窗口内生成的环带暗边
```
`drawRingShape` 对 `casing` 为真的环，先画一遍暗底再画原色（原色/线宽/生命周期一律不变）。

### 2.4 施法签名环 `spawnCastSignet(magic, fusion)`

位置：`addRing` 之后。**直接向 `state.rings` push，不走 `addRing`**，因此：
- 不吃 `FX_TIER_CONFIG.vis` 的 1.85 倍放大（否则签名会盖住整个屏幕）；
- 不产生任何 `rand()` 调用。

两枚环构成"前摇 → 后摇"的视觉语法（出手时机不变，伤害仍同帧结算）：

| 环 | 半径 | grow | life | 透明度 | 读作 |
|---|---|---|---|---|---|
| 收束环 | `size × 1.15` | `-size × 0.6` | 0.16 s | 0.95 | "收进来 → 准备" |
| 残留环 | `size × 0.55` | `+size × 1.1` | 0.42 s | 0.45 | "放出去 → 余波" |

颜色：`fusion ? fusion.color : sig.color`；位置 = 角色坐标；`dir = getAimAngle()`。

### 2.5 音效触发点修正（只改参数 / 只换音色名，不增删调用）

| 位置 | 现状 | 改为 | 随机数影响 |
|---|---|---|---|
| `castSlot` L42549 | `playSfx('cast', 0.5)` | `playSfx('cast', 0.5 * sig.sfxVol, { rate: sig.sfxRate })` | 调用次数不变 → 0 |
| `castBlade` L43007 | `playSfx('ui')`（点击音） | `playSfx('bolt', 0.55, { rate: 1.15 })`（短促破空） | 调用次数不变 → 0 |
| `castMine` L43111 | `playSfx('frost')`（冰味） | `playSfx('fuse', 0.5)`（上升引信） | 调用次数不变 → 0 |

> 说明：`playSfx` 内部 `nextSfxVariation()` 每次消耗 2 个 `rand()`。
> 因此本批**绝不新增/删除任何 `playSfx` 调用**，只改既有调用的实参。

### 2.6 验收（第 1 项单独上报）

1. `node tools/arcane_syntax.js` → PASS。
2. 页面启动 error 0（复用 `tools/page_boot_check.js`）。
3. 探针：依次强制释放 21 条技能，断言
   - 每次施法后 `state.rings` 至少 +2，且存在 `shape` 属于 `SIG_SHAPES`；
   - 签名环 `life ≤ 0.45`；
   - `state.rings` 中带 `casing` 的环占比 > 0。
4. 随机数审计：`git diff` 后新代码块中 `rand(` / `Math.random` 出现次数 = **0**。
5. 报：改前/改后字节数、MD5、双击路径、截图两张（多技能同屏）。

---

## 三、第 2 项：技能可读性（形状语言表）

### 3.1 交付表（20 行，随实现一起上报）

列：技能 / 主色 / 形状 / 元素 / 施法音高 / 一眼能否认出。

### 3.2 卡面左缘辨识色条

- CSS（`.mini-card` 规则区，L876 之后插入）：
```css
.mini-card.magic::before {
  content: ""; position: absolute; left: 0; top: 7px; bottom: 7px; width: 3px;
  border-radius: 0 2px 2px 0; background: var(--mc, transparent); opacity: 0.9;
}
```
- HTML（`renderDeck` 内 L26366 一带）：把现有 `--fv` 内联样式改为合并写入：
  `--mc:<签名主色>` + （融合时）`--fv:<融合色>`。
- 约束：不改稀有度边框、不改 `.m-glyph` 的稀有度色，**只加一条左缘竖条**。

### 3.3 验收

- 21 张魔法卡左缘颜色互不重复（按 RGB 去重后 = 21 或明确分组说明）；
- 同屏截图里 3 条不同技能同时释放，形状可区分；
- 页面 error 0；字节数/MD5 上报。

---

## 四、第 3 项：体检表 + 收益最高前 2 项

### 4.1 体检表（六维，随实现上报）

UI / 动画 / 手感 / 性能 / 无障碍 / 文案，每维列已做、未做、收益、成本。

### 4.2 本批落地的前 2 项（零数值、零随机）

**① 性能护栏：特效环软上限 + 同帧签名去重**

- 问题：`state.rings` 无上限（L40423 只 push，L46240 只按寿命删）。极端连发/融合时环数量线性增长。
- 方案：`updateEffects` 每帧后若 `rings.length > RING_SOFT_CAP (120)`，从最老（数组头部）删到 120。
  只删"最早生成的环"，不删本帧新生成的；末位保留策略简单可测。
- 随机数影响：0。

**② 无障碍：签名动画尊重 `prefers-reduced-motion`**

- 方案：`spawnCastSignet` 读取 `window.matchMedia('(prefers-reduced-motion: reduce)').matches`；
  命中时只推 1 枚静态环（`grow = 0`、`life = 0.22`、透明度 0.7），不做收束/外扩动画。
- 闪白保持不动；屏震按 4.3 在 reduced-motion 下取消平移。
- 随机数影响：0。

### 4.3 实际交付追加（执行中确认成本低于预估，已并入本批）

- **② 扩展**：`prefers-reduced-motion` 同时取消**屏幕震动平移**（放在两条震屏分支之后，
  旧分支的 `Math.random()` 照常执行，随机数消耗不变）。
- **追加：命中飘字归属色**。原计划列为"暂不做"，但代码里 `damageEnemy(enemy, amount, dirAngle, opts)`
  已经携带 `opts.abilityId`，因此不需要改伤害结算数值，只需把普通命中的数字颜色映射到
  `SKILL_SIG[opts.abilityId].color`。暴击金 / 重击琥珀 / 回程冷蓝的既有优先级保持不变，
  纯环境伤害回落到原浅粉。

### 4.4 明确"暂不做"（写进体检表）

- 卡面副标题补"范围/延迟"：`MAGIC_CONFIG` 目前没有 range / delay 字段，需要先补数据，
  否则只能编数字——不做。
- 卡面 tooltip 显示形状名（收益低，信息已由左缘色条承担）。
- 技能树 / 图鉴同步形状语言（成本高，下一批）。

---

## 五、硬约束核对清单（每项完成后逐条打勾）

1. `sim.js` / `config.js` MD5 不变（3051C033… / 6CA6E486…）。
2. 新代码 `rand(` / `Math.random` 计数 = 0。
3. `MAGIC_CONFIG` 的 cost / cooldown / damage / heal 一个字节不改。
4. 不新增外部文件引用（不引 `skill-fx.js`，全部内联）。
5. 改前备份 `backup/index-pre-skillfeel.html` 并报字节数 + MD5。
6. `tools/arcane_syntax.js` PASS、页面 error 0。
7. 三项分别上报，不合并。

---

## 六、回滚

```powershell
Copy-Item backup\index-pre-skillfeel.html index_arcane_v2.html -Force
```
回滚后应恢复 **2,947,258 B / ADE53A18E96D758E531B5C53BB8FB13E**。
