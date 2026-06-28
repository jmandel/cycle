import {
  canonicalNoVersion,
  isTerminologyPackageResource,
  resolvePackageEntry,
  resolvePublisherEntry,
  resolvePublisherResource,
  shouldReplaceTerminologyStubWithTxMetadata,
  type CanonicalIndex,
  type IndexedResource,
  type PublisherCanonicalIndexes,
} from './canonical';
import { fhirPublicationBaseForCorePackage, publicationBaseForPackage } from './fhir-versions';
import { resourceOidValues, type OidAssignments } from './oids';
import { pageFor, resourceRef } from './rows';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type Json = Record<string, any>;

export type ListRef = { type: 'Questionnaire' | 'StructureDefinition' | 'ValueSet'; resource: Json; web?: string };
type CodeSystemUsageRef = { type: string; resource: Json; web?: string };

export type ValueSetListRow = {
  key: number;
  viewType: number;
  resourceKey: number | null;
  url: string | null;
  version: string | null;
  status: string | null;
  name: string | null;
  title: string | null;
  description: string | null;
};

export type ValueSetListOidRow = { valueSetListKey: number; oid: string };
export type ValueSetListRefRow = {
  valueSetListKey: number;
  type: string;
  id: string;
  resourceKey: number | null;
  title: string;
  web: string;
};
export type ValueSetListSystemRow = { valueSetListKey: number; url: string };
export type ValueSetListSourceRow = { valueSetListKey: number; source: string };

export type CodeSystemListRow = {
  key: number;
  viewType: number;
  resourceKey: number | null;
  url: string | null;
  version: string | null;
  status: string | null;
  name: string | null;
  title: string | null;
  description: string | null;
};

export type CodeSystemListOidRow = { codeSystemListKey: number; oid: string };
export type CodeSystemListRefRow = {
  codeSystemListKey: number;
  type: string;
  id: string;
  resourceKey: number | null;
  title: string;
  web: string;
};

export type IndexedListRows = {
  valueSetRows: ValueSetListRow[];
  valueSetOidRows: ValueSetListOidRow[];
  valueSetRefRows: ValueSetListRefRow[];
  valueSetSystemRows: ValueSetListSystemRow[];
  valueSetSourceRows: ValueSetListSourceRow[];
  codeSystemRows: CodeSystemListRow[];
  codeSystemOidRows: CodeSystemListOidRow[];
  codeSystemRefRows: CodeSystemListRefRow[];
};

export function packageSourceLabel(indexes: { core: CanonicalIndex; dependencies: CanonicalIndex }, system: string): string | null {
  const coreEntries = codeSystemCandidates(indexes.core, system);
  const dependencyEntries = codeSystemCandidates(indexes.dependencies, system);
  const entries = system.startsWith('http://hl7.org/fhir/') && coreEntries.length
    ? coreEntries
    : [...dependencyEntries, ...coreEntries];
  const entry = preferredSourceLabelEntry(entries, preferredTerminologyFamily(indexes.core));
  const packageName = entry?.package?.name;
  if (!packageName) return null;
  if (entry?.package?.dir && !isFhirCorePackageName(packageName) && !hasPublishedPackagePath(entry)) return 'Internal';
  const terminologyMatch = packageName.match(/^hl7\.terminology\.r[3456]/);
  if (terminologyMatch) return terminologyMatch[0];
  if (packageName.startsWith('hl7.fhir.r3')) return 'hl7.fhir.r3.core';
  if (packageName.startsWith('hl7.fhir.r4b')) return 'hl7.fhir.r4b.core';
  if (packageName.startsWith('hl7.fhir.r4')) return 'hl7.fhir.r4.core';
  if (packageName.startsWith('hl7.fhir.r5')) return 'hl7.fhir.r5.core';
  if (packageName.startsWith('hl7.fhir.r6')) return 'hl7.fhir.r6.core';
  return packageName;
}

function codeSystemCandidates(index: CanonicalIndex, system: string): IndexedResource[] {
  const all = index.byCodeSystemUrlAll.get(system);
  if (all?.length) return all;
  const preferred = index.byCodeSystemUrl.get(system);
  return preferred ? [preferred] : [];
}

function preferredTerminologyFamily(coreIndex: CanonicalIndex): string | null {
  const corePackage = coreIndex.packages.find((pkg) => /^hl7\.fhir\.r(3|4|4b|5|6)\.core$/.test(pkg.name));
  if (!corePackage) return null;
  if (corePackage.name === 'hl7.fhir.r3.core') return 'hl7.terminology.r3';
  if (corePackage.name === 'hl7.fhir.r5.core' || corePackage.name === 'hl7.fhir.r6.core') return 'hl7.terminology.r5';
  return 'hl7.terminology.r4';
}

function isFhirCorePackageName(name: string | undefined): boolean {
  return /^hl7\.fhir\.r(3|4|4b|5|6)\.core$/.test(name || '');
}

function preferredSourceLabelEntry(entries: IndexedResource[], terminologyFamily: string | null): IndexedResource | undefined {
  const candidates = entries.filter((entry) => !(shouldReplaceTerminologyStubWithTxMetadata(entry.resource) && isTerminologyPackageResource(entry)));
  if (!candidates.length) return undefined;

  const internal = candidates.find((entry) => entry.package?.dir && !isFhirCorePackageName(entry.package.name) && !hasPublishedPackagePath(entry));
  if (internal) return internal;

  const nonTerminology = candidates.filter((entry) => !entry.package?.name?.startsWith('hl7.terminology.'));
  if (nonTerminology.length) return nonTerminology[0];

  const terminologyEntries = terminologyFamily
    ? candidates.filter((entry) => entry.package?.name === terminologyFamily)
    : [];
  const pool = terminologyEntries.length ? terminologyEntries : candidates;
  return [...pool].sort((a, b) => comparePackageVersionLike(a.package?.version, b.package?.version) || a.sourcePath.localeCompare(b.sourcePath)).at(-1);
}

function comparePackageVersionLike(a = '', b = ''): number {
  const aa = a.split(/[.-]/);
  const bb = b.split(/[.-]/);
  const len = Math.max(aa.length, bb.length);
  for (let i = 0; i < len; i++) {
    const av = aa[i] ?? '0';
    const bv = bb[i] ?? '0';
    const an = /^\d+$/.test(av) ? Number(av) : NaN;
    const bn = /^\d+$/.test(bv) ? Number(bv) : NaN;
    const cmp = Number.isFinite(an) && Number.isFinite(bn) ? an - bn : av.localeCompare(bv);
    if (cmp !== 0) return cmp;
  }
  return 0;
}

function hasPublishedPackagePath(entry: IndexedResource): boolean {
  const paths = specInternalsPaths(entry);
  if (!paths) return false;
  return Boolean(entry.resource?.url && paths.has(entry.resource.url));
}

/**
 * Match the Java Publisher's compact source labels for ValueSetListSources.
 *
 * Source:
 * ig-publisher/org.hl7.fhir.publisher.core/src/main/java/org/hl7/fhir/igtools/renderers/CrossViewRenderer.java
 * method describeSource(String uri).
 *
 * This is a package.db compatibility/indexing label, not terminology semantics.
 * Expansion and validation must use CodeSystem/ValueSet resources or a tx
 * service; this function only chooses the short label shown in list indexes.
 */
export function valueSetSystemSource(system: string, localCodeSystemUrls = new Set<string>(), packageSource?: string | null): string {
  if (localCodeSystemUrls.has(system)) return 'Internal';
  if (system === 'http://snomed.info/sct') return 'SCT';
  if (system === 'http://loinc.org') return 'LOINC';
  if (system === 'http://dicom.nema.org/resources/ontology/DCM') return 'DICOM';
  if (system === 'http://unitsofmeasure.org') return 'UCUM';
  if (system === 'http://www.nlm.nih.gov/research/umls/rxnorm') return 'RxNorm';
  if (system.startsWith('http://terminology.hl7.org/CodeSystem/v3-')) return 'THO (V3)';
  if (system.startsWith('http://terminology.hl7.org/CodeSystem/v2-')) return 'THO (V2)';
  if (system.startsWith('http://terminology.hl7.org')) return 'THO';
  if (packageSource) return packageSource;
  if (system.startsWith('http://hl7.org/fhir')) return 'FHIR';
  return 'Other';
}

export function isPublisherBuiltinExternalCodeSystem(system: string): boolean {
  return system === 'http://snomed.info/sct'
    || system === 'http://loinc.org'
    || system === 'http://dicom.nema.org/resources/ontology/DCM'
    || system === 'http://unitsofmeasure.org'
    || system === 'http://www.nlm.nih.gov/research/umls/rxnorm';
}

export function isPublisherNamespaceValueSetSystem(system: string): boolean {
  return system.startsWith('urn:ietf:bcp:')
    || system.startsWith('urn:iso:std:iso:')
    || system === 'http://unstats.un.org/unsd/methods/m49/m49.htm';
}

export function sourceForSystem(
  indexes: { core: CanonicalIndex; dependencies: CanonicalIndex },
  localCodeSystemUrls: Set<string>,
): (system: string) => string {
  return (system) => valueSetSystemSource(system, localCodeSystemUrls, packageSourceLabel(indexes, system));
}

export function additionalBindingValueSetUrls(binding: Json): string[] {
  const out: string[] = [];
  for (const ext of binding.extension || []) {
    if (ext.url !== 'http://hl7.org/fhir/tools/StructureDefinition/additional-binding') continue;
    for (const child of ext.extension || []) {
      if (child.url === 'valueSet') {
        const url = canonicalNoVersion(child.valueCanonical || child.valueUri || child.valueString);
        if (url) out.push(url);
      }
    }
  }
  return out;
}

export function bindingValueSetUrls(binding: Json | undefined): string[] {
  if (!binding) return [];
  const url = canonicalNoVersion(binding.valueSet);
  return [...new Set([...(url ? [url] : []), ...additionalBindingValueSetUrls(binding)])];
}

export function structureDefinitionBindingValueSetUrls(sd: Json, mode: 'differential' | 'snapshot'): string[] {
  const elements = mode === 'differential' ? sd.differential?.element : sd.snapshot?.element;
  return [...new Set((elements || []).flatMap((e: any) => bindingValueSetUrls(e.binding)))] as string[];
}

export function questionnaireAnswerValueSetUrlOccurrences(questionnaire: Json): string[] {
  const urls: string[] = [];
  const walk = (items: Json[] = []) => {
    for (const item of items) {
      const url = canonicalNoVersion(item.answerValueSet);
      if (url && !url.startsWith('#')) urls.push(url);
      if (Array.isArray(item.item)) walk(item.item);
    }
  };
  walk(questionnaire.item || []);
  return urls;
}

export function questionnaireAnswerValueSetUrls(questionnaire: Json): string[] {
  return [...new Set(questionnaireAnswerValueSetUrlOccurrences(questionnaire))].sort((a, b) => a.localeCompare(b));
}

export function containedQuestionnaireValueSets(resources: Json[]): Array<{ valueSet: Json; web: string }> {
  const out: Array<{ valueSet: Json; web: string }> = [];
  for (const questionnaire of resources.filter((r) => r.resourceType === 'Questionnaire' && r.id).sort((a, b) => a.id.localeCompare(b.id))) {
    for (const contained of questionnaire.contained || []) {
      if (contained?.resourceType !== 'ValueSet' || !contained.id) continue;
      out.push({
        valueSet: contained,
        web: `ValueSet-${questionnaire.id}_${contained.id}.html`,
      });
    }
  }
  return out;
}

export function mergeRefs(...groups: Array<ListRef[] | undefined>): ListRef[] {
  const out = new Map<string, ListRef>();
  for (const group of groups) {
    for (const ref of group || []) out.set(`${ref.type}/${ref.resource.id}`, ref);
  }
  return [...out.values()].sort((a, b) => `${a.type}/${a.resource.id}`.localeCompare(`${b.type}/${b.resource.id}`));
}

function idFromCanonical(url: string): string {
  return url.replace(/\|.+$/, '').split('/').pop() || url;
}

const specInternalsPathCache = new Map<string, Map<string, string>>();

function specInternalsPaths(source?: IndexedResource): Map<string, string> | null {
  const dir = source?.package?.dir;
  if (!dir) return null;
  const cached = specInternalsPathCache.get(dir);
  if (cached) return cached;
  const path = join(dir, 'other', 'spec.internals');
  if (!existsSync(path)) return null;
  const json = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
  const paths = new Map<string, string>();
  for (const [canonical, webPath] of Object.entries(json.paths || {})) {
    if (typeof canonical === 'string' && typeof webPath === 'string') paths.set(canonical, webPath);
  }
  specInternalsPathCache.set(dir, paths);
  return paths;
}

function packageWebPath(resource: Json, source?: IndexedResource): string | null {
  if (!resource?.url) return null;
  const packageBase = source?.package ? publicationBaseForPackage(source.package) : null;
  if (!packageBase) return null;
  const relativePath = specInternalsPaths(source)?.get(resource.url);
  return relativePath ? new URL(relativePath, packageBase).toString() : null;
}

export function externalValueSetWeb(vs: Json, source?: IndexedResource): string {
  if (source?.package?.name === 'fhir.dicom' && vs.id) return `http://tx.fhir.org/r4/ValueSet/${vs.id}`;
  if (source?.package?.name === 'us.nlm.vsac' && typeof vs.url === 'string' && vs.url.includes('cts.nlm.nih.gov')) {
    return `${vs.url.replace('http://cts.nlm.nih.gov/fhir/ValueSet/', 'https://vsac.nlm.nih.gov/valueset/')}/expansion`;
  }
  if (source?.package?.name?.startsWith('hl7.terminology') && source.package.version && vs.id) {
    return `http://terminology.hl7.org/${source.package.version}/ValueSet-${vs.id}.html`;
  }
  const metadataPath = packageWebPath(vs, source);
  if (metadataPath) return metadataPath;
  const fhirBase = source?.package ? fhirPublicationBaseForCorePackage(source.package) : null;
  if (fhirBase && vs.id && vs.url?.startsWith('http://terminology.hl7.org/ValueSet/v3-')) {
    return `${fhirBase}v3/${vs.id.replace(/^v3-/, '')}/vs.html`;
  }
  if (fhirBase && vs.id && vs.url?.startsWith('http://terminology.hl7.org/ValueSet/v2-')) {
    return `${fhirBase}v2/${vs.id.replace(/^v2-/, '')}/index.html`;
  }
  if (fhirBase && vs.url?.startsWith('http://hl7.org/fhir/ValueSet/')) return `${fhirBase}valueset-${idFromCanonical(vs.url)}.html`;
  return vs.url || pageFor(vs.resourceType, vs.id);
}

/**
 * Match FHIR's implicit ValueSet support for canonical URLs that do not have a
 * package resource. The Java Publisher exposes these through WorkerContext
 * findTxResource via ImplicitValueSets / ValueSetUtilities.
 */
export function implicitValueSetForUrl(url: string): Json | undefined {
  const clean = canonicalNoVersion(url) || url;
  if (clean === 'http://loinc.org/vs') {
    return {
      resourceType: 'ValueSet',
      url: clean,
      status: 'active',
      name: 'LOINCCodes',
      title: 'All LOINC codes',
      compose: { include: [{ system: 'http://loinc.org' }] },
    };
  }
  if (clean.startsWith('http://loinc.org/vs/LL')) {
    const code = clean.substring('http://loinc.org/vs/'.length);
    return {
      resourceType: 'ValueSet',
      url: clean,
      status: 'active',
      name: `LOINCAnswers${code}`,
      title: `LOINC Answer Codes for ${code}`,
      compose: { include: [{ system: 'http://loinc.org', filter: [{ property: 'LIST', op: '=', value: code }] }] },
    };
  }
  if (clean.startsWith('http://loinc.org/vs/LP')) {
    const code = clean.substring('http://loinc.org/vs/'.length);
    return {
      resourceType: 'ValueSet',
      url: clean,
      status: 'active',
      name: `LOINCPartList${code}`,
      title: `LOINC Codes for Part ${code}`,
      compose: { include: [{ system: 'http://loinc.org', filter: [{ property: 'ancestor', op: '=', value: code }] }] },
    };
  }
  if (clean === 'http://unitsofmeasure.org/vs') {
    return {
      resourceType: 'ValueSet',
      url: clean,
      status: 'active',
      name: 'AllUcumCodes',
      title: 'All Ucum Codes',
      compose: { include: [{ system: 'http://unitsofmeasure.org' }] },
    };
  }
  if (clean === 'http://hl7.org/fhir/ValueSet/mimetypes') {
    return {
      resourceType: 'ValueSet',
      url: clean,
      status: 'active',
      description: 'This value set includes all possible codes from BCP-13 (http://tools.ietf.org/html/bcp13)',
      compose: { include: [{ system: 'urn:ietf:bcp:13' }] },
    };
  }
  if (clean.startsWith('http://snomed.info/sct') && clean.includes('?fhir_vs')) {
    const query = clean.substring(clean.indexOf('?') + 1);
    if (query === 'fhir_vs') {
      return {
        resourceType: 'ValueSet',
        url: clean,
        status: 'active',
        name: 'SCTValueSetAll',
        title: 'All Codes SCT ValueSet',
        description: 'Value Set for All SNOMED CT Concepts',
        compose: { include: [{ system: 'http://snomed.info/sct' }] },
      };
    }
    if (query.startsWith('fhir_vs=isa/')) {
      const code = query.substring('fhir_vs=isa/'.length);
      return {
        resourceType: 'ValueSet',
        url: clean,
        status: 'active',
        name: `SCTValueSetFor${code}`,
        title: `SCT ValueSet for ${code}`,
        description: `SNOMED CT Concepts that is-a ${code}`,
        compose: { include: [{ system: 'http://snomed.info/sct', filter: [{ property: 'concept', op: 'is-a', value: code }] }] },
      };
    }
    if (query === 'fhir_vs=refset') {
      return {
        resourceType: 'ValueSet',
        url: clean,
        status: 'active',
        name: 'SCTReferenceSetList',
        title: 'SCT Reference Set List',
        description: 'SNOMED CT Reference Sets',
        compose: { include: [{ system: 'http://snomed.info/sct', filter: [{ property: 'concept', op: 'is-a', value: 'refset-base' }] }] },
      };
    }
    if (query.startsWith('fhir_vs=refset/')) {
      const code = query.substring('fhir_vs=refset/'.length);
      return {
        resourceType: 'ValueSet',
        url: clean,
        status: 'active',
        name: `SCTRefSet${code}`,
        title: `SCT Reference Set ${code}`,
        description: `SNOMED CT Reference Set ${code}`,
        compose: { include: [{ system: 'http://snomed.info/sct', filter: [{ property: 'concept', op: 'in', value: code }] }] },
      };
    }
  }
  return undefined;
}

export function valueSetDirectSystems(vs: Json): string[] {
  return [...new Set((vs.compose?.include || []).map((inc: any) => inc.system).filter(Boolean))] as string[];
}

export function valueSetFilterSystems(vs: Json): string[] {
  return [...new Set([...(vs.compose?.include || []), ...(vs.compose?.exclude || [])]
    .filter((component: any) => component.system && Array.isArray(component.filter) && component.filter.length > 0)
    .map((component: any) => component.system))] as string[];
}

function valueSetAllSystems(vs: Json, findValueSet: (url: string) => Json | undefined, seen = new Set<string>()): string[] {
  const systems = new Set(valueSetDirectSystems(vs));
  for (const inc of vs.compose?.include || []) {
    for (const nestedUrl of inc.valueSet || []) {
      const clean = canonicalNoVersion(nestedUrl);
      if (!clean || seen.has(clean)) continue;
      seen.add(clean);
      const nested = findValueSet(clean);
      if (nested) for (const system of valueSetAllSystems(nested, findValueSet, seen)) systems.add(system);
    }
  }
  return [...systems];
}

function importedValueSetUrls(vs: Json): string[] {
  return [...new Set((vs.compose?.include || []).flatMap((inc: any) => inc.valueSet || []).map(canonicalNoVersion).filter(Boolean))] as string[];
}

function sourcePriority(system: string, localCodeSystemUrls: Set<string>): number {
  const source = valueSetSystemSource(system, localCodeSystemUrls);
  if (source === 'FHIR') return 10;
  if (source === 'SCT') return 20;
  if (source.startsWith('THO')) return 30;
  if (source === 'Internal') return 40;
  return 90;
}

export function resolveValueSetForList(
  url: string,
  indexes: PublisherCanonicalIndexes,
): Json | undefined {
  return resolvePublisherResource(indexes, { resourceType: 'ValueSet', url }) || implicitValueSetForUrl(url);
}

function resolveValueSetSourceForList(
  url: string,
  indexes: PublisherCanonicalIndexes,
): IndexedResource | undefined {
  return resolvePackageEntry(indexes, { resourceType: 'ValueSet', url });
}

export function resolveCodeSystemForList(
  system: string,
  indexes: PublisherCanonicalIndexes,
): Json | undefined {
  const clean = canonicalNoVersion(system);
  if (!clean || clean !== system) return undefined;
  const entry = resolvePublisherEntry(indexes, { resourceType: 'CodeSystem', url: clean });
  if (!entry) return undefined;
  if (entry.sourcePath.startsWith('terminology:')) return entry.resource;
  // CrossViewRenderer fetches CodeSystem resources to populate list metadata.
  // A CodeSystem with content=not-present is still useful metadata here, even
  // though the terminology expander must not treat it as locally expandable.
  return entry.resource;
}

function conceptMapScopeValueSetUrls(conceptMap: Json): string[] {
  const urls = [
    conceptMap.sourceUri,
    conceptMap.sourceCanonical,
    conceptMap.sourceScopeUri,
    conceptMap.sourceScopeCanonical,
    conceptMap.targetUri,
    conceptMap.targetCanonical,
    conceptMap.targetScopeUri,
    conceptMap.targetScopeCanonical,
  ];
  return [...new Set(urls.map(canonicalNoVersion).filter(Boolean))] as string[];
}

function conceptMapDirectSystems(conceptMap: Json): string[] {
  return [...new Set((conceptMap.group || []).flatMap((group: any) => [group.source, group.target]).map(canonicalNoVersion).filter(Boolean))] as string[];
}

function operationDefinitionBindingValueSetUrls(operationDefinition: Json): string[] {
  return [...new Set((operationDefinition.parameter || []).flatMap((parameter: any) => bindingValueSetUrls(parameter.binding)))] as string[];
}

function addCodeSystemUsage(
  refs: Map<string, Map<string, CodeSystemUsageRef>>,
  system: string | null | undefined,
  ref: CodeSystemUsageRef,
) {
  if (!system || system.includes('|')) return;
  const clean = canonicalNoVersion(system || undefined);
  if (!clean || clean.includes('|') || clean.includes('?')) return;
  const key = `${ref.type}/${ref.resource.id || ref.resource.url || clean}`;
  if (!refs.has(clean)) refs.set(clean, new Map());
  refs.get(clean)!.set(key, ref);
}

function sortedCodeSystemUsageRefs(refs: Map<string, CodeSystemUsageRef>): CodeSystemUsageRef[] {
  return [...refs.values()].sort((a, b) => `${a.type}/${a.resource.id || ''}`.localeCompare(`${b.type}/${b.resource.id || ''}`));
}

export function deriveIndexedListRows(
  resources: Json[],
  keyByRef: Map<string, number>,
  indexes: PublisherCanonicalIndexes,
  options: { oidAssignments?: OidAssignments } = {},
): IndexedListRows {
  const rows: IndexedListRows = {
    valueSetRows: [],
    valueSetOidRows: [],
    valueSetRefRows: [],
    valueSetSystemRows: [],
    valueSetSourceRows: [],
    codeSystemRows: [],
    codeSystemOidRows: [],
    codeSystemRefRows: [],
  };

  const localByUrl = new Map(resources.filter((r) => r.url).map((r) => [r.url, r]));
  const localValueSets = resources.filter((r) => r.resourceType === 'ValueSet' && r.url).sort((a, b) => a.url.localeCompare(b.url));
  const containedValueSets = containedQuestionnaireValueSets(resources);
  const containedWeb = new WeakMap<Json, string>();
  const containedByUrl = new Map<string, Json>();
  for (const { valueSet, web } of containedValueSets) {
    containedWeb.set(valueSet, web);
    if (valueSet.url) containedByUrl.set(valueSet.url, valueSet);
  }
  const localCodeSystems = resources.filter((r) => r.resourceType === 'CodeSystem' && r.url).sort((a, b) => a.url.localeCompare(b.url));
  const localCodeSystemUrls = new Set(localCodeSystems.map((cs) => cs.url));
  const sourceLabelForSystem = sourceForSystem(indexes, localCodeSystemUrls);
  const profiles = resources.filter((r) => r.resourceType === 'StructureDefinition').sort((a, b) => a.id.localeCompare(b.id));
  const findValueSet = (url: string): Json | undefined => containedByUrl.get(url) || resolveValueSetForList(url, indexes);
  const findValueSetSource = (url: string): IndexedResource | undefined => resolveValueSetSourceForList(url, indexes);
  const findCodeSystem = (url: string): Json | undefined => resolveCodeSystemForList(url, indexes);
  const codeSystemUsageRefs = (mode: 'differential' | 'snapshot'): Map<string, Map<string, CodeSystemUsageRef>> => {
    const usage = new Map<string, Map<string, CodeSystemUsageRef>>();
    const addSystemsFromValueSet = (vs: Json | undefined, web?: string) => {
      if (!vs) return;
      for (const system of valueSetDirectSystems(vs)) addCodeSystemUsage(usage, system, { type: 'ValueSet', resource: vs, web });
    };
    const addBindingValueSets = (urls: string[]) => {
      for (const url of urls) {
        const vs = findValueSet(url);
        addSystemsFromValueSet(vs, vs ? containedWeb.get(vs) : undefined);
      }
    };
    const scan = (resource: Json) => {
      let scanContained = false;
      if (resource.resourceType === 'StructureDefinition') {
        addBindingValueSets(structureDefinitionBindingValueSetUrls(resource, mode));
        scanContained = true;
      } else if (resource.resourceType === 'Questionnaire') {
        addBindingValueSets(questionnaireAnswerValueSetUrls(resource));
        scanContained = true;
      } else if (resource.resourceType === 'ValueSet') {
        addSystemsFromValueSet(resource, containedWeb.get(resource));
        scanContained = true;
      } else if (resource.resourceType === 'ConceptMap') {
        addBindingValueSets(conceptMapScopeValueSetUrls(resource));
        for (const system of conceptMapDirectSystems(resource)) addCodeSystemUsage(usage, system, { type: 'ConceptMap', resource });
        scanContained = true;
      } else if (resource.resourceType === 'OperationDefinition') {
        addBindingValueSets(operationDefinitionBindingValueSetUrls(resource));
        scanContained = true;
      }
      if (scanContained) for (const contained of resource.contained || []) scan(contained);
    };
    for (const resource of resources) scan(resource);
    return usage;
  };
  const localBindings = new Map<string, ListRef[]>();
  const snapshotBindings = new Map<string, ListRef[]>();
  const artifactValueSetRefs = new Map<string, ListRef[]>();
  const questionnaireOccurrenceRefs = new Map<string, ListRef[]>();
  for (const sd of profiles) {
    for (const vsUrl of structureDefinitionBindingValueSetUrls(sd, 'differential')) {
      localBindings.set(vsUrl, [...(localBindings.get(vsUrl) || []), { type: 'StructureDefinition', resource: sd }]);
    }
    for (const vsUrl of structureDefinitionBindingValueSetUrls(sd, 'snapshot')) {
      snapshotBindings.set(vsUrl, [...(snapshotBindings.get(vsUrl) || []), { type: 'StructureDefinition', resource: sd }]);
    }
  }
  for (const questionnaire of resources.filter((r) => r.resourceType === 'Questionnaire' && r.id).sort((a, b) => a.id.localeCompare(b.id))) {
    for (const vsUrl of questionnaireAnswerValueSetUrlOccurrences(questionnaire)) {
      artifactValueSetRefs.set(vsUrl, [...(artifactValueSetRefs.get(vsUrl) || []), { type: 'Questionnaire', resource: questionnaire }]);
      questionnaireOccurrenceRefs.set(vsUrl, [...(questionnaireOccurrenceRefs.get(vsUrl) || []), { type: 'Questionnaire', resource: questionnaire }]);
    }
  }

  const valueSetImportRefs = new Map<string, ListRef[]>();
  for (const vs of [...localValueSets, ...containedValueSets.map((entry) => entry.valueSet)]) {
    for (const importedUrl of importedValueSetUrls(vs)) {
      valueSetImportRefs.set(importedUrl, [...(valueSetImportRefs.get(importedUrl) || []), { type: 'ValueSet', resource: vs, web: containedWeb.get(vs) }]);
    }
  }

  const valueSetRows: { key: number; view: number; vs: Json; refs: ListRef[]; local: boolean }[] = [];
  const addValueSetRow = (view: number, vs: Json, refs: ListRef[], local: boolean) => {
    const key = valueSetRows.length + 1;
    const resourceKey = local ? keyByRef.get(resourceRef(vs)) ?? null : null;
    rows.valueSetRows.push({
      key,
      viewType: view,
      resourceKey,
      url: vs.url ?? null,
      version: vs.version ?? null,
      status: vs.status ?? null,
      name: vs.name ?? null,
      title: vs.title ?? null,
      description: vs.description ?? null,
    });
    for (const oid of resourceOidValues(vs, local ? options.oidAssignments : undefined)) rows.valueSetOidRows.push({ valueSetListKey: key, oid });
    for (const system of valueSetAllSystems(vs, findValueSet)) rows.valueSetSystemRows.push({ valueSetListKey: key, url: system });
    for (const system of valueSetDirectSystems(vs)) rows.valueSetSourceRows.push({ valueSetListKey: key, source: sourceLabelForSystem(system) });
    for (const ref of refs) {
      rows.valueSetRefRows.push({
        valueSetListKey: key,
        type: ref.type,
        id: ref.resource.id,
        resourceKey: keyByRef.get(resourceRef(ref.resource)) ?? null,
        title: ref.resource.title ?? ref.resource.name ?? ref.resource.id,
        web: ref.web || pageFor(ref.type, ref.resource.id),
      });
    }
    valueSetRows.push({ key, view, vs, refs, local });
  };

  for (const vs of localValueSets) addValueSetRow(1, vs, [], true);
  for (const vs of localValueSets) {
    addValueSetRow(2, vs, mergeRefs(localBindings.get(vs.url), artifactValueSetRefs.get(vs.url), valueSetImportRefs.get(vs.url)), true);
  }
  for (const { valueSet } of containedValueSets) addValueSetRow(2, valueSet, [], false);
  for (const url of [...new Set([...localBindings.keys(), ...artifactValueSetRefs.keys()])].sort((a, b) => a.localeCompare(b))) {
    if (localByUrl.has(url)) continue;
    if (containedByUrl.has(url)) continue;
    const vs = findValueSet(url);
    if (vs) {
      const source = findValueSetSource(url);
      const occurrences = !source && implicitValueSetForUrl(url) ? questionnaireOccurrenceRefs.get(url) || [] : [];
      if (occurrences.length) {
        for (const ref of occurrences) addValueSetRow(2, vs, [ref], false);
      } else {
        addValueSetRow(2, vs, mergeRefs(localBindings.get(url), artifactValueSetRefs.get(url), valueSetImportRefs.get(url)), Boolean(localByUrl.get(url)));
      }
    }
  }
  for (const url of [...valueSetImportRefs.keys()].sort((a, b) => a.localeCompare(b))) {
    if (localByUrl.has(url) || containedByUrl.has(url)) continue;
    const already = valueSetRows.some((row) => row.view === 2 && row.vs.url === url);
    if (already) continue;
    const vs = findValueSet(url);
    if (vs) addValueSetRow(2, vs, mergeRefs(valueSetImportRefs.get(url)), false);
  }

  const externalUrls = [...new Set([...snapshotBindings.keys(), ...artifactValueSetRefs.keys()])]
    .filter((url) => !localByUrl.has(url))
    .sort((a, b) => a.localeCompare(b));
  for (const { valueSet } of containedValueSets) addValueSetRow(3, valueSet, [], false);
  for (const url of externalUrls) {
    if (containedByUrl.has(url)) continue;
    const vs = findValueSet(url);
    if (vs) {
      const source = findValueSetSource(url);
      const occurrences = !source && implicitValueSetForUrl(url) ? questionnaireOccurrenceRefs.get(url) || [] : [];
      if (occurrences.length) {
        for (const ref of occurrences) addValueSetRow(3, vs, [ref], false);
      } else {
        addValueSetRow(3, vs, mergeRefs(snapshotBindings.get(url), artifactValueSetRefs.get(url), valueSetImportRefs.get(url)), false);
      }
    }
  }
  for (const url of [...valueSetImportRefs.keys()].sort((a, b) => a.localeCompare(b))) {
    if (localByUrl.has(url) || containedByUrl.has(url)) continue;
    const already = valueSetRows.some((row) => row.view === 3 && row.vs.url === url);
    if (already) continue;
    const vs = findValueSet(url);
    if (vs) addValueSetRow(3, vs, mergeRefs(valueSetImportRefs.get(url)), false);
  }
  for (const vs of localValueSets) {
    addValueSetRow(3, vs, mergeRefs(snapshotBindings.get(vs.url), artifactValueSetRefs.get(vs.url), valueSetImportRefs.get(vs.url)), true);
  }

  const codeSystemRows: { key: number; view: number; cs: Json; refs: CodeSystemUsageRef[]; local: boolean; system: string }[] = [];
  const codeSystemRefWeb = (ref: CodeSystemUsageRef): string => {
    const refResource = ref.resource;
    if (ref.web) return ref.web;
    const contained = containedWeb.get(refResource);
    if (contained) return contained;
    if (ref.type === 'ValueSet' && !keyByRef.has(resourceRef(refResource))) {
      return externalValueSetWeb(refResource, findValueSetSource(refResource.url));
    }
    return pageFor(ref.type, refResource.id);
  };
  const addCodeSystemRow = (view: number, system: string, refs: CodeSystemUsageRef[], local: boolean) => {
    if (system.includes('|')) return;
    const cs = findCodeSystem(system);
    if (!cs) return;
    const key = codeSystemRows.length + 1;
    const resourceKey = local ? keyByRef.get(resourceRef(cs)) ?? null : null;
    rows.codeSystemRows.push({
      key,
      viewType: view,
      resourceKey,
      url: cs.url ?? null,
      version: cs.version ?? null,
      status: cs.status ?? null,
      name: cs.name ?? null,
      title: cs.title ?? null,
      description: cs.description ?? null,
    });
    for (const oid of resourceOidValues(cs, local ? options.oidAssignments : undefined)) rows.codeSystemOidRows.push({ codeSystemListKey: key, oid });
    for (const ref of refs) {
      const refResource = ref.resource;
      if (!refResource.id) continue;
      rows.codeSystemRefRows.push({
        codeSystemListKey: key,
        type: ref.type,
        id: refResource.id || refResource.url,
        resourceKey: local ? resourceKey : null,
        title: refResource.title ?? refResource.name ?? refResource.id ?? refResource.url,
        web: codeSystemRefWeb(ref),
      });
    }
    codeSystemRows.push({ key, view, cs, refs, local, system });
  };

  for (const cs of localCodeSystems) addCodeSystemRow(1, cs.url, [], true);

  for (const [system, refs] of [...codeSystemUsageRefs('differential').entries()].sort(([a], [b]) => a.localeCompare(b))) {
    addCodeSystemRow(2, system, sortedCodeSystemUsageRefs(refs), localCodeSystemUrls.has(system));
  }

  const dependencySystems = [...codeSystemUsageRefs('snapshot').entries()]
    .filter(([system]) => findCodeSystem(system))
    .sort(([a], [b]) => sourcePriority(a, localCodeSystemUrls) - sourcePriority(b, localCodeSystemUrls) || a.localeCompare(b));
  for (const [system, refs] of dependencySystems) addCodeSystemRow(3, system, sortedCodeSystemUsageRefs(refs), localCodeSystemUrls.has(system));

  return rows;
}
