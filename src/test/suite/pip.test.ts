import * as assert from 'assert';
import * as vscode from 'vscode';
import { PackageManager } from '@/modules/PackageManager';
import { ExtensionAPI } from '@/extension';

suite('Extension Pip Test Suite', function () {
	this.timeout(10000);
	const timers: NodeJS.Timeout[] = [];
	let pip: PackageManager;

	test('pydep-pilot ready', (done) => {
		(async () => {
			await new Promise((resolve) => {
				const checkPyDepPilot = () => {
					const pyDepPilot = vscode.extensions.getExtension<ExtensionAPI>('DABWorx.pydep-pilot');
					if (pyDepPilot && pyDepPilot.isActive) {
						pip = pyDepPilot.exports?.pip;
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

	test('have pip api', () => {
		assert.strictEqual(true, !!pip);
	});

	test('pip api: create package info',() => {
		let info = pip._test_createPackageInfo('test==0.0.1');
		assert.strictEqual('test', info?.name);
		assert.strictEqual('0.0.1', info?.version);
		assert.strictEqual('test==0.0.1', info?.toString());

		info = pip._test_createPackageInfo('test2');
		assert.strictEqual('test2', info?.name);
		assert.strictEqual(undefined, info?.version);

		info = pip._test_createPackageInfo({ name: 'test3', version: '0.0.2' });
		assert.strictEqual('test3', info?.name);
		assert.strictEqual('0.0.2', info?.version);
		assert.strictEqual('test3==0.0.2', info?.toString());

		info = pip._test_createPackageInfo({ name: 'test4' });
		assert.strictEqual('test4', info?.name);
		assert.strictEqual(undefined, info?.version);

		info = pip._test_createPackageInfo('');
		assert.strictEqual(null, info);

		info = pip._test_createPackageInfo({ name: '' });
		assert.strictEqual(null, info);
	});

	test('pip api: list', (done) => {
		(async () => {
			const packageList  = await pip.getPackageList();
			assert.strictEqual(true, JSON.stringify(packageList).includes('pip'));
		})().then(done).catch(done);
	});
	test('pip api: list with update', (done) => {
		(async () => {
			const packageList  = await pip.getPackageListWithUpdate();
			assert.strictEqual(true, JSON.stringify(packageList).includes('pip'));
		})().then(done).catch(done);
	});

	suiteTeardown(() => {
		timers.forEach((timer) => {
			clearInterval(timer);
		});
	});
});
