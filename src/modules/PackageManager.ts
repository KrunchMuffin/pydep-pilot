import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import axios from 'axios';
import * as xml2js from 'xml2js';
import * as utils from '@/utils';
import { createDecorator } from '@/common/ioc/common/instantiation';
import { IExtensionContext, IOutputChannel } from '@/interface/common';
import { InstantiationService, ServiceCollection } from '@/common/ioc';

interface PackageInfo {
    name: string;
    version?: string;
    latestVersion?: string;
}

export type PackageVersionInfo = Omit<PackageInfo, 'version'> & Required<Pick<PackageInfo, 'version'>>;

type PackagePickItem = vscode.QuickPickItem & PackageVersionInfo;

const PYPI_DEFAULT = 'https://pypi.org/simple';

enum Category {
    python3 = 'Programming Language :: Python :: 3',
    education = 'Intended Audience :: Education',
    stable = 'Development Status :: 5 - Production/Stable',
    empty = '',
}

const defaultCategory = encodeURI(Category.stable);

export const necessaryPackage = [
    'pip', 'setuptools', 'wheel'
];

export interface IPackageManager {
    getPackageList(): Promise<PackageVersionInfo[]>;
    getPackageListWithUpdate(): Promise<PackageVersionInfo[]>;
    addPackage(pack: string | PackageInfo, cancelToken?: vscode.CancellationToken): Promise<any>;
    updatePackage(pack: string | PackageInfo, cancelToken?: vscode.CancellationToken): Promise<any>;
    removePackage(pack: string | PackageInfo): Promise<any>;
    searchFromPyPi(keyword: string, page?: number, cancelToken?: vscode.CancellationToken): Promise<{ list: PackagePickItem[], totalPages: number }>;
    updatePythonPath(path: string): void;
    addPackageFromFile(filePath: string, cancelToken?: vscode.CancellationToken): Promise<any>;
    getPackageVersionList(pack: string | PackageInfo, cancelToken?: vscode.CancellationToken): Promise<string[]>;
    getPackageUpdate(): Promise<PackageVersionInfo[]>;
    mergePackageListWithUpdate(packInfo: PackageVersionInfo[], updateInfo: PackageVersionInfo[]): PackageVersionInfo[];
    checkPackageLatestVersion(packageName: string, cancelToken?: vscode.CancellationToken): Promise<string | null>;
    freezePackages(): Promise<string>;
}

export const IPackageManager = createDecorator<IPackageManager>('packageManager');

export class PackageManager implements IPackageManager {
    private source: string = PYPI_DEFAULT;
    constructor(
        private _pythonPath: string,
        @IOutputChannel private readonly output: IOutputChannel,
        @IExtensionContext private readonly context: IExtensionContext,
    ) {
        this.updatePythonSource();
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

    private execute(command: string, args: string[], cancelToken?: vscode.CancellationToken): Promise<any> {
        return new Promise((resolve, reject) => {
            let errMsg = '';
            let out = '';

            this.output.appendLine(`exec ${command} ${args.join(' ')}`);

            let p: ReturnType<typeof spawn>;
            try {
                p = spawn(command, args);
            } catch (err: any) {
                reject(new Error(`Failed to start process: ${err.message}`));
                return;
            }

            // Handle spawn error (e.g., ENOENT when command doesn't exist)
            p.on('error', (err: Error) => {
                this.output.appendLine(`Process error: ${err.message}`);
                reject(new Error(`Failed to execute python: ${err.message}. Make sure Python is installed and selected.`));
            });

            if (cancelToken) {
                cancelToken.onCancellationRequested(() => {
                    this.output.appendLine('cancel command');
                    p.kill();
                });
            }

            p.stdout?.on('data', (data: string) => {
                this.output.appendLine(data);
                out = out + data;
            });

            p.stderr?.on('data', (data: string) => {
                if(!(data.indexOf('WARNING') === 0)) {
                    this.output.appendLine(data);
                    errMsg += data;
                }
            });

            p.on('close', (code) => {
                this.output.appendLine('');
                if (!code) {
                    resolve(out);
                } else {
                    const err = new Error(errMsg || 'Command failed');
                    (err as Error & { code: number }).code = code;
                    reject(err);
                }
            });
        });
    }

    private pip(args: string[], cancelToken?: vscode.CancellationToken, showErrorMessage = true) {
        const python = this.pythonPath;

        return this.execute(python, ['-m', 'pip']
            .concat(args)
            .concat([]),
            cancelToken
        ).catch((err) => {
            if (showErrorMessage) {
                vscode.window.showErrorMessage(err.message);
            }
            return Promise.reject(err);
        });
    }

    private pipWithSource(iargs: string[], cancelToken?: vscode.CancellationToken, showErrorMessage?: boolean) {
        const args = ([] as string[]).concat(iargs);

        if (this.source) {
            args.push('-i', this.source);
        }

        return this.pip(args, cancelToken, showErrorMessage);
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

    // eslint-disable-next-line @typescript-eslint/naming-convention
    public _test_createPackageInfo = this.createPackageInfo;

    private tryParsePipListJson(packages: string) {
        try {
            return JSON.parse(packages.replace(/\n/g, ""));
        } catch(e) {
            throw new Error(`Get package failed, please run "pip list --format json" or "pip3 list --format json" check pip support json format: ${e}`);
        }
    }

    public async getPackageList(): Promise<PackageVersionInfo[]> {
        const packages = await this.pip(['list', '--format', 'json']);
        return this.tryParsePipListJson(packages);
    }

    public async freezePackages(): Promise<string> {
        const output = await this.pip(['freeze']);
        return output.trim();
    }

    public async getPackageUpdate(): Promise<PackageVersionInfo[]> {
        const updates = await this.pipWithSource(['list', '--outdated', '--format', 'json']);
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

    private async installPackage(iargs: string[], cancelToken?: vscode.CancellationToken) {
        const args = ['install', '-U'].concat(iargs);

        await this.pipWithSource(args, cancelToken);
    }

    public async addPackage(pack: string | PackageInfo, cancelToken?: vscode.CancellationToken) {
        const info = this.createPackageInfo(pack);
        if (!info) {
            throw new Error('Invalid Name');
        }

        const name = info.toString();
        await this.installPackage([name], cancelToken);
    }
    public async updatePackage(pack: string | PackageInfo, cancelToken?: vscode.CancellationToken) {
        const info = this.createPackageInfo(pack);
        if (!info) {
            throw new Error('Invalid Name');
        }

        const name = info.toString();
        await this.installPackage(['--upgrade',name], cancelToken);
    }
    public async addPackageFromFile(filePath: string, cancelToken?: vscode.CancellationToken) {
        if (!filePath) {
            throw new Error('Invalid Path');
        }

        await this.installPackage(['-r', filePath], cancelToken);
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

        await this.pip(['uninstall', name, '-y']);
    }

    public async searchFromPyPi(keyword: string, page = 1, cancelToken?: vscode.CancellationToken) {
        const axiosCancelToken = utils.createAxiosCancelToken(cancelToken);
        const resp = await axios({
            method: 'GET',
            cancelToken: axiosCancelToken.token,
            url: `https://pypi.org/search/?q=${keyword}&page=${page}${keyword ? '' : `&c=${defaultCategory}`
                }`,
        });
        const [resultXml] =
            RegExp(
                '<ul class="unstyled" aria-label="Search results">[\\s\\S]*?</ul>'
            ).exec(resp.data) || [];
        if (!resultXml) {return Promise.reject({ type: 'no result' });}
        const [paginationXml] =
            RegExp(
                '<div class="button-group button-group--pagination">[\\s\\S]*?</div>'
            ).exec(resp.data) || [];
        const result = await xml2js.parseStringPromise(resultXml, {
            explicitArray: false,
        });

        const list: PackagePickItem[] = [];
        result.ul.li.forEach((item: any) => {
            const data = {
                name: item.a.h3.span[0]._,
                version: item.a.h3.span[1]._,
                updateTime: item.a.h3.span[2].time.$.datetime,
                describe: item.a.p._,
            };
            list.push({
                name: data.name,
                version: data.version,
                alwaysShow: true,
                label: data.name,
                description: `${data.version}`,
                detail: data.describe
            });
        });

        let totalPages = 1;

        if (paginationXml) {
            const pagination = await xml2js.parseStringPromise(paginationXml, {
                explicitArray: false,
            });
            totalPages = Number(pagination.div.a[pagination.div.a.length - 2]._) || 1;
            if (totalPages < page) {
                totalPages = page;
            }
        }

        return {
            list,
            totalPages,
        };
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
                        if (diff !== 0) return diff;
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