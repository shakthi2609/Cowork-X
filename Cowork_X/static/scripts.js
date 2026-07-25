/* ============ 1. INITIALIZE MERMAID & MARKED ============ */
  mermaid.initialize({
    startOnLoad: false,
    theme: 'default',
    securityLevel: 'loose',
  });

  // All Mermaid diagram types that the renderer should recognize
  const MERMAID_LANGUAGES = new Set([
    'mermaid',
    'flowchart', 'graph', 'flow',
    'sequenceDiagram', 'classDiagram', 'stateDiagram', 'stateDiagram-v2',
    'erDiagram', 'journey', 'gantt', 'pie', 'timeline',
    'gitgraph', 'gitGraph', 'requirementDiagram',
    'mindmap', 'quadrantChart', 'xychart', 'block',
    'c4context', 'c4container', 'c4component', 'c4dynamic', 'c4deployment',
    'sankey', 'zenuml', 'kanban', 'packet',
  ]);

  function escapeHtml(str) {
    return str
      .replace(/&/g, '\x26amp;')
      .replace(/</g, '\x26lt;')
      .replace(/>/g, '\x26gt;')
      .replace(/"/g, '\x26quot;')
      .replace(/'/g, '\x26#039;');
  }

  const renderer = new marked.Renderer();
  renderer.code = function(codeObj, lang) {
    const code = typeof codeObj === 'object' ? codeObj.text : codeObj;
    const language = typeof codeObj === 'object' ? codeObj.lang : lang;

    // Check if this is any Mermaid diagram type
    if (language && MERMAID_LANGUAGES.has(language)) {
      const safeCode = escapeHtml(code);

      return '<div class="mermaid-wrapper"><div class="mermaid-raw" style="display:none;">' + safeCode + '</div><div class="mermaid-target"></div></div>';
    }

    if (language && hljs.getLanguage(language)) {
      try {
        const highlighted = hljs.highlight(code, { language: language }).value;
        return '<pre><code class="hljs language-' + language + '">' + highlighted + '</code></pre>';
      } catch (e) {
        return '<pre><code>' + code + '</code></pre>';
      }
    }
    return '<pre><code>' + code + '</code></pre>';
  };

  marked.setOptions({
    renderer: renderer,
    breaks: true,
    gfm: true
  });

  /* ============ 2. ROCK-SOLID LATEX PRE-PROCESSOR ============ */
  // Renders LaTeX BEFORE Markdown can strip backslashes or mangle underscores.
  // Server-side sanitize_latex() already wraps bare math in $...$,
  // so this client-side just needs to render $$...$$ and $...$ with KaTeX.
  function parseLaTeXAndMarkdown(text) {
    if (!text) return '';

    // Step A: Protect code blocks so math inside `code` isn't touched
    const codeBlocks = [];
    let cleanText = text.replace(/(```[\s\S]*?```|`[^`\n]+`)/g, (match) => {
      codeBlocks.push(match);
      return '___CODE_BLOCK_' + (codeBlocks.length - 1) + '___';
    });

    // Step B: Normalize AI math delimiters \[ \] -> $$ $$ and \( \) -> $ $
    cleanText = cleanText.replace(/\\\[([\s\S]*?)\\\]/g, '$$$$$1$$$$');
    cleanText = cleanText.replace(/\\\(([\s\S]*?)\\\)/g, '$$$1$');

    // Step C: Render Display Math ($$ ... $$) using KaTeX
    // Uses [\s\S]*? (lazy) so it won't over-match across multiple display blocks
    cleanText = cleanText.replace(/\$\$([\s\S]+?)\$\$/g, (match, math) => {
      try {
        return katex.renderToString(math.trim(), { displayMode: true, throwOnError: false });
      } catch (e) {
        return match;
      }
    });

    // Step D: Render Inline Math ($ ... $) using KaTeX
    // Uses [\s\S]*? to handle multi-line inline math (e.g. $x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}$ 
    // that may have been broken across lines by the AI)
    // The negative lookahead (?!\$) ensures we don't match $$...$$ boundaries
    cleanText = cleanText.replace(/(?<!\$)\$([\s\S]+?)\$(?!\$)/g, (match, math) => {
      try {
        return katex.renderToString(math.trim(), { displayMode: false, throwOnError: false });
      } catch (e) {
        return match;
      }
    });

    // Step E: Restore code blocks
    cleanText = cleanText.replace(/___CODE_BLOCK_(\d+)___/g, (match, index) => {
      return codeBlocks[index];
    });

    // Step F: Convert the rest to Markdown
    return marked.parse(cleanText);
  }

  /* ============ 3. STATE & ELEMENTS ============ */
  const root = document.documentElement;
  const textarea = document.getElementById('messageInput');
  const sendBtn = document.getElementById('sendBtn');
  const chatScroll = document.getElementById('chatScroll');
  let greeting = document.getElementById('greeting');
  const toast = document.getElementById('toast');

  let isProcessing = false;
  
  const settings = JSON.parse(localStorage.getItem('cowork-settings')) || { theme: 'light' };

  function applySettings() {
    root.setAttribute('data-theme', settings.theme);
    const toggle = document.getElementById('darkModeToggle');
    if (toggle) toggle.checked = settings.theme === 'dark';
  }
  applySettings();

  /* ============ 4. MERMAID DIAGRAM RENDERING + PAN/ZOOM ============ */
  
  // Track active pan/zoom instances so we can clean up
  const panZoomInstances = new WeakMap();

  function initPanZoom(svgElement, wrapper) {
    if (!svgElement || !wrapper) return;
  
    // Clean up existing instance
    if (panZoomInstances.has(wrapper)) {
      const old = panZoomInstances.get(wrapper);
      try { old.destroy(); } catch(e) {}
    }
  
    // Remove old controls and zoom level to recreate fresh
    const oldControls = wrapper.querySelector('.mermaid-zoom-controls');
    if (oldControls) oldControls.remove();
    const oldZoomLevel = wrapper.querySelector('.mermaid-zoom-level');
    if (oldZoomLevel) oldZoomLevel.remove();
  
    try {
      const instance = svgPanZoom(svgElement, {
        zoomEnabled: true,
        controlIconsEnabled: false,
        fit: true,
        center: true,
        minZoom: 0.3,
        maxZoom: 10,
        zoomScaleSensitivity: 0.5,
        dblClickZoomEnabled: true,
        mouseWheelZoomEnabled: true,
        panEnabled: true,
        onPan: function(){ wrapper.style.cursor = 'grabbing'; },
        onZoom: function(){ wrapper.style.cursor = 'grab'; },
        beforePan: function(){ wrapper.style.cursor = 'grabbing'; }
      });
  
      panZoomInstances.set(wrapper, instance);
  
      // Add zoom controls
      const controls = document.createElement('div');
      controls.className = 'mermaid-zoom-controls';
      controls.innerHTML = `
        <button class="zoom-btn" data-action="zoom-in" title="Zoom In"><i class="fas fa-plus"></i></button>
        <button class="zoom-btn" data-action="zoom-out" title="Zoom Out"><i class="fas fa-minus"></i></button>
        <button class="zoom-btn" data-action="reset" title="Reset View"><i class="fas fa-expand"></i></button>
        <button class="zoom-btn" data-action="fit" title="Fit to View"><i class="fas fa-arrows-alt"></i></button>
        <button class="zoom-btn" data-action="copy-code" title="Copy Mermaid Code"><i class="fas fa-copy"></i></button>
        <button class="zoom-btn" data-action="download-svg" title="Download SVG"><i class="fas fa-file-code"></i></button>
        <button class="zoom-btn" data-action="download-png" title="Download PNG"><i class="fas fa-image"></i></button>
        <button class="zoom-btn" data-action="fullscreen" title="Fullscreen"><i class="fas fa-expand-arrows-alt"></i></button>
      `;
      wrapper.appendChild(controls);
  
      // Add zoom level indicator
      const zoomLevel = document.createElement('div');
      zoomLevel.className = 'mermaid-zoom-level';
      wrapper.appendChild(zoomLevel);
  
      // Update zoom level display
      const updateZoomLevel = () => {
        const zoom = instance.getZoom();
        zoomLevel.textContent = Math.round(zoom * 100) + '%';
      };
      instance.setOnZoom(updateZoomLevel);
      instance.setOnPan(updateZoomLevel);
      updateZoomLevel();
  
      // ---- Event listeners for controls ----
      controls.addEventListener('click', (e) => {
        const btn = e.target.closest('.zoom-btn');
        if (!btn) return;
        const action = btn.dataset.action;
  
        if (action === 'zoom-in') instance.zoomIn();
        else if (action === 'zoom-out') instance.zoomOut();
        else if (action === 'reset') { instance.resetZoom(); instance.center(); }
        else if (action === 'fit') { instance.fit(); instance.center(); }
        else if (action === 'copy-code') {
          const rawDiv = wrapper.querySelector('.mermaid-raw');
          if (rawDiv) {
            const code = rawDiv.textContent.trim();
            navigator.clipboard.writeText(code).then(() => {
              showToast('Mermaid code copied to clipboard!');
            }).catch(() => {
              // Fallback
              const textarea = document.createElement('textarea');
              textarea.value = code;
              document.body.appendChild(textarea);
              textarea.select();
              document.execCommand('copy');
              document.body.removeChild(textarea);
              showToast('Mermaid code copied!');
            });
          }
        } else if (action === 'download-svg') {
          const svg = wrapper.querySelector('.mermaid-target svg');
          if (svg) {
            const serializer = new XMLSerializer();
            const svgStr = serializer.serializeToString(svg);
            const blob = new Blob([svgStr], { type: 'image/svg+xml' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `diagram-${Date.now()}.svg`;
            a.click();
            URL.revokeObjectURL(url);
            showToast('SVG downloaded!');
          }
        } else if (action === 'download-png') {
          const svg = wrapper.querySelector('.mermaid-target svg');
          if (svg) {
            const clone = svg.cloneNode(true);
            const bbox = svg.getBBox();
            clone.setAttribute('width', bbox.width + 20);
            clone.setAttribute('height', bbox.height + 20);
            const canvas = document.createElement('canvas');
            canvas.width = bbox.width + 20;
            canvas.height = bbox.height + 20;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            const img = new Image();
            const svgData = new XMLSerializer().serializeToString(clone);
            const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
            const url = URL.createObjectURL(svgBlob);
            img.onload = function() {
              ctx.drawImage(img, 10, 10, bbox.width, bbox.height);
              URL.revokeObjectURL(url);
              const pngUrl = canvas.toDataURL('image/png');
              const a = document.createElement('a');
              a.href = pngUrl;
              a.download = `diagram-${Date.now()}.png`;
              a.click();
              showToast('PNG downloaded!');
            };
            img.src = url;
          }
        } else if (action === 'fullscreen') {
          // Create overlay if not exists
          let overlay = document.getElementById('diagramOverlay');
          if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'diagramOverlay';
            overlay.className = 'diagram-overlay';
            document.body.appendChild(overlay);
  
            // Close button
            const closeBtn = document.createElement('button');
            closeBtn.className = 'close-btn';
            closeBtn.innerHTML = '<i class="fas fa-times"></i>';
            closeBtn.addEventListener('click', () => {
              document.body.removeChild(overlay);
            });
            overlay.appendChild(closeBtn);
  
            // Click outside to close
            overlay.addEventListener('click', (e) => {
              if (e.target === overlay) {
                document.body.removeChild(overlay);
              }
            });
          }
  
          // Clone the current wrapper
          const wrapperClone = wrapper.cloneNode(true);
          wrapperClone.setAttribute('data-processed', 'true');
  
          // Remove any existing controls/zoom level from clone (will be recreated)
          const oldControlsClone = wrapperClone.querySelector('.mermaid-zoom-controls');
          if (oldControlsClone) oldControlsClone.remove();
          const oldZoomClone = wrapperClone.querySelector('.mermaid-zoom-level');
          if (oldZoomClone) oldZoomClone.remove();
  
          // Clear existing content in overlay (except close button)
          const existingContent = overlay.querySelector('.mermaid-wrapper');
          if (existingContent) existingContent.remove();
  
          overlay.appendChild(wrapperClone);
  
          // Re-initialize pan-zoom on the cloned SVG
          const svgClone = wrapperClone.querySelector('.mermaid-target svg');
          if (svgClone) {
            setTimeout(() => {
              initPanZoom(svgClone, wrapperClone);
            }, 50);
          }
  
          showToast('Fullscreen mode (click X or outside to close)');
        }
      });
  
      // Keyboard shortcuts for zoom
      const keyHandler = (e) => {
        if (e.ctrlKey && (e.key === '=' || e.key === '+')) {
          e.preventDefault();
          instance.zoomIn();
        } else if (e.ctrlKey && e.key === '-') {
          e.preventDefault();
          instance.zoomOut();
        } else if (e.ctrlKey && e.key === '0') {
          e.preventDefault();
          instance.resetZoom();
          instance.center();
        }
      };
  
      wrapper.addEventListener('keydown', keyHandler);
      wrapper._keyHandler = keyHandler;
  
      return instance;
    } catch (error) {
      console.warn('svg-pan-zoom init failed:', error);
      return null;
    }
  }

  async function renderMermaidDiagrams(container) {
    const wrappers = container.querySelectorAll('.mermaid-wrapper:not([data-processed])');
    if (wrappers.length === 0) return;

    for (const wrapper of wrappers) {
      wrapper.setAttribute('data-processed', 'true');
      
      const rawDiv = wrapper.querySelector('.mermaid-raw');
      const targetDiv = wrapper.querySelector('.mermaid-target');
      if (!rawDiv || !targetDiv) continue;

      const code = rawDiv.textContent.trim();
      if (!code) continue;

      // Attempt to render with auto-correction retry
      const maxRetries = 3;
      let currentCode = code;
      let success = false;

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        const uniqueId = 'mermaid-svg-' + Date.now() + '-' + Math.floor(Math.random() * 10000);

        try {
          const { svg } = await mermaid.render(uniqueId, currentCode);
          targetDiv.innerHTML = svg;
          
          // Initialize pan/zoom on the rendered SVG
          const svgElement = targetDiv.querySelector('svg');
          if (svgElement) {
            svgElement.setAttribute('tabindex', '0');
            svgElement.style.outline = 'none';
            svgElement.style.cursor = 'grab';
            setTimeout(() => initPanZoom(svgElement, wrapper), 50);
          }
          
          success = true;
          break; // Success — exit retry loop
        } catch (error) {
          console.warn('Mermaid render attempt ' + (attempt + 1) + '/' + maxRetries + ' failed:', error);
          
          // If we have more retries left, try to fix the diagram via the server
          if (attempt < maxRetries - 1) {
            try {
              const modelSelect = document.getElementById('modelSelect');
              const selectedModel = modelSelect ? modelSelect.value : '';

              const fixResponse = await fetch('/fix_diagram', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  code: currentCode,
                  error: error.message || 'Unknown rendering error',
                  model: selectedModel
                })
              });
              
              const fixData = await fixResponse.json();
              
              if (fixData.success && fixData.fixed_code && fixData.fixed_code !== currentCode) {
                console.log('Diagram corrected by AI, retrying...');
                currentCode = fixData.fixed_code;
              } else {
                console.warn('AI could not fix the diagram, original code unchanged');
                break; // No improvement possible, stop retrying
              }
            } catch (fixError) {
              console.error('Failed to fix diagram via server:', fixError);
              break; // Server error, stop retrying
            }
          }
        }
      }

      // If after all retries it still failed, show the error with retry button
      if (!success) {
        console.error('All ' + maxRetries + ' attempts to render Mermaid diagram failed');
        
        // Store the last code attempt for manual retry
        const lastCode = currentCode;
        
        targetDiv.innerHTML = '\
          <div class="diagram-error-container" style="color: #ff4757; background: rgba(255, 71, 87, 0.1); padding: 12px; border-radius: 6px; font-size: 13px;">\
            <div style="margin-bottom: 8px;">\
              \u26a0\ufe0f <strong>Diagram Error:</strong> AI generated invalid Mermaid syntax.\
            </div>\
            <button class="diagram-retry-btn" style="background: rgba(255, 71, 87, 0.2); border: 1px solid #ff4757; color: #ff4757; padding: 4px 12px; border-radius: 4px; cursor: pointer; font-size: 12px;">\
              <i class="fas fa-rotate"></i> Retry\
            </button>\
          </div>';
        
        // Add retry functionality
        const retryBtn = targetDiv.querySelector('.diagram-retry-btn');
        if (retryBtn) {
          retryBtn.addEventListener('click', async function(e) {
            const btn = e.currentTarget;
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Fixing...';
            
            try {
              const modelSelect = document.getElementById('modelSelect');
              const selectedModel = modelSelect ? modelSelect.value : '';

              const fixResponse = await fetch('/fix_diagram', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  code: lastCode,
                  error: 'Manual retry after all auto-retries failed',
                  model: selectedModel
                })
              });
              
              const fixData = await fixResponse.json();
              
              if (fixData.success && fixData.fixed_code) {
                // Clear the wrapper and re-render with fixed code
                wrapper.removeAttribute('data-processed');
                rawDiv.textContent = fixData.fixed_code;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Rendering...';
                await renderMermaidDiagrams(container);
              } else {
                btn.innerHTML = '<i class="fas fa-rotate"></i> Retry';
                btn.disabled = false;
                showToast('Could not fix the diagram. Please ask the AI to regenerate it.');
              }
            } catch (retryError) {
              console.error('Manual retry failed:', retryError);
              btn.innerHTML = '<i class="fas fa-rotate"></i> Retry';
              btn.disabled = false;
              showToast('Server error. Please try again.');
            }
          });
        }
      }
    }
  }

  /* ============ 5. CHAT LOGIC ============ */
  textarea.addEventListener('input', () => {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 150) + 'px';
    sendBtn.disabled = textarea.value.trim() === '' || isProcessing;
  });

  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!sendBtn.disabled) sendMessage();
    }
  });

  sendBtn.addEventListener('click', sendMessage);

  function buildWikipediaCard(result) {
    if (!result.found) {
      return '\
        <div class="wiki-card">\
          <div class="wiki-card-title"><i class="fas fa-wikipedia-w"></i> Not Found</div>\
          <div class="wiki-card-summary">' + escapeHtml(result.error || 'No results found.') + '</div>\
        </div>';
    }
    
    let sectionsHtml = '';
    if (result.sections && result.sections.length > 0) {
      sectionsHtml = '<div class="wiki-card-sections">' + 
        result.sections.map(s => '<span class="wiki-card-section-tag">' + escapeHtml(s) + '</span>').join('') + 
        '</div>';
    }
    
    return '\
      <div class="wiki-card">\
        <div class="wiki-card-title">\
          <i class="fas fa-wikipedia-w"></i> ' + escapeHtml(result.title) + '\
        </div>\
        <div class="wiki-card-summary">' + escapeHtml(result.summary || result.full_summary || '') + '</div>\
        <a href="' + escapeHtml(result.url || '#') + '" target="_blank" rel="noopener" class="wiki-card-link">\
          <i class="fas fa-external-link-alt"></i> Read full article on Wikipedia\
        </a>' + sectionsHtml + '\
      </div>';
  }

  function buildWikipediaSuggestions(result) {
    if (!result.results || result.results.length === 0) {
      return '\
        <div class="wiki-card">\
          <div class="wiki-card-title"><i class="fas fa-wikipedia-w"></i> No Suggestions</div>\
          <div class="wiki-card-summary">No Wikipedia pages found for your query.</div>\
        </div>';
    }
    
    const items = result.results.map(item => '\
      <div class="wiki-suggestion-item" onclick="window.open(\'' + escapeHtml(item.url) + '\', \'_blank\')">\
        <span>' + escapeHtml(item.title) + '</span>\
        <i class="fas fa-chevron-right"></i>\
      </div>\
    ').join('');
    
    return '\
      <div class="wiki-suggestions">\
        <div style="font-size:12px; font-weight:600; color:var(--fg-tertiary); padding:0 10px 8px; text-transform:uppercase; letter-spacing:0.04em;">\
          <i class="fas fa-wikipedia-w"></i> Wikipedia Suggestions\
        </div>' + items + '\
      </div>';
  }

  async function sendMessage() {
    const text = textarea.value.trim();
    if (!text || isProcessing) return;

    if (greeting && greeting.style.display !== 'none') greeting.style.display = 'none';

    addMessage(text, 'user');

    textarea.value = '';
    textarea.style.height = 'auto';
    sendBtn.disabled = true;

    isProcessing = true;
    showTypingIndicator();

    try {
      // Get selected model
      const modelSelect = document.getElementById('modelSelect');
      const selectedModel = modelSelect ? modelSelect.value : '';

      const response = await fetch('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          message: text,
          model: selectedModel
        })
      });

      const data = await response.json();
      hideTypingIndicator();
      
      if (data.success) {
        if (data.tool_calls && data.tool_calls.length > 0) {
          await addMessageWithToolCalls(data.response, data.tool_calls);
        } else {
          await addMessage(data.response, 'ai');
        }
      } else {
        await addMessage('Sorry, I encountered an error: ' + data.error, 'ai');
      }
    } catch (error) {
      hideTypingIndicator();
      await addMessage('Sorry, I couldn\'t connect to the server. Please try again later.', 'ai');
      console.error('Error:', error);
    }
    
    isProcessing = false;
    sendBtn.disabled = textarea.value.trim() === '';
  }

  async function addMessage(text, sender) {
    const wrapper = document.createElement('div');
    wrapper.className = 'message-wrapper ' + sender;
    
    const senderLabel = document.createElement('div');
    senderLabel.className = 'msg-sender';
    senderLabel.textContent = sender === 'user' ? 'You' : 'Cowork\u2122';
    
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    
    // Convert text to rendered LaTeX HTML first, then parse Markdown
    bubble.innerHTML = parseLaTeXAndMarkdown(text);
    
    wrapper.appendChild(senderLabel);
    wrapper.appendChild(bubble);
    chatScroll.appendChild(wrapper);
    
    // Render Mermaid Diagrams if present
    await renderMermaidDiagrams(bubble);
    
    chatScroll.scrollTop = chatScroll.scrollHeight;
  }

  async function addMessageWithToolCalls(text, toolCalls) {
    const wrapper = document.createElement('div');
    wrapper.className = 'message-wrapper ai';
    
    const senderLabel = document.createElement('div');
    senderLabel.className = 'msg-sender';
    senderLabel.textContent = 'Cowork\u2122';
    
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    
    // Build tool call indicators
    let toolHtml = '';
    for (const tc of toolCalls) {
      const displayName = tc.name === 'wikipedia_search' ? 'Wikipedia Search' : 
                          tc.name === 'wikipedia_search_suggestions' ? 'Wikipedia Suggestions' : 
                          tc.name === 'tavily_web_search' ? 'Tavily Web Search' : tc.name;
                          
      const query = tc.arguments && tc.arguments.query ? tc.arguments.query : '';
      
      toolHtml += '\
        <div class="tool-call-badge">\
          <i class="fas fa-wikipedia-w"></i>\
          <span>Searched <span class="tool-name">' + escapeHtml(displayName) + '</span> for <strong>\u201c' + escapeHtml(query) + '\u201d</strong></span>\
        </div>';
      
      // Build Wikipedia result cards
      if (tc.result) {
        if (tc.name === 'wikipedia_search') {
          toolHtml += buildWikipediaCard(tc.result);
        } else if (tc.name === 'wikipedia_search_suggestions') {
          toolHtml += buildWikipediaSuggestions(tc.result);
        } else if (tc.name === 'tavily_web_search') {
          toolHtml += buildTavilyCard(tc.result);
        }
      }
    }
    
    // Parse the AI response text + tool HTML
    const contentHtml = parseLaTeXAndMarkdown(text);
    bubble.innerHTML = toolHtml + contentHtml;
    
    wrapper.appendChild(senderLabel);
    wrapper.appendChild(bubble);
    chatScroll.appendChild(wrapper);
    
    // Render Mermaid Diagrams if present
    await renderMermaidDiagrams(bubble);
    
    chatScroll.scrollTop = chatScroll.scrollHeight;
  }

  function showTypingIndicator() {
    const wrapper = document.createElement('div');
    wrapper.className = 'message-wrapper ai';
    wrapper.id = 'typingWrapper';
    wrapper.innerHTML = '\
      <div class="msg-sender">Cowork\u2122</div>\
      <div class="typing-indicator">\
        <div class="typing-dot"></div>\
        <div class="typing-dot"></div>\
        <div class="typing-dot"></div>\
      </div>\
    ';
    chatScroll.appendChild(wrapper);
    chatScroll.scrollTop = chatScroll.scrollHeight;
  }

  function hideTypingIndicator() {
    const typing = document.getElementById('typingWrapper');
    if (typing) typing.remove();
  }

  /* ============ 6. THEME & MODALS ============ */
  document.getElementById('themeToggle').addEventListener('click', () => {
    settings.theme = settings.theme === 'dark' ? 'light' : 'dark';
    applySettings();
    saveSettings();
  });

  const settingsModal = document.getElementById('settingsModal');
  document.getElementById('openSettingsBtn').addEventListener('click', () => settingsModal.classList.add('show'));
  document.getElementById('openSettingsDropdownBtn').addEventListener('click', () => {
    document.getElementById('profileDropdown').classList.remove('show');
    settingsModal.classList.add('show');
  });
  document.getElementById('closeSettingsBtn').addEventListener('click', () => settingsModal.classList.remove('show'));
  settingsModal.addEventListener('click', (e) => { if (e.target === settingsModal) settingsModal.classList.remove('show'); });

  document.getElementById('darkModeToggle').addEventListener('change', (e) => {
    settings.theme = e.target.checked ? 'dark' : 'light';
    applySettings();
  });

  document.getElementById('saveSettingsBtn').addEventListener('click', () => {
    saveSettings();
    settingsModal.classList.remove('show');
    showToast('Settings saved successfully');
  });

  function saveSettings() {
    localStorage.setItem('cowork-settings', JSON.stringify(settings));
  }

  /* ============ 7. USER & SIDEBAR LOGIC ============ */
  const profileDropdown = document.getElementById('profileDropdown');
  const userCardBtn = document.getElementById('userCardBtn');
  if (userCardBtn) {
    userCardBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      profileDropdown.classList.toggle('show');
    });
  }
  
  document.addEventListener('click', (e) => {
    if (profileDropdown && !profileDropdown.contains(e.target) && e.target.id !== 'userCardBtn') {
      profileDropdown.classList.remove('show');
    }
  });

  document.getElementById('logoutBtn').addEventListener('click', () => {
    profileDropdown.classList.remove('show');
    document.getElementById('logoutScreen').classList.add('show');
  });

  document.getElementById('loginBackBtn').addEventListener('click', () => {
    document.getElementById('logoutScreen').classList.remove('show');
    showToast('Logged back in successfully');
  });

  document.getElementById('newChatBtn').addEventListener('click', async () => {
    try {
      await fetch('/new_chat', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      chatScroll.innerHTML = '<div class="greeting" id="greeting"><h1>Hi, I\'m Cowork\u2122.</h1><p>How can I help you today?</p></div>';
      greeting = document.getElementById('greeting');
      textarea.value = '';
      sendBtn.disabled = true;
      document.querySelectorAll('.history-item').forEach(i => i.classList.remove('active'));
      if (window.innerWidth <= 768) closeSidebar();
      showToast('New chat started');
    } catch (error) {
      console.error('Error starting new chat:', error);
      showToast('Failed to start new chat');
    }
  });

  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  function openSidebar() { sidebar.classList.add('open'); overlay.classList.add('show'); overlay.style.display = 'block'; }
  function closeSidebar() { sidebar.classList.remove('open'); overlay.classList.remove('show'); setTimeout(() => overlay.style.display = 'none', 300); }

  document.getElementById('menuBtn').addEventListener('click', openSidebar);
  document.getElementById('collapseBtn').addEventListener('click', closeSidebar);
  overlay.addEventListener('click', closeSidebar);

  let toastTimer;
  function showToast(message) {
    toast.innerHTML = '<i class="fas fa-circle-check" style="color: #4ade80;"></i> ' + message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
  }

  textarea.focus();


// Fetch models from the server and populate the dropdown
async function fetchAndPopulateModels() {
  try {
    const response = await fetch('/get_models');
    const data = await response.json();
    
    if (data.success && Array.isArray(data.models)) {
      const modelSelect = document.getElementById('modelSelect');
      if (!modelSelect) {
        console.warn('Model select element (#modelSelect) not found in the DOM.');
        return;
      }
      
      // Clear existing options
      modelSelect.innerHTML = '';
      
      // Add options
      data.models.forEach(modelName => {
        const option = document.createElement('option');
        option.value = modelName;
        option.textContent = modelName;
        modelSelect.appendChild(option);
      });
      
      // --- RESTORE SAVED MODEL FROM LOCALSTORAGE ---
      const savedModel = localStorage.getItem('cowork-selected-model');
      if (savedModel && data.models.includes(savedModel)) {
        modelSelect.value = savedModel;
      } else if (data.models.length > 0) {
        // Fallback to first model
        modelSelect.value = data.models[0];
        // Save it as default
        localStorage.setItem('cowork-selected-model', data.models[0]);
      }
      
      console.log('Models populated successfully. Selected:', modelSelect.value);
    } else {
      console.error('Failed to load models:', data.error || 'Unknown error');
    }
  } catch (error) {
    console.error('Error fetching models:', error);
  }
}

// When page loads: fetch models, restore saved selection, and listen for changes
document.addEventListener('DOMContentLoaded', function() {
  // 1. Fetch and populate the dropdown
  fetchAndPopulateModels();

  // 2. Listen for model changes and save to localStorage
  const modelSelect = document.getElementById('modelSelect');
  if (modelSelect) {
    modelSelect.addEventListener('change', function() {
      localStorage.setItem('cowork-selected-model', this.value);
      console.log('Model saved:', this.value);
    });
  }
});

function buildTavilyCard(result) {
  if (!result || !result.results || result.results.length === 0) {
    return `
      <div class="tavily-card">
        <div class="tavily-card-title"><i class="fas fa-globe"></i> Tavily Search</div>
        <div style="color:var(--fg-tertiary); font-size:13px;">No results found for <strong>${escapeHtml(result.query || '')}</strong>.</div>
      </div>
    `;
  }

  let answerHtml = '';
  if (result.answer) {
    answerHtml = `
      <div class="tavily-card-answer">
        <i class="fas fa-lightbulb" style="color:#fdcb6e; margin-right:6px;"></i>
        ${escapeHtml(result.answer)}
      </div>
    `;
  }

  const resultsHtml = result.results.map(item => `
    <div class="tavily-result-item">
      <span class="tavily-badge">${item.score ? Math.round(item.score * 100) + '%' : '•'}</span>
      <div>
        <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener">${escapeHtml(item.title || 'Link')}</a>
        ${item.content ? `<div class="tavily-snippet">${escapeHtml(item.content.substring(0, 150))}${item.content.length > 150 ? '…' : ''}</div>` : ''}
      </div>
    </div>
  `).join('');

  return `
    <div class="tavily-card">
      <div class="tavily-card-title">
        <i class="fas fa-globe"></i> Tavily Search
        <span style="font-weight:400; font-size:12px; color:var(--fg-tertiary); margin-left:auto;">${result.results.length} results</span>
      </div>
      ${answerHtml}
      <div class="tavily-card-results">
        ${resultsHtml}
      </div>
      ${result.query ? `<div style="font-size:11px; color:var(--fg-tertiary); margin-top:8px;">Query: “${escapeHtml(result.query)}”</div>` : ''}
    </div>
  `;
}
        