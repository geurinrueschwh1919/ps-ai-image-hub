# PS AI Image Hub — 功能同步基线

## 基线

- Formal 业务基线：`adobe-photoshop-uxp-ps-ai-image`，版本 `0.1.0 Stable`。
- 当前公开 Release 基线：多版本 CEP 11，版本 `1.0.0`。
- 同步日期：`2026-09-26`。
- 当前状态：`0 FORMAL_ONLY`、`0 NEED_SYNC`。
- 规则：Formal 出现新的业务功能时，本文件必须先标记 `SYNC REQUIRED`；完成 Compat 移植与全部验证后，才可改为 `SAME` 或 `DIFFERENT_IMPLEMENTATION`。

## 功能矩阵

| 功能 | Formal | CEP11 Release | 状态 |
|---|---|---|---|
| Generate / Settings / History | 已实现 | 同等业务行为 | DIFFERENT_IMPLEMENTATION |
| 原任务 Recovery | 已实现 | 同等语义，兼容存储回退 | DIFFERENT_IMPLEMENTATION |
| GRS / Bailian / Mock | 已实现 | 同 Provider 业务实现 | SAME |
| Main / References / 当前选区 | 已实现 | 能力检测与兼容文件对话框 | DIFFERENT_IMPLEMENTATION |
| JSON / ZIP Preset Import | 已实现 | 同扫描、限制、冲突与持久化规则 | DIFFERENT_IMPLEMENTATION |
| 分类归一化与中文显示 | 已实现 | 同 schema 与显示映射 | SAME |
| 收藏 / 最近使用 / 搜索 | 已实现 | 同虚拟分类、索引与 200ms debounce | SAME |
| Preset Stack / Replace / Append | 已实现 | 同编译与应用行为 | SAME |
| Photoshop Import | 已实现 | 经严格 Bridge allowlist | DIFFERENT_IMPLEMENTATION |
| 禁止 Canvas upscale | 已实现 | 同决策规则 | SAME |
| Smart Object upscale / 清晰度预警 | 已实现 | 经 ES3 Host 兼容层 | DIFFERENT_IMPLEMENTATION |
| History re-import / targetBounds / 文档差异提示 | 已实现 | 同数据结构与行为 | SAME |
| Import diagnostics | 已实现 | 同安全诊断字段 | SAME |
| API Key / History / 用户预设持久化 | 已实现 | 同 schema，增加兼容存储回退 | DIFFERENT_IMPLEMENTATION |

## 必须保持同步的业务模块

- `client/js/generation/`
- `client/js/providers/`
- `client/js/presets/`
- `client/js/ui/` 的业务行为
- `client/js/storage/historyStore.js`
- `client/js/photoshop/importSizingManager.js`
- `client/js/photoshop/imageImporter.js`
- i18n key、History metadata、import context、diagnostics、favorite、category 与 search index schema

## 允许不同的 Compat 模块

- PS23 / PS24 / PS25 Host profiles 与夹具
- `PHSP + PHXS` Host 声明
- Host capability detection 与 BOOT compatibility report
- Bridge strict allowlist 与 `getHostCapabilities`
- ES3 ExtendScript Host
- XHR / fetch fallback
- MemoryStore fallback
- Compat file dialog
- 独立 ID、存储 namespace 与数据根目录
- 独立 Installer、CEP Root Detection 与 UAC
- 旧 CEF CSS fallback

这些差异只能位于兼容 adapter、Host 或 Installer 层，不能改变 Provider、Preset、History、Recovery、Import 等业务结果。

## 同步流程

1. 在矩阵中新增 `SYNC REQUIRED` 行。
2. 先比较两边业务行为，不整目录覆盖。
3. 通过既有 Compat adapter 移植。
4. 运行 parity、targeted、full regression、static scan、PS23/24/25 fixture、Bridge allowlist、Installer、Distribution、Runtime hash 与公开发布审计。
5. 验证通过后更新状态和同步日期。
