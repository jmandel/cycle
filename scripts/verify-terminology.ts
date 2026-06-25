#!/usr/bin/env bun
/**
 * Verify LOINC and SNOMED CT codes referenced by the MVP source.
 *
 * Inputs can be FHIR CodeSystem NDJSON .gz files, a LOINC CSV/table directory,
 * or a SNOMED CT RF2 snapshot/release directory.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const REF_RE = /\$(LNC|SCT)#([A-Za-z0-9.\-]+)(?:\s+"([^"]+)")?/g;
const SYSTEM_TO_LABEL: Record<string, "LNC" | "SCT"> = {
  "http://loinc.org": "LNC",
  "http://snomed.info/sct": "SCT",
};
const SYSTEMS = { LNC: "http://loinc.org", SCT: "http://snomed.info/sct" };
const SNOMED_FSN = "900000000000003001";

type Label = "LNC" | "SCT";
type Refs = Record<Label, Map<string, string>>;
type Concept = {
  code: string;
  display: string;
  synonyms?: string[];
  property?: Record<string, unknown>[];
};

const glob = (pattern: string, cwd: string) => Array.from(new Bun.Glob(pattern).scanSync({ cwd })).sort();
const exists = async (path: string) => Bun.file(path).exists();

function argValue(name: string) {
  const idx = Bun.argv.indexOf(name);
  return idx >= 0 ? Bun.argv[idx + 1] : null;
}

function addRef(refs: Refs, label: Label, code?: string, display?: string) {
  if (!code) return;
  const current = refs[label].get(code) || "";
  if (display && !current) refs[label].set(code, display);
  else if (!refs[label].has(code)) refs[label].set(code, display || "");
}

async function collectReferences(root: string): Promise<Refs> {
  const refs: Refs = { LNC: new Map(), SCT: new Map() };
  for (const file of glob("*.fsh", join(root, "input", "fsh"))) {
    const text = await Bun.file(join(root, "input", "fsh", file)).text();
    for (const match of text.matchAll(REF_RE)) addRef(refs, match[1] as Label, match[2], match[3]);
  }
  for (const base of [join(root, "input", "resources"), join(root, "fsh-generated", "resources")]) {
    if (!existsSync(base)) continue;
    for (const file of glob("*.json", base)) collectJsonCodings(JSON.parse(await Bun.file(join(base, file)).text()), refs);
  }
  return refs;
}

function collectJsonCodings(value: any, refs: Refs) {
  if (Array.isArray(value)) {
    for (const child of value) collectJsonCodings(child, refs);
  } else if (value && typeof value === "object") {
    if (Array.isArray(value.coding)) {
      for (const item of value.coding) {
        const label = SYSTEM_TO_LABEL[item?.system];
        if (label) addRef(refs, label, item.code, item.display);
      }
    }
    for (const child of Object.values(value)) collectJsonCodings(child, refs);
  }
}

async function* readLines(path: string, gzip = false) {
  let stream: ReadableStream = Bun.file(path).stream();
  if (gzip) stream = stream.pipeThrough(new DecompressionStream("gzip"));
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  let pending = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    pending += value;
    let idx;
    while ((idx = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, idx);
      pending = pending.slice(idx + 1);
      yield line.endsWith("\r") ? line.slice(0, -1) : line;
    }
  }
  if (pending) yield pending.endsWith("\r") ? pending.slice(0, -1) : pending;
}

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      cells.push(cell);
      cell = "";
    } else {
      cell += ch;
    }
  }
  cells.push(cell);
  return cells;
}

function rowObject(header: string[], cells: string[]) {
  return Object.fromEntries(header.map((h, i) => [h, cells[i] || ""]));
}

async function loadNdjsonConcepts(path: string, wanted: Set<string>) {
  const found = new Map<string, Concept>();
  for await (const line of readLines(path, path.endsWith(".gz"))) {
    if (!line.trim()) continue;
    const obj = JSON.parse(line);
    if (wanted.has(obj.code)) {
      found.set(obj.code, obj);
      if (found.size === wanted.size) break;
    }
  }
  return found;
}

async function findFirst(root: string, patterns: string[]) {
  if (await exists(root)) {
    const file = Bun.file(root);
    if (file.size !== undefined && !root.endsWith("/")) {
      for (const pattern of patterns) {
        if (new Bun.Glob(pattern).match(root.split("/").pop() || "")) return root;
      }
    }
  }
  for (const pattern of patterns) {
    const matches = glob(`**/${pattern}`, root);
    if (matches.length) return join(root, matches[0]);
  }
  return null;
}

async function loadLoinc(path: string, wanted: Set<string>) {
  if (path.endsWith(".ndjson.gz")) return loadNdjsonConcepts(path, wanted);
  const csvPath = await findFirst(path, ["Loinc.csv"]);
  if (!csvPath) throw new Error(`could not locate Loinc.csv under ${path}`);
  const found = new Map<string, Concept>();
  let header: string[] | null = null;
  for await (const line of readLines(csvPath)) {
    if (!header) {
      header = parseCsvLine(line).map((h) => h.replace(/^\uFEFF/, ""));
      continue;
    }
    const row = rowObject(header, parseCsvLine(line));
    const code = row.LOINC_NUM;
    if (wanted.has(code)) {
      found.set(code, {
        code,
        display: row.LONG_COMMON_NAME || row.DisplayName || "",
        property: [{ code: "STATUS", valueCode: row.STATUS || "" }],
      });
      if (found.size === wanted.size) break;
    }
  }
  return found;
}

async function findRf2(root: string, pattern: string) {
  if ((await exists(root)) && new Bun.Glob(pattern).match(root.split("/").pop() || "")) return root;
  const matches = glob(`**/${pattern}`, root);
  if (!matches.length) throw new Error(`could not locate ${pattern} under ${root}`);
  return join(root, matches.find((m) => m.includes("/Snapshot/")) || matches[0]);
}

async function loadSnomed(path: string, wanted: Set<string>) {
  if (path.endsWith(".ndjson.gz")) return loadNdjsonConcepts(path, wanted);
  const conceptPath = await findRf2(path, "sct2_Concept_Snapshot_*.txt");
  const descriptionPath = await findRf2(path, "sct2_Description_Snapshot-en_*.txt");
  const found = new Map<string, Concept>();

  let header: string[] | null = null;
  for await (const line of readLines(conceptPath)) {
    if (!header) {
      header = line.split("\t");
      continue;
    }
    const row = rowObject(header, line.split("\t"));
    if (wanted.has(row.id)) {
      found.set(row.id, {
        code: row.id,
        display: "",
        synonyms: [],
        property: [{ code: "inactive", valueBoolean: row.active !== "1" }],
      });
      if (found.size === wanted.size) break;
    }
  }

  header = null;
  for await (const line of readLines(descriptionPath)) {
    if (!header) {
      header = line.split("\t");
      continue;
    }
    const row = rowObject(header, line.split("\t"));
    const concept = found.get(row.conceptId);
    if (!concept || row.active !== "1") continue;
    concept.synonyms!.push(row.term);
    if (row.typeId === SNOMED_FSN) concept.display = row.term;
    else if (!concept.display) concept.display = row.term;
  }
  return found;
}

function propertyValues(obj: Concept | undefined, code: string) {
  const values: unknown[] = [];
  for (const prop of obj?.property || []) {
    if (prop.code !== code) continue;
    for (const [key, value] of Object.entries(prop)) if (key.startsWith("value")) values.push(value);
  }
  return values;
}

function csvEscape(value: unknown) {
  const s = String(value ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

async function main() {
  const root = argValue("--root") || ROOT;
  const loinc = argValue("--loinc");
  const snomed = argValue("--snomed");
  if (!loinc || !snomed) {
    console.error("Usage: bun scripts/verify-terminology.ts --loinc /path/to/LOINC --snomed /path/to/SNOMED");
    return 2;
  }

  const refs = await collectReferences(root);
  const sources = { LNC: loinc, SCT: snomed };
  const loaders = { LNC: loadLoinc, SCT: loadSnomed };
  const rows: Record<string, unknown>[] = [];
  const errors: string[] = [];

  for (const label of ["LNC", "SCT"] as Label[]) {
    const wanted = new Set(refs[label].keys());
    const found = await loaders[label](sources[label], wanted);
    for (const code of [...wanted].sort()) {
      const obj = found.get(code);
      const expectedDisplay = refs[label].get(code) || "";
      let active = false;
      let actualDisplay = "";
      if (!obj) {
        errors.push(`${label} ${code} was not found`);
      } else {
        actualDisplay = obj.display || "";
        if (label === "LNC") {
          const statuses = propertyValues(obj, "STATUS").map((v) => String(v).toUpperCase());
          active = !statuses.length || statuses.includes("ACTIVE");
        } else {
          active = !propertyValues(obj, "inactive").some((v) => v === true);
        }
        if (!active) errors.push(`${label} ${code} is inactive`);
      }
      const displayMatch = !expectedDisplay || expectedDisplay === actualDisplay || !!obj?.synonyms?.includes(expectedDisplay);
      rows.push({
        system: SYSTEMS[label],
        code,
        expected_display: expectedDisplay,
        actual_display: actualDisplay,
        found: !!obj,
        active,
        display_match: displayMatch,
      });
    }
  }

  const fields = ["system", "code", "expected_display", "actual_display", "found", "active", "display_match"];
  await Bun.write(join(root, "validation", "terminology-validation.csv"), [
    fields.join(","),
    ...rows.map((row) => fields.map((f) => csvEscape(row[f])).join(",")),
  ].join("\n") + "\n");

  const lines = [
    "# Terminology validation",
    "",
    `Checked ${refs.LNC.size} LOINC and ${refs.SCT.size} SNOMED CT codes.`,
    "",
    "| System | Code | Display | Found | Active | Display match |",
    "|---|---|---|---:|---:|---:|",
    ...rows.map((row) => `| ${row.system} | \`${row.code}\` | ${row.actual_display} | ${row.found} | ${row.active} | ${row.display_match} |`),
    ...(errors.length ? ["", "## Errors", "", ...errors.map((e) => `- ${e}`)] : []),
  ];
  const mdPath = join(root, "validation", "terminology-validation.md");
  await Bun.write(mdPath, lines.join("\n") + "\n");
  console.log(`Checked ${rows.length} terminology references; report: ${mdPath}`);
  for (const error of errors) console.error(`ERROR: ${error}`);
  return errors.length ? 1 : 0;
}

process.exit(await main());
