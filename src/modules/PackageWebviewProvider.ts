import * as vscode from 'vscode';
import { createDecorator, InstantiationService, ServiceCollection } from '@/common/ioc';
import { IPackageManager, PackageVersionInfo } from './PackageManager';
import { BackendKind } from './PackageBackend';
import { IPythonExtension } from './PythonExtension';
import { IExtensionContext } from '@/interface/common';
import { getWorkspaceFolders } from './WorkspaceFolders';
import { EnvironmentEmptyState, environmentEmptyState } from './EnvironmentEmptyState';

export interface IPackageWebviewProvider extends vscode.WebviewViewProvider {
    refresh(): void;
}

const IPackageWebviewProvider = createDecorator<IPackageWebviewProvider>('packageWebviewProvider');

interface WebviewMessage {
    type: string;
    payload?: any;
}

export class PackageWebviewProvider implements IPackageWebviewProvider {
    private _view?: vscode.WebviewView;
    private _packages: PackageVersionInfo[] = [];
    private _isLoading: boolean = false;
    private _hasRequirements: boolean = false;
    private _backend: BackendKind = 'pip';
    private _emptyState?: EnvironmentEmptyState;
    private _allowGlobalPython: boolean = false;

    private readonly _messageHandlers: Record<string, (payload: any) => unknown> = {
        refresh: () => this.refresh(),
        updateSelected: payload => this._updatePackages(payload),
        updateSingle: payload => this._updateSinglePackage(payload),
        remove: payload => this._removePackage(payload),
        openPyPI: payload => vscode.env.openExternal(vscode.Uri.parse(`https://pypi.org/project/${payload}/`)),
        addPackage: () => vscode.commands.executeCommand('pydep-pilot.addPackage'),
        searchPackage: () => vscode.commands.executeCommand('pydep-pilot.searchPackage'),
        installRequirements: () => this._installRequirements(),
        selectPython: () => {
            this._allowGlobalPython = false;
            return vscode.commands.executeCommand('python.setInterpreter');
        },
        useGlobalPython: () => {
            this._allowGlobalPython = true;
            this.refresh();
        },
        createVenv: () => {
            this._allowGlobalPython = false;
            return this._createVenv();
        },
        pickVersion: ({ name, version }) => vscode.commands.executeCommand('pydep-pilot.pickPackageVersion', name, version),
        exportRequirements: () => this._exportRequirements()
    };

    constructor(
        @IPackageManager private readonly pip: IPackageManager,
        @IPythonExtension private readonly pythonExt: IPythonExtension,
        @IExtensionContext private readonly context: IExtensionContext
    ) {
        this.context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('pydep-pilot.packageManager')
                || event.affectsConfiguration('pydep-pilot.uvPath')
                || event.affectsConfiguration('pydep-pilot.customPypiUrl')) {
                this.refresh();
            }
        }));
    }

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
            this._sendPackages();
        }
    }

    public refresh(): void {
        if (this._view) {
            void this._loadPackages();
        }
    }

    private async _loadPackages(): Promise<void> {
        this._setLoading(true);

        try {
            const workspaceFolder = this._getPreferredWorkspaceFolder();
            const workspaceUri = workspaceFolder?.uri;
            const currentPythonPath = this.pythonExt.getPythonPath(workspaceUri, {
                allowGlobal: this._allowGlobalPython
            });
            this._emptyState = undefined;

            if (!currentPythonPath) {
                await this._showEmptyEnvironment(workspaceFolder);
                return;
            }
            await this._loadInstalledPackages(currentPythonPath, workspaceFolder);
            await this._checkForUpdates();
        } catch (error) {
            this._reportLoadError(error);
        }
    }

    private _setLoading(value: boolean): void {
        this._isLoading = value;
        this._postMessage({ type: 'loading', value });
    }

    private _sendPackages(): void {
        this._postMessage({ type: 'packages', data: this._packages, hasRequirements: this._hasRequirements, backend: this._backend });
    }

    private async _showEmptyEnvironment(workspaceFolder?: vscode.WorkspaceFolder): Promise<void> {
        this._emptyState = await this._getEnvironmentEmptyState(workspaceFolder);
        this._setLoading(false);
        this._postMessage({ type: 'environmentEmpty', ...this._emptyState });
    }

    private async _loadInstalledPackages(pythonPath: string, workspaceFolder?: vscode.WorkspaceFolder): Promise<void> {
        this.pip.updatePythonPath(pythonPath);
        this._backend = await this.pip.getActiveBackend();
        this._packages = await this.pip.getPackageList();
        this._hasRequirements = !!(await this._findRequirementsFile(workspaceFolder?.uri));
        this._sendPackages();
        this._setLoading(false);
    }

    private async _checkForUpdates(): Promise<void> {
        this._postMessage({ type: 'checkingUpdates', value: true });
        try {
            const updateInfo = await this.pip.getPackageUpdate();
            this._packages = this.pip.mergePackageListWithUpdate(this._packages, updateInfo);
            this._sendPackages();
        } catch {
            // Keep the installed package list visible even when update lookup fails.
        } finally {
            this._postMessage({ type: 'checkingUpdates', value: false });
        }
    }

    private _reportLoadError(error: any): void {
        const errorMessage = error?.message || String(error);
        this._emptyState = undefined;
        this._postMessage({ type: 'error', message: `Failed to load packages: ${errorMessage}` });
        this._setLoading(false);
        this._postMessage({ type: 'checkingUpdates', value: false });
    }

    private async _handleMessage(message: WebviewMessage): Promise<void> {
        if (Object.hasOwn(this._messageHandlers, message.type)) {
            await this._messageHandlers[message.type](message.payload);
        }
    }

    private _getWorkspaceFolders(resource?: vscode.Uri): vscode.WorkspaceFolder[] {
        return getWorkspaceFolders(resource);
    }

    private _getPreferredWorkspaceFolder(resource?: vscode.Uri): vscode.WorkspaceFolder | undefined {
        return this._getWorkspaceFolders(resource)[0];
    }

    private async _getEnvironmentEmptyState(workspaceFolder?: vscode.WorkspaceFolder): Promise<EnvironmentEmptyState> {
        const canUseGlobal = !!this.pythonExt.getPythonPath(workspaceFolder?.uri, { allowGlobal: true });

        if (!workspaceFolder) {
            return environmentEmptyState('no-workspace', '', canUseGlobal);
        }
        const state = await this._looksLikePythonProject(workspaceFolder.uri) ? 'missing-environment' : 'non-python';
        return environmentEmptyState(state, workspaceFolder.name, canUseGlobal);
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
        const uri = await this._requirementsExportTarget();
        if (uri) {
            await this._writeRequirementsFile(uri);
        }
    }

    private _saveRequirementsAs(defaultUri: vscode.Uri): Thenable<vscode.Uri | undefined> {
        return vscode.window.showSaveDialog({ defaultUri, filters: { 'Text files': ['txt'] } });
    }

    private async _requirementsExportTarget(): Promise<vscode.Uri | undefined> {
        const workspaceFolder = this._getPreferredWorkspaceFolder();
        if (!workspaceFolder) {
            return this._saveRequirementsAs(vscode.Uri.file('requirements.txt'));
        }
        const reqFile = vscode.Uri.joinPath(workspaceFolder.uri, 'requirements.txt');
        try {
            await vscode.workspace.fs.stat(reqFile);
        } catch {
            return reqFile;
        }
        return this._confirmRequirementsOverwrite(reqFile);
    }

    private async _confirmRequirementsOverwrite(reqFile: vscode.Uri): Promise<vscode.Uri | undefined> {
        const choice = await vscode.window.showWarningMessage(
            'requirements.txt already exists. Overwrite?', { modal: true }, 'Overwrite', 'Save As...'
        );
        if (choice === 'Overwrite') {
            return reqFile;
        }
        return choice === 'Save As...' ? this._saveRequirementsAs(reqFile) : undefined;
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
