import * as vscode from 'vscode';
import * as path from 'path';

export function getHtmlForWebview(webview: vscode.Webview, context: vscode.ExtensionContext): string {

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
        html, body {
            margin: 0; padding: 0;
            height: 100vh; width: 100%;
            font-family: var(--vscode-font-family);
            color: var(--vscode-editor-foreground);
            background-color: var(--vscode-editor-background);
            box-sizing: border-box;
            overflow: hidden; 
        }
        *, *:before, *:after { box-sizing: inherit; }
        .container {
            display: grid;
            height: 100%; width: 100%;
            grid-template-rows: 1fr auto; 
            gap: 0.5rem; padding: 0.5rem;
        }

        /* Panellerin olduğu alan */
        .content-panels {
            display: grid;
            /* 3 sütunlu yapı (sol, ayırıcı, sağ) */
            grid-template-columns: 1fr 4px 1fr;
            gap: 0; 
            min-height: 0; 
        }

        /* Sol dosya listesi */
        #files {
            grid-column: 1; 
            border: 1px solid var(--vscode-panel-border);
            overflow: auto; 
            padding: 0.25rem;
        }

        /* Yeniden boyutlandırma tutamacı */
        .resizer {
            grid-column: 2; 
            background: var(--vscode-panel-border);
            cursor: col-resize;
            width: 4px;
            height: 100%;
        }
        .resizer:hover {
            background: var(--vscode-focusBorder); 
        }
        
        /* Sürüklerken metin seçimini engelle */
        body.resizing {
            cursor: col-resize !important;
            user-select: none !important;
        }

        /* Sağ önizleme paneli */
        #preview {
            grid-column: 3; 
            border: 1px solid var(--vscode-panel-border);
            overflow: auto; 
            padding: 0.25rem;
            font-family: var(--vscode-editor-font-family);
            font-size: var(--vscode-editor-font-size);
            line-height: var(--vscode-editor-line-height);
            white-space: pre; 
        }
        
        /* Önizleme içi kod stilleri */
        #preview code { white-space: inherit; }
        #preview pre { margin: 0; padding: 0; }
        #preview .code-line { display: flex; min-width: max-content; }
        #preview .line-number {
            display: inline-block; width: 4em; padding-right: 0.5em;
            text-align: right; color: var(--vscode-editorLineNumber-foreground);
            user-select: none; 
        }
        #preview .line-content { flex: 1; }
        
        /* Vurgulanan (aktif) satır stili */
        #preview .highlight-line {
            background-color: var(--vscode-editor-lineHighlightBackground);
            border: 1px solid var(--vscode-editor-lineHighlightBorder);
            /* 'Parlama' efekti için dış çizgi */
            outline: 1px solid var(--vscode-focusBorder);
            outline-offset: -1px; 
            width: 100%;
        }
        #preview .highlight-line .line-number { color: var(--vscode-editorLineNumber-activeForeground); }
        
        /* Aranan terim (<mark>) stili */
        mark {
            background-color: var(--vscode-editor-findMatchHighlightBackground);
            color: inherit; border: 1px solid var(--vscode-editor-findMatchHighlightBorder);
            border-radius: 2px;
        }
        .highlight-line mark {
            background-color: var(--vscode-editor-findMatchBackground);
            color: var(--vscode-editor-findMatchForeground);
            border-color: var(--vscode-editor-findMatchBorder);
        }

        /* Arama kutusu */
        #searchBox {
            width: 100%; background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border);
            padding: 0.5rem; border-radius: 2px;
        }
        #searchBox:focus { outline: 1px solid var(--vscode-focusBorder); border-color: var(--vscode-focusBorder); }
        
        /* Dosya listesi öğesi */
        .file-item {
            padding: 4px 8px; cursor: pointer; border-radius: 2px;
            overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
        }
        .file-item:hover { background-color: var(--vscode-list-hoverBackground); }
        .file-item.selected {
          background-color: var(--vscode-list-activeSelectionBackground);
          color: var(--vscode-list-activeSelectionForeground); 
        }
        .file-item small { color: var(--vscode-descriptionForeground); margin-left: 8px; }
        .info-text { padding: 8px 12px; color: var(--vscode-descriptionForeground); }
    </style>
</head>
<body>

    <div class="container">
        <div class="content-panels" id="content-panels">
            <div id="files"></div>
            <div class="resizer" id="resizer"></div>
            <div id="preview"></div>
        </div>
        <input id="searchBox" type="text" placeholder="Search Term..." />
    </div>

    <script>
        (function() {
            // --- Değişkenler ---
            const vscode = acquireVsCodeApi();
            const searchBox = document.getElementById('searchBox');
            const filesDiv = document.getElementById('files');
            const previewDiv = document.getElementById('preview'); 
            const resizer = document.getElementById('resizer');
            const contentPanels = document.getElementById('content-panels');
            
            let selectedIndex = 0;
            let previewDebounceTimer;
            const PREVIEW_DEBOUNCE_DELAY = 250; 

            searchBox.focus();

            // --- Yardımcı Fonksiyon: RegExp Kaçış ---
            function escapeRegExp(string) {
                return string.replace(/[.*+?^\\$\\{}()|[\]\\]/g, '\\$&');
            }

            // --- Olay Dinleyicisi: Arama Kutusu Girdisi ---
            searchBox.addEventListener('input', (event) => {
                const searchTerm = event.target.value;
                vscode.postMessage({ command: 'search', text: searchTerm });
                if (!searchTerm) { previewDiv.innerHTML = ''; }
            });

            // --- Olay Dinleyicisi: Global Klavye ---
            window.addEventListener('keydown', (event) => {
                const items = filesDiv.querySelectorAll('.file-item');
                
                // Navigasyon tuşlarını (Ok/Enter) her zaman yakala
                switch (event.key) {
                    case 'ArrowUp':
                        event.preventDefault(); 
                        if (items.length === 0) return;
                        selectedIndex--; 
                        if (selectedIndex < 0) selectedIndex = 0; 
                        highlightSelectedItem(items);
                        return;
                    case 'ArrowDown':
                        event.preventDefault();
                        if (items.length === 0) return;
                        selectedIndex++; 
                        if (selectedIndex >= items.length) selectedIndex = items.length - 1;
                        highlightSelectedItem(items);
                        return;
                    case 'Enter':
                        event.preventDefault(); 
                        if (items.length === 0) return;
                        const selectedItem = items[selectedIndex];
                        if (selectedItem) {
                             vscode.postMessage({
                                command: 'openFile',
                                filePath: selectedItem.dataset.filePath,
                                line: selectedItem.dataset.line
                            });
                        }
                        return;
                }

                // Odak input'taysa, yazmaya izin ver
                if (document.activeElement === searchBox) { return; }
                // Kontrol tuşuysa (Shift vb.) es geç
                if (event.key.length > 1 || event.metaKey || event.ctrlKey || event.altKey) { return; }
                
                // Odak input'ta değilse ve 'a' gibi bir tuşa basıldıysa: input'a odaklan
                searchBox.focus();
            });

            // --- Olay Dinleyicisi: Dosya Listesi Tıklama ---
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


            // --- Olay Dinleyicisi: Eklentiden Gelen Mesajlar ---
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
                            highlightedElement.scrollIntoView({ behavior: 'auto', block: 'center' });
                        }
                        break;
                }
            });

            // --- Yardımcı Fonksiyon: Seçimi Vurgula (Debounce'lu) ---
            function highlightSelectedItem(items) {
                // Önceki gecikmeli isteği iptal et
                clearTimeout(previewDebounceTimer);

                // Seçimi UI'da anında güncelle
                items.forEach(item => item.classList.remove('selected'));
                const selectedItem = items[selectedIndex];
                
                if (selectedItem) {
                    selectedItem.classList.add('selected');
                    selectedItem.scrollIntoView({ behavior: 'auto', block: 'nearest' });

                    // Önizleme isteğini 250ms gecikmeyle gönder
                    previewDebounceTimer = setTimeout(() => {
                        vscode.postMessage({
                            command: 'getPreview',
                            data: {
                                filePath: selectedItem.dataset.filePath,
                                line: selectedItem.dataset.line,
                                searchTerm: searchBox.value
                            }
                        });
                    }, PREVIEW_DEBOUNCE_DELAY); 
                } else {
                    previewDiv.innerHTML = '';
                }
            }

            // --- Panel Yeniden Boyutlandırma Mantığı ---
            
            // 'mousemove' olayını yönetecek fonksiyon
            const doResize = (e) => {
                e.preventDefault();
                const leftPanelWidth = e.clientX - contentPanels.getBoundingClientRect().left;
                const minWidth = 100;
                const maxWidth = contentPanels.clientWidth - 100 - resizer.clientWidth;

                // --- HATA DÜZELTMESİ (Aşağıdaki 3 satır) ---
                if (leftPanelWidth < minWidth) {
                    contentPanels.style.gridTemplateColumns = \`\${minWidth}px 4px 1fr\`;
                } else if (leftPanelWidth > maxWidth) {
                    contentPanels.style.gridTemplateColumns = \`\${maxWidth}px 4px 1fr\`;
                } else {
                    contentPanels.style.gridTemplateColumns = \`\${leftPanelWidth}px 4px 1fr\`;
                }
            };

            // 'mouseup' olayını yönetecek fonksiyon
            const stopResize = () => {
                window.removeEventListener('mousemove', doResize);
                window.removeEventListener('mouseup', stopResize);
                document.body.classList.remove('resizing');
            };

            // 'mousedown' (başlangıç) olayını yönetecek fonksiyon
            const initResize = (e) => {
                e.preventDefault();
                window.addEventListener('mousemove', doResize);
                window.addEventListener('mouseup', stopResize);
                document.body.classList.add('resizing');
            };

            // Ana olayı (tutamaça tıklama) dinleyiciye bağla
            resizer.addEventListener('mousedown', initResize);

        }()); 
    </script>

</body>
</html>
    `;
}