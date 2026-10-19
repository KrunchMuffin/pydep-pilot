export interface EnvironmentEmptyState {
    message: string;
    hint: string;
    canUseGlobal: boolean;
}

type EnvironmentState = 'no-workspace' | 'non-python' | 'missing-environment';

export function environmentEmptyState(state: EnvironmentState, name: string, canUseGlobal: boolean): EnvironmentEmptyState {
    const descriptions = {
        'no-workspace': {
            message: 'No Python workspace is open.',
            localHint: 'Open a Python project or select a Python interpreter first.',
            globalHint: 'Open a Python project, select a workspace interpreter, or use the selected global interpreter.'
        },
        'non-python': {
            message: `${name} does not look like a Python project.`,
            localHint: 'Open a Python project or select a Python interpreter first.',
            globalHint: 'Open a Python project, or use the selected global interpreter to view global packages.'
        },
        'missing-environment': {
            message: `No project Python environment found in ${name}.`,
            localHint: 'Create a .venv folder or select a workspace interpreter.',
            globalHint: 'Create a .venv folder, select a workspace interpreter, or use the selected global interpreter.'
        }
    };
    const { message, localHint, globalHint } = descriptions[state];
    return { message, hint: canUseGlobal ? globalHint : localHint, canUseGlobal };
}
