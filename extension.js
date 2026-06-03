const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

/**
 * Parses a string to extract both Wikilinks [[path]] and Markdown links [text](path)
 * Returns an array of objects containing the target path, display label, and text boundaries.
 */
function findLinksInText(text) {
    const links = [];
    
    // 1. Match [[Wikilinks]] (handles [[path|display]] and [[path]])
    const wikiRegex = /\[\[([^\]]+)\]\]/g;
    let match;
    while ((match = wikiRegex.exec(text)) !== null) {
        const fullContent = match[1];
        // Split if there is a pipe separator for display text
        const targetPath = fullContent.split('|')[0].trim();
        links.push({
            path: targetPath,
            label: `[[${targetPath}]]`,
            start: match.index,
            end: wikiRegex.lastIndex,
            isWiki: true
        });
    }

    // 2. Match Standard [Markdown](Links)
    const mdRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    while ((match = mdRegex.exec(text)) !== null) {
        const targetPath = match[2].trim();
        links.push({
            path: targetPath,
            label: match[0],
            start: match.index,
            end: mdRegex.lastIndex,
            isWiki: false
        });
    }

    return links;
}

/**
 * Attempts to resolve and open a file path relative to the active document or workspace root.
 */
async function openTargetFile(targetPath, currentFilePath) {
    let resolvedPath = '';

    // Handle absolute Windows/Posix paths or paths relative to vault root
    if (path.isAbsolute(targetPath)) {
        resolvedPath = targetPath;
    } else {
        const currentDir = path.dirname(currentFilePath);
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const workspaceRoot = workspaceFolders ? workspaceFolders[0].uri.fsPath : '';

        // Try path relative to current file first
        let testPath = path.resolve(currentDir, targetPath);
        
        // If it doesn't exist and we have a workspace, try relative to workspace root (e.g., Vault Root)
        if (!fs.existsSync(testPath) && !path.extname(testPath) && fs.existsSync(testPath + '.md')) {
            testPath += '.md'; // Auto-append markdown extension if needed
        }

        if (fs.existsSync(testPath)) {
            resolvedPath = testPath;
        } else if (workspaceRoot) {
            resolvedPath = path.resolve(workspaceRoot, targetPath);
        } else {
            resolvedPath = testPath;
        }
    }

    // Append .md extension for bare Obsidian links if not present
    if (!path.extname(resolvedPath)) {
        resolvedPath += '.md';
    }

    const uri = vscode.Uri.file(resolvedPath);
    
    try {
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc);
    } catch (error) {
        // If file doesn't exist, ask the user if they want to create it
        const createOpt = 'Create File';
        const choice = await vscode.window.showErrorMessage(
            `File not found: ${path.basename(resolvedPath)}`, 
            createOpt
        );
        if (choice === createOpt) {
            fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
            fs.writeFileSync(resolvedPath, `# ${path.basename(resolvedPath, '.md')}\n\n`, 'utf8');
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc);
        }
    }
}

function activate(context) {
    let disposable = vscode.commands.registerCommand('follow-wikilinks.follow-link', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const document = editor.document;
        const selection = editor.selection;
        const cursorCharacter = selection.active.character;
        const lineText = document.lineAt(selection.active.line).text;

        // Extract all links on the current line
        const links = findLinksInText(lineText);
        if (links.length === 0) {
            vscode.window.showInformationMessage('No wikilinks or markdown links found on this line.');
            return;
        }

        // Check if the cursor is physically intersecting any specific link boundaries
        const linksUnderCursor = links.filter(link => cursorCharacter >= link.start && cursorCharacter <= link.end);

        let chosenLink = null;

        if (linksUnderCursor.length === 1) {
            // Direct hit: exact link under cursor found
            chosenLink = linksUnderCursor[0];
        } else if (links.length === 1) {
            // Fallback: Cursor isn't on it, but it's the only link on the line
            chosenLink = links[0];
        } else {
            // Conflict: Multiple links found on the line, invoke the QuickPick menu
            const items = links.map(l => ({
                label: l.label,
                description: l.path,
                linkData: l
            }));

            const picked = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select a link to follow'
            });

            if (!picked) return; // User canceled picker
            chosenLink = picked.linkData;
        }

        if (chosenLink) {
            await openTargetFile(chosenLink.path, document.fileName);
        }
    });

    context.subscriptions.push(disposable);
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};
