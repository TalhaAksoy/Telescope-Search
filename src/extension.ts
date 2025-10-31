import * as vscode from 'vscode';
import { getHtmlForWebview } from './getHtmlWebView';
import { runRipgrep } from './runRipgrep';

export type RipgrepResult = {
	label: string,
	description: string,
	filePath: string,
	line: number,
}

export function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "vscode-telescope" is now active!');

	const disposable = vscode.commands.registerCommand('vscode-telescope.telescope', () => {
		const panel = vscode.window.createWebviewPanel(
			'telescopeSearch',
			'Telescope Search',
			vscode.ViewColumn.One,
			{
				enableScripts: true,
			}
		);

		panel.webview.html = getHtmlForWebview(panel.webview, context);

		panel.webview.onDidReceiveMessage(
			async message => {
				switch (message.command) {
					case 'search':
						const searchTerm = message.text;
						if (!searchTerm) {
							panel.webview.postMessage({ command: 'results', data: [] });
							return;
						}
						try {
							const results = await runRipgrep(searchTerm, context);
							// Sonuçları Webview'e geri gönder
							panel.webview.postMessage({ command: 'results', data: results });
						} catch (e) {
							console.error(e);
							// Hata olursa Webview'e hata mesajı gönder
							panel.webview.postMessage({ command: 'error', data: String(e) });
						}
						return;
					case 'openFile':
						const filePath = message.filePath;
						const line = parseInt(message.line, 10) - 1;

						try {
							const fileUri = vscode.Uri.file(filePath);

							await vscode.window.showTextDocument(fileUri, {
								preview: false,
								selection: new vscode.Range(line, 0, line, 0)
							});
						} catch (e) {
							vscode.window.showErrorMessage(`File Can't Open: ${filePath}`);
							console.error(e);
						}
						return;
					case 'getPreview':
						const { filePath: previewFilePath, line: previewLine } = message.data;

						if (!previewFilePath || !previewLine) {
							return;
						}

						try {
							const fileUri = vscode.Uri.file(previewFilePath);
							const fileBytes = await vscode.workspace.fs.readFile(fileUri);
							const fileContent = Buffer.from(fileBytes).toString('utf-8');

							panel.webview.postMessage({
								command: 'previewContent',
								data: {
									fileContent: fileContent,
									line: parseInt(previewLine, 10)
								}
							});
						} catch (e : any) {
							console.error(e);
							// Hata olursa önizleme paneline hata gönder
							panel.webview.postMessage({
								command: 'previewContent',
								data: {
									fileContent: `File Cant Read:\n${e.message}`,
									line: 0
								}
							});
						}

						return;
				}
			},
			undefined,
			context.subscriptions
		);
	});

	context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() { }
