const https = require("https");
const zlib  = require("zlib");
const fs    = require("fs");

// === CONFIG ===
const ID       = "ISI_ID_LO";
const PASSWORD = "ISI_PASSWORD_LO";
const COUNT    = parseInt(process.argv[2] || "5");
const BASE     = "m.kuku.lu";

let sessionCookies = {};

function parseCookies(headers) {
  (headers["set-cookie"] || []).forEach((c) => {
    const [pair] = c.split(";");
    const idx = pair.indexOf("=");
    if (idx < 0) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (k) sessionCookies[k] = v;
  });
}

function cookieString() {
  return Object.entries(sessionCookies).map(([k, v]) => `${k}=${v}`).join("; ");
}

function request(method, path, body = null, isXHR = false, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error("Too many redirects"));

    const headers = {
      "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36",
      "Accept": isXHR ? "*/*" : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8",
      "Accept-Encoding": "gzip, deflate, br",
      "Cookie": cookieString(),
    };
    if (isXHR) {
      headers["X-Requested-With"] = "XMLHttpRequest";
      headers["Sec-Fetch-Mode"] = "cors";
      headers["Sec-Fetch-Site"] = "same-origin";
    } else {
      headers["Sec-Fetch-Mode"] = "navigate";
      headers["Sec-Fetch-Site"] = "same-origin";
      headers["Sec-Fetch-User"] = "?1";
      headers["Upgrade-Insecure-Requests"] = "1";
    }
    if (body) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      headers["Content-Length"] = Buffer.byteLength(body);
    }

    const req = https.request({ host: BASE, path, method, headers }, (res) => {
      parseCookies(res.headers);
      if ([301, 302, 303].includes(res.statusCode) && res.headers.location) {
        const loc = res.headers.location.replace(`https://${BASE}`, "");
        res.resume();
        return resolve(request("GET", loc, null, isXHR, redirectCount + 1));
      }

      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        const enc = (res.headers["content-encoding"] || "").toLowerCase();
        const decode = (err, decoded) => {
          if (err) resolve({ body: buf.toString("utf8"), status: res.statusCode });
          else resolve({ body: decoded.toString("utf8"), status: res.statusCode });
        };
        if (enc === "gzip") zlib.gunzip(buf, decode);
        else if (enc === "br") zlib.brotliDecompress(buf, decode);
        else if (enc === "deflate") zlib.inflate(buf, decode);
        else resolve({ body: buf.toString("utf8"), status: res.statusCode });
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function extractSubtoken(html) {
  const patterns = [
    /csrf_subtoken_check["'\s:=]+([a-f0-9]{32})/,
    /subtoken["'\s:=]+([a-f0-9]{32})/,
    /name="csrf_subtoken[^"]*"[^>]*value="([a-f0-9]{32})"/,
    /value="([a-f0-9]{32})"[^>]*name="csrf_subtoken/,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) return m[1];
  }
  return null;
}

async function login() {
  console.log("[*] Ambil halaman login (id.php)...");
  const { body, status } = await request("GET", "/id.php");
  console.log(`[*] Status: ${status} | Length: ${body.length}`);

  const csrfToken = sessionCookies["cookie_csrf_token"];
  const subtoken  = extractSubtoken(body) || "";

  console.log("[+] csrf_token:", csrfToken);
  console.log("[+] subtoken:", subtoken || "(kosong)");

  if (!csrfToken) {
    console.log("[!] csrf_token ga ketemu di cookie");
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

  const { body: loginRes } = await request("POST", "/smphone.app.index.php", payload, true);
  console.log("[*] Login response:", loginRes.slice(0, 150));

  if (loginRes.startsWith("OK") || loginRes.includes("sukses") || sessionCookies["cookie_sessionhash"]) {
    console.log("[+] Login berhasil!");
  } else {
    console.log("[!] Login mungkin gagal, lanjut coba...");
  }
}

async function getTokens() {
  const { body } = await request("GET", "/smphone.app.index.php");
  return {
    csrfToken: sessionCookies["cookie_csrf_token"],
    subtoken:  extractSubtoken(body) || "",
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
  const { body } = await request("GET", `/index.php?${params}`, null, true);
  if (body.startsWith("OK:")) return body.replace("OK:", "").trim();
  console.log(`    [!] Generate response: ${body.slice(0, 100)}`);
  return null;
}

async function listEmails() {
  const ts = Date.now();
  const { body } = await request("GET", `/smphone.app.index._addrlist.php?t=${ts}&nopost=1&_=${ts}`, null, true);
  const emails = [...body.matchAll(/[\w.\-+]+@[\w.\-]+\.[a-z]{2,}/g)].map((m) => m[0]);
  return [...new Set(emails)];
}

(async () => {
  await login();

  console.log("\n[*] Ambil token...");
  const { csrfToken, subtoken } = await getTokens();

  console.log(`\n[*] Generate ${COUNT} email...\n`);
  const generated = [];
  for (let i = 0; i < COUNT; i++) {
    const email = await generateEmail(csrfToken, subtoken);
    if (email) {
      console.log(`[${i + 1}] ${email}`);
      generated.push(email);
    } else {
      console.log(`[${i + 1}] GAGAL`);
    }
    await sleep(1200);
  }

  console.log("\n[*] Fetch semua email...");
  const all = await listEmails();
  fs.writeFileSync("kuku_emails.txt", all.join("\n"));
  console.log(`\n[+] Total ${all.length} email → kuku_emails.txt`);
  all.forEach((e) => console.log(`  ${e}`));
})();
