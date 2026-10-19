import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import { execFileSync } from 'child_process';
import * as vscode from 'vscode';
import type { ExtensionAPI } from '@/extension';
import type { PackageManager } from '@/modules/PackageManager';

suite('uv environment operations', function () {
    this.timeout(30000);
    const workspace = process.env.PYDEP_TEST_WORKSPACE;
    let manager: PackageManager;
    let server: http.Server;
    let python: string;
    let config: vscode.WorkspaceConfiguration;
    const name = 'pydep-test-package';

    suiteSetup(async function () {
        // Debugger runs without the isolated fixture must not modify a user's interpreter.
        if (!workspace) {
            this.skip();
            return;
        }
        python = path.join(workspace, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
        const wheels = path.join(workspace, 'wheels');
        const files = fs.readdirSync(wheels);
        server = http.createServer((request, response) => {
            const file = files.find(item => request.url === `/${item}`);
            if (file) {
                response.setHeader('Content-Type', 'application/octet-stream');
                fs.createReadStream(path.join(wheels, file)).pipe(response);
            } else if (request.url === `/simple/${name}/`) {
                response.setHeader('Content-Type', 'text/html');
                response.end(files.map(item => `<a href="/${item}">${item}</a>`).join('\n'));
            } else {
                response.writeHead(404).end();
            }
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const address = server.address() as { port: number };
        const extension = vscode.extensions.getExtension<ExtensionAPI>('DABWorx.pydep-pilot');
        assert.ok(extension);
        manager = (await extension.activate()).pip;
        config = vscode.workspace.getConfiguration('pydep-pilot');
        await config.update('uvPath', process.env.PYDEP_TEST_UV || 'uv', vscode.ConfigurationTarget.Global);
        await config.update('customPypiUrl', `http://127.0.0.1:${address.port}/simple`, vscode.ConfigurationTarget.Workspace);
        manager.updatePythonPath(python);
    });

    suiteTeardown(async () => {
        if (server) {
            await new Promise<void>(resolve => server.close(() => resolve()));
        }
    });

    test('auto detects uv and lists an empty environment without pip', async () => {
        assert.strictEqual(await manager.getActiveBackend(), 'uv');
        assert.deepStrictEqual(await manager.getPackageList(), []);
    });

    test('installs a specific version', async () => {
        await manager.addPackage(`${name}==1.0.0`);
        assert.deepStrictEqual(await manager.getPackageList(), [{ name, version: '1.0.0' }]);
    });

    test('checks updates through the custom index and merges latest versions', async () => {
        const packages = await manager.getPackageListWithUpdate();
        assert.deepStrictEqual(packages, [{ name, version: '1.0.0', latestVersion: '2.0.0' }]);
    });

    test('upgrades then selects an older version', async () => {
        await manager.updatePackage(name);
        assert.strictEqual((await manager.getPackageList())[0].version, '2.0.0');
        await manager.updatePackage({ name, version: '1.0.0' });
        assert.strictEqual((await manager.getPackageList())[0].version, '1.0.0');
    });

    test('imports requirements with spaces in the path and exports installed versions', async () => {
        const requirements = path.join(workspace!, 'test requirements.txt');
        fs.writeFileSync(requirements, `${name}==2.0.0\n`);
        await manager.addPackageFromFile(requirements);
        assert.strictEqual(await manager.freezePackages(), `${name}==2.0.0`);
    });

    test('uninstalls without pip confirmation flags', async () => {
        await manager.removePackage(name);
        assert.deepStrictEqual(await manager.getPackageList(), []);
    });

    test('pip override and missing uv fallback can recover after settings change', async () => {
        await config.update('packageManager', 'pip', vscode.ConfigurationTarget.Workspace);
        assert.strictEqual(await manager.getActiveBackend(), 'pip');
        await config.update('packageManager', 'uv', vscode.ConfigurationTarget.Workspace);
        assert.strictEqual(await manager.getActiveBackend(), 'uv');
        await config.update('uvPath', path.join(workspace!, 'missing-uv'), vscode.ConfigurationTarget.Global);
        assert.strictEqual(await manager.getActiveBackend(), 'pip');
        await config.update('uvPath', process.env.PYDEP_TEST_UV || 'uv', vscode.ConfigurationTarget.Global);
        assert.strictEqual(await manager.getActiveBackend(), 'uv');
        await config.update('packageManager', 'auto', vscode.ConfigurationTarget.Workspace);
    });

    test('auto keeps stdlib environments on pip; uv can be explicitly selected', async () => {
        const stdlib = path.join(workspace!, 'stdlib venv');
        execFileSync(python, ['-m', 'venv', '--without-pip', stdlib], { windowsHide: true });
        const stdlibPython = path.join(stdlib, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
        manager.updatePythonPath(stdlibPython);
        assert.strictEqual(await manager.getActiveBackend(), 'pip');
        await config.update('packageManager', 'uv', vscode.ConfigurationTarget.Workspace);
        assert.strictEqual(await manager.getActiveBackend(), 'uv');
        await manager.addPackage(`${name}==1.0.0`);
        assert.strictEqual((await manager.getPackageList())[0].version, '1.0.0');
        manager.updatePythonPath(python);
        assert.deepStrictEqual(await manager.getPackageList(), []);
        await config.update('packageManager', 'auto', vscode.ConfigurationTarget.Workspace);
    });
});
