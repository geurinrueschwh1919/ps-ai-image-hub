# PS AI Image Hub v1.0.1

> **仅支持 CEP 11 / Photoshop Host 23.x、24.x、25.x。Photoshop 26.x 及更高版本不受支持，请勿安装。**

## 支持环境

- Windows 10 / 11
- Photoshop 2022 / 23.x：目标支持
- Photoshop 2023 / 24.x：目标支持
- Photoshop 2024 / 25.x：已在 25.0 实机验证
- Photoshop 2025+ / 26.x+：不支持

## 下载与安装

1. 下载 `PSAIHub-Compat.zip`。
2. 完整解压到短路径，例如 `C:\PSAIHub\` 或 `D:\PSAIHub\`；不要在压缩包内直接运行安装器。
3. 双击 `PSAIHub-Setup.cmd`。本版本不再把未签名 IExpress EXE 作为公开安装入口。
4. 完成后彻底关闭并重启 Photoshop。
5. 打开 **窗口 → 扩展（旧版）→ PS AI Image Hub**。
6. 首次使用请自行配置 Provider 和 API Key。Release 不包含任何密钥。

普通启动脚本无法启动或安装失败时，使用 `Debug\PSAIHub-Debug.cmd`，诊断窗口会保留退出代码。如果安全策略阻止脚本，可将 `Manual\PS-AI-Image-Hub-CEP11-Compat` 复制到 `%APPDATA%\Adobe\CEP\extensions\PS-AI-Image-Hub-CEP11-Compat`，完成无需执行程序的手动安装。

> Windows 仍可能提示来自互联网的 ZIP、CMD 或 PowerShell 文件存在风险。请只从本 Release 下载并核对 SHA-256；不要关闭 Defender，也不要安装来源不明或自签名根证书。

## v1.0.1 安装器修复

- 移除公开 ZIP 中的未签名 IExpress EXE，避免其自解压启动链被 Windows 拦截后无提示退出。
- 默认使用透明的 `PSAIHub-Setup.cmd` 启动原有安装 UI。
- Debug 启动器始终保留退出代码和日志位置，不再一闪即退。
- 增加完整 CEP Runtime 手动复制兜底。

## 主要功能

- GRS、阿里云百炼、Mock Provider。
- 主图、参考图、当前画布与当前选区。
- History、原 Task Recovery、targetBounds 再导入对齐与文档尺寸差异提示。
- 本地 JSON / ZIP Prompt Preset、参数预设、分类中文显示、收藏、最近使用、200ms 搜索 debounce。
- Preset Stack、Replace、Append。
- 自动/手动 Photoshop 导入。
- 禁止 Canvas upscale；小图放大由 Photoshop 智能对象完成，并在导入前提示清晰度风险。

## 已知限制

- 不支持 Photoshop 26.x+。
- PS23/PS24 建议继续在对应真实 Photoshop 环境验收。
- 停止等待不等于服务端取消；Recovery 只查询原 Task，不重新 Submit。
- 智能对象缩放不能创造原图不存在的细节。
- 云端请求受服务商 CORS、网络与计费策略影响。

## SHA-256

`PSAIHub-Compat.zip`

```text
{{ZIP_SHA256}}
```
