import * as assert from 'assert';
import * as vscode from 'vscode';
import { PackageWebviewProvider } from '@/modules/PackageWebviewProvider';
import type { IPackageManager } from '@/modules/PackageManager';
import type { IPythonExtension } from '@/modules/PythonExtension';

suite('Package sidebar behavior', () => {
    const subscriptions: vscode.Disposable[] = [];
    teardown(() => subscriptions.splice(0).forEach(item => item.dispose()));

    function createView(options: { listError?: Error; updateError?: Error; python?: string } = {}) {
        const messages: any[] = [];
        const installed = [{ name: 'demo', version: '1.0.0' }];
        let handleMessage: (message: any) => Promise<void>;
        const getPythonPath = (_resource: unknown, { allowGlobal }: { allowGlobal: boolean }) =>
            allowGlobal ? '/global/python' : options.python ?? '/project/python';
        const manager = {
            updatePythonPath: () => {},
            getActiveBackend: async () => 'uv',
            getPackageList: async () => {
                if (options.listError) { throw options.listError; }
                return installed;
            },
            getPackageUpdate: async () => {
                if (options.updateError) { throw options.updateError; }
                return [];
            },
            mergePackageListWithUpdate: () => installed
        } as unknown as IPackageManager;
        const context = { subscriptions, extensionUri: vscode.Uri.file(process.cwd()) } as unknown as vscode.ExtensionContext;
        const provider = new PackageWebviewProvider(manager, { getPythonPath } as unknown as IPythonExtension, context);
        const webview = {
            options: {}, html: '', cspSource: 'test:',
            asWebviewUri: (uri: vscode.Uri) => uri,
            postMessage: (message: unknown) => { messages.push(message); return Promise.resolve(true); },
            onDidReceiveMessage: (handler: typeof handleMessage) => { handleMessage = handler; return new vscode.Disposable(() => {}); }
        };
        const view = { webview, visible: true, onDidChangeVisibility: () => new vscode.Disposable(() => {}) } as unknown as vscode.WebviewView;
        const cancellation = new vscode.CancellationTokenSource();
        subscriptions.push(cancellation);
        provider.resolveWebviewView(view, { state: undefined }, cancellation.token);
        return { messages, webview, send: (message: unknown) => handleMessage(message) };
    }

    async function waitFor(messages: any[], predicate: (message: any) => boolean, start = 0) {
        const deadline = Date.now() + 5000;
        while (!messages.slice(start).some(predicate)) {
            assert.ok(Date.now() < deadline, 'Sidebar did not finish loading');
            await new Promise(resolve => setTimeout(resolve, 10));
        }
    }

    test('keeps installed packages visible when update lookup fails and includes the font asset', async () => {
        const view = createView({ updateError: new Error('index unavailable') });
        await waitFor(view.messages, message => message.type === 'checkingUpdates' && !message.value);
        assert.ok(view.messages.some(message => message.type === 'packages' && message.backend === 'uv'));
        assert.ok(!view.messages.some(message => message.type === 'error'));
        assert.ok(view.webview.html.includes('codicon.ttf'));
    });

    test('reports list errors and clears both loading indicators', async () => {
        const view = createView({ listError: new Error('uv could not start') });
        await waitFor(view.messages, message => message.type === 'error');
        assert.ok(view.messages.some(message => message.message === 'Failed to load packages: uv could not start'));
        assert.ok(view.messages.some(message => message.type === 'loading' && !message.value));
        assert.ok(view.messages.some(message => message.type === 'checkingUpdates' && !message.value));
    });

    test('dispatches refresh and ignores unknown or inherited message names', async () => {
        const view = createView();
        await waitFor(view.messages, message => message.type === 'checkingUpdates' && !message.value);
        const count = view.messages.length;
        await view.send({ type: 'unknown' });
        await view.send({ type: 'toString' });
        assert.strictEqual(view.messages.length, count);
        await view.send({ type: 'refresh' });
        assert.strictEqual(view.messages[count].type, 'loading');
        await waitFor(view.messages, message => message.type === 'checkingUpdates' && !message.value, count);
    });

    test('requires an explicit action before using the global interpreter', async () => {
        const view = createView({ python: '' });
        await waitFor(view.messages, message => message.type === 'environmentEmpty');
        assert.ok(view.messages.some(message => message.type === 'environmentEmpty' && message.canUseGlobal));
        assert.ok(!view.messages.some(message => message.type === 'packages'));
        await view.send({ type: 'useGlobalPython' });
        await waitFor(view.messages, message => message.type === 'packages');
        await waitFor(view.messages, message => message.type === 'checkingUpdates' && !message.value);
    });
});
