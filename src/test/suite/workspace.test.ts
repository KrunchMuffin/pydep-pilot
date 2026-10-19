import * as assert from 'assert';
import type { WorkspaceFolder } from 'vscode';
import { orderWorkspaceFolders } from '@/modules/WorkspaceSelection';
import { environmentEmptyState } from '@/modules/EnvironmentEmptyState';

suite('Workspace selection and environment messages', () => {
    const folder = (name: string) => ({ name, uri: { toString: () => name } } as WorkspaceFolder);
    const first = folder('first');
    const second = folder('second');
    const folders = [first, second];

    test('an explicit resource cannot fall back to an unrelated workspace', () => {
        assert.deepStrictEqual(orderWorkspaceFolders(folders, undefined, true), []);
        assert.deepStrictEqual(orderWorkspaceFolders(folders, second, true), [second]);
    });

    test('the active editor prioritizes its workspace without dropping the others', () => {
        assert.deepStrictEqual(orderWorkspaceFolders(folders, second, false), [second, first]);
        assert.deepStrictEqual(orderWorkspaceFolders(folders, undefined, false), folders);
        assert.deepStrictEqual(folders, [first, second]);
        assert.deepStrictEqual(orderWorkspaceFolders([], undefined, false), []);
    });

    test('empty-state hints offer global Python only when one is available', () => {
        for (const state of ['no-workspace', 'non-python', 'missing-environment'] as const) {
            const local = environmentEmptyState(state, 'demo', false);
            const global = environmentEmptyState(state, 'demo', true);
            assert.strictEqual(local.message, global.message);
            assert.strictEqual(local.canUseGlobal, false);
            assert.strictEqual(global.canUseGlobal, true);
            assert.ok(!local.hint.includes('global'));
            assert.ok(global.hint.includes('global'));
        }
        assert.strictEqual(environmentEmptyState('non-python', 'demo', false).message, 'demo does not look like a Python project.');
        assert.strictEqual(environmentEmptyState('missing-environment', 'demo', false).message, 'No project Python environment found in demo.');
    });
});
