import * as vscode from 'vscode';
import { createDecorator, InstantiationService, ServiceCollection } from '@/common/ioc';
import { IPackageManager, PackageVersionInfo } from './PackageManager';
import { IExtensionContext } from '@/interface/common';

export interface IPackageWebviewProvider extends vscode.WebviewViewProvider {
    refresh(): void;
}

export const IPackageWebviewProvider = createDecorator<IPackageWebviewProvider>('packageWebviewProvider');

interface WebviewMessage {
    type: string;
    payload?: any;
}

export class PackageWebviewProvider implements IPackageWebviewProvider {
    private _view?: vscode.WebviewView;
    private _packages: PackageVersionInfo[] = [];
    private _isLoading: boolean = false;

    constructor(
        @IPackageManager private readonly pip: IPackageManager,
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
        } else if (this._packages.length > 0) {
            this._postMessage({
                type: 'packages',
                data: this._packages,
                hasRequirements: false
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
            // First, get the package list quickly and display it
            this._packages = await this.pip.getPackageList();

            // Check for requirements.txt in workspace if no packages found
            let hasRequirements = false;
            if (this._packages.length === 0) {
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (workspaceFolders) {
                    for (const folder of workspaceFolders) {
                        const reqFile = vscode.Uri.joinPath(folder.uri, 'requirements.txt');
                        try {
                            await vscode.workspace.fs.stat(reqFile);
                            hasRequirements = true;
                            break;
                        } catch {
                            // File doesn't exist, continue
                        }
                    }
                }
            }

            // Send packages immediately so UI shows them
            this._postMessage({
                type: 'packages',
                data: this._packages,
                hasRequirements
            });

            // Mark loading as done for the initial list
            this._isLoading = false;
            this._postMessage({ type: 'loading', value: false });

            // Now check each package individually for updates (progressive)
            this._postMessage({ type: 'checkingUpdates', value: true });

            // Check packages in parallel batches of 5 for speed
            const batchSize = 5;
            for (let i = 0; i < this._packages.length; i += batchSize) {
                const batch = this._packages.slice(i, i + batchSize);
                const promises = batch.map(async (pkg) => {
                    const latestVersion = await this.pip.checkPackageLatestVersion(pkg.name);
                    if (latestVersion) {
                        pkg.latestVersion = latestVersion;
                    }
                });

                await Promise.all(promises);

                // Send incremental update to UI after each batch
                this._postMessage({
                    type: 'packages',
                    data: this._packages,
                    hasRequirements
                });
            }

            this._postMessage({ type: 'checkingUpdates', value: false });
        } catch (error: any) {
            const errorMessage = error?.message || String(error);
            const lowerError = errorMessage.toLowerCase();
            this._postMessage({
                type: 'error',
                message: lowerError.includes('python') || lowerError.includes('pip') || lowerError.includes('interpreter')
                    ? 'No Python interpreter selected. Please select a Python interpreter using the Python extension.'
                    : `Failed to load packages: ${errorMessage}`
            });
            this._isLoading = false;
            this._postMessage({ type: 'loading', value: false });
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
                vscode.commands.executeCommand('python.setInterpreter');
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

    private async _exportRequirements(): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;

        if (!workspaceFolders) {
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
        const reqFile = vscode.Uri.joinPath(workspaceFolders[0].uri, 'requirements.txt');
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
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return;
        }

        for (const folder of workspaceFolders) {
            const reqFile = vscode.Uri.joinPath(folder.uri, 'requirements.txt');
            try {
                await vscode.workspace.fs.stat(reqFile);
                vscode.commands.executeCommand('pydep-pilot.installRequirements', reqFile);
                return;
            } catch {
                // File doesn't exist, continue
            }
        }
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
