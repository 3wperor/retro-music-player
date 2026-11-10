const { app, BrowserWindow, Menu, Tray, Notification, ipcMain, nativeImage, session, shell, screen } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const THEMES_DIR = path.join(ROOT, 'renderer', 'themes');
const YTM_URL = 'https://music.youtube.com/';
const isMac = process.platform === 'darwin';

// ------------------------------------------------------------------ settings

const DEFAULTS = {
  theme: 'classic',
  compact: false,
  alwaysOnTop: false,
  menuBarTrack: true,
  menuBarOnly: false,
  notifications: false,
  visualizer: 'bars',
};
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
let settings = { ...DEFAULTS };

function loadSettings() {
  try {
    settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) };
  } catch (_) {}
}

function setSetting(key, value) {
  if (!(key in DEFAULTS)) return;
  settings[key] = value;
  try {
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
  } catch (_) {}
  applySettings();
  broadcast('settings', settings);
}

function listThemes() {
  const themes = [];
  for (const id of fs.readdirSync(THEMES_DIR)) {
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(THEMES_DIR, id, 'theme.json'), 'utf8'));
      themes.push({ id, name: meta.name || id, order: meta.order ?? 100 });
    } catch (_) {}
  }
  return themes.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

// ------------------------------------------------------------------- windows

let playerWin = null;
let trayWin = null;
let ytmWin = null;
let tray = null;
let quitting = false;
let state = { ready: false };
let queue = [];

const uiWindows = () => [playerWin, trayWin].filter((w) => w && !w.isDestroyed());

function broadcast(channel, data) {
  for (const win of uiWindows()) win.webContents.send(channel, data);
}

function uiWindow(mode, options) {
  const win = new BrowserWindow({
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    ...options,
    webPreferences: {
      preload: path.join(ROOT, 'renderer', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.loadFile(path.join(ROOT, 'renderer', 'index.html'), { query: { mode } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  return win;
}

function createPlayerWindow() {
  playerWin = uiWindow('player', { width: 400, height: 600, title: 'RetroTune' });
  playerWin.once('ready-to-show', () => playerWin.show());
  playerWin.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    playerWin.hide();
  });
}

function createTrayWindow() {
  trayWin = uiWindow('tray', { width: 340, height: 130, skipTaskbar: true, alwaysOnTop: true });
  trayWin.on('blur', () => trayWin.hide());
  trayWin.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    trayWin.hide();
  });
}

function showPlayer() {
  if (!playerWin || playerWin.isDestroyed()) createPlayerWindow();
  playerWin.show();
  playerWin.focus();
}

function toggleTrayWindow() {
  if (trayWin.isVisible()) return trayWin.hide();
  const icon = tray.getBounds();
  const [width] = trayWin.getSize();
  const area = screen.getDisplayMatching(icon).workArea;
  const x = Math.min(Math.max(area.x, Math.round(icon.x + icon.width / 2 - width / 2)), area.x + area.width - width);
  trayWin.setPosition(x, Math.round(icon.y + icon.height + 4));
  trayWin.show();
  trayWin.focus();
}

// ------------------------------------------------------------ YouTube Music

const agentSource = () =>
  fs.readFileSync(path.join(ROOT, 'ytm', 'parse.js'), 'utf8') + '\n' + fs.readFileSync(path.join(ROOT, 'ytm', 'agent.js'), 'utf8');

function isYtm(url) {
  try {
    return new URL(url).hostname === 'music.youtube.com';
  } catch (_) {
    return false;
  }
}

function createYtmWindow() {
  const ses = session.fromPartition('persist:ytm');
  // Present as the Chromium this app really is, without the embedding tokens
  // that make Google's sign-in page refuse to load.
  const chromeUA = ses.getUserAgent().replace(/\s(Electron|RetroTune|retro-music-player)\/\S+/gi, '');
  ses.setUserAgent(chromeUA);
  // Google's account sign-in rejects embedded Chromium outright; it accepts Firefox.
  ses.webRequest.onBeforeSendHeaders({ urls: ['https://accounts.google.com/*'] }, (details, done) => {
    details.requestHeaders['User-Agent'] =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:140.0) Gecko/20100101 Firefox/140.0';
    done({ requestHeaders: details.requestHeaders });
  });

  ytmWin = new BrowserWindow({
    width: 1100,
    height: 760,
    show: false,
    title: 'YouTube Music',
    webPreferences: {
      preload: path.join(ROOT, 'ytm', 'preload.js'),
      session: ses,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  ytmWin.setMenuBarVisibility(false);
  ytmWin.loadURL(YTM_URL);

  ytmWin.webContents.on('dom-ready', () => {
    if (!isYtm(ytmWin.webContents.getURL())) return;
    ytmWin.webContents
      .executeJavaScript(agentSource(), true)
      .then(() => vizWanted && runCommand('visualizer', { on: true }))
      .catch((err) => console.error('agent injection failed:', err.message));
  });
  ytmWin.webContents.on('did-fail-load', (_e, code, description, _url, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    state = { ready: false, error: description };
    broadcast('state', state);
    setTimeout(() => !quitting && ytmWin && !ytmWin.isDestroyed() && ytmWin.loadURL(YTM_URL), 5000);
  });
  ytmWin.webContents.setWindowOpenHandler(({ url }) => {
    let host = '';
    try {
      host = new URL(url).hostname;
    } catch (_) {}
    if (/(^|\.)(google|youtube)\.com$/.test(host)) return { action: 'allow' };
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  ytmWin.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    ytmWin.hide();
  });
}

async function runCommand(name, args) {
  if (!ytmWin || ytmWin.isDestroyed()) throw new Error('YouTube Music is not running');
  const code = `window.__retroAgent
    ? window.__retroAgent.run(${JSON.stringify(name)}, ${JSON.stringify(args || {})})
    : Promise.reject(new Error('YouTube Music is still loading'))`;
  return ytmWin.webContents.executeJavaScript(code, true);
}

const quiet = (name, args) => runCommand(name, args).catch(() => {});

function toggleYtm(show) {
  if (!ytmWin) return;
  if (show ?? !ytmWin.isVisible()) {
    ytmWin.show();
    ytmWin.focus();
  } else ytmWin.hide();
}

// ---------------------------------------------------------------- menu bar

let marquee = { text: '', offset: 0, timer: null };
const MARQUEE_WIDTH = 28;

function trayIcon() {
  const image = nativeImage.createFromPath(path.join(ROOT, '..', 'assets', 'trayTemplate.png'));
  image.setTemplateImage(true);
  return image;
}

function updateTrayTitle() {
  if (!tray || !isMac) return;
  const label = settings.menuBarTrack && state.title ? [state.title, state.artist].filter(Boolean).join(' – ') : '';
  if (label !== marquee.text) marquee = { ...marquee, text: label, offset: 0 };
  clearInterval(marquee.timer);
  marquee.timer = null;
  if (!label) return tray.setTitle('');
  if (label.length <= MARQUEE_WIDTH || state.paused) {
    const shown = label.length > MARQUEE_WIDTH ? label.slice(0, MARQUEE_WIDTH - 1) + '…' : label;
    return tray.setTitle(' ' + shown);
  }
  const loop = Array.from(label + '   •   ');
  const draw = () => {
    const out = [];
    for (let i = 0; i < MARQUEE_WIDTH; i++) out.push(loop[(marquee.offset + i) % loop.length]);
    tray.setTitle(' ' + out.join(''), { fontType: 'monospaced' });
    marquee.offset = (marquee.offset + 1) % loop.length;
  };
  draw();
  marquee.timer = setInterval(draw, 350);
}

function buildMenu() {
  const playing = state.title ? `${state.title}${state.artist ? ' – ' + state.artist : ''}` : 'Nothing playing';
  const toggle = (label, key) => ({
    label,
    type: 'checkbox',
    checked: !!settings[key],
    click: (item) => setSetting(key, item.checked),
  });
  return Menu.buildFromTemplate([
    { label: playing.length > 60 ? playing.slice(0, 59) + '…' : playing, enabled: false },
    { type: 'separator' },
    { label: state.paused === false ? 'Pause' : 'Play', click: () => quiet('playPause') },
    { label: 'Next', click: () => quiet('next') },
    { label: 'Previous', click: () => quiet('previous') },
    { label: state.like === 'LIKE' ? 'Remove Like' : 'Like', click: () => quiet('like') },
    { type: 'separator' },
    {
      label: 'Skin',
      submenu: listThemes().map((theme) => ({
        label: theme.name,
        type: 'radio',
        checked: settings.theme === theme.id,
        click: () => setSetting('theme', theme.id),
      })),
    },
    {
      label: 'Visualizer',
      submenu: [
        ['bars', 'Spectrum Bars'],
        ['scope', 'Oscilloscope'],
        ['off', 'Off'],
      ].map(([id, label]) => ({
        label,
        type: 'radio',
        checked: settings.visualizer === id,
        click: () => setSetting('visualizer', id),
      })),
    },
    toggle('Compact Mode', 'compact'),
    toggle('Always on Top', 'alwaysOnTop'),
    { type: 'separator' },
    toggle('Show Song in Menu Bar', 'menuBarTrack'),
    toggle('Menu Bar Only (Hide Dock Icon)', 'menuBarOnly'),
    toggle('Notify on Song Change', 'notifications'),
    { type: 'separator' },
    { label: 'Show Player', click: showPlayer },
    { label: state.loggedIn ? 'Open YouTube Music…' : 'Sign In to YouTube Music…', click: () => toggleYtm(true) },
    { type: 'separator' },
    { label: 'Quit RetroTune', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() },
  ]);
}

function createTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip('RetroTune');
  tray.on('click', toggleTrayWindow);
  tray.on('right-click', () => tray.popUpContextMenu(buildMenu()));
}

function applySettings() {
  if (playerWin && !playerWin.isDestroyed()) playerWin.setAlwaysOnTop(!!settings.alwaysOnTop, 'floating');
  if (isMac && app.dock) settings.menuBarOnly ? app.dock.hide() : app.dock.show();
  updateTrayTitle();
}

function appMenu() {
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu' },
    {
      label: 'Playback',
      submenu: [
        { label: 'Play / Pause', click: () => quiet('playPause') },
        { label: 'Next', accelerator: 'CmdOrCtrl+Right', click: () => quiet('next') },
        { label: 'Previous', accelerator: 'CmdOrCtrl+Left', click: () => quiet('previous') },
        { label: 'Like', accelerator: 'CmdOrCtrl+L', click: () => quiet('like') },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { label: 'Show Player', accelerator: 'CmdOrCtrl+0', click: showPlayer },
        { label: 'Open YouTube Music…', accelerator: 'CmdOrCtrl+Y', click: () => toggleYtm(true) },
        { role: 'minimize' },
        { role: 'close' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ----------------------------------------------------------------------- IPC

let vizWanted = false;

function onState(next) {
  const previous = state;
  state = next;
  broadcast('state', state);
  if (next.title !== previous.title || next.artist !== previous.artist || next.paused !== previous.paused) {
    updateTrayTitle();
  }
  const changed = next.videoId && next.videoId !== previous.videoId && next.title;
  if (changed && settings.notifications && !next.ad && !(playerWin && playerWin.isFocused())) {
    new Notification({ title: next.title, body: next.artist, silent: true }).show();
  }
}

function wireIpc() {
  const fromYtm = (event) => ytmWin && !ytmWin.isDestroyed() && event.sender === ytmWin.webContents;
  const fromUi = (event) => uiWindows().some((w) => w.webContents === event.sender);

  ipcMain.on('ytm:state', (event, data) => fromYtm(event) && onState(data));
  ipcMain.on('ytm:queue', (event, data) => {
    if (!fromYtm(event)) return;
    queue = data;
    broadcast('queue', queue);
  });
  ipcMain.on('ytm:viz', (event, data) => {
    if (!fromYtm(event)) return;
    for (const win of uiWindows()) if (win.isVisible()) win.webContents.send('viz', data);
  });

  ipcMain.handle('ui:init', (event) => (fromUi(event) ? { settings, themes: listThemes(), state, queue } : null));
  ipcMain.handle('ui:cmd', (event, name, args) => (fromUi(event) ? runCommand(name, args) : null));
  ipcMain.on('ui:set', (event, key, value) => fromUi(event) && setSetting(key, value));
  ipcMain.on('ui:viz', (event, on) => {
    if (!fromUi(event)) return;
    vizWanted = !!on;
    quiet('visualizer', { on: vizWanted });
  });
  ipcMain.on('ui:win', (event, action, arg) => {
    if (!fromUi(event)) return;
    const win = BrowserWindow.fromWebContents(event.sender);
    if (action === 'minimize') win.minimize();
    else if (action === 'close') win.hide();
    else if (action === 'menu') buildMenu().popup({ window: win });
    else if (action === 'ytm') toggleYtm(true);
    else if (action === 'show-player') showPlayer();
    else if (action === 'size' && arg && arg.height > 40 && arg.height < 2000) {
      win.setContentSize(Math.round(arg.width || win.getContentSize()[0]), Math.round(arg.height));
    }
  });
}

// ----------------------------------------------------------------- lifecycle

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.setName('RetroTune');
  app.on('second-instance', showPlayer);
  app.on('before-quit', () => (quitting = true));
  app.on('window-all-closed', () => {});
  app.on('activate', showPlayer);

  app.whenReady().then(() => {
    loadSettings();
    wireIpc();
    appMenu();
    createYtmWindow();
    createPlayerWindow();
    createTrayWindow();
    createTray();
    applySettings();
  });
}
