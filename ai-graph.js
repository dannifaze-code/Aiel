/**
 * Aiel AI — Interactive Learning Graph & Mood Gauge
 * Canvas-based real-time visualization of AI learning activity and mood.
 * No external dependencies.
 */
const AielGraph = (() => {
  'use strict';

  /* ── State ──────────────────────────────────────────────────────────────── */

  let graphCanvas = null;
  let graphCtx = null;
  let moodCanvas = null;
  let moodCtx = null;
  let feedContainer = null;
  let statsContainer = null;
  let isVisible = false;
  let animFrameId = null;

  /* Learning data points — rolling window. Each entry has a timestamp and
   * a counts object keyed by source name (e.g. 'wikipedia', 'hackernews',
   * 'burst', or any dynamically-added source). */
  const MAX_POINTS = 60;
  const dataPoints = [];
  const BUCKET_MS = 30000;        /* 30-second buckets */

  /* Activity feed */
  const activityFeed = [];
  const MAX_FEED = 25;

  /* Source colors (hex) — converted to RGBA for area fills via hexToRgba helper */
  const SOURCE_COLORS = {
    wikipedia:     '#4a9eff',
    trivia:        '#00d4aa',
    code:          '#ff8c42',
    user:          '#6c63ff',
    url:           '#ff4444',
    hackernews:    '#ff6600',
    devto:         '#3b49df',
    stackoverflow: '#f48024',
    burst:         '#ffd700',
    words:         '#9b59b6',
    articles:      '#4a9eff',
    facts:         '#e74c3c',
    books:         '#2ecc71',
    images:        '#e91e63',
    aiLearning:    '#00bcd4',
    default:       '#888888'
  };

  /* ── Initialisation ─────────────────────────────────────────────────────── */

  function init() {
    graphCanvas = document.getElementById('learning-graph-canvas');
    moodCanvas = document.getElementById('mood-gauge-canvas');
    feedContainer = document.getElementById('ai-activity-feed');
    statsContainer = document.getElementById('ai-graph-stats');

    if (graphCanvas) graphCtx = graphCanvas.getContext('2d');
    if (moodCanvas) moodCtx = moodCanvas.getContext('2d');

    /* Listen for events */
    window.addEventListener('aiel-training-update', handleTrainingUpdate);
    window.addEventListener('aiel-mood-update', handleMoodUpdate);
    window.addEventListener('aiel-learning-started', handleLearningStarted);
    window.addEventListener('aiel-learning-item', handleLearningItem);
    window.addEventListener('aiel-learning-complete', handleLearningComplete);
    window.addEventListener('aiel-learning-error', handleLearningError);

    /* Seed with empty data points */
    const now = Date.now();
    for (let i = MAX_POINTS; i >= 0; i--) {
      dataPoints.push({
        timestamp: now - i * BUCKET_MS,
        counts: {}
      });
    }

    /* Initial render */
    render();
  }

  /* ── Visibility ─────────────────────────────────────────────────────────── */

  function show() {
    isVisible = true;
    startAnimation();
    render();
  }

  function hide() {
    isVisible = false;
    stopAnimation();
  }

  function toggle() {
    isVisible ? hide() : show();
    return isVisible;
  }

  /* ── Animation loop ─────────────────────────────────────────────────────── */

  function startAnimation() {
    if (animFrameId) return;
    function loop() {
      if (!isVisible) { animFrameId = null; return; }
      render();
      animFrameId = requestAnimationFrame(loop);
    }
    animFrameId = requestAnimationFrame(loop);
  }

  function stopAnimation() {
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
  }

  /* ── Event handlers ─────────────────────────────────────────────────────── */

  function handleTrainingUpdate(e) {
    const detail = e.detail || {};
    const source = detail.source || 'default';
    addDataPoint(source, detail.count || 1);
    addFeedItem(`📚 Learned ${detail.count || 1} item(s) from ${source}`, source);
    updateStats();
  }

  function handleMoodUpdate() {
    if (isVisible) renderMoodGauge();
  }

  function handleLearningStarted(e) {
    const detail = e.detail || {};
    const mode = detail.mode || 'auto';
    addFeedItem(`🚀 Learning started (${mode})`, 'default');
  }

  function handleLearningItem(e) {
    const detail = e.detail || {};
    const source = detail.source || 'default';
    addDataPoint(source, detail.count || 1);
    const preview = detail.preview ? `: "${detail.preview}"` : '';
    addFeedItem(`📖 ${source}${preview} (+${detail.count || 1})`, source);
    updateStats();
  }

  function handleLearningComplete(e) {
    const detail = e.detail || {};
    addFeedItem(`✅ Learning complete: ${detail.total || 0} items`, 'default');
    updateStats();
  }

  function handleLearningError(e) {
    const detail = e.detail || {};
    addFeedItem(`❌ Error: ${detail.source || 'Unknown'} — ${detail.error || 'Failed'}`, 'default');
  }

  /* ── Data management ────────────────────────────────────────────────────── */

  function addDataPoint(source, count) {
    const now = Date.now();
    const latest = dataPoints[dataPoints.length - 1];

    /* Add to current bucket or create new one */
    if (now - latest.timestamp < BUCKET_MS) {
      latest.counts[source] = (latest.counts[source] || 0) + count;
    } else {
      dataPoints.push({
        timestamp: now,
        counts: { [source]: count }
      });
      if (dataPoints.length > MAX_POINTS) dataPoints.shift();
    }
  }

  function addFeedItem(message, source) {
    activityFeed.push({
      message,
      source,
      timestamp: Date.now()
    });
    if (activityFeed.length > MAX_FEED) activityFeed.shift();
    if (isVisible) renderFeed();
  }

  /* ── Rendering ──────────────────────────────────────────────────────────── */

  function render() {
    renderLineChart();
    renderMoodGauge();
    renderFeed();
    updateStats();
  }

  /* ── Line Chart ─────────────────────────────────────────────────────────── */

  function renderLineChart() {
    if (!graphCanvas || !graphCtx) return;

    const ctx = graphCtx;
    const w = graphCanvas.width = graphCanvas.offsetWidth * (window.devicePixelRatio || 1);
    const h = graphCanvas.height = graphCanvas.offsetHeight * (window.devicePixelRatio || 1);
    ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
    const dw = graphCanvas.offsetWidth;
    const dh = graphCanvas.offsetHeight;

    ctx.clearRect(0, 0, dw, dh);

    const padding = { top: 20, right: 15, bottom: 30, left: 35 };
    const chartW = dw - padding.left - padding.right;
    const chartH = dh - padding.top - padding.bottom;

    /* Find max value for scaling */
    let maxVal = 1;
    dataPoints.forEach(dp => {
      const total = Object.values(dp.counts).reduce((a, b) => a + b, 0);
      if (total > maxVal) maxVal = total;
    });
    maxVal = Math.ceil(maxVal * 1.2); /* Add 20% headroom */

    /* Draw grid */
    ctx.strokeStyle = 'rgba(108,99,255,0.08)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (chartH * i / 4);
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(dw - padding.right, y);
      ctx.stroke();

      /* Y-axis labels */
      ctx.fillStyle = 'rgba(144,144,184,0.6)';
      ctx.font = '9px Inter, sans-serif';
      ctx.textAlign = 'right';
      const val = Math.round(maxVal * (1 - i / 4));
      ctx.fillText(val, padding.left - 5, y + 3);
    }

    /* X-axis time labels */
    ctx.fillStyle = 'rgba(144,144,184,0.5)';
    ctx.font = '8px Inter, sans-serif';
    ctx.textAlign = 'center';
    const pointCount = dataPoints.length;
    const step = Math.max(1, Math.floor(pointCount / 5));
    for (let i = 0; i < pointCount; i += step) {
      const x = padding.left + (i / (pointCount - 1)) * chartW;
      const date = new Date(dataPoints[i].timestamp);
      ctx.fillText(date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), x, dh - 5);
    }

    /* Collect all sources */
    const allSources = new Set();
    dataPoints.forEach(dp => Object.keys(dp.counts).forEach(s => allSources.add(s)));

    /* Draw stacked area chart */
    allSources.forEach(source => {
      const color = SOURCE_COLORS[source] || SOURCE_COLORS.default;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();

      let hasData = false;
      dataPoints.forEach((dp, i) => {
        const val = dp.counts[source] || 0;
        const x = padding.left + (i / (pointCount - 1)) * chartW;
        const y = padding.top + chartH - (val / maxVal) * chartH;

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        if (val > 0) hasData = true;
      });

      if (hasData) {
        ctx.stroke();

        /* Fill area with transparency */
        ctx.lineTo(padding.left + chartW, padding.top + chartH);
        ctx.lineTo(padding.left, padding.top + chartH);
        ctx.closePath();
        ctx.fillStyle = hexToRgba(color, 0.08);
        ctx.fill();
      }
    });

    /* Draw "no data" text if empty */
    if (allSources.size === 0 || dataPoints.every(dp => Object.keys(dp.counts).length === 0)) {
      ctx.fillStyle = 'rgba(144,144,184,0.3)';
      ctx.font = '12px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Learning activity will appear here', dw / 2, dh / 2);
    }
  }

  /* ── Mood Gauge ─────────────────────────────────────────────────────────── */

  function renderMoodGauge() {
    if (!moodCanvas || !moodCtx) return;
    if (typeof AielMood === 'undefined') return;

    const mood = AielMood.getMood();
    const ctx = moodCtx;
    const size = moodCanvas.offsetWidth;
    const dpr = window.devicePixelRatio || 1;
    moodCanvas.width = size * dpr;
    moodCanvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, size, size);

    const cx = size / 2;
    const cy = size / 2;
    const radius = size / 2 - 12;
    const lineWidth = 8;

    /* Background arc */
    ctx.beginPath();
    ctx.arc(cx, cy, radius, Math.PI * 0.75, Math.PI * 2.25);
    ctx.strokeStyle = 'rgba(108,99,255,0.12)';
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.stroke();

    /* Value arc */
    const angle = Math.PI * 0.75 + (mood.score / 100) * Math.PI * 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, Math.PI * 0.75, angle);
    ctx.strokeStyle = mood.color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.stroke();

    /* Emoji */
    ctx.font = `${size * 0.25}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(mood.emoji, cx, cy - 6);

    /* Score */
    ctx.font = `bold ${size * 0.12}px Inter, sans-serif`;
    ctx.fillStyle = mood.color;
    ctx.fillText(mood.score, cx, cy + size * 0.18);

    /* Label */
    ctx.font = `${size * 0.08}px Inter, sans-serif`;
    ctx.fillStyle = 'rgba(144,144,184,0.7)';
    ctx.fillText(mood.label, cx, cy + size * 0.3);
  }

  /* ── Activity Feed ──────────────────────────────────────────────────────── */

  function renderFeed() {
    if (!feedContainer) return;

    if (activityFeed.length === 0) {
      feedContainer.innerHTML = '<div class="feed-empty">No learning activity yet. Use the 🧠 Feed AI button to start!</div>';
      return;
    }

    const html = activityFeed.slice(-15).reverse().map(item => {
      const time = new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const color = SOURCE_COLORS[item.source] || SOURCE_COLORS.default;
      return `<div class="feed-item">
        <span class="feed-dot" style="background:${color}"></span>
        <span class="feed-msg">${escapeHtml(item.message)}</span>
        <span class="feed-time">${time}</span>
      </div>`;
    }).join('');

    feedContainer.innerHTML = html;
  }

  /* ── Stats ──────────────────────────────────────────────────────────────── */

  async function updateStats() {
    if (!statsContainer) return;

    let patternsCount = 0;
    let knowledgeCount = 0;
    let sessionItems = 0;

    try {
      if (typeof AielLearning !== 'undefined') {
        const stats = await AielLearning.getStats();
        patternsCount = stats.patterns || 0;
        knowledgeCount = stats.knowledge || 0;
      }
      if (typeof AielSelfTrainer !== 'undefined') {
        const status = await AielSelfTrainer.getTrainingStatus();
        sessionItems = status.sessionItemsLearned || 0;
      }
    } catch (_) { /* non-critical */ }

    const mood = typeof AielMood !== 'undefined' ? AielMood.getMood() : { sessionStats: {} };

    statsContainer.innerHTML = `
      <div class="graph-stat">
        <span class="graph-stat-val">${patternsCount}</span>
        <span class="graph-stat-label">Patterns</span>
      </div>
      <div class="graph-stat">
        <span class="graph-stat-val">${knowledgeCount}</span>
        <span class="graph-stat-label">Knowledge</span>
      </div>
      <div class="graph-stat">
        <span class="graph-stat-val">${sessionItems + (mood.sessionStats.itemsLearned || 0)}</span>
        <span class="graph-stat-label">Session</span>
      </div>
      <div class="graph-stat">
        <span class="graph-stat-val">${mood.sessionStats.patternsMatched || 0}</span>
        <span class="graph-stat-label">Matches</span>
      </div>
    `;
  }

  /* ── Helpers ────────────────────────────────────────────────────────────── */

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /**
   * Convert a hex color to an RGBA string with the given alpha.
   * Handles both #RGB and #RRGGBB formats, and passes through rgb()/rgba() strings.
   */
  function hexToRgba(color, alpha) {
    if (color.startsWith('rgba')) return color;
    if (color.startsWith('rgb(')) {
      return color.replace('rgb(', 'rgba(').replace(')', `,${alpha})`);
    }
    /* Hex color */
    let hex = color.replace('#', '');
    if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  /* ── Public API ─────────────────────────────────────────────────────────── */

  return {
    init,
    show,
    hide,
    toggle,
    render,
    addDataPoint,
    addFeedItem,
    get isVisible() { return isVisible; }
  };
})();

window.AielGraph = AielGraph;
