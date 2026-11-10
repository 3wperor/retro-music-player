// Preload for the hidden YouTube Music window. Exposes a one-way pipe the
// injected agent uses to report player state back to the app.
const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = new Set(['state', 'queue', 'viz']);

contextBridge.exposeInMainWorld('__retroBridge', {
  send(channel, data) {
    if (CHANNELS.has(channel)) ipcRenderer.send('ytm:' + channel, data);
  },
});
