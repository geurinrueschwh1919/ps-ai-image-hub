# PS AI Image Hub 自动安装器

该子项目把 `outputs/dev/PS-AI-Image-Hub-CEP11-Compat` 打包为 Windows 安装器。安装器使用 Windows 自带的 IExpress 与 Windows PowerShell 5.1，不捆绑 Node、Python、Electron 或额外 .NET Runtime。

## 功能

- 检测 Photoshop 与 CSXS。
- 检测系统 x86、系统 x64、当前用户三个 CEP 根目录。
- 支持安装、修复、更新、事务备份与回滚。
- 安装前后校验运行时 SHA-256。
- 保护其他扩展目录，不自动删除重复安装。
- 写入标准 HKCU“已安装的应用”卸载项。
- 仅在用户明确勾选后写入已存在的 `PlayerDebugMode`。
- 系统目录写入按需触发标准 UAC。

## 构建与测试

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-installer.ps1
node --test tests\*.test.js
powershell -NoProfile -ExecutionPolicy Bypass -File tests\powershell-integration.ps1
```

普通安装器与 Debug 安装器生成到 `installer/dist/`。若要直接调试解包后的 PowerShell 入口，可运行：

```powershell
powershell.exe -NoExit -NoProfile -ExecutionPolicy Bypass -File "<project-root>\installer\build\package\install.ps1"
```

## 安全边界

- Runtime 只安装到用户确认的 CEP Root 下 `PS-AI-Image-Hub-CEP11-Compat` 目录。
- 用户数据在更新、修复和默认卸载流程中保留。
- 安装日志位于 `%LOCALAPPDATA%\PSAIImageHubCompatInstaller\logs`，不可随源码或 Release 发布。
- 安装器不会启动 Photoshop，也不会修改 Provider 配置或 API Key。

