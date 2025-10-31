import { RipgrepResult } from "./extension";
import * as vscode from 'vscode';
// 'exec' yerine 'spawn' import ediyoruz
import { spawn } from 'child_process';
import * as path from 'path';

/**
 * Executes the 'ripgrep' (rg) command-line tool to search the workspace
 * using a streaming approach ('spawn') to handle large outputs.
 *
 * @param searchTerm The literal string to search for.
 * @param context The VS Code extension context (used to get workspace path).
 * @returns A Promise that resolves to an array of RipgrepResult objects.
 */
export async function runRipgrep(searchTerm: string, context: vscode.ExtensionContext): Promise<RipgrepResult[]> {
    
    // 1. Get the current workspace folder
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        return [{ 
            label: 'Please open a project folder first.', 
            description: '', 
            filePath: '', 
            line: 0 
        }];
    }
    const rootPath = workspaceFolders[0].uri.fsPath;

    // 2. Define the command and arguments for 'spawn'
    // 'spawn' does not use a shell by default, so we pass arguments
    // as an array. This is safer and avoids the need for 'safeSearchTerm'.
    const command = 'rg';
    const args = [
        '-F',               // --fixed-strings: Treat searchTerm as a literal
        '--vimgrep',        // Output format: {file}:{line}:{col}:{text}
        '--ignore-case',    // Case-insensitive
        searchTerm,         // The search term
        '.'                 // Search the current directory
    ];

    // 3. Execute the command using 'spawn'
    return new Promise<RipgrepResult[]>((resolve, reject) => {
        
        // Start the process
        const rgProcess = spawn(command, args, { cwd: rootPath });

        // Create variables to collect the streaming data
        let stdoutData = '';
        let stderrData = '';

        // 4. Listen for data chunks from stdout
        rgProcess.stdout.on('data', (chunk) => {
            // Append each chunk of data as it arrives
            stdoutData += chunk.toString();
        });

        // 5. Listen for data chunks from stderr
        rgProcess.stderr.on('data', (chunk) => {
            stderrData += chunk.toString();
        });

        // 6. Listen for when the process exits
        rgProcess.on('close', (code) => {
            // 'code' 1 means "no results found," which is not an error
            if (code !== 0 && code !== 1) {
                // An actual error occurred
                reject(`Ripgrep Error: ${stderrData}\nCommand: ${command} ${args.join(' ')}`);
                return;
            }
            
            // 7. Parse the *complete* stdout data
            const lines = stdoutData.split('\n').filter(line => line.length > 0);
            
            const results: RipgrepResult[] = lines.map(line => {
                const parts = line.split(':');
                if (parts.length < 4) { return null; }

                const filePath = path.join(rootPath, parts[0]);
                const lineNumber = parseInt(parts[1], 10);
                const content = parts.slice(3).join(':').trim();

                return {
                    label: `${path.basename(parts[0])}:${lineNumber}`,
                    description: content,
                    filePath: filePath,
                    line: lineNumber
                };
            }).filter((p): p is RipgrepResult => p !== null); 
            
            // 8. Resolve the promise with the results
            resolve(results);
        });

        // 9. Handle errors in starting the process itself
        // (e.g., 'rg' command not found in PATH)
        rgProcess.on('error', (err) => {
            reject(`Failed to start Ripgrep process: ${err.message}`);
        });
    });
}