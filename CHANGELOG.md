# 更新日志

## 1.0.3 — 2026-10-02

### Fixed

- 支持经过安全校验的 JPEG 生成结果以原始格式直接导入 Photoshop。
- 修复 GRS `nano-banana-fast` 生成成功但无法导入的问题。
- 修复 ExtendScript `File.seek()` 使用 mode 2 时方向错误，导致有效 JPEG 被误报为空或截断的问题。
- PNG 与 JPEG 均使用真实 Magic Bytes 校验，不再只依赖 URL 或扩展名。
- 支持 JPEG History 原图保存与重新导入，重新导入始终使用原始文件。
- 修复失败 History 可通过有效 `resultUrl` 重新下载并导入原结果。
- 修复错误的“当前 Mock 导入仅支持 PNG 图片”文案。
- 修复 Provider URL 结果被错误固定声明为 `image/png` 的问题。

### Security / Integrity

- `Content-Type` 与 Magic Bytes 不一致时拒绝导入。
- 文件扩展名与真实格式不一致时拒绝导入。
- 继续拒绝 HTML、WebP、损坏文件和格式伪装文件。
- 图片写入后回读并核对字节长度；写入不完整时不会调用 Photoshop Host。
- JPEG 保持原始二进制，不经过 Canvas 重编码。

### Compatibility

- PNG 原有下载、保存和导入行为保持不变。
- 正式 Extension ID、storage namespace 和用户数据目录保持不变。
- v1.0.2 的设置、API Key、Provider、Prompt Preset 和 History 应继续保留。
- Auto Sharpen 实验功能不包含在 v1.0.3 中。
- WebP 和 AVIF 当前仍不支持。
- Photoshop 23/24 仅完成静态与模拟兼容验证，尚未完成对应版本实机验证。

### Manual Validation

- Photoshop 2024：PNG 导入 **PASS**。
- GRS `nano-banana-fast` JPEG 生成与 Photoshop 导入 **PASS**。
- Fast 模型 **PASS**，PNG 回归 **PASS**。
- 实机中的 `UNSUPPORTED_IMAGE_FILE` 与 `INVALID_IMAGE_FILE` 错误均已消失。
- 验收状态：`V1.0.3-JPEG-MANUAL-TEST-PASSED`。

## 1.0.2 — 2026-09-28

- 修复用户 Prompt Preset 删除后重启 Photoshop 又恢复的问题。
- 删除预设时同步清理 Favorites、Recent、Preset Stack、重命名和参数值关联状态。
- 增加存储写入校验与失败回滚，避免 UI 与持久化状态不一致。
- 保留完整 Prompt Preset UI、Provider、History、Recovery、Photoshop Import 和安装行为。

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
