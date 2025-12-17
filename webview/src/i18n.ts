export interface I18nText {
  runGame: string;
  runGameTooltip: string;
  modDirectories: string;
  addModDirectory: string;
  browse: string;
  hotReload: string;
  noModDirs: string;
  worldSettings: string;
  worldName: string;
  worldFolder: string;
  worldSeed: string;
  worldType: string;
  infinity: string;
  flat: string;
  old: string;
  gameMode: string;
  survival: string;
  creative: string;
  adventure: string;
  spectator: string;
  experimentOptions: string;
  dataDrivenBiomes: string;
  dataDrivenItems: string;
  experimentalMolang: string;
  gameOptions: string;
  resetWorld: string;
  autoJoin: string;
  includeDebug: string;
  autoHotReload: string;
  enableCheats: string;
  keepInventory: string;
  doWeatherCycle: string;
  userSettings: string;
  userName: string;
  windowStyle: string;
  alwaysOnTop: string;
  hideTitleBar: string;
  titleBarColor: string;
  titleBarColorPlaceholder: string;
  fixedSize: string;
  fixedSizePlaceholder: string;
  fixedPosition: string;
  fixedPositionPlaceholder: string;
  lockCorner: string;
  cornerNone: string;
  cornerTopLeft: string;
  cornerTopRight: string;
  cornerBottomLeft: string;
  cornerBottomRight: string;
  debugKeybindings: string;
  globalReloadKey: string;
  saveChanges: string;
  loaded: string;
  savedSuccess: string;
  reloadScripts: string;
  reloadWorld: string;
  reloadAddons: string;
  reloadShaders: string;
  clickToSet: string;
  pressAnyKey: string;
  remove: string;
  clear: string;
}

export const i18n: Record<string, I18nText> = {
  en: {
    runGame: 'Run Game',
    runGameTooltip: 'Start Minecraft with mcdk',
    modDirectories: 'Mod Directories',
    addModDirectory: 'Add Mod Directory',
    browse: 'Browse...',
    hotReload: 'Hot Reload',
    noModDirs: 'No mod directories configured.',
    worldSettings: 'World Settings',
    worldName: 'World Name',
    worldFolder: 'World Folder',
    worldSeed: 'World Seed',
    worldType: 'World Type',
    infinity: 'Infinity',
    flat: 'Flat',
    old: 'Old',
    gameMode: 'Game Mode',
    survival: 'Survival',
    creative: 'Creative',
    adventure: 'Adventure',
    spectator: 'Spectator',
    experimentOptions: 'Experimental Options',
    dataDrivenBiomes: 'Data Driven Biomes',
    dataDrivenItems: 'Data Driven Items',
    experimentalMolang: 'Experimental Molang Features',
    gameOptions: 'Game Options',
    resetWorld: 'Reset World',
    autoJoin: 'Auto Join Game',
    includeDebug: 'Include Debug Mod',
    autoHotReload: 'Auto Hot Reload Mods',
    enableCheats: 'Enable Cheats',
    keepInventory: 'Keep Inventory',
    doWeatherCycle: 'Do Weather Cycle',
    userSettings: 'User Settings',
    userName: 'User Name',
    windowStyle: 'Window Style',
    alwaysOnTop: 'Always On Top',
    hideTitleBar: 'Hide Title Bar',
    titleBarColor: 'Title Bar Color',
    titleBarColorPlaceholder: 'e.g., #hex, rgb(r,g,b)',
    fixedSize: 'Fixed Size',
    fixedSizePlaceholder: 'e.g., 800,600',
    fixedPosition: 'Fixed Position',
    fixedPositionPlaceholder: 'e.g., 100,100',
    lockCorner: 'Lock Corner',
    cornerNone: 'None',
    cornerTopLeft: 'Top Left',
    cornerTopRight: 'Top Right',
    cornerBottomLeft: 'Bottom Left',
    cornerBottomRight: 'Bottom Right',
    debugKeybindings: 'Debug Keybindings',
    globalReloadKey: 'Global Reload Key',
    saveChanges: 'Save Changes',
    loaded: 'Loaded',
    savedSuccess: 'Saved successfully',
    reloadScripts: 'Reload Scripts',
    reloadWorld: 'Reload World',
    reloadAddons: 'Reload Addons',
    reloadShaders: 'Reload Shaders',
    clickToSet: 'Click to set...',
    pressAnyKey: 'Press any key... (ESC to cancel)',
    remove: 'Remove',
    clear: 'Clear',
  },
  zh: {
    runGame: '运行游戏',
    runGameTooltip: '使用 mcdk 启动 Minecraft',
    modDirectories: 'Mod 目录',
    addModDirectory: '添加 Mod 目录',
    browse: '浏览...',
    hotReload: '热重载',
    noModDirs: '未配置模组目录。',
    worldSettings: '世界设置',
    worldName: '世界名称',
    worldFolder: '世界文件夹',
    worldSeed: '世界种子',
    worldType: '世界类型',
    infinity: '无限世界',
    flat: '超平坦世界',
    old: '有限世界',
    gameMode: '游戏模式',
    survival: '生存',
    creative: '创造',
    adventure: '冒险',
    spectator: '旁观者',
    experimentOptions: '实验性选项',
    dataDrivenBiomes: '数据驱动生物群系',
    dataDrivenItems: '数据驱动物品',
    experimentalMolang: '实验性Molang特性',
    gameOptions: '游戏选项',
    resetWorld: '重置世界',
    autoJoin: '自动加入游戏',
    includeDebug: '包含调试模组',
    autoHotReload: '自动热重载',
    enableCheats: '开启作弊',
    keepInventory: '保持物品栏',
    doWeatherCycle: '天气循环',
    userSettings: '用户设置',
    userName: '用户名',
    windowStyle: '窗口样式',
    alwaysOnTop: '悬浮置顶',
    hideTitleBar: '隐藏标题栏',
    titleBarColor: '标题栏颜色 (RGB)',
    titleBarColorPlaceholder: '例如 255,0,0 表示红色',
    fixedSize: '锁定大小 (宽 x 高)',
    fixedSizePlaceholder: '例如 1920,1080',
    fixedPosition: '锁定位置 (X, Y)',
    fixedPositionPlaceholder: '例如 100,100',
    lockCorner: '锁定到角落',
    cornerNone: '无',
    cornerTopLeft: '左上',
    cornerTopRight: '右上',
    cornerBottomLeft: '左下',
    cornerBottomRight: '右下',
    debugKeybindings: '调试按键绑定',
    globalReloadKey: '全局重载按键',
    saveChanges: '保存更改',
    loaded: '已加载',
    savedSuccess: '保存成功',
    reloadScripts: '重载脚本',
    reloadWorld: '重载世界',
    reloadAddons: '重载插件',
    reloadShaders: '重载着色器',
    clickToSet: '点击设置...',
    pressAnyKey: '按下任意键... (ESC 取消)',
    remove: '移除',
    clear: '清除',
  },
};
