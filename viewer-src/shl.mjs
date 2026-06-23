/**
 * shl.mjs — SMART Health Link decode + retrieve + decrypt (recipient side).
 *
 * Supports the two SHL retrieval modes:
 *   - direct file (flag contains "U"): GET the url with ?recipient=...
 *   - manifest: POST the url with {recipient}, read files[].embedded|location
 * then decrypts the JWE (dir / A256GCM) with the link's key.
 *
 * Relative `url`s are resolved against `baseUrl` so a single committed link can
 * work both locally (localhost:5525/viewer/) and when published.
 */
import { b64uFromBytes, bytesFromB64u, decryptCompact } from "./jwe.mjs";

const td = new TextDecoder();
const te = new TextEncoder();
export const DEFAULT_RECIPIENT = "Example User";

/** Extract the shlink:/ URI from bare links or viewer-prefixed URLs. */
export function extractShlinkURI(input) {
  if (!input) return null;
  let s = String(input).trim();
  const hash = s.indexOf("shlink:/");
  if (hash >= 0) s = s.slice(hash);
  if (!s.startsWith("shlink:/")) return null;
  return s;
}

/** Serialize a decoded SHLink payload back to a shlink:/ URI. */
export function shlinkFromPayload(payload) {
  return "shlink:/" + b64uFromBytes(te.encode(JSON.stringify(payload)));
}

/** Decode a shlink:/ URI (optionally behind a viewer URL with #). */
export function parseShlink(input) {
  const s = extractShlinkURI(input);
  if (!s) return null;
  const b64 = s.slice("shlink:/".length);
  const json = td.decode(bytesFromB64u(b64));
  return JSON.parse(json); // { url, key, flag?, label?, exp?, v? }
}

function normalizedRecipient(recipient) {
  return String(recipient || "").trim() || DEFAULT_RECIPIENT;
}

async function fetchJwe(payload, baseUrl, recipient = DEFAULT_RECIPIENT) {
  const url = new URL(payload.url, baseUrl);
  const recipientName = normalizedRecipient(recipient);
  const direct = (payload.flag || "").includes("U");
  if (direct) {
    url.searchParams.set("recipient", recipientName);
    const r = await fetch(url.toString());
    if (!r.ok) throw new Error(`SHL file fetch failed: ${r.status}`);
    return (await r.text()).trim();
  }
  // manifest mode
  const r = await fetch(url.toString(), {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ recipient: recipientName }),
  });
  if (!r.ok) throw new Error(`SHL manifest fetch failed: ${r.status}`);
  const manifest = await r.json();
  const file = (manifest.files || [])[0];
  if (!file) throw new Error("SHL manifest had no files");
  if (file.embedded) return String(file.embedded).trim();
  const fr = await fetch(new URL(file.location, baseUrl).toString());
  if (!fr.ok) throw new Error(`SHL location fetch failed: ${fr.status}`);
  return (await fr.text()).trim();
}

/** Resolve a SHL payload to its decrypted FHIR Bundle (parsed JSON). */
export async function resolveShl(payload, baseUrl, recipient = DEFAULT_RECIPIENT) {
  const jwe = await fetchJwe(payload, baseUrl, recipient);
  const key = bytesFromB64u(payload.key);
  const plaintext = await decryptCompact(jwe, key);
  return { bundle: JSON.parse(plaintext), label: payload.label || null };
}
