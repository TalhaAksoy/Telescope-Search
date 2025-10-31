import * as vscode from 'vscode';
import { getHtmlForWebview } from './getHtmlWebView';
import { runRipgrep } from './runRipgrep';
import * as path from 'path';
// YENİ: Shiki'yi dinamik import edeceğimiz için,
// türlerini ayrı olarak import ediyoruz.
import type { Highlighter, BundledLanguage } from 'shiki' with { 'resolution-mode': 'import' };

export type RipgrepResult = {
  label: string,
  description: string,
  filePath: string,
  line: number,
}

// YENİ: Değişkenlerin türlerini `shiki` v1'den alıyoruz
let highlighter: Highlighter | undefined;
let shiki: typeof import('shiki', { with: { 'resolution-mode': 'import' } }); // Dinamik import'un türünü tutar

// YENİ: getLangId fonksiyonunun dönüş türünü BundledLang yapıyoruz
// Bu, shiki'nin bildiği dillerle kısıtlar
function getLangId(filePath: string): BundledLanguage {
  const ext = path.extname(filePath).substring(1);

  switch (ext) {
    // Web Dilleri
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
      return 'xml'; // veya 'html' de tercih edilebilir
    case 'jsonc': // Yorumlu JSON
      return 'jsonc';
      
    // Popüler Backend Dilleri
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

    // C Ailesi
    case 'c':
    case 'h': // C header
      return 'c';
    case 'cpp':
    case 'hpp': // C++ header
    case 'cc':
    case 'cxx':
      return 'cpp';

    // Shell & Scripting
    case 'sh':
    case 'bash':
      return 'bash'; // 'shell' veya 'sh' de olabilir
    case 'ps1':
      return 'powershell';
    case 'bat':
      return 'bat'; // Batch
    case 'pl':
      return 'perl';
    case 'lua':
      return 'lua';
    case 'r':
      return 'r';

    // Veritabanı
    case 'sql':
      return 'sql';

    // Dökümantasyon & Konfigürasyon
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
      return 'dotenv'; // .env dosyaları
    case 'dockerfile':
    case 'Dockerfile':
      return 'docker';
    
    // Diğer
    case 'diff':
      return 'diff';
    case 'log':
      return 'log';
    
    // HATA DÜZELTMESİ:
    // Bilinmeyen veya uzantısız dosyalar için 'plaintext' yerine 'text' kullanıyoruz.
    case 'txt':
    default:
			//@ts-ignore
      return 'text'; 
  }
}

// YENİ: activate fonksiyonu 'async' olmalı çünkü dinamik import yapacağız
export async function activate(context: vscode.ExtensionContext) {
  console.log('Congratulations, your extension "vscode-telescope" is now active!');

  // YENİ: Hata 1 (ESM/CJS) düzeltmesi: shiki'yi dinamik olarak import et
  try {
    shiki = await import('shiki');
  } catch (e) {
    console.error('Shiki kütüphanesi yüklenemedi. Renklendirme çalışmayacak.', e);
    vscode.window.showErrorMessage('Shiki kütüphanesi yüklenemedi.');
    // Shiki olmadan eklentinin devam etmesi anlamsızsa burada durabiliriz.
  }
  
  // Highlighter'ı bir kez oluşturalım.
  // Not: Dilleri önceden yüklemek performansı artırır.
  if (!highlighter && shiki) {
    // Hata 2 (getHighlighter) düzeltmesi: 'createHighlighter' kullan
    highlighter = await shiki.createHighlighter({
      // v1.x için popüler varsayılan temalar
      themes: ['vitesse-dark', 'vitesse-light'],
      // Sık kullanılan dilleri önceden yükle
      langs: [
        'javascript', 'typescript', 'css', 'json', 'python', 'markdown', 
        'java', 'csharp', 'go', 'php', 'ruby', 'rust', 'html', 'plaintext'
      ]
    });
  }

  const disposable = vscode.commands.registerCommand('vscode-telescope.telescope', async () => {
    
    // Highlighter'ın hazır olduğundan emin ol (eğer ilk deneme başarısız olduysa)
    if (!highlighter && shiki) {
      try {
        highlighter = await shiki.createHighlighter({
          themes: ['vitesse-dark', 'vitesse-light'],
          langs: ['javascript', 'typescript', 'css', 'json', 'python', 'markdown', 'java', 'csharp', 'go', 'php', 'ruby', 'rust', 'html', 'plaintext']
        });
      } catch (e) {
         console.error('Highlighter oluşturulamadı', e);
      }
    }

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
            // ... (Değişiklik yok) ...
            const searchTerm = message.text;
            if (!searchTerm) {
              panel.webview.postMessage({ command: 'results', data: [] });
              return;
            }
            try {
              const results = await runRipgrep(searchTerm, context);
              panel.webview.postMessage({ command: 'results', data: results });
            } catch (e) {
              console.error(e);
              panel.webview.postMessage({ command: 'error', data: String(e) });
            }
            return;
          case 'openFile':
            // ... (Değişiklik yok) ...
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
            const { filePath: previewFilePath, line: previewLine, searchTerm: previewSearchTerm } = message.data;

            // Highlighter yüklenmemişse işlemi atla
            if (!previewFilePath || !previewLine || !highlighter) {
              return;
            }

            try {
              const fileUri = vscode.Uri.file(previewFilePath);
              const fileBytes = await vscode.workspace.fs.readFile(fileUri);
              const fileContent = Buffer.from(fileBytes).toString('utf-8');
              
              const lang = getLangId(previewFilePath);

              // Kullanıcının mevcut VS Code temasını al
              const themeKind = vscode.window.activeColorTheme.kind;
              const theme = themeKind === vscode.ColorThemeKind.Dark ? 'vitesse-dark' : 'vitesse-light';

              // Hata 4 (codeToThemedTokens) düzeltmesi: 'codeToTokens' kullan
              // ve '.tokens' özelliğine eriş.
              const tokenLines = highlighter.codeToTokens(fileContent, {
                lang: lang,
                theme: theme
              }).tokens; // <-- .tokens eklemesi

              panel.webview.postMessage({
                command: 'previewContent',
                data: {
                  tokenLines: tokenLines, 
                  line: parseInt(previewLine, 10),
                  searchTerm: previewSearchTerm
                }
              });
            } catch (e : any) {
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

  context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() { }