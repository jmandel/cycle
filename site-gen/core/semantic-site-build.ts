/**
 * cycle-site/v2: strict decoding of the split semantic SiteBuild handoff.
 *
 * Four typed JSON roots carry resources,
 * terminology, navigation, and parsed configuration; authored assets remain raw
 * content-addressed ArtifactKey::Asset values. This module validates and
 * preloads that closed set directly into the renderer's typed input.
 */
import { artifactKeyId, ClosedBuildHandle } from './closed-build';
import type { ArtifactKey, ClosedSiteBuild } from './closed-build';
import { compareText } from './order';
import {
  CYCLE_RENDER_PLAN_V2,
  CYCLE_SEMANTIC_CONFIG_ARTIFACT,
  CYCLE_SEMANTIC_DATA_ARTIFACTS,
  CYCLE_SEMANTIC_NAVIGATION_ARTIFACT,
  CYCLE_SEMANTIC_RESOURCES_ARTIFACT,
  CYCLE_SEMANTIC_TERMINOLOGY_ARTIFACT,
} from './site-build';

export interface SemanticResourceKey {
  resourceType: string;
  id: string;
}

export interface SemanticPublicationFacet {
  displayName?: string;
  description?: string;
  standardStatus?: string;
  baseDefinition?: string;
}

export interface SemanticResourceEntry {
  key: SemanticResourceKey;
  resource: Record<string, unknown>;
  publication?: SemanticPublicationFacet;
}

export interface SemanticGuideMetadata {
  implementationGuide: SemanticResourceKey;
  packageId: string;
  canonical?: string;
  name?: string;
  version?: string;
  fhirVersion: string;
  releaseLabel?: string;
  fhirPublicationBase: string;
  generated: {
    epochSeconds: number;
    date: string;
    day: string;
  };
  sourceControl?: {
    branch?: string;
    revision?: string;
  };
}

export interface SemanticResourcesPayload {
  schema: 'cycle.semantic.resources/v1';
  guide: SemanticGuideMetadata;
  resources: SemanticResourceEntry[];
  publisherCompatibility?: {
    errorCount: string;
    toolingVersion: string;
    toolingRevision: string;
    toolingVersionFull: string;
  };
}

export interface SemanticTerminologyCode {
  system: string;
  version?: string;
  code: string;
  display?: string;
}

export interface SemanticTerminologyPayload {
  schema: 'cycle.semantic.terminology/v1';
  expansions: Array<{
    valueSet: SemanticResourceKey;
    url: string;
    version?: string;
    codes: SemanticTerminologyCode[];
  }>;
}

export interface SemanticPageNode {
  nameUrl: string;
  title: string;
  generation: string;
  body?: string | null;
  source?: string;
  children: SemanticPageNode[];
}

export interface SemanticMenuNode {
  label: string;
  href?: string;
  items: SemanticMenuNode[];
}

export interface SemanticNavigationPayload {
  schema: 'cycle.semantic.navigation/v2';
  pages: SemanticPageNode[];
  menu: SemanticMenuNode[];
}

export interface SemanticConfigPayload {
  schema: 'cycle.semantic.config/v1';
  sushiConfig: Record<string, unknown>;
}

interface LoadedAsset {
  readonly name: string;
  readonly mime: string;
  readonly bytes: Uint8Array;
  readonly publicOutput: boolean;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const set = new Set(allowed);
  const unexpected = Object.keys(value).find((key) => !set.has(key));
  if (unexpected) throw new Error(`${label} has unexpected field ${unexpected}`);
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function optionalString(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : string(value, label);
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function resourceKey(value: unknown, label: string): SemanticResourceKey {
  const object = record(value, label);
  onlyKeys(object, ['resourceType', 'id'], label);
  return {
    resourceType: string(object.resourceType, `${label}.resourceType`),
    id: string(object.id, `${label}.id`),
  };
}

function resourceKeyId(key: SemanticResourceKey): string {
  return `${key.resourceType}/${key.id}`;
}

function publicationFacet(value: unknown, label: string): SemanticPublicationFacet {
  const object = record(value, label);
  onlyKeys(object, ['displayName', 'description', 'standardStatus', 'baseDefinition'], label);
  const result: SemanticPublicationFacet = {
    displayName: optionalString(object.displayName, `${label}.displayName`),
    description: optionalString(object.description, `${label}.description`),
    standardStatus: optionalString(object.standardStatus, `${label}.standardStatus`),
    baseDefinition: optionalString(object.baseDefinition, `${label}.baseDefinition`),
  };
  if (!Object.values(result).some((item) => item !== undefined)) {
    throw new Error(`${label} must be omitted when it has no fields`);
  }
  return result;
}

export function decodeSemanticResources(value: unknown): SemanticResourcesPayload {
  const object = record(value, 'Cycle semantic resources');
  onlyKeys(object, ['schema', 'guide', 'resources', 'publisherCompatibility'], 'Cycle semantic resources');
  if (object.schema !== 'cycle.semantic.resources/v1') {
    throw new Error(`Unsupported Cycle resources schema ${String(object.schema)}`);
  }

  const guideObject = record(object.guide, 'Cycle semantic resources.guide');
  onlyKeys(guideObject, [
    'implementationGuide', 'packageId', 'canonical', 'name', 'version', 'fhirVersion',
    'releaseLabel', 'fhirPublicationBase', 'generated', 'sourceControl',
  ], 'Cycle semantic resources.guide');
  const generated = record(guideObject.generated, 'Cycle semantic resources.guide.generated');
  onlyKeys(generated, ['epochSeconds', 'date', 'day'], 'Cycle semantic resources.guide.generated');
  if (!Number.isSafeInteger(generated.epochSeconds)) {
    throw new Error('Cycle semantic resources.guide.generated.epochSeconds must be a safe integer');
  }

  let sourceControl: SemanticGuideMetadata['sourceControl'];
  if (guideObject.sourceControl !== undefined) {
    const source = record(guideObject.sourceControl, 'Cycle semantic resources.guide.sourceControl');
    onlyKeys(source, ['branch', 'revision'], 'Cycle semantic resources.guide.sourceControl');
    sourceControl = {
      branch: optionalString(source.branch, 'Cycle semantic resources.guide.sourceControl.branch'),
      revision: optionalString(source.revision, 'Cycle semantic resources.guide.sourceControl.revision'),
    };
    if (!sourceControl.branch && !sourceControl.revision) {
      throw new Error('Cycle semantic resources.guide.sourceControl must be omitted when empty');
    }
  }

  const guide: SemanticGuideMetadata = {
    implementationGuide: resourceKey(
      guideObject.implementationGuide,
      'Cycle semantic resources.guide.implementationGuide',
    ),
    packageId: string(guideObject.packageId, 'Cycle semantic resources.guide.packageId'),
    canonical: optionalString(guideObject.canonical, 'Cycle semantic resources.guide.canonical'),
    name: optionalString(guideObject.name, 'Cycle semantic resources.guide.name'),
    version: optionalString(guideObject.version, 'Cycle semantic resources.guide.version'),
    fhirVersion: string(guideObject.fhirVersion, 'Cycle semantic resources.guide.fhirVersion'),
    releaseLabel: optionalString(guideObject.releaseLabel, 'Cycle semantic resources.guide.releaseLabel'),
    fhirPublicationBase: string(
      guideObject.fhirPublicationBase,
      'Cycle semantic resources.guide.fhirPublicationBase',
    ),
    generated: {
      epochSeconds: generated.epochSeconds as number,
      date: string(generated.date, 'Cycle semantic resources.guide.generated.date'),
      day: string(generated.day, 'Cycle semantic resources.guide.generated.day'),
    },
    ...(sourceControl ? { sourceControl } : {}),
  };

  const seen = new Set<string>();
  const resources = array(object.resources, 'Cycle semantic resources.resources').map((item, index) => {
    const label = `Cycle semantic resources.resources[${index}]`;
    const entry = record(item, label);
    onlyKeys(entry, ['key', 'resource', 'publication'], label);
    const key = resourceKey(entry.key, `${label}.key`);
    const body = record(entry.resource, `${label}.resource`);
    if (body.resourceType !== key.resourceType || body.id !== key.id) {
      throw new Error(`${label}.key does not match resource.resourceType/id`);
    }
    const id = resourceKeyId(key);
    if (seen.has(id)) throw new Error(`Cycle semantic resources contains duplicate resource ${id}`);
    seen.add(id);
    return {
      key,
      resource: body,
      ...(entry.publication === undefined
        ? {}
        : { publication: publicationFacet(entry.publication, `${label}.publication`) }),
    };
  });

  const guideId = resourceKeyId(guide.implementationGuide);
  const selectedGuide = resources.find((entry) => resourceKeyId(entry.key) === guideId);
  if (guide.implementationGuide.resourceType !== 'ImplementationGuide'
    || selectedGuide?.key.resourceType !== 'ImplementationGuide') {
    throw new Error('Cycle semantic resources.guide must reference an existing ImplementationGuide resource');
  }

  let publisherCompatibility: SemanticResourcesPayload['publisherCompatibility'];
  if (object.publisherCompatibility !== undefined) {
    const compatibility = record(object.publisherCompatibility, 'Cycle semantic resources.publisherCompatibility');
    onlyKeys(compatibility, [
      'errorCount', 'toolingVersion', 'toolingRevision', 'toolingVersionFull',
    ], 'Cycle semantic resources.publisherCompatibility');
    publisherCompatibility = {
      errorCount: string(compatibility.errorCount, 'Cycle semantic resources.publisherCompatibility.errorCount'),
      toolingVersion: string(compatibility.toolingVersion, 'Cycle semantic resources.publisherCompatibility.toolingVersion'),
      toolingRevision: string(compatibility.toolingRevision, 'Cycle semantic resources.publisherCompatibility.toolingRevision'),
      toolingVersionFull: string(
        compatibility.toolingVersionFull,
        'Cycle semantic resources.publisherCompatibility.toolingVersionFull',
      ),
    };
  }

  return {
    schema: 'cycle.semantic.resources/v1',
    guide,
    resources,
    ...(publisherCompatibility ? { publisherCompatibility } : {}),
  };
}

export function decodeSemanticTerminology(value: unknown): SemanticTerminologyPayload {
  const object = record(value, 'Cycle semantic terminology');
  onlyKeys(object, ['schema', 'expansions'], 'Cycle semantic terminology');
  if (object.schema !== 'cycle.semantic.terminology/v1') {
    throw new Error(`Unsupported Cycle terminology schema ${String(object.schema)}`);
  }
  const seen = new Set<string>();
  const expansions = array(object.expansions, 'Cycle semantic terminology.expansions').map((item, index) => {
    const label = `Cycle semantic terminology.expansions[${index}]`;
    const expansion = record(item, label);
    onlyKeys(expansion, ['valueSet', 'url', 'version', 'codes'], label);
    const valueSet = resourceKey(expansion.valueSet, `${label}.valueSet`);
    if (valueSet.resourceType !== 'ValueSet') throw new Error(`${label}.valueSet must name a ValueSet`);
    const url = string(expansion.url, `${label}.url`);
    const version = optionalString(expansion.version, `${label}.version`);
    const identity = `${resourceKeyId(valueSet)}|${url}|${version || ''}`;
    if (seen.has(identity)) throw new Error(`${label} duplicates expansion ${identity}`);
    seen.add(identity);
    const codes = array(expansion.codes, `${label}.codes`).map((candidate, codeIndex) => {
      const codeLabel = `${label}.codes[${codeIndex}]`;
      const code = record(candidate, codeLabel);
      onlyKeys(code, ['system', 'version', 'code', 'display'], codeLabel);
      return {
        system: string(code.system, `${codeLabel}.system`),
        version: optionalString(code.version, `${codeLabel}.version`),
        code: string(code.code, `${codeLabel}.code`),
        display: optionalString(code.display, `${codeLabel}.display`),
      };
    });
    for (let codeIndex = 1; codeIndex < codes.length; codeIndex++) {
      const prior = codes[codeIndex - 1];
      const current = codes[codeIndex];
      if (compareText(prior.system, current.system) > 0
        || (prior.system === current.system && compareText(prior.code, current.code) > 0)) {
        throw new Error(`${label}.codes is not ordered by system/code`);
      }
    }
    return { valueSet, url, ...(version ? { version } : {}), codes };
  });
  return { schema: 'cycle.semantic.terminology/v1', expansions };
}

function pageNode(value: unknown, label: string, names: Set<string>, depth: number): SemanticPageNode {
  if (depth > 256) throw new Error(`${label} exceeds the maximum navigation depth`);
  const object = record(value, label);
  onlyKeys(object, ['nameUrl', 'title', 'generation', 'body', 'source', 'children'], label);
  const nameUrl = string(object.nameUrl, `${label}.nameUrl`);
  if (names.has(nameUrl)) throw new Error(`Cycle semantic navigation contains duplicate page ${nameUrl}`);
  names.add(nameUrl);
  if (object.body !== undefined && object.body !== null && typeof object.body !== 'string') {
    throw new Error(`${label}.body must be a string, null, or omitted`);
  }
  const source = optionalString(object.source, `${label}.source`);
  if (source && (source.startsWith('/') || source.includes('\\') || source.split('/').some((part) => !part || part === '.' || part === '..'))) {
    throw new Error(`${label}.source must be a normalized project-relative path`);
  }
  if ((object.body === undefined || object.body === null) !== !source) {
    throw new Error(`${label}.body and source must either both be present or both be absent`);
  }
  return {
    nameUrl,
    title: string(object.title, `${label}.title`),
    generation: string(object.generation, `${label}.generation`),
    ...(object.body === undefined ? {} : { body: object.body as string | null }),
    ...(source ? { source } : {}),
    children: array(object.children, `${label}.children`).map((child, index) => (
      pageNode(child, `${label}.children[${index}]`, names, depth + 1)
    )),
  };
}

function menuNode(value: unknown, label: string, depth: number): SemanticMenuNode {
  if (depth > 256) throw new Error(`${label} exceeds the maximum menu depth`);
  const object = record(value, label);
  onlyKeys(object, ['label', 'href', 'items'], label);
  const href = optionalString(object.href, `${label}.href`);
  const items = array(object.items, `${label}.items`).map((child, index) => (
    menuNode(child, `${label}.items[${index}]`, depth + 1)
  ));
  if (href && items.length) throw new Error(`${label} cannot contain both href and child items`);
  return { label: string(object.label, `${label}.label`), ...(href ? { href } : {}), items };
}

export function decodeSemanticNavigation(value: unknown): SemanticNavigationPayload {
  const object = record(value, 'Cycle semantic navigation');
  onlyKeys(object, ['schema', 'pages', 'menu'], 'Cycle semantic navigation');
  if (object.schema !== 'cycle.semantic.navigation/v2') {
    throw new Error(`Unsupported Cycle navigation schema ${String(object.schema)}`);
  }
  const names = new Set<string>();
  return {
    schema: 'cycle.semantic.navigation/v2',
    pages: array(object.pages, 'Cycle semantic navigation.pages').map((item, index) => (
      pageNode(item, `Cycle semantic navigation.pages[${index}]`, names, 0)
    )),
    menu: array(object.menu, 'Cycle semantic navigation.menu').map((item, index) => (
      menuNode(item, `Cycle semantic navigation.menu[${index}]`, 0)
    )),
  };
}

export function decodeSemanticConfig(value: unknown): SemanticConfigPayload {
  const object = record(value, 'Cycle semantic config');
  onlyKeys(object, ['schema', 'sushiConfig'], 'Cycle semantic config');
  if (object.schema !== 'cycle.semantic.config/v1') {
    throw new Error(`Unsupported Cycle config schema ${String(object.schema)}`);
  }
  return {
    schema: 'cycle.semantic.config/v1',
    sushiConfig: record(object.sushiConfig, 'Cycle semantic config.sushiConfig'),
  };
}

const AUTHORED_INCLUDE_NAMESPACE = 'cycle.authored.include/v1';

function authoredAssetKey(key: ArtifactKey): { path: string; publicOutput: boolean } | null {
  if (key.kind !== 'asset') return null;
  const namespace = key.namespace;
  if (!namespace || typeof namespace !== 'object' || Array.isArray(namespace)) return null;
  const object = namespace as Record<string, unknown>;
  const publicOutput = Object.keys(object).length === 1 && object.kind === 'authored';
  const privateInclude = Object.keys(object).length === 2
    && object.kind === 'other'
    && object.name === AUTHORED_INCLUDE_NAMESPACE;
  if (!publicOutput && !privateInclude) return null;
  return typeof key.path === 'string' ? { path: key.path, publicOutput } : null;
}

function assertV2Contract(build: ClosedSiteBuild): ArtifactKey[] {
  const target = build.renderTarget;
  if (target.mode !== 'external_builder'
    || target.renderer.id !== 'cycle-site'
    || target.renderer.version !== '2'
    || target.parameters?.contract !== CYCLE_RENDER_PLAN_V2.id) {
    throw new Error('Closed SiteBuild target does not implement cycle-site/v2');
  }

  const expected = new Map(CYCLE_SEMANTIC_DATA_ARTIFACTS.map((key) => [artifactKeyId(key), key]));
  const assets: ArtifactKey[] = [];
  for (const key of build.renderPlan.requiredArtifacts) {
    const id = artifactKeyId(key);
    if (expected.delete(id)) continue;
    if (authoredAssetKey(key)) {
      assets.push(key);
      continue;
    }
    throw new Error(`cycle-site/v2 has unexpected required root ${id}`);
  }
  if (expected.size) {
    throw new Error(`cycle-site/v2 is missing required root ${[...expected.values()].map(artifactKeyId).join(', ')}`);
  }
  const rootedAssets = new Set(assets.map(artifactKeyId));
  const catalogAssets = new Set(build.artifacts
    .map((record) => record.key)
    .filter((key) => authoredAssetKey(key) !== null)
    .map(artifactKeyId));
  const omitted = [...catalogAssets].filter((id) => !rootedAssets.has(id));
  if (omitted.length) {
    throw new Error(`cycle-site/v2 authored asset is outside the render plan: ${omitted.join(', ')}`);
  }
  return assets;
}

async function readJson(build: ClosedBuildHandle, key: ArtifactKey, label: string): Promise<unknown> {
  const artifact = build.artifactRecord(key);
  if (artifact.state.status !== 'ready' || artifact.state.content.mediaType !== 'application/json') {
    throw new Error(`${label} must be a ready application/json artifact`);
  }
  const source = await build.readTextArtifact(key);
  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    throw new Error(`${label} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function scalarString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

function cloned<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function textualMime(mime: string): boolean {
  const value = mime.toLowerCase();
  return value.startsWith('text/')
    || value === 'image/svg+xml'
    || value === 'application/xml'
    || value === 'application/xhtml+xml';
}

export interface CycleResource {
  key: SemanticResourceKey;
  resource: Record<string, any>;
  type: string;
  id: string;
  page: string;
  url: string | null;
  version: string | null;
  status: string | null;
  name: string | null;
  title: string | null;
  description: string | null;
  derivation: string | null;
  standardStatus: string | null;
  kind: string | null;
  sdType: string | null;
  base: string | null;
  content: string | null;
  supplements: string | null;
}

export interface CyclePage {
  slug: string;
  nameUrl: string;
  title: string;
  generation: string;
  body: string | null;
}

export interface CycleAssetDescriptor {
  path: string;
  mediaType: string;
}

export interface CycleAsset extends CycleAssetDescriptor {
  bytes: Uint8Array;
}

export interface CycleConcept {
  code: string;
  display?: string;
  definition?: string;
  children: CycleConcept[];
}

/** Fully decoded, immutable cycle-site/v2 renderer input. */
export class CycleSiteBuild {
  private readonly resourceValues: readonly CycleResource[];
  private readonly pageValues: readonly CyclePage[];
  private readonly metadataValue: Readonly<Record<string, string>>;
  private readonly assetsByPath: ReadonlyMap<string, LoadedAsset>;
  private readonly includesByPath: ReadonlyMap<string, LoadedAsset>;

  private constructor(
    private readonly semanticResources: SemanticResourcesPayload,
    private readonly semanticTerminology: SemanticTerminologyPayload,
    private readonly semanticNavigation: SemanticNavigationPayload,
    private readonly semanticConfig: SemanticConfigPayload,
    loadedAssets: LoadedAsset[],
  ) {
    this.metadataValue = Object.freeze(this.buildMetadata());
    this.resourceValues = Object.freeze(semanticResources.resources.map((entry) => deepFreeze(this.resource(entry))));
    const references = new Set<string>();
    for (const resource of this.resourceValues) {
      const reference = `${resource.type}/${resource.id}`;
      if (!references.add(reference)) {
        throw new Error(`Cycle semantic SiteBuild contains duplicate resource ${reference}`);
      }
    }
    this.pageValues = Object.freeze(this.flattenPages().map((page) => Object.freeze(page)));
    this.assetsByPath = new Map(loadedAssets
      .filter((asset) => asset.publicOutput)
      .map((asset) => [asset.name, Object.freeze(asset)]));
    this.includesByPath = new Map(loadedAssets
      .filter((asset) => !asset.publicOutput)
      .map((asset) => [asset.name, Object.freeze(asset)]));
  }

  static async fromClosedBuild(build: ClosedBuildHandle): Promise<CycleSiteBuild> {
    const assetKeys = assertV2Contract(build.manifest);
    const [resourcesValue, terminologyValue, navigationValue, configValue, loadedAssets] = await Promise.all([
      readJson(build, CYCLE_SEMANTIC_RESOURCES_ARTIFACT, 'Cycle semantic resources'),
      readJson(build, CYCLE_SEMANTIC_TERMINOLOGY_ARTIFACT, 'Cycle semantic terminology'),
      readJson(build, CYCLE_SEMANTIC_NAVIGATION_ARTIFACT, 'Cycle semantic navigation'),
      readJson(build, CYCLE_SEMANTIC_CONFIG_ARTIFACT, 'Cycle semantic config'),
      Promise.all(assetKeys.map(async (key): Promise<LoadedAsset> => {
        const parsed = authoredAssetKey(key)!;
        const artifact = build.artifactRecord(key);
        if (artifact.state.status !== 'ready' || !artifact.state.content.mediaType) {
          throw new Error(`Cycle authored asset ${parsed.path} must have a media type`);
        }
        return {
          name: parsed.path,
          mime: artifact.state.content.mediaType,
          bytes: await build.readArtifact(key),
          publicOutput: parsed.publicOutput,
        };
      })),
    ]);

    const resources = deepFreeze(decodeSemanticResources(resourcesValue));
    const terminology = deepFreeze(decodeSemanticTerminology(terminologyValue));
    const navigation = deepFreeze(decodeSemanticNavigation(navigationValue));
    const config = deepFreeze(decodeSemanticConfig(configValue));
    const resourceIds = new Map(resources.resources.map((entry) => [resourceKeyId(entry.key), entry]));
    for (const expansion of terminology.expansions) {
      const resource = resourceIds.get(resourceKeyId(expansion.valueSet));
      if (!resource) throw new Error(`Cycle terminology references missing ${resourceKeyId(expansion.valueSet)}`);
      const resourceUrl = scalarString(resource.resource.url);
      if (resourceUrl && resourceUrl !== expansion.url) {
        throw new Error(`Cycle terminology URL for ${resourceKeyId(expansion.valueSet)} does not match its resource`);
      }
    }

    loadedAssets.sort((left, right) => compareText(left.name, right.name));
    return new CycleSiteBuild(resources, terminology, navigation, config, loadedAssets);
  }

  metadata(): Record<string, string> {
    return { ...this.metadataValue };
  }

  resources(type?: string): CycleResource[] {
    const resources = type
      ? this.resourceValues.filter((resource) => resource.type === type)
      : this.resourceValues.slice();
    resources.sort((left, right) => type
      ? compareText(left.id, right.id)
      : compareText(left.type, right.type) || compareText(left.id, right.id));
    return resources;
  }

  valueSetCodes(url: string): { system: string; code: string; display?: string }[] {
    return this.semanticTerminology.expansions
      .filter((expansion) => expansion.url === url)
      .flatMap((expansion) => expansion.codes)
      .sort((left, right) => compareText(left.system, right.system) || compareText(left.code, right.code))
      .map((code) => ({
        system: code.system,
        code: code.code,
        ...(code.display ? { display: code.display } : {}),
      }));
  }

  concepts(resource: CycleResource): CycleConcept[] {
    const decode = (values: unknown): CycleConcept[] => !Array.isArray(values) ? [] : values.flatMap((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
      const concept = value as Record<string, unknown>;
      return [{
        code: scalarString(concept.code) || '',
        ...(scalarString(concept.display) ? { display: scalarString(concept.display) } : {}),
        ...(scalarString(concept.definition) ? { definition: scalarString(concept.definition) } : {}),
        children: decode(concept.concept),
      }];
    });
    return decode(resource.resource.concept);
  }

  pages(): CyclePage[] {
    return this.pageValues.map((page) => ({ ...page }));
  }

  menu(): SemanticMenuNode[] {
    return cloned(this.semanticNavigation.menu);
  }

  siteConfig(name: string): any {
    return name === 'sushi-config' ? cloned(this.semanticConfig.sushiConfig) : null;
  }

  textAsset(name: string): string | null {
    const asset = this.includesByPath.get(name) ?? this.assetsByPath.get(name);
    return asset && textualMime(asset.mime) ? new TextDecoder().decode(asset.bytes) : null;
  }

  assetCatalog(): CycleAssetDescriptor[] {
    return [...this.assetsByPath.values()].map((asset) => ({
      path: asset.name,
      mediaType: asset.mime,
    }));
  }

  asset(path: string): CycleAsset | null {
    const asset = this.assetsByPath.get(path);
    return asset ? { path: asset.name, mediaType: asset.mime, bytes: asset.bytes.slice() } : null;
  }

  ig(): any {
    const wanted = resourceKeyId(this.semanticResources.guide.implementationGuide);
    const entry = this.semanticResources.resources.find((candidate) => resourceKeyId(candidate.key) === wanted)!;
    const ig = cloned(entry.resource) as Record<string, any>;
    ig.contact = (ig.contact || []).map((contact: any) => ({
      ...contact,
      telecom: (contact.telecom || []).map((telecom: any) => telecom.value ?? telecom),
    }));
    return ig;
  }

  private buildMetadata(): Record<string, string> {
    const guide = this.semanticResources.guide;
    const compatibility = this.semanticResources.publisherCompatibility;
    const revision = guide.sourceControl?.revision || 'unknown';
    return {
      path: guide.fhirPublicationBase,
      canonical: guide.canonical || '',
      igId: guide.packageId,
      igName: guide.name || '',
      packageId: guide.packageId,
      igVer: guide.version || '',
      errorCount: compatibility?.errorCount || '0',
      version: guide.fhirVersion,
      releaseLabel: guide.releaseLabel || 'ci-build',
      revision,
      versionFull: guide.fhirVersion ? `${guide.fhirVersion}-${revision}` : revision,
      toolingVersion: compatibility?.toolingVersion || 'site-gen.publisher',
      toolingRevision: compatibility?.toolingRevision || '0',
      toolingVersionFull: compatibility?.toolingVersionFull || 'site-gen.publisher experiment',
      genDate: guide.generated.date,
      genDay: guide.generated.day,
      gitstatus: guide.sourceControl?.branch || 'unknown',
    };
  }

  private resource(entry: SemanticResourceEntry): CycleResource {
    const resource = entry.resource;
    const type = entry.key.resourceType;
    const primaryGuide = resourceKeyId(entry.key)
      === resourceKeyId(this.semanticResources.guide.implementationGuide);
    const id = primaryGuide
      ? this.semanticResources.guide.packageId
      : entry.key.id;
    const hasCanonical = typeof resource.url === 'string' && resource.url.length > 0;
    const displayName = entry.publication?.displayName
      || scalarString(resource.name)
      || scalarString(resource.title)
      || entry.key.id
      || type;
    const url = primaryGuide && this.semanticResources.guide.canonical
      ? `${this.semanticResources.guide.canonical.replace(/\/$/, '')}/ImplementationGuide/${id}`
      : hasCanonical ? String(resource.url) : null;
    return {
      key: entry.key,
      resource,
      type,
      id,
      page: primaryGuide ? 'index.html' : `${type}-${id}.html`,
      url,
      version: hasCanonical ? scalarString(resource.version) ?? null : null,
      status: scalarString(resource.status) ?? null,
      name: hasCanonical ? scalarString(resource.name) ?? null : displayName,
      title: scalarString(resource.title) ?? null,
      description: hasCanonical
        ? scalarString(resource.description) ?? null
        : entry.publication?.description || scalarString(resource.description) || null,
      derivation: scalarString(resource.derivation) ?? null,
      standardStatus: entry.publication?.standardStatus ?? null,
      kind: type === 'StructureDefinition' ? scalarString(resource.kind) ?? null : null,
      sdType: type === 'StructureDefinition' ? scalarString(resource.type) ?? null : null,
      base: type === 'StructureDefinition'
        ? entry.publication?.baseDefinition || scalarString(resource.baseDefinition) || null
        : null,
      content: scalarString(resource.content) ?? null,
      supplements: scalarString(resource.supplements) ?? null,
    };
  }

  private flattenPages(): CyclePage[] {
    const pages: CyclePage[] = [];
    const walk = (nodes: readonly SemanticPageNode[]): void => {
      for (const node of nodes) {
        const slug = node.nameUrl.replace(/\.html$/, '');
        if (slug && slug !== 'toc') {
          pages.push({
            slug,
            nameUrl: node.nameUrl,
            title: node.title,
            generation: node.generation,
            body: node.body ?? null,
          });
        }
        walk(node.children);
      }
    };
    walk(this.semanticNavigation.pages);
    return pages;
  }
}
