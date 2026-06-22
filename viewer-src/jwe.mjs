/**
 * jwe.mjs — minimal SMART Health Link crypto: compact JWE with direct key
 * management (alg "dir") and A256GCM, per the SHL spec, including optional
 * payload compression with raw DEFLATE (header "zip":"DEF"). Uses WebCrypto +
 * CompressionStream only, so it runs unchanged in the browser (viewer) and in
 * bun (the encrypt build step).
 */
const enc = new TextEncoder();
const dec = new TextDecoder();
const subtle = globalThis.crypto.subtle;

export function b64uFromBytes(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function bytesFromB64u(b64u) {
  const s = atob(b64u.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
const b64uFromStr = (str) => b64uFromBytes(enc.encode(str));

async function pipe(bytes, mode) {
  const stream = mode === "deflate" ? new CompressionStream("deflate-raw") : new DecompressionStream("deflate-raw");
  const w = stream.writable.getWriter();
  w.write(bytes); w.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}
const deflateRaw = (bytes) => pipe(bytes, "deflate");
const inflateRaw = (bytes) => pipe(bytes, "inflate");

async function importKey(keyBytes) {
  if (keyBytes.length !== 32) throw new Error(`A256GCM key must be 32 bytes, got ${keyBytes.length}`);
  return subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/**
 * Encrypt a UTF-8 string into a compact JWE string. key = 32 raw bytes.
 * opts.deflate (default true) compresses the payload with raw DEFLATE and sets
 * the JWE "zip":"DEF" header, as the SMART Health Links spec describes.
 */
export async function encryptCompact(plaintext, keyBytes, opts = {}) {
  const deflate = opts.deflate !== false;
  const contentType = opts.contentType || "application/fhir+json";
  const key = await importKey(keyBytes);
  const header = { alg: "dir", enc: "A256GCM", ...(deflate ? { zip: "DEF" } : {}), cty: contentType };
  const protectedB64 = b64uFromStr(JSON.stringify(header));
  let payload = enc.encode(plaintext);
  if (deflate) payload = await deflateRaw(payload);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ctAndTag = new Uint8Array(await subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: enc.encode(protectedB64), tagLength: 128 }, key, payload,
  ));
  const ct = ctAndTag.slice(0, ctAndTag.length - 16);
  const tag = ctAndTag.slice(ctAndTag.length - 16);
  return [protectedB64, "", b64uFromBytes(iv), b64uFromBytes(ct), b64uFromBytes(tag)].join(".");
}

/** Decrypt a compact JWE string into a UTF-8 string. Handles "zip":"DEF". */
export async function decryptCompact(jwe, keyBytes) {
  const [protectedB64, , ivB64, ctB64, tagB64] = jwe.trim().split(".");
  if (!protectedB64 || !ivB64 || !ctB64 || tagB64 == null) throw new Error("malformed compact JWE");
  const header = JSON.parse(dec.decode(bytesFromB64u(protectedB64)));
  const key = await importKey(keyBytes);
  const iv = bytesFromB64u(ivB64), ct = bytesFromB64u(ctB64), tag = bytesFromB64u(tagB64);
  const data = new Uint8Array(ct.length + tag.length);
  data.set(ct); data.set(tag, ct.length);
  let plain = new Uint8Array(await subtle.decrypt(
    { name: "AES-GCM", iv, additionalData: enc.encode(protectedB64), tagLength: 128 }, key, data,
  ));
  if (header.zip === "DEF") plain = await inflateRaw(plain);
  return dec.decode(plain);
}
