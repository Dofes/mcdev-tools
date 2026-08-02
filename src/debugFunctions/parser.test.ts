import * as assert from 'node:assert/strict';
import test from 'node:test';
import { buildDebugFunctionInvocation, discoverDebugFunctions, parseTopLevelFunctions } from './parser';
import { SavedDebugFunction } from './types';

test('discovers top-level functions under the nearest modMain package root', () => {
    const discovered = discoverDebugFunctions('workspace', [
        { relativePath: 'a/modMain.py', content: 'def bootstrap():\n    pass\n' },
        { relativePath: 'a/b.py', content: 'def run(player_id, count=2):\n    pass\n\nclass Hidden:\n    def method(self):\n        pass\n' },
        { relativePath: 'a/nested/modMain.py', content: '' },
        { relativePath: 'a/nested/tool.py', content: 'def inner(value):\n    return value\n' },
        { relativePath: 'outside.py', content: 'def ignored():\n    pass\n' }
    ]);

    assert.deepEqual(discovered.map(item => [item.modulePath, item.functionName]), [
        ['a.b', 'run'],
        ['a.modMain', 'bootstrap'],
        ['nested.tool', 'inner']
    ]);
    assert.deepEqual(discovered[0].parameters, [
        { name: 'player_id', kind: 'value', required: true },
        { name: 'count', kind: 'value', required: false, defaultValue: '2' }
    ]);
    assert.equal(discovered[0].key, 'a.b:run');
});

test('uses the workspace directory as package name when modMain is at workspace root', () => {
    const discovered = discoverDebugFunctions('demo_addon', [
        { relativePath: 'modMain.py', content: '' },
        { relativePath: 'tools/helpers.py', content: 'def ping():\n    return True\n' }
    ]);
    assert.equal(discovered[0].modulePath, 'demo_addon.tools.helpers');
});

test('does not analyze any files below a QuModLibs directory', () => {
    const discovered = discoverDebugFunctions('workspace', [
        { relativePath: 'a/modMain.py', content: '' },
        { relativePath: 'a/tool.py', content: 'def included():\n    pass\n' },
        { relativePath: 'a/QuModLibs/vendor.py', content: 'def ignored():\n    pass\n' },
        { relativePath: 'a/qumodlibs/nested.py', content: 'def ignored_case_insensitive():\n    pass\n' },
        { relativePath: 'QuModLibs/modMain.py', content: 'def ignored_root():\n    pass\n' }
    ]);

    assert.deepEqual(discovered.map(item => item.functionName), ['included']);
});

test('parses multiline signatures and ignores nested functions and signature punctuation', () => {
    const functions = parseTopLevelFunctions(`
@decorator
def execute(
    name,
    config={"items": [1, 2]},
    text="a,b",
    *args,
    **kwargs
):
    def nested():
        pass
    return name
`);
    assert.equal(functions.length, 1);
    assert.equal(functions[0].name, 'execute');
    assert.deepEqual(functions[0].parameters.map(item => [item.name, item.kind, item.required]), [
        ['name', 'value', true],
        ['config', 'value', false],
        ['text', 'value', false],
        ['args', 'varargs', false],
        ['kwargs', 'kwargs', false]
    ]);
});

test('builds a Python 2 compatible invocation with JSON arguments', () => {
    const saved: SavedDebugFunction = {
        id: 'one',
        key: 'a.b:run:2',
        label: 'Run',
        modulePath: 'a.b',
        functionName: 'run',
        relativeFilePath: 'a/b.py',
        line: 2,
        target: 'server',
        parameters: [
            { name: 'name', kind: 'value', required: true },
            { name: 'extra', kind: 'varargs', required: false },
            { name: 'options', kind: 'kwargs', required: false }
        ],
        argumentConfigs: {
            name: { mode: 'fixed', value: '"Alex"' },
            extra: { mode: 'optional', value: '[1, 2]' },
            options: { mode: 'optional', value: '{"enabled": true}' }
        }
    };
    const code = buildDebugFunctionInvocation(saved);
    assert.match(code, /__import__\("a\.b", fromlist=\['\*'\]\)/);
    assert.match(code, /getattr\(__mcdev_module, "run"\)/);
    assert.match(code, /\*__mcdev_payload\['args'\], \*\*__mcdev_kwargs/);
    assert.match(code, /Alex/);
});

test('rejects missing and malformed configured arguments', () => {
    const base: SavedDebugFunction = {
        id: 'one', key: 'a:run:1', label: 'Run', modulePath: 'a', functionName: 'run',
        relativeFilePath: 'a.py', line: 1, target: 'client',
        parameters: [{ name: 'value', kind: 'value', required: true }],
        argumentConfigs: { value: { mode: 'required', value: '' } }
    };
    assert.throws(() => buildDebugFunctionInvocation(base), /Missing required argument/);
    assert.throws(
        () => buildDebugFunctionInvocation(base, { value: 'not json' }),
        /valid JSON/
    );
});

test('supports fixed, optional override, and required runtime argument modes', () => {
    const saved: SavedDebugFunction = {
        id: 'modes', key: 'a:run:1', label: 'Run', modulePath: 'a', functionName: 'run',
        relativeFilePath: 'a.py', line: 1, target: 'client',
        parameters: [
            { name: 'fixed_value', kind: 'value', required: true },
            { name: 'optional_value', kind: 'value', required: false, defaultValue: '3' },
            { name: 'runtime_value', kind: 'value', required: true }
        ],
        argumentConfigs: {
            fixed_value: { mode: 'fixed', value: '1' },
            optional_value: { mode: 'optional', value: '2' },
            runtime_value: { mode: 'required', value: '' }
        }
    };
    const code = buildDebugFunctionInvocation(saved, {
        fixed_value: '999', optional_value: '4', runtime_value: '5'
    });
    assert.match(code, /fixed_value/);
    assert.match(code, /optional_value/);
    assert.match(code, /runtime_value/);
    assert.doesNotMatch(code, /999/);
});
