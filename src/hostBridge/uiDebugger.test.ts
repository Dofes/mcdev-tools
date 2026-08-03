import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildUiDebuggerChildrenCode,
    buildUiDebuggerNodeCode,
    buildUiDebuggerPickerEnableCode,
    buildUiDebuggerPickerSelectCode,
    buildUiDebuggerPickerPollCode,
    buildUiDebuggerPropertyCode,
    buildUiDebuggerRevealCode,
    parseUiDebuggerChildren,
    parseUiDebuggerNode,
    parseUiDebuggerReveal,
    parseUiDebuggerScreens
} from './uiDebugger';

test('UI debugger code escapes Python input and never recursively scans', () => {
    const code = buildUiDebuggerChildrenCode("screen';boom()#", '/root/\u754c', 0);
    assert.match(code, /u"screen';boom\(\)#"/);
    assert.match(code, /\\u754c/);
    assert.doesNotMatch(code, /recurs|get_all_children/i);
    assert.match(code, /get_children_name_from_parent/);
});

test('UI debugger validates editable properties and emits compact readback code', () => {
    const position = buildUiDebuggerPropertyCode('hud.hud_screen', '/root/panel', 'position', [12.5, -3]);
    assert.match(position, /set_position\(s,p,tuple\(v\)\)/);
    assert.match(position, /_result=q\.get_position\(s,p\)/);
    const size = buildUiDebuggerPropertyCode('hud.hud_screen', '/root/panel', 'size', [120, 40]);
    assert.match(size, /set_size\(s,p,tuple\(v\),True\)/);
    const textCode = buildUiDebuggerPropertyCode('hud.hud_screen', '/root/title', 'text', "a'\\nb");
    assert.match(textCode, /json\.loads/);
    assert.match(textCode, /set_text\(s,p,v,True\)/);
    assert.match(buildUiDebuggerPropertyCode('hud.hud_screen', '/root/toggle', 'toggleState', true), /bool\(v\)/);
    assert.throws(() => buildUiDebuggerPropertyCode('screen', '/node', 'position', ['', 1]));
    assert.throws(() => buildUiDebuggerPropertyCode('screen', '/node', 'scrollPercent', 101));
    assert.throws(() => buildUiDebuggerPropertyCode('screen', '/node', 'layer', 1.5));
    assert.throws(() => buildUiDebuggerPropertyCode('screen', '/node', 'unknown', 1));
});

test('UI debugger parses a compact child page', () => {
    assert.deepEqual(parseUiDebuggerChildren([3, [['label', 9, 0, 160], ['panel', 10, 2, 161]]], '/root', 160), {
        total: 3,
        offset: 160,
        nodes: [
            { name: 'label', path: '/root/label', typeId: 9, type: 'Label', childCount: 0, index: 160 },
            { name: 'panel', path: '/root/panel', typeId: 10, type: 'Panel', childCount: 2, index: 161 }
        ]
    });
});

test('UI debugger normalizes screens and node details', () => {
    assert.deepEqual(parseUiDebuggerScreens(['hud.hud_screen', 'hud.hud_screen', null]), ['hud.hud_screen']);
    const values: unknown[] = new Array(30).fill(null);
    values[0] = 9;
    values[1] = 0;
    values[2] = true;
    values[3] = [100, 20];
    values[4] = [1, 2];
    values[5] = [3, 4];
    values[6] = 5;
    values[17] = 'Hi';
    values[29] = { '#title': 'Bound title', '#enabled': true };
    assert.deepEqual(
        parseUiDebuggerNode(values, 'hud.hud_screen', '/root/title'),
        {
            screen: 'hud.hud_screen', path: '/root/title', name: 'title', typeId: 9, type: 'Label',
            visible: true, childCount: 0,
            properties: {
                runtime: {
                    visible: true, size: [100, 20], position: [1, 2], globalPosition: [3, 4],
                    layer: 5, directChildren: 0
                },
                layout: {}, text: { text: 'Hi' }, control: {},
                variables: { '#title': 'Bound title', '#enabled': true }
            }
        }
    );
});

test('UI debugger keeps picker polling and node details bounded', () => {
    const selectCode = buildUiDebuggerPickerEnableCode(false);
    const layoutCode = buildUiDebuggerPickerEnableCode(true);
    assert.match(selectCode, /nud_set_bounds_visible\(False\)/);
    assert.match(layoutCode, /nud_set_bounds_visible\(True\)/);
    assert.match(selectCode, /UIDebuggerNotifyEvent/);
    assert.match(selectCode, /json\.loads\(v\)/);
    assert.match(selectCode, /_mcdev_ui_find_path/);
    assert.match(selectCode, /GetClientModTimer\(\)\.addTimer\(0\.0,self\.apply_selection\)/);
    assert.match(selectCode, /self\.pending=p/);
    assert.doesNotMatch(selectCode, /_mcdev_ui_last_path/);
    assert.match(layoutCode, /UIDebuggerNotifyEvent/);
    const nodeCode = buildUiDebuggerNodeCode('hud.hud_screen', '/root/title');
    assert.match(nodeCode, /get_property_bag_value/);
    assert.match(nodeCode, /items\(\)\)\[:256\]/);
    const runtimeSelectCode = buildUiDebuggerPickerSelectCode('custom.overlay', '/root/button');
    assert.match(runtimeSelectCode, /overlay\/root\/button/);
    assert.match(runtimeSelectCode, /nud_get_controls_data/);
    assert.ok(buildUiDebuggerPickerPollCode().length < 80);
    assert.match(buildUiDebuggerPickerPollCode(true), /get_all_screen_fullnames/);
    assert.ok(nodeCode.length < 1_200);
    assert.deepEqual(parseUiDebuggerReveal([
        ['', 400, 160, [['root', 10, undefined, 160]]],
        ['/root', 1, 0, [['panel', 10, 0, 0]]]
    ]), [
        { parentPath: '', total: 400, offset: 160, nodes: [{ name: 'root', path: '/root', typeId: 10, type: 'Panel', index: 160 }] },
        { parentPath: '/root', total: 1, offset: 0, nodes: [{ name: 'panel', path: '/root/panel', typeId: 10, type: 'Panel', childCount: 0, index: 0 }] }
    ]);
    const revealCode = buildUiDebuggerRevealCode('hud.hud_screen', '/root/panel/title');
    assert.match(revealCode, /a\.index\(t\)/);
    assert.match(revealCode, /o=\(j\/\/160\)\*160/);
    assert.doesNotMatch(revealCode, /get_all_children|recurs/i);
});
