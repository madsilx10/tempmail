const https = require("https");
const fs = require("fs");
const readline = require("readline");

const BASE = "m.kuku.lu";

// === CONFIG ===
const ID = "ISI_ID_LO";
const PASSWORD = "ISI_PASSWORD";
const GENERATE_COUNT = parseInt(process.argv[2] || "5");

let sessionCookies = {};

function parseCookies(headers) {
  const raw = headers["set-cookie"] || [];
  raw.forEach((c) => {
    const [pair] = c.split(";");
    const [k, v] = pair.split("=");
    if (k && v) sessionCookies[k.trim()] = v.trim();
  });
}

function cookieString() {
  return Object.entries(sessionCookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const headers = {
      "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36",
      "X-Requested-With": "XMLHttpRequest",
      Accept: "*/*",
      Cookie: cookieString(),
    };

    if (body) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      headers["Content-Length"] = Buffer.byteLength(body);
    }

    const req = https.request({ host: BASE, path, method, headers }, (res) => {
      parseCookies(res.headers);
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ body: data, status: res.statusCode }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function extractSubtoken(html) {
  const match = html.match(/csrf_subtoken[_\w]*["'\s:=]+([a-f0-9]{32})/);
  return match ? match[1] : null;
}

async function login() {
  console.log("[*] Ambil halaman login...");
  const ts = Date.now();
  const { body } = await request("GET", `/smphone.app.index.php?nopost=1&_=${ts}`);

  const csrfToken = sessionCookies["cookie_csrf_token"];
  const subtoken = extractSubtoken(body);

  // DEBUG
  const fs2 = require("fs");
  fs2.writeFileSync("debug_html.txt", body);
  console.log("[DEBUG] HTML disimpan ke debug_html.txt");
  console.log("[DEBUG] csrf_token:", csrfToken);
  console.log("[DEBUG] subtoken:", subtoken);

  if (!csrfToken || !subtoken) {
    console.log("[!] Gagal ambil CSRF token");
    process.exit(1);
  }

  console.log("[*] Login...");
  const payload = new URLSearchParams({
    action: "checkLogin",
    confirmcode: "",
    nopost: "1",
    csrf_token_check: csrfToken,
    csrf_subtoken_check: subtoken,
    number: ID,
    password: PASSWORD,
    syncconfirm: "",
  }).toString();

  const { body: loginRes } = await request("POST", "/smphone.app.index.php", payload);

  if (loginRes.includes("OK") || sessionCookies["cookie_sessionhash"]) {
    console.log("[+] Login berhasil!");
  } else {
    console.log(`[!] Login gagal: ${loginRes.slice(0, 100)}`);
    process.exit(1);
  }
}

async function getCsrfSubtoken() {
  const ts = Date.now();
  const { body } = await request("GET", `/smphone.app.index.php?nopost=1&_=${ts}`);
  return {
    csrfToken: sessionCookies["cookie_csrf_token"],
    subtoken: extractSubtoken(body),
  };
}

async function generateEmail(csrfToken, subtoken) {
  const ts = Date.now();
  const params = new URLSearchParams({
    action: "addMailAddrByAuto",
    nopost: "1",
    by_system: "1",
    csrf_token_check: csrfToken,
    csrf_subtoken_check: subtoken,
    recaptcha_token: "",
    _: ts,
  });
  const { body } = await request("GET", `/index.php?${params}`);
  if (body.startsWith("OK:")) return body.replace("OK:", "").trim();
  console.log(`    [!] Response: ${body.slice(0, 100)}`);
  return null;
}

async function listEmails() {
  const ts = Date.now();
  const { body } = await request(
    "GET",
    `/smphone.app.index._addrlist.php?t=${ts}&nopost=1&_=${ts}`
  );
  const emails = [...body.matchAll(/[\w.\-+]+@[\w.\-]+\.[a-z]{2,}/g)].map((m) => m[0]);
  return [...new Set(emails)];
}

(async () => {
  await login();

  console.log("\n[*] Ambil CSRF token...");
  const { csrfToken, subtoken } = await getCsrfSubtoken();
  if (!subtoken) {
    console.log("[!] Subtoken gagal");
    process.exit(1);
  }

  console.log(`[+] Generate ${GENERATE_COUNT} email...\n`);
  const generated = [];
  for (let i = 0; i < GENERATE_COUNT; i++) {
    const email = await generateEmail(csrfToken, subtoken);
    if (email) {
      console.log(`[${i + 1}] ${email}`);
      generated.push(email);
    } else {
      console.log(`[${i + 1}] GAGAL`);
    }
    await sleep(1000);
  }

  console.log("\n[*] Fetch semua email dari akun...");
  const all = await listEmails();

  fs.writeFileSync("kuku_emails.txt", all.join("\n"));
  console.log(`\n[+] Total ${all.length} email → kuku_emails.txt`);
  all.forEach((e) => console.log(`  ${e}`));
})();
