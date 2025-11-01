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
    // 'style-src ${webview.cspSource} 'unsafe-inline'': 
    //   Allows VS Code theme variables (e.g., --vscode-editor-background)
    //   and our inline <style> block.
    // 'script-src 'unsafe-inline'': 
    //   Allows our inline <script> block.
    //   CRITICAL: No external scripts or other inline scripts are allowed.
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
        /* --- Base Styles & Theme Integration --- */
        html, body {
            margin: 0; padding: 0;
            height: 100vh; width: 100%;
            /* Use VS Code's font and theme colors for a native feel */
            font-family: var(--vscode-font-family);
            color: var(--vscode-editor-foreground);
            background-color: var(--vscode-editor-background);
            box-sizing: border-box;
            overflow: hidden; 
        }
        *, *:before, *:after { box-sizing: inherit; }
        
        /* --- Main Layout --- */
        /* This is a 2-row grid:
           1. The content panels (file list + preview)
           2. The search box at the bottom (fixed height)
        */
        .container {
            display: grid;
            height: 100%; width: 100%;
            grid-template-rows: 1fr auto; 
            gap: 0.5rem; padding: 0.5rem;
        }

        /* --- Resizable Panel Layout --- */
        /* This is a 3-column grid for the content area:
           [files list] [resizer handle] [code preview]
        */
        .content-panels {
            display: grid;
            grid-template-columns: 1fr 4px 1fr; /* Default: 50/50 split */
            gap: 0; 
            min-height: 0; /* Critical for overflow/scrolling in grid children */
        }

        /* Left panel: File list */
        #files {
            grid-column: 1; 
            border: 1px solid var(--vscode-panel-border);
            overflow: auto; 
            padding: 0.25rem;
        }

        /* The draggable divider */
        .resizer {
            grid-column: 2; 
            background: var(--vscode-panel-border);
            cursor: col-resize;
            width: 4px;
            height: 100%;
        }
        .resizer:hover { background: var(--vscode-focusBorder); }
        
        /* Helper class added to <body> via JS during resize.
           Prevents text selection "ghosting" while dragging. */
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
            /* Use editor fonts for a consistent code look */
            font-family: var(--vscode-editor-font-family);
            font-size: var(--vscode-editor-font-size);
            line-height: var(--vscode-editor-line-height);
            white-space: pre; /* Preserve whitespace from Shiki */
        }

        /* --- Preview Content Styles --- */
        #preview code { white-space: inherit; }
        #preview pre { margin: 0; padding: 0; }
        /* A single line of code is a flex container for number + content */
        #preview .code-line { display: flex; min-width: max-content; }
        #preview .line-number {
            display: inline-block; width: 4em; padding-right: 0.5em;
            text-align: right;
            color: var(--vscode-editorLineNumber-foreground);
            user-select: none; 
        }
        #preview .line-content { flex: 1; }
        
        /* Style for the exact line that matched the search */
        #preview .highlight-line {
            background-color: var(--vscode-editor-lineHighlightBackground);
            border: 1px solid var(--vscode-editor-lineHighlightBorder);
            /* 'Glow' effect using the theme's focus border color */
            outline: 1px solid var(--vscode-focusBorder);
            outline-offset: -1px; 
            width: 100%;
        }
        /* Make the line number stand out on the highlighted line */
        #preview .highlight-line .line-number {
            color: var(--vscode-editorLineNumber-activeForeground); 
        }
        
        /* Style for the search term *within* a line */
        mark {
            background-color: var(--vscode-editor-findMatchHighlightBackground);
            color: inherit; 
            border: 1px solid var(--vscode-editor-findMatchHighlightBorder);
            border-radius: 2px;
        }
        /* A different style for a search term on the *highlighted line* */
        .highlight-line mark {
            background-color: var(--vscode-editor-findMatchBackground);
            color: var(--vscode-editor-findMatchForeground);
            border-color: var(--vscode-editor-findMatchBorder);
        }

        /* --- Search Box Style --- */
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
        
        /* --- File List Item Styles --- */
        .file-item {
            padding: 4px 8px; cursor: pointer; border-radius: 2px;
            overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
        }
        .file-item:hover { background-color: var(--vscode-list-hoverBackground); }
        .file-item.selected {
          background-color: var(--vscode-list-activeSelectionBackground);
          color: var(--vscode-list-activeSelectionForeground); 
        }
        /* The (description) part of the file item */
        .file-item small { 
            color: var(--vscode-descriptionForeground); 
            margin-left: 8px; 
        }
        /* e.g., "No results found." */
        .info-text { 
            padding: 8px 12px; 
            color: var(--vscode-descriptionForeground); 
        }
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
        // Use an IIFE (Immediately Invoked Function Expression)
        // to avoid polluting the global scope.
        (function() {
            // --- 1. Acquire VS Code API and DOM Elements ---

            // Get the special API object to communicate with the extension back-end
            const vscode = acquireVsCodeApi();
            
            // Cache all necessary DOM elements for performance
            const searchBox = document.getElementById('searchBox');
            const filesDiv = document.getElementById('files');
            const previewDiv = document.getElementById('preview'); 
            const resizer = document.getElementById('resizer');
            const contentPanels = document.getElementById('content-panels');
            
            // --- 2. State Variables ---
            let selectedIndex = 0; // Current selection index in the file list
            let previewDebounceTimer; // Timer for debouncing preview requests
            const PREVIEW_DEBOUNCE_DELAY = 50; // ms to wait before fetching preview

            // Auto-focus the search box when the webview is opened
            searchBox.focus();

            // --- 3. Utility Functions ---
            
            /**
             * Escapes special characters in a string for use in a Regular Expression.
             * @param {string} string - The string to escape.
             * @returns {string} The escaped string.
             */
            function escapeRegExp(string) {
                // $& means the whole matched string
                // We need to escape special regex chars.
                //
                // IMPORTANT: We use '\\\\$&' (four backslashes) instead of '\\$&'.
                // This is because the script itself is inside a JavaScript Template Literal
                // (the \`...\` in getHtmlForWebview).
                // 1. TS Template Literal: '\\\\$&' -> becomes '\\$&' in the final HTML
                // 2. JS 'replace' function: '\\$&' -> correctly escapes the '$&' pattern
                return string.replace(/[.*+?^\$\{}()|[\]\\]/g, '\\\\$&');
            }

            // --- 4. Event Listeners ---

            /**
             * Event: User types in the search box.
             * On every keystroke, send the current value to the extension back-end.
             */
            searchBox.addEventListener('input', (event) => {
                const searchTerm = event.target.value;
                // Send 'search' command to extension.ts
                vscode.postMessage({ command: 'search', text: searchTerm });
                if (!searchTerm) { previewDiv.innerHTML = ''; } // Clear preview if search is empty
            });

            /**
             * Event: Global keydown handler.
             * Handles keyboard navigation (ArrowUp, ArrowDown, Enter) globally,
             * so it works even when the search box isn't focused.
             */
            window.addEventListener('keydown', (event) => {
                const items = filesDiv.querySelectorAll('.file-item');
                
                // Handle navigation keys
                switch (event.key) {
                    case 'ArrowUp':
                        event.preventDefault(); // Stop cursor from moving in search box
                        if (items.length === 0) return;
                        selectedIndex--; 
                        if (selectedIndex < 0) selectedIndex = 0; 
                        highlightSelectedItem(items); // Update UI and trigger preview
                        return;
                    case 'ArrowDown':
                        event.preventDefault(); // Stop cursor from moving in search box
                        if (items.length === 0) return;
                        selectedIndex++; 
                        if (selectedIndex >= items.length) selectedIndex = items.length - 1;
                        highlightSelectedItem(items); // Update UI and trigger preview
                        return;
                    case 'Enter':
                        event.preventDefault(); // Stop form submission
                        if (items.length === 0) return;
                        const selectedItem = items[selectedIndex];
                        if (selectedItem) {
                             // Send 'openFile' command to extension.ts
                             vscode.postMessage({
                                command: 'openFile',
                                filePath: selectedItem.dataset.filePath,
                                line: selectedItem.dataset.line
                            });
                        }
                        return;
                }

                // --- UX Improvement ---
                // If the key wasn't a navigation key:
                
                // 1. If user is already typing in the search box, do nothing.
                if (document.activeElement === searchBox) { return; }
                
                // 2. If it's a modifier key (Shift, Ctrl, etc.), do nothing.
                if (event.key.length > 1 || event.metaKey || event.ctrlKey || event.altKey) { return; }
                
                // 3. If it's a printable character and user is not in the search box,
                //    re-focus the search box so they can start typing immediately.
                searchBox.focus();
            });

            /**
             * Event: Mouse click on the file list.
             * Handles single-click to select (and trigger preview) and
             * "click on already-selected" to open the file.
             */
            filesDiv.addEventListener('click', (event) => {
                const clickedItem = event.target.closest('.file-item');
                if (!clickedItem) return; // Clicked on empty space
                
                const newIndex = parseInt(clickedItem.dataset.index, 10);
                
                if (newIndex === selectedIndex) {
                    // Clicked on the *already selected* item: open it.
                    vscode.postMessage({
                        command: 'openFile',
                        filePath: clickedItem.dataset.filePath,
                        line: clickedItem.dataset.line
                    });
                } 
                else {
                    // Clicked on a *new* item: select it.
                    selectedIndex = newIndex;
                    highlightSelectedItem(filesDiv.querySelectorAll('.file-item'));
                }
            });


            /**
             * Event: Main listener for messages *from* the extension back-end (extension.ts).
             * This handles all data coming from VS Code.
             */
            window.addEventListener('message', (event) => {
                const message = event.data;
                switch (message.command) {
                    
                    // Command: 'results'
                    // Sent when new search results are available from Ripgrep.
                    case 'results':
                        filesDiv.innerHTML = ''; // Clear old results
                        previewDiv.innerHTML = ''; // Always clear preview on new results
                        const results = message.data;
                        
                        if (results.length === 0) {
                            filesDiv.innerHTML = '<p class="info-text">No results found.</p>';
                            selectedIndex = -1; // No item is selected
                            
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
                            // Store data on the element for later retrieval
                            item.dataset.index = index; 
                            item.dataset.filePath = result.filePath; 
                            item.dataset.line = result.line; 
                            
                            const label = document.createElement('strong');
                            label.textContent = result.label; // e.g., "file.ts:10"
                            const description = document.createElement('small');
                            description.textContent = result.description; // e.g., "const foo = ..."
                            
                            item.appendChild(label);
                            item.appendChild(description);
                            filesDiv.appendChild(item);
                        });
                        
                        // Select the first item by default
                        selectedIndex = 0; 
                        highlightSelectedItem(filesDiv.querySelectorAll('.file-item'));
                        break;
                    
                    // Command: 'error'
                    // Sent if Ripgrep fails or another error occurs.
                    case 'error':
                        filesDiv.innerHTML = '<p class="info-text" style="color: var(--vscode-errorForeground);">Error: ' + message.data + '</p>';
                        break;
                    
                    // Command: 'previewContent'
                    // Sent when the syntax-highlighted tokens for a file arrive from Shiki.
                    case 'previewContent':
                        const { tokenLines, line, searchTerm } = message.data;
                        previewDiv.innerHTML = ''; // Clear old preview
                        
                        // --- Core Highlighting Logic ---
                        // We don't use the raw 'searchTerm' to highlight. Why?
                        // A search like "foo(bar)" might span multiple Shiki tokens
                        // (e.g., [Token('foo'), Token('('), Token('bar'), Token(')')]).
                        //
                        // So, we split the search term into "words" and highlight any token
                        // that matches *any* of those words.
                        
                        // 1. Split search term by non-word characters.
                        //    e.g., "showModalBottomSheet(" -> ["showModalBottomSheet"]
                        const searchWords = searchTerm 
                            ? searchTerm.split(/[^a-zA-Z0-9_]+/).filter(Boolean) 
                            : [];

                        // 2. Create a RegExp to match *any* of these words.
                        //    e.g., /showModalBottomSheet/gi
                        //    (Relies on our fixed escapeRegExp function)
                        const highlightRegex = searchWords.length 
                            ? new RegExp(searchWords.map(escapeRegExp).join('|'), 'gi') 
                            : null;
                        // --- End of Highlighting Logic ---

                        const pre = document.createElement('pre');
                        const code = document.createElement('code');
                        
                        const targetLineIndex = line - 1; // 1-based (from ripgrep) to 0-based (for array)
                        const totalLines = tokenLines.length;
                        let highlightedElement = null; // Store the target line element to scroll to it

                        // --- Virtualized Preview Rendering ---
                        // To prevent lag on huge files (e.g., 100k lines), we do not
                        // render all 100k lines to the DOM. We only render a "window"
                        // of lines around the target line.

                        // 1. Calculate the height of a single line.
                        let singleLineHeight = parseFloat(window.getComputedStyle(previewDiv).lineHeight);
                        if (isNaN(singleLineHeight) || singleLineHeight === 0) {
                            // Fallback calculation
                            let fontSize = parseFloat(window.getComputedStyle(previewDiv).fontSize);
                            if (isNaN(fontSize) || fontSize === 0) fontSize = 14; 
                            singleLineHeight = Math.round(fontSize * 1.4);
                        }
                        
                        // 2. Calculate how many lines to render (1.5x panel height, min 40).
                        const panelHeight = previewDiv.clientHeight;
                        const totalLinesToRender = Math.max(40, Math.ceil((panelHeight / singleLineHeight) * 1.5));
                        
                        // 3. Calculate the start/end lines for the render window, centered on the target.
                        let startLine = targetLineIndex - Math.floor(totalLinesToRender / 2);
                        let endLine = startLine + totalLinesToRender;

                        // 4. Clamp the window to the file boundaries (0 to totalLines).
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

                        // Now, loop *only* from startLine to endLine instead of the whole file
                        for (let i = startLine; i < endLine; i++) {
                            const lineElement = document.createElement('div');
                            lineElement.className = 'code-line';
                            
                            // Line Number
                            const numberElement = document.createElement('span');
                            numberElement.className = 'line-number';
                            numberElement.textContent = i + 1; // Display 1-based line number
                            
                            // Line Content
                            const contentElement = document.createElement('span');
                            contentElement.className = 'line-content';
                            
                            const tokenLine = tokenLines[i]; // Get the tokens for this line
                            
                            if (tokenLine.length === 0) {
                                contentElement.innerHTML = ' '; // Render an empty line
                            } else {
                                // Render each syntax-highlighted token
                                for (const token of tokenLine) {
                                    const span = document.createElement('span');
                                    span.style.color = token.color; // Apply Shiki color
                                    
                                    // Check if this token's content matches one of our search words
                                    if (highlightRegex && token.content) {
                                        // If it matches, wrap the match in <mark>
                                        span.innerHTML = token.content.replace(highlightRegex, '<mark>$&</mark>');
                                    } else {
                                        span.textContent = token.content;
                                    }
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
                    
                    // Command: 'themeChanged'
                    // Sent from extension.ts when the user runs the 'toggleTheme' command.
                    case 'themeChanged':
                        const selectedItem = filesDiv.querySelector('.file-item.selected');
                        if (selectedItem) {
                            // Re-request the preview for the currently selected item.
                            // The extension back-end (extension.ts) will see the
                            // new 'currentTheme' and ask Shiki for tokens with the new theme.
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

            // --- 5. Helper Functions ---

            /**
             * Central function to update the UI selection and trigger a preview.
             * @param {NodeListOf<Element>} items - The list of .file-item elements.
             */
            function highlightSelectedItem(items) {
                // 1. Clear any pending preview request from the *previous* selection.
                //    This is the "debounce" part.
                clearTimeout(previewDebounceTimer);

                // 2. Update the selection UI immediately.
                items.forEach(item => item.classList.remove('selected'));
                const selectedItem = items[selectedIndex]; // Will be 'undefined' if selectedIndex = -1
                
                if (selectedItem) {
                    // 3a. If an item is selected:
                    selectedItem.classList.add('selected');
                    // Ensure the selected item is visible in the list
                    selectedItem.scrollIntoView({ behavior: 'auto', block: 'nearest' });

                    // 4. Schedule the 'getPreview' request with a debounce.
                    //    This prevents spamming the extension with preview requests
                    //    while the user is rapidly pressing ArrowDown.
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

            // --- 6. Panel Resizing Logic ---
            // This logic handles dragging the divider between the files and preview panels.
            
            /** Handles the 'mousemove' event to resize the grid columns. */
            const doResize = (e) => {
                e.preventDefault();
                // Calculate the new width for the left panel
                const leftPanelWidth = e.clientX - contentPanels.getBoundingClientRect().left;
                
                // Enforce min/max widths to prevent collapsing
                const minWidth = 100; // 100px minimum
                const maxWidth = contentPanels.clientWidth - 100 - resizer.clientWidth; // 100px min for right panel

                // Note: The \${} syntax is escaped (\\\${}) for the outer template literal
                if (leftPanelWidth < minWidth) {
                    contentPanels.style.gridTemplateColumns = \`\${minWidth}px 4px 1fr\`;
                } else if (leftPanelWidth > maxWidth) {
                    contentPanels.style.gridTemplateColumns = \`\${maxWidth}px 4px 1fr\`;
                } else {
                    // Set the new grid layout
                    contentPanels.style.gridTemplateColumns = \`\${leftPanelWidth}px 4px 1fr\`;
                }
            };

            /** Cleans up listeners on 'mouseup'. */
            const stopResize = () => {
                window.removeEventListener('mousemove', doResize);
                window.removeEventListener('mouseup', stopResize);
                // Remove the helper class to re-enable text selection
                document.body.classList.remove('resizing');
            };

            /** Initializes the resize on 'mousedown'. */
            const initResize = (e) => {
                e.preventDefault();
                // Attach the move/up listeners to the window
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