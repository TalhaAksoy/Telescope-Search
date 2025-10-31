import * as vscode from 'vscode';
import * as path from 'path';

export function getHtmlForWebview(webview: vscode.Webview, context: vscode.ExtensionContext): string {

    // CSP'yi biraz güncellememiz gerekiyor (stil etiketleri için)
    // Aslında 'unsafe-inline' yeterli, ancak tema renklerini
    // kullanmak için stil etiketlerine izin vermek iyi bir pratik.
    // Senin kodunda zaten 'unsafe-inline' vardı, onu koruyoruz.
    // Not: script-src için 'nonce' kullanmak daha güvenlidir
    // ancak mevcut yapıyı bozmamak için 'unsafe-inline' ile devam ediyorum.

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
            grid-template-rows: 1fr auto; /* İçerik ve arama kutusu */
            gap: 0.5rem; padding: 0.5rem;
        }
        .content-panels {
            display: grid;
            grid-template-columns: 1fr 1fr; /* Sol (dosyalar) ve Sağ (önizleme) */
            gap: 0.5rem; min-height: 0; /* İçeriğin taşmasını engelle */
        }
        #files {
            border: 1px solid var(--vscode-panel-border);
            overflow: auto; /* Sadece dosya listesi için dikey scroll */
            padding: 0.25rem;
        }
        
        /* YENİ: Önizleme paneli stilleri */
        #preview {
            border: 1px solid var(--vscode-panel-border);
            overflow: auto; /* Önizleme için dikey/yatay scroll */
            padding: 0.25rem;
            /* VS Code editörünün yazı tipi ayarlarını kullanalım */
            font-family: var(--vscode-editor-font-family);
            font-size: var(--vscode-editor-font-size);
            line-height: var(--vscode-editor-line-height);
        }
        #preview pre {
            margin: 0;
            padding: 0;
        }
        /* YENİ: Önizlemedeki kod satırları için stiller */
        #preview .code-line {
            display: flex; /* Satır no ve içeriği hizalamak için */
            white-space: pre; /* <pre> içindeki boşlukları koru */
        }
        #preview .line-number {
            display: inline-block;
            width: 4em; /* Satır numaraları için sabit genişlik */
            padding-right: 0.5em;
            text-align: right;
            color: var(--vscode-editorLineNumber-foreground);
            user-select: none; /* Satır noları seçilemesin */
        }
        #preview .line-content {
            flex: 1; /* Satırın kalanını doldur */
        }
        /* YENİ: Eşleşen satırı vurgulamak için stil */
        #preview .highlight-line {
            background-color: var(--vscode-editor-lineHighlightBackground, #3c3c3c);
            border: 1px solid var(--vscode-editor-lineHighlightBorder, #555);
        }
        #preview .highlight-line .line-number {
            color: var(--vscode-editorLineNumber-activeForeground, #c6c6c6);
        }


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
            <div id="files">
                </div>
            <div id="preview">
                </div>
        </div>
        <input id="searchBox" type="text" placeholder="Search Term..." />
    </div>

    <script>
        (function() {
            const vscode = acquireVsCodeApi();
            const searchBox = document.getElementById('searchBox');
            const filesDiv = document.getElementById('files');
            const previewDiv = document.getElementById('preview'); // YENİ: Önizleme div'i
            let selectedIndex = 0;
            searchBox.focus();

            // --- ARAMA KUTUSU (input) DİNLEYİCİSİ (GÜNCELLENDİ) ---
            searchBox.addEventListener('input', (event) => {
                const searchTerm = event.target.value;
                vscode.postMessage({
                    command: 'search',
                    text: searchTerm
                });
                
                // YENİ: Arama kutusu boşsa önizlemeyi temizle
                if (!searchTerm) {
                    previewDiv.innerHTML = '';
                }
            });

            // --- ARAMA KUTUSU (klavye) DİNLEYİCİSİ (Değişiklik yok) ---
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
                    
                    // YENİ: Enter tuşuna basıldığında dosyayı aç
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

            // --- DOSYA LİSTESİ (tıklama) DİNLEYİCİSİ (Değişiklik yok) ---
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
                        previewDiv.innerHTML = ''; // YENİ: Yeni arama yapıldığında önizlemeyi temizle
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
                    
                    // YENİ: ÖNİZLEME MESAJINI İŞLEME BLOKU
                    case 'previewContent':
                        const { fileContent, line } = message.data;
                        previewDiv.innerHTML = ''; // Önceki önizlemeyi temizle

                        const pre = document.createElement('pre');
                        const code = document.createElement('code');
                        
                        const lines = fileContent.split('\\n');
                        const targetLineIndex = line - 1; // 1 tabanlıdan 0 tabanlıya geçiş
                        const contextLines = 10; // Üstte ve altta gösterilecek satır sayısı

                        // Gösterilecek satır aralığını hesapla
                        const startLine = Math.max(0, targetLineIndex - contextLines);
                        const endLine = Math.min(lines.length, targetLineIndex + contextLines + 1);

                        let highlightedElement = null; // Vurgulanan satırı takip etmek için

                        for (let i = startLine; i < endLine; i++) {
                            const lineElement = document.createElement('div');
                            lineElement.className = 'code-line';

                            // Satır numarası
                            const numberElement = document.createElement('span');
                            numberElement.className = 'line-number';
                            numberElement.textContent = i + 1; // 1 tabanlı satır numarası

                            // Satır içeriği
                            const contentElement = document.createElement('span');
                            contentElement.className = 'line-content';
                            // Satır içeriğini al veya boşsa bir boşluk koy
                            contentElement.textContent = lines[i] || ' '; 

                            // Hedef satırıysa, vurgula
                            if (i === targetLineIndex) {
                                lineElement.classList.add('highlight-line');
                                highlightedElement = lineElement; // Bu elemanı kaydet
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
                                behavior: 'auto', // Anında kaydır
                                block: 'center'    // Dikey olarak ortala
                            });
                        }
                        break;
                }
            });

            // --- YARDIMCI FONKSİYON (GÜNCELLENDİ) ---
            function highlightSelectedItem(items) {
                // Önce tüm seçimleri kaldır
                items.forEach(item => item.classList.remove('selected'));
                
                const selectedItem = items[selectedIndex];
                
                if (selectedItem) {
                    // Yeni öğeyi seç
                    selectedItem.classList.add('selected');
                    // Seçili öğeyi dosya listesinde görünür alana kaydır
                    selectedItem.scrollIntoView({
                        behavior: 'auto', 
                        block: 'nearest' 
                    });

                    // YENİ: Seçim değiştikçe eklentiye 'getPreview' mesajı gönder
                    vscode.postMessage({
                        command: 'getPreview',
                        data: {
                            filePath: selectedItem.dataset.filePath,
                            line: selectedItem.dataset.line
                        }
                    });

                } else {
                    // YENİ: Seçili öğe yoksa (örn. sonuç yoksa) önizlemeyi temizle
                    previewDiv.innerHTML = '';
                }
            }

        }()); // Script'i hemen çalıştır
    </script>

</body>
</html>
    `;
}