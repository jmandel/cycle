#!/usr/bin/env bun
/**
 * Experimental package.db producer.
 *
 * This intentionally does not call the Java IG Publisher. It starts from the
 * same computable inputs the Publisher sees after FSH compilation:
 *   - fsh-generated/resources/*.json for conformance resources and IG metadata
 *   - input/resources/*.json for authored/generated examples
 *   - sushi-config.yaml for package-level metadata
 *
 * The goal is Publisher-shaped data, not byte-for-byte emulation. The companion
 * compare.ts script reports which rows/fields match real output/package.db and
 * which gaps remain.
 */
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import YAML from 'yaml';
import {
  buildCanonicalIndex,
  buildCurrentCanonicalIndex,
  canonicalIndexResources,
  isTerminologyPackageResource,
  resolvePublisherEntry,
  shouldReplaceTerminologyStubWithTxMetadata,
  type PublisherCanonicalIndexes,
} from './canonical';
import {
  deriveIndexedListRows,
  isPublisherBuiltinExternalCodeSystem,
  isPublisherNamespaceValueSetSystem,
  resolveValueSetForList,
  structureDefinitionBindingValueSetUrls,
  valueSetDirectSystems,
  valueSetFilterSystems,
} from './indexed-lists';
import { parseFhirXmlResource } from './fhir-xml';
import { binaryResourceFromManifestReference } from './manifest-binary';
import {
  describePackage,
  packageDownloadPolicyFromEnv,
  packageDownloadTimeoutMsFromEnv,
  resolvePackages,
  type PackageResolution,
  type ResolvedPackage,
} from './packages';
import { configuredAutoOidRoot, deriveAutoOidAssignments, parseOidsIni, type OidAssignments } from './oids';
import {
  deriveConceptRows,
  deriveCodeSystemPropertyRows,
  deriveMetadataRows,
  deriveResourceRows,
  deriveValueSetCodeRows,
  resourceRef,
} from './rows';
import { applyGlobalResourceMetadata } from './resource-metadata';
import { assertStructureDefinitionSnapshots, completeStructureDefinitionSnapshots } from './snapshots';
import {
  assertFreshGeneratedResources,
  fshCompilerInputFiles,
  summarizeTimestampedFiles,
  timestampedFiles,
} from './staleness';
import { getSushiVersion, runSushiBuild, type SushiBuildResult } from './sushi';
import {
  fetchCodeSystemMetadata,
  defaultTerminologyServerForFhirVersion,
  isOptionalCodeSystemMetadataMiss,
  maxExpansionCodesFromEnv,
  prepareValueSetExpansions,
  summarizeValueSetStrategies,
  terminologyResourceContext,
  terminologyMetadataModeFromEnv,
  terminologyModeFromEnv,
  valueSetStrategySummaries,
  type TerminologyMetadataOptions,
  type TerminologyOptions,
  type PreparedValueSetExpansion,
} from './terminology';
import { validateAssignedExamplesWithTerminology, type ValidationIssue } from './validation';
import { buildValidationReport } from './validation-report';
import { writePackageDbFile } from './writer';
import { txTimeoutMsFromEnv } from './tx-cache';

type Json = Record<string, any>;

const root = resolve(import.meta.dir, '../..');
const sushiProject = resolve(root, process.env.SUSHI_PROJECT || '.');
const sushiOut = resolve(root, process.env.SUSHI_OUT || sushiProject);
const runSushi = process.env.PUBLISHER_RUN_SUSHI !== '0';
const outDb = resolve(root, process.env.OUT_DB || 'temp/site-gen/publisher/package.db');
const buildManifestPath = resolve(root, process.env.PUBLISHER_BUILD_MANIFEST || `${outDb}.manifest.json`);
const fshResourceDir = resolve(root, process.env.FSH_RESOURCES || join(sushiOut, 'fsh-generated/resources'));
const exampleDir = resolve(root, process.env.INPUT_RESOURCES || join(sushiProject, 'input/resources'));
const configPath = resolve(root, process.env.SUSHI_CONFIG || join(sushiProject, 'sushi-config.yaml'));
const terminologyMode = terminologyModeFromEnv();
const terminologyMetadataMode = terminologyMetadataModeFromEnv();
const profile = process.env.PUBLISHER_PROFILE === '1';
const packageCacheRoot = resolve(process.env.FHIR_PACKAGE_CACHE || join(homedir(), '.fhir/packages'));
const packageDownloadPolicy = packageDownloadPolicyFromEnv();
const packageDownloadTimeoutMs = packageDownloadTimeoutMsFromEnv();
const txCacheDir = resolve(root, process.env.PUBLISHER_TX_CACHE || join(sushiProject, 'input/tx-cache'));
const txTimeoutMs = txTimeoutMsFromEnv();
const validateExamples = process.env.PUBLISHER_VALIDATE_EXAMPLES !== '0';
const validationReportPath = resolve(root, process.env.PUBLISHER_VALIDATION_REPORT || `${outDb}.validation.json`);
const failOnValidationErrors = process.env.PUBLISHER_FAIL_ON_VALIDATION_ERRORS === '1';
const oidsIniPath = resolve(root, process.env.PUBLISHER_OIDS || join(sushiProject, 'oids.ini'));

function timed<T>(label: string, fn: () => T): T {
  const start = performance.now();
  try {
    return fn();
  } finally {
    if (profile) console.error(`[publisher-profile] ${label}: ${(performance.now() - start).toFixed(1)}ms`);
  }
}

async function timedAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    if (profile) console.error(`[publisher-profile] ${label}: ${(performance.now() - start).toFixed(1)}ms`);
  }
}

function readJson(path: string): Json {
  return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
}

function readResource(path: string): Json {
  const content = readFileSync(path, 'utf8');
  return path.endsWith('.xml') ? parseFhirXmlResource(content) : JSON.parse(content.replace(/^\uFEFF/, ''));
}

function readOidAssignments(path: string): OidAssignments {
  return existsSync(path) ? parseOidsIni(readFileSync(path, 'utf8')) : new Map();
}

function jsonFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => join(dir, f)).sort();
}

function resourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json') || f.endsWith('.xml'))
    .map((f) => join(dir, f))
    .sort();
}

function scalarString(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  return null;
}

function configFhirVersion(cfg: Json): string {
  const fhirVersion = Array.isArray(cfg.fhirVersion) ? cfg.fhirVersion[0] : cfg.fhirVersion;
  if (!fhirVersion) throw new Error('sushi-config.yaml must declare fhirVersion');
  return String(fhirVersion);
}

function igResourceMetadata(ig: Json): Map<string, Json> {
  const out = new Map<string, Json>();
  for (const r of ig.definition?.resource || []) {
    const ref = r.reference?.reference;
    if (ref) out.set(ref, r);
  }
  return out;
}

function typeRank(type: string): number {
  const ranks: Record<string, number> = {
    ImplementationGuide: 0,
    CodeSystem: 1,
    StructureDefinition: 2,
    ValueSet: 3,
    Bundle: 4,
    Observation: 5,
  };
  return ranks[type] ?? 100;
}

function git(args: string[]): string | null {
  const proc = Bun.spawnSync(['git', ...args], { cwd: root, stdout: 'pipe', stderr: 'ignore' });
  if (!proc.success) return null;
  return new TextDecoder().decode(proc.stdout).trim() || null;
}

function packageManifestEntry(pkg: ResolvedPackage): Json {
  return {
    name: pkg.name,
    version: pkg.version,
    packageId: scalarString(pkg.manifest.name) || pkg.name,
    packageVersion: scalarString(pkg.manifest.version) || pkg.version,
    fhirVersions: Array.isArray(pkg.manifest.fhirVersions) ? pkg.manifest.fhirVersions : [],
    dependencies: pkg.manifest.dependencies || {},
    resolution: pkg.resolution,
    source: pkg.acquisition.source,
    packageDir: pkg.dir,
    ...(pkg.acquisition.registryUrl ? { registryUrl: pkg.acquisition.registryUrl } : {}),
    ...(pkg.acquisition.tarballSha256 ? { tarballSha256: pkg.acquisition.tarballSha256 } : {}),
  };
}

function packageCanonicalVersions(packageResolution: PackageResolution): Json[] {
  return packageResolution.packages.flatMap((pkg) => {
    const canonical = scalarString(pkg.manifest.canonical);
    const version = scalarString(pkg.manifest.version) || pkg.version;
    return canonical && version ? [{
      canonical,
      version,
      candidate: pkg.resolution.role === 'declared',
    }] : [];
  });
}

function fileSetManifest(files: string[], dir: string): Json {
  return summarizeTimestampedFiles(timestampedFiles(files), dir);
}

function writeBuildManifest(
  path: string,
  cfg: Json,
  packageResolution: PackageResolution,
  now: Date,
  args: {
    fshInputFiles: string[];
    generatedResourceFiles: string[];
    resources: Json[];
    sushiLogLevel?: 'error' | 'warn' | 'info' | 'debug';
    sushiResult: SushiBuildResult | null;
    terminologyOptions: TerminologyOptions;
    terminologyMetadataOptions: TerminologyMetadataOptions;
    valueSetExpansions: Map<string, PreparedValueSetExpansion>;
    terminologyContextResources: Json[];
  },
) {
  const manifest = {
    schema: 'site-gen.publisher.build-manifest.v1',
    generatedAt: now.toISOString(),
    publisher: 'site-gen.publisher',
    fhirVersion: configFhirVersion(cfg),
    sushiProject,
    sushiOut,
    outDb,
    packageCacheRoot,
    packageRegistry: process.env.FHIR_PACKAGE_REGISTRY || 'https://packages2.fhir.org/packages',
    packageAcquisition: {
      downloads: packageDownloadPolicy,
      downloadTimeoutMs: packageDownloadTimeoutMs,
    },
    sushi: {
      run: runSushi,
      version: args.sushiResult?.version ?? getSushiVersion(),
      adapter: 'programmatic',
      projectPath: sushiProject,
      outDir: sushiOut,
      resourcesDir: fshResourceDir,
      snapshot: args.sushiResult?.snapshot ?? true,
      logLevel: args.sushiLogLevel ?? null,
      result: args.sushiResult ? {
        inputDir: args.sushiResult.inputDir,
        outDir: args.sushiResult.outDir,
        resourcesDir: args.sushiResult.resourcesDir,
        counts: args.sushiResult.counts,
      } : null,
    },
    inputs: {
      config: configPath,
      oidsIni: existsSync(oidsIniPath) ? oidsIniPath : null,
      fshCompilerInputs: fileSetManifest(args.fshInputFiles, sushiProject),
      generatedResources: fileSetManifest(args.generatedResourceFiles, fshResourceDir),
      inputResources: exampleDir,
    },
    packages: packageResolution.packages.map(packageManifestEntry),
    terminology: {
      valueSetExpansion: {
        mode: args.terminologyOptions.mode,
        server: args.terminologyOptions.server,
        cacheDir: args.terminologyOptions.cacheDir,
        timeoutMs: txTimeoutMs,
        maxExpansionCodes: args.terminologyOptions.maxExpansionCodes,
        ...(args.terminologyOptions.activeOnly !== undefined ? { activeOnly: args.terminologyOptions.activeOnly } : {}),
      },
      codeSystemMetadata: {
        mode: args.terminologyMetadataOptions.mode,
        server: args.terminologyMetadataOptions.server,
        cacheDir: args.terminologyMetadataOptions.cacheDir,
        timeoutMs: txTimeoutMs,
      },
      valueSets: valueSetStrategySummaries(
        args.resources,
        args.terminologyOptions,
        args.valueSetExpansions,
        terminologyResourceContext(args.terminologyContextResources),
      ),
    },
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

function writeValidationReport(path: string, issues: ValidationIssue[]) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(buildValidationReport(issues), null, 2)}\n`);
}

function loadResources(cfg: Json, now: Date): Json[] {
  const generatedResourceFiles = resourceFiles(fshResourceDir);
  const inputResourceFiles = resourceFiles(exampleDir);
  const generated = generatedResourceFiles.map(readResource);
  const examples = inputResourceFiles.map(readResource);
  const byRef = new Map<string, Json>();
  for (const r of [...generated, ...examples]) {
    if (!r.resourceType || !r.id) continue;
    byRef.set(resourceRef(r), r);
  }
  const ig = primaryGeneratedImplementationGuide(generatedResourceFiles, generated, cfg);
  if (!ig) throw new Error(`No ImplementationGuide JSON found in ${relative(root, fshResourceDir)}. The integrated SUSHI stage did not produce IG resources.`);
  const resourceMeta = igResourceMetadata(ig);

  const ordered: Json[] = [];
  const seen = new Set<string>();
  const push = (r: Json | undefined) => {
    if (!r) return;
    const ref = resourceRef(r);
    if (seen.has(ref)) return;
    seen.add(ref);
    ordered.push(r);
  };

  push(ig);
  for (const ref of (ig.definition?.resource || []).map((r: any) => r.reference?.reference).filter(Boolean)) {
    let resource = byRef.get(ref);
    if (!resource) {
      resource = binaryResourceFromManifestReference(ref, resourceMeta.get(ref), inputResourceFiles) ?? undefined;
      if (resource) byRef.set(ref, resource);
    }
    push(resource);
  }
  for (const r of [...byRef.values()].sort((a, b) => typeRank(a.resourceType) - typeRank(b.resourceType) || a.id.localeCompare(b.id))) {
    push(r);
  }
  return ordered
    .sort((a, b) => typeRank(a.resourceType) - typeRank(b.resourceType) || a.id.localeCompare(b.id))
    .map((r) => applyGlobalResourceMetadata(r, cfg, now));
}

function primaryGeneratedImplementationGuide(files: string[], resources: Json[], cfg: Json): Json | null {
  const configuredId = scalarString(cfg.id);
  if (configuredId) {
    const target = `ImplementationGuide-${configuredId}.json`;
    const matches = files
      .map((file, index) => ({ file, resource: resources[index] }))
      .filter(({ file, resource }) => file.replaceAll('\\', '/').split('/').pop() === target
        && resource?.resourceType === 'ImplementationGuide');
    if (matches.length !== 1) {
      throw new Error(`Expected exactly one generated ${target}; found ${matches.length}`);
    }
    return matches[0].resource;
  }
  const guides = resources.filter((resource) => resource.resourceType === 'ImplementationGuide');
  if (guides.length > 1) throw new Error('Multiple generated ImplementationGuides require sushi-config.id');
  return guides[0] || null;
}

function loadGeneratedImplementationGuide(generatedResourceFiles: string[], cfg: Json): Json | null {
  return primaryGeneratedImplementationGuide(
    generatedResourceFiles,
    generatedResourceFiles.map(readJson),
    cfg,
  );
}

function configuredSushiLogLevel(): 'error' | 'warn' | 'info' | 'debug' | undefined {
  const level = process.env.SUSHI_LOG_LEVEL;
  if (level == null || level === '') return undefined;
  if (level === 'error' || level === 'warn' || level === 'info' || level === 'debug') return level;
  throw new Error(`Invalid SUSHI_LOG_LEVEL=${level}. Expected error, warn, info, or debug.`);
}

async function fetchMissingCodeSystemMetadata(
  resources: Json[],
  indexes: PublisherCanonicalIndexes,
  options: TerminologyMetadataOptions,
): Promise<Map<string, Json>> {
  if (options.mode === 'off') return new Map();

  const localValueSets = resources.filter((r) => r.resourceType === 'ValueSet' && r.url);
  const profiles = resources.filter((r) => r.resourceType === 'StructureDefinition');
  const valueSets = new Map<string, Json>();
  for (const vs of localValueSets) valueSets.set(vs.url, vs);
  for (const sd of profiles) {
    for (const vsUrl of [...structureDefinitionBindingValueSetUrls(sd, 'differential'), ...structureDefinitionBindingValueSetUrls(sd, 'snapshot')]) {
      const vs = resolveValueSetForList(vsUrl, indexes);
      if (vs?.url) valueSets.set(vs.url, vs);
    }
  }

  const out = new Map<string, Json>();
  const filterSystems = new Set([...valueSets.values()].flatMap(valueSetFilterSystems));
  const missingSystems = [...new Set([...valueSets.values()].flatMap(valueSetDirectSystems))]
    .filter((system) => !system.includes('|'))
    .filter((system) => {
      if (isPublisherNamespaceValueSetSystem(system)) return false;
      const entry = resolvePublisherEntry(indexes, { resourceType: 'CodeSystem', url: system });
      if (entry) return shouldReplaceTerminologyStubWithTxMetadata(entry.resource) && isTerminologyPackageResource(entry);
      return isPublisherBuiltinExternalCodeSystem(system) || filterSystems.has(system);
    })
    .sort((a, b) => a.localeCompare(b));

  for (const system of missingSystems) {
    try {
      const { codeSystem } = await fetchCodeSystemMetadata(system, options);
      out.set(system, codeSystem);
    } catch (error) {
      if (!isOptionalCodeSystemMetadataMiss(error, options.mode)) throw error;
      console.warn(`CodeSystem metadata unavailable for ${system}; continuing without optional CodeSystemList metadata.`);
    }
  }
  return out;
}

async function main() {
  const sushiLogLevel = configuredSushiLogLevel();
  let sushiResult: SushiBuildResult | null = null;
  if (runSushi) {
    sushiResult = await timedAsync('compile FSH with SUSHI', () => runSushiBuild({
      logLevel: sushiLogLevel,
      out: sushiOut,
      projectPath: sushiProject,
      snapshot: true,
      summary: profile,
    }));
  }
  if (!existsSync(configPath)) throw new Error(`Missing ${relative(root, configPath)}`);
  const cfg = timed('read config', () => YAML.parse(readFileSync(configPath, 'utf8')));
  const generatedResourceFiles = jsonFiles(fshResourceDir);
  const fshInputFiles = fshCompilerInputFiles(sushiProject, configPath);
  if (!runSushi) {
    timed('check generated resource freshness', () => assertFreshGeneratedResources({
      generatedDir: fshResourceDir,
      generatedFiles: generatedResourceFiles,
      inputDir: sushiProject,
      inputFiles: fshInputFiles,
      labelRoot: root,
    }));
  }
  const fhirVersion = configFhirVersion(cfg);
  const txServer = process.env.PUBLISHER_TX_SERVER || defaultTerminologyServerForFhirVersion(fhirVersion);
  const generatedImplementationGuide = timed('read generated ImplementationGuide', () => loadGeneratedImplementationGuide(generatedResourceFiles, cfg));
  const packageResolution = await timedAsync('resolve packages', () => resolvePackages(cfg, packageCacheRoot, {
    implementationGuide: generatedImplementationGuide,
  }));
  const dependencyPackages = packageResolution.packages.filter((p) => p !== packageResolution.core);
  if (profile) {
    console.error('[publisher-profile] resolved packages:');
    for (const pkg of packageResolution.packages) console.error(`[publisher-profile]   ${describePackage(pkg)}`);
  }
  const now = new Date();
  const loadedResources = timed('load resources', () => loadResources(cfg, now));
  const oidAssignments = timed('read OID assignments', () => deriveAutoOidAssignments(
    loadedResources,
    configuredAutoOidRoot(cfg),
    readOidAssignments(oidsIniPath),
  ));
  const coreIndex = timed('index core package', () => buildCanonicalIndex([packageResolution.core], { labelRoot: packageCacheRoot, profile }));
  const dependencyIndex = timed('index dependency packages', () => buildCanonicalIndex(dependencyPackages, { labelRoot: packageCacheRoot, profile }));
  const resources = timed('complete local StructureDefinition snapshots', () => completeStructureDefinitionSnapshots(loadedResources, {
    current: buildCurrentCanonicalIndex(loadedResources),
    core: coreIndex,
    dependencies: dependencyIndex,
  }));
  timed('require profile snapshots', () => assertStructureDefinitionSnapshots(resources));
  const indexes = {
    current: timed('index current resources', () => buildCurrentCanonicalIndex(resources)),
    core: coreIndex,
    dependencies: dependencyIndex,
  };
  const terminologyContextResources = timed('collect terminology context resources', () => [
    ...resources,
    ...canonicalIndexResources(indexes.core),
    ...canonicalIndexResources(indexes.dependencies),
  ]);
  const terminologyContext = timed('prepare terminology resource context', () => terminologyResourceContext(terminologyContextResources));
  if (profile || process.env.PUBLISHER_TERMINOLOGY_SUMMARY === '1') {
    console.error('[publisher-profile] value set strategies:');
    for (const line of summarizeValueSetStrategies(resources, terminologyContext)) console.error(`[publisher-profile]   ${line}`);
  }
  const terminologyOptions: TerminologyOptions = {
    mode: terminologyMode,
    cacheDir: txCacheDir,
    server: txServer,
    fhirVersion,
    maxExpansionCodes: maxExpansionCodesFromEnv(),
    activeOnly: process.env.PUBLISHER_TX_ACTIVE_ONLY === '1' ? true : undefined,
    profile,
  };
  const valueSetExpansions = await timedAsync('value set expansions', () => prepareValueSetExpansions(resources, terminologyOptions, terminologyContext));
  if (!generatedImplementationGuide) throw new Error('No generated primary ImplementationGuide loaded');
  const ig = resources.find((resource) => resourceRef(resource) === resourceRef(generatedImplementationGuide));
  if (!ig) throw new Error('Primary ImplementationGuide is absent after snapshot completion');
  const resourceMeta = timed('ig resource metadata', () => igResourceMetadata(ig));
  const rowConfig = { ...cfg, __publisherPackageCanonicalVersions: packageCanonicalVersions(packageResolution) };
  const metadataRows = timed('derive metadata rows', () => deriveMetadataRows({
    cfg: rowConfig,
    ig,
    now,
    branch: git(['branch', '--show-current']),
    revision: git(['rev-parse', '--short=10', 'HEAD']),
  }));
  const terminologyMetadataOptions: TerminologyMetadataOptions = {
    mode: terminologyMetadataMode,
    cacheDir: txCacheDir,
    server: txServer,
    fhirVersion,
    profile,
  };
  const terminologyCodeSystems = await timedAsync('code system metadata', () => fetchMissingCodeSystemMetadata(resources, indexes, terminologyMetadataOptions));
  const indexesWithTerminology = { ...indexes, terminologyCodeSystems };

  if (validateExamples) {
    const validationIssues = await timedAsync('validate assigned examples', () => validateAssignedExamplesWithTerminology(resources, indexesWithTerminology, {
      valueSetExpansions,
      terminologyOptions,
      warnOnUncheckedRequiredBindings: process.env.PUBLISHER_WARN_UNCHECKED_BINDINGS === '1',
    }));
    timed('write validation report', () => writeValidationReport(validationReportPath, validationIssues));
    const errors = validationIssues.filter((issue) => issue.severity === 'error');
    if (errors.length && failOnValidationErrors) {
      throw new Error(`Example validation failed with ${errors.length} error${errors.length === 1 ? '' : 's'}; see ${relative(root, validationReportPath)}`);
    }
    if (errors.length) console.warn(`Example validation reported ${errors.length} error${errors.length === 1 ? '' : 's'}; see ${relative(root, validationReportPath)}`);
  }

  const resourceRows = timed('derive resource rows', () => deriveResourceRows(resources, resourceMeta, rowConfig, ig));
  const keyByRef = resourceRows.keyByRef;
  const conceptRows = timed('derive concept rows', () => deriveConceptRows(resources, keyByRef));
  const codeSystemPropertyRows = timed('derive code system property rows', () => deriveCodeSystemPropertyRows(resources, keyByRef));
  const valueSetCodeRows = timed('derive value set expansion rows', () => deriveValueSetCodeRows(resources, keyByRef, valueSetExpansions));
  const indexedListRows = timed('derive indexed terminology/resource list rows', () => deriveIndexedListRows(resources, keyByRef, indexesWithTerminology, { oidAssignments }));
  writePackageDbFile(outDb, {
    metadataRows,
    resourceRows: resourceRows.rows,
    conceptRows,
    propertyRows: codeSystemPropertyRows.propertyRows,
    conceptPropertyRows: codeSystemPropertyRows.conceptPropertyRows,
    valueSetCodeRows,
    indexedListRows,
  }, { timed });

  timed('write build manifest', () => writeBuildManifest(buildManifestPath, cfg, packageResolution, now, {
    fshInputFiles,
    generatedResourceFiles,
    resources,
    sushiLogLevel,
    sushiResult,
    terminologyOptions,
    terminologyMetadataOptions,
    valueSetExpansions,
    terminologyContextResources,
  }));

  console.log(`Wrote experimental package DB: ${relative(root, outDb)}`);
  console.log(`  resources=${resources.length} concepts=${resources.filter((r) => r.resourceType === 'CodeSystem').reduce((n, cs) => n + (cs.concept?.length || 0), 0)}`);
  console.log(`  source inputs: ${relative(root, fshResourceDir)}, ${relative(root, exampleDir)}, ${relative(root, configPath)}`);
  console.log(`  package manifest: ${relative(root, buildManifestPath)}`);
  if (validateExamples) console.log(`  validation report: ${relative(root, validationReportPath)}`);
  console.log(`  terminology: PUBLISHER_TX=${terminologyMode}${terminologyMode === 'off' ? ' (ValueSet_Codes left empty)' : ` cache=${relative(root, txCacheDir)}`}; PUBLISHER_TX_METADATA=${terminologyMetadataMode}`);
}

await main();
