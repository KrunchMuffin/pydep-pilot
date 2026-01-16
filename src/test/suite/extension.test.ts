import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
// import * as myExtension from '../../extension';

suite('Extension Test Suite', function () {
	this.timeout(10000);
	vscode.window.showInformationMessage('Start all tests.');
	const timers: NodeJS.Timeout[] = [];

	test('pydep-pilot ready', (done) => {
		(async () => {
			await new Promise((resolve) => {
				const checkPyDepPilot = () => {
					const pyDepPilot = vscode.extensions.getExtension('KrunchMuffin.pydep-pilot');
					if (pyDepPilot && pyDepPilot.isActive) {
						resolve(undefined);
					}
				};
				checkPyDepPilot();
				const timer = setInterval(() => {
					checkPyDepPilot();
				}, 400);
				timers.push(timer);
			});
		})().then(done).catch(done);
	});

	test('refreshPackage', (done) => {
		(async () => {
			await vscode.commands.executeCommand('pydep-pilot.refreshPackage');
		})().then(done).catch(done);
	});

	test('addPackage', (done) => {
		(async () => {
			await vscode.commands.executeCommand('pydep-pilot.addPackage', 'pyserial');
		})().then(done).catch(done);
	});
	test('removePackage', (done) => {
		(async () => {
			assert.strictEqual(false, await vscode.commands.executeCommand('pydep-pilot.removePackage', { name: 'pip' }));
			assert.strictEqual(true, await vscode.commands.executeCommand('pydep-pilot.removePackage', { name: 'pyserial' }));
		})().then(done).catch(done);
	});

	test('addPackage again', (done) => {
		(async () => {
			await vscode.commands.executeCommand('pydep-pilot.addPackage', 'pyserial');
		})().then(done).catch(done);
	});
	test('copyPackageName', (done) => {
		(async () => {
			await vscode.commands.executeCommand('pydep-pilot.copyPackageName', { name: 'pyserial' });
			assert.strictEqual('pyserial', await vscode.env.clipboard.readText());
		})().then(done).catch(done);
	});

	suiteTeardown(() => {
		timers.forEach((timer) => {
			clearInterval(timer);
		});
	});
});
