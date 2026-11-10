// Regenerates the menu bar and app icons in assets/:  node scripts/icons.js
const { chromium } = require('playwright');
const path = require('path');

const note = (fill) =>
  `<path fill="${fill}" d="M6 2v8.3A2.5 2.5 0 1 0 7.5 12.5V5h5v3.3A2.5 2.5 0 1 0 14 10.5V2z"/>`;
const tray = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${note('#000')}</svg>`;
const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect x="5" y="5" width="54" height="54" fill="#c0c0c0"/>
  <path d="M5 59V5h54" fill="none" stroke="#fff" stroke-width="2"/>
  <path d="M59 5v54H5" fill="none" stroke="#404040" stroke-width="2"/>
  <rect x="9" y="9" width="46" height="9" fill="#000080"/>
  <rect x="11" y="22" width="42" height="31" fill="#000"/>
  <g fill="#00e000"><rect x="15" y="40" width="4" height="10"/><rect x="21" y="32" width="4" height="18"/><rect x="27" y="36" width="4" height="14"/><rect x="33" y="27" width="4" height="23"/><rect x="39" y="34" width="4" height="16"/><rect x="45" y="42" width="4" height="8"/></g>
</svg>`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const render = async (svg, size, file) => {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<body style="margin:0">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}`);
    await page.screenshot({ path: path.join(__dirname, '..', 'assets', file), omitBackground: true });
  };
  await render(tray, 18, 'trayTemplate.png');
  await render(tray, 36, 'trayTemplate@2x.png');
  await render(icon, 1024, 'icon.png');
  await browser.close();
})();
