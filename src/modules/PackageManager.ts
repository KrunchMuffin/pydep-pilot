import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import axios from 'axios';
import * as utils from '@/utils';
import { createDecorator } from '@/common/ioc/common/instantiation';
import { IExtensionContext, IOutputChannel } from '@/interface/common';
import { InstantiationService, ServiceCollection } from '@/common/ioc';
import { BackendCommand, BackendKind, InstallOptions, PackageBackend, createBackend, isUvManagedEnvironment, pyvenvCfgPathFor } from './PackageBackend';

interface PackageInfo {
    name: string;
    version?: string;
    latestVersion?: string;
}

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
        if (e.affectsConfiguration('pydep-pilot.packageManager')) {
            this.updateBackendSetting();
        }
    }

    updateBackendSetting() {
        const config = vscode.workspace.getConfiguration('pydep-pilot');
        const value = config.get<string>('packageManager', 'auto');
        this.backendSetting = value === 'pip' || value === 'uv' ? value : 'auto';
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
    }

    private get pythonPath() {
        if (!this._pythonPath) {
            throw new Error('No Python interpreter configured. Please select a Python interpreter using the Python extension.');
        }
        return this._pythonPath;
    }

    private validatePythonPath(): void {
        const pythonPath = this.pythonPath;
        if (!pythonPath) {
            throw new Error('No Python interpreter configured. Please select a Python interpreter.');
        }
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
                p = spawn(command, args, options.cwd ? { cwd: options.cwd } : undefined);
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
                    const err = new Error(errMsg || 'Command failed');
                    (err as Error & { code: number | null; signal: NodeJS.Signals | null }).code = code;
                    (err as Error & { code: number | null; signal: NodeJS.Signals | null }).signal = signal;
                    rejectOnce(err);
                }
            });
        });
    }

    /** Resolves to the uv command name when uv is on PATH, else null. Cached until settings change. */
    private findUv(): Promise<string | null> {
        if (!this.uvLookup) {
            this.uvLookup = new Promise<string | null>((resolve) => {
                let p: ReturnType<typeof spawn>;
                try {
                    p = spawn('uv', ['--version']);
                } catch {
                    resolve(null);
                    return;
                }
                p.on('error', () => resolve(null));
                p.on('close', (code) => resolve(code === 0 ? 'uv' : null));
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
     * on PATH and the environment itself was created by uv, so pip users are never
     * switched unexpectedly. Detection failures always resolve to pip.
     */
    private async resolveBackend(): Promise<PackageBackend> {
        this.validatePythonPath();
        const python = this.pythonPath;
        let kind: BackendKind = 'pip';
        let reason = 'pip selected in settings';

        try {
            if (this.backendSetting !== 'pip') {
                const uv = await this.findUv();
                if (this.backendSetting === 'uv') {
                    if (uv) {
                        kind = 'uv';
                        reason = 'uv selected in settings';
                    } else {
                        reason = 'uv selected in settings but not found on PATH, falling back to pip';
                        if (!this.warnedMissingUv) {
                            this.warnedMissingUv = true;
                            vscode.window.showWarningMessage('PyDepPilot: "uv" is set as the package manager but was not found on PATH. Falling back to pip.');
                        }
                    }
                } else if (uv && this.isUvEnvironment(python)) {
                    kind = 'uv';
                    reason = 'environment was created by uv';
                } else {
                    reason = uv ? 'environment was not created by uv' : 'uv not found on PATH';
                }
            }
        } catch {
            kind = 'pip';
            reason = 'backend detection failed';
        }

        const log = `${kind} (${reason}) for ${python}`;
        if (log !== this.lastBackendLog) {
            this.lastBackendLog = log;
            this.output.appendLine(`PyDepPilot backend: ${log}`);
        }
        return createBackend(kind, python, 'uv');
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

    private createPackageInfo(pack: string | PackageInfo): PackageInfo | null {
        let out: PackageInfo;
        if (typeof pack === 'string') {
            const [name, version] = pack.split('==');
            out = { name, version: version || undefined };
        }else{
            out = {...pack};
        }
        if(!out.name){
            return null;
        }
        out.toString = ()=>{
            return `${out.name}${out.version ? `==${out.version}` : ''}`;
        };
        return out;
    }

    public _test_createPackageInfo = this.createPackageInfo;

    private tryParsePipListJson(packages: string) {
        try {
            return JSON.parse(packages.replace(/\n/g, ""));
        } catch(e) {
            throw new Error(`Get package failed, please run "pip list --format json" or "pip3 list --format json" check pip support json format: ${e}`);
        }
    }

    public async getPackageList(): Promise<PackageVersionInfo[]> {
        const packages = await this.run(b => b.list());
        return this.tryParsePipListJson(packages);
    }

    public async freezePackages(): Promise<string> {
        const output = await this.run(b => b.freeze());
        return output.trim();
    }

    public async getPackageUpdate(): Promise<PackageVersionInfo[]> {
        const updates = await this.run(b => b.outdated(this.source));
        return this.tryParsePipListJson(updates);
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
        const info = this.createPackageInfo(pack);
        if (!info) {
            throw new Error('Invalid Name');
        }

        const name = info.toString();
        await this.installPackage([name], { upgrade: true }, cancelToken, cwd);
    }
    public async updatePackage(pack: string | PackageInfo, cancelToken?: vscode.CancellationToken, cwd?: string) {
        const info = this.createPackageInfo(pack);
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
        const info = this.createPackageInfo(pack);

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
        const info = this.createPackageInfo(pack);

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
            const releases = resp.data?.releases || {};
            const versionList = Object.keys(releases)
                .filter(version => {
                    // Filter out versions with no files (yanked/empty releases)
                    const files = releases[version];
                    return Array.isArray(files) && files.length > 0;
                })
                .sort((a, b) => {
                    // Sort versions in descending order (newest first)
                    // Simple version comparison - split by . and compare parts
                    const partsA = a.split('.').map(p => parseInt(p.replace(/[^0-9]/g, '')) || 0);
                    const partsB = b.split('.').map(p => parseInt(p.replace(/[^0-9]/g, '')) || 0);
                    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
                        const diff = (partsB[i] || 0) - (partsA[i] || 0);
                        if (diff !== 0) {
                            return diff;
                        }
                    }
                    return 0;
                });

            return versionList;
        } catch (err) {
            // Fallback: return empty array if PyPI API fails
            return [];
        }
    }
}
