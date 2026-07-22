// ============================================================================
// KUKU.LU - Generate Email Otomatis (HTTP mode, tanpa browser)
// ============================================================================

const axios  = require('axios');
const fs     = require('fs');
const COUNT  = parseInt(process.argv[2] || '5');

// === CONFIG ===
const ID       = 'ISI_ID_LO';
const PASSWORD = 'ISI_PASSWORD_LO';

const BASE_URL = 'https://m.kuku.lu';
const UA       = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

let cookieJar = {};

function parseCookies(setCookieHeaders) {
  if (!setCookieHeaders) return;
  const headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
  for (const header of headers) {
    const [pair] = header.split(';');
    const [name, ...rest] = pair.split('=');
    cookieJar[name.trim()] = rest.join('=').trim();
  }
}

function getCookieString() {
  return Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join('; ');
}

(async () => {
  try {
    // ─── STEP 1: GET m.kuku.lu/ → ambil csrf_token dari cookie (302) ──────
    console.log('[*] Ambil CSRF token...');
    const r1 = await axios.get(`${BASE_URL}/`, {
      headers: { 'User-Agent': UA },
      maxRedirects: 0,
      validateStatus: s => s === 302 || s === 200,
    });
    parseCookies(r1.headers['set-cookie']);
    console.log('[+] csrf_token:', cookieJar['cookie_csrf_token'] || 'tidak ditemukan');

    // ─── STEP 2: GET id.php → ambil csrf_subtoken dari HTML ───────────────
    const r2 = await axios.get(`${BASE_URL}/id.php`, {
      headers: {
        'User-Agent': UA,
        'Cookie':     getCookieString(),
      },
    });
    parseCookies(r2.headers['set-cookie']);

    const html2 = String(r2.data);
    // cari csrf_subtoken_check di form HTML
    const csrfSubtoken = (
      html2.match(/name="csrf_subtoken_check"\s+value="([^"]+)"/)?.[1] ||
      html2.match(/csrf_subtoken_check['":\s]+([a-f0-9]{32,})/i)?.[1] ||
      ''
    );
    console.log('[+] csrf_subtoken:', csrfSubtoken || 'tidak ditemukan');

    // ─── STEP 3: POST login ke /index.php ─────────────────────────────────
    console.log('[*] Login...');
    const loginParams = new URLSearchParams({
      action:              'checkLogin',
      confirmcode:         '',
      nopost:              '1',
      csrf_token_check:    cookieJar['cookie_csrf_token'] || '',
      csrf_subtoken_check: csrfSubtoken,
      number:              ID,
      password:            PASSWORD,
      syncconfirm:         'no',
    });

    const loginRes = await axios.post(`${BASE_URL}/index.php`, loginParams.toString(), {
      headers: {
        'User-Agent':        UA,
        'Content-Type':      'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With':  'XMLHttpRequest',
        'Origin':            BASE_URL,
        'Referer':           `${BASE_URL}/id.php`,
        'Cookie':            getCookieString(),
      },
      maxRedirects: 5,
    });
    parseCookies(loginRes.headers['set-cookie']);

    const loginBody = String(loginRes.data);
    console.log('[+] Respon login:', loginBody.slice(0, 100));

    if (!cookieJar['cookie_sessionhash']) {
      console.error('[!] Login gagal - session tidak ditemukan');
      console.log('[!] Cookie saat ini:', getCookieString());
      process.exit(1);
    }
    console.log('[+] Login berhasil!');

    // ─── STEP 4: Generate email ────────────────────────────────────────────
    const generated = [];
    console.log(`\n[*] Generate ${COUNT} email...\n`);

    for (let i = 0; i < COUNT; i++) {
      const params = new URLSearchParams({
        action:              'addMailAddrByAuto',
        nopost:              '1',
        by_system:           '1',
        csrf_token_check:    cookieJar['cookie_csrf_token'] || '',
        csrf_subtoken_check: csrfSubtoken,
        recaptcha_token:     '',
        _:                   Date.now(),
      });

      const res = await axios.get(`${BASE_URL}/index.php?${params}`, {
        headers: {
          'User-Agent':       UA,
          'X-Requested-With': 'XMLHttpRequest',
          'Cookie':           getCookieString(),
        },
      });

      const body = String(res.data);
      if (body.startsWith('OK:')) {
        const email = body.replace('OK:', '').trim();
        console.log(`[${i + 1}] ${email}`);
        generated.push(email);
      } else {
        console.log(`[${i + 1}] GAGAL - ${body.slice(0, 80)}`);
      }
      await sleep(1200);
    }

    // ─── STEP 5: List semua email ──────────────────────────────────────────
    console.log('\n[*] Fetch semua email dari akun...');
    const ts      = Date.now();
    const listRes = await axios.get(`${BASE_URL}/smphone.app.index._addrlist.php?t=${ts}&nopost=1&_=${ts}`, {
      headers: {
        'User-Agent':       UA,
        'X-Requested-With': 'XMLHttpRequest',
        'Cookie':           getCookieString(),
      },
    });

    const html     = String(listRes.data);
    const matches  = [...html.matchAll(/[\w.\-+]+@[\w.\-]+\.[a-z]{2,}/g)].map(m => m[0]);
    const allEmails = [...new Set(matches)];

    fs.writeFileSync('kuku_emails.txt', allEmails.join('\n'));
    console.log(`\n[+] Total ${allEmails.length} email → kuku_emails.txt`);
    allEmails.forEach(e => console.log(`  ${e}`));

  } catch (err) {
    console.error('Terjadi eror:', err.message);
    if (err.response) {
      console.error('Status:', err.response.status);
      console.error('Body:', String(err.response.data).slice(0, 200));
    }
  }
})();
