# SETTINGS_PLAN · 设置页与选项完整度

> 线：设置页与选项完整度（只做盘点和补丁设计，**本线不改主文件、不开浏览器**）
> 交：整合线贴入主文件
> 盘点快照：`index_arcane_v2.html`
> 字节 2,836,186 / 字符 2,371,300 / 行 66,032 / MD5 `8C7DC978C5F671979F022746F5B67584`（23:13:45）
> 注意：盘点期间主文件被其他线连续写入（前一次读数 2,833,963 → 2,836,186）。**本方案不以 MD5 为锚**，全部用函数名 / 唯一 id / 唯一文案作锚；贴前必须重新取指纹并逐条核对锚点。
> **后续版本**：分组、项数与补丁块以 [`SETTINGS_SPEC.md`](SETTINGS_SPEC.md) 为准（5 组 31 项、锚点编号 S1–S11、快照 v1.8.2）；本文件保留为第一轮盘点与问题清单。

---

## 一、盘点现状

### A. 设置面板内（`#settingsPanel`，快照第 6421 行起；静态 186 个标签 / 23 个 `.setting-row` / 11 个分区）

| # | 设置项 | 现在藏在哪个分区 | 默认值 | 存储 | 真生效 | 处置 |
|---|---|---|---|---|---|---|
| 1 | 氛围 BGM 开关 | 音频 | 关 | `arcane_rogue_audio.bgmOn` | 是 | 改名「环境层」 |
| 2 | BGM 音量（0–100，step 5） | 音频 | 25% | 同上 `.bgm` | 是 | 改名「环境」 |
| 3 | 音效音量（0–100，step 5） | 音频 | 62% | 同上 `.sfx` | 是 | 保留 |
| 4 | 主音量 | **不存在**（只能靠 N 静音） | 100% | 无 | — | **新增滑杆** |
| 5 | 静音（N / 顶部喇叭） | 顶栏 + 快捷键 | 关 | `arcane_rogue_audio.muted` | 是 | 音频页补一个同状态开关 |
| 6 | 辅助瞄准 强/弱/关 | 操作 | 弱 | `meta.aimMode` | 是 | 操作页 |
| 7 | 近战武器（Q） | 操作 | 开 | `meta.weapon.enabled` | **否**：`WEAPON_CONFIG.enabled=false`，整行已隐藏 | 保持隐藏，不复活 |
| 8 | 角色朝向（永远看准心） | 角色朝向 | 关 | `meta.alwaysAim` | 是 | 操作页 |
| 9 | 后处理特效 | 画面 | 开 | `meta.postFx` | 是 | 画面页 |
| 10 | 性能模式 | 画面 | 关 | `meta.performance.mode` | 是 | **合并进画质三档**，删开关 |
| 11 | 泛光 BLOOM | 画面 | 开 | `meta.postfx.bloom` | 是（全屏后期被关时一并失效） | 画面页 |
| 12 | 色差 CHROMA | 画面 | 关 | `meta.postfx.chroma` | 是 | 画面页 |
| 13 | 扫描线 CRT | 画面 | 关 | `meta.postfx.crt` | 是 | 画面页 |
| 14 | 暗角 VIGNETTE | 画面 | 开 | `meta.postfx.vignette` | 是 | 画面页 |
| 15 | 冲刺残影 | 画面 | UI 写「默认关」，`meta.motionTrail` 实际默认 `true` | `meta.motionTrail` | **假开关**：`DASH_CONFIG.trailEnabled=false`，永远不画 | **删行**（保留存档字段做兼容） |
| 16 | 大区切换演出 | 画面 | 开 | `meta.regionFx` | 是 | 画面页 |
| 17 | 减少屏震 | 可访问性 | 关 | `meta.reduceShake` | 是（100% → 35%） | 画面页「视觉舒适」 |
| 18 | 关闭闪白 | 可访问性 | 关 | `meta.reduceFlash` | 是 | 同上 |
| 19 | 连击演出 | 可访问性 | 开 | `meta.comboFx` | 是 | 同上 |
| 20 | 色盲 / 高对比 | 可访问性 | 关 | `meta.colorblind` | 只做「形状区分」，**没有高对比** | 改名「色盲 / 形状辅助」 |
| 21 | 战斗信息 完整/标准/极简 | 可访问性 | 标准 | `meta.infoMode` | 是 | 画面页 |
| 22 | 局内存档 3 槽 + 自动存 | 局内存档 | 自动开 | `arcane_run_slots_v1` | 是 | 存档页 |
| 23 | 手动保存 / 导出 / 返回标题 | 局内存档 | — | 同上 | 是 | 存档页 |
| 24 | 导入到当前槽 | 局内存档 | — | 同上 | 是 | 存档页 |
| 25 | 存档安全（备份 / 恢复 / 坏档原文） | 运行时注入在「清空永久存档」前 | 自动 3 份 | `arcane_rogue_meta.bak.*` | 是（SAVE_GUARD 已落地） | **并入存档页，不另做一套** |
| 26 | 清空永久存档 | 独立 `.settings-save` | 两段确认 | `arcane_rogue_meta` | 是 | 存档页末尾 |
| 27 | 回顾教学 | 教学 | 前五层 | `meta.onboard`（只读展示） | 是 | 操作页 |
| 28 | 打开完整说明（H） | 说明 | — | — | 是 | 操作页 |
| 29 | 版本 / 作者 / 档案统计 / 成就 | 关于 / 档案 | v1.8.0 / 陈光辉 制作 | 读 `GAME_CONFIG` | 是 | 关于页 |

### B. 散落在设置页之外（不进设置页也要补的入口）

| 项 | 位置 | 默认 | 说明 |
|---|---|---|---|
| 难度 | 标题页 | 普通 | 与设置无关，保留原入口 |
| 挑战等级 | 标题页（未解锁时置灰） | 0 | 同上 |
| 种子 / 每日挑战 | 标题页 | 空 / 无 | 同上 |
| 角色 / 起始卡 / 武器 | 标题页 | 中性 / 火球 / 匕首（武器行已隐藏） | 同上 |
| 天赋 / 图鉴 / 存档槽 | 标题页 | 0 / 无 | 标题页与设置页各自可达，不合并 |
| 标题背景动效 | 标题页 | 开 | `arcane.titleMotion`，只在标题页生效，不搬进局内设置 |
| 标题页声音 | 标题页 | 开 | 与 `muted` 同一状态，保留为快捷入口 |
| 暂停菜单 | 局内 | — | 已有「设置 / 说明 / 重开」，不改结构 |
| 快捷键 | 全局 | O 设置 / N 静音 / H 说明 | 保留 |

---

## 二、先修 6 个硬问题（不修就等于把问题搬进新设置页）

1. **假开关**：冲刺残影。`meta.motionTrail` 默认 `true`，UI 静态文案写「默认关」，渲染门 `DASH_CONFIG.trailEnabled === false`，三项互相矛盾，玩家怎么点都看不到。→ 删掉 UI 行，存档字段原样保留，不实现残影（本线不扩视觉预算）。
2. **重复控制**：性能模式 vs 画质三档。同一套粒子/迷雾/后期，两个入口会互相打架。→ 性能模式并入画质，`setPerfMode()` 只保留给调试口，映射到 `low/high`。
3. **夸大文案**：画面区写「关闭后可提升低配机帧率」。泛光实测只占 0.5–1.1 ms，不能当帧率卖点。→ 改成「少一层全屏叠加，帧率收益不保证」。
4. **色盲 / 高对比**：代码只加形状区分，没有提高对比度。→ 改名「色盲 / 形状辅助」，不再承诺高对比。
5. **手机操作教学**：`buildRulesContent()` 的操作页只有 `HELP_KEYS`（WASD / E / F / Q / Tab…）；`touchHtml()` 只处理运行期提示，没处理说明页。手机玩家点开说明仍在学键盘。→ 操作页改三套页签，触屏设备默认触屏页。
6. **触屏文案覆盖过宽**：`applyTouchCopy()` 用 `document.querySelector('.setting-note')` 改的是**第一个** setting-note（音频说明），不是它想改的那条。→ 改成唯一 id。

---

## 三、重新分组（按玩家问题，不按代码结构）

| 页签 | 玩家问题 | 收纳内容 | 来源分区 |
|---|---|---|---|
| **音频** | 听不见 / 太吵 | 主音量（新）、环境（原 BGM + 音量）、音效、静音 | 音频 |
| **画面** | 太卡 / 眼睛累 | 画质三档（新）、后处理总开关、泛光/色差/CRT/暗角、大区演出、减少屏震、关闭闪白、连击演出、色盲/形状辅助、战斗信息 | 画面 + 可访问性 |
| **操作** | 不会玩 / 手机怎么按 | 辅助瞄准、角色朝向、输入方式（键盘/手柄/触屏，默认按设备）、回顾教学、打开说明 | 操作 + 角色朝向 + 教学 + 说明 |
| **存档** | 进度丢了 / 换设备 | 局内存档 3 槽、导出/导入、存档安全（备份/恢复/坏档原文）、清空永久存档 | 局内存档 + SAVE_GUARD + 清空 |
| **关于** | 这是啥版本 / 找谁反馈 | 版本、署名、反馈（复制诊断信息）、档案统计、成就 | 关于 + 档案 |

**存档合流约定**：`SAVE_GUARD` 继续在运行时把「存档安全」段插到 `.settings-save` 前面，本线不改它的代码；分组函数每次切页签按标题重新归属，所以后注入的段会自动落进「存档」页。不新增第二个存档面板、不新增 meta 导出。

---

## 四、逐项可感知差异（红线：调了听不出/看不出就不放）

### 新增项

| 项 | 最低 | 最高 | 可辨证据 |
|---|---|---|---|
| 主音量 0–100% | 0%：`master.gain=0`，全部静音 | 100%：`1.0`，当前最大 | 听感 0 / 满，无中间歧义 |
| 环境（0–100%，默认 25%，层默认关） | 0%：氛围层消失 | 100%：比默认 25% 高 **+12 dB** | 拖动即自动开层，避免「拖了没声」 |
| 音效（0–100%，默认 62%） | 0%：打击/UI 全静音 | 100%：比默认高 **+4.2 dB** | 单次普攻即可分辨 |
| 画质 · 省电 | dpr 1.0 / 粒子 45% / 迷雾 50% | — | 1920×1080 下主画布 **2.07 MP vs 高清 8.29 MP（4× 像素）**；迷雾 **7.0 MiB vs 28.1 MiB**；18 颗弹片 → 8 颗 |
| 画质 · 均衡 | dpr 1.5 / 粒子 70% / 迷雾 75% | — | 4.67 MP；迷雾 15.8 MiB；18 → 12–13 颗。dpr2 屏上肉眼可辨；dpr1 桌面主要差在迷雾软硬与粒子密度 |
| 画质 · 高清 | dpr 2.0 / 粒子 100% / 迷雾 100% | — | 与 v1.8.0 当前完全一致（默认档，老玩家不变） |
| 输入方式 | 键盘 / 手柄 / 触屏三套说明 | — | 触屏设备默认打开触屏页；按钮切换后说明文字整套替换 |
| 反馈 · 复制诊断 | 无 | 复制版本/UA/视口/dpr/画质/音量到剪贴板 | 粘贴可见，离线、零网络 |

> 画质档只动渲染：**不碰敌人数量、掉落、种子派生**。自适应降级链若下调敌人，属于玩法降级，与本档互不调用；本档只提供 `dprCap / particleScale / fogScale` 三个真实消费点（「特效密度」在本项目里就是粒子数，不另造空字段）。

### 保留项

| 项 | 最低 / 关 | 最高 / 开 |
|---|---|---|
| 环境层开关 | 无氛围层 | 按 25% 播放低频垫底 |
| 辅助瞄准 | 关：零偏转 | 强：全向锁定；弱：±25°/440px/60% 偏转、命中半径 +20% |
| 角色朝向 | 关：朝移动方向 | 开：永远朝准心 |
| 后处理 | 关：像素溶解/故障/冲击/扫描线全停 | 开：命中/击杀可见 |
| 泛光 | 关：亮部光晕消失（成本仅 0.5–1.1 ms，**不作为档位卖点**） | 开：轻量光晕 |
| 色差 / CRT / 暗角 | 关：无边缘彩边 / 无扫描线 / 无压角 | 开：对应效果出现 |
| 大区切换演出 | 关：普通下楼 | 开：约 1.4 s 换区演出，可点/ESC 跳过 |
| 减少屏震 | 关：100% 幅度 | 开：35% 幅度 |
| 关闭闪白 | 关：保留闪白 | 开：命中/受伤不闪白 |
| 连击演出 | 关：无脉冲/冲击环/爆裂 | 开：连击层数有演出 |
| 色盲 / 形状辅助 | 关：只靠颜色 | 开：额外形状标识（**不含高对比**） |
| 战斗信息 | 极简：最少行 | 完整：全行 |
| 存档导出/导入 | 不操作 | 文本出现在框内 / 覆盖当前槽 |
| 备份恢复 | 不操作 | 回滚到备份并刷新 |
| 清空永久存档 | 不操作 | 二次确认后清空 |

### 删除 / 不复活

| 项 | 原因 |
|---|---|
| 冲刺残影 | 假开关，渲染门永久关闭；保留 `meta.motionTrail` 字段不读不写 |
| 性能模式开关 | 被画质三档替代；`setPerfMode()` 仅保留调试入口 |
| 近战武器开关 | 整行已隐藏，`WEAPON_CONFIG.enabled=false`；武器系统回归时再开 |

---

## 五、代价

### DOM 节点

基线 1,111 个节点 / 首次布局 346.5 ms（中位，295.9–362.9）。

| 变更 | 初始节点 | 说明 |
|---|---|---|
| 音频：主音量行 + 静音行 | +8 | 2 行 × 4 节点 |
| 画面：性能开关 → 画质三档 | +3 | 4 节点 → 7 节点（组 + 3 按钮 + 状态） |
| 操作：输入方式行 | +8 | 行 + 标签 + 组 + 4 按钮 + 状态 |
| 关于：反馈行 + 说明 | +5 | 行 + 标签 + 按钮 + 状态 + note |
| 画面：删冲刺残影行 | −4 | 整行移除 |
| 设置页签栏 | +0 初始 / +6 首开 | 首次打开设置时动态插入（容器 + 5 按钮） |
| 说明页输入方式页签 | +4 初始 | 只建页签按钮；非当前设备的说明卡片按需生成，切换时 +9（触屏）/ +22（手柄） |
| **合计** | **+24 初始（1,111 → 约 1,135，+2.2%）** | 设置首开约 1,141（+2.7%） |

- 说明页仍保留 init 里的 `buildRulesContent()`（不改成懒加载，避免影响现有验收脚本），只是操作页按设备只生成当前一套卡片，所以初始不增反略减（触屏设备比键盘少 9 行）。
- 首次布局预计增量低于 2.2 ms 分辨力，属「不可分辨」；**这是估算，不是实测**。合入后必须同机 5 轮测 before/after，若 P95 差 > 2.2 ms 再收。

### init 时间

- 设置页签在「打开设置」时才建，首帧不付。
- 新增静态行只是 18 个 flex 子节点；`cacheUi` 多 5 个 `getElementById`；`applyPerfMode` 里 `renderPerfState` 换成 `renderQualityTier`（3 个按钮状态），量级相同。
- 说明页 `buildRulesContent()` 的节点量与现在持平（只建一套输入方式卡片）。
- 结论：**init JS 增量预计 < 0.1 ms，属不可分辨**；不承诺正收益。

### 其他

- CSS 只加 3 条（页签栏、隐藏分区、页签按钮复用现有 `.aim-mode` 外观），约 0.2 KB。
- 画质档不改场景底图 `sceneScale`（1.5 恒定）。原因：`bakeScene()` 内部用 `rand()` 分配装饰相位，中途重烘会扰动玩法随机流，违反「同种子同局」。清晰度差异由主画布 dpr + 迷雾采样率承担。
- 内存收益（省电档）：迷雾 28.1 → 7.0 MiB；1920×1080 主画布 33.2 → 8.3 MB（RGBA 估算）。

---

## 六、补丁设计

### 6.0 贴前核对

1. 重新取主文件 字节/字符/行数/MD5，记进批登记。
2. 逐段用函数名/唯一 id 复核锚点（见 6.12），任一锚点 `n != 1` 停手。
3. 本线所有段都可用 `?settings=off` 关闭（新增 `SETTINGS_PATCH_CONFIG.enabled`，默认 true），出问题只回退整块。

### 6.1 HTML · 设置页签栏（唯一锚点 `<div class="settings-panel">`）

页签栏**不进静态 HTML**，由 6.7 在首次打开设置时插入，首帧不付 6 个节点：

```html
<div class="settings-panel">
  <section class="settings-box"> ... 原内容不动 ...
```

CSS：

```css
.settings-tabs { display:flex; gap:6px; flex-wrap:wrap; margin:0 0 10px; }
.settings-tab { font:inherit; cursor:pointer; padding:6px 12px; border-radius:8px;
  border:1px solid rgba(62,230,255,.28); background:rgba(9,20,34,.6); color:#9fb6c9; }
.settings-tab.is-on { color:#eaf6ff; border-color:rgba(255,194,71,.55); background:rgba(255,194,71,.12); }
.settings-box.is-tab-off, .settings-save.is-tab-off { display:none; }
```

分组不改每个分区 HTML，只在 JS 里按标题归属（新增的「存档安全」段也能自动收进存档页）。

### 6.2 HTML · 音频新增两行（锚点：`id="audioStateText"` 之后、`id="bgmToggleLabel"` 之前）

```html
<div class="setting-row">
  <label for="masterVolume">主音量</label>
  <input type="range" id="masterVolume" min="0" max="100" step="5" value="100" aria-label="主音量" />
  <b id="masterVolumeText">100%</b>
</div>
<div class="setting-row">
  <label id="settingsMuteLabel">静音（N）</label>
  <div id="settingsMuteToggle" class="switch" role="switch" tabindex="0" aria-checked="false" aria-labelledby="settingsMuteLabel"></div>
  <span class="setting-state" id="settingsMuteState">声音开</span>
</div>
```

「氛围 BGM」→「环境层」；「BGM 音量」→「环境音量」。只改文案，不改 `bgm` 字段。

### 6.3 HTML · 性能模式行 → 画质三档（锚点：`id="perfToggleLabel"` 整段 4 行）

删除：

```html
<div class="setting-row">
  <label id="perfToggleLabel">性能模式</label>
  <div id="perfToggle" class="switch" role="switch" tabindex="0" aria-checked="false" aria-labelledby="perfToggleLabel"></div>
  <span class="setting-state" id="perfStateText2">关 · 全画质</span>
</div>
```

替换为：

```html
<div class="setting-row">
  <label>画质</label>
  <div class="aim-modes" id="qualityModes" role="group" aria-label="画质档位">
    <button type="button" class="aim-mode" data-quality-tier="low">省电</button>
    <button type="button" class="aim-mode" data-quality-tier="mid">均衡</button>
    <button type="button" class="aim-mode" data-quality-tier="high">高清</button>
  </div>
  <span class="setting-state" id="qualityStateText">高清</span>
</div>
<div class="setting-note" id="qualityNote">
  省电：1× 分辨率 / 45% 粒子 / 50% 迷雾；均衡：1.5× / 70% / 75%；高清：2× / 100% / 100%。
  后处理在省电档强制关闭；帧率差异来自分辨率与迷雾，泛光不作为档位卖点。
</div>
```

同时把画面区末尾那句「关闭后可提升低配机帧率」改成「少一层全屏叠加；帧率收益不保证，主要省填充与显存」。

### 6.4 HTML · 操作页输入方式（锚点：`id="aimNote"` 之后）

```html
<div class="setting-row">
  <label>输入方式</label>
  <div class="aim-modes" id="inputSchemeModes" role="group" aria-label="输入方式">
    <button type="button" class="aim-mode" data-input-scheme="auto">自动</button>
    <button type="button" class="aim-mode" data-input-scheme="keyboard">键盘</button>
    <button type="button" class="aim-mode" data-input-scheme="gamepad">手柄</button>
    <button type="button" class="aim-mode" data-input-scheme="touch">触屏</button>
  </div>
  <span class="setting-state" id="inputSchemeState">自动</span>
</div>
<div class="setting-note" id="inputSchemeNote">显示当前设备的一套操作；点「打开说明」看完整按键表。</div>
```

四按钮版本共 8 个节点；连同反馈说明，总账为 +24 初始。

### 6.5 HTML · 删除冲刺残影行（锚点：`id="motionTrailLabel"` 整段 4 行）

连注释带行删除。`meta.motionTrail` 字段保留，`normalizeMeta` 不动，避免旧档字段被清。

### 6.6 HTML · 关于页反馈行（锚点：`id="aboutAuthor"` 这个 div 之后）

```html
<div class="setting-row">
  <label>反馈</label>
  <button type="button" class="btn" id="btnCopyDiagnostics">复制诊断信息</button>
  <span class="setting-state" id="diagCopiedState">离线可用</span>
</div>
<div class="setting-note">
  遇到卡顿/听不见/进度问题，先看「画面 / 音频 / 存档」；仍无法解决就把这段诊断信息发给作者（陈光辉）。
</div>
```

### 6.7 JS · 页签分组（锚点 `function renderSettingsPanel()`）

```js
/* 设置页 5 个页签：按玩家问题分组，不按代码结构。
   分区靠 h3 标题前缀归属，所以 SAVE_GUARD 后注入的「存档安全」段会自动进存档页。 */
const SETTINGS_TABS = [
  { id: 'audio',   label: '音频', sections: ['音频'] },
  { id: 'display', label: '画面', sections: ['画面', '可访问性'] },
  { id: 'control', label: '操作', sections: ['操作', '角色朝向', '教学', '说明'] },
  { id: 'save',    label: '存档', sections: ['局内存档', '存档安全', '清空永久存档'] },
  { id: 'about',   label: '关于', sections: ['关于', '档案'] }
];
let settingsTabId = 'audio';

/** 判断一个设置分区属于哪个页签 */
function settingsTabOf(box) {
  if (!box) return '';
  if (box.classList && box.classList.contains('settings-save')) return 'save';
  const h = box.querySelector && box.querySelector('h3');
  const name = h ? h.textContent.trim() : '';
  const hit = SETTINGS_TABS.find((t) => t.sections.some((s) => name.startsWith(s)));
  return hit ? hit.id : '';
}

/** 切换页签：只切显示，不动任何设置值 */
function showSettingsTab(id) {
  if (!ui.settingsPanel) return;
  settingsTabId = id;
  const boxes = ui.settingsPanel.querySelectorAll('.settings-box, .settings-save');
  boxes.forEach((box) => {
    const tab = settingsTabOf(box);
    if (tab) box.classList.toggle('is-tab-off', tab !== id);
  });
  if (ui.settingsTabs) {
    ui.settingsTabs.querySelectorAll('[data-settings-tab]').forEach((btn) => {
      const on = btn.dataset.settingsTab === id;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }
}

/** 首次打开设置时建页签栏并绑定（首帧不付 DOM） */
function ensureSettingsTabs() {
  if (!ui.settingsPanel) return;
  if (!ui.settingsTabs) {
    const bar = document.createElement('div');
    bar.className = 'settings-tabs';
    bar.id = 'settingsTabs';
    bar.setAttribute('role', 'tablist');
    bar.setAttribute('aria-label', '设置分组');
    SETTINGS_TABS.forEach((t) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'settings-tab' + (t.id === settingsTabId ? ' is-on' : '');
      btn.dataset.settingsTab = t.id;
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', t.id === settingsTabId ? 'true' : 'false');
      btn.textContent = t.label;
      bar.appendChild(btn);
    });
    ui.settingsPanel.insertBefore(bar, ui.settingsPanel.firstChild);
    ui.settingsTabs = bar;
    bar.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-settings-tab]');
      if (btn) showSettingsTab(btn.dataset.settingsTab);
    });
  }
  showSettingsTab(settingsTabId);
}
```

在 `renderSettingsPanel()` 开头调用 `ensureSettingsTabs();`。`cacheUi` 补：`masterVolume`、`masterVolumeText`、`settingsMuteToggle`、`settingsMuteState`、`qualityModes`、`qualityStateText`、`inputSchemeModes`、`inputSchemeState`、`btnCopyDiagnostics`、`diagCopiedState`。`settingsTabs` 不预取（首开建后挂到 `ui`）。

### 6.8 JS · 音频（锚点 `function applyAudioSettings()` / `function renderAudioSettings()` / `loadAudioSettings` / `saveAudioSettings`）

```js
// AUDIO_CONFIG / audioSettings 各加 master
masterVolume: 1.0,   // 主音量默认 100%，与旧版响度一致
master: 1.0,

// load：旧档没有 master → 1.0，保持旧响度
if (Number.isFinite(data.master)) audioSettings.master = clamp(data.master, 0, 1);
// save：带 master
master: audioSettings.master,

// applyAudioSettings：master 从 0/1 门变成 0–100% 增益
if (audioState.master) audioState.master.gain.value = audioSettings.muted ? 0 : audioSettings.master;
```

绑定（放在现有 `bgmVolume` 监听旁）：

```js
if (ui.masterVolume) {
  ui.masterVolume.addEventListener('input', () => {
    audioSettings.master = clamp(Number(ui.masterVolume.value) / 100, 0, 1);
    if (audioSettings.muted && audioSettings.master > 0) { audioSettings.muted = false; ensureAudio(); }
    applyAudioSettings(); saveAudioSettings(); renderAudioSettings();
  });
}
if (ui.settingsMuteToggle) ui.settingsMuteToggle.addEventListener('click', () => { toggleMute(); renderAudioSettings(); });
```

环境音量必须在拖动时自动开层，否则「层关 + 音量 25%」拖了没声，等于假控件：

```js
ui.bgmVolume.addEventListener('input', () => {
  audioSettings.bgm = clamp(Number(ui.bgmVolume.value) / 100, 0, 1);
  if (!audioSettings.bgmOn && audioSettings.bgm > 0) { audioSettings.bgmOn = true; ensureAudio(); }
  applyAudioSettings(); saveAudioSettings(); renderAudioSettings();
});
```

`renderAudioSettings` 补：

```js
if (ui.masterVolume) ui.masterVolume.value = String(Math.round(audioSettings.master * 100));
if (ui.masterVolumeText) ui.masterVolumeText.textContent = Math.round(audioSettings.master * 100) + '%';
if (ui.settingsMuteToggle) ui.settingsMuteToggle.setAttribute('aria-checked', audioSettings.muted ? 'true' : 'false');
if (ui.settingsMuteState) ui.settingsMuteState.textContent = audioSettings.muted ? '已静音' : '声音开';
```

音频总线契约：三条滑杆对应 `master.gain / bgmBus.gain / sfxBus.gain`。环境 = 现有 `bgmBus`（AUDIO_AMBIENCE 线没有独立 envBus）。若音频总线线后续新增 `envBus` 或统一 setter，必须让「环境」走它的 setter；本段不抢改名。

### 6.9 JS · 画质三档（锚点 `const PERF_CONFIG` / `function perfParticleScale` / `function perfFogScale` / `function applyPerfMode` / `function setPerfMode`）

```js
/* 画质三档：只改渲染，不碰敌人数量/掉落/种子。
   「特效密度」在本项目的真实消费点就是粒子数，不另造空字段。 */
const QUALITY_TIERS = {
  low:  { label: '省电', dprCap: 1.0, particleScale: 0.45, fogScale: 0.50 },
  mid:  { label: '均衡', dprCap: 1.5, particleScale: 0.70, fogScale: 0.75 },
  high: { label: '高清', dprCap: 2.0, particleScale: 1.00, fogScale: 1.00 }
};

/** 当前档位：旧档只有 performance.mode 时迁移为 low/high；初始化早期兜底 high */
function currentQualityTier() {
  if (!state || !state.meta) return 'high';
  const t = state.meta.qualityTier;
  if (QUALITY_TIERS[t]) return t;
  return state.performanceMode ? 'low' : 'high';
}

/** 主画布 dpr：所有渲染与验收采样必须走这一个函数 */
function renderDpr() {
  return Math.min(window.devicePixelRatio || 1, QUALITY_TIERS[currentQualityTier()].dprCap);
}

// 自适应契约：自动链只能按 dpr → 粒子 → 迷雾 → 后处理 的顺序下调，
// 最终落到 low/mid/high 三档之一；不得越过渲染层改敌人数量/掉落/种子。

function perfParticleScale() {
  if (PERF_CONFIG.enabled === false) return 1;
  return QUALITY_TIERS[currentQualityTier()].particleScale;
}

function perfFogScale() {
  if (PERF_CONFIG.enabled === false) return 1;
  return QUALITY_TIERS[currentQualityTier()].fogScale;
}

/** 写档 + 立即生效：重建迷雾缓冲与主画布，不重烘场景（避免扰动 rand 流） */
function setQualityTier(tier) {
  if (!QUALITY_TIERS[tier]) return;
  state.meta.qualityTier = tier;
  state.meta.performance = state.meta.performance || {};
  state.meta.performance.mode = tier === 'low';
  saveMeta();
  applyPerfMode();      // 重置 fog W/H + 后处理强制关（low）
  resizeCanvas();       // dpr 改变 → 重建主画布
  renderQualityTier();
  showToast('画质：' + QUALITY_TIERS[tier].label, 'success');
}

/** 刷新三档按钮与状态 */
function renderQualityTier() {
  const t = currentQualityTier();
  if (ui.qualityModes) {
    ui.qualityModes.querySelectorAll('[data-quality-tier]').forEach((btn) => {
      const on = btn.dataset.qualityTier === t;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  if (ui.qualityStateText) ui.qualityStateText.textContent = QUALITY_TIERS[t].label;
}
```

`applyPerfMode()` 里有两处必须改：

```js
// 原：if (!state.performanceMode) fogScaleFactor = 1;
// 改：均衡/高清也要吃档位倍率，否则 mid 的 75% 永远变回 100%
fogScaleFactor = perfFogScale();
...
// 原：renderPerfState();
renderQualityTier();
```

`renderPerfState` 不再读写 `ui.perfToggle`（该节点已删）。`setPerfMode(on)` 改成 `setQualityTier(on ? 'low' : 'high')`，保留 `__roamDebug` 兼容。

绑定（放在原 `perfToggle` 监听的位置）：

```js
if (ui.qualityModes) {
  ui.qualityModes.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-quality-tier]');
    if (btn) setQualityTier(btn.dataset.qualityTier);
  });
}
```

迁移（`normalizeMeta` 里 `base.performance` 之后）：

```js
base.qualityTier = (raw.qualityTier === 'low' || raw.qualityTier === 'mid' || raw.qualityTier === 'high')
  ? raw.qualityTier
  : (base.performance.mode ? 'low' : 'high');
```

**dpr 收口**：把下列 10 处的 `Math.min(window.devicePixelRatio || 1, 2)` 全换成 `renderDpr()`，少一处都会出现「画布按 1×、绘制按 2×」的错位或验收采样读错像素：

| 位置 | 用途 |
|---|---|
| `resizeCanvas()` | 主画布尺寸 |
| `render()` | 每帧 `setTransform` |
| 帧率/调试文字绘制 | 覆盖层 |
| `__roamDebug` 的 `screenOf` / 命中线采样 / 环形采样 / delta 采样 | 验收采样，必须同倍率 |
| 调试 `sample()` / `regionHue()` | 颜色断言 |
| 调试报告 `dpr` 字段 | 读数口径 |

场景底图 `sceneScale`（`ensureSceneCanvas()`，现为 `min(max(dpr,1),1.5)`）**保持 1.5 不变**。

### 6.10 JS · 说明页三套输入方式（锚点 `function buildRulesContent()` 的 `opsPane`）

- 操作页顶部加 4 个页签按钮（键盘 / 手柄 / 触屏 / 自动），默认：
  ```js
  const scheme = state.inputScheme
    || (touchCapable() ? 'touch' : (state.gamepadConnected ? 'gamepad' : 'keyboard'));
  ```
- 只生成当前方案一张卡片：键盘继续用 `HELP_KEYS`，手柄静态表，触屏静态表；切页签时按需生成其余卡片并缓存，避免初始节点膨胀。
- 触屏卡片最少覆盖：左半屏摇杆移动 / 右侧点按施法 / 拖动瞄准 / 影步键 / 装置键 / 融合键 / 交互键 / 地图键 / 技能树键 / 帮助键。
- 手柄卡片从现有 `GAMEPAD_CONFIG` 文案取值（移动 / 普攻 / 影步 / 装置 / 切换 / 融合 / 交互 / 地图 / 暂停），不另写第二套键位。
- `applyTouchCopy()` 的 `.setting-note` 改成 `#audioNote`；音频说明加 `id="audioNote"`。
- 设置页「输入方式」按钮只做三件事：写 `state.inputScheme`、刷新状态、打开说明页对应页签。
  ```js
  ui.inputSchemeModes.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-input-scheme]');
    if (!btn) return;
    state.inputScheme = btn.dataset.inputScheme;
    renderInputScheme();
    openRules();            // 已有函数：openPanel('rules')
    switchHelpTab('ops');   // 已有函数
    switchInputScheme(btn.dataset.inputScheme);
  });
  ```
- 新增 `switchInputScheme(name)`：`auto` 时按 `touchCapable() / state.gamepadConnected` 重新判定；只替换操作页卡片内容，不重建整页。

### 6.11 JS · 反馈复制（锚点 `function showToast` 旁）

```js
/** 复制纯文本：优先 Clipboard API，失败退回 textarea（离线可用） */
function copyPlainText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) { /* 忽略，走兜底 */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (e) { return false; }
}

/** 诊断信息：只读本机状态，不联网、不含存档内容 */
function copyDiagnostics() {
  const text = [
    GAME_CONFIG.title + ' ' + GAME_CONFIG.version,
    '作者 ' + GAME_CONFIG.author,
    '设备 ' + navigator.userAgent,
    '视口 ' + window.innerWidth + '×' + window.innerHeight + ' @' + (window.devicePixelRatio || 1) + 'x',
    '画质 ' + QUALITY_TIERS[currentQualityTier()].label,
    '主音量 ' + Math.round(audioSettings.master * 100) + '% / 静音 ' + (audioSettings.muted ? '是' : '否'),
    '时间 ' + new Date().toISOString()
  ].join('\n');
  const ok = copyPlainText(text);
  if (ui.diagCopiedState) ui.diagCopiedState.textContent = ok ? '已复制' : '复制失败，请手动抄写';
  showToast(ok ? '诊断信息已复制' : '复制失败', ok ? 'success' : 'warn');
}
```

绑定 `#btnCopyDiagnostics` → `copyDiagnostics()`。

### 6.12 锚点核对表（贴前逐条 `n == 1`）

| 段 | 锚点 |
|---|---|
| 6.1 | `<div class="settings-panel">` |
| 6.2 | `id="audioStateText"` + `id="bgmToggleLabel"` |
| 6.3 | `id="perfToggleLabel"` 整段；`关闭后可提升低配机帧率` |
| 6.4 | `id="aimNote"` |
| 6.5 | `id="motionTrailLabel"` 整段 |
| 6.6 | `id="aboutAuthor"` |
| 6.7 | `function renderSettingsPanel()`；`ui.settingsPanel = document.getElementById('settingsPanel')` |
| 6.8 | `function applyAudioSettings()`；`function renderAudioSettings()`；`function loadAudioSettings()`；`function saveAudioSettings()` |
| 6.9 | `const PERF_CONFIG`；`function perfParticleScale()`；`function perfFogScale()`；`function applyPerfMode()`；`function setPerfMode()`；`base.performance =` |
| 6.10 | `function buildRulesContent()`；`function applyTouchCopy()` |
| 6.11 | `function showToast()` |
| 6.12 | 10 处 `Math.min(window.devicePixelRatio || 1, 2)` |

---

## 七、验收

### A 类（不碰玩法数值：文案 / 布局 / 圆角 / 音量）

1. `node tools/arcane_syntax.js` → 0 error。
2. 最小加载自检：页面可初始化、无控制台错误、标题页可进游戏。
3. 设置页 5 页签逐一点击：内容只切换显示，不丢值；关闭再开仍记上次页签。
4. 音频：主音量 100→0 听感线性消失；拖环境滑杆自动开层；静音开关与顶部 N 状态同步；三项数值刷新后保持。
5. 画面：三档切换后主画布尺寸（`canvas.width == innerWidth * dpr`）立即变化；切回高清与 v1.8.0 一致；省电档后处理开关置灰并提示。
6. 操作：桌面默认键盘页；模拟触屏（`ctrl_touch_final.js`）默认触屏页；手柄连接后默认手柄页。
7. 存档：三个入口在同一页；SAVE_GUARD 段（备份列表 / 恢复 / 坏档原文）仍可用；清空仍需二次确认。
8. 关于：复制诊断信息可粘贴；无网络请求；不含存档内容。
9. DOM / 布局：`ui_kit_measure.js` 或 `_dpr_panels.js` 对比 1,111 基线，新增 ≤ 24 节点；首次布局 P95 差 ≤ 2.2 ms（否则标注「不可分辨」并保留记录）。

### B 类（会碰渲染/性能，需五关）

1. 同种子逐局对照：画质三档只改渲染，**楼层/敌人种类/数量/掉落/三选一完全一致**（`seed_repro_assert.js`）。
2. `arcane_quality_probe.js` / `arcane_quality_ablation.js`：省电/均衡/高清各 5 轮，同机位、无并发、关 `readPixels` 同步；输出 P50/P95 与轮间极差；差值 <2.2 ms 标「不可分辨」。
3. drawcall / 三角形：三档不新增资源、不新增 drawcall；只允许填充率与缓冲尺寸变化。
4. 触屏回归：`ctrl_touch_regress.js` 全绿；手机不再出现「按 E / WASD」。
5. 存档回归：`arcane_guard.js` / `save_ui_probe.js` 全绿；坏档、恢复、跨标签页三项仍通。

---

## 八、顺序与冲突

| 依赖线 | 冲突点 | 处理 |
|---|---|---|
| 音频总线（TB-AUDIO-BUS） | `applyAudioSettings` / `audioSettings` 字段；环境可能改名 `envBus` | **音频线先落**；本线只加 `master`，环境沿用 `bgm`。若总线已加统一 setter，本线滑杆改调 setter |
| 动效强度三档（M-LEVEL，待落） | 会在可访问性区加一行 | 该行落在 `可访问性` 分区，自动进「画面」页；本线不改它的锚点 |
| SAVE_GUARD（已落） | 运行时注入「存档安全」段 | 不改其代码；分组按标题动态归属，注入段自动进「存档」页 |
| 画质探针（Q-PROBE） | 可能新增自动降级链 | 自动链只能调 `setQualityTier()` 或写 `QUALITY_TIERS` 同名字段；不得另起一套 dpr/粒子/迷雾变量 |
| 渲染/相机线 | `render()` 首行 dpr、验收采样函数 | 本线 10 处 dpr 收口必须整段落；与相机线冲突时以 `renderDpr()` 为准 |

落地顺序：**S1 页签骨架（6.1/6.7）→ S2 音频（6.2/6.8）→ S3 画质（6.3/6.9）→ S4 操作（6.4/6.10）→ S5 存档归位（仅分组）→ S6 关于（6.6/6.11）→ S7 删假开关（6.5）**。
S1/S2/S4/S6 可同批（A 类）；S3 与 S7 单独批（B 类）；每批单独跑语法 + 加载，S3 额外跑五关。

---

## 九、明确不做

1. 不做第二套存档面板 / 不做 meta 文本导出（跨设备迁移暂不支持，备份只能本机恢复）。
2. 不做 `fxDensity` 空字段：本项目没有独立特效密度消费点，粒子数就是密度。
3. 不把泛光当画质档卖点；档位收益只标注分辨率 / 迷雾 / 粒子。
4. 不为画质档改 `sceneScale` 或中途 `bakeScene()`（会扰动 `rand()`，破坏同种子同局）。
5. 不复活近战武器、不实装冲刺残影；两处都是当前无消费点的死配置。
6. 不把标题页难度/种子/角色搬进设置页：它们是一局开始前的选择，不是运行中设置。
7. 不改玩法数值、敌人数量、掉落、种子派生；画质自适应只允许调渲染三旋钮。
