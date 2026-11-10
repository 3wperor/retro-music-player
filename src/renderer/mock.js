// Stand-in for the Electron bridge so the UI can be opened in a normal browser
// for skin development:  index.html?theme=night&compact=1&tab=search
(() => {
  if (window.retro) return;
  const query = new URLSearchParams(location.search);
  const handlers = {};
  const emit = (channel, data) => (handlers[channel] || []).forEach((fn) => fn(data));
  const cover = (hue) =>
    'data:image/svg+xml,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="hsl(${hue} 80% 60%)"/><stop offset="1" stop-color="hsl(${hue + 70} 70% 30%)"/></linearGradient></defs><rect width="96" height="96" fill="url(#g)"/><circle cx="48" cy="48" r="26" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="3"/><circle cx="48" cy="48" r="5" fill="#fff" fill-opacity=".7"/></svg>`
    );
  const songs = [
    ['Midnight Arcade', 'Neon Harbour', '3:42'],
    ['Paper Lanterns', 'Lotus Radio', '4:05'],
    ['Dial-Up Dreams', 'The Modems', '2:58'],
    ['Chrome Hearts Club', 'Velvet Circuit', '3:27'],
    ['Jade River', 'Moon Pavilion Ensemble', '5:11'],
    ['Screensaver', 'Pixel Tide', '3:03'],
    ['After Hours Bus', 'Kowloon Static', '4:40'],
  ].map(([title, subtitle, duration], index) => ({ index, title, subtitle, duration, thumb: cover(index * 47), selected: index === 1, kind: 'song' }));

  const settings = {
    theme: query.get('theme') || 'classic',
    compact: query.get('compact') === '1',
    visualizer: query.get('viz') || 'bars',
    alwaysOnTop: false,
  };
  const state = {
    ready: true, loggedIn: true, videoId: 'x', title: 'Paper Lanterns (Extended Moonlight Version)', artist: 'Lotus Radio',
    album: 'Night Market', artwork: cover(47), paused: false, time: 83, duration: 245, volume: 70, like: 'LIKE', repeat: 'ALL',
  };
  const page = {
    header: null,
    chips: [{ label: 'Songs', params: 'a' }, { label: 'Albums', params: 'b' }, { label: 'Artists', params: 'c' }],
    sections: [
      { title: 'Top result', items: [{ title: 'Lotus Radio', subtitle: 'Artist • 2.1M monthly audience', thumb: cover(200), kind: 'artist', browseId: 'x' }] },
      { title: 'Songs', items: songs },
      { title: 'Albums', items: [{ title: 'Night Market', subtitle: 'Album • Lotus Radio • 2001', thumb: cover(300), kind: 'album', browseId: 'y' }] },
    ],
  };

  window.retro = {
    init: async () => ({ settings, state, queue: songs, themes: [] }),
    cmd: async (name) => {
      if (name === 'playPause') state.paused = !state.paused;
      if (name === 'search' || name === 'browse') return page;
      return true;
    },
    set: (key, value) => {
      settings[key] = value;
      emit('settings', { ...settings });
    },
    win: () => {},
    viz: () => {},
    on: (channel, fn) => (handlers[channel] = handlers[channel] || []).push(fn),
  };

  let t = 0;
  setInterval(() => {
    if (state.paused) return;
    t += 0.12;
    const f = Array.from({ length: 64 }, (_, i) => Math.max(0, 215 - i * 2.6 + 55 * Math.sin(t * 1.7 + i * 0.5) + 40 * Math.sin(t * 3.1 + i * 1.3)));
    const w = Array.from({ length: 64 }, (_, i) => 128 + 70 * Math.sin(t * 2 + i * 0.4) * Math.sin(i * 0.11 + t));
    emit('viz', { f, w });
  }, 40);
  setInterval(() => {
    if (!state.paused) state.time = (state.time + 0.5) % state.duration;
    emit('state', { ...state });
  }, 500);
  window.addEventListener('load', () => {
    const tab = query.get('tab');
    if (tab) setTimeout(() => document.querySelector(`.tab[data-tab="${tab}"]`)?.click(), 50);
  });
})();
