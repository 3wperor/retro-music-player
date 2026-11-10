'use strict';

const bridge = window.retro;
const $ = (id) => document.getElementById(id);
const query = new URLSearchParams(location.search);
const MODE = query.get('mode') === 'tray' ? 'tray' : 'player';

const LIBRARY = [
  ['Playlists', 'FEmusic_liked_playlists'],
  ['Liked', 'VLLM'],
  ['Albums', 'FEmusic_liked_albums'],
  ['Artists', 'FEmusic_library_corpus_track_artists'],
  ['Songs', 'FEmusic_liked_videos'],
  ['History', 'FEmusic_history'],
];

let settings = {};
let state = {};
let queue = [];
let tab = 'queue';
let showRemaining = false;
let seeking = false;
// Each browsing tab keeps a stack of pages so Back works.
const views = { search: { stack: [], query: '' }, library: { stack: [], section: 0 }, home: { stack: [] } };

// ------------------------------------------------------------------ helpers

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function clock(seconds) {
  seconds = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${String(m).padStart(2, '0')}:${s}`;
}

let statusTimer = null;
function status(text, sticky) {
  $('statusbar-text').textContent = text;
  clearTimeout(statusTimer);
  statusTimer = sticky
    ? null
    : setTimeout(() => {
        statusTimer = null;
        $('statusbar-text').textContent = idleStatus();
      }, 4000);
}

function idleStatus() {
  if (state.error) return 'Cannot reach YouTube Music – retrying';
  if (!state.ready) return 'Starting YouTube Music…';
  if (!state.loggedIn) return 'Not signed in';
  return tab === 'queue' ? `${queue.length} in queue` : 'Double-click to play or open';
}

async function cmd(name, args) {
  try {
    return await bridge.cmd(name, args);
  } catch (err) {
    status(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    return null;
  }
}

// ----------------------------------------------------------- layout / theme

function applySettings() {
  document.body.dataset.theme = settings.theme;
  document.body.dataset.layout = MODE === 'tray' ? 'tray' : settings.compact ? 'compact' : 'full';
  const href = `themes/${settings.theme}/theme.css`;
  if ($('theme-css').getAttribute('href') !== href) $('theme-css').setAttribute('href', href);
  if (MODE === 'player') bridge.viz(settings.visualizer !== 'off' && !settings.compact);
  $('viz').hidden = settings.visualizer === 'off';
  requestAnimationFrame(() => {
    readVizColors();
    fitMarquee();
  });
}

new ResizeObserver(() => {
  const box = $('app').getBoundingClientRect();
  bridge.win('size', { width: Math.ceil(box.width), height: Math.ceil(box.height) });
}).observe($('app'));

$('theme-css').addEventListener('load', () => {
  readVizColors();
  fitMarquee();
});

// ------------------------------------------------------------- now playing

function fitMarquee() {
  const box = $('marquee');
  const text = $('marquee-text');
  const overflow = text.scrollWidth - box.clientWidth;
  box.classList.toggle('scrolling', overflow > 4);
  box.style.setProperty('--shift', `-${Math.max(0, overflow) + 12}px`);
  box.style.setProperty('--duration', `${Math.max(6, overflow / 18)}s`);
}

function renderState() {
  const title = state.ad ? 'Advertisement' : state.title || (state.ready ? 'Nothing playing' : 'RetroTune');
  if ($('marquee-text').textContent !== title) {
    $('marquee-text').textContent = title;
    fitMarquee();
  }
  $('meta').textContent = state.ad ? '' : [state.artist, state.album].filter(Boolean).join(' — ') || ' ';

  const art = $('art');
  if ((art.getAttribute('src') || '') !== (state.artwork || '')) {
    if (state.artwork) art.src = state.artwork;
    else art.removeAttribute('src');
  }

  const time = showRemaining && state.duration ? state.duration - state.time : state.time;
  $('time').textContent = (showRemaining && state.duration ? '-' : '') + clock(time);
  $('status').textContent = !state.title ? 'STOPPED' : state.ad ? 'AD' : state.paused ? 'PAUSED' : 'PLAYING';
  document.body.dataset.playing = String(!!state.title && !state.paused);

  if (!seeking) $('seek').value = state.duration ? Math.round((state.time / state.duration) * 1000) : 0;
  $('seek').disabled = !state.duration || state.ad;
  if (document.activeElement !== $('volume')) $('volume').value = state.muted ? 0 : state.volume ?? 100;

  $('play-icon').setAttribute('href', state.title && !state.paused ? '#i-pause' : '#i-play');
  $('btn-like').classList.toggle('active', state.like === 'LIKE');
  $('btn-repeat').classList.toggle('active', state.repeat === 'ALL' || state.repeat === 'ONE');
  $('repeat-badge').textContent = state.repeat === 'ONE' ? '1' : '';
  $('btn-ytm').textContent = state.ready && !state.loggedIn ? 'Sign in' : 'YouTube Music';
  if (!statusTimer) $('statusbar-text').textContent = idleStatus();
}

$('btn-play').onclick = () => cmd('playPause');
$('btn-prev').onclick = () => cmd('previous');
$('btn-next').onclick = () => cmd('next');
$('btn-like').onclick = () => cmd('like');
$('btn-repeat').onclick = () => cmd('repeat');
$('btn-shuffle').onclick = async () => (await cmd('shuffle')) && status('Queue shuffled');
$('time').onclick = () => {
  showRemaining = !showRemaining;
  renderState();
};

$('seek').addEventListener('input', () => (seeking = true));
$('seek').addEventListener('change', () => {
  seeking = false;
  if (state.duration) cmd('seek', { time: ($('seek').value / 1000) * state.duration });
});
let volumeTimer = null;
$('volume').addEventListener('input', () => {
  clearTimeout(volumeTimer);
  volumeTimer = setTimeout(() => cmd('volume', { value: Number($('volume').value) }), 60);
});

// ------------------------------------------------------------------ window

$('btn-menu').onclick = () => bridge.win('menu');
$('btn-min').onclick = () => bridge.win('minimize');
$('btn-close').onclick = () => bridge.win('close');
$('btn-compact').onclick = () => (MODE === 'tray' ? bridge.win('show-player') : bridge.set('compact', !settings.compact));
$('btn-ytm').onclick = () => bridge.win('ytm');
document.addEventListener('contextmenu', (event) => {
  if (event.target.tagName === 'INPUT' && event.target.type === 'text') return;
  event.preventDefault();
  bridge.win('menu');
});

document.addEventListener('keydown', (event) => {
  const typing = event.target.tagName === 'INPUT' && event.target.type === 'text';
  if (event.key === ' ' && !typing && event.target.tagName !== 'BUTTON') {
    event.preventDefault();
    cmd('playPause');
  } else if ((event.metaKey || event.ctrlKey) && event.key === 'f') {
    event.preventDefault();
    if (settings.compact) bridge.set('compact', false);
    selectTab('search');
  }
});

// -------------------------------------------------------------- visualizer

const viz = { freq: new Array(64).fill(0), wave: new Array(64).fill(128), levels: [], peaks: [], colors: {}, last: 0 };
const BARS = 20;

function readVizColors() {
  const css = getComputedStyle(document.body);
  const read = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  viz.colors = {
    low: read('--viz-low', '#00e000'),
    high: read('--viz-high', '#e0e000'),
    peak: read('--viz-peak', '#ffffff'),
  };
}

function drawViz(now) {
  requestAnimationFrame(drawViz);
  const canvas = $('viz');
  if (canvas.hidden || !canvas.clientWidth || settings.compact) return;
  const ratio = window.devicePixelRatio || 1;
  const width = Math.round(canvas.clientWidth * ratio);
  const height = Math.round(canvas.clientHeight * ratio);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);
  const live = now - viz.last < 300;

  if (settings.visualizer === 'scope') {
    ctx.strokeStyle = viz.colors.low;
    ctx.lineWidth = Math.max(1, ratio);
    ctx.beginPath();
    for (let i = 0; i < viz.wave.length; i++) {
      const sample = live ? viz.wave[i] : 128;
      const x = (i / (viz.wave.length - 1)) * width;
      const y = height / 2 + ((sample - 128) / 128) * (height / 2 - ratio);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
    return;
  }

  const gap = Math.max(1, Math.round(ratio));
  const barWidth = Math.max(1, Math.floor((width - gap * (BARS - 1)) / BARS));
  const segment = Math.max(2, Math.round(3 * ratio));
  const gradient = ctx.createLinearGradient(0, height, 0, 0);
  gradient.addColorStop(0, viz.colors.low);
  gradient.addColorStop(1, viz.colors.high);
  for (let i = 0; i < BARS; i++) {
    // Spread the 64 frequency bins over the bars, favouring the bass end.
    const from = Math.floor(Math.pow(i / BARS, 1.6) * 56);
    const to = Math.max(from + 1, Math.floor(Math.pow((i + 1) / BARS, 1.6) * 56));
    let sum = 0;
    for (let b = from; b < to; b++) sum += viz.freq[b];
    const target = live ? sum / (to - from) / 255 : 0;
    const level = Math.max(target, (viz.levels[i] || 0) - 0.045);
    viz.levels[i] = level;
    viz.peaks[i] = Math.max(level, (viz.peaks[i] || 0) - 0.012);
    const x = i * (barWidth + gap);
    const barHeight = Math.round((level * height) / segment) * segment;
    ctx.fillStyle = gradient;
    for (let y = 0; y < barHeight; y += segment) ctx.fillRect(x, height - y - segment + gap, barWidth, segment - gap);
    if (viz.peaks[i] > 0.02) {
      ctx.fillStyle = viz.colors.peak;
      ctx.fillRect(x, Math.min(height - gap, height - viz.peaks[i] * height), barWidth, gap);
    }
  }
}

$('viz').onclick = () => {
  const order = ['bars', 'scope', 'off'];
  bridge.set('visualizer', order[(order.indexOf(settings.visualizer) + 1) % order.length]);
};

// ------------------------------------------------------------- tabs / lists

function selectTab(next) {
  tab = next;
  for (const button of document.querySelectorAll('.tab')) {
    button.classList.toggle('active', button.dataset.tab === tab);
    button.setAttribute('aria-selected', String(button.dataset.tab === tab));
  }
  renderPanel();
  if (tab === 'home' && !views.home.stack.length) open('home', 'Home', 'browse', { browseId: 'FEmusic_home' }, true);
  if (tab === 'library' && !views.library.stack.length) openLibrary(views.library.section);
  if (tab === 'search') setTimeout(() => $('search-input') && $('search-input').focus(), 0);
  $('statusbar-text').textContent = idleStatus();
}
for (const button of document.querySelectorAll('.tab')) button.onclick = () => selectTab(button.dataset.tab);

function row(item, onActivate) {
  const node = el('div', 'row' + (item.selected ? ' current' : ''));
  node.tabIndex = -1;
  const thumb = el('span', 'row-thumb' + (item.kind === 'artist' ? ' round' : ''));
  if (item.thumb) {
    const img = el('img');
    img.loading = 'lazy';
    img.src = item.thumb;
    img.alt = '';
    thumb.append(img);
  }
  const text = el('span', 'row-text');
  text.append(el('span', 'row-title', item.title), el('span', 'row-sub', item.subtitle || ''));
  node.append(thumb, text);
  if (item.duration) node.append(el('span', 'row-dur', item.duration));
  else if (item.kind && item.kind !== 'song' && item.kind !== 'text') node.append(el('span', 'row-dur', '›'));
  node.onclick = () => {
    for (const other of $('list').querySelectorAll('.row.selected')) other.classList.remove('selected');
    node.classList.add('selected');
    node.focus();
  };
  node.ondblclick = onActivate;
  node.onkeydown = (event) => {
    if (event.key === 'Enter') onActivate();
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      let other = node;
      do other = event.key === 'ArrowDown' ? other.nextElementSibling : other.previousElementSibling;
      while (other && !other.classList.contains('row'));
      if (other) other.click();
    }
  };
  return node;
}

function message(text, buttonLabel, onClick) {
  const box = el('div', 'message');
  box.append(el('p', '', text));
  if (buttonLabel) {
    const button = el('button', 'btn btn-text', buttonLabel);
    button.onclick = onClick;
    box.append(button);
  }
  return box;
}

function barButton(label, onClick, active) {
  const button = el('button', 'btn btn-text' + (active ? ' active' : ''), label);
  button.onclick = onClick;
  return button;
}

function backButton(view) {
  const button = el('button', 'btn btn-text btn-back', '‹ Back');
  button.type = 'button';
  button.onclick = () => {
    view.stack.pop();
    renderPanel();
  };
  return button;
}

function renderPanel() {
  const bar = $('panel-bar');
  const list = $('list');
  bar.replaceChildren();
  list.replaceChildren();
  list.scrollTop = 0;

  if (tab === 'queue') return renderQueue();

  const view = views[tab];
  const page = view.stack[view.stack.length - 1];
  const deep = view.stack.length > 1;

  if (tab === 'search') {
    const form = el('form', 'search-form');
    if (deep) form.append(backButton(view));
    const input = el('input', 'field');
    input.id = 'search-input';
    input.type = 'text';
    input.placeholder = 'Search YouTube Music';
    input.value = view.query;
    input.spellcheck = false;
    form.append(input, barButton('Find', null));
    form.onsubmit = (event) => {
      event.preventDefault();
      search(input.value.trim());
    };
    bar.append(form);
    if (!deep && page && page.data && page.data.chips.length) {
      const chips = el('div', 'chips');
      for (const chip of page.data.chips) {
        chips.append(barButton(chip.label, () => search(view.query, chip.params), chip.params === page.params));
      }
      bar.append(chips);
    }
  } else if (tab === 'library' && !deep) {
    const chips = el('div', 'chips');
    LIBRARY.forEach(([label], index) => chips.append(barButton(label, () => openLibrary(index), index === view.section)));
    bar.append(chips);
  } else {
    const head = el('div', 'crumbs');
    if (deep) head.append(backButton(view));
    head.append(el('span', 'crumb-title', page ? page.title : ''));
    bar.append(head);
  }

  if (!page) {
    if (tab === 'search') list.append(message('Type something and press Return.'));
    return;
  }
  if (page.loading) return void list.append(message('Loading…'));
  if (page.error) {
    const signIn = !state.loggedIn && tab === 'library';
    return void list.append(
      signIn
        ? message('Sign in to YouTube Music to see your library.', 'Sign in', () => bridge.win('ytm'))
        : message(page.error, 'Try again', () => load(tab, page))
    );
  }

  const { header, sections } = page.data;
  if (header && header.title) {
    const head = el('div', 'page-head');
    const thumb = el('span', 'row-thumb large');
    if (header.thumb) {
      const img = el('img');
      img.src = header.thumb;
      img.alt = '';
      thumb.append(img);
    }
    const text = el('span', 'row-text');
    text.append(el('span', 'row-title', header.title), el('span', 'row-sub', header.subtitle));
    head.append(thumb, text);
    if (header.playPlaylistId) {
      head.append(barButton('▶ Play', () => playItem({ playPlaylistId: header.playPlaylistId, title: header.title })));
    }
    list.append(head);
  }
  if (!sections.length) {
    const signIn = !state.loggedIn && tab === 'library';
    list.append(
      signIn
        ? message('Sign in to YouTube Music to see your library.', 'Sign in', () => bridge.win('ytm'))
        : message('Nothing here.')
    );
  }
  for (const section of sections) {
    if (section.title) list.append(el('div', 'section-title', section.title));
    for (const item of section.items) list.append(row(item, () => activate(item, header)));
  }
}

function renderQueue() {
  const list = $('list');
  $('panel-bar').append(el('div', 'crumbs', queue.length ? `Up next · ${queue.length} songs` : 'Queue'));
  if (!queue.length) {
    list.append(
      state.ready && !state.loggedIn
        ? message('Sign in once and RetroTune takes over from there.', 'Sign in to YouTube Music', () => bridge.win('ytm'))
        : message('The queue is empty. Find something in Search, Library or Home.')
    );
    return;
  }
  let current = null;
  for (const item of queue) {
    const node = row(item, () => cmd('queueIndex', { index: item.index }));
    if (item.selected) current = node;
    list.append(node);
  }
  if (current) current.scrollIntoView({ block: 'center' });
}

// ---------------------------------------------------------------- browsing

async function load(name, page) {
  page.loading = true;
  page.error = null;
  if (tab === name) renderPanel();
  try {
    const data = await bridge.cmd(page.command, page.args);
    if (!data || !data.sections) throw new Error('No answer from YouTube Music');
    page.data = data;
  } catch (err) {
    page.error = String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  }
  page.loading = false;
  if (tab === name) renderPanel();
}

function open(name, title, command, args, reset) {
  const view = views[name];
  const page = { title, command, args, params: args.params };
  if (reset) view.stack = [page];
  else view.stack.push(page);
  return load(name, page);
}

function search(text, params) {
  if (!text) return;
  views.search.query = text;
  open('search', `“${text}”`, 'search', params ? { query: text, params } : { query: text }, true);
}

function openLibrary(index) {
  views.library.section = index;
  const [label, browseId] = LIBRARY[index];
  open('library', label, 'browse', { browseId }, true);
}

async function playItem(item, header) {
  const playlistId = item.playlistId || (header && header.playPlaylistId) || item.playPlaylistId;
  status(`Starting ${item.title}…`, true);
  const ok = await cmd('play', { videoId: item.videoId, playlistId });
  if (ok) status(`Playing ${item.title}`);
}

function activate(item, header) {
  if (item.kind === 'song') return playItem(item, header);
  if (item.browseId) {
    const args = { browseId: item.browseId };
    if (item.browseParams) args.params = item.browseParams;
    return open(tab, item.title, 'browse', args);
  }
  if (item.playPlaylistId) return playItem(item);
}

// -------------------------------------------------------------------- start

bridge.on('state', (next) => {
  const wasLoggedIn = state.loggedIn;
  state = next || {};
  renderState();
  if (!wasLoggedIn && state.loggedIn) {
    // Signed in: anything fetched while signed out is stale.
    views.library.stack = [];
    views.home.stack = [];
    if (tab !== 'queue' && tab !== 'search') selectTab(tab);
  }
});
bridge.on('queue', (next) => {
  queue = next || [];
  if (tab === 'queue') renderPanel();
});
bridge.on('viz', (frame) => {
  viz.freq = frame.f;
  viz.wave = frame.w;
  viz.last = performance.now();
});
bridge.on('settings', (next) => {
  settings = next;
  applySettings();
});

bridge.init().then((init) => {
  settings = init.settings;
  state = init.state || {};
  queue = init.queue || [];
  applySettings();
  renderState();
  selectTab('queue');
  requestAnimationFrame(drawViz);
});
