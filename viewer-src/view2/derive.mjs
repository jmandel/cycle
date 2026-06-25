/**
 * derive.mjs — view2's binary-first extrapolation engine.
 *
 * Premise (Carl/Chris, DevDays): the universal core is (calendar day, bleeding
 * yes/no). "From these two simple things we can extrapolate a considerable
 * amount." This module does exactly that: it computes the full clinical summary
 * — episodes, cycle length + regularity, bleeding duration, LMP, amenorrhea and
 * intermenstrual flags, coverage/confidence, and a labelled prediction — from
 * the `bleeding` boolean alone. Flow / pain / symptoms / BBT are read only as
 * OPTIONAL overlays, never as inputs to the core derivation. If an app sends
 * only the boolean, every core number below is still produced.
 *
 * Input: the transform.mjs view model ({ daily[], events[], context, meta }).
 * Output: a render-ready object whose `core` block is pure (date,bleeding) and
 * whose `layers` block is clearly-separated, presence-gated enrichment.
 *
 * Every threshold is a named, surfaced parameter — the viewer shows them, so a
 * clinician can see how each number was reached. Defaults follow FIGO/ACOG
 * normal menstrual parameters where they exist.
 */

const toDate = (s) => new Date(s + "T00:00:00Z");
const diffDays = (a, b) => Math.round((toDate(b) - toDate(a)) / 86400000);
const addDays = (s, n) => { const d = toDate(s); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const round1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

export const DEFAULT_PARAMS = {
  // max non-bleeding days tolerated *inside* one bleeding episode before it splits
  intraEpisodeGapDays: 1,
  // a bleeding episode this short (days) is treated as spotting, not a menses onset
  minMensesDays: 2,
  // FIGO/ACOG normal cycle frequency window (onset-to-onset days)
  freqNormalLow: 24,
  freqNormalHigh: 38,
  // FIGO normal upper bound for menstrual duration (days)
  durNormalHigh: 8,
  // cycle-to-cycle variation (shortest→longest) at/under which cycles are "regular"
  regularVariationDays: 7,
  // no menses for at least this many days = possible amenorrhea/oligomenorrhea
  amenorrheaDays: 90,
  // coverage in the trailing window under which a "no recent period" finding is
  // attributed to sparse tracking rather than true amenorrhea
  sparseCoverage: 0.5,
};

/** Group bleeding=true days into episodes, tolerating a small intra-episode gap. */
function buildEpisodes(bleedingDays, p) {
  const eps = [];
  let run = [];
  const flush = () => {
    if (!run.length) return;
    const onset = run[0], end = run[run.length - 1];
    eps.push({ onset, end, days: [...run], bleedDays: run.length, span: diffDays(onset, end) + 1 });
    run = [];
  };
  for (const date of bleedingDays) {
    const prev = run[run.length - 1];
    if (prev && diffDays(prev, date) > p.intraEpisodeGapDays + 1) flush();
    run.push(date);
  }
  flush();
  return eps;
}

export function derive(vm, opts = {}) {
  const p = { ...DEFAULT_PARAMS, ...(opts.params || {}) };
  const daily = vm.daily || [];
  const byDate = vm.byDate || Object.fromEntries(daily.map((d) => [d.date, d]));
  const events = vm.events || [];
  const spanStart = daily[0]?.date || null;
  const today = vm.context?.today || daily[daily.length - 1]?.date || null;
  const spanEnd = today;

  // ---- coverage / confidence (purely about how much was tracked) ----------
  const infoDates = daily.filter((d) => d.bleeding != null).map((d) => d.date);
  const spanDays = spanStart && spanEnd ? diffDays(spanStart, spanEnd) + 1 : daily.length;
  const trackedDays = infoDates.length;
  // longest stretch (days) with no bleeding info, within the tracked span
  let longestGap = 0;
  for (let i = 1; i < infoDates.length; i++) longestGap = Math.max(longestGap, diffDays(infoDates[i - 1], infoDates[i]) - 1);
  const coverage = spanDays ? trackedDays / spanDays : 0;

  // ---- the core: episodes -> menses vs spotting -> cycles ------------------
  const bleedingDays = daily.filter((d) => d.bleeding === true).map((d) => d.date);
  const episodes = buildEpisodes(bleedingDays, p);
  for (const e of episodes) e.menses = e.bleedDays >= p.minMensesDays;
  const menses = episodes.filter((e) => e.menses);
  const spotting = episodes.filter((e) => !e.menses); // candidate intermenstrual bleeding

  // cycles = onset-to-onset of successive menses
  const cycles = menses.map((e, i) => {
    const next = menses[i + 1] || null;
    const length = next ? diffDays(e.onset, next.onset) : null;
    const priorIud = events.find((x) => x.type === "iud-insertion" && diffDays(x.date, e.onset) >= 0);
    return {
      idx: i + 1, onset: e.onset, end: e.end, bleedDays: e.bleedDays, span: e.span,
      nextOnset: next ? next.onset : null, length, complete: !!next, ongoing: !next,
      postIUD: !!priorIud,
    };
  });

  // attribute each spotting episode to the cycle interval it falls inside
  for (const s of spotting) {
    const host = cycles.find((c) => c.complete && s.onset > c.onset && s.onset < c.nextOnset);
    s.cycleIdx = host ? host.idx : null;
    s.dayOfCycle = host ? diffDays(host.onset, s.onset) + 1 : null;
  }

  const lengths = cycles.filter((c) => c.complete).map((c) => c.length);
  const spans = menses.map((e) => e.span);
  const lmp = menses.length ? menses[menses.length - 1].onset : null;
  const daysSinceLmp = lmp && spanEnd ? diffDays(lmp, spanEnd) : null;
  const bleedingToday = spanEnd ? byDate[spanEnd]?.bleeding === true : false;

  // ---- classification (FIGO/ACOG normal parameters) -----------------------
  const medLen = median(lengths);
  const variation = lengths.length >= 2 ? Math.max(...lengths) - Math.min(...lengths) : null;
  const medSpan = median(spans);

  const frequency = medLen == null ? null
    : medLen < p.freqNormalLow ? "frequent"
    : medLen > p.freqNormalHigh ? "infrequent" : "normal";
  const regularity = lengths.length < 2 ? "insufficient"
    : variation <= p.regularVariationDays ? "regular" : "irregular";
  const duration = medSpan == null ? null : medSpan > p.durNormalHigh ? "prolonged" : "normal";

  // ---- flags --------------------------------------------------------------
  const flags = [];
  // amenorrhea / oligomenorrhea, coverage-aware so an untracked tail isn't mistaken for absence
  let amenorrhea = null;
  if (daysSinceLmp != null && daysSinceLmp >= p.amenorrheaDays && !bleedingToday) {
    const winStart = addDays(spanEnd, -p.amenorrheaDays);
    const winInfo = daily.filter((d) => d.bleeding != null && d.date >= winStart).length;
    const winCov = (p.amenorrheaDays + 1) ? winInfo / (p.amenorrheaDays + 1) : 0;
    amenorrhea = { days: daysSinceLmp, sparse: winCov < p.sparseCoverage, windowCoverage: winCov };
    flags.push(amenorrhea.sparse
      ? { kind: "no-recent-period-sparse", text: `No menses recorded in ${daysSinceLmp} days, but tracking is sparse in that window` }
      : { kind: "amenorrhea", text: `No menses in ${daysSinceLmp} days on adequate tracking (possible amenorrhea/oligomenorrhea)` });
  }
  if (spotting.length) flags.push({ kind: "imb", text: `${spotting.length} intermenstrual bleeding episode${spotting.length > 1 ? "s" : ""} (short bleeds between periods)` });
  if (frequency === "infrequent") flags.push({ kind: "infrequent", text: `Infrequent cycles (median ${medLen} d > ${p.freqNormalHigh} d)` });
  if (frequency === "frequent") flags.push({ kind: "frequent", text: `Frequent cycles (median ${medLen} d < ${p.freqNormalLow} d)` });
  if (regularity === "irregular") flags.push({ kind: "irregular", text: `Irregular cycles (${variation} d shortest→longest > ${p.regularVariationDays} d)` });
  if (duration === "prolonged") flags.push({ kind: "prolonged", text: `Prolonged bleeding (median ${medSpan} d > ${p.durNormalHigh} d)` });

  // ---- prediction (clearly labelled, never an observed fact) ---------------
  let prediction = null;
  if (lmp && medLen != null && !(amenorrhea && !amenorrhea.sparse)) {
    const next = addDays(lmp, Math.round(medLen));
    prediction = { onset: next, daysUntil: spanEnd ? diffDays(spanEnd, next) : null, basis: `last onset + median cycle (${medLen} d)` };
  }

  // ---- OPTIONAL layers (presence-gated overlays; never feed the core) ------
  const has = (f) => daily.some(f);
  const flowDays = daily.filter((d) => d.flow != null);
  const painDays = daily.filter((d) => d.pain != null);
  const mensesDates = new Set(menses.flatMap((e) => e.days));
  const mensesPain = daily.filter((d) => mensesDates.has(d.date) && d.pain > 0).map((d) => d.pain);
  const symCount = {};
  for (const d of daily) for (const k of Object.keys(d.symptoms || {})) symCount[k] = (symCount[k] || 0) + 1;

  const layers = {
    flow: {
      present: flowDays.length > 0,
      heavyDays: daily.filter((d) => d.flow === 4).length,
      peakByCycle: cycles.map((c) => {
        const ds = menses.find((e) => e.onset === c.onset)?.days || [];
        return Math.max(0, ...ds.map((dt) => byDate[dt]?.flow || 0));
      }),
      note: flowDays.length ? "Volume/heaviness is only assessable because this app sent the flow layer." : null,
    },
    pain: { present: painDays.length > 0, peak: painDays.length ? Math.max(...painDays.map((d) => d.pain)) : null,
      mensesMedian: mensesPain.length ? round1(median(mensesPain)) : null, days: painDays.length },
    symptoms: { present: Object.keys(symCount).length > 0, catalog: symCount,
      days: daily.filter((d) => d.symptoms && Object.keys(d.symptoms).length).length },
    bbt: { present: has((d) => d.bbt != null), days: daily.filter((d) => d.bbt != null).length,
      note: has((d) => d.bbt != null) ? "Ovulation/luteal signals require this layer; not derivable from bleeding alone." : null },
  };

  return {
    params: p,
    today: spanEnd,
    span: { start: spanStart, end: spanEnd, days: spanDays },
    coverage: { trackedDays, spanDays, fraction: coverage, longestGap },
    core: {
      episodes, menses, spotting, cycles,
      lengths, spans,
      metrics: {
        completeCycles: lengths.length,
        mensesCount: menses.length,
        cycleMedian: medLen, cycleMin: lengths.length ? Math.min(...lengths) : null,
        cycleMax: lengths.length ? Math.max(...lengths) : null, variation,
        durMedian: medSpan, durMin: spans.length ? Math.min(...spans) : null,
        durMax: spans.length ? Math.max(...spans) : null,
        bleedingDays: bleedingDays.length,
      },
      classification: { frequency, regularity, duration },
      lmp, daysSinceLmp, bleedingToday, prediction, flags,
    },
    layers,
    daily, byDate, events,
    sources: vm.meta?.sources || [],
  };
}

export default derive;
