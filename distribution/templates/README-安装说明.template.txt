PS AI Image Hub {{DISTRIBUTION_VERSION}}
========================================

重要：本安装包仅支持 CEP 11 / Photoshop Host 23.x、24.x、25.x。
Photoshop 26.x 及更高版本不受支持，请勿安装。

【支持范围】
- Photoshop 2022 / 23.x：目标支持
- Photoshop 2023 / 24.x：目标支持
- Photoshop 2024 / 25.x：已在 25.0 实机验证
- Photoshop 2025+ / 26.x+：不支持
- Windows 10 / 11

【安装方法】
1. 完全关闭 Photoshop。
2. 解压整个 ZIP，不要在压缩包窗口内直接运行安装器。
3. 建议解压到短路径，例如 C:\PSAIHub\ 或 D:\PSAIHub\。
4. 双击 {{RELEASE_FILENAME}}。这是可查看内容的本地启动脚本，不是未签名 EXE。
5. 安装器会检测 Photoshop、CEP Root 与已有安装，并提供安装、修复、更新或卸载。
6. 完成后重新启动 Photoshop。
7. 打开：窗口 → 扩展（旧版）→ PS AI Image Hub。
8. 首次使用时在设置中选择 Provider，并填写自己的 API Key。

【手动安装兜底】
如果 Windows 安全策略阻止脚本，完全不需要运行任何程序：
1. 将 Manual\PS-AI-Image-Hub-CEP11-Compat 整个目录复制到：
   %APPDATA%\Adobe\CEP\extensions\PS-AI-Image-Hub-CEP11-Compat
2. 确认目标目录内直接存在 CSXS、client、host，不要多套一层同名目录。
3. 完全关闭并重新启动 Photoshop，然后从“窗口 → 扩展（旧版）”打开插件。

【Debug 启动器】
只有普通启动脚本无法启动或安装失败时，才运行 Debug\{{DEBUG_FILENAME}}。
Debug 窗口会保留退出代码，不再一闪即退。安装日志位于：
- %LOCALAPPDATA%\PSAIImageHubCompatInstaller\logs
- %TEMP%\PSAIImageHubCompatInstaller\logs
反馈日志前请删除 API Key、Token、Authorization Header、私人路径和个人数据。

【Windows 安全提示】
v1.0.2 公开 ZIP 使用无终端窗口的 VBS 启动器，不再分发未签名 IExpress EXE。Windows 仍可能对来自互联网的 ZIP、VBS 或 PowerShell 显示安全提示；请只从本项目 GitHub Release 下载并核对 SHA-256。项目不会提供自签名证书，也不会要求关闭 Defender 或绕过组织安全策略。

【卸载】
重新运行安装器 {{RELEASE_FILENAME}} 并选择“卸载”，或从 Windows“已安装的应用”中卸载。
默认保留本地用户数据；卸载时可选择删除。

【主要功能】
- GRS、阿里云百炼、Mock Provider
- 主图、参考图、当前画布、当前选区
- History 与原 Task Recovery；Recovery 不重新 Submit
- 本地 JSON / ZIP 提示词预设、参数预设、分类、收藏、最近使用、搜索
- 200ms 搜索 debounce、Preset Stack、Replace / Append
- 自动或手动导入 Photoshop
- History 再导入 targetBounds 对齐与文档尺寸差异提示

【导入画质保护】
- 默认关闭“导入结果时匹配主图区域”。
- Canvas 只允许缩小，不会放大生成图。
- 2048×1152 到 2560×1440 等小图到大区域场景使用 Photoshop 智能对象缩放，避免 Canvas 放大重采样。
- 4096×2160 到 1920×1080 等大图到小区域场景允许缩小匹配。
- 相同尺寸直接使用原图，不重新缩放、不重新编码。
- 智能对象不能创造原图不存在的细节，请在 Photoshop 100% 视图判断实际清晰度。

【安全】
本包不包含任何可用 API Key。请自行申请 Provider 凭据，不要公开分享密钥、完整配置或未脱敏日志。

版本：{{PRODUCT_VERSION}}
