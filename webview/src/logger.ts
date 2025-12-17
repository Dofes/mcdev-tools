import { vscode } from './vscode';

/**
 * 日志工具 - 将日志同时输出到控制台和转发到扩展调试控制台
 */
class Logger {
  private sendToExtension(level: string, ...args: any[]) {
    try {
      vscode.postMessage({
        type: 'log',
        level,
        args: args.map(arg => 
          typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
        )
      });
    } catch (e) {
      // 忽略发送失败
    }
  }

  log(...args: any[]) {
    console.log(...args);
    this.sendToExtension('log', ...args);
  }

  warn(...args: any[]) {
    console.warn(...args);
    this.sendToExtension('warn', ...args);
  }

  error(...args: any[]) {
    console.error(...args);
    this.sendToExtension('error', ...args);
  }

  info(...args: any[]) {
    console.info(...args);
    this.sendToExtension('log', ...args);
  }
}

export const logger = new Logger();
