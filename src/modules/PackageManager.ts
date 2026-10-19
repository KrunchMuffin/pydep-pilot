import { execFile, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import axios from 'axios';
import * as utils from '@/utils';
import { createDecorator } from '@/common/ioc/common/instantiation';
import { IExtensionContext, IOutputChannel } from '@/interface/common';
import { InstantiationService, ServiceCollection } from '@/common/ioc';
import { BackendCommand, BackendKind, InstallOptions, PackageBackend, createBackend, isUvManagedEnvironment, pyvenvCfgPathFor } from './PackageBackend';
import { PackageInfo, comparePackageVersions, createPackageInfo } from './PackageInfo';

export type PackageVersionInfo = Omit<PackageInfo, 'version'> & Required<Pick<PackageInfo, 'version'>>;

const PYPI_DEFAULT = 'https://pypi.org/simple';

type BackendSetting = 'auto' | BackendKind;

export const necessaryPackage = [
    'pip', 'setuptools', 'wheel'
];

export interface IPackageManager {
    getPackageList(): Promise<PackageVersionInfo[]>;
    getPackageListWithUpdate(): Promise<PackageVersionInfo[]>;
    addPackage(pack: string | PackageInfo, cancelToken?: vscode.CancellationToken, cwd?: string): Promise<any>;
    updatePackage(pack: string | PackageInfo, cancelToken?: vscode.CancellationToken, cwd?: string): Promise<any>;
    removePackage(pack: string | PackageInfo): Promise<any>;
    updatePythonPath(path: string): void;
    addPackageFromFile(filePath: string, cancelToken?: vscode.CancellationToken, cwd?: string): Promise<any>;
    getPackageVersionList(pack: string | PackageInfo, cancelToken?: vscode.CancellationToken): Promise<string[]>;
    getPackageUpdate(): Promise<PackageVersionInfo[]>;
    mergePackageListWithUpdate(packInfo: PackageVersionInfo[], updateInfo: PackageVersionInfo[]): PackageVersionInfo[];
    checkPackageLatestVersion(packageName: string, cancelToken?: vscode.CancellationToken): Promise<string | null>;
    freezePackages(): Promise<string>;
    getActiveBackend(): Promise<BackendKind>;
}

export const IPackageManager = createDecorator<IPackageManager>('packageManager');

export class PackageManager implements IPackageManager {
    private source: string = PYPI_DEFAULT;
    private backendSetting: BackendSetting = 'auto';
    private uvPath = 'uv';
    private uvLookup?: Promise<string | null>;
    private warnedMissingUv = false;
    private lastBackendLog?: string;
    constructor(
        private _pythonPath: string,
        @IOutputChannel private readonly output: IOutputChannel,
        @IExtensionContext private readonly context: IExtensionContext,
    ) {
        this.updatePythonSource();
        this.updateBackendSetting();
        this.context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(this.onConfigUpdate.bind(this))
        );
    }

    static Create(instantiation: InstantiationService, service: ServiceCollection | undefined, pythonPath: string) {
        const instance = instantiation.createInstance<IPackageManager>(this, pythonPath);
        if (service) {
            service.set(IPackageManager, instance);
        }
        return instance;
    }

    onConfigUpdate(e: vscode.ConfigurationChangeEvent) {
        if (e.affectsConfiguration('pydep-pilot.customPypiUrl')) {
            this.updatePythonSource();
        }
        if (e.affectsConfiguration('pydep-pilot.packageManager') || e.affectsConfiguration('pydep-pilot.uvPath')) {
            this.updateBackendSetting();
        }
    }

    updateBackendSetting() {
        const config = vscode.workspace.getConfiguration('pydep-pilot');
        const value = config.get<string>('packageManager', 'auto');
        this.backendSetting = value === 'pip' || value === 'uv' ? value : 'auto';
        this.uvPath = config.get<string>('uvPath', 'uv').trim() || 'uv';
        this.uvLookup = undefined;
        this.warnedMissingUv = false;
        this.lastBackendLog = undefined;
    }

    updatePythonSource(){
        const config = vscode.workspace.getConfiguration('pydep-pilot');
        const customUrl = config.get<string>('customPypiUrl', '');
        this.source = customUrl || PYPI_DEFAULT;
    }

    updatePythonPath(path: string) {
        this._pythonPath = path;
        // Refresh also retries detection after uv is installed or replaced.
        this.uvLookup = undefined;
    }

    private get pythonPath() {
        if (!this._pythonPath) {
            throw new Error('No Python interpreter configured. Please select a Python interpreter using the Python extension.');
        }
        return this._pythonPath;
    }

    private validatePythonPath(): void {
        const pythonPath = this.pythonPath;
        // Only check file existence for full paths (not PATH commands like 'python' or 'python3')
        const isFullPath = path.isAbsolute(pythonPath) || pythonPath.includes(path.sep);
        if (isFullPath && !fs.existsSync(pythonPath)) {
            throw new Error(`Python interpreter not found at: ${pythonPath}. Please select a valid Python interpreter.`);
        }
    }

    private execute(command: string, args: string[], cancelToken?: vscode.CancellationToken, options: { cwd?: string } = {}): Promise<any> {
        return new Promise((resolve, reject) => {
            let errMsg = '';
            let out = '';
            let settled = false;
            let cancelled = false;

            this.output.appendLine(`exec ${command} ${args.join(' ')}`);
            if (options.cwd) {
                this.output.appendLine(`cwd ${options.cwd}`);
            }

            const rejectOnce = (err: Error) => {
                if (!settled) {
                    settled = true;
                    reject(err);
                }
            };

            let p: ReturnType<typeof spawn>;
            try {
                p = spawn(command, args, { cwd: options.cwd, windowsHide: true });
            } catch (err: any) {
                rejectOnce(new Error(`Failed to start process: ${err.message}`));
                return;
            }

            // Handle spawn error (e.g., ENOENT when command doesn't exist)
            p.on('error', (err: Error) => {
                this.output.appendLine(`Process error: ${err.message}`);
                rejectOnce(new Error(`Failed to execute ${command}: ${err.message}. Make sure it is installed and on PATH.`));
            });

            if (cancelToken) {
                cancelToken.onCancellationRequested(() => {
                    this.output.appendLine('cancel command');
                    cancelled = true;
                    p.kill();
                });
            }

            p.stdout?.on('data', (data: Buffer | string) => {
                const text = data.toString();
                this.output.append(text);
                out = out + text;
            });

            p.stderr?.on('data', (data: Buffer | string) => {
                const text = data.toString();
                if(!(text.indexOf('WARNING') === 0)) {
                    this.output.append(text);
                    errMsg += text;
                }
            });

            p.on('close', (code, signal) => {
                if (settled) {
                    return;
                }
                this.output.appendLine('');
                if (cancelled) {
                    rejectOnce(new Error('Command cancelled'));
                } else if (code === 0) {
                    settled = true;
                    resolve(out);
                } else {
                    rejectOnce(this.processError(errMsg, code, signal));
                }
            });
        });
    }

    private processError(message: string, code: number | null, signal: NodeJS.Signals | null): Error {
        return Object.assign(new Error(message || 'Command failed'), { code, signal });
    }

    /** Resolve the configured executable without letting a broken uv process hang the sidebar. */
    private findUv(): Promise<string | null> {
        if (!this.uvLookup) {
            this.uvLookup = new Promise<string | null>((resolve) => {
                const uvPath = this.uvPath;
                execFile(uvPath, ['--version'], { timeout: 5000, windowsHide: true }, (error) => {
                    resolve(error ? null : uvPath);
                });
            });
        }
        return this.uvLookup;
    }

    private isUvEnvironment(pythonPath: string): boolean {
        const cfgPath = pyvenvCfgPathFor(pythonPath);
        if (!cfgPath) {
            return false;
        }
        try {
            return isUvManagedEnvironment(fs.readFileSync(cfgPath, 'utf8'));
        } catch {
            return false;
        }
    }

    /**
     * Picks pip or uv for the current interpreter. "auto" only chooses uv when uv is
     * available and the environment itself was created by uv, so pip users are never
     * switched unexpectedly. Detection failures always resolve to pip.
     */
    private async resolveBackend(): Promise<PackageBackend> {
        this.validatePythonPath();
        const python = this.pythonPath;
        let selection: { kind: BackendKind; reason: string };
        try {
            selection = await this.selectBackend(python);
        } catch {
            selection = { kind: 'pip', reason: 'backend detection failed' };
        }
        const { kind, reason } = selection;
        const log = `${kind} (${reason}) for ${python}`;
        if (log !== this.lastBackendLog) {
            this.lastBackendLog = log;
            this.output.appendLine(`PyDepPilot backend: ${log}`);
        }
        return createBackend(kind, python, this.uvPath);
    }

    private async selectBackend(python: string): Promise<{ kind: BackendKind; reason: string }> {
        if (this.backendSetting === 'pip') {
            return { kind: 'pip', reason: 'pip selected in settings' };
        }
        const uv = await this.findUv();
        if (!uv) {
            return this.missingUvBackend();
        }
        if (this.backendSetting === 'uv') {
            return { kind: 'uv', reason: 'uv selected in settings' };
        }
        return this.environmentBackend(python);
    }

    private environmentBackend(python: string): { kind: BackendKind; reason: string } {
        return this.isUvEnvironment(python)
            ? { kind: 'uv', reason: 'environment was created by uv' }
            : { kind: 'pip', reason: 'environment was not created by uv' };
    }

    private missingUvBackend(): { kind: BackendKind; reason: string } {
        if (this.backendSetting !== 'uv') {
            return { kind: 'pip', reason: 'uv is unavailable' };
        }
        if (!this.warnedMissingUv) {
            this.warnedMissingUv = true;
            vscode.window.showWarningMessage('PyDepPilot: uv could not be started. Check pydep-pilot.uvPath or install uv and refresh. Falling back to pip.');
        }
        return { kind: 'pip', reason: 'configured uv executable is unavailable, falling back to pip' };
    }

    public async getActiveBackend(): Promise<BackendKind> {
        try {
            return (await this.resolveBackend()).kind;
        } catch {
            return 'pip';
        }
    }

    private async run(build: (backend: PackageBackend) => BackendCommand, cancelToken?: vscode.CancellationToken, showErrorMessage = true, cwd?: string): Promise<any> {
        // Interpreter validation errors propagate without a popup, as before.
        const backend = await this.resolveBackend();
        const { command, args } = build(backend);

        return this.execute(command, args, cancelToken, { cwd }).catch((err) => {
            if (showErrorMessage) {
                vscode.window.showErrorMessage(err.message);
            }
            return Promise.reject(err);
        });
    }

    private parsePackageList(packages: string): PackageVersionInfo[] {
        try {
            const parsed: unknown = JSON.parse(packages);
            if (!Array.isArray(parsed)) {
                throw new Error('Expected a package array');
            }
            return parsed;
        } catch(e) {
            throw new Error(`The package manager returned an invalid package list. See the PyDepPilot output channel for details: ${e}`);
        }
    }

    public async getPackageList(): Promise<PackageVersionInfo[]> {
        const packages = await this.run(b => b.list());
        return this.parsePackageList(packages);
    }

    public async freezePackages(): Promise<string> {
        const output = await this.run(b => b.freeze());
        return output.trim();
    }

    public async getPackageUpdate(): Promise<PackageVersionInfo[]> {
        const updates = await this.run(b => b.outdated(this.source));
        return this.parsePackageList(updates);
    }

    /**
     * Check a single package's latest version from PyPI
     */
    public async checkPackageLatestVersion(packageName: string, cancelToken?: vscode.CancellationToken): Promise<string | null> {
        try {
            const axiosCancelToken = utils.createAxiosCancelToken(cancelToken);
            const resp = await axios({
                method: 'GET',
                cancelToken: axiosCancelToken.token,
                url: `https://pypi.org/pypi/${packageName}/json`,
                timeout: 5000,
            });
            return resp.data?.info?.version || null;
        } catch {
            return null;
        }
    }

    public mergePackageListWithUpdate(packInfo: PackageVersionInfo[], updateInfo: PackageVersionInfo[]): PackageVersionInfo[] {
        const latestVersionMap: Record<string, string>= {};
        if(updateInfo && updateInfo.length > 0) {
            updateInfo.forEach((info: any) => {
                latestVersionMap[info.name] = info.latest_version;
            });
            return packInfo.map((info: any) => {
                const latestVersion = latestVersionMap[info.name];
                if(latestVersion){
                    return {
                        ...info,
                        latestVersion,
                    };
                }
                return info;
            });
        }
        return packInfo;
    }

    public async getPackageListWithUpdate(): Promise<PackageVersionInfo[]> {
        let packInfo = await this.getPackageList();
        try {
            const updateInfo = await this.getPackageUpdate();
            packInfo = this.mergePackageListWithUpdate(packInfo, updateInfo);
        } catch (error) {
            // ignore error
        }
        return packInfo;
    }

    private async installPackage(specs: string[], options: Omit<InstallOptions, 'indexUrl'>, cancelToken?: vscode.CancellationToken, cwd?: string) {
        await this.run(b => b.install(specs, { ...options, indexUrl: this.source }), cancelToken, undefined, cwd);
    }

    public async addPackage(pack: string | PackageInfo, cancelToken?: vscode.CancellationToken, cwd?: string) {
        await this.updatePackage(pack, cancelToken, cwd);
    }
    public async updatePackage(pack: string | PackageInfo, cancelToken?: vscode.CancellationToken, cwd?: string) {
        const info = createPackageInfo(pack);
        if (!info) {
            throw new Error('Invalid Name');
        }

        const name = info.toString();
        await this.installPackage([name], { upgrade: true }, cancelToken, cwd);
    }
    public async addPackageFromFile(filePath: string, cancelToken?: vscode.CancellationToken, cwd?: string) {
        if (!filePath) {
            throw new Error('Invalid Path');
        }

        await this.installPackage([], { upgrade: true, requirementsFile: filePath }, cancelToken, cwd || path.dirname(filePath));
    }

    public async removePackage(pack: string | PackageInfo) {
        const info = createPackageInfo(pack);

        if (!info) {
            throw new Error('Invalid Name');
        }
        const name = info.name;
        if (necessaryPackage.includes(name)) {
            return;
        }

        await this.run(b => b.uninstall(name));
    }

    public async getPackageVersionList(pack: string | PackageInfo, cancelToken?: vscode.CancellationToken) {
        const info = createPackageInfo(pack);

        if (!info) {
            throw new Error('Invalid Name');
        }
        const name = info.name;

        try {
            const axiosCancelToken = utils.createAxiosCancelToken(cancelToken);
            const resp = await axios({
                method: 'GET',
                cancelToken: axiosCancelToken.token,
                url: `https://pypi.org/pypi/${name}/json`,
                timeout: 10000,
            });

            // Get all versions from the releases object keys
            return this.releaseVersions(resp.data?.releases);
        } catch (err) {
            // Fallback: return empty array if PyPI API fails
            return [];
        }
    }

    private releaseVersions(releases?: Record<string, unknown> | null): string[] {
        const available = releases || {};
        return Object.keys(available)
            .filter(version => Array.isArray(available[version]) && available[version].length > 0)
            .sort(comparePackageVersions);
    }
}
