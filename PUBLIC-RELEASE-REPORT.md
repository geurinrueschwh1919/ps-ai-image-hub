# PS AI Image Hub v1.0.2 公开发布报告

- 发布准备日期：2026-09-28
- 主公开架构：多版本 CEP 11
- 支持 Host：23.x / 24.x / 25.x
- 不支持：26.x+
- Bundle ID：`com.psai.imagehub.compat.cep11`
- Extension ID：`com.psai.imagehub.compat.cep11.panel`
- Host 范围：`[23.0,26.0)`，`PHSP + PHXS`
- RequiredRuntime：`CSXS 11.0`

## Runtime

- 文件数：85
- 大小：749,716 bytes
- SHA-256：`50c74fb15198ed7a8f22ab84277313113979ea32c485b7465560c7ec329aa672`
- Source / dev staging / Setup payload / Release ZIP Runtime：完全一致
- v1.0.2 业务变化仅包含已经完成人工验证的 Prompt Preset 删除持久化修复。

## 安装器与发布包

- ZIP 内公开安装入口：`PSAIHub-Setup.cmd`
- ZIP 内 Debug 入口：`Debug\PSAIHub-Debug.cmd`
- 手动安装兜底：`Manual\PS-AI-Image-Hub-CEP11-Compat`
- 公开 ZIP 中未包含未签名 EXE；GitHub Release 同时提供独立 EXE 附件。
- `PSAIHub-Setup.exe`：413,696 bytes；SHA-256 `ea35983f33f33b86a58f85081b803a0503f79a9e4feafe86e7f19b4655bd7d0f`
- `PSAIHub-Debug.exe`：413,696 bytes；SHA-256 `d0c281e063f6821b5e0dbd553ce6e759b0e0fabd59c8728f31b69a90271ce86f`
- `PSAIHub-Compat.zip`：464,148 bytes；101 files；解压后 1,031,718 bytes
- ZIP SHA-256：`150c807d524088abeab9e195cfd8da348c311ca68ce41525805a0da2b37d4ff8`

## 验证

- Prompt Preset UI / 删除持久化 targeted：8 passed
- Formal / Compat parity 与兼容 targeted：41 passed
- Full regression：645 passed / 0 failed / 1 skipped
- Installer tests：68 passed
- PowerShell install/repair/update/rollback/uninstall integration：PASS
- Distribution tests：30 passed
- Release ZIP 实际解压与 Prompt Preset UI 检查：PASS
- Release ZIP 删除持久化模拟重启检查：PASS
- CEP integrity：PASS
- Static compatibility：PASS
- PS23 / PS24 / PS25 fixtures：PASS
- Bridge allowlist / client / Host method diff：PASS
- Setup payload / Release ZIP / dev Runtime hash：一致
- Formal baseline：469 files、5,020,952 bytes，SHA-256 `f238bc372fe326cf79e76cad47b4308b097c30d3235e4788a0a4fa48806f18fd`，构建期间未变化
- 公开源码候选与 GitHub Release：0 真实密钥、0 私人路径、0 用户数据/图片/日志

## 发布文件

`github-release/` 只包含：

- `PSAIHub-Setup.exe`
- `PSAIHub-Debug.exe`
- `PSAIHub-Compat.zip`
- `PSAIHub-Compat.sha256.txt`
- `RELEASE_BODY.md`

该目录为本地发布 staging，受 `.gitignore` 排除；源码仓库不提交 Release 二进制。
