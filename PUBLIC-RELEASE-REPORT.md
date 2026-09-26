# PS AI Image Hub v1.0.0 公开发布报告

- 发布准备日期：2026-09-26
- 主公开架构：多版本 CEP 11
- 支持 Host：23.x / 24.x / 25.x
- 不支持：26.x+
- Bundle ID：`com.psai.imagehub.compat.cep11`
- Extension ID：`com.psai.imagehub.compat.cep11.panel`
- Host 范围：`[23.0,26.0)`，`PHSP + PHXS`
- RequiredRuntime：`CSXS 11.0`

## Runtime

- 文件数：85
- 大小：743,575 bytes
- SHA-256：`a11df3ff65e6be204c4664d17d9fa6cfec6506c418110d344ead87db50053f78`
- Source / staging：一致
- 与上一内部基线不同的原因：只调整 `v1.0.0` 版本、产品显示名称与 CEP 启动诊断版本；未修改业务逻辑。

## 安装器与发布包

- Setup：413,696 bytes
- Setup SHA-256：`bcb26cf6568c9d8fd3af1ca6ebd31de94a444e83b8ce13d8f70d4d67289ed844`
- Debug SHA-256：`9b892ced860b01fd136d2f5efbbd15dc1fe204b72223c551b083944eb9620b48`
- `PSAIHub-Compat.zip`：673,859 bytes
- ZIP SHA-256：`c0a23b8a3d51293ec6a5648efaffe60b2cfe05b5469df7ec2b91753ce55981a1`

## 验证

- Targeted / parity：40 passed
- Full regression：637 passed / 0 failed / 1 skipped
- Installer JavaScript tests：67 passed
- PowerShell install/repair/update/rollback/uninstall integration：PASS
- Distribution tests：27 passed
- CEP integrity：PASS
- Static compatibility：PASS
- PS23 / PS24 / PS25 fixtures：PASS
- Bridge allowlist / client / Host method diff：PASS
- Formal baseline：468 files、5,003,103 bytes，SHA-256 `ae06e989134bd56cc51f0f4678e030d34ccbd8a5279b977d067830b065dd68c9`，未变化
- 公开源码候选与 GitHub Release：0 真实密钥、0 私人路径、0 用户数据/图片/日志

## 发布文件

`github-release/` 只包含：

- `PSAIHub-Compat.zip`
- `PSAIHub-Compat.sha256.txt`
- `RELEASE_BODY.md`

该目录为本地发布 staging，受 `.gitignore` 排除；源码仓库不提交 Release 二进制。
