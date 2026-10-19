import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', function () {
	this.timeout(30000);

	test('activates and registers package commands', async () => {
		const extension = vscode.extensions.getExtension('DABWorx.pydep-pilot');
		assert.ok(extension);
		await extension.activate();
		assert.ok(extension.isActive);
		const commands = await vscode.commands.getCommands(true);
		for (const command of ['addPackage', 'removePackage', 'updatePackage', 'refreshPackage', 'installRequirements', 'pickPackageVersion']) {
			assert.ok(commands.includes(`pydep-pilot.${command}`), command);
		}
	});
});
