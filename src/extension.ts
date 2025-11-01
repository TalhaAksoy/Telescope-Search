import * as vscode from 'vscode';
import { getHtmlForWebview } from './getHtmlWebView';
import { runRipgrep } from './runRipgrep';
import * as path from 'path';

// Import Shiki types for v1+ (ESM) from a CommonJS module.
// 'with { 'resolution-mode': 'import' }' is required by modern TypeScript
// to correctly resolve the types from an ES module.
import type { Highlighter, BundledLanguage } from 'shiki' with { 'resolution-mode': 'import' };

/**
 * Defines the structure for a single search result from Ripgrep.
 */
export type RipgrepResult = {
  label: string,
  description: string,
  filePath: string,
  line: number,
}

// --- Global Variables ---
// These are defined globally so they can be initialized once in 'activate'
// and then reused every time the 'vscode-telescope.telescope' command is run.

/**
 * Holds the currently active webview panel, if one exists.
 */
let currentPanel: vscode.WebviewPanel | undefined = undefined;
/**
 * Stores the name of the currently selected Shiki theme.
 */
let currentTheme: string = 'vitesse-dark'; // Varsayılan tema
/**
 * The key used to store the theme in VS Code's global state.
 */
const THEME_STORAGE_KEY = 'telescopeTheme';

/**
 * The Shiki highlighter instance.
 * It's loaded asynchronously on activation.
 */
let highlighter: Highlighter | undefined;

/**
 * The imported Shiki module namespace.
 * Used to call 'createHighlighter'.
 */
let shiki: typeof import('shiki', { with: { 'resolution-mode': 'import' } });

/**
 * Maps a file extension to a Shiki language identifier.
 * @param filePath The full path to the file.
 * @returns A {BundledLanguage} string (e.g., 'typescript', 'python', 'text').
 */
function getLangId(filePath: string): BundledLanguage {
  const ext = path.extname(filePath).substring(1);

  switch (ext) {
    // Web Languages
    case 'js':
    case 'mjs':
    case 'cjs':
      return 'javascript';
    case 'ts':
    case 'mts':
    case 'cts':
      return 'typescript';
    case 'html':
    case 'htm':
      return 'html';
    case 'css':
      return 'css';
    case 'scss':
      return 'scss';
    case 'less':
      return 'less';
    case 'json':
      return 'json';
    case 'xml':
      return 'xml';
    case 'svg':
      return 'xml';
    case 'jsonc':
      return 'jsonc';

    // Popular Backend Languages
    case 'py':
    case 'pyw':
      return 'python';
    case 'java':
    case 'jar':
      return 'java';
    case 'cs':
      return 'csharp';
    case 'go':
      return 'go';
    case 'php':
      return 'php';
    case 'rb':
      return 'ruby';
    case 'rs':
      return 'rust';
    case 'kt':
    case 'kts':
      return 'kotlin';
    case 'swift':
      return 'swift';
    case 'dart':
      return 'dart';

    // C-Family
    case 'c':
    case 'h':
      return 'c';
    case 'cpp':
    case 'hpp':
    case 'cc':
    case 'cxx':
      return 'cpp';

    // Shell & Scripting
    case 'sh':
    case 'bash':
      return 'bash';
    case 'ps1':
      return 'powershell';
    case 'bat':
      return 'bat';
    case 'pl':
      return 'perl';
    case 'lua':
      return 'lua';
    case 'r':
      return 'r';

    // Database
    case 'sql':
      return 'sql';

    // Documentation & Config
    case 'md':
    case 'markdown':
      return 'markdown';
    case 'yaml':
    case 'yml':
      return 'yaml';
    case 'toml':
      return 'toml';
    case 'ini':
      return 'ini';
    case 'env':
      return 'dotenv';
    case 'dockerfile':
    case 'Dockerfile':
      return 'docker';

    // Other
    case 'diff':
      return 'diff';
    case 'log':
      return 'log';

    // Default fallback
    case 'txt':
    default:
      // @ts-ignore
      // 'text' is the correct identifier for plain text in Shiki v1,
      // even if the 'BundledLanguage' type definition is missing it.
      return 'text';
  }
}

/**
 * The main activation function for the extension.
 * This is called once when the extension is first activated.
 * @param context The extension context provided by VS Code.
 */
export async function activate(context: vscode.ExtensionContext) {
  console.log('Congratulations, your extension "vscode-telescope" is now active!');

  currentTheme = context.globalState.get<string>(THEME_STORAGE_KEY) || 'vitesse-dark';

  // Asynchronously load the Shiki ESM module.
  try {
    // @ts-ignore
    shiki = await import('shiki');
  } catch (e) {
    console.error('Failed to load Shiki library. Syntax highlighting will be disabled.', e);
    vscode.window.showErrorMessage('Failed to load Shiki library.');
  }

  // Initialize the highlighter once on activation.
  // Pre-loading common languages improves performance.
  if (!highlighter && shiki) {
    highlighter = await shiki.createHighlighter({
      themes: [currentTheme, 'vitesse-dark', 'vitesse-light'],
      langs: [
        'javascript', 'typescript', 'html', 'css', 'json', 'markdown', 'text'
      ]
    });
  }

  // Register the main command that opens the webview panel.
  // This command is triggered by the command palette or keybindings.
  const disposable = vscode.commands.registerCommand('vscode-telescope.telescope', async () => {

    // Fallback: If highlighter failed to init on activation, try again.
    if (!highlighter && shiki) {
      try {
        highlighter = await shiki.createHighlighter({
          themes: [currentTheme, 'vitesse-dark', 'vitesse-light'],
          langs: [
            'javascript', 'typescript', 'html', 'css', 'json', 'markdown', 'text'
          ]
        });
      } catch (e) {
        console.error('Failed to create highlighter', e);
      }
    }

    // If Panel Open Get This Panel
    if (currentPanel) {
      currentPanel.reveal(vscode.ViewColumn.One);
      return;
    }

    // Define theme-aware icons for the editor tab
    const iconUriLight = vscode.Uri.joinPath(context.extensionUri, 'media', 'telescope-light.svg');
    const iconUriDark = vscode.Uri.joinPath(context.extensionUri, 'media', 'telescope-dark.svg');


    // Create the webview panel (opens as an editor tab)
    const panel = vscode.window.createWebviewPanel(
      'telescopeSearch',       // Internal ID
      'Telescope Search',      // Title shown in tab
      vscode.ViewColumn.One,   // Open in the primary editor column
      {
        enableScripts: true, // Allow JavaScript to run in the webview
        retainContextWhenHidden: true , // If Panel Closed Context Is Save
      }
    );

    currentPanel = panel;

    panel.onDidDispose(
      () => {
        currentPanel = undefined;
      },
      null, // 'this' context (gerekli değil)
      context.subscriptions // Eklenti kapatıldığında bu dinleyiciyi de temizle
    );

    // Set the theme-aware icon for the panel's tab
    panel.iconPath = {
      light: iconUriLight,
      dark: iconUriDark
    };

    // Set the HTML content for the webview
    panel.webview.html = getHtmlForWebview(panel.webview, context);

    // --- Message Listener: Webview -> Extension ---
    // Handle messages sent *from* the client-side JavaScript (in getHtmlWebView.ts)
    panel.webview.onDidReceiveMessage(
      async message => {
        switch (message.command) {

          // 'search': User is typing in the search box
          case 'search':
            const searchTerm = message.text;
            // Don't search for empty or single-character strings
            if (!searchTerm || searchTerm.length <= 2) {
              panel.webview.postMessage({ command: 'results', data: [] });
              return;
            }
            try {
              // Run the Ripgrep search
              const results = await runRipgrep(searchTerm, context);
              // Send results back to the webview
              panel.webview.postMessage({ command: 'results', data: results });
            } catch (e) {
              console.error(e);
              panel.webview.postMessage({ command: 'error', data: String(e) });
            }
            return;

          // 'openFile': User clicked or pressed Enter on a result
          case 'openFile':
            const filePath = message.filePath;
            const line = parseInt(message.line, 10) - 1; // to 0-based index
            try {
              const fileUri = vscode.Uri.file(filePath);
              // Open the file in the editor and move selection to the correct line
              await vscode.window.showTextDocument(fileUri, {
                preview: false,
                selection: new vscode.Range(line, 0, line, 0)
              });
            } catch (e) {
              vscode.window.showErrorMessage(`File Can't Open: ${filePath}`);
              console.error(e);
            }
            return;

          // 'getPreview': User selected a new item in the list
          case 'getPreview':
            const { filePath: previewFilePath, line: previewLine, searchTerm: previewSearchTerm } = message.data;

            if (!previewFilePath || !previewLine || !highlighter) {
              return; // Highlighter not ready
            }

            try {
              // 1. Read the file content
              const fileUri = vscode.Uri.file(previewFilePath);
              const fileBytes = await vscode.workspace.fs.readFile(fileUri);
              const fileContent = Buffer.from(fileBytes).toString('utf-8');

              // 2. Get language ID and current VS Code theme
              let lang = getLangId(previewFilePath);
              try {
                // Bu komut, 'kotlin' gibi dilleri ihtiyaç anında yükleyecektir.
                await highlighter.loadLanguage(lang);
              } catch (langError) {
                // Dil bulunamazsa 'text'e düş
                console.warn(`Shiki language '${lang}' not found. Falling back to 'text'.`);
                //@ts-ignore
                lang = 'text';
                await highlighter.loadLanguage('text');
              }

              const theme = currentTheme;

              // 3. Generate syntax-highlighted tokens using Shiki
              const tokenLines = highlighter.codeToTokens(fileContent, {
                lang: lang,
                theme: theme
              }).tokens; // .tokens is the array of tokenized lines

              // 4. Send the tokens back to the webview for rendering
              panel.webview.postMessage({
                command: 'previewContent',
                data: {
                  tokenLines: tokenLines,
                  line: parseInt(previewLine, 10),
                  searchTerm: previewSearchTerm
                }
              });
            } catch (e: any) {
              // Handle file read or tokenization errors
              console.error(e);
              panel.webview.postMessage({
                command: 'previewContent',
                data: {
                  tokenLines: [[{ content: `File Cant Read:\n${e.message}`, color: '#FF0000' }]],
                  line: 0,
                  searchTerm: ''
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

  // Add the command to the extension's subscriptions
  context.subscriptions.push(disposable);

  const themeToggleCommand = vscode.commands.registerCommand('vscode-telescope.toggleTheme', async () => {
    if (!shiki || !highlighter){
      vscode.window.showErrorMessage("Shiki highlighter is not ready.");
      return;
    }

    const themeNames = Object.keys(shiki.bundledThemes).sort();

    // 1. QuickPickItem nesne dizisini oluştur
    const themeItems: vscode.QuickPickItem[] = themeNames.map(themeName => ({
        label: themeName
    }));

    // 2. Mevcut (aktif) tema nesnesini bul
    const activeThemeItem = themeItems.find(item => item.label === currentTheme);

    // --- GÜNCELLENDİ: 'showQuickPick' yerine 'createQuickPick' kullan ---

    // 3. QuickPick menüsünü oluştur
    const quickPick = vscode.window.createQuickPick();
    quickPick.items = themeItems;
    quickPick.placeholder = `Select a Shiki theme (current: ${currentTheme})`;
    
    // 4. Aktif öğeyi ayarla (showQuickPick'in yapamadığı şey)
    if (activeThemeItem) {
        quickPick.activeItems = [activeThemeItem];
    }

    // 5. Kullanıcı bir öğe seçtiğinde (Enter'a bastığında) ne olacağını tanımla
    quickPick.onDidAccept(async () => {
        // Seçilen öğeyi al
        const chosenItem = quickPick.selectedItems[0];
        
        if (chosenItem && chosenItem.label !== currentTheme) {
            const chosenThemeName = chosenItem.label;
            
            try {
                // 1. Yeni Temayı Yükle
                // @ts-ignore
                await highlighter.loadTheme(chosenThemeName);
                
                // 2. Temayı Kaydet
                currentTheme = chosenThemeName;
                await context.globalState.update(THEME_STORAGE_KEY, currentTheme);

                // 3. Açıksa Paneli Güncelle
                if (currentPanel) {
                    currentPanel.webview.postMessage({ command: 'themeChanged' });
                }

                vscode.window.showInformationMessage(`Telescope theme set to: ${chosenThemeName}`);

            } catch (e) {
                console.error(`Failed to load theme ${chosenThemeName}:`, e);
                vscode.window.showErrorMessage(`Failed to load Shiki theme: ${chosenThemeName}`);
            }
        }
        
        // 6. İşlem bittikten sonra menüyü kapat
        quickPick.hide();
    });

    // 7. Kullanıcı menüyü kapatırsa (örn. Esc'ye basarsa) temizle
    quickPick.onDidHide(() => quickPick.dispose());

    // 8. Menüyü göster
    quickPick.show();
  });

  context.subscriptions.push(themeToggleCommand);
}

/**
 * This method is called when the extension is deactivated.
 */
export function deactivate() { }