/**
 * summary.jsx — view2's presentation. A fresh take that follows the DevDays
 * principle literally:
 *   1. Lead with the DERIVED clinical metrics (the "bulk of meaning"), computed
 *      from (date, bleeding) — not with the raw calendar.
 *   2. Qualify everything by coverage/confidence.
 *   3. The calendar is supporting EVIDENCE, placed below the metrics.
 *   4. Layers (flow/pain/symptoms/BBT) are presence-gated overlays — panels
 *      appear only when the app sent them; the view never looks broken without.
 *   5. Predictions are labelled predictions, never observed facts.
 *   6. Derivation parameters are shown, so every number is auditable.
 */
import React from "react";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const toDate = (s) => new Date(s + "T00:00:00Z");
const diffDays = (a, b) => Math.round((toDate(b) - toDate(a)) / 86400000);
const addDays = (s, n) => { const d = toDate(s); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const fmt = (s, yr) => { if (!s) return "—"; const [y, m, d] = s.split("-"); return `${MON[+m - 1]} ${+d}${yr ? ` ${y}` : ""}`; };

const FLOW_BG = { 1: "#f4c4d2", 2: "#e88aa3", 3: "#cf4f74", 4: "#9e123f" };
const CLASS_TONE = { normal: "ok", regular: "ok", frequent: "warn", infrequent: "warn", irregular: "warn", prolonged: "warn", insufficient: "mut" };

function Badge({ tone, children }) { return <span className={`v2-badge v2-${tone || "mut"}`}>{children}</span>; }

function Metric({ label, value, unit, sub, badge, predicted }) {
  return (
    <div className={`v2-metric${predicted ? " v2-metric--pred" : ""}`}>
      <div className="v2-metric-l">{label}{predicted ? <span className="v2-pred-tag">predicted</span> : null}</div>
      <div className="v2-metric-v">{value}{unit ? <span className="v2-metric-u"> {unit}</span> : null}</div>
      <div className="v2-metric-s">{badge ? <Badge tone={CLASS_TONE[badge]}>{badge}</Badge> : null}{sub ? <span className="v2-metric-sub">{sub}</span> : null}</div>
    </div>
  );
}

/* One cycle as a day-of-cycle row, left-aligned at day 1 so length & onset
   alignment read at a glance. Cells encode the binary core; flow only shades. */
function CycleRow({ cycle, byDate, spottingDates, today, prediction }) {
  const len = cycle.length || (diffDays(cycle.onset, today) + 1);
  const cells = [];
  for (let k = 0; k < len; k++) {
    const date = addDays(cycle.onset, k);
    const rec = byDate[date] || {};
    const bleeding = rec.bleeding === true;
    const tracked = rec.bleeding != null || rec.flow != null;
    const imb = spottingDates.has(date);
    let cls = "v2-cell";
    let style = {};
    if (bleeding) { cls += imb ? " v2-cell--imb" : " v2-cell--bleed"; if (!imb && rec.flow) style.background = FLOW_BG[rec.flow]; }
    else if (tracked) cls += " v2-cell--dry";
    else cls += " v2-cell--gap";
    if (k === 0) cls += " v2-cell--d1";
    cells.push(<span key={date} className={cls} style={style} title={`${fmt(date, true)}${bleeding ? (imb ? " · intermenstrual" : " · bleeding") : tracked ? " · no bleeding" : " · not tracked"}${rec.flow ? ` · flow ${rec.flow}/4` : ""}`} />);
  }
  if (cycle.ongoing && prediction) {
    const k = diffDays(cycle.onset, prediction.onset);
    if (k >= len) { for (let j = len; j < k; j++) cells.push(<span key={`p${j}`} className="v2-cell v2-cell--future" />); cells.push(<span key="pred" className="v2-cell v2-cell--pred" title={`Predicted next onset ${fmt(prediction.onset, true)}`} />); }
  }
  return (
    <div className="v2-row">
      <div className="v2-row-l">
        <span className="v2-row-idx">{cycle.ongoing ? "now" : `C${cycle.idx}`}</span>
        <span className="v2-row-onset">{fmt(cycle.onset)}</span>
        <span className="v2-row-len">{cycle.length ? `${cycle.length}d` : "ongoing"}{cycle.postIUD ? " · post-IUD" : ""}</span>
      </div>
      <div className="v2-row-cells">{cells}</div>
    </div>
  );
}

function LayerChips({ layers }) {
  const order = [["flow", "Flow / volume"], ["pain", "Pain"], ["symptoms", "Symptoms"], ["bbt", "Basal temp"]];
  return (
    <div className="v2-chips">
      <span className="v2-chips-l">Layers in this export:</span>
      {order.map(([k, lbl]) => <span key={k} className={`v2-chip ${layers[k].present ? "v2-chip--on" : "v2-chip--off"}`}>{lbl}{layers[k].present ? "" : " · not provided"}</span>)}
    </div>
  );
}

function LayerPanels({ layers }) {
  const panels = [];
  if (layers.flow.present) panels.push(
    <div key="flow" className="v2-panel">
      <h4>Flow <span className="v2-panel-tag">characterises bleeding</span></h4>
      <p>{layers.flow.heavyDays} day{layers.flow.heavyDays === 1 ? "" : "s"} rated heavy. Peak per cycle: {layers.flow.peakByCycle.map((p, i) => <span key={i} className="v2-spark" style={{ background: FLOW_BG[p] || "#e6ebf0" }} title={`Cycle ${i + 1}: peak ${p}/4`} />)}</p>
      <p className="v2-panel-note">{layers.flow.note}</p>
    </div>);
  if (layers.pain.present) panels.push(
    <div key="pain" className="v2-panel">
      <h4>Pain <span className="v2-panel-tag">layer</span></h4>
      <p>Peak {layers.pain.peak}/10 · typical menses pain {layers.pain.mensesMedian ?? "—"}/10 · {layers.pain.days} day(s) logged.</p>
    </div>);
  if (layers.symptoms.present) panels.push(
    <div key="sym" className="v2-panel">
      <h4>Symptoms <span className="v2-panel-tag">layer</span></h4>
      <p>{Object.entries(layers.symptoms.catalog).map(([k, n]) => <span key={k} className="v2-tag">{k} <b>{n}</b></span>)}</p>
    </div>);
  if (layers.bbt.present) panels.push(
    <div key="bbt" className="v2-panel">
      <h4>Basal body temperature <span className="v2-panel-tag">layer</span></h4>
      <p>{layers.bbt.days} reading(s). <span className="v2-panel-note">{layers.bbt.note}</span></p>
    </div>);
  return panels.length ? <div className="v2-panels">{panels}</div> : null;
}

export default function Summary2({ data }) {
  const c = data.core, m = c.metrics, cl = c.classification, cov = data.coverage;
  const spottingDates = new Set(c.spotting.flatMap((s) => s.days));
  const months = Math.max(1, Math.round(cov.spanDays / 30.44));
  const pct = Math.round(cov.fraction * 100);
  const lowN = m.completeCycles < 3;

  // headline sentence — the bulk of meaning, in plain language
  const head = [];
  head.push(`Over ~${months} month${months === 1 ? "" : "s"} of tracking (${pct}% of days logged), `);
  head.push(<b key="cc">{m.completeCycles} complete cycle{m.completeCycles === 1 ? "" : "s"}</b>);
  if (m.cycleMedian != null) head.push(<span key="cm">. Median cycle <b>{m.cycleMedian} days</b> ({m.cycleMin}–{m.cycleMax}, {cl.regularity})</span>);
  if (m.durMedian != null) head.push(<span key="du">; bleeding lasts a median of <b>{m.durMedian} days</b></span>);
  head.push(<span key="lmp">. Last period began <b>{fmt(c.lmp, true)}</b>{c.daysSinceLmp != null ? ` — ${c.daysSinceLmp} days ago` : ""}{c.bleedingToday ? " (bleeding today)" : ""}.</span>);

  return (
    <div className="v2"><style>{CSS}</style>
      <div className="v2-wrap">
        <header className="v2-head">
          <div>
            <h1>Menstrual summary</h1>
            <div className="v2-src">{data.sources.length ? data.sources.join(", ") : "tracking app"} · derived from the universal core (date + bleeding)</div>
          </div>
          <div className="v2-asof">as of {fmt(data.today, true)}</div>
        </header>

        <p className="v2-lede">{head}</p>

        {/* CORE metrics — computed from (date, bleeding) alone */}
        <div className="v2-core-label">Core — from bleeding + date <span>universal across apps</span></div>
        <div className="v2-metrics">
          <Metric label="Cycle length" value={m.cycleMedian ?? "—"} unit={m.cycleMedian != null ? "d median" : ""} badge={m.cycleMedian != null ? cl.frequency : null} sub={m.cycleMedian != null ? `${m.cycleMin}–${m.cycleMax} d` : "needs ≥2 cycles"} />
          <Metric label="Regularity" value={cl.regularity === "insufficient" ? "—" : cl.regularity} badge={cl.regularity === "insufficient" ? null : cl.regularity} sub={m.variation != null ? `${m.variation} d shortest→longest` : "needs ≥3 onsets"} />
          <Metric label="Bleeding duration" value={m.durMedian ?? "—"} unit={m.durMedian != null ? "d median" : ""} badge={cl.duration} sub={m.durMedian != null ? `${m.durMin}–${m.durMax} d` : null} />
          <Metric label="Last period (LMP)" value={fmt(c.lmp)} sub={c.daysSinceLmp != null ? `${c.daysSinceLmp} d ago` : null} />
          {c.prediction ? <Metric predicted label="Next period" value={fmt(c.prediction.onset)} sub={c.prediction.daysUntil >= 0 ? `in ${c.prediction.daysUntil} d` : `overdue ${-c.prediction.daysUntil} d`} /> : null}
        </div>

        {c.flags.length ? <div className="v2-flags">{c.flags.map((f, i) => <span key={i} className={`v2-flag v2-flag--${f.kind.includes("amenorrhea") ? "hi" : "mid"}`}>{f.text}</span>)}</div> : null}

        <div className="v2-conf">
          Based on <b>{m.completeCycles} complete cycle{m.completeCycles === 1 ? "" : "s"}</b> ({m.mensesCount} menses, {m.bleedingDays} bleeding days) over {cov.spanDays} days · {cov.trackedDays}/{cov.spanDays} days tracked ({pct}%) · longest untracked gap {cov.longestGap} d.
          {lowN ? <span className="v2-conf-warn"> Few cycles — interpret central tendency cautiously.</span> : null}
        </div>

        {/* EVIDENCE — the calendar, below the metrics */}
        <h3 className="v2-sec">Cycle timeline <span>each row a cycle, aligned at day 1 — supporting evidence</span></h3>
        <div className="v2-timeline">
          {c.cycles.map((cy) => <CycleRow key={cy.onset} cycle={cy} byDate={data.byDate} spottingDates={spottingDates} today={data.today} prediction={c.prediction} />)}
        </div>
        <div className="v2-legend">
          <span><i className="v2-cell v2-cell--bleed v2-cell--d1" /> day 1</span>
          <span><i className="v2-cell v2-cell--bleed" /> bleeding</span>
          <span><i className="v2-cell v2-cell--imb" /> intermenstrual</span>
          <span><i className="v2-cell v2-cell--dry" /> tracked, none</span>
          <span><i className="v2-cell v2-cell--gap" /> not tracked</span>
          <span><i className="v2-cell v2-cell--pred" /> predicted</span>
          {data.layers.flow.present ? <span className="v2-legend-flow">flow:{[1, 2, 3, 4].map((l) => <i key={l} className="v2-cell" style={{ background: FLOW_BG[l] }} />)}</span> : null}
        </div>

        {/* LAYERS — optional overlays, presence-gated */}
        <h3 className="v2-sec">App-specific layers <span>heterogeneous; refine but never define the core</span></h3>
        <LayerChips layers={data.layers} />
        <LayerPanels layers={data.layers} />

        <footer className="v2-foot">
          <details>
            <summary>How these numbers were derived</summary>
            <p>Computed entirely from the universal core (calendar date + bleeding yes/no). A bleeding <em>episode</em> merges bleeding days up to {data.params.intraEpisodeGapDays} non-bleeding day apart; an episode under {data.params.minMensesDays} days is treated as spotting (intermenstrual), not a menses onset. Cycle length is onset-to-onset. Frequency: normal {data.params.freqNormalLow}–{data.params.freqNormalHigh} d. Duration normal ≤{data.params.durNormalHigh} d. Regular if shortest→longest variation ≤{data.params.regularVariationDays} d. No menses ≥{data.params.amenorrheaDays} d (on adequate tracking) flags possible amenorrhea. Thresholds follow FIGO/ACOG normal menstrual parameters.</p>
          </details>
          <p className="v2-foot-note">Patient-generated data, not clinically attested. Cycle figures and the next-period estimate are computed by this viewer; the estimate is a prediction, not a recorded fact.</p>
        </footer>
      </div>
    </div>
  );
}

const CSS = `
.v2{background:#f4f6f9;min-height:100vh;font-family:'Inter',system-ui,sans-serif;color:#16212e;padding:0 0 60px}
.v2-wrap{max-width:980px;margin:0 auto;padding:24px 22px}
.v2-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;border-bottom:1px solid #e3e8ee;padding-bottom:14px}
.v2-head h1{font:700 23px 'Schibsted Grotesk',sans-serif;margin:0}
.v2-src{font-size:12.5px;color:#5d6b7c;margin-top:3px}
.v2-asof{font:600 12px 'IBM Plex Mono',monospace;color:#5d6b7c;white-space:nowrap}
.v2-lede{font-size:16px;line-height:1.55;color:#22303f;margin:18px 0 22px}
.v2-core-label{font:700 11px 'Inter';letter-spacing:.06em;text-transform:uppercase;color:#8a4b63;display:flex;align-items:center;gap:8px;margin:0 0 10px}
.v2-core-label span{font-weight:500;letter-spacing:0;text-transform:none;color:#9aa7b5;font-size:11px}
.v2-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.v2-metric{background:#fff;border:1px solid #e3e8ee;border-radius:11px;padding:13px 14px}
.v2-metric--pred{border-style:dashed;border-color:#b9c6d6;background:#fbfcfe}
.v2-metric-l{font:600 11.5px 'Inter';color:#5d6b7c;display:flex;align-items:center;gap:6px}
.v2-pred-tag{font:600 9px 'Inter';text-transform:uppercase;letter-spacing:.05em;color:#7585a3;background:#eef1f7;border-radius:4px;padding:1px 5px}
.v2-metric-v{font:700 27px 'Schibsted Grotesk',sans-serif;margin:4px 0 5px;line-height:1}
.v2-metric-u{font:500 13px 'Inter';color:#7a8696}
.v2-metric-s{display:flex;align-items:center;gap:7px;min-height:18px}
.v2-metric-sub{font-size:11.5px;color:#7a8696}
.v2-badge{font:600 11px 'Inter';padding:1px 8px;border-radius:20px;text-transform:capitalize}
.v2-ok{background:#e3f3e9;color:#216c41}.v2-warn{background:#fbedd2;color:#8a5a12}.v2-mut{background:#eceff3;color:#6b7888}
.v2-flags{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0 0}
.v2-flag{font-size:12.5px;padding:5px 11px;border-radius:8px;border:1px solid}
.v2-flag--hi{background:#fbe6e3;border-color:#f0bdb5;color:#9e2418}
.v2-flag--mid{background:#fbf3e0;border-color:#ecd9a8;color:#7a5a12}
.v2-conf{font-size:12.5px;color:#5d6b7c;background:#fff;border:1px solid #e3e8ee;border-radius:9px;padding:10px 13px;margin:14px 0 0;line-height:1.5}
.v2-conf-warn{color:#8a5a12}
.v2-sec{font:700 14px 'Schibsted Grotesk',sans-serif;margin:30px 0 12px;display:flex;align-items:baseline;gap:10px}
.v2-sec span{font:500 12px 'Inter';color:#9aa7b5}
.v2-timeline{background:#fff;border:1px solid #e3e8ee;border-radius:11px;padding:12px 14px;overflow-x:auto}
.v2-row{display:flex;align-items:center;gap:12px;padding:3px 0}
.v2-row-l{display:flex;gap:8px;align-items:baseline;width:165px;flex:none}
.v2-row-idx{font:700 12px 'IBM Plex Mono',monospace;color:#8a4b63;width:30px}
.v2-row-onset{font:600 12px 'Inter';color:#22303f;width:46px}
.v2-row-len{font-size:11px;color:#8a96a4;white-space:nowrap}
.v2-row-cells{display:flex;gap:2px}
.v2-cell{width:11px;height:18px;border-radius:2px;background:#eef1f5;display:inline-block;flex:none;box-sizing:border-box}
.v2-cell--bleed{background:#c0335c}
.v2-cell--imb{background:#e6a416}
.v2-cell--dry{background:#e7ecf1}
.v2-cell--gap{background:repeating-linear-gradient(45deg,#fff,#fff 2px,#eef1f5 2px,#eef1f5 4px);border:1px solid #eef1f5}
.v2-cell--future{background:#f4f6f9}
.v2-cell--d1{box-shadow:inset 0 0 0 2px #15202e}
.v2-cell--pred{background:#fff;border:1.5px dashed #9aa7b5}
.v2-legend{display:flex;flex-wrap:wrap;gap:14px;margin:10px 2px 0;font-size:11.5px;color:#6b7888;align-items:center}
.v2-legend span{display:flex;align-items:center;gap:5px}
.v2-legend .v2-cell{width:12px;height:12px}
.v2-legend-flow{gap:2px!important}.v2-legend-flow .v2-cell{width:10px;height:10px;border-radius:2px}
.v2-chips{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 4px}
.v2-chips-l{font-size:12.5px;color:#5d6b7c;margin-right:2px}
.v2-chip{font:600 11.5px 'Inter';padding:3px 10px;border-radius:20px}
.v2-chip--on{background:#e9eef6;color:#2b4a7a}
.v2-chip--off{background:#f1f3f6;color:#a7b2bf}
.v2-panels{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-top:12px}
.v2-panel{background:#fff;border:1px solid #e3e8ee;border-radius:11px;padding:12px 14px}
.v2-panel h4{font:700 13px 'Inter';margin:0 0 7px;display:flex;align-items:center;gap:8px}
.v2-panel-tag{font:500 10px 'Inter';text-transform:uppercase;letter-spacing:.04em;color:#9aa7b5}
.v2-panel p{font-size:12.5px;color:#3c4a5a;margin:0 0 5px;line-height:1.5}
.v2-panel-note{color:#8a96a4;font-size:11.5px}
.v2-spark{display:inline-block;width:9px;height:14px;border-radius:2px;margin-left:2px;vertical-align:middle}
.v2-tag{display:inline-block;background:#eef1f5;border-radius:6px;padding:2px 8px;margin:0 5px 5px 0;font-size:12px;color:#3c4a5a}
.v2-foot{margin-top:28px;border-top:1px solid #e3e8ee;padding-top:14px}
.v2-foot details{font-size:12.5px;color:#5d6b7c}
.v2-foot summary{cursor:pointer;font-weight:600;color:#2b4a7a}
.v2-foot details p{line-height:1.6;margin:8px 0 0}
.v2-foot-note{font-size:11.5px;color:#9aa7b5;margin:12px 0 0;line-height:1.5}
`;
