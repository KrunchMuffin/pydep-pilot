// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { PackageWebviewProvider } from './modules/PackageWebviewProvider';
import { PythonExtension } from './modules/PythonExtension';
import { PackageManager, necessaryPackage } from './modules/PackageManager';
import { i18n } from './common/i18n/localize';
import * as path from 'path';
import { ServiceCollection } from './common/ioc/common/serviceCollection';
import { InstantiationService } from './common/ioc';
import { IOutputChannel, IExtensionContext } from './interface/common';
import { CommandTool } from './modules/CommandTool';

export interface ExtensionAPI {
	pip: PackageManager
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
	// start register services
	const services = new ServiceCollection();
	const instantiationService = new InstantiationService(services);
	const outputChannel: IOutputChannel = vscode.window.createOutputChannel('PyDepPilot');
	outputChannel.clear();

	services.set(IExtensionContext, context);
	services.set(IOutputChannel, outputChannel);

	const commandTool = CommandTool.Create(instantiationService, services);

	commandTool.registerEmptyCommand([
		'pydep-pilot.addPackage',
		'pydep-pilot.refreshPackage',
		'pydep-pilot.searchPackage',
	]);


	outputChannel.appendLine('PyDepPilot Start');

	const pythonExtension = PythonExtension.Create(instantiationService, services);
	const hasPython = await pythonExtension.waitPythonExtensionInited();

	const pythonPath = pythonExtension.pythonPath;
	if (hasPython) {
		outputChannel.appendLine(`PyDepPilot Got python path at ${pythonPath}`);
	} else {
		outputChannel.appendLine('PyDepPilot: No Python interpreter found. Please select one using the Python extension.');
	}

	const pip = PackageManager.Create(instantiationService, services, pythonPath);
	const packageWebviewProvider = PackageWebviewProvider.Create(instantiationService, services);

	pythonExtension.onPythonPathChange((newPythonPath)=>{
		pip.updatePythonPath(newPythonPath);
		packageWebviewProvider.refresh();
	});

	// Register webview provider
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider('pydep-pilot-installed', packageWebviewProvider)
	);

	// after services registered

	async function addPackage(name?: string){
		if(name){
			outputChannel.clear();
			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: i18n.localize('pydep-pilot.tip.addPackage', 'Installing package %0%', `${name}`),
				cancellable: true,
			}, async (progress, cancelToken) => {
				await pip.addPackage(name, cancelToken);
				packageWebviewProvider.refresh();
			});
		}
	}

	async function updatePackage(name?: string){
		if(name){
			outputChannel.clear();
			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: i18n.localize('pydep-pilot.tip.updatePackage', 'Updating package %0%', `${name}`),
				cancellable: true,
			}, async (progress, cancelToken) => {
				await pip.updatePackage(name, cancelToken);
				packageWebviewProvider.refresh();
			});
		}
	}

	function checkRemovePackage(name: string) {
		if (necessaryPackage.includes(name)) {
			vscode.window.showWarningMessage(i18n.localize('pydep-pilot.tip.disableRemove', 'Package %0% cannot be removed',`${necessaryPackage}`));
			return false;
		}
		return true;
	}

	// ======================

	commandTool.registerCommand('pydep-pilot.refreshPackage', () => {
		packageWebviewProvider.refresh();
	});

	commandTool.registerCommand('pydep-pilot.addPackage', async (name?: string) => {
		let value = '';
		if(name){
			value  = name;
		}else{
			value = await vscode.window.showInputBox({ title: i18n.localize('pydep-pilot.input.addPackage', 'Enter package name to install') }) || '';
		}
		await addPackage(value);
	});

	commandTool.registerCommand('pydep-pilot.updatePackage', async (name?: string) => {
		if(!name) {
			return;
		}
		await updatePackage(name);
	});

	commandTool.registerCommand('pydep-pilot.removePackage', async (name?: string) => {
		let value = '';
		if(!name){
			value = await vscode.window.showInputBox({ title: i18n.localize('pydep-pilot.input.removePackage', 'Enter package name to remove') }) || '';
		}else{
			value = name;
		}

		if (!(value && checkRemovePackage(value.split('==')[0]))) {
			return false;
		}
		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: i18n.localize('pydep-pilot.tip.removePackage', 'Removing package %0%', `${value}`),
		}, async () => {
			await pip.removePackage(value);
			packageWebviewProvider.refresh();
		});
		return true;
	});

	commandTool.registerCommand('pydep-pilot.packageDescription', async (name?: string) => {
		let value = '';
		if (!name) {
			value = await vscode.window.showInputBox({ title: i18n.localize('pydep-pilot.input.packageDescription', 'Enter package name to view') }) || '';
		} else {
			value = name;
		}
		if (!value) {
			return;
		}
		vscode.env.openExternal(vscode.Uri.parse(`https://pypi.org/project/${value}/`));
	});

	commandTool.registerCommand('pydep-pilot.copyPackageName', async (name?: string) => {
		if (!name) {
			return;
		}
		await vscode.env.clipboard.writeText(name);
	});

	commandTool.registerCommand('pydep-pilot.installRequirements', async (e?: vscode.Uri) => {
		if (!e) {
			return;
		}
		const filePath = e.fsPath;
		if (!filePath) {
			return;
		}
		outputChannel.clear();
		vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: i18n.localize('pydep-pilot.tip.addPackageFromFile', 'Installing packages from %0%', path.basename(filePath)),
			cancellable: true,
		}, async (progress, cancelToken) => {
			await pip.addPackageFromFile(filePath, cancelToken);
			packageWebviewProvider.refresh();
		});
	});

	commandTool.registerCommand('pydep-pilot.searchPackage', async () => {
		const query = await vscode.window.showInputBox({
			title: i18n.localize('pydep-pilot.pick.search.defaultTitle', 'Search PyPI'),
			placeHolder: i18n.localize('pydep-pilot.pick.search.placeholder', 'Enter package name to search'),
		});
		if (query) {
			vscode.env.openExternal(vscode.Uri.parse(`https://pypi.org/search/?q=${encodeURIComponent(query)}`));
		}
	});

	commandTool.registerCommand('pydep-pilot.pickPackageVersion', async (name?: string, version?: string) => {
		let pack = '';
		if(!name){
			pack = await vscode.window.showInputBox({ title: i18n.localize('pydep-pilot.input.pickPackageVersion', 'Enter package name to select version') }) || '';
		}else{
			pack = name;
		}

		pack = pack.split('==')[0];
		if (!(pack)) {
			return false;
		}

		let versionList: string[] = [];

		outputChannel.clear();
		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: i18n.localize('pydep-pilot.tip.pickPackageVersion', 'Fetching versions for %0%', `${pack}`),
			cancellable: true,
		}, async (progress, cancelToken) => {
			versionList = await pip.getPackageVersionList(pack, cancelToken);
		});

		if (!versionList.length) {
			vscode.window.showInformationMessage(i18n.localize('pydep-pilot.tip.noPackageVersion', 'No versions found for %0%', `${pack}`));
			return;
		}

		const quickPickItems: vscode.QuickPickItem[] = versionList.map((item)=>{
			const picked = (version && version === item) || false;
			return {
				label: item,
				alwaysShow: true,
				description: picked ?
					i18n.localize('pydep-pilot.tip.currentVersion','%0% (current)', pack) :
					undefined,
				picked,
			};
		});

		const selectedVersion = await new Promise<vscode.QuickPickItem | null>((resolve, reject) => {
			const qPick = vscode.window.createQuickPick();
			let value: vscode.QuickPickItem | null = null;
			qPick.title = i18n.localize('pydep-pilot.tip.selectPackageVersion', 'Select version for %0%', `${pack}`);
			qPick.placeholder = version;
			qPick.items = quickPickItems;
			qPick.activeItems = quickPickItems.filter((item) => item.picked);

			qPick.onDidChangeSelection((e) => {
				value = e[0];
				qPick.hide();
			});
			qPick.onDidHide(() => {
				resolve(value);
				qPick.dispose();
			});

			qPick.show();
		});

		if (selectedVersion && selectedVersion.label !== version) {
			vscode.commands.executeCommand('pydep-pilot.addPackage', `${pack}==${selectedVersion.label}`);
		}
	});

	return { pip } as ExtensionAPI;
}

// this method is called when your extension is deactivated
export function deactivate() {}
