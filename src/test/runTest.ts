import * as path from 'path';
import * as fs from 'fs';
import { execFileSync } from 'child_process';

import { downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath, runTests } from '@vscode/test-electron';

async function main() {
	const extensionDevelopmentPath = path.resolve(__dirname, '../../');
	const testRoot = path.join(extensionDevelopmentPath, '.vscode-test');
	fs.mkdirSync(testRoot, { recursive: true });
	const workspace = fs.mkdtempSync(path.join(testRoot, 'uv workspace-'));
	const userData = path.join(workspace, 'user-data');
	try {
		const uv = process.env.PYDEP_TEST_UV || 'uv';
		const uvCache = path.join(workspace, 'uv-cache');
		execFileSync(uv, ['venv', '--no-python-downloads', path.join(workspace, '.venv')], {
			windowsHide: true, env: { ...process.env, UV_CACHE_DIR: uvCache }
		});
		const python = path.join(workspace, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
		execFileSync(python, [path.join(extensionDevelopmentPath, 'src/test/fixtures/build_wheels.py'), workspace], { windowsHide: true });
		fs.mkdirSync(path.join(workspace, '.vscode'));
		fs.writeFileSync(path.join(workspace, '.vscode/settings.json'), JSON.stringify({
			'python.defaultInterpreterPath': python,
			'pydep-pilot.packageManager': 'auto'
		}));
		fs.mkdirSync(path.join(userData, 'User'), { recursive: true });
		fs.writeFileSync(path.join(userData, 'User/settings.json'), JSON.stringify({
			'extensions.autoUpdate': false,
			'extensions.autoCheckUpdates': false,
			'telemetry.telemetryLevel': 'off'
		}));
		const vscodeExecutablePath = process.env.VSCODE_EXECUTABLE_PATH || await downloadAndUnzipVSCode(process.env.VSCODE_TEST_VERSION || '1.108.1');
		const extensionsDir = path.join(testRoot, 'extensions');
		const [cli, ...cliArgs] = resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath);
		const installed = fs.existsSync(extensionsDir) && fs.readdirSync(extensionsDir).some(name => name.startsWith('ms-python.python-'));
		if (!installed) {
			// Invoke the Windows CLI through Electron's Node mode to preserve spaced paths without a shell.
			const windows = process.platform === 'win32';
			const executable = windows ? vscodeExecutablePath : cli;
			const args = windows
				? [path.join(path.dirname(vscodeExecutablePath), 'resources/app/out/cli.js')]
				: cliArgs;
			execFileSync(executable, [...args, '--extensions-dir', extensionsDir, '--user-data-dir', userData, '--install-extension', 'ms-python.python'], {
				stdio: 'inherit', windowsHide: true,
				env: windows ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' } : process.env
			});
		}
		const extensionTestsPath = path.resolve(__dirname, './suite/index');
		await runTests({
			vscodeExecutablePath, extensionDevelopmentPath, extensionTestsPath,
			launchArgs: [workspace, '--extensions-dir', extensionsDir, '--user-data-dir', userData, '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust'],
			extensionTestsEnv: { PYDEP_TEST_WORKSPACE: workspace, PYDEP_TEST_UV: uv, UV_CACHE_DIR: uvCache }
		});
	} catch (err) {
		console.error('Failed to run tests (uv and a local Python installation are required):', err);
		process.exitCode = 1;
	} finally {
		// Delete only the unique test directory created by this run.
		const relative = path.relative(testRoot, workspace);
		if (relative.startsWith('uv workspace-') && !relative.includes(path.sep)) {
			try {
				await fs.promises.rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
			} catch (error) {
				// Windows crash reporting can retain a lock after the test host exits.
				// Preserve the test result and identify the disposable directory for cleanup.
				console.warn(`Could not remove temporary test workspace ${workspace}:`, error);
			}
		}
	}
}

main();
