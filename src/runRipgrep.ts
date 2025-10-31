import { RipgrepResult } from "./extension";
import * as vscode from 'vscode';
import { exec } from 'child_process';
import * as path from 'path';

/**
 * Executes the 'ripgrep' (rg) command-line tool to search the workspace.
 * * @param searchTerm The literal string to search for.
 * @param context The VS Code extension context (used to get workspace path).
 * @returns A Promise that resolves to an array of RipgrepResult objects.
 */
export async function runRipgrep(searchTerm: string, context: vscode.ExtensionContext): Promise<RipgrepResult[]> {
    
    // 1. Get the current workspace folder
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        // Handle the case where no folder is opened
        return [{ 
            label: 'Please open a project folder first.', 
            description: '', 
            filePath: '', 
            line: 0 
        }];
    }
    const rootPath = workspaceFolders[0].uri.fsPath;

    // 2. Sanitize the search term for shell execution
    // This escapes characters like quotes (") or backslashes (\) that could
    // break the 'exec' command.
    const safeSearchTerm = searchTerm.replace(/["\\]/g, '\\$&');

    // 3. Construct the ripgrep command
    //
    // -F, --fixed-strings: Treat the search term as a literal string,
    //   NOT as a regular expression. This is crucial to prevent
    //   errors from special characters like '(', '[', '+', etc.
    //
    // --vimgrep: Output results in 'vimgrep' format:
    //   {file}:{line}:{col}:{text}
    //
    // --ignore-case: Perform a case-insensitive search.
    //
    // "${safeSearchTerm}": The sanitized term to search for.
    //
    // ".": Search the current directory (which is 'rootPath').
    const command = `rg -F --vimgrep --ignore-case "${safeSearchTerm}" .`;

    // 4. Execute the command
    return new Promise<RipgrepResult[]>((resolve, reject) => {
        exec(command, { cwd: rootPath }, (error, stdout, stderr) => {
            
            // ripgrep exits with code 1 if no results are found.
            // This is expected behavior, not an actual error.
            if (error && error.code !== 1) { 
                // An actual error occurred (e.g., rg not installed, invalid args)
                reject(`Ripgrep Error: ${stderr}\nCommand: ${command}`);
                return;
            }

            // 5. Parse the stdout
            const lines = stdout.split('\n').filter(line => line.length > 0);
            
            const results: RipgrepResult[] = lines.map(line => {
                // Parse the vimgrep format: {file}:{line}:{col}:{text}
                const parts = line.split(':');
                
                // A valid vimgrep line must have at least 4 parts.
                // (e.g., file.txt:1:1:content)
                if (parts.length < 4) {
                    return null;
                }

                // The file path is the first part (relative to rootPath)
                const filePath = path.join(rootPath, parts[0]);
                const lineNumber = parseInt(parts[1], 10);
                
                // The content is everything *after* the 3rd colon.
                // We use slice(3).join(':') to correctly handle cases
                // where the content itself contains colons.
                const content = parts.slice(3).join(':').trim();

                return {
                    label: `${path.basename(parts[0])}:${lineNumber}`, // e.g., 'main.ts:45'
                    description: content, // The content of the matching line
                    filePath: filePath,   // Full, absolute path to the file
                    line: lineNumber
                };
            }).filter((p): p is RipgrepResult => p !== null); // Filter out any invalid (null) lines
            
            // 6. Return the successfully parsed results
            resolve(results);
        });
    });
}