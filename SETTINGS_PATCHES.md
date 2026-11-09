# SETTINGS_PATCHES · 可直接替换补丁包（S1–S11）

> 配套方案：[`SETTINGS_SPEC.md`](SETTINGS_SPEC.md)（项清单 / 差异表 / 代价 / 验收）
> 用法：每块都是**整段复制替换**，前后各 3 行只是定位护栏，不用改。
> 锚点统计口径：**位置数 / 出现次数**分开报（例：dpr = 10 个位置 / 11 次出现）。
> 快照：`index_arcane_v2.html` v1.8.2，MD5 `3B376F821D70EE1617A6C5A41C88508C`（2026-11-09 07:21:28）。

---

## 0. 贴之前（必读）

### 0.1 三条红线（本轮做对的地方，别在贴的时候丢了）

1. **冲刺残影必须删掉**（S5）。它是假开关：`meta.motionTrail` 默认 true、UI 写“默认关”、渲染门 `DASH_CONFIG.trailEnabled=false`，三者矛盾，玩家怎么点都看不见效果。**一个不产生任何效果的开关，比没有这个开关更糟。**
2. **弹片绝对条数不写**（没有补丁）。只保留倍率 0.45 / 0.70 / 1.00。绝对条数随技能等级变化，配置里没核实，不编“18 颗 → 8 颗”。
3. **`fogScaleFactor` 的坑必须连同注释一起贴**（S8-4）。原写法 `if (!state.performanceMode) fogScaleFactor = 1;` 会让 `drawFog()` 的采样系数和迷雾画布的实际倍率脱钩（省电切回均衡时迷雾被拉偏），也会把任何档位的迷雾倍率顶回 100% —— 这就是“改了但不生效 / 改了但画面错”的同一家族。正确动作是**整行删掉**，让 `ensureFogCanvas()` 独家管理这个值。

### 0.2 粘贴顺序（有依赖的只有这几处）

| 先贴 | 后贴 | 原因 |
|---|---|---|
| S7-1 | S7-2 | S7-2 读 `AUDIO_CONFIG.masterVolume` |
| S8-1 | S8-2 / S8-3 / S8-4 / S8-5 | 后四块引用 `QUALITY_TIERS` / `currentQualityTier()` |
| S9-1 | S9-3 / S9-7 | 说明页要用 `currentInputScheme()` / `setInputScheme()` |
| S8-9 | S10-2 | S10-2 的锚点是 S8-9 新增的 `if (ui.qualityModes)` 块 |
| S11 | 全部 | `ui.xxx` 缓存缺了，按钮点了没反应 |

其余段互相独立，按 S1→S11 顺序贴即可。**S8 与 S9 贴完再运行**（S8-6 调用了 S9-1 定义的 `showSettingsTab`，两者都是函数声明，但 `settingsTabId` 是 `let`，半途启动会踩 TDZ）。

### 0.3 每块贴前自检

对每块“原样”里的第一行和最后一行各做一次精确搜索，**两个都必须 `n=1`**；整块搜索也必须是 `n=1`。只要有一处 `n≠1` 就停手，不要凭行号硬改。

---

## 1. HTML / CSS

### S1-1 · 页签栏 HTML
位置 1 / 出现 1

**原样（整块替换）**

```html
        </div>
        <button type="button" id="settingsClose" class="btn">关闭 <kbd>O</kbd></button>
      </div>
      <div class="settings-panel">
        <section class="settings-box">
          <div class="talent-head">
            <h3>音频 · AUDIO</h3>
```

**替换为**

```html
        </div>
        <button type="button" id="settingsClose" class="btn">关闭 <kbd>O</kbd></button>
      </div>
      <div class="settings-panel">
        <div class="settings-tabs" id="settingsTabs" role="tablist" aria-label="设置分组">
          <button type="button" class="settings-tab is-active" data-settings-tab="audio" role="tab" aria-selected="true">音频</button>
          <button type="button" class="settings-tab" data-settings-tab="display" role="tab" aria-selected="false">画面</button>
          <button type="button" class="settings-tab" data-settings-tab="control" role="tab" aria-selected="false">操作</button>
          <button type="button" class="settings-tab" data-settings-tab="a11y" role="tab" aria-selected="false">无障碍</button>
          <button type="button" class="settings-tab" data-settings-tab="other" role="tab" aria-selected="false">其他</button>
        </div>
        <section class="settings-box">
          <div class="talent-head">
            <h3>音频 · AUDIO</h3>
```

### S1-2 · 页签与操作方案条 CSS
位置 1 / 出现 1

**原样**

```css
    overflow-y: auto;
    padding-right: 4px;
  }
  .settings-panel .settings-box { padding: 13px 14px; }
  .setting-row.is-stack { flex-direction: column; align-items: stretch; gap: 6px; }
  .setting-row.is-stack > label { width: auto; }
```

**替换为**

```css
    overflow-y: auto;
    padding-right: 4px;
  }
  /* 设置页五页签：复用现有设计令牌，不引入新配色 */
  .settings-tabs { display: flex; gap: 6px; flex-wrap: wrap; margin: 0 0 10px; }
  .settings-tab {
    font: inherit; cursor: pointer; padding: 6px 12px; border-radius: var(--r-pill);
    border: 1px solid rgba(126, 164, 214, 0.3); background: rgba(8, 15, 26, 0.75);
    color: var(--text-3); letter-spacing: 0.04em;
  }
  .settings-tab:hover { color: var(--text-1); border-color: var(--line-strong); }
  .settings-tab.is-active {
    color: #04121a; border-color: transparent; font-weight: 700;
    background: linear-gradient(180deg, #7ff0ff, var(--tech));
  }
  .settings-box.is-tab-hidden { display: none; }
  /* 说明页顶部的操作方案条：和设置页的「输入方式」共用 [data-input-scheme] */
  .input-scheme-bar { max-width: 360px; margin: 0 0 8px; }
  .settings-panel .settings-box { padding: 13px 14px; }
  .setting-row.is-stack { flex-direction: column; align-items: stretch; gap: 6px; }
  .setting-row.is-stack > label { width: auto; }
```

### S2-1 · 氛围 BGM → 环境层
位置 1 / 出现 1

**原样**

```html
            <span class="setting-state" id="audioStateText">BGM 关</span>
          </div>
          <div class="setting-row">
            <label id="bgmToggleLabel">氛围 BGM</label>
            <div id="bgmToggle" class="switch" role="switch" tabindex="0" aria-checked="false" aria-labelledby="bgmToggleLabel"></div>
            <span class="setting-state" id="bgmStateText">默认关闭</span>
          </div>
```

**替换为**

```html
            <span class="setting-state" id="audioStateText">BGM 关</span>
          </div>
          <div class="setting-row">
            <label id="bgmToggleLabel">环境层</label>
            <div id="bgmToggle" class="switch" role="switch" tabindex="0" aria-checked="false" aria-labelledby="bgmToggleLabel"></div>
            <span class="setting-state" id="bgmStateText">默认关闭</span>
          </div>
```

### S2-2 · BGM 音量 → 环境音量
位置 1 / 出现 1

**原样**

```html
          <div class="setting-row">
            <label for="bgmVolume">BGM 音量</label>
            <input type="range" id="bgmVolume" min="0" max="100" step="5" value="25" aria-label="氛围 BGM 音量" />
            <b id="bgmVolumeText">25%</b>
          </div>
```

**替换为**

```html
          <div class="setting-row">
            <label for="bgmVolume">环境音量</label>
            <input type="range" id="bgmVolume" min="0" max="100" step="5" value="25" aria-label="环境层音量" />
            <b id="bgmVolumeText">25%</b>
          </div>
```

### S2-3 · 新增主音量 + 页内静音，并给说明加 id
位置 1 / 出现 1

**原样**

```html
            <input type="range" id="sfxVolume" min="0" max="100" step="5" value="62" aria-label="打击音效音量" />
            <b id="sfxVolumeText">62%</b>
          </div>
          <div class="setting-note">BGM 为低频氛围层，默认关闭，宁简不吵。按 <kbd>N</kbd> 或顶部喇叭按钮可随时静音 / 恢复。</div>
        </section>

        <section class="settings-box">
```

**替换为**

```html
            <input type="range" id="sfxVolume" min="0" max="100" step="5" value="62" aria-label="打击音效音量" />
            <b id="sfxVolumeText">62%</b>
          </div>
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
          <div class="setting-note" id="audioNote">主音量管总输出；环境层是低频垫底，默认关闭；音效只影响打击与 UI。按 <kbd>N</kbd> 或顶部喇叭按钮可随时静音 / 恢复。</div>
        </section>

        <section class="settings-box">
```

### S3-1 · 性能模式 → 画质三档
位置 1 / 出现 1

**原样**

```html
            <div id="postFxToggle" class="switch" role="switch" tabindex="0" aria-checked="true" aria-labelledby="postFxToggleLabel"></div>
            <span class="setting-state" id="postFxStateText2">像素溶解 / 故障 / 冲击</span>
          </div>
          <div class="setting-row">
            <label id="perfToggleLabel">性能模式</label>
            <div id="perfToggle" class="switch" role="switch" tabindex="0" aria-checked="false" aria-labelledby="perfToggleLabel"></div>
            <span class="setting-state" id="perfStateText2">关 · 全画质</span>
          </div>
          <!-- 第 20 项：后处理四分项（默认开轻量泛光 + 暗角；色差 / CRT 逐项可关） -->
          <div class="setting-row">
            <label id="postfxBloomLabel">泛光 BLOOM</label>
```

**替换为**

```html
            <div id="postFxToggle" class="switch" role="switch" tabindex="0" aria-checked="true" aria-labelledby="postFxToggleLabel"></div>
            <span class="setting-state" id="postFxStateText2">像素溶解 / 故障 / 冲击</span>
          </div>
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
            这是唯一会明显改变帧率的开关；不改变敌人数量、掉落和随机种子。
          </div>
          <!-- 第 20 项：后处理四分项（默认开轻量泛光 + 暗角；色差 / CRT 逐项可关） -->
          <div class="setting-row">
            <label id="postfxBloomLabel">泛光 BLOOM</label>
```

### S3-2 · 画面说明改文案（不再拿帧率当卖点）
位置 1 / 出现 1

**原样**

```html
          </div>
          <div class="setting-note">
            关闭后可提升低配机帧率（粒子与屏幕冲击仍保留，只关掉全屏后期）。
          </div>
        </section>
```

**替换为**

```html
          </div>
          <div class="setting-note">
            关掉后处理只少一层全屏叠加，画面更干净；帧率收益不保证——泛光单项实测只有 0.5–1.1 ms。
          </div>
        </section>
```

### S4 · 操作页新增「输入方式」
位置 1 / 出现 1

**原样**

```html
          <div class="setting-note" id="aimNote">
            弱辅助：朝向 ±25° 内、距离 440px 内的敌人会把弹道向它偏转 60%，命中半径放宽 20%；
            强辅助全向锁定；关闭则完全手动。设置会记住到下次打开。
          </div>
          <div class="setting-row" id="weaponSettingRow">
            <label id="weaponToggleLabel">近战武器（Q）</label>
            <div id="weaponToggle" class="switch" role="switch" tabindex="0" aria-checked="true" aria-labelledby="weaponToggleLabel"></div>
```

**替换为**

```html
          <div class="setting-note" id="aimNote">
            弱辅助：朝向 ±25° 内、距离 440px 内的敌人会把弹道向它偏转 60%，命中半径放宽 20%；
            强辅助全向锁定；关闭则完全手动。设置会记住到下次打开。
          </div>
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
            只影响「说明」里给你看哪套操作；自动 = 按当前设备判断，手机默认看触屏，不会再教你按 E 和 WASD。
          </div>
          <div class="setting-row" id="weaponSettingRow">
            <label id="weaponToggleLabel">近战武器（Q）</label>
            <div id="weaponToggle" class="switch" role="switch" tabindex="0" aria-checked="true" aria-labelledby="weaponToggleLabel"></div>
```

### S5 · 删除「冲刺残影」假开关
位置 1 / 出现 1 ｜ **红线 1**

**原样（整段删除，含上一条注释）**

```html
            <div id="postfxVignetteToggle" class="switch" role="switch" tabindex="0" aria-checked="true" aria-labelledby="postfxVignetteLabel"></div>
            <span class="setting-state" id="postfxVignetteState">默认开 · 聚焦画面中心</span>
          </div>
          <!-- 第 0 项：冲刺残影（默认关，避免"两个同形角色"的观感；寿命 0.18s 短衰减） -->
          <div class="setting-row">
            <label id="motionTrailLabel">冲刺残影</label>
            <div id="motionTrailToggle" class="switch" role="switch" tabindex="0" aria-checked="false" aria-labelledby="motionTrailLabel"></div>
            <span class="setting-state" id="motionTrailState">默认关 · 0.18s 短衰减</span>
          </div>
          <!-- 第 13 项：大区切换演出开关（默认开；点击/ESC 可跳过，关闭后只保留普通下楼） -->
          <div class="setting-row">
            <label id="regionFxLabel">大区切换演出</label>
```

**替换为**

```html
            <div id="postfxVignetteToggle" class="switch" role="switch" tabindex="0" aria-checked="true" aria-labelledby="postfxVignetteLabel"></div>
            <span class="setting-state" id="postfxVignetteState">默认开 · 聚焦画面中心</span>
          </div>
          <!-- 第 0 项「冲刺残影」已删除：渲染门 DASH_CONFIG.trailEnabled=false，怎么点都没效果，
               属于假开关。meta.motionTrail 字段保留不读不写，旧档不报错。 -->
          <!-- 第 13 项：大区切换演出开关（默认开；点击/ESC 可跳过，关闭后只保留普通下楼） -->
          <div class="setting-row">
            <label id="regionFxLabel">大区切换演出</label>
```

### S6 · 关于页新增「复制诊断信息」
位置 1 / 出现 1

**原样**

```html
            烬 · 魔法 × 科技实时肉鸽。单文件、零外部资源，全部画面由 Canvas / CSS 程序化绘制。
            版本号与更新说明见发布包内的一页说明。
          </div>
          <div class="setting-author" id="aboutAuthor"></div>
        </section>
```

**替换为**

```html
            烬 · 魔法 × 科技实时肉鸽。单文件、零外部资源，全部画面由 Canvas / CSS 程序化绘制。
            版本号与更新说明见发布包内的一页说明。
          </div>
          <div class="setting-row">
            <label>反馈</label>
            <button type="button" class="btn" id="btnCopyDiagnostics">复制诊断信息</button>
            <span class="setting-state" id="diagCopiedState">离线可用</span>
          </div>
          <div class="setting-note">
            卡顿 / 听不见 / 进度问题，先看「画面 / 音频 / 其他」；还解决不了就把诊断信息发给作者。只读本机状态，不联网、不含存档内容。
          </div>
          <div class="setting-author" id="aboutAuthor"></div>
        </section>
```

---

## 2. JS · 音频（S7）

### S7-1 · 默认常量 `masterVolume`
位置 1 / 出现 1

**原样**

```js
  bgmVolume: 0.25,             // 氛围 BGM 默认音量（约 25%）
  bgmDefaultOn: false,         // 首次进入 BGM 默认关闭（用户反馈难听）
  mutedDefault: false,         // 首次进入不静音：保留必要的打击反馈
  voiceLimit: 6,               // 同时存在的音效上限，防止连打炸耳朵
```

**替换为**

```js
  bgmVolume: 0.25,             // 环境层默认音量（约 25%）
  bgmDefaultOn: false,         // 首次进入环境层默认关闭（用户反馈难听）
  mutedDefault: false,         // 首次进入不静音：保留必要的打击反馈
  /* 主音量：0 = 全静音，1 = 与 v1.8.2 响度一致。它是 master.gain，不改各音效自身增益 */
  masterVolume: 1.0,
  voiceLimit: 6,               // 同时存在的音效上限，防止连打炸耳朵
```

### S7-2 · `audioSettings` 增加 `master`
位置 1 / 出现 1 ｜ 依赖 S7-1

**原样**

```js
const audioSettings = {
  muted: AUDIO_CONFIG.mutedDefault,
  bgmOn: AUDIO_CONFIG.bgmDefaultOn,
  bgm: AUDIO_CONFIG.bgmVolume,
  sfx: AUDIO_CONFIG.sfxVolume
};
```

**替换为**

```js
const audioSettings = {
  muted: AUDIO_CONFIG.mutedDefault,
  bgmOn: AUDIO_CONFIG.bgmDefaultOn,
  bgm: AUDIO_CONFIG.bgmVolume,
  sfx: AUDIO_CONFIG.sfxVolume,
  master: AUDIO_CONFIG.masterVolume
};
```

### S7-3 · 读档补 `master`
位置 1 / 出现 1

**原样**

```js
      if (typeof data.muted === 'boolean') audioSettings.muted = data.muted;
      if (typeof data.bgmOn === 'boolean') audioSettings.bgmOn = data.bgmOn;
      if (Number.isFinite(data.bgm)) audioSettings.bgm = clamp(data.bgm, 0, 1);
      if (Number.isFinite(data.sfx)) audioSettings.sfx = clamp(data.sfx, 0, 1);
    }
```

**替换为**

```js
      if (typeof data.muted === 'boolean') audioSettings.muted = data.muted;
      if (typeof data.bgmOn === 'boolean') audioSettings.bgmOn = data.bgmOn;
      if (Number.isFinite(data.bgm)) audioSettings.bgm = clamp(data.bgm, 0, 1);
      if (Number.isFinite(data.sfx)) audioSettings.sfx = clamp(data.sfx, 0, 1);
      /* 旧档没有 master 字段 → 保持默认 1.0，响度与 v1.8.2 完全一致 */
      if (Number.isFinite(data.master)) audioSettings.master = clamp(data.master, 0, 1);
    }
```

### S7-4 · 写档补 `master`（必须带上下文，该串在调试快照里还有一处）
位置 1 / 出现 1（整块）｜ 裸串 `sfx: audioSettings.sfx` = 2 个位置 / 2 次出现

**原样**

```js
      muted: audioSettings.muted,
      bgmOn: audioSettings.bgmOn,
      bgm: audioSettings.bgm,
      sfx: audioSettings.sfx
    }));
```

**替换为**

```js
      muted: audioSettings.muted,
      bgmOn: audioSettings.bgmOn,
      bgm: audioSettings.bgm,
      sfx: audioSettings.sfx,
      master: audioSettings.master
    }));
```

> 另一处 `sfx: audioSettings.sfx` 在调试快照 `audio()` 里（约 L65637），**不要动**。

### S7-5 · 应用主音量：两处门控改成增益
位置 2 / 出现 2 ｜ 必须两处都改

**原样 A**

```js
function applyAudioSettings() {
  if (audioState.master) audioState.master.gain.value = audioSettings.muted ? 0 : 1;
  if (audioState.sfxBus) audioState.sfxBus.gain.value = audioSettings.sfx;
```

**替换为 A**

```js
function applyAudioSettings() {
  /* 主音量不再是 0/1 门控：静音时 0，否则用 master（0–1）当总增益 */
  if (audioState.master) audioState.master.gain.value = audioSettings.muted ? 0 : audioSettings.master;
  if (audioState.sfxBus) audioState.sfxBus.gain.value = audioSettings.sfx;
```

**原样 B**

```js
      audioState.master.connect(audioState.ctx.destination);
      audioState.master.gain.value = audioSettings.muted ? 0 : 1;
      audioState.sfxBus.gain.value = audioSettings.sfx;
      audioState.bgmBus.gain.value = audioSettings.bgm;
```

**替换为 B**

```js
      audioState.master.connect(audioState.ctx.destination);
      /* 首次创建总线时就要带上主音量，否则第一次出声会是满音量 */
      audioState.master.gain.value = audioSettings.muted ? 0 : audioSettings.master;
      audioState.sfxBus.gain.value = audioSettings.sfx;
      audioState.bgmBus.gain.value = audioSettings.bgm;
```

### S7-6 · 刷新界面：主音量与页内静音
位置 1 / 出现 1

**原样**

```js
  if (ui.bgmVolumeText) ui.bgmVolumeText.textContent = Math.round(audioSettings.bgm * 100) + '%';
  if (ui.sfxVolume) ui.sfxVolume.value = String(Math.round(audioSettings.sfx * 100));
  if (ui.sfxVolumeText) ui.sfxVolumeText.textContent = Math.round(audioSettings.sfx * 100) + '%';
}
```

**替换为**

```js
  if (ui.bgmVolumeText) ui.bgmVolumeText.textContent = Math.round(audioSettings.bgm * 100) + '%';
  if (ui.sfxVolume) ui.sfxVolume.value = String(Math.round(audioSettings.sfx * 100));
  if (ui.sfxVolumeText) ui.sfxVolumeText.textContent = Math.round(audioSettings.sfx * 100) + '%';
  /* 主音量与页内静音：和顶部喇叭 / N 键共用同一个 audioSettings.muted */
  if (ui.masterVolume) ui.masterVolume.value = String(Math.round(audioSettings.master * 100));
  if (ui.masterVolumeText) ui.masterVolumeText.textContent = Math.round(audioSettings.master * 100) + '%';
  if (ui.settingsMuteToggle) ui.settingsMuteToggle.setAttribute('aria-checked', audioSettings.muted ? 'true' : 'false');
  if (ui.settingsMuteState) ui.settingsMuteState.textContent = audioSettings.muted ? '已静音' : '声音开';
}
```

### S7-7 · 拖环境音量自动开层（避免“拖了却没声”）
位置 1 / 出现 1

**原样**

```js
    ui.bgmVolume.addEventListener('input', () => {
      audioSettings.bgm = clamp(Number(ui.bgmVolume.value) / 100, 0, 1);
      applyAudioSettings();
      saveAudioSettings();
      renderAudioSettings();
    });
```

**替换为**

```js
    ui.bgmVolume.addEventListener('input', () => {
      audioSettings.bgm = clamp(Number(ui.bgmVolume.value) / 100, 0, 1);
      /* 拖到大于 0 就自动打开环境层：否则玩家会以为滑杆坏了 */
      if (!audioSettings.bgmOn && audioSettings.bgm > 0) { audioSettings.bgmOn = true; ensureAudio(); }
      applyAudioSettings();
      saveAudioSettings();
      renderAudioSettings();
    });
```

### S7-8 · 主音量与页内静音的事件绑定
位置 1 / 出现 1

**原样**

```js
  if (ui.sfxVolume) {
    ui.sfxVolume.addEventListener('input', () => {
      audioSettings.sfx = clamp(Number(ui.sfxVolume.value) / 100, 0, 1);
```

**替换为**

```js
  /* 主音量：0% 全静音，100% 当前最大；拖动时若处于静音状态自动解除，避免“拖了没声” */
  if (ui.masterVolume) {
    ui.masterVolume.addEventListener('input', () => {
      audioSettings.master = clamp(Number(ui.masterVolume.value) / 100, 0, 1);
      if (audioSettings.muted && audioSettings.master > 0) audioSettings.muted = false;
      applyAudioSettings();
      saveAudioSettings();
      renderAudioSettings();
    });
  }
  /* 页内静音：与 N 键 / 顶部喇叭共用 audioSettings.muted，三处永远同步。
     toggleMute() 内部已经做了 apply/save/render，这里不要再重复调用。 */
  if (ui.settingsMuteToggle) {
    ui.settingsMuteToggle.addEventListener('click', () => { toggleMute(); });
    ui.settingsMuteToggle.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggleMute();
      }
    });
  }
  if (ui.sfxVolume) {
    ui.sfxVolume.addEventListener('input', () => {
      audioSettings.sfx = clamp(Number(ui.sfxVolume.value) / 100, 0, 1);
```

---

## 3. JS · 画质三档（S8）

### S8-1 · 新增 `QUALITY_TIERS` 与三个函数
位置 1 / 出现 1

**原样**

```js
  /** 性能模式是否强制关闭后处理 */
  disablePostFx: true
};

/* ============================================================
   M3 · 移动端触屏 + 虚拟摇杆（TOUCH_CONFIG）
```

**替换为**

```js
  /** 性能模式是否强制关闭后处理 */
  disablePostFx: true
};

/* ============================================================
   画质三档（QUALITY_TIERS）
   ------------------------------------------------------------
   只改渲染：主画布 dpr / 粒子倍率 / 迷雾离屏倍率。
   不碰敌人数量、掉落、三选一、随机种子；不中途 bakeScene()（那会消耗 rand()）。
   「省电」档会自动关后处理，走的是 qualityPostFxEnabled() 里已有的 state.performanceMode 判断。
   ============================================================ */
const QUALITY_TIERS = {
  low:  { label: '省电', dprCap: 1.0, particleScale: 0.45, fogScale: 0.50 },
  mid:  { label: '均衡', dprCap: 1.5, particleScale: 0.70, fogScale: 1.00 },
  high: { label: '高清', dprCap: 2.0, particleScale: 1.00, fogScale: 1.00 }
};

/** 当前画质档位；旧档只有 performance.mode 时迁移成 low / high */
function currentQualityTier() {
  if (!state || !state.meta) return 'high';
  const t = state.meta.qualityTier;
  if (QUALITY_TIERS[t]) return t;
  return state.performanceMode ? 'low' : 'high';
}

/** 主画布 dpr：渲染与验收采样共用，避免画布尺寸与采样倍率对不上 */
function renderDpr() {
  return Math.min(window.devicePixelRatio || 1, QUALITY_TIERS[currentQualityTier()].dprCap);
}

/** 刷新三档按钮与右侧状态文字（只改 UI） */
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

/**
 * 切画质：写档 + 立即生效
 * 只重建迷雾缓冲与主画布，不重烘场景（重烘会调用 rand()，破坏“同种子同局”）
 * @param {'low'|'mid'|'high'} tier 目标档位
 */
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

/* ============================================================
   M3 · 移动端触屏 + 虚拟摇杆（TOUCH_CONFIG）
```

### S8-2 · 粒子倍率改走档位
位置 1 / 出现 1 ｜ 依赖 S8-1

**原样**

```js
function perfParticleScale() {
  if (PERF_CONFIG.enabled === false) return 1;
  return state.performanceMode ? PERF_CONFIG.particleScale : 1;
}
```

**替换为**

```js
function perfParticleScale() {
  if (PERF_CONFIG.enabled === false) return 1;
  return QUALITY_TIERS[currentQualityTier()].particleScale;
}
```

### S8-3 · 迷雾倍率改走档位
位置 1 / 出现 1 ｜ 依赖 S8-1

**原样**

```js
function perfFogScale() {
  if (PERF_CONFIG.enabled === false) return 1;
  return state.performanceMode ? PERF_CONFIG.fogScale : 1;
}
```

**替换为**

```js
function perfFogScale() {
  if (PERF_CONFIG.enabled === false) return 1;
  return QUALITY_TIERS[currentQualityTier()].fogScale;
}
```

### S8-4 · 填 `fogScaleFactor` 的坑（红线 3：不是改值，是**删掉那行**）
位置 1 / 出现 1 ｜ 依赖 S8-1

> 核实结论先写在前面：`fogScaleFactor` 是**迷雾画布当前的实际倍率**，全文件唯一的正确写入点是 `ensureFogCanvas()`（它和画布宽高一起改）。`applyPerfMode()` 里硬写 1 会造成两种后果：
> ① 从省电切回均衡时，采样系数是 1、画布还是 0.5 → `drawFog()` 的源矩形算错，迷雾被拉偏；
> ② 只要以后给均衡档加回迷雾倍率，这里就会把它顶回 100% —— 就是“改了但不生效”的同一家族。
> 正确做法是**让这一行消失**，由 `fogW = 0` 触发下一次 `ensureFogCanvas()` 同步换画布和倍率。所以均衡档的迷雾倍率本轮固定 100%，不承诺 75%（中途换迷雾分辨率会清掉已探索的洞，得不偿失）。

**原样**

```js
function applyPerfMode() {
  const enabled = PERF_CONFIG.enabled !== false;
  state.performanceMode = enabled && !!(state.meta.performance && state.meta.performance.mode);
  if (!state.performanceMode) fogScaleFactor = 1;
  // 强制下一次 ensureFogCanvas 按新倍率重建
```

**替换为**

```js
function applyPerfMode() {
  const enabled = PERF_CONFIG.enabled !== false;
  state.performanceMode = enabled && !!(state.meta.performance && state.meta.performance.mode);
  /* 已删除 if (!state.performanceMode) fogScaleFactor = 1; —— 这是“改了但不生效”家族的固定坑：
     - fogScaleFactor 表示「迷雾画布当前实际倍率」，唯一写入点必须是 ensureFogCanvas()；
     - 在这里硬写 1，会让 drawFog() 用 1 去采样 0.5 的画布（迷雾拉偏），
       也会把任何档位的迷雾倍率顶回 100%；
     - 正确做法是只清 fogW/fogH，让下一次 ensureFogCanvas() 把画布和倍率一起换掉。 */
  // 强制下一次 ensureFogCanvas 按新倍率重建
```

### S8-5 · `setPerfMode` 保留为调试口并同步档位
位置 1 / 出现 1

**原样**

```js
function setPerfMode(on) {
  if (!state.meta.performance) state.meta.performance = { mode: false };
  state.meta.performance.mode = !!on;
  saveMeta();
```

**替换为**

```js
function setPerfMode(on) {
  if (!state.meta.performance) state.meta.performance = { mode: false };
  state.meta.performance.mode = !!on;
  /* 调试口保留：性能模式只剩开 / 关两态，映射成画质档；不要在这里再 save/showToast（下面已有） */
  state.meta.qualityTier = on ? 'low' : 'high';
  saveMeta();
```

### S8-6 · 打开设置时刷新画质与输入方式并恢复上次页签
位置 1 / 出现 1（组合锚点）｜ 裸串 `renderPerfState();` = 2 个位置 / 2 次出现

**原样**

```js
  renderPostFxState();
  renderPerfState();
  syncA11yToggles();
  /* 第 5 轮 · 档案：打开设置页时同步六格统计与成就清单 */
```

**替换为**

```js
  renderPostFxState();
  renderPerfState();
  renderQualityTier();
  syncA11yToggles();
  syncInputSchemeUI();
  /* 每次打开设置页都重设一遍页签显示：SAVE_GUARD 段是运行时注入的，重设能保证它也归到「其他」 */
  showSettingsTab(settingsTabId);
  /* 第 5 轮 · 档案：打开设置页时同步六格统计与成就清单 */
```

### S8-7 · 旧档迁移：补 `qualityTier` 与 `inputScheme`
位置 1 / 出现 1

**原样**

```js
  // D4：性能模式（旧档缺字段 → 关；类型错误 → 关）
  const rawPerf = raw.performance && typeof raw.performance === 'object' ? raw.performance : {};
  base.performance = { mode: rawPerf.mode === true };
  // 第 5 轮：连击演出（旧档缺字段 → 默认开；只有显式 false 才关）
```

**替换为**

```js
  // D4：性能模式（旧档缺字段 → 关；类型错误 → 关）
  const rawPerf = raw.performance && typeof raw.performance === 'object' ? raw.performance : {};
  base.performance = { mode: rawPerf.mode === true };
  /* 画质三档：旧档没有 qualityTier → 按 performance.mode 迁移（开 = 省电，关 = 高清） */
  base.qualityTier = (raw.qualityTier === 'low' || raw.qualityTier === 'mid' || raw.qualityTier === 'high')
    ? raw.qualityTier
    : (rawPerf.mode === true ? 'low' : 'high');
  /* 输入方式：仅接受三套具体方案，其余一律回 auto（自动按设备判断） */
  base.inputScheme = (raw.inputScheme === 'keyboard' || raw.inputScheme === 'gamepad' || raw.inputScheme === 'touch')
    ? raw.inputScheme
    : 'auto';
  // 第 5 轮：连击演出（旧档缺字段 → 默认开；只有显式 false 才关）
```

### S8-8 · dpr 收口（10 个位置 / 11 次出现）
**全局替换**：`Math.min(window.devicePixelRatio || 1, 2)` → `renderDpr()`

位置与用途（按出现顺序）：

| # | 位置 | 用途 |
|---|---|---|
| 1 | `resizeCanvas()` | 主画布尺寸 |
| 2 | `render()` 的 `ctx.setTransform` | **同一行 2 次出现**（x 与 y 缩放） |
| 3 | `__roamDebug.screenOf` | 调试坐标换算 |
| 4 | 命中线采样 | 像素采样 |
| 5 | 环形采样 | 像素采样 |
| 6 | delta 采样 | 像素采样 |
| 7 | 调试 `sample()` | 像素采样 |
| 8 | `regionHue()` | 大区取色 |
| 9 | 报告 `dpr` 字段 | 诊断输出 |

合计 **10 个位置 / 11 次出现**。用编辑器“全部替换”后应满足：
`Math.min(window.devicePixelRatio || 1, 2)` = 0 个位置；`renderDpr()` = 12 次出现（11 次调用 + 1 次定义）。

**不改** `sceneScale = Math.min(Math.max(window.devicePixelRatio || 1, 1), 1.5);` —— 场景底图重烘会消耗 `rand()`，破坏“同种子同局”。

### S8-9 · 画质按钮绑定（S10-2 以本块为锚）
位置 1 / 出现 1

**原样**

```js
  // D4 性能模式开关：点击 / 回车 / 空格都能切换
  if (ui.perfToggle) {
    const flipPerf = () => setPerfMode(!state.performanceMode);
    ui.perfToggle.addEventListener('click', flipPerf);
    ui.perfToggle.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        flipPerf();
      }
    });
  }
```

**替换为**

```js
  // D4 性能模式开关：HTML 已删除，这段保留只作为调试口（ui.perfToggle 为空时不执行）
  if (ui.perfToggle) {
    const flipPerf = () => setPerfMode(!state.performanceMode);
    ui.perfToggle.addEventListener('click', flipPerf);
    ui.perfToggle.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        flipPerf();
      }
    });
  }
  // 画质三档：按钮由 HTML 静态生成，切档立即生效
  if (ui.qualityModes) {
    ui.qualityModes.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-quality-tier]');
      if (btn) setQualityTier(btn.dataset.qualityTier);
    });
  }
```

---

## 4. JS · 页签分组与说明页输入方式（S9）

### S9-1 · 新增页签与输入方式函数
位置 1 / 出现 1 ｜ 必须在 `renderSettingsPanel` 之前

**原样**

```js
/**
 * 重建设置面板内容：音频 / 辅助瞄准 / 画面 / 清档四处互不干扰
 */
function renderSettingsPanel() {
```

**替换为**

```js
/* ============================================================
   设置页 5 个页签（按玩家问题分组，不按代码结构）
   ------------------------------------------------------------
   存档安全段由 SAVE_GUARD 运行时注入，所以判 id 而不是判 h3 文字；
   文字以后一改，分组不会跟着失效。
   ============================================================ */
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

/**
 * 判断一个设置分区属于哪个页签
 * @param {HTMLElement} box .settings-box 或 .settings-save
 * @returns {'audio'|'display'|'control'|'a11y'|'other'}
 */
function settingsTabOf(box) {
  if (!box) return 'other';
  if (box.id && SETTINGS_TAB_OF_ID[box.id]) return SETTINGS_TAB_OF_ID[box.id];
  if (box.classList && box.classList.contains('settings-save')) return 'other';
  const h = box.querySelector && box.querySelector('h3');
  const name = h ? h.textContent.trim() : '';
  const hit = SETTINGS_TAB_OF_H3.find((row) => name.indexOf(row[0]) === 0);
  return hit ? hit[1] : 'other';
}

/**
 * 切页签：只切显示，不动任何设置值
 * @param {'audio'|'display'|'control'|'a11y'|'other'} id 页签
 * @returns {void}
 */
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

/**
 * 当前实际生效的输入方式：auto 时按设备猜，手机优先触屏
 * @returns {'keyboard'|'gamepad'|'touch'}
 */
function currentInputScheme() {
  const saved = state && state.meta ? state.meta.inputScheme : 'auto';
  if (saved === 'keyboard' || saved === 'gamepad' || saved === 'touch') return saved;
  if (touchCapable()) return 'touch';
  if (state.gamepadConnected) return 'gamepad';
  return 'keyboard';
}

/**
 * 刷新设置页的输入方式按钮与状态文字（只改 UI，不重建说明页）
 * @returns {void}
 */
function syncInputSchemeUI() {
  const saved = (state && state.meta && state.meta.inputScheme) || 'auto';
  const labels = { keyboard: '键盘', gamepad: '手柄', touch: '触屏' };
  if (ui.inputSchemeModes) {
    ui.inputSchemeModes.querySelectorAll('[data-input-scheme]').forEach((btn) => {
      const on = btn.dataset.inputScheme === saved;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  if (ui.inputSchemeState) {
    ui.inputSchemeState.textContent = saved === 'auto'
      ? '自动 · ' + labels[currentInputScheme()]
      : labels[saved];
  }
}

/**
 * 写档并按新方案重建说明页（只重建说明内容，不重开游戏）
 * @param {'auto'|'keyboard'|'gamepad'|'touch'} next 目标方案
 * @returns {void}
 */
function setInputScheme(next) {
  if (!state || !state.meta) return;
  state.meta.inputScheme = (next === 'keyboard' || next === 'gamepad' || next === 'touch') ? next : 'auto';
  saveMeta();
  syncInputSchemeUI();
  buildRulesContent();
  if (ui.rulesBody) ui.rulesBody.scrollTop = 0;
}

/**
 * 重建设置面板内容：音频 / 辅助瞄准 / 画面 / 清档四处互不干扰
 */
function renderSettingsPanel() {
```

### S9-2 · 页签按钮绑定
位置 1 / 出现 1

**原样**

```js
  // 设置面板（O / 右上齿轮）：关闭按钮 + 遮罩 + 各开关
  if (ui.btnSettings) ui.btnSettings.addEventListener('click', () => togglePanel('settings'));
  if (ui.settingsClose) ui.settingsClose.addEventListener('click', () => closePanel('settings'));
  if (ui.settingsPanel) {
    ui.settingsPanel.addEventListener('mousedown', (event) => {
```

**替换为**

```js
  // 设置面板（O / 右上齿轮）：关闭按钮 + 遮罩 + 各开关
  if (ui.btnSettings) ui.btnSettings.addEventListener('click', () => togglePanel('settings'));
  if (ui.settingsClose) ui.settingsClose.addEventListener('click', () => closePanel('settings'));
  /* 页签切换：只改显示，不重算任何设置 */
  ui.settingsTabs = document.getElementById('settingsTabs');
  if (ui.settingsTabs) {
    ui.settingsTabs.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-settings-tab]');
      if (btn) showSettingsTab(btn.dataset.settingsTab);
    });
  }
  if (ui.settingsPanel) {
    ui.settingsPanel.addEventListener('mousedown', (event) => {
```

### S9-3 · 说明页按键表按输入方式切换
位置 1 / 出现 1 ｜ 依赖 S9-1

**原样**

```js
  // ---------- 页签 1：操作 ----------
  const opsPane = '<section class="help-pane" data-help-pane="ops">'
    + '<div class="help-card">'
    + '<h3><em>01</em>操作键位</h3>'
    + '<ul>' + HELP_KEYS.map((row) => {
      /* P2-A2：按键表里的时间 / 槽位数不再手写，一律跟配置同步 */
      if (row.keys === 'Shift / 空格') {
        return '<li><kbd>' + row.keys + '</kbd>：' + row.desc + '（' + facts.dashIframes + 's 无敌）</li>';
      }
      if (row.keys === '1–6') {
        return '<li><kbd>1–' + facts.magicSlotMax + '</kbd>：' + row.desc + '</li>';
      }
      return '<li><kbd>' + row.keys + '</kbd>：' + row.desc + '</li>';
    }).join('') + '</ul>'
    + '<div class="help-note">面板（帮助 / 技能树 / 设置 / 地图）互斥，打开即暂停世界与计时；按 <kbd>Esc</kbd> 或同名快捷键关闭。</div>'
    + '</div></section>';
```

**替换为**

```js
  // ---------- 页签 1：操作 ----------
  /* 按键表按当前输入方式切换：键盘沿用 HELP_KEYS，手柄 / 触屏用静态表。
     手机端不再出现 E / WASD —— 修的就是“当面教手机玩家按 E”的问题。 */
  const inputScheme = currentInputScheme();
  const inputSchemeLabels = { keyboard: '键盘 / 鼠标', gamepad: '手柄', touch: '触屏' };
  const inputSchemeBar = '<div class="aim-modes input-scheme-bar" role="group" aria-label="操作方案">'
    + ['keyboard', 'gamepad', 'touch'].map((id) => {
      const on = id === inputScheme ? ' is-active' : '';
      return '<button type="button" class="aim-mode' + on + '" data-input-scheme="' + id + '">'
        + inputSchemeLabels[id] + '</button>';
    }).join('') + '</div>';
  const keyboardRows = HELP_KEYS.map((row) => {
    /* P2-A2：按键表里的时间 / 槽位数不再手写，一律跟配置同步 */
    if (row.keys === 'Shift / 空格') {
      return '<li><kbd>' + row.keys + '</kbd>：' + row.desc + '（' + facts.dashIframes + 's 无敌）</li>';
    }
    if (row.keys === '1–6') {
      return '<li><kbd>1–' + facts.magicSlotMax + '</kbd>：' + row.desc + '</li>';
    }
    return '<li><kbd>' + row.keys + '</kbd>：' + row.desc + '</li>';
  }).join('');
  /* 手柄：键名严格对齐 GAMEPAD_CONFIG.buttons（Xbox 布局），不另写第二套键位 */
  const gamepadRows = [
    ['A', '施放当前魔法'],
    ['B', '影步冲刺'],
    ['X', '科技装置'],
    ['Y', '近战武器（当前版本未开放）'],
    ['LB', '切换魔法槽'],
    ['RB', '融合 / 过载'],
    ['LT', '交互：楼梯 / 宝箱 / 裂隙 / 商店'],
    ['RT', '技能树与配方'],
    ['Back / View', '帮助（本页）'],
    ['Start / Menu', '设置'],
    ['左摇杆按下', '全屏地图']
  ].map((row) => '<li><kbd>' + row[0] + '</kbd>：' + row[1] + '</li>').join('');
  /* 触屏：与屏幕上的虚拟按键一一对应 */
  const touchRows = [
    ['左半屏拖动', '虚拟摇杆移动（落指生成，抬起消失）'],
    ['右半屏点按', '朝该点施法'],
    ['右半屏拖动', '实时修正瞄准方向'],
    ['影步键', '冲刺（短无敌）'],
    ['装置键', '科技装置'],
    ['融合键', '融合 / 过载'],
    ['交互键', '楼梯 / 宝箱 / 裂隙 / 商店'],
    ['地图键', '全屏地图'],
    ['技能树键', '技能树与配方'],
    ['帮助键', '帮助（本页）']
  ].map((row) => '<li><kbd>' + row[0] + '</kbd>：' + row[1] + '</li>').join('');
  const schemeRows = inputScheme === 'touch' ? touchRows
    : (inputScheme === 'gamepad' ? gamepadRows : keyboardRows);
  const opsPane = '<section class="help-pane" data-help-pane="ops">'
    + '<div class="help-card">'
    + '<h3><em>01</em>操作键位 · ' + inputSchemeLabels[inputScheme] + '</h3>'
    + inputSchemeBar
    + '<ul>' + schemeRows + '</ul>'
    + '<div class="help-note">' + (inputScheme === 'touch'
      ? '面板（帮助 / 技能树 / 设置 / 地图）互斥，打开即暂停世界与计时；点右上角按钮关闭。'
      : '面板（帮助 / 技能树 / 设置 / 地图）互斥，打开即暂停世界与计时；按 <kbd>Esc</kbd> 或同名快捷键关闭。')
    + '</div>'
    + '</div></section>';
```

### S9-4 · 说明页里的方案按钮绑定（绑在容器上，重建不会丢）
位置 1 / 出现 1

**原样**

```js
  ui.rulesBody.innerHTML = opsPane + fusionPane + rulesPane;
  bindHelpTabs();
  switchHelpTab(state.helpTab || 'ops');
}
```

**替换为**

```js
  ui.rulesBody.innerHTML = opsPane + fusionPane + rulesPane;
  bindHelpTabs();
  switchHelpTab(state.helpTab || 'ops');
  /* 操作方案切换：监听器绑在容器上，内层 HTML 重建也不会丢；只认说明页里的按钮 */
  if (!ui.rulesBody.dataset.schemeBound) {
    ui.rulesBody.dataset.schemeBound = '1';
    ui.rulesBody.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-input-scheme]');
      if (btn && btn.closest('.help-pane')) setInputScheme(btn.dataset.inputScheme);
    });
  }
}
```

### S9-5 · 设置页的输入方式按钮：选中即看效果
位置 1 / 出现 1 ｜ 依赖 S9-1、S8-9

**原样**

```js
  // 画质三档：按钮由 HTML 静态生成，切档立即生效
  if (ui.qualityModes) {
    ui.qualityModes.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-quality-tier]');
      if (btn) setQualityTier(btn.dataset.qualityTier);
    });
  }
```

**替换为**

```js
  // 画质三档：按钮由 HTML 静态生成，切档立即生效
  if (ui.qualityModes) {
    ui.qualityModes.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-quality-tier]');
      if (btn) setQualityTier(btn.dataset.qualityTier);
    });
  }
  // 输入方式：选完直接打开说明页的操作页，让玩家立刻看到换成了哪套
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

### S9-6 · 触屏文案只改音频说明，不再误伤操作说明
位置 1 / 出现 1 ｜ 裸串 `document.querySelector('.setting-note')` = 1 个位置 / 1 次出现

**原样**

```js
  const deck = document.querySelector('.deck-keys:not(#padLegend)');
  if (deck) deck.textContent = '摇杆移动　右侧点按施法　左侧点按拖动瞄准';
  const bgmNote = document.querySelector('.setting-note');
  if (bgmNote) bgmNote.textContent = 'BGM 为低频氛围层，默认关闭，宁简不吵。点顶部喇叭可随时静音 / 恢复。';
  /* 画布提示是配置常量，直接覆盖值，不改绘制逻辑 */
```

**替换为**

```js
  const deck = document.querySelector('.deck-keys:not(#padLegend)');
  if (deck) deck.textContent = '摇杆移动　右侧点按施法　左侧点按拖动瞄准';
  /* 只改音频说明：旧选择器取的是设置页里第一个 .setting-note（操作说明），会串味 */
  const bgmNote = document.getElementById('audioNote');
  if (bgmNote) bgmNote.textContent = '主音量管总输出；环境层是低频垫底，默认关闭；音效只影响打击与 UI。点顶部喇叭可随时静音 / 恢复。';
  /* 画布提示是配置常量，直接覆盖值，不改绘制逻辑 */
```

---

## 5. JS · 复制诊断信息（S10）

### S10-1 · 两个工具函数
位置 1 / 出现 1

**原样**

```js
 * @param {string} type 类型：success / warn / error（空字符串为普通）
 */
function showToast(message, type) {
  /* P1 · 触屏文案：所有运行时提示统一过一遍翻译，避免"按 E 购买"这类键名进屏幕 */
```

**替换为**

```js
 * @param {string} type 类型：success / warn / error（空字符串为普通）
 */

/**
 * 复制纯文本：优先 Clipboard API，失败退回 textarea（离线 / 老浏览器可用）
 * @param {string} text 要复制的文本
 * @returns {boolean} 是否成功
 */
function copyPlainText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text);
      return true;
    }
  } catch (error) { /* 继续走兜底 */ }
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

/**
 * 诊断信息：只读本机状态，不联网、不含存档内容
 * @returns {void}
 */
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
  if (ui.diagCopiedState) ui.diagCopiedState.textContent = ok ? '已复制' : '复制失败';
  showToast(ok ? '诊断信息已复制' : '复制失败，请手动抄写', ok ? 'success' : 'warn');
}

function showToast(message, type) {
  /* P1 · 触屏文案：所有运行时提示统一过一遍翻译，避免"按 E 购买"这类键名进屏幕 */
```

### S10-2 · 按钮绑定（锚点是 S8-9 新增的块）
位置 1 / 出现 1 ｜ 依赖 S8-9、S9-5

**原样**

```js
  // 输入方式：选完直接打开说明页的操作页，让玩家立刻看到换成了哪套
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

**替换为**

```js
  // 输入方式：选完直接打开说明页的操作页，让玩家立刻看到换成了哪套
  if (ui.inputSchemeModes) {
    ui.inputSchemeModes.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-input-scheme]');
      if (!btn) return;
      setInputScheme(btn.dataset.inputScheme);
      openRules();
      switchHelpTab('ops');
    });
  }
  // 复制诊断信息：出问题时让玩家一键把环境发过来
  if (ui.btnCopyDiagnostics) {
    ui.btnCopyDiagnostics.addEventListener('click', copyDiagnostics);
  }
```

---

## 6. `ui` 缓存补充（S11）

### S11 · 一次性补齐 10 个节点
位置 1 / 出现 1

**原样**

```js
  ui.settingsPanel = document.getElementById('settingsPanel');
  ui.settingsClose = document.getElementById('settingsClose');
  ui.btnSettings = document.getElementById('btnSettings');
  ui.postFxToggle = document.getElementById('postFxToggle');
```

**替换为**

```js
  ui.settingsPanel = document.getElementById('settingsPanel');
  /* 设置页新增节点：页签栏在 S9-2 里取（只取一次，避免两处赋值打架） */
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
  ui.settingsClose = document.getElementById('settingsClose');
  ui.btnSettings = document.getElementById('btnSettings');
  ui.postFxToggle = document.getElementById('postFxToggle');
```

---

## 7. 贴完自检（全部满足才算完）

| 检查 | 期望 |
|---|---|
| `id="perfToggle"` | 0 个位置 |
| `id="motionTrailToggle"` | 0 个位置 |
| `id="settingsTabs"` | 1 个位置 |
| `id="qualityModes"` | 1 个位置 |
| `id="inputSchemeModes"` | 1 个位置 |
| `QUALITY_TIERS` | ≥ 4 次出现 |
| `renderDpr()` | 12 次出现（11 调用 + 1 定义） |
| `Math.min(window.devicePixelRatio || 1, 2)` | 0 个位置 |
| `audioSettings.master` | ≥ 7 次出现 |
| `fogScaleFactor = perfFogScale();` | 0 个位置（不再由 applyPerfMode 写） |
| `if (!state.performanceMode) fogScaleFactor = 1;` | 0 个位置（坑已填） |
| 控制台 | 0 error，能进游戏，能开设置 |

语法检查前**不要**开浏览器跑性能测试（机器当前 18 个 msedge / CPU 80%），先做 `node --check` 级别的语法确认，再按 SPEC 第 6 节 A/B 两类验收。
