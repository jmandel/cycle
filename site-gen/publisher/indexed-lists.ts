import {
  canonicalNoVersion,
  resolvePackageEntry,
  resolvePublisherResource,
  type CanonicalIndex,
  type IndexedResource,
  type PublisherCanonicalIndexes,
} from './canonical';
import { fhirPublicationBaseForCorePackage } from './fhir-versions';
import { resourceOidValues, type OidAssignments } from './oids';
import { pageFor, resourceRef } from './rows';

type Json = Record<string, any>;

export type ListRef = { type: 'Questionnaire' | 'StructureDefinition' | 'ValueSet'; resource: Json; web?: string };

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
  const coreEntry = indexes.core.byCodeSystemUrl.get(system);
  const dependencyEntry = indexes.dependencies.byCodeSystemUrl.get(system);
  const entry = system.startsWith('http://hl7.org/fhir/')
    ? coreEntry || dependencyEntry
    : dependencyEntry || coreEntry;
  const packageName = entry?.package?.name;
  if (!packageName) return null;
  const terminologyMatch = packageName.match(/^hl7\.terminology\.r[3456]/);
  if (terminologyMatch) return terminologyMatch[0];
  if (packageName.startsWith('hl7.fhir.r3')) return 'hl7.fhir.r3.core';
  if (packageName.startsWith('hl7.fhir.r4b')) return 'hl7.fhir.r4b.core';
  if (packageName.startsWith('hl7.fhir.r4')) return 'hl7.fhir.r4.core';
  if (packageName.startsWith('hl7.fhir.r5')) return 'hl7.fhir.r5.core';
  if (packageName.startsWith('hl7.fhir.r6')) return 'hl7.fhir.r6.core';
  return packageName;
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

export function externalValueSetWeb(vs: Json, source?: IndexedResource): string {
  if (source?.package?.name === 'fhir.dicom' && vs.id) return `http://tx.fhir.org/r4/ValueSet/${vs.id}`;
  if (source?.package?.name?.startsWith('hl7.terminology') && source.package.version && vs.id) {
    return `http://terminology.hl7.org/${source.package.version}/ValueSet-${vs.id}.html`;
  }
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
  return resolvePublisherResource(indexes, { resourceType: 'CodeSystem', url: clean });
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
        addValueSetRow(2, vs, mergeRefs(localBindings.get(url), artifactValueSetRefs.get(url)), Boolean(localByUrl.get(url)));
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
        addValueSetRow(3, vs, mergeRefs(snapshotBindings.get(url), artifactValueSetRefs.get(url)), false);
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

  const codeSystemRows: { key: number; view: number; cs: Json; refs: Json[]; local: boolean; system: string }[] = [];
  const addCodeSystemRow = (view: number, system: string, refs: Json[], local: boolean) => {
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
      rows.codeSystemRefRows.push({
        codeSystemListKey: key,
        type: 'ValueSet',
        id: ref.id,
        resourceKey: local ? resourceKey : null,
        title: ref.title ?? ref.name ?? ref.id,
        web: containedWeb.get(ref) || (localByUrl.has(ref.url) ? pageFor('ValueSet', ref.id) : externalValueSetWeb(ref, findValueSetSource(ref.url))),
      });
    }
    codeSystemRows.push({ key, view, cs, refs, local, system });
  };

  for (const cs of localCodeSystems) addCodeSystemRow(1, cs.url, [], true);

  const localUsedValueSets = valueSetRows.filter((row) => row.view === 2).map((row) => row.vs);
  const systemsFor = (valueSets: Json[]) => {
    const refs = new Map<string, Json[]>();
    for (const vs of valueSets) {
      for (const system of valueSetDirectSystems(vs)) refs.set(system, [...(refs.get(system) || []), vs]);
    }
    return [...refs.entries()].sort(([a], [b]) => a.localeCompare(b));
  };
  for (const [system, refs] of systemsFor(localUsedValueSets)) addCodeSystemRow(2, system, refs, Boolean(localByUrl.get(system)));

  const allDependencyValueSets = valueSetRows.filter((r) => r.view === 3).map((r) => r.vs);
  const dependencySystems = systemsFor(allDependencyValueSets)
    .filter(([system]) => findCodeSystem(system))
    .sort(([a], [b]) => sourcePriority(a, localCodeSystemUrls) - sourcePriority(b, localCodeSystemUrls) || a.localeCompare(b));
  for (const [system, refs] of dependencySystems) addCodeSystemRow(3, system, refs, Boolean(localByUrl.get(system)));

  return rows;
}
