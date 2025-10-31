import * as vscode from 'vscode';
import * as path from 'path';

export function getHtmlForWebview(webview: vscode.Webview, context: vscode.ExtensionContext): string {

    // CSP'yi (Content Security Policy) stil etiketlerine (shiki'nin renkleri için)
    // izin verecek şekilde güncelliyoruz. 'unsafe-inline' zaten vardı,
    // ama 'style-src'ye ${webview.cspSource} ve 'unsafe-inline' eklemek daha doğru.
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" 
          content="default-src 'none'; 
                   style-src ${webview.cspSource} 'unsafe-inline'; 
                   script-src 'unsafe-inline';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Webview UI</title>
    <style>
        /* ... (Mevcut CSS'inizin çoğu) ... */
        html, body {
            margin: 0; padding: 0;
            height: 100vh; width: 100%;
            font-family: var(--vscode-font-family);
            color: var(--vscode-editor-foreground);
            background-color: var(--vscode-editor-background);
            box-sizing: border-box;
        }
        *, *:before, *:after { box-sizing: inherit; }
        .container {
            display: grid;
            height: 100%; width: 100%;
            grid-template-rows: 1fr auto; 
            gap: 0.5rem; padding: 0.5rem;
        }
        .content-panels {
            display: grid;
            grid-template-columns: 1fr 1fr; 
            gap: 0.5rem; min-height: 0; 
        }
        #files {
            border: 1px solid var(--vscode-panel-border);
            overflow: auto; 
            padding: 0.25rem;
        }
        
        #preview {
            border: 1px solid var(--vscode-panel-border);
            overflow: auto; 
            padding: 0.25rem;
            font-family: var(--vscode-editor-font-family);
            font-size: var(--vscode-editor-font-size);
            line-height: var(--vscode-editor-line-height);
            white-space: pre; 
        }
        #preview code {
            white-space: inherit;
        }
        #preview pre {
            margin: 0;
            padding: 0;
        }
        #preview .code-line {
            display: flex; 
            min-width: max-content; 
        }
        #preview .line-number {
            display: inline-block;
            width: 4em; 
            padding-right: 0.5em;
            text-align: right;
            color: var(--vscode-editorLineNumber-foreground);
            user-select: none; 
        }
        #preview .line-content {
            flex: 1; 
        }
        
        /* GÜNCELLENDİ: Vurgulanan satır stili */
        #preview .highlight-line {
            background-color: var(--vscode-editor-lineHighlightBackground);
            border: 1px solid var(--vscode-editor-lineHighlightBorder);
            
            /* YENİ: İsteğiniz üzerine satırı daha belirgin hale getirmek ("parlatmak") için
               yüksek kontrastlı 'focusBorder' rengini 'outline' olarak ekliyoruz. */
            outline: 1px solid var(--vscode-focusBorder);
            outline-offset: -1px; /* Çerçeveyi border'ın tam üzerine yerleştir */

            width: 100%;
        }
        #preview .highlight-line .line-number {
            color: var(--vscode-editorLineNumber-activeForeground);
        }

        /* YENİ: Aranan terim için <mark> stili */
        mark {
            background-color: var(--vscode-editor-findMatchHighlightBackground);
            color: inherit; 
            border: 1px solid var(--vscode-editor-findMatchHighlightBorder);
            border-radius: 2px;
        }
        .highlight-line mark {
            background-color: var(--vscode-editor-findMatchBackground);
            color: var(--vscode-editor-findMatchForeground);
            border-color: var(--vscode-editor-findMatchBorder);
        }

        /* ... (Arama kutusu ve dosya öğesi stillerinizde değişiklik yok) ... */
        #searchBox {
            width: 100%;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            padding: 0.5rem; border-radius: 2px;
        }
        #searchBox:focus {
            outline: 1px solid var(--vscode-focusBorder);
            border-color: var(--vscode-focusBorder);
        }
        .file-item {
            padding: 4px 8px;
            cursor: pointer;
            border-radius: 2px;
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
        }
        .file-item:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
        .file-item.selected {
          background-color: var(--vscode-list-activeSelectionBackground);
          color: var(--vscode-list-activeSelectionForeground); 
        }
        .file-item small {
            color: var(--vscode-descriptionForeground);
            margin-left: 8px;
        }
        .info-text {
            padding: 8px 12px;
            color: var(--vscode-descriptionForeground);
        }
    </style>
</head>
<body>

    <div class="container">
        <div class="content-panels">
            <div id="files"></div>
            <div id="preview"></div>
        </div>
        <input id="searchBox" type="text" placeholder="Search Term..." />
    </div>

    <script>
        (function() {
            const vscode = acquireVsCodeApi();
            const searchBox = document.getElementById('searchBox');
            const filesDiv = document.getElementById('files');
            const previewDiv = document.getElementById('preview'); 
            let selectedIndex = 0;
            
            // YENİ: Debounce (gecikme) işlemi için değişkenler
            let previewDebounceTimer;
            const PREVIEW_DEBOUNCE_DELAY = 100; // ms (isteğiniz üzerine 250ms)

            searchBox.focus();

            // YENİ: RegExp için özel karakterlerden kaçınma fonksiyonu
            function escapeRegExp(string) {
                // (DÜZELTİLDİ: $ karakteri için kaçış eklendi)
                return string.replace(/[.*+?^\\$\\{}()|[\]\\]/g, '\\$&');
            }

            // --- ARAMA KUTUSU (input) DİNLEYİCİSİ ---
            searchBox.addEventListener('input', (event) => {
                const searchTerm = event.target.value;
                vscode.postMessage({
                    command: 'search',
                    text: searchTerm
                });
                if (!searchTerm) {
                    previewDiv.innerHTML = '';
                }
            });

            // --- ARAMA KUTUSU (klavye) DİNLEYİCİSİ ---
            searchBox.addEventListener('keydown', (event) => {
                const items = filesDiv.querySelectorAll('.file-item');
                if (items.length === 0) return; 

                switch (event.key) {
                    case 'ArrowUp':
                        event.preventDefault(); 
                        selectedIndex--; 
                        if (selectedIndex < 0) selectedIndex = 0; 
                        highlightSelectedItem(items);
                        break;
                    
                    case 'ArrowDown':
                        event.preventDefault(); 
                        selectedIndex++; 
                        if (selectedIndex >= items.length) selectedIndex = items.length - 1;
                        highlightSelectedItem(items);
                        break;
                    
                    case 'Enter':
                        event.preventDefault();
                        const selectedItem = items[selectedIndex];
                        if (selectedItem) {
                             vscode.postMessage({
                                command: 'openFile',
                                filePath: selectedItem.dataset.filePath,
                                line: selectedItem.dataset.line
                            });
                        }
                        break;
                }
            });

            // --- DOSYA LİSTESİ (tıklama) DİNLEYİCİSİ ---
            filesDiv.addEventListener('click', (event) => {
                const clickedItem = event.target.closest('.file-item');
                if (!clickedItem) return; 

                const newIndex = parseInt(clickedItem.dataset.index, 10);
                
                if (newIndex === selectedIndex) {
                    vscode.postMessage({
                        command: 'openFile',
                        filePath: clickedItem.dataset.filePath,
                        line: clickedItem.dataset.line
                    });
                } 
                else {
                    selectedIndex = newIndex;
                    highlightSelectedItem(filesDiv.querySelectorAll('.file-item'));
                }
            });


            // --- MESAJ DİNLEYİCİ (GÜNCELLENDİ) ---
            window.addEventListener('message', (event) => {
                const message = event.data;
                switch (message.command) {
                    case 'results':
                        filesDiv.innerHTML = ''; 
                        previewDiv.innerHTML = ''; 
                        const results = message.data;
                        
                        if (results.length === 0) {
                            filesDiv.innerHTML = '<p class="info-text">Sonuç bulunamadı.</p>';
                            selectedIndex = -1; 
                            return;
                        }
                        
                        results.forEach((result, index) => { 
                            const item = document.createElement('div');
                            item.className = 'file-item';
                            item.dataset.index = index; 
                            item.dataset.filePath = result.filePath; 
                            item.dataset.line = result.line; 

                            const label = document.createElement('strong');
                            label.textContent = result.label; 
                            const description = document.createElement('small');
                            description.textContent = result.description;
                            item.appendChild(label);
                            item.appendChild(description);
                            filesDiv.appendChild(item);
                        });

                        selectedIndex = 0; 
                        highlightSelectedItem(filesDiv.querySelectorAll('.file-item'));
                        break;
                    
                    case 'error':
                        // (DÜZELTİLDİ: Template literal yerine string birleştirme)
                        filesDiv.innerHTML = '<p class="info-text" style="color: red;">Hata: ' + message.data + '</p>';
                        break;
                    
                    case 'previewContent':
                        const { tokenLines, line, searchTerm } = message.data;
                        previewDiv.innerHTML = ''; 

                        const searchRegex = searchTerm ? new RegExp(escapeRegExp(searchTerm), 'gi') : null;

                        const pre = document.createElement('pre');
                        const code = document.createElement('code');
                        
                        const targetLineIndex = line - 1; 
                        let highlightedElement = null;

                        for (let i = 0; i < tokenLines.length; i++) {
                            const lineElement = document.createElement('div');
                            lineElement.className = 'code-line';

                            const numberElement = document.createElement('span');
                            numberElement.className = 'line-number';
                            numberElement.textContent = i + 1; 

                            const contentElement = document.createElement('span');
                            contentElement.className = 'line-content';

                            const tokenLine = tokenLines[i];
                            if (tokenLine.length === 0) {
                                contentElement.innerHTML = ' '; 
                            } else {
                                for (const token of tokenLine) {
                                    const span = document.createElement('span');
                                    span.style.color = token.color;

                                    if (searchRegex && token.content) {
                                        span.innerHTML = token.content.replace(searchRegex, '<mark>$&</mark>');
                                    } else {
                                        span.textContent = token.content;
                                    }
                                    contentElement.appendChild(span);
                                }
                            }

                            if (i === targetLineIndex) {
                                lineElement.classList.add('highlight-line');
                                highlightedElement = lineElement;
                            }

                            lineElement.appendChild(numberElement);
                            lineElement.appendChild(contentElement);
                            code.appendChild(lineElement);
                        }

                        pre.appendChild(code);
                        previewDiv.appendChild(pre);

                        if (highlightedElement) {
                            highlightedElement.scrollIntoView({
                                behavior: 'auto', 
                                block: 'center'    
                            });
                        }
                        break;
                }
            });

            // --- YARDIMCI FONKSİYON (GÜNCELLENDİ: Debounce eklendi) ---
            function highlightSelectedItem(items) {
                
                // 1. YENİ: Bekleyen (gecikmiş) bir 'getPreview' isteği varsa, onu iptal et.
                clearTimeout(previewDebounceTimer);

                // 2. GÜNCEL: Dosya listesindeki seçimi ANINDA güncelle.
                items.forEach(item => item.classList.remove('selected'));
                const selectedItem = items[selectedIndex];
                
                if (selectedItem) {
                    // Seçimi ve scroll'u hemen yap
                    selectedItem.classList.add('selected');
                    selectedItem.scrollIntoView({
                        behavior: 'auto', 
                        block: 'nearest' 
                    });

                    // 3. YENİ: 'getPreview' komutunu 250ms gecikmeyle (debounce) gönder.
                    previewDebounceTimer = setTimeout(() => {
                        vscode.postMessage({
                            command: 'getPreview',
                            data: {
                                filePath: selectedItem.dataset.filePath,
                                line: selectedItem.dataset.line,
                                searchTerm: searchBox.value // Arama kutusundaki mevcut değeri gönder
                            }
                        });
                    }, PREVIEW_DEBOUNCE_DELAY); // 250ms bekle

                } else {
                    // Seçili öğe yoksa (örn. sonuç yok), önizlemeyi temizle
                    previewDiv.innerHTML = '';
                }
            }

        }()); 
    </script>

</body>
</html>
    `;
}