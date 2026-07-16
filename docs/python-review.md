# python-review
## 基本用法：
& ".\build\x64-msvc-release\tools\mcdk-python-review\mcdk-python-review.exe" `
  "D:\目标Addon路径" `
  --output "D:\报告目录\python-review.md"
实际项目示例：
& ".\build\x64-msvc-release\tools\mcdk-python-review\mcdk-python-review.exe" `
  "D:\Zero123\CPP\CMAKE\mcdk-assistant\temp_ref\KIDAnimOptUltraX" `
  --format markdown `
  --output "D:\Zero123\CPP\CMAKE\mcdk-assistant\.codex_tmp\KIDAnimOptUltraX-review.md"
参数说明：
参数	作用
第一个位置参数	要审查的行为包或 addon 根目录
--output <文件> / -o <文件>	报告落盘文件路径
--format markdown	人工阅读报告，也是 CLI 默认格式
--format summary	终端紧凑摘要
--format json	机器读取的完整结果
--scope pkg/module	只审查指定包或模块，多个范围用逗号分隔
--include-third-party	同时审查 QuModLibs
--config <toml>	指定审查配置文件
--max-per-rule <n>	每条规则最多展示多少处，0 表示不限

中文和空格路径需要整体加引号。
落盘路径行为
不传 --output：不会自动生成报告文件，只输出到终端 stdout。
文件不存在但父目录存在：会自动创建文件。
文件已经存在：会覆盖原文件。
父目录不存在：不会自动创建目录，CLI 输出“无法写入”并返回退出码 1。
使用相对落盘路径：文件生成在当前工作目录下。
因此建议先创建报告目录