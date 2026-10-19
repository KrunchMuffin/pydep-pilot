import * as vscode from 'vscode';
import { orderWorkspaceFolders } from './WorkspaceSelection';

function findWorkspaceFolder(resource?: vscode.Uri): vscode.WorkspaceFolder | undefined {
    return resource ? vscode.workspace.getWorkspaceFolder(resource) : undefined;
}

export function getWorkspaceFolders(resource?: vscode.Uri): vscode.WorkspaceFolder[] {
    const folders = vscode.workspace.workspaceFolders || [];
    const activeResource = resource || vscode.window.activeTextEditor?.document.uri;
    return orderWorkspaceFolders(folders, findWorkspaceFolder(activeResource), !!resource);
}
