# Minecraft ModPC Debug

一个用于 Minecraft ModPC 调试的 VS Code 插件。

## 相关项目

- [mcpdb](https://github.com/Dofes/mcpdb) - Minecraft Python 调试器核心

## 功能

- 自动查询运行中的 Minecraft 进程
- 支持选择要调试的进程（多开支持）
- 自动检测管理员进程并提示
- 自动分配可用端口
- 一键启动 `mcdbg.exe` 进行附加 Python 调试器核心

## 使用方法

1. 按 `F5` 选择 "Minecraft ModPC Debug" 调试器
2. 插件会自动：
   - 查询运行中的 Minecraft 进程
   - 让你选择要附加的进程
   - 启动 mcdbg 并等待调试后端就绪
   - 连接 python 调试器

## 配置项

在 VS Code 设置中可以配置以下选项：

| 配置项                            | 默认值 | 说明                               |
| --------------------------------- | ------ | ---------------------------------- |
| `minecraft-modpc-debug.port`      | 5678   | 调试端口号                         |
| `minecraft-modpc-debug.timeout`   | 30000  | 等待超时时间（毫秒）               |
| `minecraft-modpc-debug.mcdbgPath` | (内置) | mcdbg.exe 路径（留空使用插件内置） |

## 前置要求

- 安装 [Python](https://marketplace.visualstudio.com/items?itemName=ms-python.python) 扩展
- mcdbg.exe（插件内置或从 [mcpdb](https://github.com/Dofes/mcpdb) 获取）

## 开发

```bash
# 安装依赖
npm install

# 编译
npm run compile

# 监听模式
npm run watch
```

按 F5 启动调试模式测试插件。
