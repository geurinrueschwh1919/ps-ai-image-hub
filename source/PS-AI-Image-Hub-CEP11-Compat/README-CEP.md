# CEP 11 运行时说明

该目录包含 PS AI Image Hub 的 CEP 11 运行时源码、离线测试与校验脚本。用户安装、功能、限制与安全说明统一维护在仓库根目录 [README.md](../../README.md)，不再维护独立英文 README。

## 稳定身份

- Bundle ID：`com.psai.imagehub.compat.cep11`
- Extension ID：`com.psai.imagehub.compat.cep11.panel`
- Host：`PHSP + PHXS`
- Host 范围：`[23.0,26.0)`
- RequiredRuntime：`CSXS 11.0`
- 安装目录名：`PS-AI-Image-Hub-CEP11-Compat`

以上标识与兼容范围不得因显示名称调整而改变。

## 本地验证

```powershell
npm run check
npm test
```

测试使用 Mock 与本地 fixture，不调用 GRS、阿里云百炼或其他收费 API。

