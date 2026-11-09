# 成就提示 · 5 分钟人工自测

> 前置：P5 补丁已落地（CSS / HTML / ui 缓存 / 队列实现 / 两处结算钩子）。
> 全程只需要：打开游戏 → 按 `F12` 打开控制台 → 粘贴脚本 → 看屏幕。
> 每个脚本都会在最后自动清理测试数据，不会污染存档（只有第 2 步会改一次 `saveMeta`，已做还原）。
> 预计：4 分 40 秒。

---

## 第 0 步 · 准备（20 秒）

1. 双击打开 `index_arcane_v2.html`，进入游戏（标题页按 `Enter` 或点「开始」）。
2. 按 `F12` → 切到 `Console`。
3. 先确认控制台没有红色报错。有报错就停下，说明补丁没贴好。

**预期**：控制台干净，游戏可操作。

---

## 第 1 步 · 三条同时解锁（90 秒）

在控制台粘贴：

```js
(() => {
  const cfg = META_PROGRESS_CONFIG;
  const ids = ['t_a', 't_b', 't_c'];
  const cats = ['progress', 'skill', 'explore'];
  ids.forEach((id, i) => {
    const item = { id: id, name: '队列测试' + (i + 1), desc: '测试用', category: cats[i], metric: 'kills', target: 0, reward: {} };
    cfg.achievements.push(item);
    cfg.byId[id] = item;
  });
  showToast('系统提示 · 同时出现', 'warn');
  checkMetaAchievements();
  setTimeout(() => {
    ids.forEach((id) => {
      delete state.meta.achievements[id];
      const i = cfg.achievements.findIndex((x) => x.id === id);
      if (i >= 0) cfg.achievements.splice(i, 1);
      delete cfg.byId[id];
    });
    renderArchivePanel();
    saveMeta();
    console.log('第 1 步 · 已清理');
  }, 9000);
})();
```

**必须看到**：

| 观察点 | 正确 | 错误 |
|---|---|---|
| 屏幕上方同时有几条提示 | **2 条**：104px 是系统提示，150px 是成就 | 只有 1 条 / 全都没有 |
| 成就条是否被系统提示覆盖 | 否，两条上下分开 | 成就条消失或文字被替换 |
| 三条成就出现方式 | **一条一条**，约 1.8 秒一条，共约 5.8 秒 | 三条同时挤在一起 / 只看到最后一条 |
| 顺序 | 队列测试1 → 队列测试2 → 队列测试3 | 乱序 |
| 金环与浮字 | **只有第一条**脚下有金环 + 浮字 | 三条各叠一个圈（算性能问题，不影响通过） |
| 操作是否被打断 | 完全可以继续走位、放技能 | 角色卡住 / 弹出面板 |

---

## 第 2 步 · 隐藏成就揭晓（60 秒）

```js
(() => {
  const cfg = META_PROGRESS_CONFIG;
  const item = { id: 't_hidden', name: '一尘不染', desc: '整局未掉血通关', category: 'skill', hidden: true, metric: 'kills', target: 0, reward: {} };
  cfg.achievements.push(item);
  cfg.byId.t_hidden = item;
  checkMetaAchievements();
  setTimeout(() => {
    delete state.meta.achievements.t_hidden;
    const i = cfg.achievements.findIndex((x) => x.id === 't_hidden');
    if (i >= 0) cfg.achievements.splice(i, 1);
    delete cfg.byId.t_hidden;
    renderArchivePanel();
    saveMeta();
    console.log('第 2 步 · 已清理');
  }, 6000);
})();
```

**必须看到**（与第 1 步逐项对比）：

| 观察点 | 普通成就（第 1 步） | 隐藏成就（本步） |
|---|---|---|
| 前缀 | `◈ 成就解锁` | **`✧ 隐藏成就揭晓`** |
| 第二行 | 无 | **`达成条件：整局未掉血通关`** |
| 边框颜色 | 金色 | **紫色（`#b085ff`）+ 内层金色描边** |
| 文字颜色 | 暖金 `#ffe6a8` | **淡紫 `#ecd9ff`** |
| 停留时长 | 1.8 秒 | **2.4 秒**（肉眼可感到更久） |
| 出现瞬间 | 淡入 | **淡入 + 一次 1.5px 左右轻抖** |
| 音效 | 较轻 | 更响（0.9 vs 0.6） |

> 哪一项对不上，就说明 `achvIsHidden()` 或 `.achv-toast.is-hidden` 没生效。

---

## 第 3 步 · 结算打断（90 秒）

不真死，直接模拟“本局结束时的批量解锁”：

```js
(() => {
  achvNoticeReset();
  const cfg = META_PROGRESS_CONFIG;
  const ids = [];
  for (let i = 1; i <= 5; i += 1) {
    const id = 't_s' + i;
    const item = { id: id, name: '结算测试' + i, desc: '测试用', category: 'progress', hidden: i === 3, metric: 'kills', target: 0, reward: {} };
    cfg.achievements.push(item);
    cfg.byId[id] = item;
    ids.push(id);
  }
  achvNoticeBeginSettlement();
  checkMetaAchievements();
  setTimeout(() => {
    ids.forEach((id) => {
      delete state.meta.achievements[id];
      const i = cfg.achievements.findIndex((x) => x.id === id);
      if (i >= 0) cfg.achievements.splice(i, 1);
      delete cfg.byId[id];
    });
    achvNoticeReset();
    renderArchivePanel();
    saveMeta();
    console.log('第 3 步 · 已清理');
  }, 10000);
})();
```

**必须看到**（共 3 条，不是 5 条）：

1. 第一条是 **`✧ 隐藏成就揭晓 · 结算测试3`**（隐藏优先，2.4 秒）。
2. 第二条是普通成就（2.0 秒）。
3. 第三条是 **`成就解锁 ×3 · 已记入档案`**（1.6 秒）。
4. 总时长约 6.4 秒，全程一条一条出，没有并排。

**判定**：只要出现「×3 汇总条」，说明“超过 2 条自动合并”生效；隐藏条排第一说明“隐藏优先”生效。

---

## 第 4 步 · 真死一次，看是否盖在结算面板上（60 秒）

1. 控制台执行 `achvNoticeReset()`。
2. 故意送死（走到怪堆里），死亡结算面板弹出时，立刻在控制台粘贴：

```js
(() => {
  const item = { id: 't_death', name: '死亡瞬间', desc: '测试用', category: 'long', metric: 'kills', target: 0, reward: {} };
  META_PROGRESS_CONFIG.achievements.push(item);
  META_PROGRESS_CONFIG.byId.t_death = item;
  achvNoticeBeginSettlement();
  checkMetaAchievements();
  setTimeout(() => {
    delete state.meta.achievements.t_death;
    const i = META_PROGRESS_CONFIG.achievements.findIndex((x) => x.id === 't_death');
    if (i >= 0) META_PROGRESS_CONFIG.achievements.splice(i, 1);
    delete META_PROGRESS_CONFIG.byId.t_death;
    saveMeta();
  }, 5000);
})();
```

**必须看到**：成就条出现在**死亡面板的上层**（能看清文字，不被半透明遮罩压暗、不被面板盖住）。

**若被盖住** → `.achv-toast` 的 `z-index: 66` 没生效或没贴，改成 66 以上再测一次。

---

## 第 5 步 · 回退开关（20 秒）

1. 关闭页面。
2. 用 `index_arcane_v2.html?achnotice=off` 重新打开。
3. 重复第 1 步的脚本。

**必须看到**：屏幕上**没有任何成就提示条**，但控制台 `state.meta.achievements` 里测试条目仍然被写入（说明只关表现、不关结算）。

---

## 一页判定表

| 编号 | 测什么 | 通过标准 |
|---|---|---|
| 1 | 同帧 3 条 | 一条一条出，约 1.8 秒/条，无覆盖 |
| 2 | 与系统 toast 共存 | 104px / 150px 两条分开，互不覆盖 |
| 3 | 隐藏揭晓 | 紫框 + `✧` + 达成条件行 + 2.4 秒 |
| 4 | 结算合并 | 5 条 → 详播 2 条（隐藏优先）+ `×3` 汇总 |
| 5 | 盖在结算面板上 | 死亡面板弹出时成就条仍清晰可见 |
| 6 | 回退 | `?achnotice=off` 无任何提示条 |

全部通过 = P5 可以合并。任一项失败，只回滚 P5（队列实现 + 两处结算钩子），不影响 P0–P4。
