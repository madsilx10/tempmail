// ============================================================================
// KUKU.LU - Generate Email Otomatis
// ============================================================================

Object.defineProperty(process, 'platform', { get: () => 'linux' });

const { chromium } = require('playwright-extra');
const stealthPlugin = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealthPlugin);

const fs    = require('fs');
const COUNT = parseInt(process.argv[2] || '5');

// === CONFIG ===
const ID       = 'ISI_ID_LO';
const PASSWORD = 'ISI_PASSWORD_LO';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  console.log('Memulai browser Chromium Termux...');

  const browser = await chromium.launch({
    executablePath: '/data/data/com.termux/files/usr/bin/chromium-browser',
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process'
    ]
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  try {
    // ─── LOGIN ───────────────────────────────────────────────
    console.log('[*] Buka halaman login...');
    await page.goto('https://m.kuku.lu/id.php', { waitUntil: 'networkidle' });

    // Tunggu Cloudflare selesai kalau ada
    await page.waitForFunction(
      () => !document.title.includes('Just a moment'),
      { timeout: 30000 }
    );
    console.log('[+] Halaman login loaded, judul:', await page.title());

    // Isi form login
    await page.fill('input[name="number"]', ID);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('input[type="submit"], button[type="submit"]');
    await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
    console.log('[+] Login selesai, URL:', page.url());

    // ─── GENERATE EMAIL ───────────────────────────────────────
    const generated = [];
    console.log(`\n[*] Generate ${COUNT} email...\n`);

    for (let i = 0; i < COUNT; i++) {
      const res = await page.evaluate(async () => {
        const getCookie = (name) => {
          const m = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
          return m ? m[2] : '';
        };
        const csrf     = getCookie('cookie_csrf_token');
        const subEl    = document.querySelector('[name="csrf_subtoken_check"]');
        const subtoken = subEl ? subEl.value : '';

        const params = new URLSearchParams({
          action: 'addMailAddrByAuto',
          nopost: '1',
          by_system: '1',
          csrf_token_check: csrf,
          csrf_subtoken_check: subtoken,
          recaptcha_token: '',
          _: Date.now(),
        });
        const r = await fetch(`/index.php?${params}`, {
          headers: { 'X-Requested-With': 'XMLHttpRequest' }
        });
        return r.text();
      });

      if (res.startsWith('OK:')) {
        const email = res.replace('OK:', '').trim();
        console.log(`[${i + 1}] ${email}`);
        generated.push(email);
      } else {
        console.log(`[${i + 1}] GAGAL - ${res.slice(0, 80)}`);
      }
      await sleep(1200);
    }

    // ─── LIST SEMUA EMAIL ─────────────────────────────────────
    console.log('\n[*] Fetch semua email dari akun...');
    const allEmails = await page.evaluate(async () => {
      const ts = Date.now();
      const r  = await fetch(`/smphone.app.index._addrlist.php?t=${ts}&nopost=1&_=${ts}`, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
      });
      const html = await r.text();
      const matches = [...html.matchAll(/[\w.\-+]+@[\w.\-]+\.[a-z]{2,}/g)].map(m => m[0]);
      return [...new Set(matches)];
    });

    fs.writeFileSync('kuku_emails.txt', allEmails.join('\n'));
    console.log(`\n[+] Total ${allEmails.length} email → kuku_emails.txt`);
    allEmails.forEach(e => console.log(`  ${e}`));

  } catch (error) {
    console.error('Terjadi eror:', error.message);
  } finally {
    await browser.close();
    console.log('\nBrowser ditutup.');
  }
})();
