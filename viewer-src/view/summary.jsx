import React, { useState } from "react";

/* ============================================================================
   Menstrual Health Summary — clinician-facing viewer (render layer)
   Adapted from the original kit viewer to consume a view model produced from a
   real FHIR Bundle (viewer-src/shared/transform.mjs -> viewmodel.mjs:prepare), instead
   of a hard-coded synthetic case. All metrics come from the data, never literals.
   ========================================================================== */

/* ---------- date helpers ---------- */
const D = (s) => new Date(s + "T00:00:00");
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = D(s); d.setDate(d.getDate() + n); return iso(d); };
const diffDays = (a, b) => Math.round((D(b) - D(a)) / 86400000);
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const fmt = (s) => { const d = D(s); return `${MONTHS[d.getMonth()]} ${d.getDate()}`; };
const fmtY = (s) => { const d = D(s); return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`; };

/* ---------- visual constants ---------- */
const FLOW = [
  { k: 0, label: "None", color: "transparent", border: "#E6EAEF" },
  { k: 1, label: "Spotting", color: "#F0D6CF", border: "#E2B6AC" },
  { k: 2, label: "Light", color: "#E09B8C", border: "#D5897A" },
  { k: 3, label: "Moderate", color: "#CC5A4B", border: "#BF4E40" },
  { k: 4, label: "Heavy", color: "#9E2418", border: "#8A1F14" },
];
const PAIN_BASE = "#2B4A7A";
const SYM_LABELS = { irritability: "Irritability", lowMood: "Low mood", headache: "Headache", bloating: "Bloating", fatigue: "Fatigue" };
const MAXDAY = 40;
const gridStyle = () => ({ gridTemplateColumns: `repeat(${MAXDAY}, minmax(0,1fr))` });

export default function MenstrualSummary({ data }) {
  const { byDate, ctx } = data;
  const [sel, setSel] = useState(null);
  const [fertOpen, setFertOpen] = useState(false);

  return (
    <div className="mh">
      <style>{CSS}</style>
      <div className="mh-shell">
        <Header m={data.m} ctx={ctx} />
        <Metrics m={data.m} />

        <section className="mh-sec">
          <SecHead label="Cycle comparison" right={<Legend />} />
          <div className="mh-panel"><CycleStrips data={data} onDay={setSel} /></div>
        </section>

        <section className="mh-sec">
          <SecHead label="By cycle" right={<span className="mh-sec-meta">{data.complete.length} complete · {data.cycles.length - data.complete.length} in progress</span>} />
          <div className="mh-panel mh-panel--flush"><CycleTable data={data} onDay={setSel} /></div>
        </section>

        <section className="mh-sec">
          <SecHead label="Bleeding & pain" right={<TimelineKey hasIud={!!ctx.iudDate} />} />
          <div className="mh-panel"><Timeline data={data} onDay={setSel} /></div>
        </section>

        <div className="mh-2col">
          <section className="mh-sec">
            <SecHead label="Symptom pattern" />
            <div className="mh-panel"><SymptomGrid data={data} /></div>
          </section>
          <section className="mh-sec mh-sec--side">
            <SecHead label="Pain" />
            <div className="mh-panel mh-panel--flush"><PainTable m={data.m} /></div>
          </section>
        </div>

        <section className="mh-sec">
          <Fertility data={data} open={fertOpen} setOpen={setFertOpen} />
        </section>
      </div>

      {sel && <DayDetail rec={byDate[sel]} date={sel} cycles={data.cycles} onClose={() => setSel(null)} />}
    </div>
  );
}

/* ---------- header / note ---------- */
function buildNote(m, ctx) {
  const lines = [
    `Menstrual cycle review — ${fmtY(ctx.spanStart)} to ${fmtY(ctx.today)} (${m.completeCycles} cycles; ${ctx.sourceApp}).`,
    `Cycle interval: median ${m.intervalMedian != null ? Math.round(m.intervalMedian) : "—"} d (range ${m.intervalMin}–${m.intervalMax}); variation ${m.variation} d.`,
    `Bleeding: median ${m.durMedian} d (range ${m.durMin}–${m.durMax}); ${m.heavyDays} heavy-rated days; intermenstrual ${m.imbDays} d; postcoital ${m.postcoital} d.`,
    `Pain: peak ${m.peakPain}/10, typical ${m.typicalMensesPain}/10 on bleeding days; activity limited ${m.funcDays} d; non-bleeding ${m.nonMenPain} d; dyspareunia ${m.dyspareunia} d; bowel-associated ${m.bowel} d.`,
  ];
  if (ctx.iudDate) lines.push(`Context: copper IUD ${fmtY(ctx.iudDate)}; heavier, longer and more painful pattern after this date.`);
  return lines.join("\n");
}

function copyText(text, done) {
  const finish = () => done();
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(finish).catch(() => fallbackCopy(text, finish));
  else fallbackCopy(text, finish);
}
function fallbackCopy(text, finish) {
  const ta = document.createElement("textarea");
  ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); } catch (e) {}
  document.body.removeChild(ta); finish();
}
function CopyButton({ text, label = "Copy note" }) {
  const [done, setDone] = useState(false);
  return (
    <button className={"mh-print" + (done ? " is-done" : "")}
      onClick={() => copyText(text, () => { setDone(true); setTimeout(() => setDone(false), 1600); })}>
      {done ? "Copied" : label}
    </button>
  );
}

function Header({ m, ctx }) {
  const meta = [
    ["Range", `${fmt(ctx.spanStart)} – ${fmt(ctx.today)}`],
    ["Cycles", `${m.completeCycles}`],
  ];
  if (ctx.iudDate) meta.push(["Copper IUD", fmt(ctx.iudDate)]);
  return (
    <header className="mh-head">
      <div className="mh-head-top">
        <h1 className="mh-title">Menstrual cycle review</h1>
        <div className="mh-head-actions">
          <CopyButton text={buildNote(m, ctx)} />
          <button className="mh-print" onClick={() => window.print()}>Print</button>
        </div>
      </div>
      <dl className="mh-meta">
        {meta.map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{v}</dd></div>))}
        <div><dt>Source</dt><dd>{ctx.sourceApp}</dd></div>
      </dl>
    </header>
  );
}

function Metrics({ m }) {
  const cells = [
    { l: "Cycle interval", v: m.intervalMedian != null ? Math.round(m.intervalMedian) : "—", u: "d med", s: `${m.intervalMin}–${m.intervalMax} · ${m.completeCycles} cyc`, t: "Reproductive-age reference often 24–38 d (FIGO)." },
    { l: "Variation", v: m.variation ?? "—", u: "d", s: `${m.intervalMin} → ${m.intervalMax} d` },
    { l: "Bleed duration", v: m.durMedian ?? "—", u: "d med", s: `${m.durMin}–${m.durMax} d`, t: "Bleeding up to ~8 d is a common upper reference." },
    { l: "Bleed impact", v: m.heavyDays, u: "heavy d", s: `${m.imbDays} IMB · ${m.postcoital} PCB` },
    { l: "Pain peak", v: `${m.peakPain}/10`, u: "", s: `${m.typicalMensesPain}/10 bleeding · ${m.funcDays} d limited` },
  ];
  return (
    <div className="mh-metrics">
      {cells.map((c) => (
        <div className="mh-metric" key={c.l}>
          <div className="mh-metric-l">{c.l}{c.t ? <span className="mh-info" title={c.t}>i</span> : null}</div>
          <div className="mh-metric-v">{c.v}{c.u ? <span>{c.u}</span> : null}</div>
          <div className="mh-metric-s">{c.s}</div>
        </div>
      ))}
    </div>
  );
}

const SecHead = ({ label, right }) => (<div className="mh-sec-head"><h2>{label}</h2>{right || null}</div>);

/* ---------- cycle strips ---------- */
function CycleStrips({ data, onDay }) {
  const { cycles, byDate } = data;
  const ruler = []; for (let d = 1; d <= MAXDAY; d++) ruler.push(d);
  return (
    <div className="mh-strips">
      <div className="mh-strip-ruler">
        <div className="mh-strip-label" />
        <div className="mh-track mh-track--ruler" style={gridStyle()}>
          {ruler.map((d) => (<span key={d} className={"mh-tick" + (d % 5 === 0 || d === 1 ? " is-major" : "")}>{d % 5 === 0 || d === 1 ? d : ""}</span>))}
        </div>
        <div className="mh-strip-end">len</div>
      </div>
      {cycles.map((c) => {
        const cap = c.length ? Math.min(c.length, MAXDAY) : Math.min(c.bleedDuration + 3, MAXDAY);
        const days = [];
        for (let i = 0; i < MAXDAY; i++) days.push({ i, date: addDays(c.start, i), rec: byDate[addDays(c.start, i)], inCycle: i < cap });
        return (
          <div className={"mh-strip" + (c.postIUD ? " is-post" : "")} key={c.start}>
            <div className="mh-strip-label">
              <span className="mh-strip-idx">C{c.idx}</span>
              <span className="mh-strip-date">{fmt(c.start)}</span>
            </div>
            <div className="mh-track-stack">
              <div className="mh-track mh-track--marks" style={gridStyle()}>
                {days.map((d) => {
                  const r = d.rec; let g = null, cls = "";
                  if (r?.intermenstrual) { g = "▾"; cls = "mark-imb"; }
                  else if (r?.painTypes?.includes("dyspareunia")) { g = "◇"; cls = "mark-dys"; }
                  else if (r?.painTypes?.includes("bowel")) { g = "◦"; cls = "mark-bow"; }
                  return <span key={d.i} className={"mh-mark " + cls}>{g}</span>;
                })}
              </div>
              <div className="mh-track mh-track--flow" style={gridStyle()}>
                {days.map((d) => {
                  const f = d.rec?.flow || 0; const spec = FLOW[f]; const active = d.rec && (d.rec.bleeding === true || d.rec.flow > 0 || d.rec._entry);
                  return (<button key={d.i} className={"mh-cell" + (d.inCycle ? "" : " is-out") + (f > 0 ? " has-flow" : "")}
                    style={f > 0 ? { background: spec.color, borderColor: spec.border } : undefined}
                    onClick={() => active && onDay(d.date)} tabIndex={active ? 0 : -1}
                    aria-label={`${fmtY(d.date)}, day ${d.i + 1}${f ? ", " + spec.label : ""}`}
                    title={d.rec ? `${fmt(d.date)} · day ${d.i + 1}${f ? " · " + spec.label : ""}` : ""} />);
                })}
              </div>
              <div className="mh-track mh-track--pain" style={gridStyle()}>
                {days.map((d) => {
                  const p = d.rec?.pain || 0;
                  return (<span key={d.i} className="mh-pain-slot" title={p ? `pain ${p}/10` : ""}>
                    {p ? <span className="mh-pain-bar" style={{ height: (18 + p * 8) + "%", background: PAIN_BASE, opacity: 0.45 + p / 20 }} /> : null}
                  </span>);
                })}
              </div>
            </div>
            <div className="mh-strip-end">{c.ongoing ? <em>—</em> : c.length ? <b>{c.length}</b> : "—"}</div>
          </div>
        );
      })}
    </div>
  );
}

function Legend() {
  return (
    <div className="mh-legend">
      {FLOW.slice(1).map((f) => (<span key={f.k} className="mh-leg-item"><span className="mh-leg-sw" style={{ background: f.color, borderColor: f.border }} />{f.label}</span>))}
      <span className="mh-leg-item"><span className="mh-leg-bar" />pain</span>
      <span className="mh-leg-item"><span className="mh-leg-glyph mark-imb">▾</span>IMB</span>
      <span className="mh-leg-item"><span className="mh-leg-glyph mark-dys">◇</span>dyspareunia</span>
    </div>
  );
}

/* ---------- per-cycle table ---------- */
function CycleTable({ data, onDay }) {
  const { cycles, byDate, ctx } = data;
  const cstat = (c) => {
    const end = c.nextStart ? addDays(c.nextStart, -1) : ctx.today;
    let heavy = 0, peak = 0, imb = 0;
    for (let dt = c.start; diffDays(dt, end) >= 0; dt = addDays(dt, 1)) {
      const r = byDate[dt]; if (!r) continue;
      if (r.flow === 4) heavy++;
      if (r.pain) peak = Math.max(peak, r.pain);
      if (r.intermenstrual) imb++;
    }
    return { heavy, peak, imb };
  };
  return (
    <table className="mh-tbl">
      <thead><tr><th>Cycle</th><th>Start</th><th>Length</th><th>Bleed</th><th>Heavy</th><th>Pain pk</th><th>IMB</th></tr></thead>
      <tbody>
        {cycles.map((c) => {
          const s = cstat(c);
          return (
            <tr key={c.start} className={c.postIUD ? "is-post" : ""} onClick={() => onDay(c.start)}>
              <td className="mh-tbl-c">C{c.idx}{c.postIUD ? <span className="mh-tbl-flag" title="after copper IUD">IUD</span> : null}</td>
              <td>{fmt(c.start)}</td>
              <td>{c.length ? c.length + " d" : <em className="mh-mut">ongoing</em>}</td>
              <td>{c.bleedDuration} d</td>
              <td className={s.heavy ? "mh-em" : "mh-z"}>{s.heavy || "·"}</td>
              <td className={s.peak >= 7 ? "mh-em" : ""}>{s.peak || "·"}</td>
              <td className={s.imb ? "mh-em" : "mh-z"}>{s.imb || "·"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ---------- timeline ---------- */
function TimelineKey({ hasIud }) {
  return (<div className="mh-legend">{hasIud ? <span className="mh-leg-item"><span className="mh-tl-dash" />IUD insertion</span> : null}<span className="mh-leg-item"><span className="mh-leg-glyph mh-g-func">▤</span>limited</span><span className="mh-leg-item"><span className="mh-leg-glyph mh-g-pc">✶</span>post-coital</span></div>);
}
function Timeline({ data, onDay }) {
  const { daily, ctx } = data;
  const PX = 5;
  const total = diffDays(ctx.spanStart, ctx.today) + 1;
  const width = total * PX;
  const xOf = (d) => diffDays(ctx.spanStart, d) * PX;
  const ticks = [];
  for (let cur = ctx.spanStart; diffDays(cur, ctx.today) >= 0; cur = addDays(cur, 1)) { if (D(cur).getDate() === 1 || cur === ctx.spanStart) ticks.push(cur); }
  return (
    <div className="mh-timeline-scroll">
      <div className="mh-timeline" style={{ width }}>
        {ticks.map((t) => (<div key={t} className="mh-tl-month" style={{ left: xOf(t) }}><span>{MONTHS[D(t).getMonth()]}</span></div>))}
        {ctx.iudDate ? (
          <div className="mh-tl-event" style={{ left: xOf(ctx.iudDate) }}>
            <span className="mh-tl-event-line" />
            <span className="mh-tl-event-label">Copper IUD {fmt(ctx.iudDate)}</span>
          </div>
        ) : null}
        <div className="mh-tl-lane">
          <span className="mh-tl-lane-cap">Bleeding</span>
          <div className="mh-tl-plot">
            {daily.filter((d) => d.bleeding === true || d.flow > 0).map((d) => { const lvl = d.flow > 0 ? d.flow : 1; const spec = FLOW[lvl]; return (
              <span key={d.date} className={"mh-tl-bar" + (d.intermenstrual ? " is-imb" : "")}
                style={{ left: xOf(d.date), height: 16 + lvl * 13, background: spec.color, borderColor: spec.border }}
                onClick={() => onDay(d.date)} title={`${fmt(d.date)} · ${d.flow > 0 ? spec.label : "bleeding"}${d.intermenstrual ? " (between episodes)" : ""}`} />); })}
          </div>
        </div>
        <div className="mh-tl-lane">
          <span className="mh-tl-lane-cap">Pain</span>
          <div className="mh-tl-plot">
            {daily.filter((d) => d.pain > 0).map((d) => (
              <span key={d.date} className="mh-tl-bar mh-tl-bar--pain"
                style={{ left: xOf(d.date), height: 9 + d.pain * 6, background: PAIN_BASE, opacity: 0.45 + d.pain / 20 }}
                onClick={() => onDay(d.date)} title={`${fmt(d.date)} · pain ${d.pain}/10`} />))}
          </div>
        </div>
        <div className="mh-tl-lane mh-tl-lane--events">
          <span className="mh-tl-lane-cap">Events</span>
          <div className="mh-tl-plot">
            {daily.filter((d) => d.functionalLimit).map((d) => (<span key={"f" + d.date} className="mh-tl-glyph mh-g-func" style={{ left: xOf(d.date) }} title={`${fmt(d.date)} · activity limited`}>▤</span>))}
            {daily.filter((d) => d.painTypes?.includes("dyspareunia")).map((d) => (<span key={"d" + d.date} className="mh-tl-glyph mh-g-dys" style={{ left: xOf(d.date) }} title={`${fmt(d.date)} · pain with sex`}>◇</span>))}
            {daily.filter((d) => d.postcoital).map((d) => (<span key={"p" + d.date} className="mh-tl-glyph mh-g-pc" style={{ left: xOf(d.date) }} title={`${fmt(d.date)} · bleeding after sex`}>✶</span>))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- symptom grid ---------- */
function SymptomGrid({ data }) {
  const { byDate, ctx } = data;
  const offsets = [-7, -6, -5, -4, -3, -2, -1, 1, 2, 3];
  const onsets = ctx.episodeStarts;
  const syms = ["irritability", "lowMood", "headache", "bloating", "fatigue"];
  const grid = {}; const colN = {};
  for (const o of offsets) colN[o] = 0;
  for (const s of syms) grid[s] = {};
  for (const onset of onsets) for (const o of offsets) {
    const date = addDays(onset, o < 0 ? o : o - 1);
    const rec = byDate[date]; if (!rec) continue;
    let any = false;
    for (const s of syms) { const v = rec.symptoms?.[s]; if (v != null) { (grid[s][o] = grid[s][o] || []).push(v); any = true; } }
    if (any || rec.symptoms) colN[o]++;
  }
  const cell = (s, o) => { const a = grid[s][o]; return a && a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; };
  return (
    <div className="mh-heat">
      <div className="mh-heat-head">
        <span className="mh-heat-rowcap" />
        {offsets.map((o) => (<span key={o} className={"mh-heat-col" + (o > 0 ? " is-menses" : "")}>{o < 0 ? o : "+" + o}</span>))}
      </div>
      {syms.map((s) => (
        <div className="mh-heat-row" key={s}>
          <span className="mh-heat-rowcap">{SYM_LABELS[s]}</span>
          {offsets.map((o) => {
            const v = cell(s, o); const has = v != null; const op = has ? 0.1 + (v / 3) * 0.82 : 0;
            return (<span key={o} className={"mh-heat-cell" + (o > 0 ? " is-menses" : "") + (has ? "" : " is-empty")}
              style={has ? { background: `rgba(43,74,122,${op})` } : undefined}
              title={has ? `${SYM_LABELS[s]} · day ${o} · ${v.toFixed(1)}/3` : "no data"}>{has ? (v >= 2.2 ? "●" : v >= 1.2 ? "◐" : "○") : "·"}</span>);
          })}
        </div>
      ))}
      <div className="mh-heat-foot">
        <span className="mh-heat-rowcap">n cycles</span>
        {offsets.map((o) => (<span key={o} className="mh-heat-col mh-heat-n">{colN[o]}</span>))}
      </div>
      <div className="mh-heat-axis"><span>← before bleeding</span><span>bleeding →</span></div>
    </div>
  );
}

/* ---------- pain table ---------- */
function PainTable({ m }) {
  const rows = [
    ["Peak", `${m.peakPain}/10`], ["Typical (bleeding)", `${m.typicalMensesPain}/10`],
    ["Painful days", `${m.painEntryDays}`], ["Activity limited", `${m.funcDays} d`],
    ["Non-bleeding", `${m.nonMenPain} d`], ["With sex", `${m.dyspareunia} d`], ["Bowel-associated", `${m.bowel} d`],
  ];
  return <KV rows={rows} />;
}
const KV = ({ rows }) => (<table className="mh-kv"><tbody>{rows.map(([k, v]) => (<tr key={k}><th>{k}</th><td>{v}</td></tr>))}</tbody></table>);

/* ---------- fertility ---------- */
function Fertility({ data, open, setOpen }) {
  const { daily } = data;
  const bbt = daily.filter((d) => d.bbt != null).sort((a, b) => (a.date < b.date ? -1 : 1));
  const lh = daily.filter((d) => d.lh); const mucus = daily.filter((d) => d.mucus);
  if (!bbt.length && !lh.length && !mucus.length) return null;
  const temps = bbt.map((b) => b.bbt); const lo = temps.length ? Math.min(...temps) : 0, hi = temps.length ? Math.max(...temps) : 1;
  const W = 560, H = 70, pad = 6; const x0 = bbt.length ? diffDays(bbt[0].date, bbt[bbt.length - 1].date) || 1 : 1;
  const pts = bbt.map((b) => ({ x: pad + (diffDays(bbt[0].date, b.date) / x0) * (W - pad * 2), y: H - pad - ((b.bbt - lo) / (hi - lo || 1)) * (H - pad * 2), b }));
  return (
    <div className={"mh-fert" + (open ? " is-open" : "")}>
      <button className="mh-fert-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="mh-fert-cap">Fertility observations</span>
        <span className="mh-fert-meta">{bbt.length} BBT · {lh.length} LH · {mucus.length} mucus</span>
        <span className="mh-fert-caret">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="mh-fert-body">
          {bbt.length ? (
            <svg className="mh-spark" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Basal body temperature">
              <polyline points={pts.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={PAIN_BASE} strokeWidth="1.4" opacity="0.8" />
              {pts.map((p, i) => (<circle key={i} cx={p.x} cy={p.y} r="2.3" fill={p.b.lh ? "#9E2418" : PAIN_BASE} />))}
            </svg>
          ) : null}
          <div className="mh-fert-rows">
            {bbt.length ? <span>BBT {lo.toFixed(2)}–{hi.toFixed(2)} °C</span> : null}
            <span>LH+ {lh.map((d) => fmt(d.date)).join(", ") || "none"}</span>
            <span>Mucus {mucus.length} d</span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- day detail ---------- */
function DayDetail({ rec, date, cycles, onClose }) {
  const cyc = cycles.find((c) => diffDays(c.start, date) >= 0 && (!c.nextStart || diffDays(date, c.nextStart) > 0));
  const cd = cyc ? diffDays(cyc.start, date) + 1 : null;
  const f = rec?.flow ? FLOW[rec.flow] : null;
  const bleedingText = rec?.bleeding === true ? (f ? f.label : "yes") : rec?.bleeding === false || rec?.flow === 0 ? "none" : null;
  return (
    <div className="mh-modal" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="mh-day" onClick={(e) => e.stopPropagation()}>
        <div className="mh-day-head">
          <div>
            <div className="mh-day-date">{fmtY(date)}</div>
            {cd ? <div className="mh-day-cd">Cycle {cyc.idx} · day {cd}</div> : null}
          </div>
          <button className="mh-day-x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <dl className="mh-day-list">
          {bleedingText ? <Row k={rec?.intermenstrual ? "Bleeding (IMB)" : "Bleeding"} v={bleedingText} /> : null}
          {rec?.pain != null ? <Row k="Pelvic pain" v={`${rec.pain}/10`} /> : null}
          {rec?.painTypes?.length ? <Row k="Pain type" v={rec.painTypes.join(", ")} /> : null}
          {rec?.functionalLimit ? <Row k="Function" v="activity limited" /> : null}
          {rec?.postcoital ? <Row k="After sex" v="spotting" /> : null}
          {rec?.sex ? <Row k="Sexual activity" v="yes" /> : null}
          {rec?.symptoms ? <Row k="Symptoms" v={Object.entries(rec.symptoms).map(([k, v]) => `${SYM_LABELS[k] || k} ${v}/3`).join(", ")} /> : null}
          {rec?.bbt ? <Row k="Basal temp" v={`${rec.bbt} °C`} /> : null}
          {rec?.mucus ? <Row k="Cervical mucus" v={String(rec.mucus)} /> : null}
          {rec?.lh ? <Row k="LH test" v="positive" /> : null}
          {rec?.note ? <Row k="Note" v={`“${rec.note}”`} /> : null}
        </dl>
      </div>
    </div>
  );
}
const Row = ({ k, v }) => (<div className="mh-day-row"><dt>{k}</dt><dd>{v}</dd></div>);

/* ============================================================================ styles */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@500;600;700&family=Inter:wght@400;450;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
.mh{--paper:#EEF1F4;--surface:#FFFFFF;--surface-2:#F7F9FB;--line:#E1E6EC;--line-2:#CED6DF;--grid:#EAEEF2;--ink:#15202E;--ink-2:#46566A;--ink-3:#7C8898;--pain:#2B4A7A;--bleed:#9E2418;--ctx:#8A5A12;--ctx-bg:#F8EFDC;--r:10px;font-family:'Inter',system-ui,sans-serif;color:var(--ink);background:var(--paper);-webkit-font-smoothing:antialiased;line-height:1.45;min-height:100%}
.mh *{box-sizing:border-box}
.mh-shell{max-width:1040px;margin:0 auto;padding:22px 20px 56px;width:100%;overflow-x:clip}
.mh button{font-family:inherit;cursor:pointer}
.mh h1,.mh h2{font-family:'Schibsted Grotesk',sans-serif;margin:0;letter-spacing:-.01em}
.mh-mut{color:var(--ink-3)}.mh-em{color:var(--bleed);font-weight:600}.mh-z{color:var(--ink-3)}
.mh-head{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:16px 18px}
.mh-head-top{display:flex;justify-content:space-between;align-items:center;gap:14px}
.mh-head-actions{display:flex;gap:8px;flex-shrink:0}
.mh-title{font-size:21px;font-weight:700}
.mh-print{font:500 13px 'Inter';color:var(--ink-2);background:var(--surface);border:1px solid var(--line-2);padding:6px 13px;border-radius:7px;flex-shrink:0}
.mh-print:hover{border-color:var(--ink-3);color:var(--ink)}
.mh-print.is-done{color:#2f7d4f;border-color:#bfe0cc;background:#f0faf3}
.mh-meta{display:flex;flex-wrap:wrap;gap:22px;margin:14px 0 0;padding:13px 0 0;border-top:1px solid var(--grid)}
.mh-meta div{display:flex;flex-direction:column;gap:2px}
.mh-meta dt{font:600 9px/1 'IBM Plex Mono',monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3)}
.mh-meta dd{margin:0;font:600 14px 'IBM Plex Mono',monospace;color:var(--ink)}
.mh-metrics{display:grid;grid-template-columns:repeat(5,1fr);gap:1px;background:var(--line);border:1px solid var(--line);border-radius:var(--r);overflow:hidden;margin-top:13px}
.mh-metric{background:var(--surface);padding:11px 13px;min-width:0}
.mh-metric-l{font:600 10px/1.3 'IBM Plex Mono',monospace;letter-spacing:.04em;text-transform:uppercase;color:var(--ink-3);display:flex;align-items:center;gap:5px}
.mh-info{width:14px;height:14px;border-radius:50%;border:1px solid var(--line-2);color:var(--ink-3);font:600 9px/14px 'IBM Plex Mono',monospace;text-align:center;cursor:help;flex-shrink:0}
.mh-metric-v{margin-top:7px;font:600 23px/1 'Schibsted Grotesk',sans-serif;color:var(--ink);font-variant-numeric:tabular-nums;display:flex;align-items:baseline;gap:5px}
.mh-metric-v span{font:500 10.5px 'Inter';color:var(--ink-3)}
.mh-metric-s{margin-top:6px;font:450 11.5px 'Inter';color:var(--ink-2);font-variant-numeric:tabular-nums}
.mh-sec{margin-top:16px}
.mh-sec-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:7px;flex-wrap:wrap}
.mh-sec-head h2{font:600 11px 'IBM Plex Mono',monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3)}
.mh-sec-meta{font:500 11px 'IBM Plex Mono',monospace;color:var(--ink-3)}
.mh-panel{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:14px 16px;min-width:0;max-width:100%}
.mh-panel--flush{padding:4px 6px;overflow-x:auto}
.mh-2col{display:grid;grid-template-columns:1fr 300px;gap:16px;align-items:start;margin-top:16px}
.mh-2col>*{min-width:0}.mh-2col>.mh-sec{margin-top:0}
.mh-sec--side{display:flex;flex-direction:column;gap:0}
.mh-sec--side .mh-panel{margin-bottom:12px}.mh-sec--side .mh-panel:last-child{margin-bottom:0}
.mh-strips{overflow-x:auto;padding-bottom:2px;max-width:100%;-webkit-overflow-scrolling:touch}
.mh-strip-ruler,.mh-strip{display:grid;grid-template-columns:64px minmax(360px,1fr) 38px;align-items:center;gap:10px;min-width:474px}
.mh-strip-ruler{margin-bottom:5px}
.mh-track{display:grid;gap:1px}.mh-track--ruler{height:13px}
.mh-tick{font:500 9px/13px 'IBM Plex Mono',monospace;color:transparent;white-space:nowrap}.mh-tick.is-major{color:var(--ink-3)}
.mh-strip-end{font:600 11px 'IBM Plex Mono',monospace;color:var(--ink-2);text-align:right}
.mh-strip-ruler .mh-strip-end{color:var(--ink-3);font-weight:500;text-transform:uppercase;letter-spacing:.06em;font-size:9px}
.mh-strip{padding:6px 0;border-top:1px solid var(--grid)}
.mh-strip.is-post{background:linear-gradient(90deg,rgba(248,239,220,.5),rgba(248,239,220,0) 65%)}
.mh-strip-label{display:flex;flex-direction:column;gap:0;line-height:1.2}
.mh-strip-idx{font:600 10px 'IBM Plex Mono',monospace;color:var(--ink-3)}
.mh-strip-date{font:600 12px 'IBM Plex Mono',monospace;color:var(--ink)}
.mh-track-stack{display:flex;flex-direction:column;gap:2px;padding:3px 0;background:repeating-linear-gradient(90deg,transparent,transparent calc(20% - 1px),var(--grid) calc(20% - 1px),var(--grid) 20%)}
.mh-track--marks{height:9px}
.mh-mark{font-size:8px;line-height:9px;text-align:center;color:var(--ink-3)}
.mh-mark.mark-imb{color:var(--bleed)}.mh-mark.mark-dys,.mh-mark.mark-bow{color:var(--pain)}
.mh-track--flow{height:16px}
.mh-cell{height:16px;border:1px solid transparent;border-radius:2px;padding:0;background:transparent}
.mh-cell.has-flow{cursor:pointer}.mh-cell.has-flow:hover{outline:2px solid var(--ink);outline-offset:1px}.mh-cell.is-out{opacity:.3}
.mh-track--pain{height:12px;align-items:end}
.mh-pain-slot{height:12px;display:flex;align-items:flex-end;justify-content:center}
.mh-pain-bar{width:68%;border-radius:1px;min-height:2px}
.mh-legend{display:flex;gap:13px;flex-wrap:wrap;align-items:center}
.mh-leg-item{display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--ink-2)}
.mh-leg-sw{width:12px;height:12px;border-radius:3px;border:1px solid}
.mh-leg-bar{width:5px;height:12px;background:var(--pain);opacity:.7;border-radius:1px}
.mh-leg-glyph{font-size:11px}.mh-leg-glyph.mark-imb{color:var(--bleed)}.mh-leg-glyph.mark-dys{color:var(--pain)}
.mh-tl-dash{width:12px;border-top:1.5px dashed var(--ctx)}
.mh-g-func{color:var(--ink-3)}.mh-g-pc{color:var(--bleed)}.mh-g-dys{color:var(--pain)}
.mh-tbl{width:100%;min-width:430px;border-collapse:collapse;font:500 12.5px 'IBM Plex Mono',monospace;font-variant-numeric:tabular-nums}
.mh-tbl th{font:600 9.5px 'IBM Plex Mono',monospace;letter-spacing:.05em;text-transform:uppercase;color:var(--ink-3);text-align:right;padding:7px 10px;border-bottom:1px solid var(--line)}
.mh-tbl th:first-child,.mh-tbl td:first-child{text-align:left}
.mh-tbl td{padding:7px 10px;border-bottom:1px solid var(--grid);text-align:right;color:var(--ink)}
.mh-tbl tbody tr{cursor:pointer}.mh-tbl tbody tr:hover{background:var(--surface-2)}
.mh-tbl tbody tr:last-child td{border-bottom:none}
.mh-tbl tr.is-post td:first-child{box-shadow:inset 3px 0 0 var(--ctx)}
.mh-tbl-c{display:flex;align-items:center;gap:7px}
.mh-tbl-flag{font:600 8px 'IBM Plex Mono',monospace;color:var(--ctx);background:var(--ctx-bg);border:1px solid #E7D2A6;padding:1px 4px;border-radius:3px;letter-spacing:.03em}
.mh-kv{width:100%;border-collapse:collapse}
.mh-kv th,.mh-kv td{padding:6px 10px;border-bottom:1px solid var(--grid);font-size:12px;text-align:left}
.mh-kv tr:last-child th,.mh-kv tr:last-child td{border-bottom:none}
.mh-kv th{font-weight:450;color:var(--ink-2)}
.mh-kv td{font:600 12px 'IBM Plex Mono',monospace;color:var(--ink);text-align:right;font-variant-numeric:tabular-nums}
.mh-timeline-scroll{overflow-x:auto;padding-bottom:5px;max-width:100%;-webkit-overflow-scrolling:touch}
.mh-timeline{position:relative;height:190px;padding-top:20px;min-width:100%}
.mh-tl-month{position:absolute;top:0;bottom:0;border-left:1px solid var(--grid)}
.mh-tl-month span{position:absolute;top:1px;left:4px;font:600 9px 'IBM Plex Mono',monospace;color:var(--ink-3);letter-spacing:.04em}
.mh-tl-event{position:absolute;top:16px;bottom:0;z-index:3}
.mh-tl-event-line{position:absolute;top:0;bottom:0;width:0;border-left:1.5px dashed var(--ctx)}
.mh-tl-event-label{position:absolute;top:-2px;left:5px;font:600 9px 'IBM Plex Mono',monospace;color:var(--ctx);background:var(--ctx-bg);border:1px solid #E7D2A6;padding:2px 6px;border-radius:5px;white-space:nowrap}
.mh-tl-lane{position:relative;height:50px;border-bottom:1px solid var(--grid)}
.mh-tl-lane--events{height:28px}
.mh-tl-lane-cap{position:absolute;left:0;top:3px;z-index:2;font:600 8.5px 'IBM Plex Mono',monospace;letter-spacing:.07em;text-transform:uppercase;color:var(--ink-3);background:rgba(255,255,255,.85);padding:1px 4px;border-radius:3px}
.mh-tl-plot{position:absolute;inset:0}
.mh-tl-bar{position:absolute;bottom:0;width:4px;border:1px solid;border-radius:1px 1px 0 0;cursor:pointer;transform:translateX(-2px)}
.mh-tl-bar:hover{outline:1.5px solid var(--ink);outline-offset:1px;z-index:4}
.mh-tl-bar.is-imb{border-style:dashed}.mh-tl-bar--pain{border:none;border-radius:1px}
.mh-tl-glyph{position:absolute;bottom:2px;transform:translateX(-50%);font-size:10px}
.mh-heat{display:flex;flex-direction:column;gap:3px;overflow-x:auto}
.mh-heat-head,.mh-heat-row,.mh-heat-foot{display:grid;grid-template-columns:86px repeat(10,minmax(22px,1fr));align-items:center;gap:3px;min-width:380px}
.mh-heat-rowcap{font-size:11.5px;color:var(--ink-2);font-weight:500;padding-right:5px}
.mh-heat-col{text-align:center;font:600 9.5px 'IBM Plex Mono',monospace;color:var(--ink-3)}
.mh-heat-col.is-menses{color:var(--bleed)}
.mh-heat-cell{aspect-ratio:1/1;max-height:28px;display:flex;align-items:center;justify-content:center;border:1px solid var(--grid);border-radius:4px;font-size:9px;color:var(--pain)}
.mh-heat-cell.is-menses{border-color:#EAD7D2}
.mh-heat-cell.is-empty{background:repeating-linear-gradient(45deg,#fff,#fff 3px,var(--surface-2) 3px,var(--surface-2) 6px);color:var(--ink-3)}
.mh-heat-n{color:var(--ink-3)}
.mh-heat-foot{margin-top:3px;border-top:1px solid var(--grid);padding-top:4px}
.mh-heat-axis{display:flex;justify-content:space-between;margin-top:6px;font:500 10px 'IBM Plex Mono',monospace;color:var(--ink-3)}
.mh-fert{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);overflow:hidden}
.mh-fert-toggle{width:100%;display:flex;align-items:center;gap:12px;background:none;border:none;padding:12px 16px;text-align:left}
.mh-fert-cap{font:600 11px 'IBM Plex Mono',monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3)}
.mh-fert-meta{font:500 11.5px 'IBM Plex Mono',monospace;color:var(--ink-2);flex:1}
.mh-fert-caret{color:var(--ink-3)}
.mh-fert-body{padding:0 16px 14px}
.mh-spark{width:100%;height:auto;background:var(--surface-2);border:1px solid var(--grid);border-radius:8px;margin:6px 0}
.mh-fert-rows{display:flex;gap:20px;flex-wrap:wrap;font:500 12px 'IBM Plex Mono',monospace;color:var(--ink-2)}
.mh-modal{position:fixed;inset:0;background:rgba(20,32,46,.42);display:flex;align-items:center;justify-content:center;padding:20px;z-index:50}
.mh-day{background:#fff;border-radius:12px;width:min(370px,100%);box-shadow:0 18px 50px rgba(15,25,40,.3);overflow:hidden}
.mh-day-head{display:flex;justify-content:space-between;align-items:flex-start;padding:15px 18px 11px;border-bottom:1px solid var(--line)}
.mh-day-date{font:600 15px 'Schibsted Grotesk',sans-serif}
.mh-day-cd{font:500 12px 'IBM Plex Mono',monospace;color:var(--ink-3);margin-top:2px}
.mh-day-x{border:none;background:none;font-size:22px;color:var(--ink-3);line-height:1;padding:0 4px}
.mh-day-list{margin:0;padding:7px 18px 13px}
.mh-day-row{display:flex;justify-content:space-between;gap:14px;padding:6px 0;border-bottom:1px solid var(--grid)}
.mh-day-row:last-child{border-bottom:none}
.mh-day-row dt{font-size:12px;color:var(--ink-3)}
.mh-day-row dd{margin:0;font:500 12px 'IBM Plex Mono',monospace;color:var(--ink);text-align:right;max-width:62%}
.mh button:focus-visible,.mh [tabindex]:focus-visible{outline:2px solid var(--pain);outline-offset:2px;border-radius:3px}
@media (max-width:860px){.mh-2col{grid-template-columns:1fr;gap:0}.mh-2col>.mh-sec--side{margin-top:16px}.mh-metrics{grid-template-columns:repeat(3,1fr)}}
@media (max-width:520px){.mh-shell{padding:14px 12px 36px}.mh-title{font-size:19px}.mh-metrics{grid-template-columns:repeat(2,1fr)}.mh-metric:nth-child(5){grid-column:1 / -1}.mh-metric-v{font-size:20px}.mh-meta{gap:16px}.mh-head-top{flex-wrap:wrap}}
@media print{.mh{background:#fff}.mh-print{display:none!important}.mh-shell{max-width:none;padding:0}.mh-panel,.mh-head,.mh-metrics,.mh-fert{box-shadow:none;break-inside:avoid}.mh-strips,.mh-timeline-scroll,.mh-heat{overflow:visible}.mh-2col{grid-template-columns:1fr 300px}}
`;
