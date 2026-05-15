import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as jsonc from "jsonc-parser";
import { getNonce } from "../utils";

/**
 * 侧边栏 Webview 提供者，用于可视化编辑 .mcdev.json
 */
export class McDevToolsSidebarProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _fileWatcher?: vscode.FileSystemWatcher;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    try {
      console.log("McDevToolsSidebarProvider.resolveWebviewView called");
      this._view = webviewView;
      const webview = webviewView.webview;

      const roots: vscode.Uri[] = [this._extensionUri];
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (workspaceFolder) {
        roots.push(workspaceFolder.uri);

        // 允许预览与工作区同一磁盘根目录下的本地图片
        try {
          const parsed = path.parse(workspaceFolder.uri.fsPath);
          if (parsed.root) {
            roots.push(vscode.Uri.file(parsed.root));
          }
        } catch {
          // ignore
        }
      }

      webview.options = {
        enableScripts: true,
        localResourceRoots: roots,
      };

      webviewView.webview.html = this.getHtmlForWebview(webview);

      // 立即通知前端已注册
      try {
        webview.postMessage({ type: "providerRegistered" });
      } catch (e) {
        console.error("postMessage(providerRegistered) failed", e);
      }

      this.setupMessageHandler(webview);
      this.setupFileWatcher(webview);

      // Clean up watcher when view is disposed
      webviewView.onDidDispose(() => {
        if (this._fileWatcher) {
          this._fileWatcher.dispose();
        }
      });
    } catch (err) {
      console.error("resolveWebviewView top-level error", err);
    }
  }

  /**
   * 设置消息处理器
   */
  private setupMessageHandler(webview: vscode.Webview): void {
    webview.onDidReceiveMessage(async (msg) => {
      if (msg?.type === "ready") {
        await this.handleReady(webview);
      } else if (msg?.type === "save") {
        await this.handleSave(msg.content);
      } else if (msg?.type === "browseFolder") {
        await this.handleBrowseFolder(webview, msg.index);
      } else if (msg?.type === "browseSkin") {
        await this.handleBrowseSkin(webview);
      } else if (msg?.type === "updateSkinPreview") {
        await this.handleUpdateSkinPreview(webview, msg.path);
      } else if (msg?.type === "runGame") {
        await vscode.commands.executeCommand("mcdev-tools.runGame");
      } else if (msg?.type === "startDebug") {
        await vscode.commands.executeCommand("mcdev-tools.startDebug");
      } else if (msg?.type === "browseGameExecutable") {
        await this.handleBrowseGameExecutable(webview, msg.currentPath);
      } else if (msg?.type === "openExternal") {
        await this.handleOpenExternal(msg.url);
      } else if (msg?.type === "listWorlds") {
        await this.handleListWorlds(webview);
      } else if (msg?.type === "deleteWorld") {
        await this.handleDeleteWorld(
          webview,
          msg.folderName,
          msg.displayName,
          msg.isCurrent,
        );
      } else if (msg?.type === "deleteWorlds") {
        await this.handleDeleteWorlds(webview, msg.worlds);
      } else if (msg?.type === "renameWorld") {
        await this.handleRenameWorld(webview, msg.folderName, msg.newName);
      } else if (msg?.type === "copyWorld") {
        await this.handleCopyWorld(webview, msg.folderName);
      } else if (msg?.type === "log") {
        const prefix = `[Webview ${msg.level || "log"}]`;
        if (msg.level === "error") {
          console.error(prefix, ...msg.args);
        } else if (msg.level === "warn") {
          console.warn(prefix, ...msg.args);
        } else {
          console.log(prefix, ...msg.args);
        }
      }
    });
  }

  /**
   * 处理 ready 消息
   */
  private async handleReady(webview: vscode.Webview): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const language = vscode.env.language; // 获取 VS Code 语言设置

    if (!workspaceFolder) {
      webview.postMessage({ type: "init", content: "{}", language });
      return;
    }

    const mcdevPath = path.join(workspaceFolder.uri.fsPath, ".mcdev.json");
    try {
      if (fs.existsSync(mcdevPath)) {
        const content = fs.readFileSync(mcdevPath, "utf8");
        const parsed = jsonc.parse(content) || {};
        const jsonContent = JSON.stringify(parsed);

        let skinPreviewUri: string | undefined;
        const skinPath = parsed?.skin_info?.skin as string | undefined;
        if (skinPath && skinPath.trim()) {
          let filePath = skinPath;
          if (!path.isAbsolute(filePath)) {
            filePath = path.join(workspaceFolder.uri.fsPath, filePath);
          }
          const fileUri = vscode.Uri.file(filePath);
          skinPreviewUri = webview.asWebviewUri(fileUri).toString();
        }

        webview.postMessage({
          type: "init",
          content: jsonContent,
          language,
          skinPreviewUri,
        });
      } else {
        // 文件不存在时，发送空配置并标记需要初始化
        webview.postMessage({
          type: "init",
          content: "{}",
          needsInitialSave: true,
          language,
        });
      }
    } catch (e) {
      webview.postMessage({
        type: "init",
        content: "{}",
        error: String(e),
        language,
      });
    }
  }

  /**
   * 处理 save 消息
   */
  private async handleSave(content: string): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showErrorMessage("请先打开工作区以保存 .mcdev.json");
      return;
    }
    const mcdevPath = path.join(workspaceFolder.uri.fsPath, ".mcdev.json");
    try {
      fs.writeFileSync(mcdevPath, content, "utf8");
      vscode.window.showInformationMessage(".mcdev.json 已保存");
    } catch (e) {
      vscode.window.showErrorMessage(`保存 .mcdev.json 失败: ${e}`);
    }
  }

  /**
   * 处理 browseFolder 消息
   */
  private async handleBrowseFolder(
    webview: vscode.Webview,
    index: number,
  ): Promise<void> {
    const result = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: "选择 MOD 目录",
      title: "选择 MOD 目录",
    });
    if (result && result.length > 0) {
      webview.postMessage({
        type: "folderSelected",
        index: index,
        path: result[0].fsPath,
      });
    }
  }

  /**
   * 处理皮肤文件选择
   */
  private async handleBrowseSkin(webview: vscode.Webview): Promise<void> {
    const result = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      openLabel: "选择皮肤 PNG 文件",
      title: "选择皮肤 PNG 文件",
      filters: {
        "PNG Images": ["png"],
        "All Files": ["*"],
      },
    });

    if (result && result.length > 0) {
      const fileUri = result[0];
      const webviewUri = webview.asWebviewUri(fileUri);

      webview.postMessage({
        type: "skinSelected",
        path: fileUri.fsPath,
        previewUri: webviewUri.toString(),
      });
    }
  }

  /**
   * 根据给定路径更新皮肤预览（不修改配置文件）
   */
  private async handleUpdateSkinPreview(
    webview: vscode.Webview,
    skinPath: string | undefined,
  ): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return;
    }

    if (!skinPath || !skinPath.trim()) {
      webview.postMessage({ type: "skinPreview", previewUri: undefined });
      return;
    }

    try {
      let filePath = skinPath;
      if (!path.isAbsolute(filePath)) {
        filePath = path.join(workspaceFolder.uri.fsPath, filePath);
      }
      const fileUri = vscode.Uri.file(filePath);
      const webviewUri = webview.asWebviewUri(fileUri);
      webview.postMessage({
        type: "skinPreview",
        previewUri: webviewUri.toString(),
      });
    } catch (e) {
      console.error("Failed to build skin preview URI:", e);
      webview.postMessage({ type: "skinPreview", previewUri: undefined });
    }
  }

  /**
   * 处理浏览游戏可执行文件路径
   */
  private async handleBrowseGameExecutable(
    webview: vscode.Webview,
    currentPath?: string,
  ): Promise<void> {
    let defaultUri: vscode.Uri | undefined;
    if (currentPath && currentPath.trim()) {
      try {
        const parentDir = path.dirname(currentPath.trim());
        if (parentDir && fs.existsSync(parentDir)) {
          defaultUri = vscode.Uri.file(parentDir);
        }
      } catch {
        // ignore invalid path
      }
    }

    const result = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      defaultUri,
      openLabel: "选择 Minecraft 可执行文件",
      title: "选择 Minecraft.Windows.exe",
      filters: {
        Executable: ["exe"],
        "All Files": ["*"],
      },
    });

    if (result && result.length > 0) {
      webview.postMessage({
        type: "gameExecutableSelected",
        path: result[0].fsPath,
      });
    }
  }

  /**
   * 打开外部链接
   */
  private async handleOpenExternal(url: string | undefined): Promise<void> {
    if (!url || typeof url !== "string") {
      return;
    }

    const uri = vscode.Uri.parse(url);
    if (uri.scheme === "https" || uri.scheme === "http") {
      await vscode.env.openExternal(uri);
    }
  }

  /**
   * 获取 minecraftWorlds 根目录
   */
  private getWorldsBasePath(): string {
    const appdata = process.env.APPDATA;
    if (!appdata) {
      throw new Error("APPDATA environment variable is not set");
    }
    return path.join(appdata, "MinecraftPE_Netease", "minecraftWorlds");
  }

  private getDirSize(dirPath: string): number {
    let total = 0;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        total += this.getDirSize(full);
      } else {
        try {
          total += fs.statSync(full).size;
        } catch {
          // ignore
        }
      }
    }
    return total;
  }

  /**
   * 列出所有世界存档
   */
  private async handleListWorlds(webview: vscode.Webview): Promise<void> {
    try {
      const worldsDir = this.getWorldsBasePath();
      if (!fs.existsSync(worldsDir)) {
        webview.postMessage({ type: "worldsList", worlds: [] });
        return;
      }

      const entries = fs.readdirSync(worldsDir, { withFileTypes: true });
      const worlds: Array<{
        folderName: string;
        displayName: string;
        lastModified: number;
        size: number;
      }> = [];

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }
        const worldPath = path.join(worldsDir, entry.name);
        const levelDat = path.join(worldPath, "level.dat");
        if (!fs.existsSync(levelDat)) {
          continue;
        }

        let displayName = entry.name;
        const levelNameFile = path.join(worldPath, "levelname.txt");
        try {
          if (fs.existsSync(levelNameFile)) {
            const name = fs.readFileSync(levelNameFile, "utf8").trim();
            if (name) {
              displayName = name;
            }
          }
        } catch {
          // fall back to folder name
        }

        let lastModified = 0;
        try {
          const stat = fs.statSync(levelDat);
          lastModified = stat.mtimeMs;
        } catch {
          // ignore
        }

        let size = 0;
        try {
          size = this.getDirSize(worldPath);
        } catch {
          // ignore
        }

        worlds.push({
          folderName: entry.name,
          displayName,
          lastModified,
          size,
        });
      }

      webview.postMessage({ type: "worldsList", worlds });

      // Clean up stale world_rules entries
      this.cleanupWorldRules(worlds.map((w) => w.folderName));
    } catch (e) {
      console.error("Failed to list worlds:", e);
      webview.postMessage({ type: "worldsListError", error: String(e) });
    }
  }

  /**
   * 清理 .mcdev.json 中 world_rules 里已不存在的世界条目
   */
  private cleanupWorldRules(existingFolders: string[]): void {
    try {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) return;

      const mcdevPath = path.join(workspaceFolder.uri.fsPath, ".mcdev.json");
      if (!fs.existsSync(mcdevPath)) return;

      const content = fs.readFileSync(mcdevPath, "utf8");
      const parsed = jsonc.parse(content) || {};
      const worldRules = parsed.world_rules;
      if (!worldRules || typeof worldRules !== "object") return;

      const folderSet = new Set(existingFolders);
      let changed = false;
      for (const key of Object.keys(worldRules)) {
        if (!folderSet.has(key)) {
          delete worldRules[key];
          changed = true;
        }
      }

      if (changed) {
        parsed.world_rules = worldRules;
        fs.writeFileSync(mcdevPath, JSON.stringify(parsed, null, 4), "utf8");
      }
    } catch (e) {
      console.error("Failed to cleanup world_rules:", e);
    }
  }

  /**
   * 删除指定世界存档（带二次确认）
   */
  private async handleDeleteWorld(
    webview: vscode.Webview,
    folderName: string,
    displayName: string,
    isCurrent: boolean,
  ): Promise<void> {
    if (!folderName) {
      return;
    }

    let message = `确定要删除世界「${displayName}」(${folderName}) 吗？此操作不可撤销。`;
    if (isCurrent) {
      message = `「${displayName}」是当前开发世界，删除后下次启动 mcdk 会自动重建。确定要删除吗？`;
    }

    const confirm = await vscode.window.showWarningMessage(
      message,
      { modal: true },
      "删除",
    );

    if (confirm !== "删除") {
      return;
    }

    try {
      const worldsDir = this.getWorldsBasePath();
      const worldPath = path.join(worldsDir, folderName);
      const resolvedWorld = path.resolve(worldPath);
      const resolvedBase = path.resolve(worldsDir);

      if (!resolvedWorld.startsWith(resolvedBase + path.sep)) {
        vscode.window.showErrorMessage("无效的世界路径");
        return;
      }

      if (!fs.existsSync(worldPath)) {
        vscode.window.showErrorMessage(`世界文件夹不存在: ${folderName}`);
        return;
      }

      fs.rmSync(worldPath, { recursive: true, force: true });
      vscode.window.showInformationMessage(`世界「${displayName}」已删除`);
      webview.postMessage({ type: "worldDeleted", folderName });
    } catch (e) {
      vscode.window.showErrorMessage(`删除世界失败: ${e}`);
    }
  }

  /**
   * 批量删除多个世界存档（带二次确认）
   */
  private async handleDeleteWorlds(
    webview: vscode.Webview,
    worlds: Array<{
      folderName: string;
      displayName: string;
      isCurrent: boolean;
    }>,
  ): Promise<void> {
    if (!worlds || worlds.length === 0) {
      return;
    }

    const hasCurrent = worlds.some((w) => w.isCurrent);
    const names = worlds.map((w) => w.displayName).join("、");
    let message = `确定要删除 ${worlds.length} 个世界（${names}）吗？此操作不可撤销。`;
    if (hasCurrent) {
      message += "\n⚠ 其中包含当前开发世界，删除后下次启动 mcdk 会自动重建。";
    }

    const confirm = await vscode.window.showWarningMessage(
      message,
      { modal: true },
      "删除",
    );

    if (confirm !== "删除") {
      return;
    }

    try {
      const worldsDir = this.getWorldsBasePath();
      const resolvedBase = path.resolve(worldsDir);
      let deletedCount = 0;
      const errors: string[] = [];

      for (const world of worlds) {
        try {
          const worldPath = path.join(worldsDir, world.folderName);
          const resolvedWorld = path.resolve(worldPath);
          if (!resolvedWorld.startsWith(resolvedBase + path.sep)) {
            errors.push(`${world.displayName}: 无效路径`);
            continue;
          }
          if (!fs.existsSync(worldPath)) {
            errors.push(`${world.displayName}: 文件夹不存在`);
            continue;
          }
          fs.rmSync(worldPath, { recursive: true, force: true });
          deletedCount++;
        } catch (e) {
          errors.push(`${world.displayName}: ${e}`);
        }
      }

      if (deletedCount > 0) {
        vscode.window.showInformationMessage(`已删除 ${deletedCount} 个世界`);
      }
      if (errors.length > 0) {
        vscode.window.showErrorMessage(`部分删除失败: ${errors.join("; ")}`);
      }

      webview.postMessage({ type: "worldDeleted", folderName: null });
    } catch (e) {
      vscode.window.showErrorMessage(`批量删除失败: ${e}`);
    }
  }

  /**
   * 修改 level.dat 中的 LevelName NBT 字段（Bedrock little-endian NBT）
   * level.dat 结构: 8 字节头部 (4B version + 4B data length) + NBT 数据
   * LevelName 是根 compound 中的 string tag (type 0x08)
   */
  private updateLevelDatName(worldPath: string, newName: string): void {
    const levelDatPath = path.join(worldPath, "level.dat");
    if (!fs.existsSync(levelDatPath)) {
      return;
    }

    const buf = fs.readFileSync(levelDatPath);
    if (buf.length < 12) {
      return;
    }

    // 搜索模式: 0x08 (string tag) + 0x09 0x00 (name length=9, LE) + "LevelName"
    const pattern = Buffer.concat([
      Buffer.from([0x08, 0x09, 0x00]),
      Buffer.from("LevelName", "utf8"),
    ]);

    let pos = -1;
    for (let i = 8; i <= buf.length - pattern.length; i++) {
      if (
        buf.compare(pattern, 0, pattern.length, i, i + pattern.length) === 0
      ) {
        pos = i;
        break;
      }
    }

    if (pos === -1) {
      console.warn("LevelName tag not found in level.dat");
      return;
    }

    const valueOffset = pos + pattern.length;
    if (valueOffset + 2 > buf.length) {
      return;
    }

    const oldValueLen = buf.readUInt16LE(valueOffset);
    if (valueOffset + 2 + oldValueLen > buf.length) {
      console.warn("LevelName value extends beyond level.dat buffer");
      return;
    }

    const newValueBuf = Buffer.from(newName, "utf8");
    const newLenBuf = Buffer.alloc(2);
    newLenBuf.writeUInt16LE(newValueBuf.length);

    const before = buf.subarray(0, valueOffset);
    const after = buf.subarray(valueOffset + 2 + oldValueLen);
    const newBuf = Buffer.concat([before, newLenBuf, newValueBuf, after]);

    newBuf.writeInt32LE(newBuf.length - 8, 4);
    fs.writeFileSync(levelDatPath, newBuf);
  }

  /**
   * 重命名世界
   */
  private async handleRenameWorld(
    webview: vscode.Webview,
    folderName: string,
    newName: string,
  ): Promise<void> {
    if (!folderName || !newName || !newName.trim()) {
      return;
    }
    try {
      const worldsDir = this.getWorldsBasePath();
      const worldPath = path.join(worldsDir, folderName);
      const resolvedWorld = path.resolve(worldPath);
      const resolvedBase = path.resolve(worldsDir);
      if (
        !resolvedWorld.startsWith(resolvedBase + path.sep) ||
        !fs.existsSync(worldPath)
      ) {
        vscode.window.showErrorMessage("无效的世界路径");
        return;
      }
      const trimmed = newName.trim();
      const levelNameFile = path.join(worldPath, "levelname.txt");
      fs.writeFileSync(levelNameFile, trimmed, "utf8");
      this.updateLevelDatName(worldPath, trimmed);
      webview.postMessage({ type: "worldRenamed" });
    } catch (e) {
      vscode.window.showErrorMessage(`重命名失败: ${e}`);
    }
  }

  /**
   * 复制世界存档
   */
  private async handleCopyWorld(
    webview: vscode.Webview,
    folderName: string,
  ): Promise<void> {
    if (!folderName) {
      return;
    }
    let destPath: string | undefined;
    try {
      const worldsDir = this.getWorldsBasePath();
      const srcPath = path.join(worldsDir, folderName);
      const resolvedSrc = path.resolve(srcPath);
      const resolvedBase = path.resolve(worldsDir);
      if (
        !resolvedSrc.startsWith(resolvedBase + path.sep) ||
        !fs.existsSync(srcPath)
      ) {
        vscode.window.showErrorMessage("世界文件夹不存在");
        return;
      }

      let copyFolder = folderName + "_copy";
      let counter = 1;
      while (fs.existsSync(path.join(worldsDir, copyFolder))) {
        copyFolder = `${folderName}_copy${counter}`;
        counter++;
      }

      destPath = path.join(worldsDir, copyFolder);
      fs.cpSync(srcPath, destPath, { recursive: true });

      const srcLevelName = path.join(srcPath, "levelname.txt");
      let origDisplayName = folderName;
      if (fs.existsSync(srcLevelName)) {
        const content = fs.readFileSync(srcLevelName, "utf8").trim();
        if (content) {
          origDisplayName = content;
        }
      }
      const defaultNewName = origDisplayName + " (Copy)";

      const newName = await vscode.window.showInputBox({
        prompt: "输入副本的世界名称",
        value: defaultNewName,
        validateInput: (v) => (v.trim() ? null : "名称不能为空"),
      });

      if (newName === undefined) {
        fs.rmSync(destPath, { recursive: true, force: true });
        destPath = undefined;
        return;
      }

      const finalName = newName.trim() || defaultNewName;
      const destLevelName = path.join(destPath, "levelname.txt");
      fs.writeFileSync(destLevelName, finalName, "utf8");
      this.updateLevelDatName(destPath, finalName);

      vscode.window.showInformationMessage(`已复制为「${finalName}」`);
      destPath = undefined;
      webview.postMessage({ type: "worldCopied" });
    } catch (e) {
      if (destPath && fs.existsSync(destPath)) {
        try {
          fs.rmSync(destPath, { recursive: true, force: true });
        } catch {
          // best effort cleanup
        }
      }
      vscode.window.showErrorMessage(`复制失败: ${e}`);
    }
  }

  /**
   * 设置文件监听器，当 .mcdev.json 被外部修改时自动重载
   */
  private setupFileWatcher(webview: vscode.Webview): void {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return;
    }

    const mcdevPath = path.join(workspaceFolder.uri.fsPath, ".mcdev.json");
    const pattern = new vscode.RelativePattern(workspaceFolder, ".mcdev.json");

    this._fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

    // 监听文件变化
    this._fileWatcher.onDidChange(async () => {
      try {
        if (fs.existsSync(mcdevPath)) {
          const content = fs.readFileSync(mcdevPath, "utf8");
          const parsed = jsonc.parse(content) || {};
          const jsonContent = JSON.stringify(parsed);

          let skinPreviewUri: string | undefined;
          const skinPath = parsed?.skin_info?.skin as string | undefined;
          if (skinPath && skinPath.trim()) {
            let filePath = skinPath;
            if (!path.isAbsolute(filePath)) {
              filePath = path.join(workspaceFolder.uri.fsPath, filePath);
            }
            const fileUri = vscode.Uri.file(filePath);
            skinPreviewUri = webview.asWebviewUri(fileUri).toString();
          }

          webview.postMessage({
            type: "init",
            content: jsonContent,
            skinPreviewUri,
          });
        }
      } catch (e) {
        console.error("Error reading .mcdev.json after external change:", e);
      }
    });

    // 监听文件创建
    this._fileWatcher.onDidCreate(async () => {
      try {
        if (fs.existsSync(mcdevPath)) {
          const content = fs.readFileSync(mcdevPath, "utf8");
          const parsed = jsonc.parse(content) || {};
          const jsonContent = JSON.stringify(parsed);

          let skinPreviewUri: string | undefined;
          const skinPath = parsed?.skin_info?.skin as string | undefined;
          if (skinPath && skinPath.trim()) {
            let filePath = skinPath;
            if (!path.isAbsolute(filePath)) {
              filePath = path.join(workspaceFolder.uri.fsPath, filePath);
            }
            const fileUri = vscode.Uri.file(filePath);
            skinPreviewUri = webview.asWebviewUri(fileUri).toString();
          }

          webview.postMessage({
            type: "init",
            content: jsonContent,
            skinPreviewUri,
          });
        }
      } catch (e) {
        console.error("Error reading .mcdev.json after creation:", e);
      }
    });

    // 监听文件删除
    this._fileWatcher.onDidDelete(() => {
      webview.postMessage({ type: "init", content: "{}" });
    });
  }

  /**
   * 获取 Webview HTML
   */
  public getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = getNonce();
    const vscodeLanguage = vscode.env.language;
    const lang =
      vscodeLanguage && vscodeLanguage.startsWith("zh") ? "zh" : "en";

    // Get URIs for built webview assets
    const webviewPath = vscode.Uri.joinPath(
      this._extensionUri,
      "out",
      "webview",
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(webviewPath, "sidebar.js"),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(webviewPath, "sidebar.css"),
    );
    const codiconsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(webviewPath, "codicons", "codicon.css"),
    );

    return `<!doctype html>
<html lang="${lang}">
<head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; img-src ${webview.cspSource} data:;">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MC Dev Tools</title>
    <link href="${codiconsUri}" rel="stylesheet" />
    <link href="${styleUri}" rel="stylesheet" />
</head>
<body>
    <div id="root"></div>
    <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
