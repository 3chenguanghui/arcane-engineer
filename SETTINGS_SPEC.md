# SETTINGS_SPEC · 设置页可评审方案

> 线：设置页与选项完整度（**只出方案 + 补丁块，不改主文件、不开浏览器**）
> 交付：整合线按 [`SETTINGS_PATCHES.md`](SETTINGS_PATCHES.md) 的 S1–S11 逐件贴（含前后各 3 行上下文，已预处理成可直接整段替换）；本文件保留项清单 / 差异表 / 代价 / 验收。
> 锚点统计口径：**位置数 / 出现次数**分开报（例：dpr = 10 个位置 / 11 次出现）。
> 主文件：`index_arcane_v2.html`
> 快照：字节 **2,845,375** / 字符 **2,378,390** / 行 **66,226** / MD5 `3B376F821D70EE1617A6C5A41C88508C` / 修改时间 `2026-11-09 07:21:28` / 版本 **1.8.2**（`GAME_CONFIG.version` 与 `#aboutVersion` 均为 1.8.2）
> 纪律：机器有 18 个 msedge、CPU 80%，本轮不跑浏览器；所有性能数字标注证据等级（实测 / 结构推算 / 不可测）。

---

## 一、五组总览

| 组 | 玩家的问题 | 项数 | 入口 |
|---|---|---|---|
| 音频 | 听不见 / 太吵 / 想安静 | 5 | 设置页 页签 1 |
| 画面 | 太卡 / 太花 / 眼睛累 | 7 | 设置页 页签 2 |
| 操作 | 不会玩 / 手机怎么按 | 5 | 设置页 页签 3 |
| 无障碍 | 晕 / 光敏感 / 看不清 | 5 | 设置页 页签 4 |
| 其他 | 进度丢了 / 这是啥版本 / 找谁 | 9 | 设置页 页签 5 |
| **合计** | — | **31** | 5 个页签 |

删除 1 项（冲刺残影，假开关）；合并 1 项（性能模式 → 画质三档）；保持隐藏 1 项（近战武器）。

---

## 二、完整项清单

证据等级说明：**实测** = 项目内已有测量记录；**推算** = 按分辨率/倍率算得出，不是跑出来的；**无** = 纯 UI/状态，不参与渲染循环。

### 2.1 音频（5 项）

| # | 项 | 一句话（调了会发生什么） | 默认 | 可选 | 帧率 / 手感影响 |
|---|---|---|---|---|---|
| A1 | **主音量**（新增） | 这是总音量：拉到 0 就是全静音，拉到 100 就是当前最大声；环境层和音效都会跟着它一起变。 | 100% | 0–100%，步进 5 | 无（只改 `master.gain`） |
| A2 | 环境层开关（原「氛围 BGM」） | 打开后有一层很低的低频垫底声，关掉就只剩打击音；默认关，因为多数人嫌吵。 | 关 | 开 / 关 | 无（几路振荡器，不进渲染循环） |
| A3 | 环境音量（原「BGM 音量」） | 只调那层垫底声的大小；拖这个滑杆会自动把 A2 打开，避免“拖了却没声”。 | 25% | 0–100%，步进 5 | 无；25% → 100% 约 **+12 dB**（推算：20·log10(4)） |
| A4 | 音效音量 | 只调打击、施法、UI 这类的音量，不影响环境层。 | 62% | 0–100%，步进 5 | 无；62% → 100% 约 **+4.2 dB**（推算：20·log10(1/0.62)） |
| A5 | 静音（新增页内开关，与 N 同状态） | 一键全静音，和按 N、点顶部喇叭是同一个状态，三处永远同步。 | 关 | 开 / 关 | 无 |

### 2.2 画面（7 项）

| # | 项 | 一句话（调了会发生什么） | 默认 | 可选 | 帧率 / 手感影响 |
|---|---|---|---|---|---|
| D1 | **画质**（新增，三档） | 省电＝画面糊一点但最流畅；高清＝最清楚但最吃显卡；均衡在中间。切换立即生效，不用重开。 | 高清 | 省电 / 均衡 / 高清 | **有，且是唯一真正影响帧率的开关**。1920×1080 下主画布像素：省电 **2.07 MP** / 均衡 **4.67 MP** / 高清 **8.29 MP**（推算）。迷雾缓冲显存：**7.0 / 28.1 / 28.1 MiB**（推算：3200×2300×倍率²×4B；均衡不降迷雾——中途换迷雾分辨率会清掉已探索的洞）。粒子倍率：**0.45 / 0.70 / 1.00** |
| D2 | 后处理特效 | 关掉后命中时的像素溶解、故障条纹、屏幕冲击都不画了；省电档会强制关它。 | 开 | 开 / 关 | 关掉省一层全屏叠加；**未实测 ms，不写数字**。手感：打击的“糊一下”消失 |
| D3 | 泛光 BLOOM | 打开后亮的地方会有一圈柔和光晕；关掉画面更“干净”但少了点魔法味。 | 开 | 开 / 关 | 实测 **0.5–1.1 ms**（项目已有记录）。**不作为画质档卖点**，因为差距接近分辨力 |
| D4 | 色差 CHROMA | 打开后画面边缘会出现轻微的彩色错位，像老镜头；关掉就正常。 | 关 | 开 / 关 | 未实测；结构上是一屏后期 |
| D5 | 扫描线 CRT | 打开后画面有一层横向细线，复古显示器味道；关掉就平滑。 | 关 | 开 / 关 | 未实测 |
| D6 | 暗角 VIGNETTE | 打开后四角变暗，视线更集中；关掉整屏亮度均匀。 | 开 | 开 / 关 | 未实测 |
| D7 | 大区切换演出 | 打开后换大区会播约 **1.4 s** 的过场，能点一下或按 Esc 跳过；关掉就是普通下楼。 | 开 | 开 / 关 | 只在换区那一下有开销；关掉等于少一段一次性绘制 |

### 2.3 操作（5 项）

| # | 项 | 一句话（调了会发生什么） | 默认 | 可选 | 帧率 / 手感影响 |
|---|---|---|---|---|---|
| C1 | 辅助瞄准 | 强＝几乎帮你锁定最近的敌人；弱＝只在正前方小角度内轻轻拉一下；关＝完全手动。 | 弱 | 强 / 弱 / 关 | 无帧率影响；**手感差异最大的一项**。弱档：±25° / 440px 内偏转 60%、命中半径 +20% |
| C2 | 始终朝准心 | 关＝走路时身体朝移动方向，更自然；开＝角色永远扭头看着准心，瞄准更直观。 | 关 | 开 / 关 | 无帧率影响；只改朝向，不改弹道 |
| C3 | **输入方式**（新增） | 决定“完整说明”里给你看键盘、手柄还是触屏那套；选自动就按你当前设备猜。 | 自动 | 自动 / 键盘 / 手柄 / 触屏 | 无；**手机默认显示触屏那套**，不再教手机玩家按 E 和 WASD |
| C4 | 回顾教学 | 点一下展开前五层各教了什么（移动开火 / 融合 / 装置与冲刺 / 选门 / 天赋）。 | 折叠 | 展开 / 折叠 | 无 |
| C5 | 打开说明（H） | 打开完整说明面板，和局内按 H 是同一个面板，打开即暂停。 | — | — | 无 |

### 2.4 无障碍（5 项）

| # | 项 | 一句话（调了会发生什么） | 默认 | 可选 | 帧率 / 手感影响 |
|---|---|---|---|---|---|
| E1 | 减少屏震 | 打开后所有震屏幅度降到 **35%**，不容易晕；关掉是原幅度。 | 关 | 开 / 关 | 无帧率影响；手感变“稳” |
| E2 | 关闭闪白 | 打开后受伤/命中的整屏白闪完全不播（光柱和冲击环还在），对光敏感的人友好。 | 关 | 开 / 关 | 无 |
| E3 | 连击演出 | 关掉后连击不再有脉冲、冲击环、爆裂，画面更安静。 | 开 | 开 / 关 | 结构上少几层绘制，**未实测 ms** |
| E4 | 色盲 / 形状辅助（原「色盲 / 高对比」） | 打开后血条、附着、处决、事件门徽改用形状和纹理区分，不只靠颜色；**它不提高对比度**，所以改名。 | 关 | 开 / 关 | 无 |
| E5 | 战斗信息 | 完整＝全部显示；标准＝低威胁淡出；极简＝低威胁只剩轮廓。 | 标准 | 完整 / 标准 / 极简 | 无帧率影响；信息密度变化 |

### 2.5 其他（9 项）

| # | 项 | 一句话（调了会发生什么） | 默认 | 可选 | 帧率 / 手感影响 |
|---|---|---|---|---|---|
| O1 | 局内存档（3 槽） | 选一个槽存本局进度；换槽不会动你的结晶和天赋。 | 槽 1 | 槽 1 / 2 / 3 | 无 |
| O2 | 立即保存 / 导出当前槽 / 保存并返回标题 | 马上存一次；或把当前槽变成一段文本复制走；或存好回标题。 | — | 三个按钮 | 无 |
| O3 | 导入到当前槽 | 把别人给的存档文本粘进来，覆盖当前槽；不会改永久进度。 | — | — | 无 |
| O4 | 存档安全（SAVE_GUARD） | 每次覆盖前自动留一份旧档（最多 3 份），可以选一份回滚；回滚前会先备份当前档。 | 自动 | 立即留档 / 恢复到这份 | 无 |
| O5 | 清空永久存档 | 清掉结晶、天赋、最佳楼层、局数、累计统计、成就与已读剧情；要连点两次确认（3 秒不复位就取消），现有文案称“本局不受影响，刷新后生效”。 | — | — | 无（一次性写档） |
| O6 | 版本号 / 作品名 | 显示当前版本（现在是 **v1.8.2**）和作品名，方便报问题。 | — | — | 无 |
| O7 | 作者署名 | 固定显示「陈光辉 制作」。 | — | — | 无 |
| O8 | **反馈：复制诊断信息**（新增） | 一键把版本、设备、屏幕、画质、音量复制到剪贴板，直接发给作者；**不联网、不含存档内容**。 | — | 点一次 | 无 |
| O9 | 档案统计 / 成就 | 累计击杀、最高楼层、通关次数、蓝图、配方、死亡次数和成就进度。 | — | 只读 | 无 |

### 2.6 删除 / 合并 / 保持隐藏

| 项 | 处置 | 原因 |
|---|---|---|
| 冲刺残影 | **删掉整行** | `meta.motionTrail` 默认 true、UI 写“默认关”、渲染门 `DASH_CONFIG.trailEnabled=false`，三者矛盾，怎么点都看不到 = 假开关。字段保留不读不写，旧档不报错 |
| 性能模式 | **合并进画质三档** | 同一套粒子/迷雾/后期，两个入口会互相覆盖。`setPerfMode()` 保留为调试口，映射到 `low/high` |
| 近战武器（Q） | **继续隐藏** | `WEAPON_CONFIG.enabled=false`，整行已隐藏；武器系统回来时再开 |
| “关闭后可提升低配机帧率” | **改文案** | 泛光只占 0.5–1.1 ms，不能当帧率卖点 |

---

## 三、与现有 `SETTINGS_PLAN.md` 的差异表

| # | 项 | SETTINGS_PLAN.md 的写法 | 本方案 | 为什么要改 |
|---|---|---|---|---|
| 1 | 分组 | 音频 / 画面 / 操作 / **存档** / **关于** | 音频 / 画面 / 操作 / **无障碍** / **其他** | 按本轮指定分组；无障碍独立成页，存档+关于+档案+教学收进“其他” |
| 2 | 页签栏 | 首次打开设置时**动态插入** | **静态 HTML**，打开即有 | 少一个构建函数、少一类“打开顺序”bug；代价 +6 节点，可接受 |
| 3 | 主音量 | 新增 | **一致** | 音频总线线可直接对接 `master.gain` |
| 4 | 环境改名 | 氛围 BGM → 环境层 | **一致** | 只改文案，`bgm` 字段不动，旧档兼容 |
| 5 | 画质三档 | 新增，注明“不碰敌人/掉落/种子” | **一致**，并补两个实现坑 | ① `applyPerfMode()` 里 `if (!state.performanceMode) fogScaleFactor = 1;` **必须整行删掉**（不是改值）：`fogScaleFactor` 是迷雾画布的实际倍率，唯一写入点是 `ensureFogCanvas()`；硬写 1 会让 `drawFog()` 用 1 采样 0.5 的画布（迷雾拉偏），也会把任何档位的倍率顶回 100%。② dpr 必须收口，否则画布与采样错位 |
| 6 | 性能模式 | 删开关，合并进画质 | **一致** | `ui.perfToggle` 为空时现有代码都有 `if` 保护，不会崩 |
| 7 | 冲刺残影 | 删行 | **一致** | 假开关 |
| 8 | 色盲 / 高对比 | 改名“色盲 / 形状辅助” | **一致** | 代码没有高对比 |
| 9 | 输入方式 | 4 按钮，触屏设备默认触屏页 | **一致**，另加说明页 4 个页签（自动/键盘/手柄/触屏） | 手机端不再教键盘 |
| 10 | 存档入口 | “不另做一套，SAVE_GUARD 段自动归属” | **一致**，但归属改用 `#saveGuardSection` 判 id，不再靠 h3 文字 | 已确认 SAVE_GUARD 生成 `id="saveGuardSection"`、标题「存档安全 · SAVE GUARD」，判 id 更稳 |
| 11 | 关于 / 反馈 | 新增复制诊断 | **一致**，锚点改为 `#aboutAuthor` 之前插入 | 该节点唯一、稳定 |
| 12 | DOM 代价 | +24 初始 → 约 1,135（+2.2%） | **+32 初始 → 约 1,143（+2.9%）** | 页签栏由动态改静态（+6）；输入方式行与说明文案按最终项数重算（+9 / +5） |
| 13 | 版本号 | 写 v1.8.0 | **v1.8.2** | 主文件 `GAME_CONFIG.version` 与 `#aboutVersion` 都已是 1.8.2 |
| 14 | dpr 收口 | “10 处” | **10 个位置、11 次出现**（一行里写了两次） | 用 `replace_all`，避免漏一处导致画布/采样错位 |
| 15 | 弹片条数 | “18 颗 → 8 颗” | **撤回绝对条数，只保留倍率 0.45/0.70/1.00** | 绝对条数随技能变化，未在配置中核实，不写没把握的数字 |

---

## 四、字符串锚点补丁块

> 全部不用行号。贴前对每条锚点做 `n == 1` 校验；任一 `n != 1` 立即停手。
> 段序：S1 页签 → S2 音频 → S3 画面 → S4 操作 → S5 删假开关 → S6 关于 → S7 JS 音频 → S8 JS 画质 → S9 JS 说明页 → S10 JS 诊断 → S11 文案。

### S1 页签栏（静态）

**锚点（n=1）**

```
<div class="settings-panel">
```

**动作**：紧随其后插入

```html
<div class="settings-tabs" id="settingsTabs" role="tablist" aria-label="设置分组">
  <button type="button" class="settings-tab is-active" data-settings-tab="audio" role="tab" aria-selected="true">音频</button>
  <button type="button" class="settings-tab" data-settings-tab="display" role="tab" aria-selected="false">画面</button>
  <button type="button" class="settings-tab" data-settings-tab="control" role="tab" aria-selected="false">操作</button>
  <button type="button" class="settings-tab" data-settings-tab="a11y" role="tab" aria-selected="false">无障碍</button>
  <button type="button" class="settings-tab" data-settings-tab="other" role="tab" aria-selected="false">其他</button>
</div>
```

**CSS 锚点（n=1）**：以 `.settings-panel { … padding-right: 4px; }` 收尾处 + 紧随的 `.settings-panel .settings-box { padding: 13px 14px; }` 为锚，插在两者之间。**不要**用 `.settings-panel` 这个裸选择器当锚——它在文件里有 6 个位置（含媒体查询），会贴错地方。

```css
.settings-tabs { display: flex; gap: 6px; flex-wrap: wrap; margin: 0 0 10px; }
.settings-tab { font: inherit; cursor: pointer; padding: 6px 12px; border-radius: 8px;
  border: 1px solid rgba(62, 230, 255, .28); background: rgba(9, 20, 34, .6); color: #9fb6c9; }
.settings-tab.is-active { color: #eaf6ff; border-color: rgba(255, 194, 71, .55); background: rgba(255, 194, 71, .12); }
.settings-box.is-tab-hidden { display: none; }
```

### S2 音频分组

| 项 | 锚点（原文，n=1） | 动作 |
|---|---|---|
| A2 改名 | `<label id="bgmToggleLabel">氛围 BGM</label>` | 换成 `<label id="bgmToggleLabel">环境层</label>` |
| A3 改名 | `<label for="bgmVolume">BGM 音量</label>` | 换成 `<label for="bgmVolume">环境音量</label>` |
| A1 + A5 新增 | `<div class="setting-note">BGM 为低频氛围层，默认关闭，宁简不吵。按 <kbd>N</kbd> 或顶部喇叭按钮可随时静音 / 恢复。</div>` | 在这行**之前**插入下面的块；并给这行加 `id="audioNote"` |

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

音频说明文案改为：`主音量管总输出；环境层是低频垫底，默认关闭；音效只影响打击与 UI。按 <kbd>N</kbd> 可随时静音。`

### S3 画面分组

**锚点（n=1，整段 4 行）**

```
          <div class="setting-row">
            <label id="perfToggleLabel">性能模式</label>
            <div id="perfToggle" class="switch" role="switch" tabindex="0" aria-checked="false" aria-labelledby="perfToggleLabel"></div>
            <span class="setting-state" id="perfStateText2">关 · 全画质</span>
          </div>
```

**替换为**

```html
<div class="setting-row">
  <label>画质</label>
  <div class="aim-modes" id="qualityModes" role="group" aria-label="画质档位">
    <button type="button" class="aim-mode" data-quality-tier="low">省电</button>
    <button type="button" class="aim-mode" data-quality-tier="mid">均衡</button>
    <button type="button" class="aim-mode is-active" data-quality-tier="high">高清</button>
  </div>
  <span class="setting-state" id="qualityStateText">高清</span>
</div>
<div class="setting-note" id="qualityNote">
  省电：1× 分辨率 / 45% 粒子 / 50% 迷雾，并强制关后处理；均衡：1.5× / 70% / 迷雾 100%；高清：2× / 100% / 100%。
  这是唯一会明显改变帧率的开关。
</div>
```

**D2 文案修正锚点（n=1）**

```
关闭后可提升低配机帧率（粒子与屏幕冲击仍保留，只关掉全屏后期）。
```

替换为：

```
关掉后少一层全屏叠加，画面更干净；帧率收益不保证，泛光单项实测只有 0.5–1.1ms。
```

### S4 操作分组

**锚点（n=1）**

```
            强辅助全向锁定；关闭则完全手动。设置会记住到下次打开。
          </div>
```

**动作**：紧随其后插入

```html
<div class="setting-row">
  <label>输入方式</label>
  <div class="aim-modes" id="inputSchemeModes" role="group" aria-label="输入方式">
    <button type="button" class="aim-mode is-active" data-input-scheme="auto">自动</button>
    <button type="button" class="aim-mode" data-input-scheme="keyboard">键盘</button>
    <button type="button" class="aim-mode" data-input-scheme="gamepad">手柄</button>
    <button type="button" class="aim-mode" data-input-scheme="touch">触屏</button>
  </div>
  <span class="setting-state" id="inputSchemeState">自动</span>
</div>
<div class="setting-note" id="inputSchemeNote">
  只影响「说明」里给你看哪套操作；自动 = 按当前设备判断，手机默认看触屏。
</div>
```

### S5 删除冲刺残影

**锚点（n=1，连同上一行注释整段删除）**

```
          <!-- 第 0 项：冲刺残影（默认关，避免"两个同形角色"的观感；寿命 0.18s 短衰减） -->
          <div class="setting-row">
            <label id="motionTrailLabel">冲刺残影</label>
            <div id="motionTrailToggle" class="switch" role="switch" tabindex="0" aria-checked="false" aria-labelledby="motionTrailLabel"></div>
            <span class="setting-state" id="motionTrailState">默认关 · 0.18s 短衰减</span>
          </div>
```

删除后 `ui.motionTrailToggle` 为 `null`，现有绑定有 `if (ui.motionTrailToggle)` 保护；`meta.motionTrail` 字段保留，不读不写。

### S6 关于分组

**锚点（n=1）**

```
          <div class="setting-author" id="aboutAuthor"></div>
```

**动作**：在这行之前插入

```html
<div class="setting-row">
  <label>反馈</label>
  <button type="button" class="btn" id="btnCopyDiagnostics">复制诊断信息</button>
  <span class="setting-state" id="diagCopiedState">离线可用</span>
</div>
<div class="setting-note">
  卡顿 / 听不见 / 进度问题，先看「画面 / 音频 / 其他」；还解决不了就把诊断信息发给作者。
</div>
```

### S7 JS · 音频

| 项 | 锚点（n=1） | 动作 |
|---|---|---|
| 默认值 | `const audioSettings = {` | 对象内加 `master: AUDIO_CONFIG.masterVolume,` |
| 默认常量 | `bgmVolume: 0.25,             // 氛围 BGM 默认音量（约 25%）` | 其后加 `masterVolume: 1.0,         // 主音量默认 100%，与旧版响度一致` |
| 读档 | `if (Number.isFinite(data.sfx)) audioSettings.sfx = clamp(data.sfx, 0, 1);` | 其后加 `if (Number.isFinite(data.master)) audioSettings.master = clamp(data.master, 0, 1);` |
| 写档 | `      sfx: audioSettings.sfx`（`saveAudioSettings` 内，缩进 6 空格；同串在 L65625 还有一处，**必须带上下文**） | 换成 `      sfx: audioSettings.sfx,` + `      master: audioSettings.master` |
| 应用 | `if (audioState.master) audioState.master.gain.value = audioSettings.muted ? 0 : 1;` | **n=2（L38174 / L38200），用 `replace_all`** 换成 `if (audioState.master) audioState.master.gain.value = audioSettings.muted ? 0 : audioSettings.master;` |
| 界面 | `function renderAudioSettings() {` | 函数体内补 master / mute 四行（见下） |
| 绑定 | `if (ui.sfxVolume) {` | 在这个块**之前**插入主音量与静音绑定 |

```js
/* 主音量：0% 全静音，100% 当前最大；拖动时若处于静音则自动解除，避免"拖了没声" */
if (ui.masterVolume) {
  ui.masterVolume.addEventListener('input', () => {
    audioSettings.master = clamp(Number(ui.masterVolume.value) / 100, 0, 1);
    if (audioSettings.muted && audioSettings.master > 0) audioSettings.muted = false;
    applyAudioSettings(); saveAudioSettings(); renderAudioSettings();
  });
}
/* 页内静音：与 N / 顶部喇叭共用 audioSettings.muted，三处同步 */
if (ui.settingsMuteToggle) {
  ui.settingsMuteToggle.addEventListener('click', () => { toggleMute(); renderAudioSettings(); });
}
```

`renderAudioSettings()` 内补：

```js
if (ui.masterVolume) ui.masterVolume.value = String(Math.round(audioSettings.master * 100));
if (ui.masterVolumeText) ui.masterVolumeText.textContent = Math.round(audioSettings.master * 100) + '%';
if (ui.settingsMuteToggle) ui.settingsMuteToggle.setAttribute('aria-checked', audioSettings.muted ? 'true' : 'false');
if (ui.settingsMuteState) ui.settingsMuteState.textContent = audioSettings.muted ? '已静音' : '声音开';
```

环境音量拖动自动开层：**锚点** `audioSettings.bgm = clamp(Number(ui.bgmVolume.value) / 100, 0, 1);`，其后加

```js
if (!audioSettings.bgmOn && audioSettings.bgm > 0) { audioSettings.bgmOn = true; ensureAudio(); }
```

### S8 JS · 画质三档

**锚点（n=1）**：`const PERF_CONFIG = {` — 在 `PERF_CONFIG` **结束** `};` 之后插入

```js
/* 画质三档：只改渲染，不碰敌人数量 / 掉落 / 种子派生。
   「特效密度」在本项目的真实消费点就是粒子数，不另造空字段。 */
const QUALITY_TIERS = {
  low:  { label: '省电', dprCap: 1.0, particleScale: 0.45, fogScale: 0.50 },
  mid:  { label: '均衡', dprCap: 1.5, particleScale: 0.70, fogScale: 1.00 },
  high: { label: '高清', dprCap: 2.0, particleScale: 1.00, fogScale: 1.00 }
};

/** 当前档位；旧档只有 performance.mode 时迁移为 low/high */
function currentQualityTier() {
  if (!state || !state.meta) return 'high';
  const t = state.meta.qualityTier;
  if (QUALITY_TIERS[t]) return t;
  return state.performanceMode ? 'low' : 'high';
}

/** 主画布 dpr：渲染与验收采样都走这里，避免画布与采样倍率不一致 */
function renderDpr() {
  return Math.min(window.devicePixelRatio || 1, QUALITY_TIERS[currentQualityTier()].dprCap);
}

/** 刷新三档按钮与状态文字 */
function renderQualityTier() {
  const t = currentQualityTier();
  if (ui.qualityModes) {
    ui.qualityModes.querySelectorAll('[data-quality-tier]').forEach((btn) => {
      const on = btn.dataset.qualityTier === t;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  if (ui.qualityStateText) ui.qualityStateText.textContent = QUALITY_TIERS[t].label;
}

/** 写档 + 立即生效：重建迷雾缓冲与主画布，不重烘场景（避免扰动 rand 流） */
function setQualityTier(tier) {
  if (!QUALITY_TIERS[tier]) return;
  state.meta.qualityTier = tier;
  state.meta.performance = state.meta.performance || {};
  state.meta.performance.mode = tier === 'low';
  saveMeta();
  applyPerfMode();
  resizeCanvas();
  renderQualityTier();
  showToast('画质：' + QUALITY_TIERS[tier].label, 'success');
}
```

| 锚点 | 替换为 |
|---|---|
| `return state.performanceMode ? PERF_CONFIG.particleScale : 1;` | `return QUALITY_TIERS[currentQualityTier()].particleScale;` |
| `return state.performanceMode ? PERF_CONFIG.fogScale : 1;` | `return QUALITY_TIERS[currentQualityTier()].fogScale;` |
| `  if (!state.performanceMode) fogScaleFactor = 1;`（`applyPerfMode` 内，n=1） | **整行删除**，并留下解释注释（不要再赋值） |
| `  applyQualitySettings();` + 换行的 `  renderPerfState();`（`applyPerfMode` 内，n=1） | **不改**；UI 刷新统一放在 `renderSettingsPanel()` 里（每次打开设置都刷），applyPerfMode 保持纯状态 |
| `  state.meta.performance.mode = !!on;`（`setPerfMode` 内，n=1） | 保留该行，其后加 `  state.meta.qualityTier = on ? 'low' : 'high';` |

**打开设置时刷新档位**：锚点（n=1，`renderSettingsPanel` 内）

```
  renderPerfState();
  syncA11yToggles();
```

替换为

```
  renderPerfState();
  renderQualityTier();
  syncA11yToggles();
  syncInputSchemeUI();
  showSettingsTab(settingsTabId);
```

**旧档迁移**：锚点 `base.performance = { mode: rawPerf.mode === true };`，其后加

```js
base.qualityTier = (raw.qualityTier === 'low' || raw.qualityTier === 'mid' || raw.qualityTier === 'high')
  ? raw.qualityTier
  : (rawPerf.mode === true ? 'low' : 'high');
```

**dpr 收口**：锚点 `Math.min(window.devicePixelRatio || 1, 2)`，`replace_all` → `renderDpr()`。
共 10 个位置、11 次出现：`resizeCanvas()`、`render()` 的 `setTransform`（同一行两次）、`__roamDebug.screenOf`、命中线采样、环形采样、delta 采样、调试 `sample()`、`regionHue()`、报告 `dpr` 字段。
**不改** `sceneScale = Math.min(Math.max(window.devicePixelRatio || 1, 1), 1.5);`：场景底图重烘会调用 `rand()`，破坏“同种子同局”。

**“省电档强制关后处理”不用补丁**：`qualityPostFxEnabled()`（L49247）已有
`if (PERF_CONFIG.enabled !== false && PERF_CONFIG.disablePostFx && state.performanceMode) return false;`，
且 `PERF_CONFIG.disablePostFx` 当前就是 `true`（L10619）；`setQualityTier('low')` 会把
`state.meta.performance.mode` 置真 → `applyPerfMode()` 里 `state.performanceMode` 变真 → 后处理自动关。
均衡 / 高清档 `state.performanceMode` 为假，后处理仍听用户那个开关。**这是现有行为，别再加判断。**

**绑定**：锚点 `if (ui.perfToggle) {` 整块之后加

```js
if (ui.qualityModes) {
  ui.qualityModes.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-quality-tier]');
    if (btn) setQualityTier(btn.dataset.qualityTier);
  });
}
```

### S9 JS · 页签分组 + 说明页输入方式

**锚点（n=1）**：`function renderSettingsPanel() {` — 在它**之前**插入：

```js
/* 设置页 5 个页签：按玩家问题分组，不按代码结构。
   存档安全段由 SAVE_GUARD 运行时生成，判 id 而不是判标题文字。 */
const SETTINGS_TABS = ['audio', 'display', 'control', 'a11y', 'other'];
const SETTINGS_TAB_OF_ID = {
  aboutSection: 'other', archiveSection: 'other', saveSlotSection: 'other',
  saveGuardSection: 'other', helpSection: 'control'
};
const SETTINGS_TAB_OF_H3 = [
  ['音频', 'audio'], ['操作', 'control'], ['角色朝向', 'control'],
  ['教学', 'control'], ['说明', 'control'], ['画面', 'display'], ['可访问性', 'a11y']
];
let settingsTabId = 'audio';

/** 判断一个设置分区属于哪个页签 */
function settingsTabOf(box) {
  if (!box) return 'other';
  if (box.id && SETTINGS_TAB_OF_ID[box.id]) return SETTINGS_TAB_OF_ID[box.id];
  if (box.classList && box.classList.contains('settings-save')) return 'other';
  const h = box.querySelector && box.querySelector('h3');
  const name = h ? h.textContent.trim() : '';
  const hit = SETTINGS_TAB_OF_H3.find((row) => name.indexOf(row[0]) === 0);
  return hit ? hit[1] : 'other';
}

/** 切页签：只切显示，不动任何设置值 */
function showSettingsTab(id) {
  if (!ui.settingsPanel || SETTINGS_TABS.indexOf(id) < 0) return;
  settingsTabId = id;
  ui.settingsPanel.querySelectorAll('.settings-box, .settings-save').forEach((box) => {
    box.classList.toggle('is-tab-hidden', settingsTabOf(box) !== id);
  });
  if (ui.settingsTabs) {
    ui.settingsTabs.querySelectorAll('[data-settings-tab]').forEach((btn) => {
      const on = btn.dataset.settingsTab === id;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }
}
```

**页签绑定**：锚点 `ui.settingsPanel.addEventListener('mousedown', (event) => {`，在其**之前**加

```js
ui.settingsTabs = document.getElementById('settingsTabs');
if (ui.settingsTabs) {
  ui.settingsTabs.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-settings-tab]');
    if (btn) showSettingsTab(btn.dataset.settingsTab);
  });
}
```

**说明页输入方式**：锚点（n=1）`const opsPane = '<section class="help-pane" data-help-pane="ops">'`

- 在 `opsPane` 里、键盘表之前插入 4 个方案按钮：`自动 / 键盘 / 手柄 / 触屏`，属性 `data-input-scheme`。
- 操作卡片内容按 `currentInputScheme()` 生成：键盘沿用 `HELP_KEYS`；手柄 / 触屏用静态表。触屏至少覆盖：摇杆移动 / 右侧点按施法 / 拖动瞄准 / 影步键 / 装置键 / 融合键 / 交互键 / 地图键 / 技能树键 / 帮助键。
- 手柄表直接复用现有 `GAMEPAD_CONFIG` 文案，不另写第二套键位。

新增 3 个函数（放在 `function buildRulesContent` 之前）：

```js
/** 当前实际生效的输入方式：自动时按设备猜，手机优先触屏 */
function currentInputScheme() {
  const saved = state.meta && state.meta.inputScheme;
  if (saved === 'keyboard' || saved === 'gamepad' || saved === 'touch') return saved;
  if (touchCapable()) return 'touch';
  if (state.gamepadConnected) return 'gamepad';
  return 'keyboard';
}

/** 刷新设置页按钮与状态文字（只改 UI，不重建说明页） */
function syncInputSchemeUI() {
  const saved = (state.meta && state.meta.inputScheme) || 'auto';
  const labels = { keyboard: '键盘', gamepad: '手柄', touch: '触屏' };
  if (ui.inputSchemeModes) {
    ui.inputSchemeModes.querySelectorAll('[data-input-scheme]').forEach((btn) => {
      const on = btn.dataset.inputScheme === saved;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  if (ui.inputSchemeState) {
    ui.inputSchemeState.textContent = saved === 'auto' ? '自动 · ' + labels[currentInputScheme()] : labels[saved];
  }
}

/** 写档并按新方案重建说明页（只用于「说明」页，不重开游戏） */
function setInputScheme(next) {
  state.meta.inputScheme = next;
  saveMeta();
  syncInputSchemeUI();
  buildRulesContent();
  if (ui.rulesBody) ui.rulesBody.scrollTop = 0;
}
```

**旧档补字段**：锚点 `base.qualityTier = (raw.qualityTier === 'low' ...` 整段之后加

```js
base.inputScheme = (raw.inputScheme === 'keyboard' || raw.inputScheme === 'gamepad' || raw.inputScheme === 'touch')
  ? raw.inputScheme
  : 'auto';
```

**触屏文案覆盖过宽**：锚点 `const bgmNote = document.querySelector('.setting-note');`，改为

```js
const bgmNote = document.getElementById('audioNote');
```

设置页输入方式按钮绑定（放在 `ui.settingsTabs` 绑定之后）：

```js
if (ui.inputSchemeModes) {
  ui.inputSchemeModes.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-input-scheme]');
    if (!btn) return;
    setInputScheme(btn.dataset.inputScheme);
    openRules();
    switchHelpTab('ops');
  });
}
```

### S10 JS · 复制诊断信息

**锚点（n=1）**：`function showToast(message, type) {`

**动作**：在其**之前**插入

```js
/** 复制纯文本：优先 Clipboard API，失败退回 textarea（离线可用） */
function copyPlainText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text);
      return true;
    }
  } catch (error) { /* 走兜底 */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (error) { return false; }
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

绑定锚点：`if (ui.settingsMuteToggle) {` 块之后加

```js
if (ui.btnCopyDiagnostics) {
  ui.btnCopyDiagnostics.addEventListener('click', copyDiagnostics);
}
```

### S11 `ui` 缓存补充

**锚点（n=1）**：`ui.settingsPanel = document.getElementById('settingsPanel');`

其后加：

```js
ui.masterVolume = document.getElementById('masterVolume');
ui.masterVolumeText = document.getElementById('masterVolumeText');
ui.settingsMuteToggle = document.getElementById('settingsMuteToggle');
ui.settingsMuteState = document.getElementById('settingsMuteState');
ui.qualityModes = document.getElementById('qualityModes');
ui.qualityStateText = document.getElementById('qualityStateText');
ui.inputSchemeModes = document.getElementById('inputSchemeModes');
ui.inputSchemeState = document.getElementById('inputSchemeState');
ui.btnCopyDiagnostics = document.getElementById('btnCopyDiagnostics');
ui.diagCopiedState = document.getElementById('diagCopiedState');
```

`ui.settingsTabs` 不在这里取：S9 的绑定段自己 `getElementById`（同一行只写一次）。

---

## 五、代价

### DOM 节点

基线 1,111 节点 / 首次布局 346.5 ms（中位，295.9–362.9）。

| 变更 | 初始节点 |
|---|---|
| 页签栏（容器 + 5 按钮） | +6 |
| 音频：主音量 + 静音两行 | +8 |
| 画面：性能模式 4 节点 → 画质 8 节点 | +4 |
| 操作：输入方式行 + 说明 | +9 |
| 关于：反馈行 + 说明 | +5 |
| 删除冲刺残影行 | −4 |
| 说明页输入方式按钮 | +4 |
| **合计** | **+32 → 1,143（+2.9%）** |

首次布局增量按节点比例推算 < 2.2 ms 分辨力，属**不可分辨**；这是推算，合入后必须同机 5 轮实测。
init JS 增量预计 **< 0.1 ms**（只多 11 个 `getElementById` 与一次页签显示），**不承诺正收益**。

### 显存与像素

| 档位 | 主画布（1920×1080） | 迷雾缓冲（3200×2300×倍率²） | 粒子倍率 | 后处理 |
|---|---|---|---|---|
| 省电 | 2.07 MP / 约 8.3 MB | 7.0 MiB | 0.45 | 强制关 |
| 均衡 | 4.67 MP / 约 18.7 MB | 28.1 MiB | 0.70 | 保留用户开关 |
| 高清 | 8.29 MP / 约 33.2 MB | 28.1 MiB | 1.00 | 保留用户开关 |

### 不影响的东西（必须写进验收）

- 不改敌人数量、种类、掉落、三选一、种子派生。
- 不改 `sceneScale`（1.5 恒定），不中途 `bakeScene()`。
- 不改 `GAME_CONFIG.worldWidth/worldHeight`。
- 画质档只经 `renderDpr() / perfParticleScale() / perfFogScale()` 三个消费点生效。

---

## 六、验收

### A 类（文案 / 布局 / 音量 / 页签）

1. 语法检查 0 error；页面可初始化、无控制台报错、能进游戏。
2. 5 个页签逐一点击：只切显示，不丢值；关闭再开记住上次页签。
3. 音频：主音量 100→0 听感消失；拖环境滑杆自动开层；页内静音与 N、顶部喇叭三处同步；刷新后三个数值保持。
4. 操作：桌面默认键盘页；模拟触屏默认触屏页；手机端说明页不再出现 E / WASD。
5. 其他：存档安全段与局内存档、清空存档同页；复制诊断信息可粘贴，且不含存档内容；无网络请求。
6. DOM：初始节点 ≤ 1,150；首次布局差值 ≤ 2.2 ms，否则标“不可分辨”。

### B 类（画质 / 渲染）

1. 同种子逐局对照：三档只改渲染，楼层 / 敌人种类与数量 / 掉落 / 选项完全一致。
2. 三档各 5 轮、同机位、无并发、关 `readPixels` 同步；输出 P50/P95 与轮间极差；差值 < 2.2 ms 标“不可分辨”。
3. drawcall / 三角形：三档不新增资源、不新增 drawcall。
4. `canvas.width === Math.round(innerWidth * renderDpr())`，三档切换后立即成立；切回高清与 v1.8.2 一致。
5. 存档回归：坏档、恢复、跨标签页三项仍通。

---

## 七、锚点核对结果（本快照已逐条查过）

| 锚点 | 结果 |
|---|---|
| `<div class="settings-panel">` | n=1 |
| `<label id="bgmToggleLabel">氛围 BGM</label>` | n=1 |
| `<label for="bgmVolume">BGM 音量</label>` | n=1 |
| `bgmVolume: 0.25,             // 氛围 BGM 默认音量（约 25%）` | n=1 |
| `const audioSettings = {` | n=1 |
| `if (Number.isFinite(data.sfx)) audioSettings.sfx = clamp(data.sfx, 0, 1);` | n=1 |
| `sfx: audioSettings.sfx` | **n=2**（`saveAudioSettings` 内 + L65625），必须带上下文 |
| `audioState.master.gain.value = audioSettings.muted ? 0 : 1` | **n=2**（L38174 / L38200），用 `replace_all` |
| `if (ui.sfxVolume) {` | n=1（L56519） |
| `if (ui.bgmVolume) {` | n=1（L56511） |
| `id="perfToggleLabel"` 整段 | n=1 |
| `关闭后可提升低配机帧率（粒子与屏幕冲击仍保留，只关掉全屏后期）。` | n=1 |
| `强辅助全向锁定；关闭则完全手动。设置会记住到下次打开。` | n=1 |
| `id="motionTrailLabel"` 整段 | n=1 |
| `<div class="setting-author" id="aboutAuthor"></div>` | n=1 |
| `const PERF_CONFIG = {` | n=1 |
| `return state.performanceMode ? PERF_CONFIG.particleScale : 1;` | n=1 |
| `return state.performanceMode ? PERF_CONFIG.fogScale : 1;` | n=1 |
| `if (!state.performanceMode) fogScaleFactor = 1;` | n=1（L49611）→ 贴后应为 0 |
| `state.meta.performance.mode = !!on;` | n=1（L49625） |
| `base.performance = { mode: rawPerf.mode === true };` | n=1（L17477） |
| `function renderSettingsPanel() {` | n=1（L49752） |
| `renderPerfState();` | **n=2**（L49616 / L49757），用 `renderPerfState();\n  syncA11yToggles();` 组合锚点 |
| `function showToast(message, type) {` | n=1 |
| `ui.settingsPanel = document.getElementById('settingsPanel');` | n=1（L25111） |
| `ui.settingsPanel.addEventListener('mousedown', (event) => {` | n=1（L56610） |
| `Math.min(window.devicePixelRatio || 1, 2)` | **10 行 / 11 次**（L28111 一行两次），`replace_all` |
| `const opsPane = '<section class="help-pane" data-help-pane="ops">'` | n=1 |
| `function qualityPostFxEnabled()` | 存在（L49247），已含 `state.performanceMode` 判断 |
| `disablePostFx: true` | n=1（L10619），省电档强制关后处理靠它，无需补丁 |
| `const bgmNote = document.querySelector('.setting-note');` | n=1 |
| `function buildRulesContent` | 存在 |
| `function switchHelpTab(id)` | 存在（L26012） |
| `function openRules()` | 存在（L48775） |
| `function touchCapable()` | 存在（L55889） |
| `ui.rulesBody` / `ui.perfStateText2` | 均存在，且 `renderPerfState` 有 `if` 保护，删行后不崩 |

---

## 八、明确不做

1. 不做第二套存档面板、不做 meta 文本导出（跨设备迁移不支持，备份只在本机恢复）。
2. 不做 `fxDensity` 空字段：粒子数就是特效密度。
3. 不把泛光写成帧率卖点。
4. 不复活近战武器、不实装冲刺残影。
5. 不把标题页的难度 / 种子 / 角色 / 天赋搬进设置页（它们是开局选择，不是运行中设置）。
6. 不改玩法数值与随机流；本方案对“某层存活时间 / 死亡人数”的预期影响为 **0**。
