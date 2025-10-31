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
        
        /* GÜNCELLENDİ: Önizleme paneli stilleri */
        #preview {
            border: 1px solid var(--vscode-panel-border);
            overflow: auto; 
            padding: 0.25rem;
            font-family: var(--vscode-editor-font-family);
            font-size: var(--vscode-editor-font-size);
            line-height: var(--vscode-editor-line-height);
            /* YENİ: pre içindeki boşlukları koru */
            white-space: pre; 
        }
        #preview code {
            /* code etiketi içindeki 'pre' boşluklarını koru */
            white-space: inherit;
        }
        #preview pre {
            margin: 0;
            padding: 0;
            /* pre'nin varsayılan padding/margin'ini sıfırla */
        }
        #preview .code-line {
            display: flex; 
            /* YENİ: Satırın taşmasını engelle, 
               ancak scrollbar #preview'de olacak */
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
        #preview .highlight-line {
            background-color: var(--vscode-editor-lineHighlightBackground);
            border: 1px solid var(--vscode-editor-lineHighlightBorder);
            /* YENİ: Vurgunun tüm satırı kaplamasını sağla */
            width: 100%;
        }
        #preview .highlight-line .line-number {
            color: var(--vscode-editorLineNumber-activeForeground);
        }

        /* YENİ: Aranan terim için <mark> stili */
        mark {
            /* VS Code'un bul ve vurgula renklerini kullan */
            background-color: var(--vscode-editor-findMatchHighlightBackground);
            color: inherit; /* Shiki'nin verdiği syntax rengini koru */
            border: 1px solid var(--vscode-editor-findMatchHighlightBorder);
            border-radius: 2px;
        }
        /* Aktif (vurgulanan) satırdaki terim daha da belirgin olsun */
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
            searchBox.focus();

            // YENİ: RegExp için özel karakterlerden kaçınma fonksiyonu
            function escapeRegExp(string) {
                return string.replace(/[.*+?^\\$\\{}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
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
                    
                    // GÜNCELLENDİ: Enter tuşu (açıklık için eklendi)
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
                        filesDiv.innerHTML = \`<p class="info-text" style="color: red;">Hata: \${message.data}</p>\`;
                        break;
                    
                    // YENİ: 'previewContent' case'i (TAMAMEN GÜNCELLENDİ)
                    case 'previewContent':
                        const { tokenLines, line, searchTerm } = message.data;
                        previewDiv.innerHTML = ''; // Önceki önizlemeyi temizle

                        // Arama terimini vurgulamak için RegExp oluştur
                        // (Büyük/küçük harf duyarsız 'i' ve global 'g')
                        const searchRegex = searchTerm ? new RegExp(escapeRegExp(searchTerm), 'gi') : null;

                        const pre = document.createElement('pre');
                        const code = document.createElement('code');
                        
                        const targetLineIndex = line - 1; // 1 tabanlıdan 0 tabanlıya
                        let highlightedElement = null;

                        // İstek 1: Tüm dosyayı işle (contextLines kaldırıldı)
                        for (let i = 0; i < tokenLines.length; i++) {
                            const lineElement = document.createElement('div');
                            lineElement.className = 'code-line';

                            // Satır numarası
                            const numberElement = document.createElement('span');
                            numberElement.className = 'line-number';
                            numberElement.textContent = i + 1; 

                            // Satır içeriği (token'lar için)
                            const contentElement = document.createElement('span');
                            contentElement.className = 'line-content';

                            // İstek 2: Shiki token'larını işle (Syntax Renkleri)
                            const tokenLine = tokenLines[i];
                            if (tokenLine.length === 0) {
                                // Boş satırsa
                                contentElement.innerHTML = ' '; // Boşluk ekle ki satır yüksekliği korunsun
                            } else {
                                for (const token of tokenLine) {
                                    const span = document.createElement('span');
                                    span.style.color = token.color;

                                    // İstek 3: Arama terimini <mark> ile vurgula
                                    if (searchRegex && token.content) {
                                        span.innerHTML = token.content.replace(searchRegex, '<mark>$&</mark>');
                                    } else {
                                        span.textContent = token.content;
                                    }
                                    contentElement.appendChild(span);
                                }
                            }

                            // Hedef satırıysa, vurgula
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

                        // Vurgulanan satırı görünür alana (ortaya) kaydır
                        if (highlightedElement) {
                            highlightedElement.scrollIntoView({
                                behavior: 'auto', 
                                block: 'center'    // Dikey olarak ortala
                            });
                        }
                        break;
                }
            });

            // --- YARDIMCI FONKSİYON (GÜNCELLENDİ) ---
            function highlightSelectedItem(items) {
                items.forEach(item => item.classList.remove('selected'));
                const selectedItem = items[selectedIndex];
                
                if (selectedItem) {
                    selectedItem.classList.add('selected');
                    selectedItem.scrollIntoView({
                        behavior: 'auto', 
                        block: 'nearest' 
                    });

                    // GÜNCELLENDİ: 'getPreview' mesajına 'searchTerm' ekle
                    vscode.postMessage({
                        command: 'getPreview',
                        data: {
                            filePath: selectedItem.dataset.filePath,
                            line: selectedItem.dataset.line,
                            searchTerm: searchBox.value // Arama kutusundaki mevcut değeri gönder
                        }
                    });

                } else {
                    previewDiv.innerHTML = '';
                }
            }

        }()); 
    </script>

</body>
</html>
    `;
}