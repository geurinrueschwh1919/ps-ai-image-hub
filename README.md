# PS AI Image Hub

> **重要：这是 CEP 11 版本，仅面向 Photoshop 23.x、24.x、25.x。Photoshop 26.x 及更高版本不受支持，请勿安装。**

## 支持范围

| Photoshop | Host 版本 | 状态 |
|---|---:|---|
| Photoshop 2022 | 23.x | 目标支持；请按实际环境验证 |
| Photoshop 2023 | 24.x | 目标支持；请按实际环境验证 |
| Photoshop 2024 | 25.x | 已在 Photoshop 25.0 实机验证并支持 |
| Photoshop 2025 及更高版本 | 26.x+ | **不支持，请勿安装** |

插件同时声明 `PHSP` 与 `PHXS`，Host 范围固定为 `[23.0,26.0)`，运行时为 CEP 11 / CSXS 11。

## 安装

1. 从 GitHub Releases 下载 `PSAIHub-Compat.zip`。
2. **完整解压 ZIP 后再运行安装器**，不要在压缩包预览窗口中直接启动。建议解压到短路径，例如 `C:\PSAIHub\` 或 `D:\PSAIHub\`。
3. 双击 `PSAIHub-Setup.cmd`。公开 ZIP 不再分发未签名 IExpress EXE。
4. 安装器会检测 Photoshop、CEP 根目录与现有安装，并提供安装、修复、更新和卸载。无需手动复制扩展目录。
5. 完全关闭并重新启动 Photoshop。
6. 打开 **窗口 → 扩展（旧版）→ PS AI Image Hub**。
7. 首次使用时，在设置中选择 Provider，填写自己的 API Key；然后填写提示词，按需选择主图或参考图并生成、预览、导入。
8. 只有安装器无法启动或安装失败时，才运行 `Debug\PSAIHub-Debug.cmd`；诊断窗口会保留退出代码。反馈时请先删除日志中的私人路径和敏感信息。
9. 如果安全策略阻止脚本，将 `Manual\PS-AI-Image-Hub-CEP11-Compat` 整个目录复制到 `%APPDATA%\Adobe\CEP\extensions\PS-AI-Image-Hub-CEP11-Compat`，即可完成无需执行程序的手动安装。
10. 卸载时重新运行 `PSAIHub-Setup.cmd` 并选择“卸载”，也可从 Windows“已安装的应用”中卸载。默认保留本地用户数据，可在卸载提示中选择删除。

公开 ZIP 中的安装启动脚本和完整手动安装目录均可直接检查。Windows 仍可能提示来自互联网的脚本存在风险；请只从本仓库 Release 下载并核对 SHA-256。项目不会要求关闭 Defender、绕过组织安全策略或安装自签名根证书。

## 项目简介

PS AI Image Hub 是 Photoshop 内的通用 AI 图像生成客户端。插件不绑定单一服务商，当前包含 GRS、阿里云百炼和本地 Mock Provider；API Key 由用户自行配置，仓库和 Release 包均不包含任何可用密钥。

## 主要功能

- 一键生成、结果预览、手动或自动导入 Photoshop。
- GRS、阿里云百炼、Mock Provider；Provider 适配层保持独立。
- 主图支持当前画布或当前选区，参考图支持多输入工作流。
- 异步任务、History、原 Task Recovery 与安全的本地停止等待语义。
- 本地提示词预设、组合与快速检索。
- 导入清晰度保护、智能对象放大与 History 再导入对齐。

## Provider 与 API Key

在设置页选择服务商并填写该服务商要求的配置。GRS 与阿里云百炼的 API Key 必须由用户自行申请；请勿把 API Key、Authorization Header、完整请求日志或包含密钥的截图上传到 Issue。

“停止等待”只停止本地轮询。Recovery 只继续查询原始异步 `task_id`，不会重新提交任务；服务商后台任务可能仍继续运行和计费。

## 主图与参考图

主图可来自当前画布或当前选区；参考图按 Provider 能力加入请求。当前选区的目标范围会随任务保存，用于 History 再导入对齐。Provider 对图片数量、尺寸和格式的限制可能不同，请以其官方文档为准。

## 提示词预设

预设系统完全在本地运行，不上传 JSON/ZIP，也不调用 API：

- 支持单个 JSON、ZIP 批量导入、静态预设和参数型预设。
- 支持 `category`、`subCategory`、`refImages`、marker/MODULE 与 `content` 内嵌 JSON。
- 支持分类归一化、中文分类显示、收藏虚拟分类、最近使用和本地搜索。
- 搜索采用缓存索引与 200ms debounce。
- Preset Stack 可排序、启用/禁用，并可 Replace 或 Append 到提示词。
- 导入预设重启后仍保留；用户预设可删除。

ZIP 限制为 10 MB、最多 500 个 JSON、单个 JSON 最多 2 MB。损坏单文件不会阻止其他可用预设导入。

## 收藏、分类与搜索

“收藏”是虚拟筛选项，不会修改预设原始分类。内置预设、JSON 导入预设和 ZIP 导入预设都可收藏；搜索可与分类、收藏、Stack、Replace、Append 组合使用。

## History 与 Recovery

History 保存生成结果、Provider、模型、比例、输入上下文与导入上下文。Recovery 使用原 Provider、原地域和原 Task ID 继续查询，不会执行新的 Submit。History 的“恢复参数”只把参数恢复到生成页，仍需用户主动点击生成。

## Photoshop 导入

生成结果以下载的原始二进制文件进入临时存储。匹配主图区域默认关闭；开启后仅允许缩小，不通过 Canvas 放大。相同尺寸直接使用原图，避免无意义的重编码。

## 智能对象与清晰度保护

- 小图需要放大时，浏览器 Canvas 不会放大重采样，而由 Photoshop 智能对象完成缩放。
- 原图与目标尺寸相同时直接导入原图。
- 原图大于目标区域时可按需缩小。
- 导入前会显示清晰度风险提示；智能对象不能创造原图不存在的细节。
- History 再导入会复用已保存的 `targetBounds`；目标文档尺寸不一致时会提示确认。

## 常见问题

1. **安装后看不到插件？** 完全退出 Photoshop 后重新启动，并确认从“窗口 → 扩展（旧版）”打开。
2. **Photoshop 26.x 能用吗？** 不能。本 Release 只支持 Host 23.x–25.x，请勿在 26.x+ 安装。
3. **可以直接在 ZIP 里运行安装器吗？** 不可以。必须完整解压。
4. **为什么建议短路径？** 可降低 Windows 临时解包、IExpress 和 PowerShell 处理长路径时的失败概率。
5. **导入后仍觉得模糊？** 在 Photoshop 100% 视图检查；若目标区域大于生成图，智能对象只能避免额外 Canvas 画质损失，不能增加原生细节。
6. **History 再导入位置不一致？** 当前文档尺寸或目标上下文可能已变化；按提示确认并检查原文档/选区。
7. **什么时候运行 Debug 启动器？** 仅当普通启动脚本不能启动或安装失败时运行；它会保留退出代码，并在反馈前清理敏感日志。
8. **怎样保护 API Key？** 不提交密钥、不贴 Authorization Header、不共享完整配置或未脱敏日志；如怀疑泄露，立即在服务商后台轮换密钥。

## 开发与源码验证

运行时仅使用 HTML、CSS、JavaScript、CEP 11 和 ES3 兼容 ExtendScript，不启用 Node.js。Node.js 仅用于仓库构建与测试：

```powershell
npm run build:dev
npm run test:targeted
npm run test:regression
npm run scan
npm run verify:formal
```

安装器源码位于 `installer/`，发布包构建位于 `distribution/`。生成目录、日志、用户数据和 Release 二进制不应提交到源码仓库。

## 版本定位

`v1.0.0` 起，多版本 CEP 11 架构是 PS AI Image Hub 的主要公开版本。旧 Formal 工程仅作为业务功能基线，不再作为当前公开下载入口。业务功能同步约束见 [FEATURE-PARITY.md](FEATURE-PARITY.md)。

## 已知限制

- 仅支持 Windows 10/11 与 Photoshop Host 23.x–25.x；不支持 26.x+。
- PS23/PS24 依赖兼容夹具与能力检测，仍建议在对应真实 Photoshop 环境完成验收。
- 云端生成可能产生费用，停止本地等待不等于服务端取消。
- 浏览器网络请求受服务商 CORS、证书和网络策略影响。
- 记住的 API Key 使用 CEP 本地敏感配置文件保存，不是操作系统级加密保险库。
- 智能对象缩放不能创造高于原始生成图的真实细节。

## License

项目自有代码按 [MIT License](LICENSE) 发布。第三方组件的许可与版权见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。

## 问题反馈

提交 Issue 时请提供：插件版本、Windows 版本、Photoshop 完整版本、复现步骤、期望结果、实际结果，以及已脱敏的错误摘要。请勿提交 API Key、Token、Authorization Header、完整服务商配置、用户图片、私人路径或未清理的安装日志。
