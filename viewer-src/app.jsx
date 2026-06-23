import React, { useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import jsQR from "jsqr";
import MenstrualSummary from "./summary.jsx";
import { transformBundle } from "./transform.mjs";
import { prepare } from "./viewmodel.mjs";
import { DEFAULT_RECIPIENT, extractShlinkURI, parseShlink, resolveShl, shlinkFromPayload } from "./shl.mjs";

/* The viewer. A real SMART Health Link in the URL (#shlink:/… or ?shlink=)
   prepopulates the form. The recipient still chooses when to fetch/decrypt,
   and identifies themselves before the SHLink retrieval call is made. */

function Banner({ status, label, n, onJson }) {
  return (
    <div className="vb"><style>{CSS}</style>
      <div className="vb-in">
        <div className="vb-l">
          <span className="vb-dot" data-s={status} />
          <span className="vb-title">Period Tracking MVP · clinician viewer</span>
          <span className="vb-sub">{label || "SMART Health Link"}</span>
        </div>
        <div className="vb-r">
          {status === "ok" ? <button className="vb-btn" onClick={onJson} title="Open the decrypted FHIR Bundle as formatted JSON in a new tab">View FHIR JSON</button> : null}
          {status === "ok" ? <span className="vb-pill">decrypted · {n} resources</span> : null}
          <span className="vb-note">Patient-generated data · not clinically attested</span>
        </div>
      </div>
    </div>
  );
}

function Landing({ text, onTextChange, recipient, onRecipientChange, onOpen, onDemo, onScan, msg }) {
  return (
    <div className="ld"><style>{CSS}</style>
      <div className="ld-card">
        <h1 className="ld-h">Period Tracking MVP — clinician viewer</h1>
        <p className="ld-p">
          This page renders a <b>SMART Health Link</b> for patient-generated menstrual cycle data:
          it decrypts the linked FHIR Bundle <b>in your browser</b> and shows a cycle summary.
          Nothing is uploaded; the link's key never leaves this device.
        </p>
        <p className="ld-p ld-mut">
          To view real data, open a link of the form <code>…/viewer.html#shlink:/…</code> — or use one of the options below.
        </p>
        {msg ? <div className="ld-msg">{msg}</div> : null}

        <div className="ld-actions">
          <label className="ld-field">
            <span className="ld-label">Your name</span>
            <input className="ld-in" placeholder={DEFAULT_RECIPIENT}
              value={recipient} onChange={(e) => onRecipientChange(e.target.value)} />
          </label>
          <div className="ld-row ld-row--link">
            <label className="ld-field ld-field--link">
              <span className="ld-label">Link to load</span>
              <input className="ld-in" placeholder="Paste a SMART Health Link (shlink:/… or a viewer URL)"
                value={text} onChange={(e) => onTextChange(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) onOpen(text.trim()); }} />
            </label>
            <button className="ld-btn ld-btn--p" disabled={!text.trim()} onClick={() => onOpen(text.trim())}>Open link</button>
          </div>
          <div className="ld-or"><span>or</span></div>
          <div className="ld-row ld-row--split">
            <button className="ld-btn" onClick={onScan}>📷 Scan a QR code</button>
            <button className="ld-btn" onClick={onDemo}>Load the synthetic demo</button>
          </div>
        </div>

        <p className="ld-foot">
          The demo is a synthetic seven-cycle example — not a real person. Learn more in the{" "}
          <a href="https://build.fhir.org/ig/jmandel/periodicity/">Period Tracking MVP IG</a>.
        </p>
      </div>
    </div>
  );
}

function QrScanner({ onResult, onClose }) {
  const videoRef = useRef(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let stream, raf, cancelled = false;
    const canvas = document.createElement("canvas");
    const cleanup = () => { cancelled = true; if (raf) cancelAnimationFrame(raf); if (stream) stream.getTracks().forEach((t) => t.stop()); };
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("no camera API in this browser");
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        const v = videoRef.current; if (!v) return; v.srcObject = stream; v.setAttribute("playsinline", "true"); await v.play();
        const tick = () => {
          if (cancelled) return;
          if (v.readyState === v.HAVE_ENOUGH_DATA && v.videoWidth) {
            canvas.width = v.videoWidth; canvas.height = v.videoHeight;
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
            if (code?.data && extractShlinkURI(code.data)) { cleanup(); onResult(code.data); return; }
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch (e) { setErr(String(e?.message || e)); }
    })();
    return cleanup;
  }, []);
  return (
    <div className="qr" role="dialog" aria-modal="true">
      <div className="qr-box">
        <div className="qr-head"><span>Scan a SMART Health Link QR</span><button className="qr-x" onClick={onClose} aria-label="Close">×</button></div>
        {err ? <div className="qr-err">Camera unavailable: {err}</div>
          : <video ref={videoRef} className="qr-vid" muted />}
        <div className="qr-hint">Point the camera at the QR code. Decoding happens on-device.</div>
      </div>
    </div>
  );
}

function App() {
  const [state, setState] = useState({ status: "init" });
  const [draftLink, setDraftLink] = useState("");
  const [recipient, setRecipient] = useState(DEFAULT_RECIPIENT);
  const [scanning, setScanning] = useState(false);

  function currentViewerURL() {
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    return url.toString();
  }
  function setURLFragment(shlinkURI) {
    if (!shlinkURI || window.location.hash === `#${shlinkURI}`) return;
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = shlinkURI;
    window.history.replaceState({}, "", url.toString());
  }
  function viewerPrefixedLink(shlinkURI) {
    return `${currentViewerURL()}#${shlinkURI}`;
  }
  function recipientName() {
    return recipient.trim() || DEFAULT_RECIPIENT;
  }
  function normalizeDemoLink(link) {
    const payload = parseShlink(link);
    if (!payload) throw new Error("demo shlink.txt did not contain shlink:/");
    payload.url = new URL("./example.jwe", document.baseURI).toString();
    return viewerPrefixedLink(shlinkFromPayload(payload));
  }
  async function resolvePayload(payload, shlinkURI) {
    try {
      setState({ status: "loading" });
      if (shlinkURI) setURLFragment(shlinkURI);
      const { bundle } = await resolveShl(payload, document.baseURI, recipientName());
      const vm = transformBundle(bundle, { rangeEnd: "2026-06-21" });
      setState({ status: "ok", data: prepare(vm), bundle, label: payload.label || null, n: (bundle.entry || []).length });
    } catch (e) { setState({ status: "error", error: String(e?.message || e) }); }
  }
  function openJson(bundle) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: "application/fhir+json" }));
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  function openText(text) {
    const shlinkURI = extractShlinkURI(text);
    if (!shlinkURI) { setState({ status: "choose", msg: "That doesn't look like a SMART Health Link (it should contain shlink:/…)." }); return; }
    resolvePayload(parseShlink(shlinkURI), shlinkURI);
  }
  async function loadDemo() {
    try {
      const r = await fetch(new URL("./shlink.txt", document.baseURI).toString());
      if (!r.ok) throw new Error("demo link (shlink.txt) is not available next to this page");
      setDraftLink(normalizeDemoLink(await r.text()));
      setState({ status: "choose" });
    } catch (e) { setState({ status: "error", error: String(e?.message || e) }); }
  }

  useEffect(() => {
    const queryLink = new URLSearchParams(location.search).get("shlink");
    const shlinkURI = extractShlinkURI(location.hash) || extractShlinkURI(queryLink);
    if (shlinkURI) {
      setURLFragment(shlinkURI);
      setDraftLink(viewerPrefixedLink(shlinkURI));
    }
    setState({ status: "choose" });
  }, []);

  if (state.status === "choose" || state.status === "init") {
    return (<>
      <Landing text={draftLink} onTextChange={setDraftLink} recipient={recipient} onRecipientChange={setRecipient}
        onOpen={openText} onDemo={loadDemo} onScan={() => setScanning(true)} msg={state.msg} />
      {scanning && <QrScanner onResult={(link) => { setScanning(false); setDraftLink(link); setState({ status: "choose" }); }} onClose={() => setScanning(false)} />}
    </>);
  }
  return (
    <div>
      <Banner status={state.status} label={state.label} n={state.n} onJson={() => openJson(state.bundle)} />
      {state.status === "loading" && <Center>Decrypting SMART Health Link…</Center>}
      {state.status === "error" && <Center><b>Could not render this link.</b><br />{state.error}<br /><br />
        <button className="ld-btn" onClick={() => setState({ status: "choose" })}>Back</button></Center>}
      {state.status === "ok" && <MenstrualSummary data={state.data} />}
    </div>
  );
}

const Center = ({ children }) => (
  <div style={{ maxWidth: 1040, margin: "48px auto", padding: 24, fontFamily: "Inter,system-ui,sans-serif", color: "#46566A", textAlign: "center" }}>{children}</div>
);

const CSS = `
.vb{background:#15202E;color:#fff;font-family:'Inter',system-ui,sans-serif}
.vb-in{max-width:1040px;margin:0 auto;padding:10px 20px;display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}
.vb-l{display:flex;align-items:center;gap:10px;min-width:0}
.vb-dot{width:9px;height:9px;border-radius:50%;background:#caa94a;flex:none}
.vb-dot[data-s=ok]{background:#4fb477}.vb-dot[data-s=error]{background:#d9534f}
.vb-title{font-weight:600;font-size:13px;white-space:nowrap}
.vb-sub{font-size:12px;color:#9fb0c4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vb-r{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.vb-pill{font:600 11px 'IBM Plex Mono',monospace;background:rgba(79,180,119,.18);color:#9be3b8;border:1px solid rgba(79,180,119,.4);padding:2px 8px;border-radius:20px}
.vb-btn{font:500 12px 'Inter',system-ui,sans-serif;color:#cfe0f5;background:rgba(255,255,255,.06);border:1px solid rgba(207,224,245,.35);padding:4px 11px;border-radius:7px;cursor:pointer}
.vb-btn:hover{background:rgba(255,255,255,.14);color:#fff}
.vb-note{font-size:11px;color:#7c8898}
.ld{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:#EEF1F4;font-family:'Inter',system-ui,sans-serif;color:#15202E}
.ld-card{background:#fff;border:1px solid #E1E6EC;border-radius:14px;max-width:560px;width:100%;padding:28px 30px;box-shadow:0 12px 40px rgba(15,25,40,.08)}
.ld-h{font:700 21px 'Schibsted Grotesk',sans-serif;margin:0 0 12px}
.ld-p{font-size:14px;line-height:1.55;margin:0 0 10px;color:#2b3a4d}
.ld-mut{color:#5b6b7e}
.ld-p code{background:#EEF1F4;padding:.1em .35em;border-radius:4px;font:12px 'IBM Plex Mono',monospace}
.ld-msg{background:#fdf0d6;border:1px solid #ecd29a;color:#7a5a12;border-radius:8px;padding:9px 12px;font-size:13px;margin:6px 0 14px}
.ld-actions{margin-top:18px}
.ld-field{display:flex;flex-direction:column;gap:6px;margin:0 0 10px;min-width:0}
.ld-label{font:600 12px 'Inter';color:#46566A}
.ld-row{display:flex;gap:8px}
.ld-row--link{align-items:flex-end}
.ld-row--split{gap:10px}
.ld-in{flex:1;min-width:0;border:1px solid #CED6DF;border-radius:8px;padding:9px 12px;font:13px 'Inter';color:#15202E}
.ld-in:focus{outline:2px solid #2B4A7A;outline-offset:0;border-color:#2B4A7A}
.ld-btn{font:500 13px 'Inter';color:#15202E;background:#fff;border:1px solid #CED6DF;border-radius:8px;padding:9px 14px;cursor:pointer;flex:1}
.ld-btn:hover{border-color:#7C8898}
.ld-btn--p{flex:none;background:#2B4A7A;color:#fff;border-color:#2B4A7A}
.ld-btn--p:disabled{opacity:.5;cursor:default}
.ld-field--link{flex:1;margin-bottom:0}
.ld-or{display:flex;align-items:center;text-align:center;color:#9aa7b5;font-size:12px;margin:14px 0}
.ld-or::before,.ld-or::after{content:"";flex:1;border-top:1px solid #E1E6EC}
.ld-or span{padding:0 12px}
.ld-foot{margin:20px 0 0;font-size:12px;color:#7C8898;line-height:1.5}
.ld-foot a{color:#2B4A7A}
.qr{position:fixed;inset:0;background:rgba(20,32,46,.55);display:flex;align-items:center;justify-content:center;padding:20px;z-index:60;font-family:'Inter',system-ui,sans-serif}
.qr-box{background:#fff;border-radius:12px;width:min(420px,100%);overflow:hidden}
.qr-head{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid #E1E6EC;font-weight:600;font-size:14px}
.qr-x{border:none;background:none;font-size:22px;color:#7C8898;cursor:pointer;line-height:1}
.qr-vid{width:100%;display:block;background:#000;aspect-ratio:1/1;object-fit:cover}
.qr-err{padding:24px 16px;color:#9E2418;font-size:13px;text-align:center}
.qr-hint{padding:10px 16px;font-size:12px;color:#7C8898;text-align:center}
`;

createRoot(document.getElementById("root")).render(<App />);
