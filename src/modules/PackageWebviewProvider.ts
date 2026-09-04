import * as vscode from 'vscode';
import { createDecorator, InstantiationService, ServiceCollection } from '@/common/ioc';
import { IPackageManager, PackageVersionInfo } from './PackageManager';
import { BackendKind } from './PackageBackend';
import { IPythonExtension } from './PythonExtension';
import { IExtensionContext } from '@/interface/common';

export interface IPackageWebviewProvider extends vscode.WebviewViewProvider {
    refresh(): void;
}

export const IPackageWebviewProvider = createDecorator<IPackageWebviewProvider>('packageWebviewProvider');

interface WebviewMessage {
    type: string;
    payload?: any;
}

interface EnvironmentEmptyState {
    message: string;
    hint: string;
    canUseGlobal: boolean;
}

export class PackageWebviewProvider implements IPackageWebviewProvider {
    private _view?: vscode.WebviewView;
    private _packages: PackageVersionInfo[] = [];
    private _isLoading: boolean = false;
    private _hasRequirements: boolean = false;
    private _backend: BackendKind = 'pip';
    private _emptyState?: EnvironmentEmptyState;
    private _allowGlobalPython: boolean = false;

    constructor(
        @IPackageManager private readonly pip: IPackageManager,
        @IPythonExtension private readonly pythonExt: IPythonExtension,
        @IExtensionContext private readonly context: IExtensionContext
    ) {}

    static Create(instantiation: InstantiationService, service?: ServiceCollection) {
        const instance = instantiation.createInstance<IPackageWebviewProvider>(PackageWebviewProvider);
        if (service) {
            service.set(IPackageWebviewProvider, instance);
        }
        return instance;
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void | Thenable<void> {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.context.extensionUri, 'media'),
                vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', '@vscode', 'codicons', 'dist')
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(
            (message: WebviewMessage) => this._handleMessage(message),
            undefined,
            this.context.subscriptions
        );

        // Re-send state when webview becomes visible again
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                this._syncState();
            }
        });

        // Load packages when view first becomes visible
        this.refresh();
    }

    private _syncState(): void {
        // Re-send current state to webview after visibility change
        if (this._isLoading) {
            this._postMessage({ type: 'loading', value: true });
        } else if (this._emptyState) {
            this._postMessage({ type: 'environmentEmpty', ...this._emptyState });
        } else {
            this._postMessage({
                type: 'packages',
                data: this._packages,
                hasRequirements: this._hasRequirements,
                backend: this._backend
            });
        }
    }

    public refresh(): void {
        this._loadPackages();
    }

    private async _loadPackages(): Promise<void> {
        if (!this._view) {
            return;
        }

        this._isLoading = true;
        this._postMessage({ type: 'loading', value: true });

        try {
            const workspaceFolder = this._getPreferredWorkspaceFolder();
            const workspaceUri = workspaceFolder?.uri;
            const currentPythonPath = this.pythonExt.getPythonPath(workspaceUri, {
                allowGlobal: this._allowGlobalPython
            });
            this._emptyState = undefined;

            if (!currentPythonPath) {
                this._emptyState = await this._getEnvironmentEmptyState(workspaceFolder);
                // No project-scoped Python environment found.
                this._isLoading = false;
                this._postMessage({ type: 'loading', value: false });
                this._postMessage({
                    type: 'environmentEmpty',
                    ...this._emptyState
                });
                return;
            }

            this.pip.updatePythonPath(currentPythonPath);
            this._backend = await this.pip.getActiveBackend();

            // First, get the package list quickly and display it
            this._packages = await this.pip.getPackageList();
            this._hasRequirements = !!(await this._findRequirementsFile(workspaceFolder?.uri));

            // Send packages immediately so UI shows them
            this._postMessage({
                type: 'packages',
                data: this._packages,
                hasRequirements: this._hasRequirements,
                backend: this._backend
            });

            // Mark loading as done for the initial list
            this._isLoading = false;
            this._postMessage({ type: 'loading', value: false });

            // Now check update metadata once through pip so we respect the configured package index.
            this._postMessage({ type: 'checkingUpdates', value: true });
            try {
                const updateInfo = await this.pip.getPackageUpdate();
                this._packages = this.pip.mergePackageListWithUpdate(this._packages, updateInfo);
                this._postMessage({
                    type: 'packages',
                    data: this._packages,
                    hasRequirements: this._hasRequirements,
                    backend: this._backend
                });
            } catch {
                // Keep the installed package list visible even when update lookup fails.
            }

            this._postMessage({ type: 'checkingUpdates', value: false });
        } catch (error: any) {
            const errorMessage = error?.message || String(error);
            const lowerError = errorMessage.toLowerCase();
            this._emptyState = undefined;
            this._postMessage({
                type: 'error',
                message: lowerError.includes('python') || lowerError.includes('pip') || lowerError.includes('interpreter')
                    ? 'No Python interpreter selected. Please select a Python interpreter using the Python extension.'
                    : `Failed to load packages: ${errorMessage}`
            });
            this._isLoading = false;
            this._postMessage({ type: 'loading', value: false });
            this._postMessage({ type: 'checkingUpdates', value: false });
        }
    }

    private async _handleMessage(message: WebviewMessage): Promise<void> {
        switch (message.type) {
            case 'refresh':
                this.refresh();
                break;

            case 'updateSelected':
                await this._updatePackages(message.payload as string[]);
                break;

            case 'updateSingle':
                await this._updateSinglePackage(message.payload as string);
                break;

            case 'remove':
                await this._removePackage(message.payload as string);
                break;

            case 'openPyPI':
                const packageName = message.payload as string;
                vscode.env.openExternal(vscode.Uri.parse(`https://pypi.org/project/${packageName}/`));
                break;

            case 'addPackage':
                vscode.commands.executeCommand('pydep-pilot.addPackage');
                break;

            case 'searchPackage':
                vscode.commands.executeCommand('pydep-pilot.searchPackage');
                break;

            case 'installRequirements':
                await this._installRequirements();
                break;

            case 'selectPython':
                this._allowGlobalPython = false;
                vscode.commands.executeCommand('python.setInterpreter');
                break;

            case 'useGlobalPython':
                this._allowGlobalPython = true;
                this.refresh();
                break;

            case 'createVenv':
                this._allowGlobalPython = false;
                await this._createVenv();
                break;

            case 'pickVersion':
                const { name, version } = message.payload as { name: string; version: string };
                vscode.commands.executeCommand('pydep-pilot.pickPackageVersion', name, version);
                break;

            case 'exportRequirements':
                await this._exportRequirements();
                break;
        }
    }

    private _getWorkspaceFolders(resource?: vscode.Uri): vscode.WorkspaceFolder[] {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders?.length) {
            return [];
        }

        const hasExplicitResource = !!resource;
        const activeResource = resource || vscode.window.activeTextEditor?.document.uri;
        const preferredFolder = activeResource
            ? vscode.workspace.getWorkspaceFolder(activeResource)
            : undefined;

        if (!preferredFolder) {
            return hasExplicitResource ? [] : [...workspaceFolders];
        }

        if (hasExplicitResource) {
            return [preferredFolder];
        }

        return [
            preferredFolder,
            ...workspaceFolders.filter(folder => folder.uri.toString() !== preferredFolder.uri.toString())
        ];
    }

    private _getPreferredWorkspaceFolder(resource?: vscode.Uri): vscode.WorkspaceFolder | undefined {
        return this._getWorkspaceFolders(resource)[0];
    }

    private async _getEnvironmentEmptyState(workspaceFolder?: vscode.WorkspaceFolder): Promise<EnvironmentEmptyState> {
        const canUseGlobal = !!this.pythonExt.getPythonPath(workspaceFolder?.uri, { allowGlobal: true });

        if (!workspaceFolder) {
            return {
                message: 'No Python workspace is open.',
                hint: canUseGlobal
                    ? 'Open a Python project, select a workspace interpreter, or use the selected global interpreter.'
                    : 'Open a Python project or select a Python interpreter first.',
                canUseGlobal
            };
        }

        const isPythonProject = await this._looksLikePythonProject(workspaceFolder.uri);
        if (!isPythonProject) {
            return {
                message: `${workspaceFolder.name} does not look like a Python project.`,
                hint: canUseGlobal
                    ? 'Open a Python project, or use the selected global interpreter to view global packages.'
                    : 'Open a Python project or select a Python interpreter first.',
                canUseGlobal
            };
        }

        return {
            message: `No project Python environment found in ${workspaceFolder.name}.`,
            hint: canUseGlobal
                ? 'Create a .venv folder, select a workspace interpreter, or use the selected global interpreter.'
                : 'Create a .venv folder or select a workspace interpreter.',
            canUseGlobal
        };
    }

    private async _looksLikePythonProject(workspaceUri: vscode.Uri): Promise<boolean> {
        const markerFiles = [
            'pyproject.toml',
            'requirements.txt',
            'setup.py',
            'setup.cfg',
            'Pipfile',
            'poetry.lock',
            'uv.lock',
            'environment.yml',
            'environment.yaml',
            '.python-version'
        ];

        for (const markerFile of markerFiles) {
            try {
                await vscode.workspace.fs.stat(vscode.Uri.joinPath(workspaceUri, markerFile));
                return true;
            } catch {
                // Marker does not exist in this folder.
            }
        }

        const pythonFiles = await vscode.workspace.findFiles(
            new vscode.RelativePattern(workspaceUri, '**/*.py'),
            '{**/.venv/**,**/venv/**,**/.env/**,**/env/**,**/node_modules/**,**/.git/**}',
            1
        );
        return pythonFiles.length > 0;
    }

    private async _findRequirementsFile(resource?: vscode.Uri): Promise<vscode.Uri | undefined> {
        for (const folder of this._getWorkspaceFolders(resource)) {
            const reqFile = vscode.Uri.joinPath(folder.uri, 'requirements.txt');
            try {
                await vscode.workspace.fs.stat(reqFile);
                return reqFile;
            } catch {
                // File doesn't exist in this folder, continue.
            }
        }
        return undefined;
    }

    private async _exportRequirements(): Promise<void> {
        const workspaceFolder = this._getPreferredWorkspaceFolder();

        if (!workspaceFolder) {
            // No workspace - ask user where to save
            const uri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file('requirements.txt'),
                filters: { 'Text files': ['txt'] }
            });
            if (!uri) {
                return;
            }
            await this._writeRequirementsFile(uri);
            return;
        }

        // Check if requirements.txt already exists
        const reqFile = vscode.Uri.joinPath(workspaceFolder.uri, 'requirements.txt');
        let fileExists = false;
        try {
            await vscode.workspace.fs.stat(reqFile);
            fileExists = true;
        } catch {
            // File doesn't exist
        }

        if (fileExists) {
            const choice = await vscode.window.showWarningMessage(
                'requirements.txt already exists. Overwrite?',
                { modal: true },
                'Overwrite',
                'Save As...'
            );

            if (choice === 'Overwrite') {
                await this._writeRequirementsFile(reqFile);
            } else if (choice === 'Save As...') {
                const uri = await vscode.window.showSaveDialog({
                    defaultUri: reqFile,
                    filters: { 'Text files': ['txt'] }
                });
                if (uri) {
                    await this._writeRequirementsFile(uri);
                }
            }
        } else {
            await this._writeRequirementsFile(reqFile);
        }
    }

    private async _writeRequirementsFile(uri: vscode.Uri): Promise<void> {
        try {
            const content = await this.pip.freezePackages();
            await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'));

            const openFile = await vscode.window.showInformationMessage(
                `Created ${uri.fsPath}`,
                'Open File'
            );

            if (openFile === 'Open File') {
                const doc = await vscode.workspace.openTextDocument(uri);
                await vscode.window.showTextDocument(doc);
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to export requirements: ${error.message}`);
        }
    }

    private async _installRequirements(): Promise<void> {
        const reqFile = await this._findRequirementsFile();
        if (!reqFile) {
            vscode.window.showWarningMessage('No requirements.txt found in the current workspace.');
            return;
        }

        await vscode.commands.executeCommand('pydep-pilot.installRequirements', reqFile);
    }

    private async _createVenv(): Promise<void> {
        const workspaceFolder = this._getPreferredWorkspaceFolder();
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('No workspace folder open. Please open a folder first.');
            return;
        }

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Creating virtual environment...',
            cancellable: false
        }, async () => {
            const terminal = vscode.window.createTerminal({
                name: 'PyDepPilot: Create venv',
                cwd: workspaceFolder.uri
            });
            terminal.show();
            terminal.sendText('python -m venv .venv');

            // Wait a bit for the venv to be created, then refresh
            await new Promise(resolve => setTimeout(resolve, 5000));
            this.refresh();
        });
    }

    private async _updatePackages(packages: string[]): Promise<void> {
        if (packages.length === 0) {
            return;
        }

        const results = { success: [] as string[], failed: [] as { name: string; error: string }[] };

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Updating packages',
            cancellable: true
        }, async (progress, token) => {
            for (let i = 0; i < packages.length; i++) {
                if (token.isCancellationRequested) {
                    break;
                }

                const pkg = packages[i];
                progress.report({
                    message: `${pkg} (${i + 1}/${packages.length})`,
                    increment: (100 / packages.length)
                });

                this._postMessage({
                    type: 'progress',
                    current: i + 1,
                    total: packages.length,
                    name: pkg
                });

                try {
                    await this.pip.updatePackage(pkg, token);
                    results.success.push(pkg);
                } catch (error) {
                    results.failed.push({ name: pkg, error: String(error) });
                }
            }
        });

        // Show results
        if (results.failed.length > 0) {
            vscode.window.showWarningMessage(
                `Updated ${results.success.length} packages. Failed: ${results.failed.map(f => f.name).join(', ')}`
            );
        } else if (results.success.length > 0) {
            vscode.window.showInformationMessage(`Successfully updated ${results.success.length} packages`);
        }

        this._postMessage({ type: 'updateComplete' });
        this.refresh();
    }

    private async _updateSinglePackage(packageName: string): Promise<void> {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Updating ${packageName}`,
            cancellable: true
        }, async (progress, token) => {
            await this.pip.updatePackage(packageName, token);
        });

        this.refresh();
    }

    private async _removePackage(packageName: string): Promise<void> {
        const confirm = await vscode.window.showWarningMessage(
            `Remove package "${packageName}"?`,
            { modal: true },
            'Remove'
        );

        if (confirm !== 'Remove') {
            return;
        }

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Removing ${packageName}`,
        }, async () => {
            await this.pip.removePackage(packageName);
        });

        this.refresh();
    }

    private _postMessage(message: any): void {
        this._view?.webview.postMessage(message);
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'media', 'webview', 'styles.css')
        );
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'media', 'webview', 'main.js')
        );

        // Get codicon font file directly (CSS relative paths don't work in webviews)
        const codiconFontUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', '@vscode/codicons', 'dist', 'codicon.ttf')
        );

        const nonce = this._getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
    <style>
        @font-face {
            font-family: "codicon";
            font-display: block;
            src: url("${codiconFontUri}") format("truetype");
        }
    </style>
    <link href="${styleUri}" rel="stylesheet">
    <title>Pip Manager</title>
</head>
<body>
    <div class="container">
        <div class="toolbar">
            <div class="search-container">
                <input type="text" id="search-input" placeholder="Filter packages..." />
            </div>
            <div class="toolbar-buttons">
                <button id="add-btn" class="icon-btn" title="Add Package">
                    <span class="codicon codicon-add"></span>
                </button>
                <button id="search-pypi-btn" class="icon-btn" title="Search PyPI">
                    <span class="codicon codicon-search"></span>
                </button>
                <button id="refresh-btn" class="icon-btn" title="Refresh">
                    <span class="codicon codicon-refresh"></span>
                </button>
                <button id="export-btn" class="icon-btn" title="Export to requirements.txt">
                    <span class="codicon codicon-export"></span>
                </button>
                <button id="update-selected-btn" class="primary-btn" disabled title="Update Selected">
                    Update (<span id="selected-count">0</span>)
                </button>
            </div>
        </div>

        <div class="select-all-row">
            <label class="checkbox-container">
                <input type="checkbox" id="select-all-checkbox" />
                <span class="checkmark"></span>
                <span class="select-all-label">Select all with updates</span>
            </label>
        </div>

        <div class="table-header">
            <div class="col-checkbox"></div>
            <div class="col-name">Package</div>
            <div class="col-version">Installed</div>
            <div class="col-latest">Latest</div>
            <div class="col-status">Status</div>
            <div class="col-actions"></div>
        </div>

        <div id="package-list" class="package-list">
            <div class="loading-message">Loading packages...</div>
        </div>

        <div class="footer">
            <span id="total-count">0 packages</span>
            <span id="update-available-count"></span>
        </div>
    </div>

    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }

    private _getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
}
