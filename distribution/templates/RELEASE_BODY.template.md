# PS AI Image Hub v1.1.0

Photoshop CEP 插件稳定更新，沿用 CMD 安装方式。

## 下载与安装

下载 **PSAIHub-Compat.zip**，完整解压后双击 **PSAIHub-Setup.cmd**。不要在 ZIP 内直接运行，不要只复制 CMD；Installer 文件夹必须保留在旁边。排查启动问题可使用 Debug/PSAIHub-Debug.cmd，手动安装文件位于 Manual。

PSAIHub-Compat.sha256.txt 用于校验 ZIP。GitHub 自动生成的 Source code 是源码包，普通用户请下载 PSAIHub-Compat.zip。

## 更新内容

- 自动清晰化默认关闭，支持微锐化、自然、标准、强力和自定义；保留原始生成层，支持局部边缘保护。
- History 支持 50/100/200/500 条普通历史，默认 100；收藏保护、分页缩略图，重新导入使用原图。
- 面板常驻，支持主动重新加载插件界面。
- 生成按钮移到提示词下方；高级设置和结果预览按需展开。
- 设置分区折叠，版本信息移到设置底部，保存提示自动消失。
- 删除生成图层后可从结果预览重新导入，清晰化按文档和图层 ID 定位。
- 内置 10 个超清修复提示词预设，可隐藏并手动恢复；预设轨道最大值显示修复。
- 保留 PNG/JPEG 导入和自定义第三方 API Provider；更新百炼共享／专属 API Host 配置流程。
- 不包含特效实验室、辉光或 Auto Color Fusion。

## 兼容与升级

Windows 10/11；Photoshop 25.0 已经用户实机验证。Photoshop 23.x、24.x 为静态和模拟兼容，未完成对应版本实机验证。25.0–25.11 为当前 CEP 11 声明范围；25.12+ 属于 CEP 12 边界，未声明验证通过。Photoshop 26.x 及更高版本不支持。

沿用正式 Compat Extension ID、存储键和 PSAIImageHubCompat 数据目录，保留已有 API 服务、密钥、预设和历史；不会读取实验版数据。升级前建议自行备份本机插件数据。API 调用可能由服务商收费，插件不内置模型或免费额度。

## 校验

ZIP SHA-256：

{{ZIP_SHA256}}
