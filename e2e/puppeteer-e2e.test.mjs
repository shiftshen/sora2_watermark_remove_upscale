import puppeteer from 'puppeteer';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const TIMEOUT_MS = parseInt(process.env.E2E_TIMEOUT_MS || '2000', 10);
const headlessEnv = process.env.HEADLESS;
const HEADLESS = headlessEnv === undefined ? 'new' : (headlessEnv === 'true' || headlessEnv === '1');
const NO_SANDBOX = process.env.NO_SANDBOX === 'true' || process.env.NO_SANDBOX === '1';

(async () => {
  const launchOptions = { headless: HEADLESS };
  if (NO_SANDBOX) {
    launchOptions.args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process'
    ];
  }

  const browser = await puppeteer.launch(launchOptions);
  const page = await browser.newPage();

  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  page.on('response', async res => {
    const status = res.status();
    if (status >= 400) {
      const body = await res.text().catch(() => '');
      errors.push(`HTTP ${status} at ${res.url()} body=${body.slice(0,200)}`);
    }
  });

  try {
    const start = Date.now();
    await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
    const elapsed = Date.now() - start;
    console.log(`Page DOM loaded in ${elapsed}ms (BASE_URL=${BASE_URL}, NO_SANDBOX=${NO_SANDBOX})`);

    if (elapsed > TIMEOUT_MS) throw new Error(`DOM load exceeded ${TIMEOUT_MS}ms: ${elapsed}ms`);

    await page.waitForSelector('#statusText', { timeout: Math.min(1000, TIMEOUT_MS) });

    if (errors.length) {
      throw new Error(`Console/API errors: \n${errors.join('\n')}`);
    }

    console.log('E2E OK');
  } catch (e) {
    console.error('E2E FAILED:', e.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();