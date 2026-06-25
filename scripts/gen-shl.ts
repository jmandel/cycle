/**
 * gen-shl.ts (bun) — package the longitudinal example Bundle as a SMART Health
 * Link: encrypt it (compact JWE, dir/A256GCM) and emit local/deploy artifacts
 * for the reference viewer. Direct-file mode (flag "U").
 *
 *   dist/view-assets/example.jwe           ciphertext for local/deploy viewer use
 *   dist/view-assets/shlink.txt            canonical viewer-prefixed shlink:/
 *   dist/view-assets/_shlink-local.txt     bare shlink:/ for localhost testing
 *   dist/view-assets/_shlink-local-ig.txt  viewer-prefixed localhost test link
 *
 * Run after gen-example.ts:  bun scripts/gen-shl.ts
 */
import { mkdir } from "node:fs/promises";
import { encryptCompact, b64uFromBytes, bytesFromB64u } from "../viewer-src/jwe.mjs";

// A full shareable link is <viewer>#shlink:/<payload>. The default is the
// local verifier's URL. Deploy workflows can override VIEWER_BASE.
const DEFAULT_VIEWER_BASE = "http://localhost:5525/view";
const VIEWER_BASE = normalizeBase(Bun.env.VIEWER_BASE || DEFAULT_VIEWER_BASE);
const FILE_BASE = normalizeBase(Bun.env.SHL_FILE_BASE || defaultFileBase(VIEWER_BASE));
const LABEL = "Periodicity — synthetic longitudinal period-tracking export";
const dir = Bun.env.SHL_OUTDIR || `${import.meta.dir}/../dist/view-assets`;
const root = `${import.meta.dir}/..`;

// FIXED public demo key + IV: this is synthetic data meant to be openable by
// anyone, and pinning them makes example.jwe / shlink.txt byte-stable
// across builds (no churn) so the link can be documented on the examples page.
// NEVER reuse a fixed key/IV for real patient data — gen a fresh random key+IV.
const keyB64 = "-iXXJ2n57QEfYcKZPqjzvde4Y_XaBdqjzmRUvRhwVcI";
const ivB64 = "wrcwWOZXCZuO6fMQ";
const key = bytesFromB64u(keyB64);

const bundlePath = Bun.env.BUNDLE_FILE || `${root}/dist/examples/Bundle-period-tracking-longitudinal-example.json`;
const bundle = await Bun.file(bundlePath).text();

const jwe = await encryptCompact(bundle, key, { iv: bytesFromB64u(ivB64) });
await mkdir(dir, { recursive: true });
await Bun.write(`${dir}/example.jwe`, jwe);

const enc = new TextEncoder();
const shlinkPayload = (fileUrl: string) => "shlink:/" + b64uFromBytes(enc.encode(JSON.stringify({ url: fileUrl, key: keyB64, flag: "U", label: LABEL, v: 1 })));
const share = (viewer: string, file: string) => `${viewer}#${shlinkPayload(file)}`;
function normalizeBase(value: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("base URL must not be empty");
  return trimmed.replace(/\/+$/, "");
}
function defaultFileBase(viewer: string) {
  const u = new URL(viewer);
  return `${u.origin}/view-assets`;
}

const shareUrl = share(VIEWER_BASE, `${FILE_BASE}/example.jwe`);
await Bun.write(`${dir}/shlink.txt`, shareUrl + "\n");
const localFileUrl = "http://localhost:5525/view-assets/example.jwe";
await Bun.write(`${dir}/_shlink-local.txt`, shlinkPayload(localFileUrl) + "\n");
await Bun.write(`${dir}/_shlink-local-ig.txt`, share("http://localhost:5525/view", localFileUrl) + "\n");

console.log(`wrote example.jwe (${jwe.length} chars), shlink.txt (+ local test links)`);
console.log(`  key=${keyB64.slice(0, 10)}… (fixed public demo key)`);
console.log(`  viewer=${VIEWER_BASE}  (jwe at ${FILE_BASE}/example.jwe)`);
