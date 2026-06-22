/**
 * viewmodel.mjs — derive the render-ready structures + descriptive metrics the
 * clinician viewer consumes, from the transform's view model. Keeps all metric
 * computation in one place (the UI never hard-codes a number).
 */
const toDate = (s) => new Date(s + "T00:00:00Z");
const diffDays = (a, b) => Math.round((toDate(b) - toDate(a)) / 86400000);
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export function prepare(vm) {
  const daily = vm.daily;
  const byDate = vm.byDate || Object.fromEntries(daily.map((d) => [d.date, d]));
  const cycles = vm.cycles;
  const complete = cycles.filter((c) => c.complete);
  const ctx = vm.context;

  const intervals = complete.map((c) => c.length);
  const durations = complete.map((c) => c.bleedDuration);
  const pains = daily.filter((d) => d.pain != null).map((d) => d.pain);
  const mensesPain = daily.filter((d) => d.isPeriod && d.pain > 0).map((d) => d.pain);
  const spanDays = ctx.spanStart && ctx.today ? diffDays(ctx.spanStart, ctx.today) + 1 : daily.length;

  const m = {
    completeCycles: complete.length,
    intervalMedian: median(intervals),
    intervalMin: intervals.length ? Math.min(...intervals) : null,
    intervalMax: intervals.length ? Math.max(...intervals) : null,
    variation: intervals.length ? Math.max(...intervals) - Math.min(...intervals) : null,
    durMedian: median(durations),
    durMin: durations.length ? Math.min(...durations) : null,
    durMax: durations.length ? Math.max(...durations) : null,
    heavyDays: daily.filter((d) => d.flow === 4).length,
    imbDays: daily.filter((d) => d.intermenstrual).length,
    postcoital: daily.filter((d) => d.postcoital).length,
    peakPain: pains.length ? Math.max(...pains) : 0,
    typicalMensesPain: mensesPain.length ? Math.round(median(mensesPain)) : 0,
    funcDays: daily.filter((d) => d.functionalLimit).length,
    nonMenPain: daily.filter((d) => d.pain > 0 && !d.isPeriod).length,
    dyspareunia: daily.filter((d) => d.painTypes?.includes("dyspareunia")).length,
    bowel: daily.filter((d) => d.painTypes?.includes("bowel")).length,
    spanDays,
    loggedDays: daily.length,
    bleedInfoDays: daily.filter((d) => d.flow != null).length,
    painEntryDays: pains.length,
    symEntryDays: daily.filter((d) => d.symptoms && Object.keys(d.symptoms).length).length,
  };
  return { daily, byDate, cycles, complete, m, ctx };
}
