# PS AI Image Hub v1.0.3 本地发布候选报告

- 候选构建时间（北京时间）：2026-10-03 00:35
- 主公开架构：多版本 CEP 11
- 支持 Host：23.x / 24.x / 25.x
- 不支持：26.x+
- Bundle ID：`com.psai.imagehub.compat.cep11`
- Extension ID：`com.psai.imagehub.compat.cep11.panel`
- Storage namespace：`ps-ai-image-hub.compat.cep11`
- USER_DATA 根目录：`PSAIImageHubCompat`
- Host 范围：`[23.0,26.0)`，`PHSP + PHXS`
- RequiredRuntime：`CSXS 11.0`
- 人工验收：`V1.0.3-JPEG-MANUAL-TEST-PASSED`
- CMD 发布候选人工验收：`V1.0.3-CMD-PACKAGE-MANUAL-TEST-PASSED`

## CMD 发布候选人工验收

- CMD 完整解压：PASS
- v1.0.2 → v1.0.3 升级：PASS
- API Key 和配置保留：PASS
- Prompt Preset 和 History 保留：PASS
- PNG 生成与导入：PASS
- GRS `nano-banana-fast` JPEG 生成与导入：PASS
- JPEG History 重新导入：PASS
- CMD 修复入口：PASS
- Debug CMD 入口：PASS
- 无公开 EXE：PASS
- 无 Auto Sharpen 实验功能：PASS

## Runtime

- 文件数：85
- 大小：758,521 bytes
- Tree SHA-256：`dc306b2902163c0071c43d32dbf481198c46235790033673a717800c35804e45`
- Runtime source selection / dev staging / Installer build Runtime / CMD payload / Release ZIP Manual Runtime / Release ZIP Installer payload：完全一致
- `runtime-hashes.json`：85 项，0 mismatch
- JPEG 修复、正确的 ExtendScript `File.seek()` 语义、PNG/JPEG Host 校验和新错误文案均已进入所有实际 Runtime 副本。
- Auto Sharpen 实验代码、实验 Extension ID、实验 namespace 与实验 USER_DATA 路径：均不存在。

## 安装器与发布包

- 公开安装入口：`PSAIHub-Setup.cmd`；SHA-256 `48026791a648b00b2f7d5d5ccd627254ade87718dc46b71a622f2db940f4d1aa`
- 调试入口：`Debug/PSAIHub-Debug.cmd`；SHA-256 `a34b65c90aa6513999b3fa3909dcbea4670ffa46cba920f5d1fab86160ce810e`
- CMD 调用：同包 `Installer/install.ps1`，并使用 `Installer/payload.zip`、`metadata.json` 与 `runtime-hashes.json`。
- `Installer/payload.zip`：219,749 bytes；SHA-256 `c0591333a5099c5e0c952805feed5e1e58db907a7a19d7c93a858991c5577c47`
- `PSAIHub-Compat.zip`：467,273 bytes；101 files；解压后 1,041,987 bytes
- ZIP SHA-256：`349d85c7dde54e6af190c24b3a6569afa30ae1189fb6412b0a050381308b059d`
- `PSAIHub-Compat.sha256.txt`：85 bytes；SHA-256 `9c213810cc26e24eeb5a701727c3d9e8f0dec5ca9d1eaefca58d390adc4bb2ee`；内容与实际 ZIP 一致。
- `RELEASE_BODY.md`：3,956 bytes；SHA-256 `e764d5863892104984678b92101a785ed121f1474a255e0a9b0e9098c40bff65`
- 本轮构建未调用 IExpress，最终 `github-release` 不包含 `PSAIHub-Setup.exe` 或 `PSAIHub-Debug.exe`。

## 验证

- Runtime full regression：661 total / 660 passed / 0 failed / 1 skipped
- Root targeted / parity：42 passed / 0 failed
- Installer：68 passed / 0 failed
- Distribution：30 passed / 0 failed
- 统一去重总数：801 total / 800 passed / 0 failed / 1 skipped
- JPEG / Provider targeted：67 passed（属于 Runtime 661 的重复专项执行，不重复计入 801）
- v1.0.2 → v1.0.3 更新模拟：PASS
- 安装、修复、更新、回滚、卸载与正式/Compat 隔离：PASS
- 中文、空格与 Unicode 路径：PASS
- Static compatibility scan：PASS
- CEP / Host / Manifest integrity：PASS
- Source / Staging：PASS
- Source / Installer payload：PASS
- Source / Release ZIP Runtime：PASS
- CMD payload / Manual Runtime / ZIP Runtime 一致性：PASS
- Release ZIP 实际解压检查：PASS
- 公开源码与发布产物敏感信息扫描：0 secrets、0 personal paths、0 user data
- 正式基准项目：469 files、5,020,952 bytes，SHA-256 `f238bc372fe326cf79e76cad47b4308b097c30d3235e4788a0a4fa48806f18fd`，构建期间未变化

## v1.0.3 范围

- 支持经过安全校验的 PNG/JPEG 原始结果导入 Photoshop。
- 修复 GRS `nano-banana-fast` JPEG 生成成功但无法导入的问题。
- 支持 JPEG History 原图保存、重新导入及失败 History 的有效结果重新下载。
- 拒绝 Content-Type、扩展名和 Magic Bytes 不一致以及 HTML、WebP、损坏或伪装文件。
- JPEG 不经过 Canvas 重编码；PNG 行为保持不变。
- Auto Sharpen 实验功能不包含在 v1.0.3 中。
- WebP 与 AVIF 当前仍不支持。
- Photoshop 23/24 仅完成静态和模拟兼容，未声明对应版本实机验证通过。

## 发布文件

`github-release/` 只包含：

- `PSAIHub-Compat.zip`
- `PSAIHub-Compat.sha256.txt`
- `RELEASE_BODY.md`

ZIP 内的公开入口保持 v1.0.2 结构：根目录 `PSAIHub-Setup.cmd`、`Debug/PSAIHub-Debug.cmd`、`Installer/` 支持文件与 `Manual/` 手动安装 Runtime。没有单独卸载 CMD；安装、更新、修复、回滚和卸载均由 `Installer/install.ps1` 的安装器界面处理。系统 CEP Root 需要标准 UAC，用户 CEP Root 不需要管理员权限。

该目录是本地候选 staging，受 `.gitignore` 排除。本轮未提交、未 Push、未创建 Tag、未创建 GitHub Release、未上传或覆盖任何 v1.0.2 附件。

状态：`READY-FOR-V1.0.3-CMD-PACKAGE-MANUAL-TEST`
