import * as assert from 'assert';
import * as vscode from 'vscode';
import type { ExtensionAPI } from '@/extension';

suite('Package Manager API', function () {
	this.timeout(30000);
	test('parses package names and exact versions', async () => {
		const extension = vscode.extensions.getExtension<ExtensionAPI>('DABWorx.pydep-pilot');
		assert.ok(extension);
		const { pip } = await extension.activate();
		const parse = pip._test_createPackageInfo;
		assert.strictEqual(parse('six==1.16.0')?.toString(), 'six==1.16.0');
		assert.strictEqual(parse({ name: 'six', version: '1.17.0' })?.toString(), 'six==1.17.0');
		assert.strictEqual(parse('six')?.version, undefined);
		assert.strictEqual(parse(''), null);
		assert.strictEqual(parse({ name: '' }), null);
	});
});
