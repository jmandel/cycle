/**
 * app2.jsx — view2 entry point. Reuses the existing, unmodified data layer
 * (shl.mjs to resolve a SMART Health Link, transform.mjs to turn the decrypted
 * FHIR Bundle into daily records) and feeds it through view2's binary-first
 * derive() + Summary2 presentation. The original viewer is left untouched.
 */
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import Summary2 from "./summary2.jsx";
import { transformBundle } from "../transform.mjs";
import { derive } from "./derive.mjs";
import { DEFAULT_RECIPIENT, extractShlinkURI, parseShlink, resolveShl, shlinkFromPayload } from "../shl.mjs";

function assetUrl(name) {
  const script = [...document.scripts].reverse().find((s) => /\/app\.js($|\?)/.test(s.src || ""));
  return new URL(name, script?.src ? new URL("./", script.src).toString() : document.baseURI).toString();
}

function Landing({ text, onText, recipient, onRecipient, onOpen, onDemo, msg }) {
  return (
    <div className="l2"><style>{CSS}</style>
      <div className="l2-card">
        <h1>Menstrual summary <span>· view2</span></h1>
        <p>A clinician view that leads with the <b>derived</b> cycle picture — computed in your browser from the universal core (calendar date + bleeding yes/no). App-specific layers (flow, pain, symptoms, temperature) are shown only when present.</p>
        {msg ? <div className="l2-msg">{msg}</div> : null}
        <label className="l2-f"><span>Your name</span>
          <input value={recipient} placeholder={DEFAULT_RECIPIENT} onChange={(e) => onRecipient(e.target.value)} /></label>
        <label className="l2-f"><span>SMART Health Link</span>
          <input className="l2-link" value={text} placeholder="shlink:/… or a viewer URL" autoCapitalize="none" autoCorrect="off" spellCheck={false}
            onChange={(e) => onText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) onOpen(text.trim()); }} /></label>
        <div className="l2-row">
          <button className="l2-btn l2-btn--p" disabled={!text.trim()} onClick={() => onOpen(text.trim())}>Open link</button>
          <button className="l2-btn" onClick={onDemo}>Load synthetic demo</button>
        </div>
        <p className="l2-foot">Nothing is uploaded; the link's key never leaves this device. <a href="https://cycle.fhir.me/">Period Tracking MVP IG</a></p>
      </div>
    </div>
  );
}

function App() {
  const [state, setState] = useState({ status: "choose" });
  const [text, setText] = useState("");
  const [recipient, setRecipient] = useState(DEFAULT_RECIPIENT);

  function setFragment(uri) {
    if (!uri || location.hash === `#${uri}`) return;
    const u = new URL(location.href); u.search = ""; u.hash = uri; history.replaceState({}, "", u.toString());
  }
  async function resolvePayload(payload, uri) {
    try {
      setState({ status: "loading" });
      if (uri) setFragment(uri);
      const { bundle } = await resolveShl(payload, document.baseURI, recipient.trim() || DEFAULT_RECIPIENT);
      const vm = transformBundle(bundle, { rangeEnd: "2026-06-21" });
      setState({ status: "ok", data: derive(vm), bundle });
    } catch (e) { setState({ status: "error", error: String(e?.message || e) }); }
  }
  function open(t) {
    const uri = extractShlinkURI(t);
    if (!uri) { setState({ status: "choose", msg: "That doesn't look like a SMART Health Link (it should contain shlink:/…)." }); return; }
    resolvePayload(parseShlink(uri), uri);
  }
  async function demo() {
    try {
      const r = await fetch(assetUrl("shlink.txt"));
      if (!r.ok) throw new Error("demo link (shlink.txt) not available next to this page");
      const payload = parseShlink(await r.text());
      if (!payload) throw new Error("demo shlink.txt did not contain shlink:/");
      payload.url = assetUrl("example.jwe");
      setText(shlinkFromPayload(payload));
      setState({ status: "choose" });
    } catch (e) { setState({ status: "error", error: String(e?.message || e) }); }
  }

  useEffect(() => {
    const uri = extractShlinkURI(location.hash);
    if (uri) { setFragment(uri); setText(uri); }
    setState({ status: "choose" });
  }, []);

  if (state.status === "ok") return <Summary2 data={state.data} />;
  if (state.status === "loading") return <Center>Decrypting SMART Health Link…</Center>;
  if (state.status === "error") return <Center><b>Could not render this link.</b><br />{state.error}<br /><br /><button className="l2-btn" onClick={() => setState({ status: "choose" })}>Back</button></Center>;
  return <Landing text={text} onText={setText} recipient={recipient} onRecipient={setRecipient} onOpen={open} onDemo={demo} msg={state.msg} />;
}

const Center = ({ children }) => (<div className="l2"><style>{CSS}</style><div className="l2-card" style={{ textAlign: "center" }}>{children}</div></div>);

const CSS = `
.l2{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:#f4f6f9;font-family:'Inter',system-ui,sans-serif;color:#16212e}
.l2-card{background:#fff;border:1px solid #e3e8ee;border-radius:14px;max-width:540px;width:100%;padding:26px 28px;box-shadow:0 12px 40px rgba(15,25,40,.07)}
.l2-card h1{font:700 21px 'Schibsted Grotesk',sans-serif;margin:0 0 10px}
.l2-card h1 span{color:#9aa7b5;font-weight:500}
.l2-card p{font-size:14px;line-height:1.55;color:#3c4a5a;margin:0 0 14px}
.l2-msg{background:#fdf0d6;border:1px solid #ecd29a;color:#7a5a12;border-radius:8px;padding:9px 12px;font-size:13px;margin:0 0 12px}
.l2-f{display:flex;flex-direction:column;gap:5px;margin:0 0 11px}
.l2-f span{font:600 12px 'Inter';color:#5d6b7c}
.l2-f input{border:1px solid #ced6df;border-radius:8px;padding:9px 12px;font:13px 'Inter';color:#16212e}
.l2-f input.l2-link{font:13px 'IBM Plex Mono',monospace}
.l2-f input:focus{outline:2px solid #2b4a7a;border-color:#2b4a7a}
.l2-row{display:flex;gap:9px;margin-top:3px}
.l2-btn{font:500 13px 'Inter';color:#16212e;background:#fff;border:1px solid #ced6df;border-radius:8px;padding:9px 15px;cursor:pointer;flex:1}
.l2-btn:hover{border-color:#7c8898}
.l2-btn--p{background:#2b4a7a;color:#fff;border-color:#2b4a7a;flex:none}
.l2-btn--p:disabled{opacity:.5;cursor:default}
.l2-foot{margin:16px 0 0;font-size:12px;color:#7c8898}
.l2-foot a{color:#2b4a7a}
`;

createRoot(document.getElementById("root")).render(<App />);
