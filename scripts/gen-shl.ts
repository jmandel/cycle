/**
 * gen-shl.ts (bun) — package the longitudinal example Bundle as a SMART Health
 * Link: encrypt it (compact JWE, dir/A256GCM) and emit the committed artifacts
 * the viewer and docs consume. Direct-file mode (flag "U").
 *
 *   input/images/viewer/example.jwe   the ciphertext (published static asset)
 *   input/images/viewer/shl.json      the viewer's default link (relative url)
 *   input/images/viewer/shlink.txt    canonical shlink:/ for the published site
 *   input/images/viewer/_shlink-local.txt   shlink:/ for localhost:5525 testing
 *                                            (underscore -> not published)
 *
 * Run ahead of the publisher:  bun scripts/gen-shl.ts
 */
import { encryptCompact, b64uFromBytes } from "../viewer-src/jwe.mjs";

// The canonical viewer is hosted on GitHub Pages (see scripts/build-pages.ts);
// both the viewer and the encrypted file live at the Pages root, so the demo is
// same-origin and self-contained. A full shareable link is <viewer>#shlink:/<payload>.
const PAGES_BASE = "https://jmandel.github.io/periodicity";
const LABEL = "Periodicity — synthetic longitudinal period-tracking export";
const dir = `${import.meta.dir}/../input/images/viewer`;

const bundle = await Bun.file(`${import.meta.dir}/../input/resources/Bundle-period-tracking-longitudinal-example.json`).text();

const key = crypto.getRandomValues(new Uint8Array(32));
const jwe = await encryptCompact(bundle, key);
await Bun.write(`${dir}/example.jwe`, jwe);

const keyB64 = b64uFromBytes(key);
const enc = new TextEncoder();
const shlinkPayload = (fileUrl: string) => "shlink:/" + b64uFromBytes(enc.encode(JSON.stringify({ url: fileUrl, key: keyB64, flag: "U", label: LABEL, v: 1 })));
const share = (viewer: string, file: string) => `${viewer}#${shlinkPayload(file)}`;

// viewer default: relative url so the same shl.json works at any base (IG or Pages)
await Bun.write(`${dir}/shl.json`, JSON.stringify({ url: "example.jwe", key: keyB64, flag: "U", label: LABEL, v: 1 }, null, 2));
// canonical shareable link (GitHub Pages viewer + Pages-hosted encrypted file)
await Bun.write(`${dir}/shlink.txt`, share(`${PAGES_BASE}/viewer.html`, `${PAGES_BASE}/example.jwe`) + "\n");
// local test links (underscore -> not published by the IG Publisher)
await Bun.write(`${dir}/_shlink-local-ig.txt`, share("http://localhost:5525/viewer/index.html", "http://localhost:5525/viewer/example.jwe") + "\n");
await Bun.write(`${dir}/_shlink-local-pages.txt`, share("http://localhost:5525/viewer.html", "http://localhost:5525/example.jwe") + "\n");

console.log(`wrote example.jwe (${jwe.length} chars), shl.json, shlink.txt (+ local test links)`);
console.log(`  key=${keyB64.slice(0, 10)}… (32 bytes)`);
