/**
 * Pure Cycle site renderer shared by the native CLI and browser worker.
 *
 * The renderer consumes a callback-free SiteBuildView. It performs semantic
 * preparation, page selection, and React SSR without opening SQLite, touching
 * the filesystem, consulting global state, or asking a compiler for artifacts.
 * Content policy is injected explicitly; the standard CLI and browser policy
 * is shared by `core/content.ts` over the same closed inputs.
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Layout } from '../chrome/Layout';
import type { Crumb, TocItem } from '../chrome/Layout';
import { ProfilePage } from '../fhir/ProfilePage';
import type { ProfileExampleUse, ProfileRequirement } from '../fhir/ProfilePage';
import { ArtifactsPage } from '../fhir/ArtifactsPage';
import { ValueSetPage } from '../fhir/ValueSetPage';
import { CodeSystemPage } from '../fhir/CodeSystemPage';
import { ExamplePage } from '../fhir/ExamplePage';
import { ResourcePage } from '../fhir/ResourcePage';
import type { ResolveType } from '../fhir/ElementTable';
import { renderMarkdown, sanitizeMarkdownSource } from './markdown';
import type { MenuRow, PageRow, ResourceRow, SiteBuildView } from './site-build';
import { compareText } from './order';

export type IncludeGenerator = (ig: unknown, params: Record<string, string>) => string;
export type IncludeRegistry = Record<string, IncludeGenerator>;

export interface CycleProjectView {
  profileGroups?: readonly { label: string; ids: readonly string[] }[];
  cname?: string;
}

/** All closed data a Liquid implementation may read. None of these functions
 * resolves a missing artifact through a compiler or renderer callback. */
export interface CycleContentContext {
  view: SiteBuildView;
  ig: any;
  siteData: Record<string, any>;
  includes: IncludeRegistry;
  fhirVersion: string;
  generatedFragment(name: string): string | null;
  textAsset(name: string): string | null;
  resolveFragmentResource(type: string, id: string): any | null;
}

export interface CycleContentRequest {
  file: string;
  slug: string;
  title: string;
  context: CycleContentContext;
}

export interface CycleContentRenderer {
  /** Called once after the immutable semantic context has been prepared. */
  prepare?(context: CycleContentContext): void;
  renderLiquid(source: string, request: CycleContentRequest): string;
}

export interface CycleRendererOptions {
  content: CycleContentRenderer;
  includes?: IncludeRegistry;
  project?: CycleProjectView;
}

export type PageKind =
  | 'narrative'
  | 'artifacts'
  | 'toc'
  | 'validation'
  | 'profile'
  | 'profile-companion'
  | 'valueset'
  | 'codesystem'
  | 'example'
  | 'generic';

export interface PageDescriptor {
  file: string;
  title: string;
  kind: PageKind;
}

export interface RenderedOutput {
  file: string;
  content: string | Uint8Array;
  mime: string;
}

export interface RenderedPage {
  file: string;
  html: string;
  /** Non-HTML siblings (resolved Markdown and machine JSON). These are members
   * of `listOutputs()` and therefore required generator outputs. */
  outputs: RenderedOutput[];
}

export interface CycleOutputDescriptor {
  file: string;
  mime: string;
  kind: 'page' | 'auxiliary' | 'asset';
  producer: string;
  owner?: string;
}

const RESOURCE_SORT = 'http://hl7.org/fhir/tools/StructureDefinition/resource-sort';
const EXAMPLE_PROFILE_EXTENSION = 'http://hl7.org/fhir/5.0/StructureDefinition/extension-ImplementationGuide.definition.resource.profile';
const PRIMARY_RESOURCE_TYPES = new Set(['StructureDefinition', 'ValueSet', 'CodeSystem', 'ImplementationGuide']);
const PRIMS = new Set(['boolean', 'integer', 'string', 'decimal', 'uri', 'url', 'canonical', 'base64Binary', 'instant', 'date', 'dateTime', 'time', 'code', 'oid', 'id', 'markdown', 'unsignedInt', 'positiveInt', 'uuid', 'xhtml']);
const DTYPES = new Set(['CodeableConcept', 'Coding', 'Quantity', 'Reference', 'Period', 'Identifier', 'Range', 'Ratio', 'Annotation', 'Attachment', 'HumanName', 'Address', 'ContactPoint', 'Timing', 'Money', 'Age', 'Duration', 'SampledData', 'Signature', 'Meta', 'Narrative', 'Extension', 'BackboneElement', 'Element', 'Dosage']);
const FHIR_CORE_DOC_PAGES = new Set([
  'account.html', 'activitydefinition.html', 'adverseevent.html', 'allergyintolerance.html',
  'appointment.html', 'appointmentresponse.html', 'auditevent.html', 'basic.html',
  'binary.html', 'bundle.html', 'capabilitystatement.html', 'careplan.html',
  'careteam.html', 'catalogentry.html', 'chargeitem.html', 'claim.html',
  'claimresponse.html', 'clinicalimpression.html', 'codesystem.html', 'communication.html',
  'communicationrequest.html', 'compartmentdefinition.html', 'composition.html', 'conceptmap.html',
  'condition.html', 'consent.html', 'contract.html', 'coverage.html',
  'coverageeligibilityrequest.html', 'coverageeligibilityresponse.html', 'detectedissue.html', 'device.html',
  'devicedefinition.html', 'devicemetric.html', 'devicerequest.html', 'deviceusestatement.html',
  'diagnosticreport.html', 'documentmanifest.html', 'documentreference.html', 'effectevidencesynthesis.html',
  'encounter.html', 'endpoint.html', 'enrollmentrequest.html', 'enrollmentresponse.html',
  'episodeofcare.html', 'eventdefinition.html', 'evidence.html', 'evidencevariable.html',
  'examplescenario.html', 'explanationofbenefit.html', 'familymemberhistory.html', 'flag.html',
  'goal.html', 'graphdefinition.html', 'group.html', 'guidanceresponse.html',
  'healthcareservice.html', 'imagingstudy.html', 'immunization.html', 'immunizationevaluation.html',
  'immunizationrecommendation.html', 'implementationguide.html', 'insuranceplan.html', 'invoice.html',
  'library.html', 'linkage.html', 'list.html', 'location.html',
  'measure.html', 'measurereport.html', 'media.html', 'medication.html',
  'medicationadministration.html', 'medicationdispense.html', 'medicationknowledge.html', 'medicationrequest.html',
  'medicationstatement.html', 'medicinalproduct.html', 'messageheader.html', 'molecularsequence.html',
  'namingsystem.html', 'nutritionorder.html', 'observation.html', 'observation-vitalsigns.html',
  'operationdefinition.html', 'operationoutcome.html', 'organization.html', 'organizationaffiliation.html',
  'parameters.html', 'patient.html', 'paymentnotice.html', 'paymentreconciliation.html',
  'person.html', 'plandefinition.html', 'practitioner.html', 'practitionerrole.html',
  'procedure.html', 'provenance.html', 'questionnaire.html', 'questionnaireresponse.html',
  'relatedperson.html', 'requestgroup.html', 'researchdefinition.html', 'researchelementdefinition.html',
  'researchstudy.html', 'researchsubject.html', 'riskassessment.html', 'riskevidencesynthesis.html',
  'schedule.html', 'searchparameter.html', 'servicerequest.html', 'slot.html',
  'specimen.html', 'specimendefinition.html', 'structuredefinition.html', 'structuremap.html',
  'subscription.html', 'substance.html', 'supplydelivery.html',
  'supplyrequest.html', 'task.html', 'terminologycapabilities.html', 'testreport.html',
  'testscript.html', 'valueset.html', 'verificationresult.html', 'visionprescription.html',
  'datatypes.html', 'references.html', 'extensibility.html', 'profiling.html',
  'terminologies.html', 'resource.html', 'formats.html',
  'overview.html', 'overview-clinical.html', 'overview-dev.html', 'conformance-rules.html',
  'secpriv-module.html', 'safety.html', 'http.html', 'validation.html', 'versions.html',
  'license.html', 'narrative.html', 'elementdefinition.html', 'domainresource-definitions.html',
  'metadatatypes.html', 'questionnaire-definitions.html', 'terminology-service.html',
  'operation-valueset-expand.html', 'operation-valueset-validate-code.html',
]);

function firstFhirVersion(ig: any, metadata: Record<string, string>): string {
  if (typeof ig.fhirVersion === 'string' && ig.fhirVersion) return ig.fhirVersion;
  if (Array.isArray(ig.fhirVersion) && typeof ig.fhirVersion[0] === 'string') return ig.fhirVersion[0];
  return metadata.version || '4.0.1';
}

function coreDocumentationBase(fhirVersion: string): string {
  if (fhirVersion.startsWith('4.3.') || fhirVersion.startsWith('4.1.')) return 'https://hl7.org/fhir/R4B/';
  if (fhirVersion.startsWith('5.')) return 'https://hl7.org/fhir/R5/';
  if (fhirVersion.startsWith('6.')) return 'https://hl7.org/fhir/R6/';
  return 'https://hl7.org/fhir/R4/';
}

const SIMPLE_LIST_TYPES: Record<string, string> = {
  allergyintolerances: 'AllergyIntolerance', bundles: 'Bundle', codesystems: 'CodeSystem',
  compositions: 'Composition', conditions: 'Condition', devices: 'Device',
  deviceusestatements: 'DeviceUseStatement', diagnosticreports: 'DiagnosticReport',
  imagingstudies: 'ImagingStudy', immunizations: 'Immunization', media: 'Media',
  medications: 'Medication', medicationrequests: 'MedicationRequest',
  medicationstatements: 'MedicationStatement', observations: 'Observation',
  organizations: 'Organization', patients: 'Patient', practitioners: 'Practitioner',
  practitionerroles: 'PractitionerRole', procedures: 'Procedure', specimen: 'Specimen',
  valuesets: 'ValueSet',
};

function esc(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

class SiteContext {
  readonly meta: Record<string, string>;
  readonly all: ResourceRow[];
  readonly igResource: any;
  readonly menuRows: MenuRow[];
  readonly liquidSiteData: Record<string, any>;
  readonly byUrl = new Map<string, string>();
  readonly artifactHrefByLocalTarget = new Map<string, string>();
  readonly resourcesByReference = new Map<string, ResourceRow>();
  readonly sortRanks = new Map<string, number>();
  readonly exampleRefs = new Set<string>();
  readonly exampleProfilesByReference = new Map<string, string[]>();
  readonly navMap: Record<string, string> = { index: 'Home', artifacts: 'Artifacts' };
  readonly menuById: Map<number, MenuRow>;
  readonly structureDefinitions: ResourceRow[];
  readonly structureDefinitionRowsByUrl = new Map<string, ResourceRow>();
  readonly structureDefinitionDataByUrl = new Map<string, any>();
  readonly derivedProfiles = new Map<string, string[]>();
  readonly artifactsNav: string;
  readonly fhirVersion: string;
  readonly coreDocsBase: string;

  constructor(
    readonly view: SiteBuildView,
    private readonly project: CycleProjectView,
  ) {
    this.meta = view.metadata();
    this.all = view.resources();
    this.igResource = view.ig();
    this.fhirVersion = firstFhirVersion(this.igResource, this.meta);
    this.coreDocsBase = coreDocumentationBase(this.fhirVersion);
    for (const row of this.all) {
      const href = this.page(row);
      if (row.Url) this.byUrl.set(row.Url, href);
      this.artifactHrefByLocalTarget.set(`${row.Type}-${row.Id}`, href);
      this.artifactHrefByLocalTarget.set(`${row.Type}/${row.Id}`, href);
      this.resourcesByReference.set(`${row.Type}/${row.Id}`, row);
    }
    for (const resource of this.igResource.definition?.resource || []) {
      const reference = resource.reference?.reference;
      const sort = (resource.extension || []).find((extension: any) => extension.url === RESOURCE_SORT)?.valueInteger;
      if (reference && typeof sort === 'number') this.sortRanks.set(reference, sort);
      if (!reference) continue;
      const profiles = new Set<string>();
      if (resource.exampleCanonical) profiles.add(resource.exampleCanonical);
      if (Array.isArray(resource.profile)) for (const profile of resource.profile) profiles.add(profile);
      for (const extension of resource.extension || []) {
        if (extension.url !== EXAMPLE_PROFILE_EXTENSION) continue;
        if (Array.isArray(extension.valueCanonical)) {
          for (const profile of extension.valueCanonical) profiles.add(profile);
        } else if (extension.valueCanonical) profiles.add(extension.valueCanonical);
      }
      if (resource.exampleBoolean || resource.exampleCanonical || profiles.size) this.exampleRefs.add(reference);
      if (profiles.size) this.exampleProfilesByReference.set(reference, [...profiles]);
    }
    this.liquidSiteData = this.publisherStyleSiteData(this.igResource, this.meta);
    this.menuRows = view.menu();
    this.menuById = new Map(this.menuRows.map((row) => [row.Id, row]));
    for (const row of this.menuRows) {
      if (!row.Href) continue;
      const slug = row.Href.split('#')[0].replace(/\.html$/, '');
      if (slug) this.navMap[slug] = this.topMenuLabel(row);
    }
    this.artifactsNav = this.navMap.artifacts || 'Artifacts';
    this.structureDefinitions = this.artifactResources('StructureDefinition');
    this.structureDefinitionRowsByUrl = new Map(
      this.structureDefinitions.filter((row) => row.Url).map((row) => [row.Url!, row]),
    );
    for (const row of this.structureDefinitions) {
      if (!row.Url) continue;
      const data = this.structureDefinitionData(row);
      const base = data.baseDefinition;
      if (!base || !this.byUrl.has(base)) continue;
      this.derivedProfiles.set(base, [...(this.derivedProfiles.get(base) || []), row.Url]);
    }
  }

  page(row: ResourceRow): string { return `${row.Type}-${row.Id}.html`; }
  resourceReference(row: ResourceRow): string { return `${row.Type}/${row.Id}`; }
  topMenuLabel(row: MenuRow): string {
    let current = row;
    while (current.ParentId != null && this.menuById.has(current.ParentId)) current = this.menuById.get(current.ParentId)!;
    return current.Label;
  }
  isExampleRow(row: ResourceRow): boolean {
    return !PRIMARY_RESOURCE_TYPES.has(row.Type) && this.exampleRefs.has(this.resourceReference(row));
  }
  isGenericResourcePageRow(row: ResourceRow): boolean {
    return !PRIMARY_RESOURCE_TYPES.has(row.Type) && !this.isExampleRow(row);
  }
  artifactRank(row: ResourceRow): number { return this.sortRanks.get(this.resourceReference(row)) ?? 100000; }
  byArtifactOrder = (left: ResourceRow, right: ResourceRow): number =>
    this.artifactRank(left) - this.artifactRank(right)
      || compareText(left.Title || left.Name || left.Id, right.Title || right.Name || right.Id);
  artifactResources(type?: string): ResourceRow[] {
    return this.all.filter((row) => !type || row.Type === type).sort(this.byArtifactOrder);
  }
  exampleResources(): ResourceRow[] { return this.artifactResources().filter((row) => this.isExampleRow(row)); }
  structureDefinitionData(row: ResourceRow): any {
    if (row.Url && this.structureDefinitionDataByUrl.has(row.Url)) return this.structureDefinitionDataByUrl.get(row.Url);
    const data = this.view.parse(row);
    if (row.Url) this.structureDefinitionDataByUrl.set(row.Url, data);
    return data;
  }
  localAuthoredElementChain(data: any): any[] {
    const chain: any[] = [];
    const seen = new Set<string>();
    const visit = (definition: any) => {
      const url = definition?.url;
      if (url) {
        if (seen.has(url)) return;
        seen.add(url);
      }
      const baseRow = definition?.baseDefinition ? this.structureDefinitionRowsByUrl.get(definition.baseDefinition) : undefined;
      if (baseRow) visit(this.structureDefinitionData(baseRow));
      chain.push(...(definition?.differential?.element || []));
    };
    visit(data);
    return chain;
  }
  profileAndDerivedUrls(url: string): Set<string> {
    const result = new Set<string>();
    const visit = (candidate: string) => {
      if (!candidate || result.has(candidate)) return;
      result.add(candidate);
      for (const child of this.derivedProfiles.get(candidate) || []) visit(child);
    };
    visit(url);
    return result;
  }
  profileRootRequirements(data: any, rootType: string): ProfileRequirement[] {
    const root = (data.differential?.element || []).find((element: any) => element.path === rootType);
    return (root?.constraint || []).filter((constraint: any) => constraint.key && constraint.human);
  }
  profileExamples(profileUrl: string): ProfileExampleUse[] {
    if (!profileUrl) return [];
    const accepted = this.profileAndDerivedUrls(profileUrl);
    const examples: ProfileExampleUse[] = [];
    for (const row of this.exampleResources()) {
      const profiles = this.exampleProfilesByReference.get(this.resourceReference(row)) || [];
      if (!profiles.some((profile) => accepted.has(profile))) continue;
      const data = this.view.parse(row);
      const code = JSON.stringify(data, null, 2);
      const direct = profiles.includes(profileUrl);
      const inlineable = direct && row.Type !== 'Bundle' && code.length <= 16000;
      examples.push({
        title: row.Title || row.Name || row.Id,
        href: this.page(row),
        jsonHref: `${row.Type}-${row.Id}.json`,
        count: 1,
        direct,
        resourceTypes: [row.Type],
        ...(inlineable ? { preview: { filename: `${row.Type}-${row.Id}.json`, code } } : {}),
      });
    }
    return examples;
  }
  resolve: ResolveType = (code: string, profileUrl?: string): string => {
    if (profileUrl && this.byUrl.has(profileUrl)) return this.byUrl.get(profileUrl)!;
    if (profileUrl) return profileUrl;
    if (PRIMS.has(code) || DTYPES.has(code)) return `${this.coreDocsBase}datatypes.html#${code}`;
    return `${this.coreDocsBase}${code.toLowerCase()}.html`;
  };
  get configuredProfileGroups(): { label: string; ids: readonly string[] }[] {
    return [...(this.project.profileGroups || [])];
  }
  profileGroupLabel(id: string): string | null {
    return this.configuredProfileGroups.find((group) => group.ids.includes(id))?.label || null;
  }
  emittedPageForResource(row: ResourceRow): string | null {
    if (PRIMARY_RESOURCE_TYPES.has(row.Type) && row.Type !== 'ImplementationGuide') return this.page(row);
    if (this.isExampleRow(row) || this.isGenericResourcePageRow(row)) return this.page(row);
    return null;
  }
  listRowsForType(type: string): ResourceRow[] {
    if (type === 'StructureDefinition' || type === 'ValueSet' || type === 'CodeSystem') return this.artifactResources(type);
    return this.artifactResources(type).filter((row) => this.isExampleRow(row));
  }
  simpleNameList(type: string): string {
    const rows = this.listRowsForType(type);
    if (!rows.length) return '<li class="muted">None.</li>';
    return rows.map((row) => {
      const title = esc(row.Title || row.Name || row.Id);
      const href = this.emittedPageForResource(row);
      return `<li>${href ? `<a href="${esc(href)}">${title}</a>` : title}</li>`;
    }).join('\n');
  }
  artifactTable(type: string, rows: ResourceRow[]): string {
    if (!rows.length) return '<p class="muted">None.</p>';
    const body = rows.map((row) => {
      const title = esc(row.Title || row.Name || row.Id);
      const href = this.emittedPageForResource(row);
      const label = href ? `<a href="${esc(href)}">${title}</a>` : title;
      return `<tr><td>${label}</td><td>${esc(row.Description || '')}</td></tr>`;
    }).join('');
    return `<div class="table-scroll"><table class="cycle-table"><thead><tr><th>${esc(type)}</th><th>Description</th></tr></thead><tbody>${body}</tbody></table></div>`;
  }
  generatedFragment(name: string): string | null {
    if (name === 'table-profiles.xhtml') return this.artifactTable('Profile', this.artifactResources('StructureDefinition'));
    if (name === 'table-actordefinitions.xhtml') return this.artifactTable('ActorDefinition', this.artifactResources('ActorDefinition'));
    const simple = name.match(/^list-simple-name-(.+)\.xhtml$/);
    if (simple) {
      const type = SIMPLE_LIST_TYPES[simple[1].toLowerCase()];
      if (type) return this.simpleNameList(type);
    }
    return null;
  }
  resolveFragmentResource(type: string, id: string): any | null {
    const row = this.resourcesByReference.get(`${type}/${id}`);
    return row ? this.view.parse(row) : null;
  }
  rewriteCoreFhirDocLinks(markdown: string): string {
    return markdown.replace(/(\]\(|href=["'])(\.\/)?([a-z][a-z0-9-]+\.html)(#[^)\'" ]+)?/gi, (match, prefix, _dot, pageName, anchor = '') => {
      const normalized = String(pageName).toLowerCase();
      return FHIR_CORE_DOC_PAGES.has(normalized)
        ? `${prefix}${this.coreDocsBase}${normalized}${anchor || ''}`
        : match;
    });
  }
  rewriteKnownArtifactLinks(markdown: string): string {
    const rewrite = (href: string): string => {
      if (/^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(href)) return href;
      const marker = href.search(/[?#]/);
      const base = marker >= 0 ? href.slice(0, marker) : href;
      const suffix = marker >= 0 ? href.slice(marker) : '';
      const target = this.artifactHrefByLocalTarget.get(base);
      return target ? `${target}${suffix}` : href;
    };
    return markdown
      .replace(/\bhref=(["'])([^"']+)\1/g, (_match, quote, href) => `href=${quote}${rewrite(href)}${quote}`)
      .replace(/(\]\()([^)\s]+)(\))/g, (_match, open, href, close) => `${open}${rewrite(href)}${close}`);
  }
  private dependencyBaseUrl(dependency: any): string | null {
    const raw = String(dependency?.uri || '').trim();
    if (!raw) return null;
    const base = raw.replace(/\/ImplementationGuide\/[^/]+$/, '').replace(/\/+$/, '');
    return base || null;
  }
  private dependencyAliases(dependency: any): string[] {
    const aliases = new Set<string>();
    const add = (value: unknown) => { const text = String(value || '').trim(); if (text) aliases.add(text); };
    add(dependency?.id);
    add(dependency?.packageId);
    const packageId = String(dependency?.packageId || '').trim();
    if (packageId) {
      const lastDot = packageId.split('.').at(-1);
      add(lastDot);
      add(lastDot?.replace(/^davinci-/, ''));
      add(lastDot?.replace(/-r\d+$/, ''));
      add(packageId.split('-').at(-1));
    }
    return [...aliases].filter((alias) => /^[A-Za-z_][A-Za-z0-9_-]*$/.test(alias));
  }
  private publisherStyleSiteData(ig: any, metadata: Record<string, string>): Record<string, any> {
    const versions: Record<string, string> = {};
    for (const dependency of ig.dependsOn || []) {
      const base = this.dependencyBaseUrl(dependency);
      if (!base) continue;
      for (const alias of this.dependencyAliases(dependency)) versions[alias] = base;
    }
    versions.feature ||= 'http://hl7.org/fhir/uv/application-feature';
    return {
      fhir: {
        ...metadata,
        ig,
        ver: versions,
        path: metadata.path || this.coreDocsBase,
        canonical: metadata.canonical || ig.url?.replace(/\/ImplementationGuide\/[^/]+$/, ''),
        packageId: metadata.packageId || ig.packageId || ig.id,
        igVer: metadata.igVer || ig.version,
        version: firstFhirVersion(ig, metadata),
        genDate: metadata.genDate,
      },
    };
  }
}

function ArtifactSidebar({ context, current }: { context: SiteContext; current: string }): React.ReactNode {
  const definitions = context.artifactResources('StructureDefinition');
  const terminology = [...context.artifactResources('ValueSet'), ...context.artifactResources('CodeSystem')];
  const configured = context.configuredProfileGroups;
  const groups = configured.length ? configured : [{ label: 'Profiles', ids: definitions.map((row) => row.Id) }];
  return <>
    <div className="side-group">
      <div className="side-title">Profiles</div>
      {groups.map((group) => {
        const rows = configured.length
          ? definitions.filter((row) => context.profileGroupLabel(row.Id) === group.label)
          : definitions;
        if (!rows.length) return null;
        return <React.Fragment key={group.label}>
          {configured.length ? <div className="side-subtitle">{group.label}</div> : null}
          {rows.map((row) => <a key={row.Id} href={context.page(row)} {...(context.page(row) === current ? { 'aria-current': 'page' } : {})}>
            <span style={{ flex: 1 }}>{row.Title || row.Name || row.Id}</span>
          </a>)}
        </React.Fragment>;
      })}
    </div>
    <div className="side-group">
      <div className="side-title">Terminology</div>
      {terminology.map((row) => <a key={row.Id} href={context.page(row)} {...(context.page(row) === current ? { 'aria-current': 'page' } : {})}>
        <span style={{ flex: 1 }}>{row.Title || row.Name || row.Id}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)', color: 'var(--ink-300)' }}>{row.Type === 'ValueSet' ? 'VS' : 'CS'}</span>
      </a>)}
    </div>
  </>;
}

export class CycleSiteRenderer {
  private readonly context: SiteContext;
  private readonly contentContext: CycleContentContext;
  private readonly includes: IncludeRegistry;
  private readonly project: CycleProjectView;
  private pageManifest: PageDescriptor[] | null = null;
  private outputManifest: CycleOutputDescriptor[] | null = null;

  constructor(
    readonly view: SiteBuildView,
    private readonly options: CycleRendererOptions,
  ) {
    this.includes = options.includes || {};
    this.project = options.project || {};
    this.context = new SiteContext(view, this.project);
    this.contentContext = {
      view,
      ig: this.context.igResource,
      siteData: this.context.liquidSiteData,
      includes: this.includes,
      fhirVersion: this.context.meta.version || this.context.igResource.fhirVersion?.[0] || '4.0.1',
      generatedFragment: (name) => this.context.generatedFragment(name),
      textAsset: (name) => view.textAsset(name),
      resolveFragmentResource: (type, id) => this.context.resolveFragmentResource(type, id),
    };
    options.content.prepare?.(this.contentContext);
  }

  listPages(): PageDescriptor[] {
    if (this.pageManifest) return this.pageManifest.map((page) => ({ ...page }));
    const result: PageDescriptor[] = [];
    for (const page of this.view.pages()) {
      if (page.Body) result.push({ file: `${page.Slug}.html`, title: page.Title, kind: 'narrative' });
    }
    result.push(
      { file: 'artifacts.html', title: 'Artifacts', kind: 'artifacts' },
      { file: 'toc.html', title: 'Table of Contents', kind: 'toc' },
      { file: 'validation.html', title: 'Validation', kind: 'validation' },
    );
    for (const row of this.context.artifactResources('StructureDefinition')) {
      const title = row.Title || row.Name || row.Id;
      result.push({ file: this.context.page(row), title, kind: 'profile' });
      result.push({ file: `StructureDefinition-${row.Id}-definitions.html`, title: `${title} Definitions`, kind: 'profile-companion' });
      result.push({ file: `StructureDefinition-${row.Id}-mappings.html`, title: `${title} Mappings`, kind: 'profile-companion' });
    }
    for (const row of this.context.artifactResources('ValueSet')) result.push({ file: this.context.page(row), title: row.Title || row.Name || row.Id, kind: 'valueset' });
    for (const row of this.context.artifactResources('CodeSystem')) result.push({ file: this.context.page(row), title: row.Title || row.Name || row.Id, kind: 'codesystem' });
    for (const row of this.context.artifactResources().filter((candidate) => this.context.isGenericResourcePageRow(candidate))) {
      if (row.Type !== 'ImplementationGuide') result.push({ file: this.context.page(row), title: row.Title || row.Name || row.Id, kind: 'generic' });
    }
    for (const row of this.context.exampleResources()) result.push({ file: this.context.page(row), title: row.Title || row.Name || row.Id, kind: 'example' });
    const seen = new Map<string, PageDescriptor>();
    for (const page of result) {
      this.assertSafeOutputPath(page.file);
      const prior = seen.get(page.file);
      if (prior) {
        throw new Error(
          `Cycle renderer output collision at '${page.file}': ${prior.kind} '${prior.title}' and ${page.kind} '${page.title}'`,
        );
      }
      seen.set(page.file, page);
    }
    this.pageManifest = result.map((page) => ({ ...page }));
    return result.map((page) => ({ ...page }));
  }

  /** Complete generator-owned output namespace. Design-system files copied by
   * the CLI/browser host remain host assets, but every page, row asset, machine
   * file, narrative source, and llms.txt path is declared and collision-checked
   * here before publication. */
  listOutputs(): CycleOutputDescriptor[] {
    if (this.outputManifest) return this.outputManifest.map((output) => ({ ...output }));
    const pages = this.listPages();
    const pageFiles = new Set(pages.map((page) => page.file));
    const outputs: CycleOutputDescriptor[] = [];
    const add = (output: CycleOutputDescriptor) => {
      this.assertSafeOutputPath(output.file);
      const prior = outputs.find((candidate) => candidate.file === output.file);
      if (prior) {
        throw new Error(
          `Cycle renderer output collision at '${output.file}': ${prior.producer} and ${output.producer}`,
        );
      }
      outputs.push(output);
    };
    for (const page of pages) {
      add({ file: page.file, mime: 'text/html', kind: 'page', producer: `${page.kind} page` });
    }
    for (const page of this.view.pages().filter((candidate) => candidate.Body)) {
      add({
        file: `${page.Slug}.md`,
        mime: 'text/markdown',
        kind: 'auxiliary',
        producer: `narrative source ${page.Slug}`,
        owner: `${page.Slug}.html`,
      });
    }
    for (const row of this.context.all) {
      const owner = this.context.page(row);
      if (!pageFiles.has(owner)) continue;
      add({
        file: `${row.Type}-${row.Id}.json`,
        mime: 'application/fhir+json',
        kind: 'auxiliary',
        producer: `resource ${row.Type}/${row.Id}`,
        owner,
      });
    }
    add({ file: 'llms.txt', mime: 'text/plain', kind: 'auxiliary', producer: 'LLM site index' });
    for (const asset of this.view.assets()) {
      add({ file: asset.Name, mime: asset.Mime, kind: 'asset', producer: `row asset ${asset.Name}` });
    }
    outputs.sort((left, right) => compareText(left.file, right.file));
    this.outputManifest = outputs.map((output) => ({ ...output }));
    return outputs.map((output) => ({ ...output }));
  }

  renderPage(file: string): RenderedPage {
    // Validate the complete page namespace even for a direct render call.
    this.listPages();
    const slug = file.replace(/\.html$/, '');
    const narrative = this.view.pages().find((page) => page.Slug === slug && page.Body);
    if (narrative) return this.renderNarrative(file, narrative);
    if (file === 'artifacts.html') return { file, html: this.renderArtifacts(), outputs: [] };
    if (file === 'toc.html') return { file, html: this.renderToc(), outputs: [] };
    if (file === 'validation.html') return { file, html: this.renderValidation(), outputs: [] };

    const companion = /^StructureDefinition-(.+)-(definitions|mappings)\.html$/.exec(file);
    if (companion) {
      const row = this.context.artifactResources('StructureDefinition').find((candidate) => candidate.Id === companion[1]);
      if (!row) throw new Error(`Cycle renderer: no page '${file}'`);
      const label = companion[2] === 'definitions' ? 'Definitions' : 'Mappings';
      const title = row.Title || row.Name || row.Id;
      return {
        file,
        html: this.emit(
          <div className="cycle-prose">
            <h1>{title} {label}</h1>
            <p>This experimental renderer publishes the profile&apos;s computable definition on the main profile page.</p>
            <p><a href={this.context.page(row)}>Open {title}</a></p>
          </div>,
          { title: `${title} ${label}`, navActive: this.context.artifactsNav, crumbs: [{ label: 'Artifacts', href: 'artifacts.html' }, { label }] },
        ),
        outputs: [],
      };
    }

    const row = this.context.all.find((candidate) => this.context.page(candidate) === file);
    if (!row) throw new Error(`Cycle renderer: no page '${file}'`);
    return this.renderResourcePage(file, row);
  }

  /** Render any public output path through the same lazy renderer used for its
   * owning HTML page. Hosts use this for direct/new-tab requests for narrative
   * Markdown, machine JSON, and llms.txt; no host-specific output synthesis is
   * permitted. */
  renderOutput(file: string): RenderedOutput {
    const descriptor = this.listOutputs().find((candidate) => candidate.file === file);
    if (!descriptor) throw new Error(`Cycle renderer: no output '${file}'`);
    if (descriptor.kind === 'asset') {
      const asset = this.view.assets().find((candidate) => candidate.Name === file)!;
      return { file, content: asset.Content, mime: asset.Mime };
    }
    if (file === 'llms.txt') {
      return { file, content: this.renderLlmsTxt(), mime: 'text/plain' };
    }
    if (file.endsWith('.html')) {
      const page = this.renderPage(file);
      return { file: page.file, content: page.html, mime: 'text/html' };
    }

    if (descriptor.owner) {
      const output = this.renderPage(descriptor.owner).outputs.find((candidate) => candidate.file === file);
      if (output) return output;
    }
    throw new Error(`Cycle renderer: no output '${file}'`);
  }

  private assertSafeOutputPath(file: string): void {
    if (!file || file.startsWith('/') || file.includes('\\') || file.includes('\0')) {
      throw new Error(`Cycle renderer produced unsafe output path '${file}'`);
    }
    const parts = file.split('/');
    if (parts.some((part) => !part || part === '.' || part === '..')) {
      throw new Error(`Cycle renderer produced unsafe output path '${file}'`);
    }
  }

  renderLlmsTxt(): string {
    const ig = this.context.igResource;
    const siteBase = (() => {
      try {
        const url = new URL(ig.url || `https://${this.project.cname || 'example.invalid'}/`);
        return `${url.origin}/`;
      } catch {
        return `https://${this.project.cname || 'example.invalid'}/`;
      }
    })();
    const lines = [
      `# ${this.context.meta.igName} - ${ig.title || this.context.meta.igName}`,
      `> ${(ig.description || '').replace(/\s+/g, ' ').trim()}`,
      '', '## Resolution context',
      `- Canonical IG URL: ${ig.url || ''}`,
      `- Published site base URL: ${siteBase}`,
      `- Resolve relative links in this file against: ${siteBase}`,
      '', '## Pages (site navigation; .md = liquid-resolved source)',
    ];
    const pageSlugs = new Set(this.view.pages().filter((page) => page.Body).map((page) => page.Slug));
    const menuChildren = this.menuChildren();
    const markdownHref = (href: string) => {
      const [path, anchor] = href.split('#');
      const page = path.replace(/\.html$/, '');
      return pageSlugs.has(page) ? `${page}.md${anchor ? `#${anchor}` : ''}` : href;
    };
    const writeMenu = (parentId: number | null, depth: number) => {
      for (const item of menuChildren.get(parentId) || []) {
        const prefix = '  '.repeat(depth);
        lines.push(item.Href ? `${prefix}- [${item.Label}](${markdownHref(item.Href)})` : `${prefix}- ${item.Label}`);
        writeMenu(item.Id, depth + 1);
      }
    };
    writeMenu(null, 0);
    const group = (label: string, type: string) => {
      const rows = this.context.artifactResources(type);
      if (!rows.length) return;
      lines.push('', `## ${label}`);
      for (const row of rows) {
        const description = (row.Description || '').replace(/\s+/g, ' ').split(/(?<=[.?!])\s/)[0];
        lines.push(`- [${row.Title || row.Name || row.Id}](${row.Type}-${row.Id}.html): ${description} | JSON: ${row.Type}-${row.Id}.json`);
      }
    };
    group('Profiles', 'StructureDefinition');
    group('Value sets', 'ValueSet');
    group('Code systems', 'CodeSystem');
    const examples = this.context.exampleResources();
    if (examples.length) {
      lines.push('', '## Examples');
      for (const row of examples) {
        const description = (row.Description || '').replace(/\s+/g, ' ').split(/(?<=[.?!])\s/)[0];
        lines.push(`- [${row.Title || row.Name || row.Id}](${row.Type}-${row.Id}.html): ${description} | JSON: ${row.Type}-${row.Id}.json`);
      }
    }
    return `${lines.join('\n')}\n`;
  }

  private renderNarrative(file: string, page: PageRow): RenderedPage {
    let markdown = this.options.content.renderLiquid(page.Body!, {
      file,
      slug: page.Slug,
      title: page.Title,
      context: this.contentContext,
    });
    markdown = sanitizeMarkdownSource(this.context.rewriteKnownArtifactLinks(this.context.rewriteCoreFhirDocLinks(markdown)));
    const rendered = renderMarkdown(markdown);
    const html = this.emit(<div className="cycle-prose" dangerouslySetInnerHTML={{ __html: rendered.html }} />, {
      title: page.Title,
      navActive: this.context.navMap[page.Slug],
      toc: rendered.toc.filter((item: any) => item.level === 2).map((item: any) => ({ id: item.id, label: item.label })),
      crumbs: page.Slug === 'index' ? undefined : [{ label: 'Home', href: 'index.html' }, { label: page.Title }],
      aiSource: `${page.Slug}.md`,
    });
    return { file, html, outputs: [{ file: `${page.Slug}.md`, content: markdown, mime: 'text/markdown' }] };
  }

  private renderArtifacts(): string {
    return this.emit(
      <ArtifactsPage
        resources={this.context.artifactResources() as any}
        page={(row: any) => this.context.page(row)}
        isExample={(row: any) => this.context.isExampleRow(row)}
        profileGroupLabel={(id: string) => this.context.profileGroupLabel(id)}
        profileGroups={this.context.configuredProfileGroups as any}
      />,
      {
        title: 'Artifacts', navActive: this.context.artifactsNav,
        toc: [{ id: 'profiles', label: 'Profiles' }, { id: 'value-sets', label: 'Value sets' }, { id: 'code-systems', label: 'Code systems' }, { id: 'examples', label: 'Examples' }],
        crumbs: [{ label: 'Home', href: 'index.html' }, { label: 'Artifacts' }],
        sidebar: <ArtifactSidebar context={this.context} current="artifacts.html" />,
      },
    );
  }

  private renderToc(): string {
    const children = this.menuChildren();
    const renderList = (parentId: number | null): React.ReactNode => {
      const rows = children.get(parentId) || [];
      if (!rows.length) return null;
      return <ul>{rows.map((row) => <li key={row.Id}>
        {row.Href ? <a href={row.Href}>{row.Label}</a> : <span>{row.Label}</span>}
        {renderList(row.Id)}
      </li>)}</ul>;
    };
    return this.emit(<div className="cycle-prose"><h1>Table of Contents</h1>{renderList(null)}</div>, {
      title: 'Table of Contents', navActive: this.context.navMap.toc,
      crumbs: [{ label: 'Home', href: 'index.html' }, { label: 'Table of Contents' }],
    });
  }

  private renderValidation(): string {
    return this.emit(<div className="cycle-prose">
      <h1>Validation</h1>
      <p>This experimental site-gen build did not run the Java IG Publisher validation report for this page. Use the published IG QA output or run the full Publisher validation path when conformance validation evidence is required.</p>
    </div>, {
      title: 'Validation', crumbs: [{ label: 'Home', href: 'index.html' }, { label: 'Validation' }],
    });
  }

  private renderResourcePage(file: string, row: ResourceRow): RenderedPage {
    const title = row.Title || row.Name || row.Id;
    const machineBase = `${row.Type}-${row.Id}`;
    const output = { file: `${machineBase}.json`, content: JSON.stringify(this.view.parse(row), null, 2), mime: 'application/fhir+json' };
    if (row.Type === 'StructureDefinition') {
      const data = this.context.structureDefinitionData(row);
      const rootType = row.sdType || data.type;
      const examples = this.context.profileExamples(row.Url || '');
      return { file, html: this.emit(
        <ProfilePage r={row as any} data={data} resolve={this.context.resolve} requirements={this.context.profileRootRequirements(data, rootType)} examples={examples} authoredElementChain={this.context.localAuthoredElementChain(data)} />,
        {
          title, navActive: this.context.artifactsNav,
          crumbs: [{ label: 'Artifacts', href: 'artifacts.html' }, { label: 'Profiles', href: 'artifacts.html#profiles' }, { label: row.Title || row.Id }],
          toc: [{ id: 'overview', label: 'Overview' }, ...(examples.length ? [{ id: 'examples', label: 'Examples' }] : []), { id: 'elements', label: 'Formal definition' }],
          sidebar: <ArtifactSidebar context={this.context} current={file} />, machineBase,
        },
      ), outputs: [output] };
    }
    if (row.Type === 'ValueSet') {
      const data = this.view.parse(row);
      return { file, html: this.emit(<ValueSetPage r={row as any} data={data} resolve={this.context.resolve} expansion={this.view.valueSetCodes(row.Url || '')} />, {
        title, navActive: this.context.artifactsNav,
        crumbs: [{ label: 'Artifacts', href: 'artifacts.html' }, { label: 'Value sets', href: 'artifacts.html#value-sets' }, { label: row.Title || row.Id }],
        toc: [{ id: 'overview', label: 'Overview' }, { id: 'definition', label: 'Composition' }],
        sidebar: <ArtifactSidebar context={this.context} current={file} />, machineBase,
      }), outputs: [output] };
    }
    if (row.Type === 'CodeSystem') {
      const data = this.view.parse(row);
      return { file, html: this.emit(<CodeSystemPage r={row as any} data={data} concepts={this.view.concepts(row.Key) as any} />, {
        title, navActive: this.context.artifactsNav,
        crumbs: [{ label: 'Artifacts', href: 'artifacts.html' }, { label: 'Code systems', href: 'artifacts.html#code-systems' }, { label: row.Title || row.Id }],
        toc: [{ id: 'overview', label: 'Overview' }, { id: 'concepts', label: 'Concepts' }],
        sidebar: <ArtifactSidebar context={this.context} current={file} />, machineBase,
      }), outputs: [output] };
    }
    const data = this.view.parse(row);
    if (this.context.isExampleRow(row)) {
      return { file, html: this.emit(<ExamplePage r={row as any} data={data} />, {
        title, navActive: this.context.artifactsNav,
        crumbs: [{ label: 'Artifacts', href: 'artifacts.html' }, { label: 'Examples', href: 'artifacts.html#examples' }, { label: row.Title || row.Id }],
        toc: [{ id: 'overview', label: 'Overview' }, { id: 'source', label: 'Source' }],
        sidebar: <ArtifactSidebar context={this.context} current={file} />, machineBase,
      }), outputs: [output] };
    }
    return { file, html: this.emit(<ResourcePage r={row as any} data={data} />, {
      title, navActive: this.context.artifactsNav,
      crumbs: [{ label: 'Artifacts', href: 'artifacts.html' }, { label: row.Type }, { label: row.Title || row.Id }],
      toc: [{ id: 'overview', label: 'Overview' }, { id: 'source', label: 'Source' }],
      sidebar: <ArtifactSidebar context={this.context} current={file} />, machineBase,
    }), outputs: [output] };
  }

  private emit(
    node: React.ReactNode,
    options: { title: string; crumbs?: Crumb[]; toc?: TocItem[]; navActive?: string; sidebar?: React.ReactNode; machineBase?: string; aiSource?: string },
  ): string {
    return '<!doctype html>\n' + renderToStaticMarkup(
      <Layout
        meta={this.context.meta} title={options.title} crumbs={options.crumbs} toc={options.toc}
        navActive={options.navActive} sidebar={options.sidebar} machineBase={options.machineBase}
        aiSource={options.aiSource} ig={this.context.igResource} menu={this.context.menuRows}
      >{node}</Layout>,
    );
  }

  private menuChildren(): Map<number | null, MenuRow[]> {
    const children = new Map<number | null, MenuRow[]>();
    for (const row of this.context.menuRows) {
      const key = row.ParentId ?? null;
      children.set(key, [...(children.get(key) || []), row]);
    }
    return children;
  }
}
