export const UI_DEBUGGER_PAGE_SIZE = 160;

export interface UiDebuggerNodeSummary {
    name: string;
    path: string;
    typeId: number;
    type: string;
    childCount?: number;
    index?: number;
}

export interface UiDebuggerChildrenResult {
    total: number;
    offset: number;
    nodes: UiDebuggerNodeSummary[];
}

export interface UiDebuggerNodeDetails {
    screen: string;
    path: string;
    name: string;
    typeId: number;
    type: string;
    visible?: boolean;
    childCount?: number;
    properties: Record<string, Record<string, unknown>>;
}

export interface UiDebuggerRevealPage extends UiDebuggerChildrenResult {
    parentPath: string;
}

export type UiDebuggerEditableProperty =
    | 'position'
    | 'size'
    | 'layer'
    | 'order'
    | 'minSize'
    | 'maxSize'
    | 'clipsChildren'
    | 'text'
    | 'editText'
    | 'color'
    | 'shadow'
    | 'linePadding'
    | 'scrollPosition'
    | 'scrollPercent'
    | 'toggleState'
    | 'sliderValue';

const TYPE_NAMES = [
    'Button', 'Custom', 'CollectionPanel', 'Dropdown', 'EditBox', 'Factory', 'Grid', 'Image',
    'InputPanel', 'Label', 'Panel', 'Screen', 'ScrollbarBox', 'ScrollTrack', 'ScrollView',
    'SelectionWheel', 'Slider', 'SliderBox', 'StackPanel', 'Toggle', 'ImageCycler',
    'LabelCycler', 'GridPageIndicator', 'TooltipTrigger', 'Combox', 'Layout', 'StackGrid',
    'Joystick', 'RichText', 'SixteenNineLayout', 'MulLinesEdit', 'AminProcessBar', 'Unknown'
];

export function buildUiDebuggerScreensCode(): string {
    return "__import__('gui').get_all_screen_fullnames()";
}

export function buildUiDebuggerChildrenCode(
    screen: string,
    parentPath: string,
    offset: number,
    limit = UI_DEBUGGER_PAGE_SIZE
): string {
    const start = clampInteger(offset, 0, 1_000_000);
    const count = clampInteger(limit, 1, UI_DEBUGGER_PAGE_SIZE);
    const screenLiteral = pythonUnicodeLiteral(screen);
    if (!parentPath) {
        return [
            'import _gui',
            `s=${screenLiteral};a=_gui.get_root_children_names(s) or []`,
            `_result=[len(a),[(x.lstrip('/'),_gui.get_control_def_type(s,'/'+x.lstrip('/')),len(_gui.get_children_name_from_parent(s,'/'+x.lstrip('/')) or []),i) for i,x in enumerate(a[${start}:${start + count}],${start})]]`
        ].join('\n');
    }

    const pathLiteral = pythonUnicodeLiteral(parentPath);
    return [
        'import _gui',
        `s=${screenLiteral};p=${pathLiteral};a=_gui.get_children_name_from_parent(s,p) or []`,
        `_result=[len(a),[(x,_gui.get_control_def_type(s,p.rstrip('/')+'/'+x),len(_gui.get_children_name_from_parent(s,p.rstrip('/')+'/'+x) or []),i) for i,x in enumerate(a[${start}:${start + count}],${start})]]`
    ].join('\n');
}

export function buildUiDebuggerNodeCode(screen: string, path: string): string {
    const getters = [
        'get_visible', 'get_size', 'get_position', 'get_global_position', 'get_layer', 'get_order',
        'get_min_size', 'get_max_size', 'get_clips_children', 'get_size_x', 'get_size_y',
        'get_position_x', 'get_position_y', 'get_anchor_from', 'get_anchor_to', 'get_text',
        'get_edit_text', 'get_text_color', 'get_text_alignment', 'get_text_shadow',
        'get_text_line_padding', 'get_grid_dimension', 'get_stack_panel_orientation',
        'get_scroll_view_pos', 'get_scroll_view_percent_value', 'get_toggle_state', 'get_slider_value'
    ];
    return [
        'import gui as q',
        `s=${pythonUnicodeLiteral(screen)};p=${pythonUnicodeLiteral(path)};t=q.get_control_def_type(s,p)`,
        'def g(n):',
        ' try:return getattr(q,n)(s,p)',
        ' except:return None',
        "b=g('get_property_bag_value');b=dict(list(b.items())[:256]) if isinstance(b,dict) else b",
        `_result=[t,len(q.get_children_name_from_parent(s,p) or [])]+[g(n) for n in ${pythonStringList(getters)}]+[b]`
    ].join('\n');
}

export function buildUiDebuggerVisibilityCode(screen: string, path: string, visible: boolean): string {
    return [
        'import gui as q',
        `s=${pythonUnicodeLiteral(screen)};p=${pythonUnicodeLiteral(path)}`,
        `q.set_visible(s,p,${visible ? 'True' : 'False'});_result=bool(q.get_visible(s,p))`
    ].join('\n');
}

export function buildUiDebuggerPropertyCode(
    screen: string,
    path: string,
    property: string,
    value: unknown
): string {
    const editableProperty = property as UiDebuggerEditableProperty;
    const normalized = normalizeUiDebuggerPropertyValue(editableProperty, value);
    const valueCode = `json.loads(${pythonUnicodeLiteral(JSON.stringify(normalized))})`;
    const operations: Record<UiDebuggerEditableProperty, [string, string]> = {
        position: ['q.set_position(s,p,tuple(v))', 'q.get_position(s,p)'],
        size: ['q.set_size(s,p,tuple(v),True)', 'q.get_size(s,p)'],
        layer: ['q.set_layer(s,p,int(v),True)', 'q.get_layer(s,p)'],
        order: ['q.set_order(s,p,int(v))', 'q.get_order(s,p)'],
        minSize: ['q.set_min_size(s,p,tuple(v))', 'q.get_min_size(s,p)'],
        maxSize: ['q.set_max_size(s,p,tuple(v))', 'q.get_max_size(s,p)'],
        clipsChildren: ['q.set_clips_children(s,p,bool(v))', 'q.get_clips_children(s,p)'],
        text: ['q.set_text(s,p,v,True)', 'q.get_text(s,p)'],
        editText: ['q.set_edit_text(s,p,v)', 'q.get_edit_text(s,p)'],
        color: ['q.set_text_color(s,p,tuple(v))', 'q.get_text_color(s,p)'],
        shadow: ['q.set_text_shadow(s,p,bool(v))', 'q.get_text_shadow(s,p)'],
        linePadding: ['q.set_text_line_padding(s,p,v)', 'q.get_text_line_padding(s,p)'],
        scrollPosition: ['q.set_scroll_view_pos(s,p,v)', 'q.get_scroll_view_pos(s,p)'],
        scrollPercent: ['q.set_scroll_view_percent_value(s,p,int(v))', 'q.get_scroll_view_percent_value(s,p)'],
        toggleState: ['q.set_toggle_state_new(s,p,bool(v))', 'q.get_toggle_state(s,p)'],
        sliderValue: ['q.set_slider_value(s,p,v)', 'q.get_slider_value(s,p)']
    };
    const operation = operations[editableProperty];
    if (!operation) {
        throw new Error('Unsupported UI property');
    }
    return [
        'import gui as q,json',
        `s=${pythonUnicodeLiteral(screen)};p=${pythonUnicodeLiteral(path)};v=${valueCode}`,
        `${operation[0]};_result=${operation[1]}`
    ].join('\n');
}

export function normalizeUiDebuggerPropertyValue(
    property: UiDebuggerEditableProperty,
    value: unknown
): string | number | boolean | number[] {
    if (property === 'text' || property === 'editText') {
        if (typeof value !== 'string' || value.length > 64 * 1024 || value.includes('\0')) {
            throw new Error('Invalid UI text value');
        }
        return value;
    }
    if (property === 'clipsChildren' || property === 'shadow' || property === 'toggleState') {
        if (typeof value !== 'boolean') {
            throw new Error('Invalid UI boolean value');
        }
        return value;
    }
    if (property === 'position' || property === 'size' || property === 'minSize' || property === 'maxSize') {
        return normalizeNumberArray(value, 2);
    }
    if (property === 'color') {
        return normalizeNumberArray(value, 4);
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 10_000_000) {
        throw new Error('Invalid UI numeric value');
    }
    if ((property === 'layer' || property === 'order' || property === 'scrollPercent') && !Number.isInteger(value)) {
        throw new Error('The UI property requires an integer');
    }
    if (property === 'scrollPercent' && (value < 0 || value > 100)) {
        throw new Error('Scroll percent must be between 0 and 100');
    }
    return value;
}

export function buildUiDebuggerPickerEnableCode(showAllBounds: boolean): string {
    return [
        'import gui,json,mobile_logger',
        'from common import eventUtil,game',
        "if not globals().get('_mcdev_ui_listener'):",
        ' _mcdev_ui_old_logger=mobile_logger.OPEN_SAFAIA_TEST_LOGGER',
        ' mobile_logger.OPEN_SAFAIA_TEST_LOGGER=True',
        ' _mcdev_ui_old_enabled=bool(gui.get_netease_ui_debugger_enable())',
        ' _mcdev_ui_event=None',
        ' def _mcdev_ui_find_path(v):',
        '  if isinstance(v,basestring):',
        '   try:v=json.loads(v)',
        '   except:return v if v.startswith(\'/\') and v.count(\'/\')>1 else None',
        '  q=[v];r=None;f=None;n=0',
        '  while q and n<128:',
        '   x=q.pop(0);n+=1',
        '   if isinstance(x,dict):',
        '    for k in list(x)[:64]:',
        "     if isinstance(k,basestring) and k.startswith('/') and k.count('/')>1 and (r is None or len(k)>len(r)):r=k",
        '    for y in x.values()[:64]:',
        '     if len(q)<128:q.append(y)',
        '   elif isinstance(x,(list,tuple)):',
        '    for y in x[:64]:',
        '     if len(q)<128:q.append(y)',
        "   elif isinstance(x,basestring) and x.startswith('/') and x.count('/')>1 and (f is None or len(x)>len(f)):f=x",
        '  return r or f',
        ' class _MCDevUiListener(object):',
        '  def __init__(self):self.pending=None;self.scheduled=False;self.active=True',
        '  def apply_selection(self):',
        '   self.scheduled=False',
        '   if not self.active:return',
        '   p=self.pending;self.pending=None',
        '   if not p:return',
        '   try:gui.nud_set_selected_controls(json.dumps([p]))',
        '   except:pass',
        '  def on_event(self,args):',
        '   global _mcdev_ui_event',
        "   d=args.get('data') if isinstance(args,dict) else args",
        '   _mcdev_ui_event=d;p=_mcdev_ui_find_path(d)',
        '   if p:',
        '    self.pending=p',
        '    if not self.scheduled:',
        '     self.scheduled=True',
        '     try:game.GetClient().GetClientModTimer().addTimer(0.0,self.apply_selection)',
        '     except:self.scheduled=False',
        ' _mcdev_ui_listener=_MCDevUiListener()',
        " eventUtil.instance.ListenForEngineClient('UIDebuggerNotifyEvent',_mcdev_ui_listener,_mcdev_ui_listener.on_event)",
        'gui.set_netease_ui_debugger_enable(True)',
        `gui.nud_set_bounds_visible(${showAllBounds ? 'True' : 'False'})`,
        '_result=bool(gui.get_netease_ui_debugger_enable())'
    ].join('\n');
}

export function buildUiDebuggerPickerDisableCode(): string {
    return [
        'import gui,json,mobile_logger',
        'def _mcdev_ui_call(f,*a):',
        ' try:return f(*a)',
        ' except:return None',
        "o=globals().get('_mcdev_ui_listener')",
        'if o:',
        ' o.active=False;o.pending=None',
        ' from common import eventUtil',
        " _mcdev_ui_call(eventUtil.instance.UnListenForEngineClient,'UIDebuggerNotifyEvent',o,o.on_event)",
        '_mcdev_ui_call(gui.nud_set_selected_controls,json.dumps([]))',
        '_mcdev_ui_call(gui.nud_set_bounds_visible,False)',
        "_mcdev_ui_call(gui.set_netease_ui_debugger_enable,bool(globals().get('_mcdev_ui_old_enabled',False)))",
        "mobile_logger.OPEN_SAFAIA_TEST_LOGGER=bool(globals().get('_mcdev_ui_old_logger',False))",
        "_mcdev_ui_listener=None;_mcdev_ui_event=None;_result=False"
    ].join('\n');
}

export function buildUiDebuggerPickerPollCode(includeScreens = false): string {
    if (includeScreens) {
        return "_result=[globals().get('_mcdev_ui_event'),gui.get_all_screen_fullnames()];_mcdev_ui_event=None";
    }
    return "_result=globals().get('_mcdev_ui_event');_mcdev_ui_event=None";
}

export function buildUiDebuggerPickerSelectCode(
    screen: string,
    path: string
): string {
    const nudPath = toNudPath(screen, path);
    return [
        'import gui,json',
        `p=json.dumps([${pythonUnicodeLiteral(nudPath)}])`,
        'gui.nud_set_selected_controls(p);gui.nud_get_controls_data(p);_result=True'
    ].join('\n');
}

export function buildUiDebuggerRevealCode(screen: string, path: string): string {
    const segments = path.split('/').filter(Boolean);
    const targets = segments.slice(0, 32).map((target, index) => (
        [`/${segments.slice(0, index).join('/')}`.replace(/^\/$/, ''), target] as const
    ));
    const descriptors = `[${targets.map(([parent, target]) => (
        `(${pythonUnicodeLiteral(parent)},${pythonUnicodeLiteral(target)})`
    )).join(',')}]`;
    return [
        'import _gui',
        `s=${pythonUnicodeLiteral(screen)};ds=${descriptors};r=[]`,
        'for k,(p,t) in enumerate(ds):',
        " a=(_gui.get_root_children_names(s) if not p else _gui.get_children_name_from_parent(s,p)) or []",
        " try:j=([x.lstrip('/') for x in a].index(t) if not p else a.index(t))",
        ' except:j=0',
        ' o=(j//160)*160',
        " r.append([p,len(a),o,[(x.lstrip('/'),_gui.get_control_def_type(s,('/'+x.lstrip('/')) if not p else p.rstrip('/')+'/'+x),(len(_gui.get_children_name_from_parent(s,('/'+x.lstrip('/')) if not p else p.rstrip('/')+'/'+x) or []) if k==len(ds)-1 else None),i) for i,x in enumerate(a[o:o+160],o)]])",
        '_result=r'
    ].join('\n');
}

export function parseUiDebuggerScreens(value: unknown): string[] {
    if (!Array.isArray(value)) {
        throw new Error('The game returned an invalid UI screen list');
    }
    const screens = value.filter((item): item is string => (
        typeof item === 'string' && item.length > 0 && item.length <= 512 && !item.includes('\0')
    ));
    return Array.from(new Set(screens)).slice(0, 256);
}

export function parseUiDebuggerChildren(
    value: unknown,
    parentPath: string,
    offset: number
): UiDebuggerChildrenResult {
    if (!Array.isArray(value) || value.length !== 2 || !Number.isInteger(value[0]) || !Array.isArray(value[1])) {
        throw new Error('The game returned invalid UI children');
    }
    const total = clampInteger(Number(value[0]), 0, 1_000_000);
    const nodes: UiDebuggerNodeSummary[] = [];
    for (const item of value[1]) {
        if (!Array.isArray(item) || typeof item[0] !== 'string' || !Number.isInteger(item[1])) {
            continue;
        }
        const name = item[0];
        if (!name || name.length > 2048 || name.includes('\0') || name.includes('/')) {
            continue;
        }
        const path = parentPath ? `${parentPath.replace(/\/$/, '')}/${name}` : `/${name}`;
        const typeId = Number(item[1]);
        const childCount = Number.isInteger(item[2])
            ? clampInteger(Number(item[2]), 0, 1_000_000)
            : undefined;
        const node: UiDebuggerNodeSummary = {
            name, path, typeId, type: getUiControlTypeName(typeId)
        };
        if (childCount !== undefined) {
            node.childCount = childCount;
        }
        if (Number.isInteger(item[3])) {
            node.index = clampInteger(Number(item[3]), 0, 1_000_000);
        }
        nodes.push(node);
    }
    return { total, offset: clampInteger(offset, 0, 1_000_000), nodes };
}

export function parseUiDebuggerNode(
    value: unknown,
    screen: string,
    path: string
): UiDebuggerNodeDetails {
    if (!Array.isArray(value) || value.length !== 30 || !Number.isInteger(value[0])) {
        throw new Error('The game returned invalid UI node details');
    }
    const typeId = Number(value[0]);
    const runtime = compactRecord({
        visible: value[2], size: value[3], position: value[4], globalPosition: value[5],
        layer: value[6], order: value[7], directChildren: value[1], minSize: value[8],
        maxSize: value[9], clipsChildren: value[10]
    });
    const layout = compactRecord({
        sizeX: value[11], sizeY: value[12], positionX: value[13], positionY: value[14],
        anchorFrom: value[15], anchorTo: value[16]
    });
    const text = new Set([0, 4, 9, 19, 28, 30]).has(typeId) ? compactRecord({
        text: value[17], editText: value[18], color: value[19], alignment: value[20],
        shadow: value[21], linePadding: value[22]
    }) : {};
    const control = compactRecord({
        gridDimension: typeId === 6 ? value[23] : undefined,
        stackOrientation: typeId === 18 ? value[24] : undefined,
        scrollPosition: typeId === 14 ? value[25] : undefined,
        scrollPercent: typeId === 14 ? value[26] : undefined,
        toggleState: typeId === 19 ? value[27] : undefined,
        sliderValue: typeId === 16 ? value[28] : undefined
    });
    const variables = normalizePropertyBag(value[29]);
    return {
        screen,
        path,
        name: path.replace(/\/$/, '').split('/').pop() || path,
        typeId,
        type: getUiControlTypeName(typeId),
        visible: typeof value[2] === 'boolean' ? value[2] : undefined,
        childCount: Number.isInteger(value[1]) ? Number(value[1]) : undefined,
        properties: { runtime, layout, text, control, variables }
    };
}

export function parseUiDebuggerReveal(value: unknown): UiDebuggerRevealPage[] {
    if (!Array.isArray(value)) {
        throw new Error('The game returned invalid UI reveal data');
    }
    const pages: UiDebuggerRevealPage[] = [];
    for (const item of value) {
        if (!Array.isArray(item) || typeof item[0] !== 'string') {
            continue;
        }
        const parentPath = item[0];
        const offset = Number.isInteger(item[2]) ? Number(item[2]) : 0;
        const nodes = Array.isArray(item[3]) ? item[3] : item[2];
        const parsed = parseUiDebuggerChildren([item[1], nodes], parentPath, offset);
        pages.push({ parentPath, ...parsed });
    }
    return pages;
}

export function getUiControlTypeName(typeId: number): string {
    return TYPE_NAMES[typeId] ?? `EngineUnknown${typeId}`;
}

function pythonUnicodeLiteral(value: string): string {
    const escaped = JSON.stringify(value).replace(/[\u007f-\uffff]/g, character => (
        `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`
    ));
    return `u${escaped}`;
}

function pythonStringList(values: string[]): string {
    return `[${values.map(pythonUnicodeLiteral).join(',')}]`;
}

function toNudPath(screen: string, path: string): string {
    const screenRoot = screen.split('.').pop() || screen;
    return `/${screenRoot}${path.startsWith('/') ? path : `/${path}`}`;
}

function compactRecord(value: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null && item !== undefined));
}

function normalizePropertyBag(value: unknown): Record<string, unknown> {
    if (value === null || value === undefined) {
        return {};
    }
    if (typeof value !== 'object' || Array.isArray(value)) {
        return { value };
    }
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 256));
}

function normalizeNumberArray(value: unknown, length: number): number[] {
    if (!Array.isArray(value) || value.length !== length) {
        throw new Error(`The UI property requires ${length} numeric values`);
    }
    if (value.some(item => typeof item !== 'number' || !Number.isFinite(item) || Math.abs(item) > 10_000_000)) {
        throw new Error('Invalid UI numeric values');
    }
    return value as number[];
}

function clampInteger(value: number, minimum: number, maximum: number): number {
    if (!Number.isFinite(value)) {
        return minimum;
    }
    return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}
