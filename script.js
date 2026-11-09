(function () {
  'use strict';

  const TAU = Math.PI * 2;
  const STORAGE_KEY = 'wheelspin-state-v1';

  const THEMES = {
    vivid: ['#ef476f', '#ffd166', '#06d6a0', '#118ab2', '#8338ec', '#ff7f11', '#3a86ff', '#fb5607'],
    pastel: ['#ffadad', '#ffd6a5', '#fdffb6', '#caffbf', '#9bf6ff', '#a0c4ff', '#bdb2ff', '#ffc6ff'],
    sunset: ['#f94144', '#f3722c', '#f8961e', '#f9c74f', '#90be6d', '#43aa8b', '#577590', '#277da1'],
    ocean: ['#03045e', '#0077b6', '#00b4d8', '#90e0ef', '#023e8a', '#0096c7', '#48cae4', '#caf0f8'],
    candy: ['#ff006e', '#fb5607', '#ffbe0b', '#8338ec', '#3a86ff', '#ff4d6d'],
    mono: ['#222222', '#444444', '#666666', '#888888', '#aaaaaa', '#cccccc'],
  };

  const DEFAULT_STATE = {
    title: 'Wheel Spin',
    theme: 'vivid',
    duration: 5,
    bg: '#1b1d2a',
    entries: ['Pizza', 'Sushi', 'Burgers', 'Tacos', 'Pasta', 'Curry'].map((text, i) => ({
      text,
      color: THEMES.vivid[i % THEMES.vivid.length],
    })),
  };

  // ---------- State ----------

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s && Array.isArray(s.entries)) return Object.assign({}, DEFAULT_STATE, s);
      }
    } catch (e) { /* ignore */ }
    return JSON.parse(JSON.stringify(DEFAULT_STATE));
  }

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  let state = loadState();
  let rotation = 0;
  let spinning = false;
  let lastSpin = null; // { start, end, duration, winner, entries }

  // ---------- Drawing ----------

  function textColorFor(hex) {
    const [r, g, b] = GifEncoder.hexToRgb(hex);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.6 ? '#111111' : '#ffffff';
  }

  function fitLabel(ctx, text, maxWidth, size) {
    const minSize = size * 0.55;
    let s = size;
    ctx.font = `700 ${s}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    while (ctx.measureText(text).width > maxWidth && s > minSize) {
      s -= 1;
      ctx.font = `700 ${s}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    }
    if (ctx.measureText(text).width <= maxWidth) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
    return t + '…';
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /**
   * Draws the full wheel scene into a square of size S.
   * opts: { entries, bg, rot, banner?: string }
   */
  function drawScene(ctx, S, opts) {
    const { entries, bg, rot } = opts;
    const n = entries.length;
    const cx = S / 2, cy = S / 2;
    const R = S * 0.44;

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, S, S);

    if (!n) {
      ctx.fillStyle = '#ffffff';
      ctx.font = `600 ${S * 0.05}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Add some entries', cx, cy);
      return;
    }

    const seg = TAU / n;

    // Rim
    ctx.beginPath();
    ctx.arc(cx, cy, R + S * 0.018, 0, TAU);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    // Segments
    for (let i = 0; i < n; i++) {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R, rot + i * seg, rot + (i + 1) * seg);
      ctx.closePath();
      ctx.fillStyle = entries[i].color;
      ctx.fill();
      if (n > 1) {
        ctx.lineWidth = Math.max(1, S * 0.004);
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      }
    }

    // Labels
    const baseSize = Math.min(S * 0.06, seg * R * 0.42);
    for (let i = 0; i < n; i++) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot + (i + 0.5) * seg);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      const label = fitLabel(ctx, entries[i].text || ' ', R * 0.68, baseSize);
      ctx.fillStyle = textColorFor(entries[i].color);
      ctx.fillText(label, R * 0.9, 0);
      ctx.restore();
    }

    // Hub
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.13, 0, TAU);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.07, 0, TAU);
    ctx.fillStyle = bg;
    ctx.fill();

    // Pointer (top, pointing down)
    const pw = S * 0.045, top = cy - R - S * 0.04, tip = cy - R + S * 0.045;
    ctx.beginPath();
    ctx.moveTo(cx - pw, top);
    ctx.lineTo(cx + pw, top);
    ctx.lineTo(cx, tip);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = Math.max(1, S * 0.006);
    ctx.strokeStyle = '#111111';
    ctx.stroke();

    // Winner banner (used for the final GIF frame)
    if (opts.banner) {
      const bw = S * 0.8, bh = S * 0.15;
      roundRect(ctx, cx - bw / 2, cy - bh / 2, bw, bh, S * 0.03);
      ctx.fillStyle = '#111111';
      ctx.fill();
      ctx.lineWidth = Math.max(2, S * 0.008);
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const label = fitLabel(ctx, opts.banner, bw * 0.88, S * 0.065);
      ctx.fillText(label, cx, cy + S * 0.004);
    }
  }

  // ---------- Spin math ----------

  const ease = (p) => 1 - Math.pow(1 - p, 4); // ease-out quart

  function winnerAt(rot, n) {
    const seg = TAU / n;
    const a = (((-Math.PI / 2 - rot) % TAU) + TAU) % TAU;
    return Math.floor(a / seg) % n;
  }

  function planSpin(start, n, duration) {
    const seg = TAU / n;
    const winner = Math.floor(Math.random() * n);
    const offset = 0.15 + Math.random() * 0.7; // avoid landing right on a border
    const turns = Math.max(3, Math.round(duration * 1.2));
    let end = -Math.PI / 2 - (winner + offset) * seg;
    end += Math.ceil((start + turns * TAU - end) / TAU) * TAU;
    return { start, end, duration, winner };
  }

  const rotationAt = (plan, t) =>
    plan.start + (plan.end - plan.start) * ease(Math.min(1, t / plan.duration));

  // ---------- DOM ----------

  const $ = (id) => document.getElementById(id);
  const canvas = $('wheel');
  const ctx = canvas.getContext('2d');
  const el = {
    title: $('title'),
    titleDisplay: $('titleDisplay'),
    entries: $('entries'),
    addEntry: $('addEntry'),
    shuffle: $('shuffle'),
    bulkBtn: $('bulkBtn'),
    bulk: $('bulk'),
    theme: $('theme'),
    applyTheme: $('applyTheme'),
    duration: $('duration'),
    durationOut: $('durationOut'),
    bg: $('bgColor'),
    reset: $('reset'),
    spin: $('spinBtn'),
    result: $('result'),
    resultText: $('resultText'),
    removeWinner: $('removeWinner'),
    gifSize: $('gifSize'),
    gifFps: $('gifFps'),
    gifLoop: $('gifLoop'),
    gifReplay: $('gifReplay'),
    exportGif: $('exportGif'),
    progress: $('gifProgress'),
    progressBar: $('gifProgressBar'),
    gifOut: $('gifOut'),
    gifPreview: $('gifPreview'),
    gifDownload: $('gifDownload'),
    gifInfo: $('gifInfo'),
  };

  function renderWheel() {
    const dpr = window.devicePixelRatio || 1;
    const css = canvas.clientWidth;
    const px = Math.round(css * dpr);
    if (canvas.width !== px) {
      canvas.width = px;
      canvas.height = px;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawScene(ctx, css, { entries: state.entries, bg: state.bg, rot: rotation });
  }

  function onEntriesChanged() {
    lastSpin = null;
    hideResult();
    saveState();
    renderWheel();
    el.spin.disabled = spinning || state.entries.length < 1;
  }

  function renderEntryList() {
    el.entries.innerHTML = '';
    state.entries.forEach((entry, i) => {
      const li = document.createElement('li');

      const color = document.createElement('input');
      color.type = 'color';
      color.value = entry.color;
      color.title = 'Segment color';
      color.addEventListener('input', () => {
        entry.color = color.value;
        saveState();
        renderWheel();
      });

      const text = document.createElement('input');
      text.type = 'text';
      text.value = entry.text;
      text.placeholder = `Entry ${i + 1}`;
      text.addEventListener('input', () => {
        entry.text = text.value;
        onEntriesChanged();
      });
      text.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          addEntry('', i + 1);
        }
      });

      const del = document.createElement('button');
      del.className = 'icon';
      del.title = 'Remove';
      del.setAttribute('aria-label', `Remove ${entry.text || 'entry'}`);
      del.textContent = '✕';
      del.addEventListener('click', () => {
        state.entries.splice(i, 1);
        renderEntryList();
        onEntriesChanged();
      });

      li.append(color, text, del);
      el.entries.appendChild(li);
    });
  }

  function nextColor(index) {
    const t = THEMES[state.theme] || THEMES.vivid;
    return t[index % t.length];
  }

  function addEntry(text, at) {
    const index = at == null ? state.entries.length : at;
    state.entries.splice(index, 0, { text, color: nextColor(index) });
    renderEntryList();
    onEntriesChanged();
    const input = el.entries.children[index] && el.entries.children[index].querySelector('input[type=text]');
    if (input) input.focus();
  }

  function hideResult() {
    el.result.hidden = true;
  }

  function showResult(name) {
    el.resultText.textContent = name;
    el.result.hidden = false;
  }

  function syncControls() {
    el.title.value = state.title;
    el.titleDisplay.textContent = state.title || 'Wheel Spin';
    document.title = state.title || 'Wheel Spin';
    el.theme.value = state.theme;
    el.duration.value = state.duration;
    el.durationOut.textContent = `${state.duration}s`;
    el.bg.value = state.bg;
  }

  // ---------- Spin ----------

  function spin() {
    const n = state.entries.length;
    if (spinning || !n) return;
    spinning = true;
    el.spin.disabled = true;
    hideResult();

    const start = ((rotation % TAU) + TAU) % TAU;
    const plan = planSpin(start, n, state.duration);
    const t0 = performance.now();

    function frame(now) {
      const t = (now - t0) / 1000;
      rotation = rotationAt(plan, t);
      renderWheel();
      if (t < plan.duration) {
        requestAnimationFrame(frame);
      } else {
        rotation = plan.end;
        renderWheel();
        spinning = false;
        el.spin.disabled = false;
        const w = winnerAt(rotation, n);
        lastSpin = Object.assign({}, plan, { winner: w });
        showResult(state.entries[w].text || `Entry ${w + 1}`);
      }
    }
    requestAnimationFrame(frame);
  }

  // ---------- GIF export ----------

  let lastGifUrl = null;

  async function exportGif() {
    const entries = state.entries.map((e) => ({ text: e.text || ' ', color: e.color }));
    const n = entries.length;
    if (!n) return;

    const S = parseInt(el.gifSize.value, 10);
    const fps = parseInt(el.gifFps.value, 10);
    const delay = Math.round(100 / fps);
    const loop = el.gifLoop.checked;

    const plan = el.gifReplay.checked && lastSpin ? lastSpin : planSpin(0, n, state.duration);
    const winner = winnerAt(plan.end, n);
    const winnerName = entries[winner].text.trim() || `Entry ${winner + 1}`;

    el.exportGif.disabled = true;
    el.progress.hidden = false;
    el.progressBar.style.width = '0%';

    const off = document.createElement('canvas');
    off.width = S;
    off.height = S;
    const octx = off.getContext('2d', { willReadFrequently: true });

    const keyColors = [state.bg, '#ffffff', '#111111', ...entries.map((e) => e.color)];
    const palette = GifEncoder.buildPalette(keyColors);
    const quantize = GifEncoder.createQuantizer(palette);
    const writer = new GifEncoder.GifWriter(S, S, palette, loop);
    const indices = new Uint8Array(S * S);

    const addFrame = (rot, d, banner) => {
      drawScene(octx, S, { entries, bg: state.bg, rot, banner });
      quantize(octx.getImageData(0, 0, S, S).data, indices);
      writer.addFrame(indices, d);
    };

    const frameCount = Math.ceil(plan.duration * fps);
    const total = frameCount + 3;
    const tick = async (i) => {
      el.progressBar.style.width = `${Math.round((i / total) * 100)}%`;
      await new Promise((r) => setTimeout(r, 0));
    };

    try {
      addFrame(plan.start, 60); // short pause before the spin
      for (let f = 1; f <= frameCount; f++) {
        addFrame(rotationAt(plan, f / fps), delay);
        if (f % 4 === 0) await tick(f);
      }
      addFrame(plan.end, 60); // let the wheel settle
      addFrame(plan.end, 300, `Winner: ${winnerName}`);
      await tick(total);

      const blob = writer.finish();
      if (lastGifUrl) URL.revokeObjectURL(lastGifUrl);
      lastGifUrl = URL.createObjectURL(blob);
      el.gifPreview.src = lastGifUrl;
      el.gifDownload.href = lastGifUrl;
      const safe = (state.title || 'wheelspin').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      el.gifDownload.download = `${safe || 'wheelspin'}.gif`;
      el.gifInfo.textContent = `${S}×${S}px · ${frameCount + 3} frames · ${(blob.size / 1024 / 1024).toFixed(2)} MB · winner: ${winnerName}`;
      el.gifOut.hidden = false;
    } catch (err) {
      console.error(err);
      el.gifInfo.textContent = 'Something went wrong while creating the GIF.';
      el.gifOut.hidden = false;
    } finally {
      el.exportGif.disabled = false;
      setTimeout(() => (el.progress.hidden = true), 400);
    }
  }

  // ---------- Events ----------

  el.title.addEventListener('input', () => {
    state.title = el.title.value;
    el.titleDisplay.textContent = state.title || 'Wheel Spin';
    document.title = state.title || 'Wheel Spin';
    saveState();
  });

  el.addEntry.addEventListener('click', () => addEntry(''));

  el.shuffle.addEventListener('click', () => {
    const a = state.entries;
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    renderEntryList();
    onEntriesChanged();
  });

  el.bulkBtn.addEventListener('click', () => {
    if (el.bulk.hidden) {
      el.bulk.value = state.entries.map((e) => e.text).join('\n');
      el.bulk.hidden = false;
      el.entries.hidden = true;
      el.bulkBtn.textContent = 'Apply list';
      el.bulk.focus();
    } else {
      const lines = el.bulk.value.split('\n').map((s) => s.trim()).filter(Boolean);
      state.entries = lines.map((text, i) => ({
        text,
        color: (state.entries[i] && state.entries[i].color) || nextColor(i),
      }));
      el.bulk.hidden = true;
      el.entries.hidden = false;
      el.bulkBtn.textContent = 'Bulk edit';
      renderEntryList();
      onEntriesChanged();
    }
  });

  el.theme.addEventListener('change', () => {
    state.theme = el.theme.value;
    saveState();
  });

  el.applyTheme.addEventListener('click', () => {
    state.theme = el.theme.value;
    state.entries.forEach((e, i) => (e.color = nextColor(i)));
    renderEntryList();
    saveState();
    renderWheel();
  });

  el.duration.addEventListener('input', () => {
    state.duration = parseFloat(el.duration.value);
    el.durationOut.textContent = `${state.duration}s`;
    lastSpin = null;
    saveState();
  });

  el.bg.addEventListener('input', () => {
    state.bg = el.bg.value;
    saveState();
    renderWheel();
  });

  el.reset.addEventListener('click', () => {
    state = JSON.parse(JSON.stringify(DEFAULT_STATE));
    rotation = 0;
    syncControls();
    renderEntryList();
    onEntriesChanged();
  });

  el.spin.addEventListener('click', spin);
  canvas.addEventListener('click', spin);
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && document.activeElement === document.body) {
      e.preventDefault();
      spin();
    }
  });

  el.removeWinner.addEventListener('click', () => {
    if (!lastSpin) return;
    state.entries.splice(lastSpin.winner, 1);
    renderEntryList();
    onEntriesChanged();
  });

  el.exportGif.addEventListener('click', exportGif);

  window.addEventListener('resize', renderWheel);

  // ---------- Init ----------

  syncControls();
  renderEntryList();
  onEntriesChanged();
})();
