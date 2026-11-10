// Bridge between the retro UI and the main process.
const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = new Set(['state', 'queue', 'viz', 'settings']);

contextBridge.exposeInMainWorld('retro', {
  init: () => ipcRenderer.invoke('ui:init'),
  cmd: (name, args) => ipcRenderer.invoke('ui:cmd', name, args),
  set: (key, value) => ipcRenderer.send('ui:set', key, value),
  win: (action, arg) => ipcRenderer.send('ui:win', action, arg),
  viz: (on) => ipcRenderer.send('ui:viz', on),
  on(channel, handler) {
    if (EVENTS.has(channel)) ipcRenderer.on(channel, (_event, data) => handler(data));
  },
});
