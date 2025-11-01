import * as vscode from 'vscode';
import * as path from 'path';

/**
 * Generates the complete HTML content for the webview panel.
 * This HTML includes CSS (for VS Code theme integration) and all client-side JavaScript.
 *
 * @param webview The VS Code webview instance.
 * @param context The extension context (used for CSP source).
 * @returns A string of the complete HTML.
 */
export function getHtmlForWebview(webview: vscode.Webview, context: vscode.ExtensionContext): string {

    // Note: The Content-Security-Policy is crucial for webviews.
    // 'style-src ${webview.cspSource} 'unsafe-inline'': Allows VS Code theme variables and inline styles.
    // 'script-src 'unsafe-inline'': Allows our inline <script> block.
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
        /* Base styles */
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
        
        /* Main layout: content panels + search box */
        .container {
            display: grid;
            height: 100%; width: 100%;
            grid-template-rows: 1fr auto; 
            gap: 0.5rem; padding: 0.5rem;
        }

        /* Resizable panel layout */
        .content-panels {
            display: grid;
            /* 3-column layout: [files] [resizer] [preview] */
            grid-template-columns: 1fr 4px 1fr;
            gap: 0; 
            min-height: 0; 
        }

        /* Left panel: File list */
        #files {
            grid-column: 1; 
            border: 1px solid var(--vscode-panel-border);
            overflow: auto; 
            padding: 0.25rem;
        }

        /* Resizer handle */
        .resizer {
            grid-column: 2; 
            background: var(--vscode-panel-border);
            cursor: col-resize;
            width: 4px;
            height: 100%;
        }
        .resizer:hover { background: var(--vscode-focusBorder); }
        
        /* Class added to body during resize to prevent text selection */
        body.resizing {
            cursor: col-resize !important;
            user-select: none !important;
        }

        /* Right panel: Code preview */
        #preview {
            grid-column: 3; 
            border: 1px solid var(--vscode-panel-border);
            overflow: auto; 
            padding: 0.25rem;
            /* Use editor fonts for a consistent look */
            font-family: var(--vscode-editor-font-family);
            font-size: var(--vscode-editor-font-size);
            line-height: var(--vscode-editor-line-height);
            white-space: pre; 
        }

        /* Preview code block styles */
        #preview code { white-space: inherit; }
        #preview pre { margin: 0; padding: 0; }
        #preview .code-line { display: flex; min-width: max-content; }
        #preview .line-number {
            display: inline-block; width: 4em; padding-right: 0.5em;
            text-align: right; color: var(--vscode-editorLineNumber-foreground);
            user-select: none; 
        }
        #preview .line-content { flex: 1; }
        
        /* Highlighted line style (using theme colors) */
        #preview .highlight-line {
            background-color: var(--vscode-editor-lineHighlightBackground);
            border: 1px solid var(--vscode-editor-lineHighlightBorder);
            /* 'Glow' effect using the theme's focus border color */
            outline: 1px solid var(--vscode-focusBorder);
            outline-offset: -1px; 
            width: 100%;
        }
        #preview .highlight-line .line-number { color: var(--vscode-editorLineNumber-activeForeground); }
        
        /* Highlighted search term (<mark>) style */
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

        /* Search box style */
        #searchBox {
            width: 100%; background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border);
            padding: 0.5rem; border-radius: 2px;
        }
        #searchBox:focus { outline: 1px solid var(--vscode-focusBorder); border-color: var(--vscode-focusBorder); }
        
        /* File list item styles */
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
        // IIFE (Immediately Invoked Function Expression) to keep scope clean
        (function() {
            // --- Acquire VS Code API and DOM Elements ---
            const vscode = acquireVsCodeApi();
            const searchBox = document.getElementById('searchBox');
            const filesDiv = document.getElementById('files');
            const previewDiv = document.getElementById('preview'); 
            const resizer = document.getElementById('resizer');
            const contentPanels = document.getElementById('content-panels');
            
            // --- State Variables ---
            let selectedIndex = 0;
            let previewDebounceTimer;
            const PREVIEW_DEBOUNCE_DELAY = 50; // ms to wait before fetching preview

            // Focus search box on load
            searchBox.focus();

            // --- Utility Functions ---
            
            /**
             * Escapes special characters in a string for use in a Regular Expression.
             * @param {string} string - The string to escape.
             * @returns {string} The escaped string.
             */
            function escapeRegExp(string) {
                // Escapes $ for the outer template literal, and then 
                // escapes special regex chars.

                // --- DÜZELTME 1: Kaçış karakteri (backslash) iki katına çıkarıldı ---
                return string.replace(/[.*+?^\$\{}()|[\]\\]/g, '\\\\$&');
            }

            // --- Event Listener: Search Input ---
            // Fired on every keystroke in the search box.
            // Sends the current value to the extension back-end.
            searchBox.addEventListener('input', (event) => {
                const searchTerm = event.target.value;
                vscode.postMessage({ command: 'search', text: searchTerm });
                if (!searchTerm) { previewDiv.innerHTML = ''; }
            });

            // --- Event Listener: Global Keydown ---
            // Handles keyboard navigation (ArrowUp, ArrowDown, Enter) globally,
            // so it works even when the search box isn't focused.
            window.addEventListener('keydown', (event) => {
                const items = filesDiv.querySelectorAll('.file-item');
                
                // Handle navigation keys
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

                // If the key wasn't a navigation key:
                
                // 1. If user is already typing in the search box, do nothing.
                if (document.activeElement === searchBox) { return; }
                
                // 2. If it's a modifier key (Shift, Ctrl, etc.), do nothing.
                if (event.key.length > 1 || event.metaKey || event.ctrlKey || event.altKey) { return; }
                
                // 3. If it's a printable character and user is not in the search box,
                //    re-focus the search box so they can start typing.
                searchBox.focus();
            });

            // --- Event Listener: File List Click ---
            // Handles mouse clicks on the file list.
            // A single click selects (and triggers preview).
            // A second click on an already-selected item opens the file.
            filesDiv.addEventListener('click', (event) => {
                const clickedItem = event.target.closest('.file-item');
                if (!clickedItem) return; 
                const newIndex = parseInt(clickedItem.dataset.index, 10);
                
                if (newIndex === selectedIndex) {
                    // Clicked on already selected item: open it
                    vscode.postMessage({
                        command: 'openFile',
                        filePath: clickedItem.dataset.filePath,
                        line: clickedItem.dataset.line
                    });
                } 
                else {
                    // Clicked on a new item: select it
                    selectedIndex = newIndex;
                    highlightSelectedItem(filesDiv.querySelectorAll('.file-item'));
                }
            });


            // --- Event Listener: Messages from Extension ---
            // Handles messages (results, preview content, errors)
            // sent from the extension (extension.ts) back-end.
            window.addEventListener('message', (event) => {
                const message = event.data;
                switch (message.command) {
                    
                    // 'results': New search results have arrived.
                    case 'results':
                        filesDiv.innerHTML = ''; 
                        previewDiv.innerHTML = ''; // Always clear preview on new results
                        const results = message.data;
                        
                        if (results.length === 0) {
                            filesDiv.innerHTML = '<p class="info-text">No results found.</p>';
                            selectedIndex = -1; 
                            
                            // BUGFIX: When "No results" is returned, we must call
                            // highlightSelectedItem with an empty list. This accomplishes two things:
                            // 1. It clears any pending preview request (from the debounce).
                            // 2. It triggers the 'else' block in highlightSelectedItem
                            //    to clear the preview panel.
                            // This prevents a race condition where old preview data
                            // appears next to a "No results" message.
                            highlightSelectedItem(filesDiv.querySelectorAll('.file-item'));

                            return; 
                        }
                        
                        // Populate the file list
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
                        
                        // Select the first item
                        selectedIndex = 0; 
                        highlightSelectedItem(filesDiv.querySelectorAll('.file-item'));
                        break;
                    
                    // 'error': An error occurred (e.g., Ripgrep failed)
                    case 'error':
                        // (Using string concatenation to avoid template literal conflicts)
                        filesDiv.innerHTML = '<p class="info-text" style="color: red;">Error: ' + message.data + '</p>';
                        break;
                    
                    // 'previewContent': The tokenized, syntax-highlighted content arrived.
                    case 'previewContent':
                        const { tokenLines, line, searchTerm } = message.data;
                        previewDiv.innerHTML = '';
                        
                        // --- DÜZELTME 2: YENİ VURGULAMA MANTIĞI ---
                        // 1. Arama terimini "kelimelere" ayırın.
                        //    (Sadece harf/rakam/alt çizgi olmayan her şeyi ayırıcı olarak kullan)
                        const searchWords = searchTerm 
                            ? searchTerm.split(/[^a-zA-Z0-9_]+/).filter(Boolean) 
                            : [];

                        // 2. Bu kelimelerden herhangi biriyle eşleşen bir regex oluşturun.
                        //    (escapeRegExp'in DÜZELTİLDİĞİNDEN emin olarak)
                        const highlightRegex = searchWords.length 
                            ? new RegExp(searchWords.map(escapeRegExp).join('|'), 'gi') 
                            : null;
                        // --- YENİ MANTIĞIN SONU ---

                        const pre = document.createElement('pre');
                        const code = document.createElement('code');
                        
                        const targetLineIndex = line - 1; // 1-based to 0-based
                        const totalLines = tokenLines.length;
                        let highlightedElement = null;

                        // --- Virtualized Preview Rendering ---
                         // This logic renders only a "window" of the file (e.g., ~60 lines)
                        // around the target line, instead of rendering the entire file
                        // (which could be 100,000+ lines) to the DOM.

                        // 1. Calculate the number of lines to render based on
                        //    the preview panel's height and the computed line height.
                        let singleLineHeight = parseFloat(window.getComputedStyle(previewDiv).lineHeight);
                        if (isNaN(singleLineHeight) || singleLineHeight === 0) {
                            let fontSize = parseFloat(window.getComputedStyle(previewDiv).fontSize);
                            if (isNaN(fontSize) || fontSize === 0) fontSize = 14; 
                            singleLineHeight = Math.round(fontSize * 1.4);
                        }
                        
                        const panelHeight = previewDiv.clientHeight;
                        const totalLinesToRender = Math.max(40, Math.ceil((panelHeight / singleLineHeight) * 1.5));
                        
                        let startLine = targetLineIndex - Math.floor(totalLinesToRender / 2);
                        let endLine = startLine + totalLinesToRender;

                        if (startLine < 0) {
                            const overshoot = -startLine;
                            startLine = 0;
                            endLine = Math.min(totalLines, endLine + overshoot);
                        }
                        if (endLine > totalLines) {
                            const overshoot = endLine - totalLines;
                            endLine = totalLines;
                            startLine = Math.max(0, startLine - overshoot);
                        }
                        // --- End of Virtualization Logic ---


                        // Loop only from startLine to endLine instead of the whole file
                        for (let i = startLine; i < endLine; i++) {
                            const lineElement = document.createElement('div');
                            lineElement.className = 'code-line';
                            const numberElement = document.createElement('span');
                            numberElement.className = 'line-number';
                            numberElement.textContent = i + 1; 
                            const contentElement = document.createElement('span');
                            contentElement.className = 'line-content';
                            
                            const tokenLine = tokenLines[i]; 
                            
                            if (tokenLine.length === 0) {
                                contentElement.innerHTML = ' '; // Render empty line
                            } else {
                                // Render syntax-highlighted tokens
                                for (const token of tokenLine) {
                                    const span = document.createElement('span');
                                    span.style.color = token.color;
                                    
                                    // --- DÜZELTME 2: VURGULAMA KONTROLÜ GÜNCELLENDİ ---
                                    // 'searchRegex' yerine 'highlightRegex' kullanın.
                                    if (highlightRegex && token.content) {
                                        span.innerHTML = token.content.replace(highlightRegex, '<mark>$&</mark>');
                                    } else {
                                        span.textContent = token.content;
                                    }
                                    // --- DEĞİŞİKLİK SONU ---

                                    contentElement.appendChild(span);
                                }
                            }
                            // Mark the target line
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
                        
                        // Scroll the highlighted line to the center of the panel
                        if (highlightedElement) {
                            highlightedElement.scrollIntoView({ behavior: 'auto', block: 'center' });
                        }
                        break;
                    // Theme Toggler
                    case 'themeChanged':
                        const selectedItem = filesDiv.querySelector('.file-item.selected');
                        if (selectedItem) {
                            // Önizlemeyi yeni temayla yeniden istemek için
                            // 'getPreview' komutunu tekrar gönder.
                            vscode.postMessage({
                                command: 'getPreview',
                                data: {
                                    filePath: selectedItem.dataset.filePath,
                                    line: selectedItem.dataset.line,
                                    searchTerm: searchBox.value
                                }
                            });
                        }
                        break;
                }
            });

            /**
             * Highlights the selected item in the file list and triggers the
             * preview with a debounce.
             * @param {NodeListOf<Element>} items - The list of .file-item elements.
             */
            function highlightSelectedItem(items) {
                // 1. Clear any pending preview request from the previous selection.
                clearTimeout(previewDebounceTimer);

                // 2. Update the selection UI immediately.
                items.forEach(item => item.classList.remove('selected'));
                const selectedItem = items[selectedIndex]; // Will be 'undefined' if selectedIndex = -1
                
                if (selectedItem) {
                    // 3a. If an item is selected:
                    selectedItem.classList.add('selected');
                    selectedItem.scrollIntoView({ behavior: 'auto', block: 'nearest' });

                    // 4. Schedule the 'getPreview' request with a debounce
                    //    to prevent flooding the extension on fast arrow key navigation.
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
                    // 3b. If no item is selected (e.g., "No results"):
                    //    Clear the preview panel immediately.
                    previewDiv.innerHTML = '';
                }
            }

            // --- Panel Resizing Logic ---
            // (Bu bölümde değişiklik yok)
            
            /** Handles the 'mousemove' event to resize the grid columns. */
            const doResize = (e) => {
                e.preventDefault();
                const leftPanelWidth = e.clientX - contentPanels.getBoundingClientRect().left;
                // Enforce min/max widths
                const minWidth = 100;
                const maxWidth = contentPanels.clientWidth - 100 - resizer.clientWidth;

                // Note: The \${} syntax is escaped for the outer template literal
                if (leftPanelWidth < minWidth) {
                    contentPanels.style.gridTemplateColumns = \`\${minWidth}px 4px 1fr\`;
                } else if (leftPanelWidth > maxWidth) {
                    contentPanels.style.gridTemplateColumns = \`\${maxWidth}px 4px 1fr\`;
                } else {
                    contentPanels.style.gridTemplateColumns = \`\${leftPanelWidth}px 4px 1fr\`;
                }
            };

            /** Cleans up listeners on 'mouseup'. */
            const stopResize = () => {
                window.removeEventListener('mousemove', doResize);
                window.removeEventListener('mouseup', stopResize);
                document.body.classList.remove('resizing');
            };

            /** Initializes the resize on 'mousedown'. */
            const initResize = (e) => {
                e.preventDefault();
                window.addEventListener('mousemove', doResize);
                window.addEventListener('mouseup', stopResize);
                // Add class to body to prevent text selection during drag
                document.body.classList.add('resizing');
            };

            // Attach the initial listener to the resizer handle
            resizer.addEventListener('mousedown', initResize);

        }()); 
    </script>

</body>
</html>
    `;
}