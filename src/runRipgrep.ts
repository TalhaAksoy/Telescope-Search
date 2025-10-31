import { RipgrepResult } from "./extension";
import * as vscode from 'vscode';
import { exec } from 'child_process';
import * as path from 'path';

export async function runRipgrep(searchTerm: string, context: vscode.ExtensionContext): Promise<RipgrepResult[]> {
    
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        return [{ label: 'Lütfen önce bir proje klasörü açın.', description: '', filePath: '', line: 0 }];
    }
    const rootPath = workspaceFolders[0].uri.fsPath;

    // --vimgrep formatı bize 'dosya:satır:sütun:içerik' çıktısını verir
    // --ignore-case büyük/küçük harf duyarsız arama
    const command = `rg --vimgrep --ignore-case "${searchTerm}" .`;

    return new Promise<RipgrepResult[]>((resolve, reject) => {
        exec(command, { cwd: rootPath }, (error, stdout, stderr) => {
            
            // Kod 1, 'sonuç bulunamadı' demektir, bu bir hata değil.
            if (error && error.code !== 1) { 
                reject(stderr);
                return;
            }

            const lines = stdout.split('\n').filter(line => line.length > 0);
            
            const results: RipgrepResult[] = lines.map(line => {
                const parts = line.split(':');
                const filePath = path.join(rootPath, parts[0]);
                const lineNumber = parseInt(parts[1], 10);
                const content = parts.slice(3).join(':').trim();

                return {
                    label: `${path.basename(parts[0])}:${lineNumber}`, // örn: 'extension.ts:45'
                    description: content, // Satırın içeriği
                    filePath: filePath,
                    line: lineNumber
                };
            });
            
            resolve(results);
        });
    });
}