// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { PackageWebviewProvider } from './modules/PackageWebviewProvider';
import { PythonExtension } from './modules/PythonExtension';
import { PackageManager, necessaryPackage } from './modules/PackageManager';
import { i18n } from './common/i18n/localize';
import axios from 'axios';
import * as path from 'path';
import { ServiceCollection } from './common/ioc/common/serviceCollection';
import { InstantiationService } from './common/ioc';
import { IOutputChannel, IExtensionContext } from './interface/common';
import trace from './common/trace';
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
		const qPick = vscode.window.createQuickPick();

		let rBusy = 0;
		let timer: NodeJS.Timeout;
		let lastCancelToken: vscode.CancellationTokenSource | undefined;

		qPick.busy = true;
		qPick.show();
		const defaultTitle = i18n.localize('pydep-pilot.pick.search.defaultTitle', 'Search PyPI');
		qPick.title = defaultTitle;
		qPick.placeholder = i18n.localize('pydep-pilot.pick.search.placeholder', 'Enter package name to search');

		const btnTable = {
			dot: { iconPath: new vscode.ThemeIcon('debug-stackframe-dot') },
			left: { iconPath: new vscode.ThemeIcon('arrow-left'), tooltip: i18n.localize('pydep-pilot.pick.search.preBtn', 'Previous page') },
			right: { iconPath: new vscode.ThemeIcon('arrow-right'), tooltip: i18n.localize('pydep-pilot.pick.search.nextBtn', 'Next page') },
		};

		function clearSteps() {
			qPick.step = 0;
			qPick.totalSteps = 0;
			qPick.buttons = [];
		}

		function setStep(step: number, totalSteps?: number) {
			qPick.step = step;
			if(totalSteps){
				qPick.totalSteps = totalSteps;
			}
			let preBtn,nextBtn;
			if(qPick.step === 1){
				preBtn = btnTable.dot;
			}else {
				preBtn = btnTable.left;
			}
			if(qPick.step === qPick.totalSteps){
				nextBtn = btnTable.dot;
			}else{
				nextBtn = btnTable.right;
			}
			qPick.buttons = [preBtn,nextBtn];
		}

		async function updateItemList(value: string, page: number, clear = true) {
			if(lastCancelToken){
				lastCancelToken.cancel();
			}
			const cancelToken = new vscode.CancellationTokenSource();
			lastCancelToken = cancelToken;
			rBusy++;
			qPick.busy = !!rBusy;

			try {
				if (value) {
					qPick.title = i18n.localize('pydep-pilot.pick.search.resultTitle', 'Results for %0%', `${value}`);;
				} else {
					qPick.title = defaultTitle;
				}
				if(clear){
					clearSteps();
				}else{
					setStep(page);
				}
				const data = await pip.searchFromPyPi(value, page, cancelToken.token);
				qPick.items = data.list;
				setStep(page,data.totalPages);
				qPick.step = page;
				qPick.totalSteps = data.totalPages;
			} catch (err) {
				if(!axios.isCancel(err)) {
					qPick.title = i18n.localize('pydep-pilot.pick.search.noResultTitle', 'No results found');
					qPick.items = [];
					qPick.step = 0;
					qPick.totalSteps = 0;
				}
			}
			cancelToken.dispose();
			rBusy--;
			qPick.busy = !!rBusy;
		}

		qPick.onDidChangeValue((value: string) => {
			clearTimeout(timer);
			timer = setTimeout(() => {
				updateItemList(value, 1);
			}, 300);
		});

		qPick.onDidChangeSelection((data) => {
			const item = data[0];
			qPick.hide();
			const value = item.label;
			addPackage(value);
		});

		qPick.onDidTriggerButton((e) => {
			if (e === btnTable.left) {
				updateItemList(qPick.value, (qPick.step || 0) - 1, false);
			}
			if (e === btnTable.right) {
				updateItemList(qPick.value, (qPick.step || 0) + 1, false);
			}
		});

		qPick.onDidHide(() => {
			qPick.dispose();
			lastCancelToken?.dispose();
		});

		updateItemList('', 1);
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
