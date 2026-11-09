# U8 · 音画质感包：Boss 登场大字 + 音效微抖

> 出处：`.spec/round4-5-merge.md` 的 **B8（Boss 登场标题大字，P1 / 改动小）** 与 **D7（音效音高 / 音量微抖，P1 / 最便宜）**。
> 两条都属于"花很少的代码换明显的手工感"，因此合并在一个单元里做完。

---

## 1. 根因（一句话）

**Boss 的"正式感"只靠一条 toast + 浮动名字，玩家很容易看漏；音效每次都是同一个波形，连打时有"电子味"。**

拆成两个子根因：

- **B8**：`startBossIntro()` 只有 `showToast(...)` 与 `addFloat(...)`，两者都在游戏画布/短提示层，**没有全屏级的仪式感**，重要程度和"捡到药水"是一样的视觉权重。
- **D7**：`playSfx()` → `buildSfx(ac, bus, name, vol, rate)`，`rate` 恒为 1、`vol` 恒定，同一音效连续触发时波形完全一致，听感机械。

## 2. 改法

### 2.1 B8：Boss 登场全屏大字

1. HTML 新增 `#bossTitle`（`pointer-events:none`，不挡操作）：
   - `.boss-title-kicker`：`BOSS ENCOUNTER`（固定英文小标，与中文名形成层级）；
   - `#bossTitleName`：Boss 名；
   - `#bossTitleSub`：Boss 称号。
2. CSS `.boss-title`：`position:fixed; inset:0; z-index:40`，中心径向压暗，`--boss-color` 由 JS 注入（沿用每个 Boss 自己的主色）。
3. 四段关键帧：kicker 0.08s 淡入 → 名字 0.16s 放大聚焦（带轻微过冲）→ 副标题 0.34s → 1.75s 整体上移淡出。
4. `showBossTitle(name, title, color)`：写文案 → 强制回流（保证同层连续换 Boss 时动画能重播）→ `is-playing` → 2.3s 后强制 `hidden`（长跑不残留 DOM 层）。
5. `startBossIntro()` 末尾调用；`state.u8V1 === false` 时直接返回 `false`（A/B 可关）。

### 2.2 D7：音效微抖

1. `nextSfxVariation()` 返回 `{ rate: 1 ± 3.5%, gain: 1 ± 5% }`。
2. `playSfx()` 内部统一乘上：`baseVol * vari.gain`、`(o.rate || 1) * vari.rate`。
3. `state.u8V1 === false` 时退化 `{ rate: 1, gain: 1 }`（完全关闭，便于对比与回归）。
4. 幅度刻意压小：不是"变声"，而是"不像复制粘贴"。

## 3. 保留约束

- 不改音频限频 / 并发上限（`AUDIO_CONFIG.rateLimit`、`voiceLimit` 原样生效）。
- 不改 `AUDIO_CONFIG.tones` 的任何音色参数。
- 不改 Boss 两阶段、登场无敌时间、`BOSS_CONFIG.introTime`；大字纯附加表现。
- 大字 `pointer-events:none` + `aria-hidden`，不参与任何输入与命中判定。
- 单文件零依赖、无图片，全部 DOM + CSS。

## 4. 验收断言（`tools/arcane_u8.js`，端口 9492）

| # | 断言 | 口径 |
|---|---|---|
| 1 | 静态守卫 | `#bossTitle` / `showBossTitle` / `nextSfxVariation` 均存在 |
| 2 | 大字可见 | `previewBossTitle()` → `visible=true`，`name`/`sub` 非空，kicker 文案为 `BOSS ENCOUNTER` |
| 3 | 自动收起 | 2.6s 后 `#bossTitle` 回到 `hidden`（≤2.3s 设计 + 动画余量） |
| 4 | 不挡操作 | `getComputedStyle(#bossTitle).pointerEvents === 'none'` |
| 5 | A/B 关闭 | `setU8(false)` → `previewBossTitle().visible === false` |
| 6 | 微抖进波形 | `sfxJitter()` 三次离线渲染 `distinct ≥ 2` |
| 7 | 微抖幅度小 | 三次峰值极差 / 均值 ≤ 12%（证明是"微"抖不是"变声"） |
| 8 | 关闭后无抖 | `setU8(false)` → `sfxJitter().distinct === 1`（三次波形完全一致） |
| 9 | 恢复 | `setU8(true)` 后 `state.u8V1 === true` |
| 10 | 截图 | before（关闭）/ after（开启）同机位截图均 >10KB，after 能读到全屏大字 |
| 11 | 性能 | avg fps ≥ 60（跳过前 40 帧预热）、运行时 errors 0 |
| 12 | 回归 | 14 套全绿 |

## 5. 设计取舍

- **D1 大字 2.3s**：比 `introTime`（1.2s）长，让演出在"玩家已经能动"之后继续存在，但不至于挡住第一次交锋。
- **D2 用 DOM 而非 canvas 绘制**：不受屏幕特效 / 相机位移影响，也不用每帧绘制；代价是多一层 DOM，故强制 2.3s 收起。
- **D3 微抖做在 `playSfx` 单点**：所有音效果统一生效，新加音效不必逐个改；`force`（连杀音阶）路径同样吃到微抖，但音阶差远大于 3.5%，不会听混。
- **D4 不抖 BGM**：BGM 有自己的音量/播放器，混入微抖会让循环段落出现接缝；本单元只动 SFX。
