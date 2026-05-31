import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { Event, Uri } from "vscode";
import { createDecorator, InstantiationService, ServiceCollection } from "@/common/ioc";
import { IExtensionContext } from "@/interface";

export interface PythonExtensionApi {
    /**
     * Promise indicating whether all parts of the extension have completed loading or not.
     * @type {Promise<void>}
     * @memberof IExtensionApi
     */
    ready: Promise<void>;
    jupyter: {
        registerHooks(): void;
    };
    debug: {
        /**
         * Generate an array of strings for commands to pass to the Python executable to launch the debugger for remote debugging.
         * Users can append another array of strings of what they want to execute along with relevant arguments to Python.
         * E.g `['/Users/..../pythonVSCode/pythonFiles/lib/python/debugpy', '--listen', 'localhost:57039', '--wait-for-client']`
         * @param {string} host
         * @param {number} port
         * @param {boolean} [waitUntilDebuggerAttaches=true]
         * @returns {Promise<string[]>}
         */
        getRemoteLauncherCommand(host: string, port: number, waitUntilDebuggerAttaches: boolean): Promise<string[]>;

        /**
         * Gets the path to the debugger package used by the extension.
         * @returns {Promise<string>}
         */
        getDebuggerPackagePath(): Promise<string | undefined>;
    };
    /**
     * Return internal settings within the extension which are stored in VSCode storage
     */
    settings: {
        /**
         * An event that is emitted when execution details (for a resource) change. For instance, when interpreter configuration changes.
         */
        readonly onDidChangeExecutionDetails: Event<Uri | undefined>;
        /**
         * Returns all the details the consumer needs to execute code within the selected environment,
         * corresponding to the specified resource taking into account any workspace-specific settings
         * for the workspace to which this resource belongs.
         * @param {Resource} [resource] A resource for which the setting is asked for.
         * * When no resource is provided, the setting scoped to the first workspace folder is returned.
         * * If no folder is present, it returns the global setting.
         * @returns {({ execCommand: string[] | undefined })}
         */
        getExecutionDetails(
            resource?: any,
        ): {
            /**
             * E.g of execution commands returned could be,
             * * `['<path to the interpreter set in settings>']`
             * * `['<path to the interpreter selected by the extension when setting is not set>']`
             * * `['conda', 'run', 'python']` which is used to run from within Conda environments.
             * or something similar for some other Python environments.
             *
             * @type {(string[] | undefined)} When return value is `undefined`, it means no interpreter is set.
             * Otherwise, join the items returned using space to construct the full execution command.
             */
            execCommand: string[] | undefined;
        };
    };

    datascience: {
        /**
         * Launches Data Viewer component.
         * @param {IDataViewerDataProvider} dataProvider Instance that will be used by the Data Viewer component to fetch data.
         * @param {string} title Data Viewer title
         */
        showDataViewer(dataProvider: any, title: string): Promise<void>;
        /**
         * Registers a remote server provider component that's used to pick remote jupyter server URIs
         * @param serverProvider object called back when picking jupyter server URI
         */
        registerRemoteServerProvider(serverProvider: any): void;
    };
}

export interface IPythonExtension {
    readonly pythonExtension: vscode.Extension<PythonExtensionApi> | undefined;
    readonly pythonPath: string;
    getPythonPath: (resource?: Uri, options?: PythonPathOptions) => string;
    waitPythonExtensionInited: () => Promise<boolean>;
    onPythonPathChange: (callback: (pythonPath: string) => any) => void;
}

export interface PythonPathOptions {
    allowGlobal?: boolean;
}

export const IPythonExtension = createDecorator<IPythonExtension>('pythonExtension');

export class PythonExtension implements IPythonExtension {
    private _pythonExtension: vscode.Extension<PythonExtensionApi> | undefined;
    constructor(@IExtensionContext private _context: IExtensionContext) {
        this.updatePythonExtension();
    }

    static Create(instantiation: InstantiationService, service?: ServiceCollection) {
        const instance = instantiation.createInstance<IPythonExtension>(this);
        if (service) {
            service.set(IPythonExtension, instance);
        }
        return instance;
    }

    updatePythonExtension() {
        this._pythonExtension = vscode.extensions.getExtension<PythonExtensionApi>('ms-python.python');
    }

    get pythonExtension() {
        if (this._pythonExtension) {
            return this._pythonExtension;
        }
        this.updatePythonExtension();
        return this._pythonExtension;
    }

    /**
     * Detect a local virtual environment in the workspace.
     * Checks common venv folder names and returns the Python executable path if found.
     */
    private getWorkspaceFolders(resource?: Uri): vscode.WorkspaceFolder[] {
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

    private detectLocalVenv(resource?: Uri): string | null {
        const workspaceFolders = this.getWorkspaceFolders(resource);
        if (!workspaceFolders.length) {
            return null;
        }

        const isWindows = process.platform === 'win32';

        // Common venv folder names to check
        const venvNames = ['.venv', 'venv', '.env', 'env'];
        const pythonFolder = isWindows ? 'Scripts' : 'bin';
        const pythonExecutable = isWindows ? 'python.exe' : 'python';

        for (const workspaceFolder of workspaceFolders) {
            const workspacePath = workspaceFolder.uri.fsPath;
            for (const venvName of venvNames) {
                const pythonPath = path.join(workspacePath, venvName, pythonFolder, pythonExecutable);
                if (fs.existsSync(pythonPath)) {
                    return pythonPath;
                }
            }
        }

        return null;
    }

    private getPythonExtensionPath(resource?: Uri, options: PythonPathOptions = {}): string {
        const pythonApi = this.pythonExtension?.exports;
        const execCommand = pythonApi?.settings.getExecutionDetails(resource)?.execCommand;
        const pythonPath = execCommand?.[0] || '';

        if (!pythonPath) {
            return '';
        }

        if (!resource || !vscode.workspace.workspaceFolders?.length) {
            return pythonPath;
        }

        if (options.allowGlobal) {
            return pythonPath;
        }

        if (this.isPathInWorkspace(pythonPath, resource)) {
            return pythonPath;
        }

        return this.hasWorkspaceInterpreterSetting(resource) ? pythonPath : '';
    }

    private hasWorkspaceInterpreterSetting(resource: Uri): boolean {
        const inspected = vscode.workspace
            .getConfiguration('python', resource)
            .inspect<string>('defaultInterpreterPath');

        return !!(inspected?.workspaceFolderValue || inspected?.workspaceValue);
    }

    private isPathInWorkspace(pythonPath: string, resource: Uri): boolean {
        if (!path.isAbsolute(pythonPath)) {
            return false;
        }

        return this.getWorkspaceFolders(resource).some(folder => {
            const relativePath = path.relative(folder.uri.fsPath, pythonPath);
            return relativePath === ''
                || (!!relativePath && relativePath !== '..' && !relativePath.startsWith(`..${path.sep}`) && !path.isAbsolute(relativePath));
        });
    }

    getPythonPath(resource?: Uri, options: PythonPathOptions = {}) {
        // Prefer local project virtual environments so package lists stay scoped to the workspace.
        const localVenv = this.detectLocalVenv(resource);
        if (localVenv) {
            return localVenv;
        }

        // Then accept a workspace-scoped interpreter selected through the Python extension.
        return this.getPythonExtensionPath(resource, options);
    }

    get pythonPath() {
        return this.getPythonPath();
    }

    private waitPythonPath(timeoutMs: number = 5000, resource?: Uri) {
        let timer: NodeJS.Timeout | null = null;
        let timeoutTimer: NodeJS.Timeout | null = null;

        return new Promise<string>((resolve, reject) => {
            const tryResolvePythonPath = () => {
                const pythonPath = this.getPythonPath(resource);
                if (pythonPath) {
                    resolve(pythonPath);
                }
            };

            // Check immediately
            tryResolvePythonPath();

            // Keep checking every second
            timer = setInterval(tryResolvePythonPath, 1000);

            // Timeout after specified duration - resolve with empty string instead of waiting forever
            timeoutTimer = setTimeout(() => {
                resolve('');
            }, timeoutMs);
        }).finally(() => {
            if (timer !== null) {
                clearInterval(timer);
            }
            if (timeoutTimer !== null) {
                clearTimeout(timeoutTimer);
            }
        });
    }

    async waitPythonExtensionInited(): Promise<boolean> {
        const pythonPath = await this.waitPythonPath();
        return !!pythonPath;
    }

    onPythonPathChange(callback: (pythonPath: string) => any) {
        const dispose = this.pythonExtension?.exports?.settings.onDidChangeExecutionDetails((resource) => {
            const pythonPath = this.getPythonPath(resource);
            return callback(pythonPath);
        });
        if (dispose) {
            this._context.subscriptions.push(dispose);
        }
    };
}
