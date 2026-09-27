# PS AI Image Hub v1.0.1 公开发布报告

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

- 公开安装入口：`PSAIHub-Setup.cmd`
- Debug 入口：`Debug\PSAIHub-Debug.cmd`
- 手动安装兜底：`Manual\PS-AI-Image-Hub-CEP11-Compat`
- 公开 ZIP 中未包含未签名 EXE
- 本地 IExpress Setup 构建产物：413,696 bytes；SHA-256 `07e7b116fd5b470516ad60238ef6debd6175ba22d24a7dd689f13cb86aa3701d`
- 本地 IExpress Debug 构建产物：413,696 bytes；SHA-256 `983e8028bd01e89acb53f7310bbbc42d73474da5b0f43ffe28c4c01a6de5325c`
- `PSAIHub-Compat.zip`：463,029 bytes；105 entries；解压后 1,023,357 bytes
- ZIP SHA-256：`87776552b8f0c0c05bed7bd1a507f0732da78959da279a0d57f0f61c60d4471a`

## 验证

- Targeted / parity：40 passed
- Full regression：637 passed / 0 failed / 1 skipped
- Installer targeted tests：38 passed
- PowerShell install/repair/update/rollback/uninstall integration：PASS
- Distribution tests：30 passed（包含从解压后 ZIP 经 `PSAIHub-Setup.cmd` 到安装器主体的真实启动链）
- CEP integrity：PASS
- Static compatibility：PASS
- PS23 / PS24 / PS25 fixtures：PASS
- Bridge allowlist / client / Host method diff：PASS
- Formal baseline：468 files、5,003,103 bytes，SHA-256 `ae06e989134bd56cc51f0f4678e030d34ccbd8a5279b977d067830b065dd68c9`，未变化
- 公开源码候选（205 files）与 GitHub Release：0 真实密钥、0 私人路径、0 用户数据/图片/日志

## 发布文件

`github-release/` 只包含：

- `PSAIHub-Compat.zip`
- `PSAIHub-Compat.sha256.txt`
- `RELEASE_BODY.md`

该目录为本地发布 staging，受 `.gitignore` 排除；源码仓库不提交 Release 二进制。
