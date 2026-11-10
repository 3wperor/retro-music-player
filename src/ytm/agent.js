// Injected into the YouTube Music page (main world). Reads what is playing,
// reports it through window.__retroBridge and carries out commands from the app.
(() => {
  'use strict';
  if (window.__retroAgent) return;

  const bridge = window.__retroBridge;
  const parse = window.__retroParse;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const player = () => $('#movie_player');
  const video = () => $('#movie_player video') || $('video');
  const bar = () => $('ytmusic-player-bar');
  const call = (obj, method, ...args) => {
    try {
      if (obj && typeof obj[method] === 'function') return obj[method](...args);
    } catch (_) {}
    return undefined;
  };
  const click = (...selectors) => {
    for (const sel of selectors) {
      const el = $(sel);
      if (el) {
        el.click();
        return true;
      }
    }
    return false;
  };
  const cfg = (key) => {
    try {
      return window.ytcfg && window.ytcfg.get(key);
    } catch (_) {
      return undefined;
    }
  };

  // ---------------------------------------------------------------- state

  function artwork(meta) {
    const art = (meta && meta.artwork) || [];
    return art.length ? art[art.length - 1].src : '';
  }

  function readState() {
    const p = player();
    const v = video();
    const b = bar();
    const meta = navigator.mediaSession && navigator.mediaSession.metadata;
    const data = call(p, 'getVideoData') || {};
    const duration = call(p, 'getDuration') || (v && isFinite(v.duration) ? v.duration : 0) || 0;
    const time = call(p, 'getCurrentTime') ?? (v ? v.currentTime : 0);
    const like = $('ytmusic-player-bar ytmusic-like-button-renderer');
    const volume = call(p, 'getVolume');
    return {
      ready: !!$('ytmusic-app'),
      loggedIn: !!cfg('LOGGED_IN'),
      videoId: data.video_id || '',
      title: (meta && meta.title) || data.title || '',
      artist: (meta && meta.artist) || data.author || '',
      album: (meta && meta.album) || '',
      artwork: artwork(meta),
      paused: v ? v.paused : true,
      time: Math.max(0, time || 0),
      duration,
      volume: typeof volume === 'number' ? volume : v ? Math.round(v.volume * 100) : 100,
      muted: !!(call(p, 'isMuted') ?? (v && v.muted)),
      like: (like && like.getAttribute('like-status')) || 'INDIFFERENT',
      repeat: (b && b.getAttribute('repeat-mode')) || 'NONE',
      ad: !!(p && p.classList.contains('ad-showing')),
    };
  }

  function queueItems() {
    return $$('ytmusic-player-queue ytmusic-player-queue-item').filter(
      (el) => !el.closest('#counterpart-renderer') && !el.closest('[hidden]') && $('.song-title', el)?.textContent.trim()
    );
  }

  function readQueue() {
    return queueItems().map((el, index) => {
      const img = $('img', el);
      return {
        index,
        title: $('.song-title', el).textContent.trim(),
        subtitle: ($('.byline', el) || {}).textContent?.trim() || '',
        duration: ($('.duration', el) || {}).textContent?.trim() || '',
        thumb: (img && img.src && !img.src.startsWith('data:') && img.src) || '',
        selected: el.hasAttribute('selected'),
      };
    });
  }

  let lastQueue = '';
  function tick() {
    if (!bridge) return;
    bridge.send('state', readState());
    const queue = readQueue();
    const signature = JSON.stringify(queue);
    if (signature !== lastQueue) {
      lastQueue = signature;
      bridge.send('queue', queue);
    }
  }
  setInterval(tick, 500);
  document.addEventListener('play', tick, true);
  document.addEventListener('pause', tick, true);
  document.addEventListener('seeked', tick, true);

  // ----------------------------------------------------- internal data API

  async function authHeader() {
    const cookie = (name) => {
      const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]+)'));
      return m ? m[1] : '';
    };
    const sid = cookie('SAPISID') || cookie('__Secure-3PAPISID');
    if (!sid) return '';
    const ts = Math.floor(Date.now() / 1000);
    const bytes = new TextEncoder().encode(`${ts} ${sid} ${location.origin}`);
    const digest = await crypto.subtle.digest('SHA-1', bytes);
    const hex = Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, '0')).join('');
    return `SAPISIDHASH ${ts}_${hex}`;
  }

  async function innertube(endpoint, body) {
    const context = cfg('INNERTUBE_CONTEXT');
    if (!context) throw new Error('YouTube Music has not finished loading yet');
    const headers = {
      'content-type': 'application/json',
      'x-origin': location.origin,
      'x-goog-authuser': String(cfg('SESSION_INDEX') ?? 0),
    };
    const visitor = cfg('VISITOR_DATA');
    if (visitor) headers['x-goog-visitor-id'] = visitor;
    const auth = await authHeader();
    if (auth) headers.authorization = auth;
    const res = await fetch(`/youtubei/v1/${endpoint}?prettyPrint=false`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify({ context, ...body }),
    });
    if (!res.ok) throw new Error(`YouTube Music answered ${res.status}`);
    return parse.parse(await res.json());
  }

  // ------------------------------------------------------------ navigation

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Start a song or playlist. First asks the page to navigate in place (fast,
  // no reload); if the page does not react, falls back to loading the URL.
  async function play({ videoId, playlistId }) {
    if (!videoId && !playlistId) return false;
    const query = new URLSearchParams();
    if (videoId) query.set('v', videoId);
    if (playlistId) query.set('list', playlistId);
    const url = (videoId ? '/watch?' : '/playlist?') + query;
    const endpoint = videoId
      ? { watchEndpoint: { videoId, ...(playlistId ? { playlistId } : {}) } }
      : { watchPlaylistEndpoint: { playlistId } };
    const before = (call(player(), 'getVideoData') || {}).video_id || '';
    const started = () => {
      const now = (call(player(), 'getVideoData') || {}).video_id || '';
      if (videoId) return now === videoId && (before !== videoId || !video()?.paused);
      return now && now !== before;
    };

    const app = $('ytmusic-app');
    if (app) {
      try {
        app.dispatchEvent(
          new CustomEvent('yt-navigate', { bubbles: true, composed: true, detail: { endpoint } })
        );
      } catch (_) {}
      for (let i = 0; i < 12; i++) {
        await sleep(250);
        if (started()) return true;
      }
    }
    if (videoId && before === videoId) {
      call(player(), 'seekTo', 0, true);
      call(player(), 'playVideo');
      return true;
    }
    location.assign(videoId ? url : '/watch?' + query);
    return true;
  }

  // ------------------------------------------------------------ visualizer

  const viz = { on: false, ctx: null, analyser: null, wired: new WeakSet(), timer: null };

  function wireVideo() {
    const v = video();
    if (!v || viz.wired.has(v)) return !!v;
    if (!viz.ctx) {
      viz.ctx = new AudioContext();
      viz.analyser = viz.ctx.createAnalyser();
      viz.analyser.fftSize = 256;
      viz.analyser.smoothingTimeConstant = 0.6;
      viz.analyser.connect(viz.ctx.destination);
    }
    viz.ctx.createMediaElementSource(v).connect(viz.analyser);
    viz.wired.add(v);
    return true;
  }

  function setVisualizer(on) {
    viz.on = !!on;
    clearInterval(viz.timer);
    viz.timer = null;
    if (!viz.on) return true;
    const freq = new Uint8Array(128);
    const wave = new Uint8Array(256);
    viz.timer = setInterval(() => {
      try {
        if (!wireVideo()) return;
        if (viz.ctx.state === 'suspended') viz.ctx.resume();
        const v = video();
        if (!v || v.paused) return;
        viz.analyser.getByteFrequencyData(freq);
        viz.analyser.getByteTimeDomainData(wave);
        const w = [];
        for (let i = 0; i < 256; i += 4) w.push(wave[i]);
        bridge.send('viz', { f: Array.from(freq.subarray(0, 64)), w });
      } catch (_) {}
    }, 40);
    return true;
  }
  // Once the audio is routed through our analyser it must never stay suspended.
  document.addEventListener('play', () => viz.ctx && viz.ctx.state === 'suspended' && viz.ctx.resume(), true);

  // -------------------------------------------------------------- commands

  const commands = {
    async playPause() {
      const v = video();
      if (!v) return click('ytmusic-player-bar #play-pause-button');
      const before = v.paused;
      click('ytmusic-player-bar #play-pause-button');
      await sleep(250);
      // The page's own button ignores clicks while it is buffering.
      if (v.paused === before) {
        if (call(player(), before ? 'playVideo' : 'pauseVideo') === undefined) before ? v.play() : v.pause();
      }
      return true;
    },
    next: () => click('ytmusic-player-bar .next-button') || call(player(), 'nextVideo') !== undefined,
    previous: () => click('ytmusic-player-bar .previous-button') || call(player(), 'previousVideo') !== undefined,
    seek({ time }) {
      if (call(player(), 'seekTo', time, true) === undefined && video()) video().currentTime = time;
      return true;
    },
    volume({ value }) {
      const p = player();
      const v = video();
      if (value > 0) call(p, 'unMute');
      if (call(p, 'setVolume', value) === undefined && v) v.volume = value / 100;
      return true;
    },
    like: () =>
      click(
        'ytmusic-player-bar ytmusic-like-button-renderer #button-shape-like button',
        'ytmusic-player-bar ytmusic-like-button-renderer .like'
      ),
    shuffle: () => click('ytmusic-player-bar .shuffle'),
    repeat: () => click('ytmusic-player-bar .repeat'),
    queueIndex({ index }) {
      const el = queueItems()[index];
      if (!el) return false;
      const button = $('ytmusic-play-button-renderer', el) || $('.play-button', el);
      if (button) button.click();
      else el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      return true;
    },
    play,
    search: ({ query, params }) => innertube('search', params ? { query, params } : { query }),
    browse: ({ browseId, params }) => innertube('browse', params ? { browseId, params } : { browseId }),
    visualizer: ({ on }) => setVisualizer(on),
  };

  window.__retroAgent = {
    run(name, args) {
      if (!Object.prototype.hasOwnProperty.call(commands, name)) throw new Error('Unknown command ' + name);
      return commands[name](args || {});
    },
  };
  tick();
})();
