# 触屏文案补丁 · 验收清单

- [x] `patch-touch-keycaps.js` 存在且为单文件 IIFE，零外部请求
- [x] 触屏判定不用 UA：第一段 `maxTouchPoints/any-pointer: coarse`，第二段真实 `touchstart` / `pointerType==='touch'`
- [x] `?touch=off` 时两个补丁都不启动（`active=false`），不产生任何 DOM / 样式副作用
- [x] 触屏态可见 `kbd` 无拉丁键名（43 个、可见 29、残留 0）
- [x] 卡组键位行、技能条、融合提示、顶部首次提示均为中文动作词
- [x] 按钮内装饰键帽隐藏，不出现“普攻 普攻”重复
- [x] `ONBOARD_STEPS` 五条 hint 全部 ≤ 12 字且无键位词（9/9/12/8/8）
- [x] `updateContextHints` 被包装后不再把文案刷回键鼠原句
- [x] 教学卡显示「摇杆移动，点攻击键」，情境提示显示「点攻击键施法」「点闪避键冲刺」
- [x] 键鼠态逐字段与原始主文件一致：卡组 J/K/Q/E/F/H、`step0`「WASD 移动，左键开火」
- [x] 键鼠态 `?touch=off` 与原始主文件 `bodyClass`、样式表数量一致（零新增样式）
- [x] 主文件 `index_arcane_v2.html` 未被修改（SHA256 `92B649BC…7477E6`）
- [x] 每个补丁块可单独回退：整文件删一行，或按 KB/CP 块删除
- [x] `touch.md` 记录锚点（标识符/选择器）、改前原文、触屏结果、回滚方式
- [x] `touch.md` 第 9 节把 iOS Safari 安全区写为“未验证项”，不写“已适配”
- [x] 全量验收 `node tools/arcane_touch_v3.js` → 40/40 PASS，无 JS 报错
- [x] 四张截图落盘，新增 `touch-copy.png`
