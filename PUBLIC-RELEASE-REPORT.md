# PS AI Image Hub v1.0.2 公开发布报告

- 发布准备日期：2026-09-27
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

- 公开安装入口：`PSAIHub-Setup.vbs`（无终端窗口）
- Debug 入口：`Debug\PSAIHub-Debug.cmd`
- 手动安装兜底：`Manual\PS-AI-Image-Hub-CEP11-Compat`
- 公开 ZIP 中未包含未签名 EXE
- 本地 IExpress Setup 构建产物：413,696 bytes；SHA-256 `c833ec295427097c35fbb9194f2d1d55c8d0e5d8350333367488eb492e5b4d1f`
- 本地 IExpress Debug 构建产物：413,696 bytes；SHA-256 `2ff80a3dfad1bce520b4091658645e650d94add36de2a8796ac1b9ddd8467264`
- `PSAIHub-Compat.zip`：463,562 bytes；101 files；解压后 1,024,506 bytes
- ZIP SHA-256：`fb04c16da8e56cb37b5f165f891dff27c861b34ab1b1ce8f4ebd240316b4ce83`

## 验证

- Targeted / parity：40 passed
- Full regression：637 passed / 0 failed / 1 skipped
- Installer targeted tests：39 passed
- PowerShell install/repair/update/rollback/uninstall integration：PASS
- Distribution tests：31 passed（包含 VBS 无终端启动配置、打包完整性与安装器主体启动验证）
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
