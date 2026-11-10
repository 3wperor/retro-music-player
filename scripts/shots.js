// Renders every skin with mock data to PNGs:  node scripts/shots.js <out-dir>
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'src', 'renderer');
const out = process.argv[2] || path.join(__dirname, '..', 'docs');
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json' };

(async () => {
  const server = http
    .createServer((req, res) => {
      const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
      if (!file.startsWith(root) || !fs.existsSync(file)) return res.writeHead(404).end();
      res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    })
    .listen(0);
  const base = `http://127.0.0.1:${server.address().port}/index.html`;
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 400, height: 700 }, deviceScaleFactor: 2 });
  page.on('pageerror', (err) => console.error('page error:', err.message));
  const themes = fs.readdirSync(path.join(root, 'themes')).filter((id) => fs.existsSync(path.join(root, 'themes', id, 'theme.json')));
  for (const theme of themes) {
    for (const [name, extra] of [['queue', ''], ['search', '&tab=search'], ['compact', '&compact=1']]) {
      await page.goto(`${base}?theme=${theme}${extra}`);
      if (name === 'search') {
        await page.fill('#search-input', 'lotus radio');
        await page.press('#search-input', 'Enter');
      }
      await page.waitForTimeout(700);
      await page.locator('#app').screenshot({ path: path.join(out, `${theme}-${name}.png`), omitBackground: true });
    }
  }
  await browser.close();
  server.close();
})();
