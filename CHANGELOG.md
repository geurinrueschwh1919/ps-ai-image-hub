# 更新日志

## 1.0.1 — 2026-09-26

- 修复公开安装包在部分 Windows 10/11 环境中通过 IExpress 启动后立即退出且未留下主体日志的问题。
- 公开 ZIP 不再分发未签名 IExpress EXE，默认改用透明的 CMD → Windows PowerShell 启动链。
- Debug 启动器始终保留退出代码与日志位置。
- 增加完整 CEP Runtime 手动复制安装兜底；安全策略阻止脚本时无需运行任何程序。
- 插件 Runtime、Provider、History、Recovery、Photoshop Import 与用户数据格式均未修改。

## 1.0.0 — 2026-09-26

- 将多版本 CEP 11 架构确立为主要公开版本，支持 Photoshop Host 23.x、24.x、25.x。
- 提供 GRS、阿里云百炼与 Mock Provider。
- 支持主图、参考图、当前画布与当前选区工作流。
- 支持异步任务、History、原任务 Recovery 和本地停止等待。
- 支持本地 JSON/ZIP 提示词预设、参数预设、分类、收藏、最近使用、搜索、Preset Stack、Replace 与 Append。
- 支持自动/手动 Photoshop 导入、禁止 Canvas 放大、智能对象放大、清晰度预警与 History 再导入对齐。
- 提供 Windows 自动安装器、修复、更新、卸载、CEP 根目录检测、UAC 与 Debug 诊断入口。
- 发布包和源码不包含 API Key、用户数据、用户图片或私人日志。
