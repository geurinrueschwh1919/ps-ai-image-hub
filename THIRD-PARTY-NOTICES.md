# 第三方软件声明

PS AI Image Hub 的 MIT License 只覆盖项目自有代码。下列第三方组件继续受其各自许可与版权声明约束。

## fflate 0.8.2

- 用途：本地 ZIP 预设包解压。
- 许可：MIT License。
- 来源：https://github.com/101arrowz/fflate
- 分发文件：`client/lib/fflate.min.js`、`client/lib/fflate.LICENSE.txt`。
- 修改情况：以压缩后的上游构建文件随插件分发，项目未声明其为自有代码。
- Copyright：Copyright (c) 2023 Arjun Barrett。

完整许可文本保存在 `source/PS-AI-Image-Hub-CEP11-Compat/client/lib/fflate.LICENSE.txt`，并随运行时与安装包一起分发。

## Adobe CEP 接口兼容适配

`client/lib/CSInterface.js` 是本项目为实际使用到的 CEP 接口编写的轻量适配器，并非捆绑的 Adobe 完整 CSInterface 库。Adobe、Photoshop 与 CEP 名称及商标归其权利人所有；本项目未获得 Adobe 官方背书。
