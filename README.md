# MC Dev Tools

[![VS Code Marketplace](https://img.shields.io/badge/VS%20Code-Marketplace-blue?logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=dofes.mcdev-tools)

一个用于 MC 开发的一站式 VSCode 工具插件，集成 mcpdb 调试器和 mcdk 启动器。

## 相关项目

- [mcpdb](https://github.com/Dofes/mcpdb) - Minecraft Python 调试器核心
  > mcpdb 正在准备弃用，将更换为更可维护的调试方案以提供更加全面的调试体验。
  
- [mcdk](https://github.com/GitHub-Zero123/MCDevTool) - Modpc 开发测试启动器

## 功能

- 自动查询运行中的 Minecraft 进程
- 支持选择要调试的进程（多开支持）
- 自动检测管理员进程并提示
- 自动分配可用端口
- 一键启动 `mcdbg.exe` 进行附加 Python 调试器核心
- 一键启动 `mcdk.exe` 启动游戏开发测试

## 游戏启动测试

1. 按 `Ctrl+F5` 自动启动**ModPC**开发测试
2. 插件会自动：
   - 搜索系统环境中的**ModPC**包
   - 启动 `mcdk.exe` 进行开发测试

## 调试器使用方法

1. 按 `F5` 选择 "MC Dev Tools Debug" 调试器
2. 插件会自动：
   - 查询运行中的 Minecraft 进程
   - 让你选择要附加的进程
   - 启动 mcdbg 并等待调试后端就绪
   - 连接 python 调试器

## 配置项

在 VS Code 设置中可以配置以下选项：

| 配置项                  | 默认值 | 说明                                           |
| ----------------------- | ------ | ---------------------------------------------- |
| `mcdev-tools.port`      | 5678   | 调试端口号                                     |
| `mcdev-tools.timeout`   | 30000  | 等待超时时间（毫秒）                           |
| `mcdev-tools.mcdbgPath` | (内置) | mcdbg.exe 路径（留空使用插件内置）             |
| `mcdev-tools.mcdkPath`  | (内置) | mcdk.exe 路径（留空使用插件内置）              |
| `mcdev-tools.enable`    | false  | 强制启用插件（默认 false 自动扫描 Addon 结构） |

## 前置要求

- 安装 [Python](https://marketplace.visualstudio.com/items?itemName=ms-python.python) 扩展
- mcdbg.exe（插件内置或从 [mcpdb](https://github.com/Dofes/mcpdb) 获取）
- mcdk.exe（插件内置或从 [mcdk](https://github.com/GitHub-Zero123/MCDevTool) 获取）

## 贡献者

感谢所有为本项目做出贡献的开发者！

- **[Dofes](https://github.com/Dofes)**
- **[Zero123](https://github.com/GitHub-Zero123)**
