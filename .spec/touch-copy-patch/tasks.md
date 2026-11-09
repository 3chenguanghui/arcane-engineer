# 触屏文案补丁 · 执行清单

> 规范见 `spec.md`。每步完成后立刻跑对应验证；全部完成再统一跑 40 条。

## T1 新建键帽补丁
- [x] 创建 `patch-touch-keycaps.js`（IIFE，`'use strict'`）
- [x] 触屏判定：`touch=off` / `touch=on` / coarse+hover:none / 首个真实触摸
- [x] `<kbd>` 映射表（21 条）+ 去药丸内联样式
- [x] 元素级替换（`.deck-keys`、`#fusionNote`、`#fusionBar`、`.skill-chip`、`.deck-title i`、`#introHintText`、`#introHintSub`）
- [x] 触屏隐藏 `.m-key` 与单字母 `em`
- [x] `MutationObserver` + rAF 去抖 + 跳过脚本节点
- [x] 暴露 `window.__touchKeycaps`

## T2 新建教学文案补丁
- [x] 创建 `patch-touch-copy.js`（IIFE，`'use strict'`）
- [x] 改写 `ONBOARD_STEPS` 五条（9/9/12/8/8 字）
- [x] 包装 `updateContextHints`，翻译 `#contextHint` 的 `b` / `span`
- [x] 静态文本精确表 + 键位短语正则
- [x] `MutationObserver` 同步
- [x] 暴露 `window.__touchCopy`（含 `translate`）

## T3 修改 touch.js
- [x] 删除 `body.tg-touch #contextHint[data-key^="u9-"]` 隐藏规则
- [x] `sysDefs` 副标题改：全屏 / 查看 / 调整 / 长按
- [x] `actDefs` 副标题改：召唤 / 长按 / 冲刺 / 合成 / 拾取 / 按住连发
- [x] `aria-label` 同步中文

## T4 重建演示页
- [x] `tools/_touch_demo_build.js` 依次内联三个脚本（id：`tg-touch-inline` / `tg-keycaps-inline` / `tg-copy-inline`）
- [x] 注释中不得出现完整脚本结束标签
- [x] `node tools/_touch_demo_build.js` 输出新 `touch-demo.html`

## T5 验收脚本扩到 40 条
- [x] T0e 去掉"临时摘 data-key"的旧处理
- [x] 新增 T7a–T7d（键帽 / 卡组 / 按钮副标题 / 顶部提示）
- [x] 新增 T8a–T8c（数组字数 / translate / 教学卡 DOM）
- [x] 新增 T9a–T9b（`?touch=off` 原文保持）
- [x] 新增 `touch-copy.png` 截图（竖屏 + 教学卡 + 情境提示 + 中文按钮）
- [x] T5 改为核对 4 张截图

## T6 全量验证
- [x] `node tools/arcane_touch_v3.js` → 40/40 PASS
- [x] 检查 `touch-copy.png`：无 F/K/Shift/WASD 字样，教学卡为"摇杆移动，点攻击键"
- [x] 检查原有三张截图无回退

## T7 文档
- [x] `touch.md` 新增补丁章节（锚点=标识符、改前原文、回滚一句话）
- [x] 断言数 40、截图 4 张
- [x] iOS Safari 安全区改为"未验证项"

## T8 汇报
- [x] 贴出两张关键截图（触屏按钮 / 首局教学卡）
- [x] 说明判定策略与回滚方式
