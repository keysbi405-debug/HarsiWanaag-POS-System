const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const PORT = process.env.PORT || 8080;
const ROOT = path.resolve(__dirname);

function contentType(file) {
  const ext = path.extname(file).toLowerCase();
  switch (ext) {
    case '.html': return 'text/html';
    case '.js': return 'application/javascript';
    case '.css': return 'text/css';
    case '.json': return 'application/json';
    case '.png': return 'image/png';
    case '.jpg': case '.jpeg': return 'image/jpeg';
    default: return 'application/octet-stream';
  }
}

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        let reqPath = decodeURIComponent(req.url.split('?')[0]);
        if (reqPath === '/') reqPath = '/test_harness.html';
        const filePath = path.join(ROOT, reqPath);
        if (!filePath.startsWith(ROOT)) {
          res.writeHead(403); res.end('Forbidden');
          return;
        }
        fs.readFile(filePath, (err, data) => {
          if (err) { res.writeHead(404); res.end('Not Found'); return; }
          res.writeHead(200, { 'Content-Type': contentType(filePath) });
          res.end(data);
        });
      } catch (e) {
        res.writeHead(500); res.end('Server error');
      }
    });

    server.listen(PORT, () => resolve(server));
  });
}

(async () => {
  const server = await startServer();
  console.log('Static server started on http://localhost:' + PORT);

  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  page.on('console', msg => {
    console.log('[page]', msg.text());
  });

  const url = `http://localhost:${PORT}/test_harness.html`;
  console.log('Navigating to', url);

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    // Wait for the test harness to log completion or timeout
    const result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for tests')), 30000);
      page.on('console', msg => {
        const text = msg.text();
        if (text && text.includes('Tests completed')) {
          clearTimeout(timeout);
          resolve({ ok: true });
        }
      });
    });

    // Grab localStorage posHistory
    const posHistory = await page.evaluate(() => localStorage.getItem('posHistory'));
    console.log('posHistory from page:', posHistory);

    await browser.close();
    server.close();
    process.exit(0);
  } catch (err) {
    console.error('Test runner error:', err);
    try { await browser.close(); } catch(e){}
    try { server.close(); } catch(e){}
    process.exit(1);
  }
})();
