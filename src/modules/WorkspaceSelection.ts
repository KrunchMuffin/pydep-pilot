import type { WorkspaceFolder } from 'vscode';

/** An explicit resource stays in its own workspace; the active editor only sets priority. */
export function orderWorkspaceFolders(
    folders: readonly WorkspaceFolder[],
    preferred: WorkspaceFolder | undefined,
    explicitResource: boolean
): WorkspaceFolder[] {
    if (explicitResource) {
        return preferred ? [preferred] : [];
    }
    if (!preferred) {
        return [...folders];
    }
    return [preferred, ...folders.filter(folder => folder.uri.toString() !== preferred.uri.toString())];
}
