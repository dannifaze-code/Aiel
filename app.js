/**
 * Aiel AI — Main Application
 * Orchestrates the UI, chat engine, learning system, and media generation.
 */
(async () => {
  'use strict';

  /* ── DOM refs ───────────────────────────────────────────────────────────── */

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

  const landingPage     = $('#landing-page');
  const appView         = $('#app-view');
  const messagesArea    = $('.messages-area');
  const chatInput       = $('#chat-input');
  const sendBtn         = $('#send-btn');
  const conversationsList = $('.conversations-list');
  const sidebar         = $('.sidebar');
  const sidebarToggle   = $('.sidebar-toggle');
  const newChatBtn      = $('.new-chat-btn');
  const modeBtns        = $$('.mode-btn');
  const aiStatusDot     = $('.ai-status-dot');
  const aiStatusText    = $('.ai-status-text');
  const learningIndicator = $('.learning-indicator');
  const settingsPanel   = $('.settings-panel');
  const memoryBadge     = $('.memory-badge');
  const charCount       = $('.char-count');
  const uploadInput     = $('#upload-input');
  const uploadPreview   = $('.upload-preview');
  const toastContainer  = $('.toast-container');

  /* ── State ──────────────────────────────────────────────────────────────── */

  let currentMode       = 'chat';
  let messages          = [];          // current conversation
  let currentConvId     = null;
  let isGenerating      = false;
  let uploadedImages    = [];
  let sidebarCollapsed  = window.innerWidth < 768;
  let darkMode          = true;

  /* ── Init ───────────────────────────────────────────────────────────────── */

  async function init() {
    initNeuralCanvas();
    initScrollEffects();
    bindLandingEvents();
    bindAppEvents();
    await AielLearning.init();
    await refreshConversations();
    await updateMemoryStats();
    initAIEngine();
    applySavedPrefs();
    registerServiceWorker();
  }

  /* ── Landing page ───────────────────────────────────────────────────────── */

  function bindLandingEvents() {
    $$('.cta-launch').forEach((btn) => btn.addEventListener('click', launchApp));
  }

  function launchApp() {
    landingPage.style.display = 'none';
    appView.classList.add('active');
    chatInput.focus();
  }

  /* ── Neural canvas background ───────────────────────────────────────────── */

  function initNeuralCanvas() {
    const canvas = $('#neural-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const nodes = [];
    const NUM_NODES = 60;

    function resize() {
      canvas.width  = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    for (let i = 0; i < NUM_NODES; i++) {
      nodes.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - .5) * .4,
        vy: (Math.random() - .5) * .4,
        r: Math.random() * 3 + 1
      });
    }

    function drawFrame() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      /* Draw connections */
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 130) {
            const alpha = (1 - dist / 130) * 0.35;
            ctx.beginPath();
            ctx.strokeStyle = `rgba(108,99,255,${alpha})`;
            ctx.lineWidth = .8;
            ctx.moveTo(nodes[i].x, nodes[i].y);
            ctx.lineTo(nodes[j].x, nodes[j].y);
            ctx.stroke();
          }
        }
      }

      /* Draw nodes */
      nodes.forEach((node) => {
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(108,99,255,0.8)';
        ctx.fill();

        node.x += node.vx;
        node.y += node.vy;

        if (node.x < 0 || node.x > canvas.width)  node.vx *= -1;
        if (node.y < 0 || node.y > canvas.height) node.vy *= -1;
      });

      requestAnimationFrame(drawFrame);
    }
    drawFrame();
  }

  /* ── Scroll effects ─────────────────────────────────────────────────────── */

  function initScrollEffects() {
    const nav = $('.nav');
    window.addEventListener('scroll', () => {
      nav?.classList.toggle('scrolled', window.scrollY > 20);
    });

    /* Intersection observer for section animations */
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.style.opacity = '1';
          entry.target.style.transform = 'translateY(0)';
        }
      });
    }, { threshold: .1 });

    $$('.feature-card, .step, .offline-card').forEach((el) => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(24px)';
      el.style.transition = 'opacity .5s ease, transform .5s ease';
      observer.observe(el);
    });
  }

  /* ── App events ─────────────────────────────────────────────────────────── */

  function bindAppEvents() {
    /* Send message */
    sendBtn.addEventListener('click', handleSend);
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    });

    /* Input resize & char count */
    chatInput.addEventListener('input', () => {
      chatInput.style.height = 'auto';
      chatInput.style.height = Math.min(chatInput.scrollHeight, 200) + 'px';
      updateCharCount();
    });

    /* Mode buttons */
    modeBtns.forEach((btn) => {
      btn.addEventListener('click', () => setMode(btn.dataset.mode));
    });

    /* Sidebar toggle */
    sidebarToggle.addEventListener('click', toggleSidebar);

    /* New chat */
    newChatBtn.addEventListener('click', startNewChat);

    /* Settings */
    $('#settings-btn')?.addEventListener('click', () => settingsPanel.classList.toggle('open'));
    $('#settings-close')?.addEventListener('click', () => settingsPanel.classList.remove('open'));

    /* Theme toggle */
    $('#theme-toggle')?.addEventListener('click', () => {
      darkMode = !darkMode;
      document.body.classList.toggle('light-mode', !darkMode);
      AielLearning.setPreference('darkMode', darkMode);
    });

    /* Upload */
    $('#upload-btn')?.addEventListener('click', () => uploadInput.click());
    uploadInput?.addEventListener('change', handleImageUpload);

    /* Voice input */
    $('#voice-btn')?.addEventListener('click', handleVoiceInput);

    /* Media panel buttons */
    $('#generate-media-btn')?.addEventListener('click', generateMedia);
    $('#download-media-btn')?.addEventListener('click', downloadMedia);
    $('#generate-media-panel-btn')?.addEventListener('click', generateMedia);
    $('#download-media-panel-btn')?.addEventListener('click', downloadMedia);

    /* Back to landing page */
    $('#back-to-home-btn')?.addEventListener('click', () => {
      appView.classList.remove('active');
      landingPage.style.display = '';
    });

    /* Suggestion cards */
    $$('.suggestion-card').forEach((card) => {
      card.addEventListener('click', () => {
        const prompt = card.dataset.prompt;
        if (prompt) {
          chatInput.value = prompt;
          handleSend();
        }
      });
    });

    /* PWA install */
    let deferredInstall = null;
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstall = e;
      $('#install-btn')?.classList.remove('hidden');
    });
    $('#install-btn')?.addEventListener('click', async () => {
      if (deferredInstall) {
        await deferredInstall.prompt();
        deferredInstall = null;
      }
    });

    /* Sidebar search */
    $('.sidebar-search input')?.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      $$('.conv-item').forEach((item) => {
        const title = item.querySelector('.conv-title')?.textContent.toLowerCase() || '';
        item.style.display = title.includes(q) ? '' : 'none';
      });
    });

    /* Close settings on outside click */
    document.addEventListener('click', (e) => {
      if (settingsPanel.classList.contains('open') &&
          !settingsPanel.contains(e.target) &&
          !$('#settings-btn')?.contains(e.target)) {
        settingsPanel.classList.remove('open');
      }
    });

    /* Mobile sidebar close on outside click */
    document.addEventListener('click', (e) => {
      if (window.innerWidth < 768 &&
          sidebar.classList.contains('mobile-open') &&
          !sidebar.contains(e.target) &&
          !sidebarToggle.contains(e.target)) {
        sidebar.classList.remove('mobile-open');
      }
    });
  }

  /* ── Mode management ────────────────────────────────────────────────────── */

  function setMode(mode) {
    currentMode = mode;
    modeBtns.forEach((btn) => btn.classList.toggle('active', btn.dataset.mode === mode));

    const mediaPanel = $('.media-panel');
    const welcomeScreen = $('.welcome-screen');

    if (mode === 'image' || mode === 'video') {
      if (messages.length === 0) {
        messagesArea.innerHTML = '';
        if (mediaPanel) {
          messagesArea.appendChild(mediaPanel);
          mediaPanel.classList.add('active');
        }
      }
      updatePlaceholder(mode);
    } else {
      mediaPanel?.classList.remove('active');
      if (messages.length === 0) showWelcomeScreen();
      updatePlaceholder(mode);
    }
  }

  function updatePlaceholder(mode) {
    const placeholders = {
      chat:  'Ask me anything…',
      code:  'Describe the code you need (language, task, requirements)…',
      image: 'Describe an image to generate (style, colours, subject)…',
      video: 'Describe a video or upload images to animate…'
    };
    chatInput.placeholder = placeholders[mode] || placeholders.chat;
  }

  /* ── Chat flow ──────────────────────────────────────────────────────────── */

  async function handleSend() {
    const text = chatInput.value.trim();
    if (!text || isGenerating) return;

    /* Add user message */
    addMessage('user', text);
    chatInput.value = '';
    chatInput.style.height = 'auto';
    updateCharCount();

    /* Special modes */
    if (currentMode === 'image') {
      await handleImageGeneration(text);
      return;
    }
    if (currentMode === 'video') {
      await handleVideoGeneration(text);
      return;
    }

    /* AI response */
    await generateResponse(text);
  }

  async function generateResponse(userInput) {
    isGenerating = true;
    sendBtn.disabled = true;
    setAIStatus('busy', 'Thinking…');

    /* Show typing indicator */
    const typingEl = addTypingIndicator();

    try {
      let fullResponse = '';

      /* Stream response */
      const stream = AielEngine.chat(messages, { mode: currentMode });

      /* Remove typing indicator and start streaming */
      let firstChunk = true;
      let assistantBubble = null;

      for await (const chunk of stream) {
        if (firstChunk) {
          typingEl?.remove();
          assistantBubble = addMessage('assistant', '', { streaming: true });
          firstChunk = false;
        }
        fullResponse += chunk;
        if (assistantBubble) {
          updateStreamingMessage(assistantBubble, fullResponse);
        }
      }

      if (firstChunk) {
        typingEl?.remove();
        assistantBubble = addMessage('assistant', fullResponse || 'I\'m not sure how to respond to that. Could you rephrase?');
      } else if (assistantBubble) {
        finaliseMessage(assistantBubble, fullResponse);
      }

      /* Learn from this interaction */
      const keywords = AielLearning.extractKeywords(userInput);
      await AielLearning.learnPattern(userInput, fullResponse, keywords);
      triggerLearningIndicator();

      /* Check if it was code */
      if (currentMode === 'code' || /```/.test(fullResponse)) {
        const lang = AielEngine.detectLanguage?.(userInput) || 'javascript';
        await AielLearning.saveCodeSnippet(userInput, fullResponse, lang);
      }

      await updateMemoryStats();

    } catch (err) {
      typingEl?.remove();
      addMessage('assistant', `⚠️ Oops! I hit a snag: ${err.message}. Try rephrasing your question.`);
    } finally {
      isGenerating = false;
      sendBtn.disabled = false;
      setAIStatus('ready', `${AielEngine.backend} engine`);
    }
  }

  /* ── Message rendering ──────────────────────────────────────────────────── */

  function addMessage(role, content, opts = {}) {
    /* Remove welcome screen if present */
    $('.welcome-screen')?.remove();
    $('.media-panel')?.classList.remove('active');

    /* Track in conversation */
    if (!opts.streaming) {
      messages.push({ role, content, timestamp: Date.now() });
    }

    const wrapper = document.createElement('div');
    wrapper.className = `message ${role}`;

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = role === 'user' ? '👤' : '🤖';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';

    if (opts.streaming) {
      bubble.innerHTML = '<span class="cursor">▌</span>';
    } else {
      bubble.innerHTML = renderMarkdown(content);
      addCodeBlockHandlers(bubble);
    }

    const meta = document.createElement('div');
    meta.className = 'message-meta';

    const timeSpan = document.createElement('span');
    timeSpan.textContent = formatTime(Date.now());
    meta.appendChild(timeSpan);

    if (role === 'assistant') {
      const copyBtn = document.createElement('button');
      copyBtn.className = 'meta-action';
      copyBtn.title = 'Copy';
      copyBtn.textContent = '📋';
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(content).then(() => showToast('📋 Copied to clipboard!', 'success'));
      });

      const thumbBtn = document.createElement('button');
      thumbBtn.className = 'meta-action';
      thumbBtn.title = 'Thumbs up';
      thumbBtn.textContent = '👍';
      thumbBtn.addEventListener('click', () => window.thumbsUp(thumbBtn));

      const regenBtn = document.createElement('button');
      regenBtn.className = 'meta-action';
      regenBtn.title = 'Regenerate';
      regenBtn.textContent = '🔄';
      regenBtn.addEventListener('click', () => window.regenerate());

      meta.appendChild(copyBtn);
      meta.appendChild(thumbBtn);
      meta.appendChild(regenBtn);
    }

    contentDiv.appendChild(bubble);
    contentDiv.appendChild(meta);
    wrapper.appendChild(avatar);
    wrapper.appendChild(contentDiv);

    messagesArea.appendChild(wrapper);
    scrollToBottom();

    return wrapper;
  }

  function updateStreamingMessage(wrapper, text) {
    const bubble = wrapper.querySelector('.message-bubble');
    if (!bubble) return;
    bubble.innerHTML = renderMarkdown(text) + '<span class="cursor" style="animation:pulse 1s infinite">▌</span>';
    scrollToBottom();
  }

  function finaliseMessage(wrapper, text) {
    const bubble = wrapper.querySelector('.message-bubble');
    if (!bubble) return;
    messages.push({ role: 'assistant', content: text, timestamp: Date.now() });
    bubble.innerHTML = renderMarkdown(text);
    addCodeBlockHandlers(bubble);
  }

  function addTypingIndicator() {
    const el = document.createElement('div');
    el.className = 'message assistant';
    el.innerHTML = `
      <div class="message-avatar">🤖</div>
      <div class="message-content">
        <div class="typing-indicator">
          <div class="typing-dots">
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
          </div>
          <span class="typing-text">Aiel is thinking…</span>
        </div>
      </div>
    `;
    messagesArea.appendChild(el);
    scrollToBottom();
    return el;
  }

  /* ── Markdown renderer ──────────────────────────────────────────────────── */

  function renderMarkdown(text) {
    if (!text) return '';

    let html = escapeHtml(text);

    /* Code blocks */
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      const language = lang || 'text';
      const highlighted = highlightCode(code.trim(), language);
      return `<div class="code-block">
        <div class="code-block-header">
          <span class="code-lang">${language}</span>
          <button class="copy-btn" data-action="copy-code">📋 Copy</button>
        </div>
        <pre><code class="language-${language}">${highlighted}</code></pre>
      </div>`;
    });

    /* Inline code */
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    /* Bold */
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    /* Italic */
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    /* Headers */
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm,  '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm,   '<h1>$1</h1>');

    /* Lists */
    html = html.replace(/^[\*\-] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

    /* Numbered lists */
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

    /* Line breaks */
    html = html.replace(/\n\n/g, '</p><p>');
    html = html.replace(/\n/g, '<br>');
    html = `<p>${html}</p>`;
    html = html.replace(/<p><\/p>/g, '');
    html = html.replace(/<p>(<(?:div|ul|ol|h[123]))/g, '$1');
    html = html.replace(/(<\/(?:div|ul|ol|h[123])>)<\/p>/g, '$1');

    return html;
  }

  /* ── Simple syntax highlighter ──────────────────────────────────────────── */

  function highlightCode(code, lang) {
    const escaped = escapeHtml(code);

    if (['javascript', 'js', 'typescript', 'ts'].includes(lang.toLowerCase())) {
      return escaped
        .replace(/\b(const|let|var|function|class|return|if|else|for|while|async|await|import|export|from|new|this|typeof|instanceof|throw|try|catch|finally|of|in|extends|super|static)\b/g,
          '<span class="token-keyword">$1</span>')
        .replace(/(\/\/[^\n]*)/g, '<span class="token-comment">$1</span>')
        .replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g,
          '<span class="token-string">$1</span>')
        .replace(/\b(\d+\.?\d*)\b/g, '<span class="token-number">$1</span>')
        .replace(/\b([A-Z][a-zA-Z0-9]*)\b/g, '<span class="token-class">$1</span>')
        .replace(/\b([a-zA-Z_][a-zA-Z0-9_]*)\s*(?=\()/g, '<span class="token-function">$1</span>');
    }

    if (['python', 'py'].includes(lang.toLowerCase())) {
      return escaped
        .replace(/\b(def|class|return|if|elif|else|for|while|import|from|as|async|await|with|try|except|finally|raise|pass|break|continue|and|or|not|in|is|lambda|yield|global|nonlocal)\b/g,
          '<span class="token-keyword">$1</span>')
        .replace(/(#[^\n]*)/g, '<span class="token-comment">$1</span>')
        .replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|"""[\s\S]*?"""|\'\'\'[\s\S]*?\'\'\')/g,
          '<span class="token-string">$1</span>')
        .replace(/\b(\d+\.?\d*)\b/g, '<span class="token-number">$1</span>')
        .replace(/\b(True|False|None|self|cls)\b/g, '<span class="token-builtin">$1</span>');
    }

    if (['html', 'xml'].includes(lang.toLowerCase())) {
      return escaped
        .replace(/(&lt;\/?[a-zA-Z][^&]*?&gt;)/g, '<span class="token-keyword">$1</span>')
        .replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="token-comment">$1</span>')
        .replace(/("(?:[^"\\]|\\.)*")/g, '<span class="token-string">$1</span>');
    }

    if (['css'].includes(lang.toLowerCase())) {
      return escaped
        .replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="token-comment">$1</span>')
        .replace(/([a-zA-Z-]+)\s*:/g, '<span class="token-keyword">$1</span>:')
        .replace(/([#\.][\w-]+)/g, '<span class="token-class">$1</span>')
        .replace(/("(?:[^"\\]|\\.)*")/g, '<span class="token-string">$1</span>');
    }

    if (['sql'].includes(lang.toLowerCase())) {
      return escaped
        .replace(/\b(SELECT|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|ON|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|ALTER|DROP|INDEX|PRIMARY|KEY|FOREIGN|REFERENCES|UNIQUE|NOT|NULL|DEFAULT|ORDER|BY|GROUP|HAVING|LIMIT|OFFSET|AS|AND|OR|IN|IS|LIKE|COUNT|SUM|AVG|MAX|MIN|DISTINCT)\b/gi,
          '<span class="token-keyword">$1</span>')
        .replace(/(--[^\n]*)/g, '<span class="token-comment">$1</span>')
        .replace(/('(?:[^'\\]|\\.)*')/g, '<span class="token-string">$1</span>')
        .replace(/\b(\d+)\b/g, '<span class="token-number">$1</span>');
    }

    return escaped;
  }

  function addCodeBlockHandlers(container) {
    container.querySelectorAll('.copy-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const code = btn.closest('.code-block')?.querySelector('code')?.textContent;
        if (code) {
          navigator.clipboard.writeText(code).then(() => {
            btn.textContent = '✅ Copied!';
            btn.classList.add('copied');
            setTimeout(() => { btn.textContent = '📋 Copy'; btn.classList.remove('copied'); }, 2000);
          });
        }
      });
    });
  }

  /* ── Image generation ───────────────────────────────────────────────────── */

  async function handleImageGeneration(prompt) {
    isGenerating = true;
    sendBtn.disabled = true;
    setAIStatus('busy', 'Creating image…');

    const typingIndicator = addTypingIndicator();

    try {
      await sleep(500);
      const canvas = document.createElement('canvas');
      canvas.width  = 640;
      canvas.height = 360;
      const ctx = canvas.getContext('2d');

      generateCanvasArt(ctx, canvas.width, canvas.height, prompt);

      const dataUrl = canvas.toDataURL('image/png');
      typingIndicator.remove();

      const wrapper = document.createElement('div');
      wrapper.className = 'message assistant';
      wrapper.innerHTML = `
        <div class="message-avatar">🎨</div>
        <div class="message-content">
          <div class="message-bubble">
            <p>Here's your generated image based on: <em>"${escapeHtml(prompt)}"</em></p>
            <img src="${dataUrl}" alt="${escapeHtml(prompt)}" style="max-width:100%;border-radius:8px;margin:.5rem 0;" />
            <div style="margin-top:.5rem">
              <a href="${dataUrl}" download="aiel-generated.png" class="btn-secondary" style="display:inline-flex;align-items:center;gap:.4rem;padding:.4rem 1rem;font-size:.85rem">
                ⬇️ Download
              </a>
            </div>
          </div>
          <div class="message-meta"><span>${formatTime(Date.now())}</span></div>
        </div>`;
      messagesArea.appendChild(wrapper);
      scrollToBottom();

      messages.push({ role: 'assistant', content: `[Image generated: ${prompt}]`, timestamp: Date.now() });

    } catch (e) {
      typingIndicator.remove();
      addMessage('assistant', `⚠️ Image generation error: ${e.message}`);
    } finally {
      isGenerating = false;
      sendBtn.disabled = false;
      setAIStatus('ready', `${AielEngine.backend} engine`);
    }
  }

  function generateCanvasArt(ctx, w, h, prompt) {
    const lower = prompt.toLowerCase();

    /* Colour palette selection based on keywords */
    let palette;
    if (/sunset|orange|warm|fire/.test(lower)) {
      palette = ['#FF6B35', '#F7931E', '#FFD700', '#FF4500', '#8B0000'];
    } else if (/ocean|sea|water|blue/.test(lower)) {
      palette = ['#001F5B', '#003A8C', '#1565C0', '#00B4D8', '#90E0EF'];
    } else if (/forest|nature|green|tree/.test(lower)) {
      palette = ['#0D3B13', '#1B5E20', '#2E7D32', '#66BB6A', '#A5D6A7'];
    } else if (/night|dark|space|galaxy/.test(lower)) {
      palette = ['#000011', '#0A0A2E', '#1A237E', '#311B92', '#7B1FA2'];
    } else if (/pink|flower|love|rose/.test(lower)) {
      palette = ['#880E4F', '#C2185B', '#E91E63', '#F06292', '#F8BBD9'];
    } else {
      palette = ['#6C63FF', '#00D4AA', '#FF6B9D', '#FFD700', '#1A237E'];
    }

    /* Background gradient */
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, palette[0]);
    grad.addColorStop(0.5, palette[2]);
    grad.addColorStop(1, palette[4]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    /* Generate shapes based on prompt keywords */
    const rng = seededRandom(hashStr(prompt));

    /* Stars / particles */
    for (let i = 0; i < 200; i++) {
      const x = rng() * w;
      const y = rng() * h;
      const r = rng() * 3;
      const alpha = rng() * 0.8 + 0.2;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      ctx.fill();
    }

    /* Geometric shapes */
    for (let i = 0; i < 8; i++) {
      const x = rng() * w;
      const y = rng() * h;
      const size = rng() * 120 + 40;
      const color = palette[Math.floor(rng() * palette.length)];
      const alpha = rng() * 0.4 + 0.1;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.translate(x, y);
      ctx.rotate(rng() * Math.PI * 2);

      /* Different shape types */
      const shapeType = Math.floor(rng() * 4);
      ctx.beginPath();
      if (shapeType === 0) {
        ctx.arc(0, 0, size / 2, 0, Math.PI * 2);
      } else if (shapeType === 1) {
        ctx.rect(-size / 2, -size / 2, size, size);
      } else if (shapeType === 2) {
        ctx.moveTo(0, -size / 2);
        ctx.lineTo(size / 2, size / 2);
        ctx.lineTo(-size / 2, size / 2);
        ctx.closePath();
      } else {
        /* Hexagon */
        for (let j = 0; j < 6; j++) {
          const angle = (j * Math.PI) / 3;
          const px = (size / 2) * Math.cos(angle);
          const py = (size / 2) * Math.sin(angle);
          j === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.closePath();
      }
      ctx.fill();
      ctx.restore();
    }

    /* Glowing orbs */
    for (let i = 0; i < 3; i++) {
      const x = rng() * w;
      const y = rng() * h;
      const r = rng() * 80 + 40;
      const color = palette[Math.floor(rng() * palette.length)];
      const orbGrad = ctx.createRadialGradient(x, y, 0, x, y, r);
      orbGrad.addColorStop(0, color + 'aa');
      orbGrad.addColorStop(1, color + '00');
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = orbGrad;
      ctx.fill();
    }

    /* Watermark */
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = 'bold 13px Inter, system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('✨ Generated by Aiel AI', w - 12, h - 12);
    ctx.restore();
  }

  /* ── Video generation ───────────────────────────────────────────────────── */

  async function handleVideoGeneration(prompt) {
    isGenerating = true;
    sendBtn.disabled = true;
    setAIStatus('busy', 'Creating video…');

    const typingIndicator = addTypingIndicator();

    try {
      /* If there are uploaded images, animate them */
      if (uploadedImages.length > 0) {
        await animateImagesToVideo(prompt, uploadedImages);
      } else {
        await generateAnimatedVideo(prompt);
      }
      typingIndicator.remove();
    } catch (e) {
      typingIndicator.remove();
      addMessage('assistant', `⚠️ Video generation error: ${e.message}`);
    } finally {
      isGenerating = false;
      sendBtn.disabled = false;
      setAIStatus('ready', `${AielEngine.backend} engine`);
    }
  }

  async function generateAnimatedVideo(prompt) {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    const ctx = canvas.getContext('2d');
    canvas.style.cssText = 'max-width:100%;border-radius:8px;margin:.5rem 0;';

    const frames = 5;
    let currentFrame = 0;
    let intervalId;

    const wrapper = document.createElement('div');
    wrapper.className = 'message assistant';
    wrapper.innerHTML = `
      <div class="message-avatar">🎬</div>
      <div class="message-content">
        <div class="message-bubble">
          <p>Here's your animated video based on: <em>"${escapeHtml(prompt)}"</em></p>
        </div>
        <div class="message-meta"><span>${formatTime(Date.now())}</span></div>
      </div>`;

    wrapper.querySelector('.message-bubble').appendChild(canvas);
    messagesArea.appendChild(wrapper);
    scrollToBottom();

    /* Animate frames */
    intervalId = setInterval(() => {
      const offset = (currentFrame / frames) * Math.PI * 2;
      const rng = seededRandom(hashStr(prompt) + currentFrame * 1000);

      /* Base art with animated offset */
      generateCanvasArt(ctx, canvas.width, canvas.height, prompt);

      /* Add animation layer */
      ctx.save();
      ctx.globalAlpha = 0.3;
      for (let i = 0; i < 20; i++) {
        const x = (rng() * canvas.width + Math.sin(offset + i) * 30) % canvas.width;
        const y = (rng() * canvas.height + Math.cos(offset + i) * 30) % canvas.height;
        const r = rng() * 20 + 5;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = `hsl(${(offset * 180 / Math.PI + i * 20) % 360}, 80%, 60%)`;
        ctx.fill();
      }
      ctx.restore();

      currentFrame = (currentFrame + 1) % frames;
    }, 500);

    messages.push({ role: 'assistant', content: `[Video generated: ${prompt}]`, timestamp: Date.now() });

    /* Add stop button */
    const stopBtn = document.createElement('button');
    stopBtn.className = 'btn-secondary';
    stopBtn.style.cssText = 'display:inline-flex;align-items:center;gap:.4rem;padding:.4rem 1rem;font-size:.85rem;margin-top:.5rem;';
    stopBtn.textContent = '⏹️ Stop Animation';
    stopBtn.addEventListener('click', () => { clearInterval(intervalId); stopBtn.textContent = '✅ Saved'; });
    wrapper.querySelector('.message-bubble').appendChild(stopBtn);
  }

  async function animateImagesToVideo(prompt, images) {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    const ctx = canvas.getContext('2d');
    canvas.style.cssText = 'max-width:100%;border-radius:8px;margin:.5rem 0;';

    let currentImg = 0;
    let intervalId;

    const wrapper = document.createElement('div');
    wrapper.className = 'message assistant';
    wrapper.innerHTML = `
      <div class="message-avatar">🎬</div>
      <div class="message-content">
        <div class="message-bubble">
          <p>Animating your ${images.length} image(s) with prompt: <em>"${escapeHtml(prompt)}"</em></p>
        </div>
        <div class="message-meta"><span>${formatTime(Date.now())}</span></div>
      </div>`;

    wrapper.querySelector('.message-bubble').appendChild(canvas);
    messagesArea.appendChild(wrapper);
    scrollToBottom();

    const imgEls = await Promise.all(images.map((dataUrl) => {
      return new Promise((res) => {
        const img = new Image();
        img.onload = () => res(img);
        img.src = dataUrl;
      });
    }));

    intervalId = setInterval(() => {
      const img = imgEls[currentImg];
      /* Ken Burns effect */
      const scale = 1 + Math.sin(Date.now() / 2000) * 0.05;
      const dx = Math.sin(Date.now() / 3000) * 10;
      const dy = Math.cos(Date.now() / 2500) * 8;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.translate(canvas.width / 2 + dx, canvas.height / 2 + dy);
      ctx.scale(scale, scale);
      ctx.drawImage(img, -canvas.width / 2, -canvas.height / 2, canvas.width, canvas.height);
      ctx.restore();

      /* Overlay text */
      ctx.save();
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, canvas.height - 40, canvas.width, 40);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff';
      ctx.font = '14px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${prompt.slice(0, 60)}… — Frame ${currentImg + 1}/${imgEls.length}`, canvas.width / 2, canvas.height - 14);
      ctx.restore();

      currentImg = (currentImg + 1) % imgEls.length;
    }, 1500);

    messages.push({ role: 'assistant', content: `[Video slideshow: ${prompt}]`, timestamp: Date.now() });

    const stopBtn = document.createElement('button');
    stopBtn.className = 'btn-secondary';
    stopBtn.style.cssText = 'display:inline-flex;align-items:center;gap:.4rem;padding:.4rem 1rem;font-size:.85rem;margin-top:.5rem;';
    stopBtn.textContent = '⏹️ Stop Slideshow';
    stopBtn.addEventListener('click', () => { clearInterval(intervalId); stopBtn.textContent = '✅ Done'; });
    wrapper.querySelector('.message-bubble').appendChild(stopBtn);
  }

  /* ── Image upload ───────────────────────────────────────────────────────── */

  function handleImageUpload(e) {
    const files = [...e.target.files];
    if (!files.length) return;

    files.forEach((file) => {
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        uploadedImages.push(ev.target.result);
        addUploadThumb(ev.target.result);
        showToast(`📷 Image added (${uploadedImages.length} total)`, 'success');
      };
      reader.readAsDataURL(file);
    });

    e.target.value = '';
  }

  function addUploadThumb(dataUrl) {
    if (!uploadPreview) return;
    const thumb = document.createElement('div');
    thumb.className = 'upload-thumb';
    const idx = uploadedImages.length - 1;

    const img = document.createElement('img');
    img.src = dataUrl;
    img.alt = 'Upload';

    const removeBtn = document.createElement('button');
    removeBtn.className = 'upload-thumb-remove';
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', () => {
      uploadedImages.splice(idx, 1);
      renderUploadPreviews();
    });

    thumb.appendChild(img);
    thumb.appendChild(removeBtn);
    uploadPreview.appendChild(thumb);
  }

  function renderUploadPreviews() {
    if (!uploadPreview) return;
    uploadPreview.innerHTML = '';
    uploadedImages.forEach((dataUrl, i) => {
      const thumb = document.createElement('div');
      thumb.className = 'upload-thumb';

      const img = document.createElement('img');
      img.src = dataUrl;
      img.alt = `Upload ${i}`;

      const removeBtn = document.createElement('button');
      removeBtn.className = 'upload-thumb-remove';
      removeBtn.textContent = '✕';
      removeBtn.addEventListener('click', () => {
        uploadedImages.splice(i, 1);
        renderUploadPreviews();
      });

      thumb.appendChild(img);
      thumb.appendChild(removeBtn);
      uploadPreview.appendChild(thumb);
    });
  }

  /* ── Voice input ────────────────────────────────────────────────────────── */

  function handleVoiceInput() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      showToast('🎤 Voice input not supported in this browser', 'error');
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SR();
    recognition.lang = 'en-US';
    recognition.continuous = false;
    recognition.interimResults = true;

    const voiceBtn = $('#voice-btn');
    voiceBtn.textContent = '⏹️';
    voiceBtn.style.color = '#ff4444';

    recognition.onresult = (e) => {
      const transcript = [...e.results].map((r) => r[0].transcript).join('');
      chatInput.value = transcript;
      updateCharCount();
    };

    recognition.onend = () => {
      voiceBtn.textContent = '🎤';
      voiceBtn.style.color = '';
      if (chatInput.value.trim()) handleSend();
    };

    recognition.onerror = (e) => {
      voiceBtn.textContent = '🎤';
      voiceBtn.style.color = '';
      showToast(`🎤 Voice error: ${e.error}`, 'error');
    };

    recognition.start();
  }

  /* ── AI Engine init ─────────────────────────────────────────────────────── */

  async function initAIEngine() {
    setAIStatus('busy', 'Loading AI…');
    try {
      const backend = await AielEngine.init((msg) => {
        aiStatusText.textContent = msg;
      });
      setAIStatus('ready', `${backend} engine`);
      showToast(`🤖 Aiel AI ready (${backend} engine)`, 'success');
    } catch (e) {
      setAIStatus('ready', 'local engine');
    }
  }

  function setAIStatus(state, text) {
    aiStatusDot.className = `ai-status-dot ${state}`;
    aiStatusText.textContent = text;
  }

  /* ── Learning indicator ─────────────────────────────────────────────────── */

  function triggerLearningIndicator() {
    learningIndicator.classList.add('show');
    setTimeout(() => learningIndicator.classList.remove('show'), 2000);
  }

  /* ── Conversation management ────────────────────────────────────────────── */

  async function refreshConversations() {
    const convs = await AielLearning.getConversations(30);
    conversationsList.innerHTML = '';

    if (convs.length === 0) {
      conversationsList.innerHTML = '<div style="padding:1rem;color:var(--text-faint);font-size:.82rem;text-align:center">No conversations yet</div>';
      return;
    }

    convs.forEach((conv) => {
      const item = document.createElement('div');
      item.className = `conv-item${conv.id === currentConvId ? ' active' : ''}`;
      item.dataset.id = conv.id;

      const icon = document.createElement('span');
      icon.className = 'conv-icon';
      icon.textContent = '💬';

      const title = document.createElement('span');
      title.className = 'conv-title';
      title.textContent = conv.title;

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'conv-delete';
      deleteBtn.title = 'Delete';
      deleteBtn.textContent = '🗑️';
      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await AielLearning.deleteConversation(conv.id);
        if (currentConvId === conv.id) startNewChat();
        await refreshConversations();
        showToast('🗑️ Conversation deleted', 'info');
      });

      item.appendChild(icon);
      item.appendChild(title);
      item.appendChild(deleteBtn);
      item.addEventListener('click', () => loadConversation(conv));
      conversationsList.appendChild(item);
    });
  }

  function loadConversation(conv) {
    messages = conv.messages || [];
    currentConvId = conv.id;
    messagesArea.innerHTML = '';

    messages.forEach((msg) => {
      const wrapper = document.createElement('div');
      wrapper.className = `message ${msg.role}`;
      wrapper.innerHTML = `
        <div class="message-avatar">${msg.role === 'user' ? '👤' : '🤖'}</div>
        <div class="message-content">
          <div class="message-bubble">${renderMarkdown(msg.content)}</div>
          <div class="message-meta"><span>${formatTime(msg.timestamp || Date.now())}</span></div>
        </div>`;
      wrapper.querySelectorAll('.copy-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const code = btn.closest('.code-block')?.querySelector('code')?.textContent;
          if (code) navigator.clipboard.writeText(code);
        });
      });
      messagesArea.appendChild(wrapper);
    });

    scrollToBottom();
    refreshConversations();
    if (window.innerWidth < 768) sidebar.classList.remove('mobile-open');
  }

  function startNewChat() {
    /* Save current conversation */
    if (messages.length > 0) {
      AielLearning.saveConversation(messages).then(refreshConversations);
    }

    messages = [];
    currentConvId = null;
    messagesArea.innerHTML = '';
    showWelcomeScreen();
    uploadedImages = [];
    if (uploadPreview) uploadPreview.innerHTML = '';
  }

  function showWelcomeScreen() {
    const welcome = document.createElement('div');
    welcome.className = 'welcome-screen';
    welcome.innerHTML = `
      <div class="welcome-avatar">🤖</div>
      <h2 class="welcome-title">Hi! I'm Aiel</h2>
      <p class="welcome-sub">Your fully free AI assistant — no API keys, no limits. I learn and grow with every conversation.</p>
      <div class="suggestions-grid">
        <div class="suggestion-card" data-prompt="Explain how machine learning works">
          <span class="suggestion-icon">🧠</span>
          <span class="suggestion-title">Explain ML</span>
          <span class="suggestion-desc">How does machine learning work?</span>
        </div>
        <div class="suggestion-card" data-prompt="Write a Python function to sort a list using quicksort">
          <span class="suggestion-icon">💻</span>
          <span class="suggestion-title">Write Code</span>
          <span class="suggestion-desc">Python quicksort implementation</span>
        </div>
        <div class="suggestion-card" data-prompt="What are your coolest features?">
          <span class="suggestion-icon">✨</span>
          <span class="suggestion-title">Features</span>
          <span class="suggestion-desc">What can Aiel do?</span>
        </div>
        <div class="suggestion-card" data-prompt="Tell me a programming joke">
          <span class="suggestion-icon">😄</span>
          <span class="suggestion-title">Fun</span>
          <span class="suggestion-desc">Tell me a joke!</span>
        </div>
      </div>`;

    welcome.querySelectorAll('.suggestion-card').forEach((card) => {
      card.addEventListener('click', () => {
        const prompt = card.dataset.prompt;
        if (prompt) { chatInput.value = prompt; handleSend(); }
      });
    });

    messagesArea.appendChild(welcome);
  }

  /* ── Memory stats ───────────────────────────────────────────────────────── */

  async function updateMemoryStats() {
    if (!memoryBadge) return;
    const stats = await AielLearning.getStats();
    memoryBadge.textContent = `🧠 ${stats.patterns} patterns`;
  }

  /* ── Preferences ────────────────────────────────────────────────────────── */

  async function applySavedPrefs() {
    const savedDark = await AielLearning.getPreference('darkMode', true);
    darkMode = savedDark;
    document.body.classList.toggle('light-mode', !darkMode);

    const savedMode = await AielLearning.getPreference('chatMode', 'chat');
    setMode(savedMode);
  }

  /* ── Utilities ──────────────────────────────────────────────────────────── */

  function scrollToBottom() {
    requestAnimationFrame(() => {
      messagesArea.scrollTo({ top: messagesArea.scrollHeight, behavior: 'smooth' });
    });
  }

  function updateCharCount() {
    const len = chatInput.value.length;
    const max = 4000;
    charCount.textContent = `${len}/${max}`;
    charCount.classList.toggle('warn', len > max * 0.85);
  }

  function toggleSidebar() {
    if (window.innerWidth < 768) {
      sidebar.classList.toggle('mobile-open');
    } else {
      sidebar.classList.toggle('collapsed');
    }
  }

  function formatTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icons = { success: '✅', error: '❌', info: 'ℹ️' };
    toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${escapeHtml(message)}</span>`;
    toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
  }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  /* Seeded random number generator — mulberry32 algorithm.
   * Each call advances the 32-bit state (s) using a linear congruential step,
   * then applies a series of xor-shift and multiply operations to mix the bits
   * (avalanche effect), producing a uniformly distributed float in [0, 1). */
  function seededRandom(seed) {
    let s = seed >>> 0;   /* Ensure unsigned 32-bit integer */
    return function() {
      s += 0x6D2B79F5;                              /* Linear congruential step */
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);         /* Xor-shift + multiply mix #1 */
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);    /* Xor-shift + multiply mix #2 */
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296; /* Final mix + normalise to [0,1) */
    };
  }

  function hashStr(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    return hash;
  }

  /* ── Global helpers ─────────────────────────────────────────────────────── */

  window.thumbsUp = function(btn) {
    btn.textContent = '👍';
    btn.style.color = 'var(--accent)';
    showToast('👍 Thanks for the feedback!', 'success');
  };

  window.regenerate = async function() {
    if (isGenerating || messages.length < 2) return;
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUserMsg) return;
    /* Remove last assistant message from UI */
    const lastMsg = messagesArea.querySelector('.message.assistant:last-child');
    lastMsg?.remove();
    messages.pop();
    await generateResponse(lastUserMsg.content);
  };

  /* ── Service worker ─────────────────────────────────────────────────────── */

  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').then(() => {
        showToast('📦 Offline mode enabled', 'success');
      }).catch(() => {});
    }
  }

  /* Media panel standalone generation */
  window.generateMedia = function() {
    const prompt = $('#media-prompt-input')?.value;
    if (prompt) handleImageGeneration(prompt);
  };

  window.downloadMedia = function() {
    const canvas = $('#gen-canvas');
    if (canvas) {
      const link = document.createElement('a');
      link.download = 'aiel-media.png';
      link.href = canvas.toDataURL();
      link.click();
    }
  };

  /* ── Start ──────────────────────────────────────────────────────────────── */

  init();

})();
