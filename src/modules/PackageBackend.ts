import * as path from 'path';

/**
 * Which tool executes package operations. Both speak the same JSON for
 * `list` and `list --outdated`, so the rest of the extension is backend-agnostic.
 */
export type BackendKind = 'pip' | 'uv';

export interface BackendCommand {
    command: string;
    args: string[];
}

export interface InstallOptions {
    upgrade?: boolean;
    indexUrl?: string;
    requirementsFile?: string;
}

export interface PackageBackend {
    readonly kind: BackendKind;
    list(): BackendCommand;
    outdated(indexUrl?: string): BackendCommand;
    freeze(): BackendCommand;
    install(specs: string[], options?: InstallOptions): BackendCommand;
    uninstall(name: string): BackendCommand;
}

class PipBackend implements PackageBackend {
    readonly kind = 'pip';

    constructor(private readonly pythonPath: string) {}

    private cmd(args: string[]): BackendCommand {
        return { command: this.pythonPath, args: ['-m', 'pip', ...args] };
    }

    private index(indexUrl?: string): string[] {
        return indexUrl ? ['-i', indexUrl] : [];
    }

    list() {
        return this.cmd(['list', '--format', 'json']);
    }

    outdated(indexUrl?: string) {
        return this.cmd(['list', '--outdated', '--format', 'json', ...this.index(indexUrl)]);
    }

    freeze() {
        return this.cmd(['freeze']);
    }

    install(specs: string[], options: InstallOptions = {}) {
        const args = ['install'];
        if (options.upgrade) {
            args.push('-U');
        }
        if (options.requirementsFile) {
            args.push('-r', options.requirementsFile);
        }
        args.push(...specs, ...this.index(options.indexUrl));
        return this.cmd(args);
    }

    uninstall(name: string) {
        return this.cmd(['uninstall', name, '-y']);
    }
}

class UvBackend implements PackageBackend {
    readonly kind = 'uv';

    constructor(private readonly pythonPath: string, private readonly uvPath: string) {}

    private cmd(args: string[]): BackendCommand {
        return { command: this.uvPath, args: ['pip', ...args, '--python', this.pythonPath] };
    }

    private index(indexUrl?: string): string[] {
        // `-i` still works in uv but is deprecated in favour of --default-index.
        return indexUrl ? ['--default-index', indexUrl] : [];
    }

    list() {
        return this.cmd(['list', '--format', 'json']);
    }

    outdated(indexUrl?: string) {
        return this.cmd(['list', '--outdated', '--format', 'json', ...this.index(indexUrl)]);
    }

    freeze() {
        return this.cmd(['freeze']);
    }

    install(specs: string[], options: InstallOptions = {}) {
        const args = ['install'];
        if (options.upgrade) {
            args.push('-U');
        }
        if (options.requirementsFile) {
            args.push('-r', options.requirementsFile);
        }
        args.push(...specs, ...this.index(options.indexUrl));
        return this.cmd(args);
    }

    uninstall(name: string) {
        // uv pip uninstall never prompts, and rejects pip's -y.
        return this.cmd(['uninstall', name]);
    }
}

export function createBackend(kind: BackendKind, pythonPath: string, uvPath = 'uv'): PackageBackend {
    return kind === 'uv' ? new UvBackend(pythonPath, uvPath) : new PipBackend(pythonPath);
}

/**
 * uv writes `uv = <version>` into pyvenv.cfg of every environment it creates.
 * A stdlib venv, conda env, or system interpreter never has that line.
 */
export function isUvManagedEnvironment(pyvenvCfgContents: string): boolean {
    return /^\s*uv\s*=/m.test(pyvenvCfgContents);
}

/**
 * pyvenv.cfg sits at the environment root, two levels above the interpreter
 * (`.venv/Scripts/python.exe` on Windows, `.venv/bin/python` elsewhere).
 * Returns null for bare commands like `python` that carry no directory.
 */
export function pyvenvCfgPathFor(pythonPath: string): string | null {
    if (!pythonPath || !(path.isAbsolute(pythonPath) || pythonPath.includes(path.sep) || pythonPath.includes('/'))) {
        return null;
    }
    const envRoot = path.dirname(path.dirname(pythonPath));
    return path.join(envRoot, 'pyvenv.cfg');
}
