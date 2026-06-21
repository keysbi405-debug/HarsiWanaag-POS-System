# Harsi POS — Test Runner

This project contains a small POS app and a test harness. The automated headless test runner uses Puppeteer to open the test harness and simulate basic flows.

Prerequisites:
- Node.js 16+ (or newer)

Install and run tests:

```bash
cd "c:\Users\asl00014.ASAL\Documents\My Pos"
npm install
npm test
```

What the runner does:
- Serves the project on http://localhost:8080
- Opens `/test_harness.html` in headless Chromium
- Waits for the harness to finish its simulated flows and prints `posHistory` from localStorage

If you prefer a manual test, open `test_harness.html` directly in a browser and check the developer console for logs.
