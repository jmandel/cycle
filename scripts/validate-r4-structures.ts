#!/usr/bin/env bun
/**
 * Validate MVP profiles and generated resources against supplied FHIR R4
 * StructureDefinitions. This deterministic offline check is complementary to
 * the HL7 Validator and IG Publisher.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const RES = join(ROOT, "fsh-generated", "resources");
const FHIR_CANONICAL_PREFIX = "http://hl7.org/fhir/StructureDefinition/";
const PRIMITIVE_TYPES = new Set(["base64Binary", "boolean", "canonical", "code", "date", "dateTime", "decimal", "id", "instant", "integer", "markdown", "oid", "positiveInt", "string", "time", "unsignedInt", "uri", "url", "uuid"]);
const FHIRPATH_TYPE_MAP: Record<string, string> = {
  "http://hl7.org/fhirpath/System.Boolean": "boolean",
  "http://hl7.org/fhirpath/System.Decimal": "decimal",
  "http://hl7.org/fhirpath/System.Integer": "integer",
  "http://hl7.org/fhirpath/System.String": "string",
};
const INTEGER_TYPES = new Set(["integer", "positiveInt", "unsignedInt"]);
const STRING_TYPES = new Set([...PRIMITIVE_TYPES].filter((x) => x !== "boolean" && x !== "decimal" && !INTEGER_TYPES.has(x)));

const glob = (pattern: string, cwd: string) => Array.from(new Bun.Glob(pattern).scanSync({ cwd })).sort();
const exists = async (path: string) => Bun.file(path).exists();
const loadJson = async (path: string) => JSON.parse(await Bun.file(path).text());
const normalizeType = (code: string) => FHIRPATH_TYPE_MAP[code] || code;
const maxValue = (value?: string) => value == null || value === "*" ? Infinity : Number(value);
const typeSuffix = (code: string) => {
  const normalized = normalizeType(code);
  return normalized[0].toUpperCase() + normalized.slice(1);
};

class PackageReader {
  root: string;
  tempRoot?: string;

  constructor(path: string) {
    if (path.endsWith(".tgz") || path.endsWith(".tar.gz")) {
      this.tempRoot = mkdtempSync(join(tmpdir(), "ptmvp-r4-"));
      const proc = Bun.spawnSync(["tar", "-xzf", path, "-C", this.tempRoot]);
      if (!proc.success) throw new Error(`could not extract ${path}: ${new TextDecoder().decode(proc.stderr)}`);
      this.root = this.tempRoot;
    } else {
      this.root = path;
    }
  }

  async readJson(filename: string) {
    for (const candidate of [join(this.root, filename), join(this.root, "package", filename)]) {
      if (await exists(candidate)) return loadJson(candidate);
    }
    throw new Error(`missing ${filename}`);
  }

  close() {
    if (this.tempRoot) rmSync(this.tempRoot, { recursive: true, force: true });
  }
}

function valueMatchesType(value: any, code: string) {
  const normalized = normalizeType(code);
  if (normalized === "boolean") return typeof value === "boolean";
  if (INTEGER_TYPES.has(normalized)) return Number.isInteger(value);
  if (normalized === "decimal") return typeof value === "number";
  if (STRING_TYPES.has(normalized)) return typeof value === "string";
  return value && typeof value === "object" && !Array.isArray(value);
}

async function loadGenerated() {
  const resources: any[] = [];
  const byUrl = new Map<string, any>();
  for (const file of glob("*.json", RES)) {
    const obj = await loadJson(join(RES, file));
    obj.__filename = file;
    resources.push(obj);
    if (obj.url) byUrl.set(obj.url, obj);
  }
  return { resources, byUrl };
}

function baseTypeForProfile(url: string, generatedByUrl: Map<string, any>) {
  if (url.startsWith(FHIR_CANONICAL_PREFIX)) return url.slice(FHIR_CANONICAL_PREFIX.length);
  return generatedByUrl.get(url)?.type || null;
}

async function validateProfileDifferential(profile: any, core: PackageReader, generatedByUrl: Map<string, any>) {
  const errors: string[] = [];
  const baseUrl = profile.baseDefinition;
  let base: any;
  if (baseUrl?.startsWith(FHIR_CANONICAL_PREFIX)) {
    const baseType = baseUrl.slice(FHIR_CANONICAL_PREFIX.length);
    try {
      base = await core.readJson(`StructureDefinition-${baseType}.json`);
    } catch {
      return [`${profile.__filename}: missing core StructureDefinition for ${baseType}`];
    }
  } else {
    base = generatedByUrl.get(baseUrl);
    if (!base) return [`${profile.__filename}: unsupported baseDefinition ${JSON.stringify(baseUrl)}`];
    if (!base.snapshot?.element && base.type) {
      try {
        base = await core.readJson(`StructureDefinition-${base.type}.json`);
      } catch {
        return [`${profile.__filename}: local baseDefinition ${baseUrl} has no snapshot and no core StructureDefinition for ${base.type}`];
      }
    }
  }
  const baseElements = new Map(base.snapshot.element.map((e: any) => [e.path, e]));
  for (const element of profile.differential?.element || []) {
    const parent: any = baseElements.get(element.path);
    if (!parent) {
      errors.push(`${profile.__filename}: differential path not in R4 base: ${element.path}`);
      continue;
    }
    if ((element.min ?? parent.min ?? 0) < (parent.min ?? 0)) errors.push(`${profile.__filename}: ${element.path} lowers min cardinality`);
    if (maxValue(element.max ?? parent.max) > maxValue(parent.max)) errors.push(`${profile.__filename}: ${element.path} raises max cardinality`);
    if (element.type) {
      const baseTypes = new Set((parent.type || []).map((t: any) => t.code));
      for (const narrowed of element.type) {
        if (!baseTypes.has(narrowed.code)) errors.push(`${profile.__filename}: ${element.path} type ${narrowed.code} is not allowed by R4 base ${JSON.stringify([...baseTypes].sort())}`);
        if (narrowed.code === "Reference" && narrowed.targetProfile) {
          const allowedTargets = new Set<string>();
          for (const t of parent.type || []) if (t.code === "Reference") for (const target of t.targetProfile || []) allowedTargets.add(target);
          const allowedTypes = new Set([...allowedTargets].map((t) => baseTypeForProfile(t, generatedByUrl)));
          for (const target of narrowed.targetProfile) {
            const targetType = baseTypeForProfile(target, generatedByUrl);
            if (allowedTargets.size && !allowedTargets.has(target) && !allowedTypes.has(targetType)) {
              errors.push(`${profile.__filename}: ${element.path} targetProfile ${target} is not a subtype of an allowed R4 target`);
            }
          }
        }
      }
    }
  }
  return errors;
}

function childElements(sd: any) {
  const root = sd.type;
  const result = new Map<string, any>();
  for (const element of sd.snapshot.element) {
    const path = element.path;
    if (!path.startsWith(`${root}.`)) continue;
    const tail = path.slice(root.length + 1);
    if (!tail.includes(".")) result.set(tail, element);
  }
  return result;
}

async function validateResourceTopLevel(resource: any, core: PackageReader) {
  const errors: string[] = [];
  const rt = resource.resourceType;
  const filename = resource.__filename || `${rt}/${resource.id || "?"}`;
  if (!rt) return [`${filename}: resourceType missing`];
  let sd: any;
  try {
    sd = await core.readJson(`StructureDefinition-${rt}.json`);
  } catch {
    return [`${filename}: no R4 StructureDefinition found for ${rt}`];
  }
  const elements = childElements(sd);
  const allowedKeys = new Set(["resourceType", "__filename"]);
  const choiceKeys = new Map<string, string>();
  for (const [name, element] of elements) {
    if (name.endsWith("[x]")) {
      const baseName = name.slice(0, -3);
      for (const type of element.type || []) {
        const key = baseName + typeSuffix(type.code);
        allowedKeys.add(key);
        choiceKeys.set(key, type.code);
      }
    } else {
      allowedKeys.add(name);
      if ((element.type || []).some((t: any) => PRIMITIVE_TYPES.has(normalizeType(t.code)))) allowedKeys.add(`_${name}`);
    }
  }
  for (const key of Object.keys(resource)) {
    if (!allowedKeys.has(key)) errors.push(`${filename}: unknown top-level R4 element ${key}`);
  }
  for (const [name, element] of elements) {
    const min = element.min || 0;
    const max = element.max || "1";
    if (name.endsWith("[x]")) {
      const baseName = name.slice(0, -3);
      const present = Object.keys(resource).filter((k) => k.startsWith(baseName) && choiceKeys.has(k));
      if (min && !present.length) errors.push(`${filename}: required choice ${name} is missing`);
      if (present.length > 1) errors.push(`${filename}: more than one choice supplied for ${name}: ${JSON.stringify(present)}`);
      for (const key of present) if (!valueMatchesType(resource[key], choiceKeys.get(key)!)) errors.push(`${filename}: ${key} has wrong JSON type for ${choiceKeys.get(key)}`);
      continue;
    }
    if (min && !(name in resource)) errors.push(`${filename}: required R4 element ${name} is missing`);
    if (!(name in resource)) continue;
    const value = resource[name];
    const values = max === "*" || (Number.isInteger(Number(max)) && Number(max) > 1) ? value : [value];
    if ((max === "*" || (Number.isInteger(Number(max)) && Number(max) > 1)) && !Array.isArray(value)) {
      errors.push(`${filename}: repeating element ${name} must be a JSON array`);
      continue;
    }
    if (!(max === "*" || (Number.isInteger(Number(max)) && Number(max) > 1)) && Array.isArray(value)) {
      errors.push(`${filename}: singleton element ${name} must not be a JSON array`);
      continue;
    }
    const types = (element.type || []).map((t: any) => t.code);
    for (const item of values) {
      if (types.length && !types.some((code: string) => valueMatchesType(item, code))) errors.push(`${filename}: ${name} has wrong JSON type for R4 types ${JSON.stringify(types)}`);
    }
  }
  return errors;
}

function argValue(name: string) {
  const idx = Bun.argv.indexOf(name);
  return idx >= 0 ? Bun.argv[idx + 1] : null;
}

async function main() {
  const r4Package = argValue("--r4-package");
  if (!r4Package) {
    console.error(`Usage: bun ${basename(Bun.argv[1])} --r4-package /path/to/hl7.fhir.r4.core#4.0.1`);
    return 2;
  }
  const core = new PackageReader(r4Package);
  const { resources, byUrl } = await loadGenerated();
  const errors: string[] = [];
  let profileCount = 0;
  let instanceCount = 0;
  try {
    for (const resource of resources) {
      errors.push(...await validateResourceTopLevel(resource, core));
      if (resource.resourceType === "StructureDefinition" && resource.derivation === "constraint") {
        profileCount++;
        errors.push(...await validateProfileDifferential(resource, core, byUrl));
      } else {
        instanceCount++;
      }
      if (resource.resourceType === "Bundle") {
        for (const entry of resource.entry || []) {
          if (!entry.resource) continue;
          const nested = { ...entry.resource, __filename: `${resource.__filename}::${entry.resource.resourceType}/${entry.resource.id || "?"}` };
          errors.push(...await validateResourceTopLevel(nested, core));
        }
      }
    }
  } finally {
    core.close();
  }

  const lines = [
    "# FHIR R4 StructureDefinition validation",
    "",
    `Validated ${profileCount} constrained profiles and ${instanceCount} other generated resources against the supplied FHIR R4 4.0.1 StructureDefinitions.`,
    "",
    ...(errors.length
      ? ["## Errors", "", ...errors.map((e) => `- ${e}`)]
      : ["**PASS** - all differential paths, cardinality restrictions, type restrictions, and generated resource top-level structures are compatible with FHIR R4 4.0.1.", "", "This deterministic offline check is complementary to, not a replacement for, the HL7 FHIR Validator and IG Publisher QA."]),
  ];
  const report = join(ROOT, "validation", "r4-structure-validation.md");
  await Bun.write(report, lines.join("\n") + "\n");
  process.stdout.write(await Bun.file(report).text());
  return errors.length ? 1 : 0;
}

process.exit(await main());
