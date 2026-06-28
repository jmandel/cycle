/**
 * build.tsx — the cycle IG site generator.
 * Reads the single-source-of-truth site.db (built by ingest.ts) and renders a
 * complete static site with the cycle design system via React SSR. No Jekyll.
 * Run: bun site-gen/ingest.ts && bun site-gen/build.tsx
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { rmSync, mkdirSync, cpSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, relative } from 'node:path';
import * as db from './core/db';
import { Layout, Crumb, TocItem } from './chrome/Layout';
import { ProfilePage } from './fhir/ProfilePage';
import type { ProfileExampleUse, ProfileRequirement } from './fhir/ProfilePage';
import { ArtifactsPage } from './fhir/ArtifactsPage';
import { ValueSetPage } from './fhir/ValueSetPage';
import { CodeSystemPage } from './fhir/CodeSystemPage';
import { ExamplePage } from './fhir/ExamplePage';
import { ResourcePage } from './fhir/ResourcePage';
import { renderResourceFragment } from './fhir/fragments';
import type { ResolveType } from './fhir/ElementTable';
import { renderLiquid } from './core/liquid';
import { includes } from './project/includes';
import { renderMarkdown, sanitizeMarkdownSource } from './core/markdown';
import { isExternalLink } from './config';
import { checkInternalLinks } from './core/link-check';
import { project } from './project';

const OUT = project.outDir;
// The visual design is a site-gen-owned drop-in (swap = directory change).
// No dependency on Publisher/Jekyll template assets.
const DESIGN = project.designDir;

// ---- assets ----
rmSync(OUT, { recursive: true, force: true });
mkdirSync(`${OUT}/assets`, { recursive: true });
cpSync(`${DESIGN}/styles`, `${OUT}/assets/cycle`, { recursive: true }); // tokens + base.css
cpSync(`${DESIGN}/fonts`, `${OUT}/assets/fonts`, { recursive: true });
cpSync(`${DESIGN}/assets`, `${OUT}/assets`, { recursive: true });       // cycle-mark*.svg
cpSync(project.projectCss, `${OUT}/assets/project.css`);                // project-specific CSS

// Ingested IG assets (images, etc.) written verbatim — single source is the DB.
function outputAssetPath(name: string): string {
  const normalized = name.replace(/\\/g, '/');
  const parts = normalized.split('/');
  if (!normalized || normalized.startsWith('/') || parts.some((part) => !part || part === '..')) {
    throw new Error(`Unsafe asset name in DB: ${name}`);
  }
  const candidate = normalize(join(OUT, normalized));
  const rel = relative(OUT, candidate);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`Asset path escapes output dir: ${name}`);
  return candidate;
}
for (const a of db.assets()) {
  const dest = outputAssetPath(a.Name);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, a.Content as any);
}

// ---- data ----
const meta = db.metadata();
const all = db.resources();
const page = (r: db.ResourceRow) => `${r.Type}-${r.Id}.html`;
const byUrl = new Map<string, string>();
for (const r of all) if (r.Url) byUrl.set(r.Url, page(r));
const artifactHrefByLocalTarget = new Map<string, string>();
for (const r of all) {
  const href = page(r);
  artifactHrefByLocalTarget.set(`${r.Type}-${r.Id}`, href);
  artifactHrefByLocalTarget.set(`${r.Type}/${r.Id}`, href);
}
const igResource = db.ig();
const resourcesByReference = new Map(all.map((r) => [`${r.Type}/${r.Id}`, r]));
const RESOURCE_SORT = 'http://hl7.org/fhir/tools/StructureDefinition/resource-sort';
const EXAMPLE_PROFILE_EXTENSION = 'http://hl7.org/fhir/5.0/StructureDefinition/extension-ImplementationGuide.definition.resource.profile';
const PRIMARY_RESOURCE_TYPES = new Set(['StructureDefinition', 'ValueSet', 'CodeSystem', 'ImplementationGuide']);
const sortRanks = new Map<string, number>();
const exampleRefs = new Set<string>();
const exampleProfilesByReference = new Map<string, string[]>();
for (const r of igResource.definition?.resource || []) {
  const ref = r.reference?.reference;
  const sort = (r.extension || []).find((e: any) => e.url === RESOURCE_SORT)?.valueInteger;
  if (ref && typeof sort === 'number') sortRanks.set(ref, sort);
  if (!ref) continue;
  const profiles = new Set<string>();
  if (r.exampleCanonical) profiles.add(r.exampleCanonical);
  if (Array.isArray(r.profile)) for (const p of r.profile) profiles.add(p);
  for (const ext of r.extension || []) {
    if (ext.url !== EXAMPLE_PROFILE_EXTENSION) continue;
    if (Array.isArray(ext.valueCanonical)) for (const p of ext.valueCanonical) profiles.add(p);
    else if (ext.valueCanonical) profiles.add(ext.valueCanonical);
  }
  if (r.exampleBoolean || r.exampleCanonical || profiles.size) exampleRefs.add(ref);
  if (profiles.size) exampleProfilesByReference.set(ref, [...profiles]);
}
function resourceReference(r: db.ResourceRow): string {
  return `${r.Type}/${r.Id}`;
}
function resolveFragmentResource(type: string, id: string): any | null {
  const row = resourcesByReference.get(`${type}/${id}`);
  return row ? db.parse(row) : null;
}
function isExampleRow(r: db.ResourceRow): boolean {
  return !PRIMARY_RESOURCE_TYPES.has(r.Type) && exampleRefs.has(resourceReference(r));
}
function isGenericResourcePageRow(r: db.ResourceRow): boolean {
  return !PRIMARY_RESOURCE_TYPES.has(r.Type) && !isExampleRow(r);
}
function artifactRank(r: db.ResourceRow): number {
  return sortRanks.get(`${r.Type}/${r.Id}`) ?? 100000;
}
function byArtifactOrder(a: db.ResourceRow, b: db.ResourceRow): number {
  return artifactRank(a) - artifactRank(b)
    || (a.Title || a.Name || a.Id).localeCompare(b.Title || b.Name || b.Id);
}
function artifactResources(type?: string): db.ResourceRow[] {
  return all.filter((r) => !type || r.Type === type).sort(byArtifactOrder);
}
function exampleResources(): db.ResourceRow[] {
  return artifactResources().filter(isExampleRow);
}
const structureDefinitions = artifactResources('StructureDefinition');
const structureDefinitionRowsByUrl = new Map(structureDefinitions.filter((r) => r.Url).map((r) => [r.Url!, r]));
const structureDefinitionDataByUrl = new Map<string, any>();
function structureDefinitionData(r: db.ResourceRow): any {
  if (r.Url && structureDefinitionDataByUrl.has(r.Url)) return structureDefinitionDataByUrl.get(r.Url);
  const data = db.parse(r);
  if (r.Url) structureDefinitionDataByUrl.set(r.Url, data);
  return data;
}
function localAuthoredElementChain(data: any): any[] {
  const chain: any[] = [];
  const seen = new Set<string>();
  const visit = (sd: any) => {
    const url = sd?.url;
    if (url) {
      if (seen.has(url)) return;
      seen.add(url);
    }
    const baseRow = sd?.baseDefinition ? structureDefinitionRowsByUrl.get(sd.baseDefinition) : undefined;
    if (baseRow) visit(structureDefinitionData(baseRow));
    chain.push(...(sd?.differential?.element || []));
  };
  visit(data);
  return chain;
}
const configuredProfileGroups = project.profileGroups || [];
function profileGroupLabel(id: string): string | null {
  return configuredProfileGroups.find((g) => g.ids.includes(id))?.label || null;
}
function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function dependencyBaseUrl(dep: any): string | null {
  const raw = String(dep?.uri || '').trim();
  if (!raw) return null;
  const base = raw.replace(/\/ImplementationGuide\/[^/]+$/, '').replace(/\/+$/, '');
  return base || null;
}

function dependencyAliases(dep: any): string[] {
  const aliases = new Set<string>();
  const add = (value: unknown) => {
    const s = String(value || '').trim();
    if (s) aliases.add(s);
  };
  add(dep?.id);
  add(dep?.packageId);
  const pkg = String(dep?.packageId || '').trim();
  if (pkg) {
    const lastDot = pkg.split('.').at(-1);
    add(lastDot);
    add(lastDot?.replace(/^davinci-/, ''));
    add(lastDot?.replace(/-r\d+$/, ''));
    const lastHyphen = pkg.split('-').at(-1);
    add(lastHyphen);
  }
  return [...aliases].filter((s) => /^[A-Za-z_][A-Za-z0-9_-]*$/.test(s));
}

function publisherStyleSiteData(ig: any, metadata: Record<string, string>): Record<string, any> {
  const ver: Record<string, string> = {};
  for (const dep of ig.dependsOn || []) {
    const base = dependencyBaseUrl(dep);
    if (!base) continue;
    for (const alias of dependencyAliases(dep)) ver[alias] = base;
  }
  // Some IGs use well-known Publisher variables for packages they rely on in
  // prose but do not declare as IG dependencies. Keep these as dependency URL
  // aliases only; they are not used for resource resolution or terminology.
  ver.feature ||= 'http://hl7.org/fhir/uv/application-feature';
  return {
    fhir: {
      ...metadata,
      ig,
      ver,
      path: metadata.path || 'http://hl7.org/fhir/R4/',
      canonical: metadata.canonical || ig.url?.replace(/\/ImplementationGuide\/[^/]+$/, ''),
      packageId: metadata.packageId || ig.packageId || ig.id,
      igVer: metadata.igVer || ig.version,
      version: metadata.version || ig.fhirVersion?.[0] || '4.0.1',
      genDate: metadata.genDate,
    },
  };
}
const liquidSiteData = publisherStyleSiteData(igResource, meta);

// nav-active: page slug -> top menu label
const navMap: Record<string, string> = { index: 'Home', artifacts: 'Artifacts' };
const menuRows = db.menu();
const menuById = new Map(menuRows.map((m) => [m.Id, m]));
const menuChildren = new Map<number | null, db.MenuRow[]>();
for (const m of menuRows) {
  const key = m.ParentId ?? null;
  menuChildren.set(key, [...(menuChildren.get(key) || []), m]);
}
function topMenuLabel(row: db.MenuRow): string {
  let current = row;
  while (current.ParentId != null && menuById.has(current.ParentId)) current = menuById.get(current.ParentId)!;
  return current.Label;
}
for (const m of menuRows) {
  if (!m.Href) continue;
  const slug = m.Href.split('#')[0].replace(/\.html$/, '');
  if (slug) navMap[slug] = topMenuLabel(m);
}
const artifactsNav = navMap['artifacts'] || 'Artifacts'; // 'More' once nested there

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
  'subscription.html', 'substance.html', 'supplydelivery.html', 'supplyrequest.html',
  'task.html', 'terminologycapabilities.html', 'testreport.html', 'testscript.html',
  'valueset.html', 'verificationresult.html', 'visionprescription.html',
  'datatypes.html', 'formats.html', 'overview.html', 'overview-clinical.html',
  'overview-dev.html', 'references.html', 'resource.html', 'terminologies.html',
  'profiling.html', 'conformance-rules.html', 'secpriv-module.html', 'safety.html',
  'http.html', 'extensibility.html', 'validation.html', 'versions.html',
  'license.html', 'narrative.html', 'elementdefinition.html', 'domainresource-definitions.html',
  'metadatatypes.html', 'questionnaire-definitions.html', 'terminology-service.html',
  'operation-valueset-expand.html', 'operation-valueset-validate-code.html',
]);
const resolve: ResolveType = (code, profileUrl) => {
  if (profileUrl && byUrl.has(profileUrl)) return byUrl.get(profileUrl)!;
  if (profileUrl) return profileUrl;
  if (PRIMS.has(code) || DTYPES.has(code)) return `https://hl7.org/fhir/R4/datatypes.html#${code}`;
  return `https://hl7.org/fhir/R4/${code.toLowerCase()}.html`;
};
function rewriteCoreFhirDocLinks(markdown: string): string {
  return markdown.replace(/(\]\(|href=["'])(\.\/)?([a-z][a-z0-9-]+\.html)(#[^)'" ]+)?/gi, (m, prefix, dot, pageName, anchor = '') => {
    const normalized = String(pageName).toLowerCase();
    if (!FHIR_CORE_DOC_PAGES.has(normalized)) return m;
    return `${prefix}https://hl7.org/fhir/R4/${normalized}${anchor || ''}`;
  });
}
function rewriteKnownArtifactLinks(markdown: string): string {
  const rewrite = (href: string): string => {
    if (/^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(href)) return href;
    const marker = href.search(/[?#]/);
    const base = marker >= 0 ? href.slice(0, marker) : href;
    const suffix = marker >= 0 ? href.slice(marker) : '';
    const target = artifactHrefByLocalTarget.get(base);
    return target ? `${target}${suffix}` : href;
  };
  return markdown
    .replace(/\bhref=(["'])([^"']+)\1/g, (_m, quote, href) => `href=${quote}${rewrite(href)}${quote}`)
    .replace(/(\]\()([^)\s]+)(\))/g, (_m, open, href, close) => `${open}${rewrite(href)}${close}`);
}

function profileRootRequirements(data: any, rootType: string): ProfileRequirement[] {
  const root = (data.differential?.element || []).find((e: any) => e.path === rootType);
  return (root?.constraint || []).filter((c: any) => c.key && c.human);
}

const derivedProfiles = new Map<string, string[]>();
for (const r of structureDefinitions) {
  if (!r.Url) continue;
  const data = structureDefinitionData(r);
  const base = data.baseDefinition;
  if (!base || !byUrl.has(base)) continue;
  derivedProfiles.set(base, [...(derivedProfiles.get(base) || []), r.Url]);
}
function profileAndDerivedUrls(url: string): Set<string> {
  const out = new Set<string>();
  const walk = (u: string) => {
    if (!u || out.has(u)) return;
    out.add(u);
    for (const child of derivedProfiles.get(u) || []) walk(child);
  };
  walk(url);
  return out;
}
function profileExamples(profileUrl: string): ProfileExampleUse[] {
  if (!profileUrl) return [];
  const accepted = profileAndDerivedUrls(profileUrl);
  const examples: ProfileExampleUse[] = [];
  for (const r of exampleResources()) {
    const profiles = exampleProfilesByReference.get(resourceReference(r)) || [];
    if (!profiles.some((p) => accepted.has(p))) continue;
    const data = db.parse(r);
    const code = JSON.stringify(data, null, 2);
    const direct = profiles.includes(profileUrl);
    const inlineable = direct && r.Type !== 'Bundle' && code.length <= 16000;
    examples.push({
      title: r.Title || r.Name || r.Id,
      href: page(r),
      jsonHref: `${r.Type}-${r.Id}.json`,
      count: 1,
      direct,
      resourceTypes: [r.Type],
      ...(inlineable ? { preview: { filename: `${r.Type}-${r.Id}.json`, code } } : {}),
    });
  }
  return examples;
}

// ---- sidebars ----
function ArtifactSidebar({ current }: { current: string }) {
  const sds = artifactResources('StructureDefinition');
  const terms = [...artifactResources('ValueSet'), ...artifactResources('CodeSystem')];
  const groups = configuredProfileGroups.length
    ? configuredProfileGroups
    : [{ label: 'Profiles', ids: sds.map((r) => r.Id) }];
  return (
    <>
      <div className="side-group">
        <div className="side-title">Profiles</div>
        {groups.map((group) => {
          const rows = configuredProfileGroups.length
            ? sds.filter((r) => profileGroupLabel(r.Id) === group.label)
            : sds;
          if (!rows.length) return null;
          return (
            <React.Fragment key={group.label}>
              {configuredProfileGroups.length ? <div className="side-subtitle">{group.label}</div> : null}
              {rows.map((r) => (
                <a key={r.Id} href={page(r)} {...(page(r) === current ? { 'aria-current': 'page' } : {})}>
                  <span style={{ flex: 1 }}>{r.Title || r.Name || r.Id}</span>
                </a>
              ))}
            </React.Fragment>
          );
        })}
      </div>
      <div className="side-group">
        <div className="side-title">Terminology</div>
        {terms.map((r) => (
          <a key={r.Id} href={page(r)} {...(page(r) === current ? { 'aria-current': 'page' } : {})}>
            <span style={{ flex: 1 }}>{r.Title || r.Name || r.Id}</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)', color: 'var(--ink-300)' }}>{r.Type === 'ValueSet' ? 'VS' : 'CS'}</span>
          </a>
        ))}
      </div>
    </>
  );
}

const SIMPLE_LIST_TYPES: Record<string, string> = {
  allergyintolerances: 'AllergyIntolerance',
  bundles: 'Bundle',
  codesystems: 'CodeSystem',
  compositions: 'Composition',
  conditions: 'Condition',
  devices: 'Device',
  deviceusestatements: 'DeviceUseStatement',
  diagnosticreports: 'DiagnosticReport',
  imagingstudies: 'ImagingStudy',
  immunizations: 'Immunization',
  media: 'Media',
  medications: 'Medication',
  medicationrequests: 'MedicationRequest',
  medicationstatements: 'MedicationStatement',
  observations: 'Observation',
  organizations: 'Organization',
  patients: 'Patient',
  practitioners: 'Practitioner',
  practitionerroles: 'PractitionerRole',
  procedures: 'Procedure',
  specimen: 'Specimen',
  valuesets: 'ValueSet',
};
function emittedPageForResource(r: db.ResourceRow): string | null {
  if (r.Type === 'StructureDefinition' || r.Type === 'ValueSet' || r.Type === 'CodeSystem') return page(r);
  if (isExampleRow(r) || isGenericResourcePageRow(r)) return page(r);
  return null;
}
function listRowsForType(type: string): db.ResourceRow[] {
  if (type === 'StructureDefinition' || type === 'ValueSet' || type === 'CodeSystem') return artifactResources(type);
  return artifactResources(type).filter(isExampleRow);
}
function simpleNameList(type: string): string {
  const rows = listRowsForType(type);
  if (!rows.length) return '<li class="muted">None.</li>';
  return rows.map((r) => {
    const title = esc(r.Title || r.Name || r.Id);
    const href = emittedPageForResource(r);
    return `<li>${href ? `<a href="${esc(href)}">${title}</a>` : title}</li>`;
  }).join('\n');
}
function artifactTable(type: string, rows: db.ResourceRow[]): string {
  if (!rows.length) return '<p class="muted">None.</p>';
  const body = rows.map((r) => {
    const title = esc(r.Title || r.Name || r.Id);
    const href = emittedPageForResource(r);
    const label = href ? `<a href="${esc(href)}">${title}</a>` : title;
    return `<tr><td>${label}</td><td>${esc(r.Description || '')}</td></tr>`;
  }).join('');
  return `<div class="table-scroll"><table class="cycle-table"><thead><tr><th>${esc(type)}</th><th>Description</th></tr></thead><tbody>${body}</tbody></table></div>`;
}
function generatedFragment(name: string): string | null {
  if (name === 'table-profiles.xhtml') return artifactTable('Profile', artifactResources('StructureDefinition'));
  if (name === 'table-actordefinitions.xhtml') return artifactTable('ActorDefinition', artifactResources('ActorDefinition'));
  const simple = name.match(/^list-simple-name-(.+)\.xhtml$/);
  if (simple) {
    const type = SIMPLE_LIST_TYPES[simple[1].toLowerCase()];
    if (type) return simpleNameList(type);
  }
  return null;
}
function liquidAssetInclude(name: string): string | null {
  return generatedFragment(name) ?? db.textAsset(name);
}
function PagesSidebar({ current }: { current: string }) {
  return (
    <div className="side-group">
      <div className="side-title">Pages</div>
      {db.pages().filter((p) => p.Body).map((p) => (
        <a key={p.Slug} href={`${p.Slug}.html`} {...(`${p.Slug}.html` === current ? { 'aria-current': 'page' } : {})}>
          <span style={{ flex: 1 }}>{p.Title}</span>
        </a>
      ))}
    </div>
  );
}

const emitted = new Set<string>();
function emit(file: string, node: React.ReactNode, opts: { title: string; crumbs?: Crumb[]; toc?: TocItem[]; navActive?: string; sidebar?: React.ReactNode; machineBase?: string; aiSource?: string }) {
  const html = '<!doctype html>\n' + renderToStaticMarkup(
    <Layout meta={meta} title={opts.title} crumbs={opts.crumbs} toc={opts.toc} navActive={opts.navActive} sidebar={opts.sidebar} machineBase={opts.machineBase} aiSource={opts.aiSource} ig={igResource}>
      {node}
    </Layout>,
  );
  writeFileSync(`${OUT}/${file}`, html);
  emitted.add(file);
}
/** Machine truth: write the resource JSON next to its page, return the base for MachineFormats. */
function writeArtifactJson(r: db.ResourceRow): string {
  const base = `${r.Type}-${r.Id}`;
  writeFileSync(`${OUT}/${base}.json`, JSON.stringify(db.parse(r), null, 2));
  emitted.add(`${base}.json`);
  return base;
}

// ---- narrative pages (Liquid → markdown) ----
let nPages = 0;
for (const p of db.pages()) {
  if (!p.Body) continue;
  const file = `${p.Slug}.html`;
  let liquidOut: string;
  try {
    liquidOut = renderLiquid(p.Body, {
      includes,
      ig: igResource,
      siteData: liquidSiteData,
      assetInclude: liquidAssetInclude,
      sql: (query) => db.db.query(query).all() as Record<string, any>[],
      fragment: (args) => renderResourceFragment(args, resolveFragmentResource, { fhirVersion: meta.version || igResource.fhirVersion?.[0] }),
    });
  } catch (e: any) {
    // A broken include/directive must NOT silently publish. Fail the build unless
    // explicitly running in lenient dev mode.
    if (process.env.SITE_GEN_LENIENT === '1') { console.warn(`  ! liquid failed for ${p.Slug}: ${e.message}`); liquidOut = p.Body; }
    else throw new Error(`Liquid failed for ${p.Slug}.md: ${e.message}`);
  }
  liquidOut = sanitizeMarkdownSource(rewriteKnownArtifactLinks(rewriteCoreFhirDocLinks(liquidOut)));
  // Publish the liquid-resolved markdown next to the HTML so agents can fetch source.
  writeFileSync(`${OUT}/${p.Slug}.md`, liquidOut);
  emitted.add(`${p.Slug}.md`);
  const { html, toc } = renderMarkdown(liquidOut);
  emit(file, <div className="cycle-prose" dangerouslySetInnerHTML={{ __html: html }} />, {
    title: p.Title,
    navActive: navMap[p.Slug],
    toc: toc.filter((t) => t.level === 2).map((t) => ({ id: t.id, label: t.label })),
    crumbs: p.Slug === 'index' ? undefined : [{ label: 'Home', href: 'index.html' }, { label: p.Title }],
    aiSource: `${p.Slug}.md`,
    // No sidebar on narrative pages: a flat page list would just duplicate the top
    // menu. The top nav (with its submenus) is the page nav; here we use content + TOC.
  });
  nPages++;
}

// ---- artifacts index ----
emit('artifacts.html', <ArtifactsPage resources={artifactResources()} page={page} isExample={isExampleRow} profileGroupLabel={profileGroupLabel} profileGroups={configuredProfileGroups} />, {
  title: 'Artifacts', navActive: artifactsNav,
  toc: [{ id: 'profiles', label: 'Profiles' }, { id: 'value-sets', label: 'Value sets' }, { id: 'code-systems', label: 'Code systems' }, { id: 'examples', label: 'Examples' }],
  crumbs: [{ label: 'Home', href: 'index.html' }, { label: 'Artifacts' }],
  sidebar: <ArtifactSidebar current="artifacts.html" />,
});

const renderMenuList = (parentId: number | null): React.ReactNode => {
  const rows = menuChildren.get(parentId) || [];
  if (!rows.length) return null;
  return (
    <ul>
      {rows.map((m) => (
        <li key={m.Id}>
          {m.Href ? <a href={m.Href}>{m.Label}</a> : <span>{m.Label}</span>}
          {renderMenuList(m.Id)}
        </li>
      ))}
    </ul>
  );
};
emit('toc.html', <div className="cycle-prose"><h1>Table of Contents</h1>{renderMenuList(null)}</div>, {
  title: 'Table of Contents',
  navActive: navMap['toc'],
  crumbs: [{ label: 'Home', href: 'index.html' }, { label: 'Table of Contents' }],
});

emit('validation.html', (
  <div className="cycle-prose">
    <h1>Validation</h1>
    <p>
      This experimental site-gen build did not run the Java IG Publisher
      validation report for this page. Use the published IG QA output or run the
      full Publisher validation path when conformance validation evidence is
      required.
    </p>
  </div>
), {
  title: 'Validation',
  crumbs: [{ label: 'Home', href: 'index.html' }, { label: 'Validation' }],
});

// ---- profile pages ----
let nProfiles = 0;
for (const r of artifactResources('StructureDefinition')) {
  const data = structureDefinitionData(r);
  const rootType = r.sdType || data.type;
  const requirements = profileRootRequirements(data, rootType);
  const examples = profileExamples(r.Url || '');
  emit(page(r), <ProfilePage r={r} data={data} resolve={resolve} requirements={requirements} examples={examples} authoredElementChain={localAuthoredElementChain(data)} />, {
    title: r.Title || r.Name || r.Id,
    navActive: artifactsNav,
    crumbs: [{ label: 'Artifacts', href: 'artifacts.html' }, { label: 'Profiles', href: 'artifacts.html#profiles' }, { label: r.Title || r.Id }],
    toc: [
      { id: 'overview', label: 'Overview' },
      ...(examples.length ? [{ id: 'examples', label: 'Examples' }] : []),
      { id: 'elements', label: 'Formal definition' },
    ],
    sidebar: <ArtifactSidebar current={page(r)} />,
    machineBase: writeArtifactJson(r),
  });
  const companion = (kind: 'definitions' | 'mappings', label: string) => emit(`StructureDefinition-${r.Id}-${kind}.html`, (
    <div className="cycle-prose">
      <h1>{r.Title || r.Name || r.Id} {label}</h1>
      <p>
        This experimental renderer publishes the profile's computable definition
        on the main profile page.
      </p>
      <p><a href={page(r)}>Open {r.Title || r.Name || r.Id}</a></p>
    </div>
  ), {
    title: `${r.Title || r.Name || r.Id} ${label}`,
    navActive: artifactsNav,
    crumbs: [{ label: 'Artifacts', href: 'artifacts.html' }, { label }],
  });
  companion('definitions', 'Definitions');
  companion('mappings', 'Mappings');
  nProfiles++;
}

// ---- value sets ----
for (const r of artifactResources('ValueSet')) {
  const data = db.parse(r);
  emit(page(r), <ValueSetPage r={r} data={data} resolve={resolve} expansion={db.valueSetCodes(r.Url || '')} />, {
    title: r.Title || r.Name || r.Id, navActive: artifactsNav,
    crumbs: [{ label: 'Artifacts', href: 'artifacts.html' }, { label: 'Value sets', href: 'artifacts.html#value-sets' }, { label: r.Title || r.Id }],
    toc: [{ id: 'overview', label: 'Overview' }, { id: 'definition', label: 'Composition' }],
    sidebar: <ArtifactSidebar current={page(r)} />,
    machineBase: writeArtifactJson(r),
  });
}

// ---- code systems ----
for (const r of artifactResources('CodeSystem')) {
  const data = db.parse(r);
  emit(page(r), <CodeSystemPage r={r} data={data} concepts={db.concepts(r.Key)} />, {
    title: r.Title || r.Name || r.Id, navActive: artifactsNav,
    crumbs: [{ label: 'Artifacts', href: 'artifacts.html' }, { label: 'Code systems', href: 'artifacts.html#code-systems' }, { label: r.Title || r.Id }],
    toc: [{ id: 'overview', label: 'Overview' }, { id: 'concepts', label: 'Concepts' }],
    sidebar: <ArtifactSidebar current={page(r)} />,
    machineBase: writeArtifactJson(r),
  });
}

// ---- other resource artifacts ----
let nGenericResources = 0;
for (const r of artifactResources().filter(isGenericResourcePageRow)) {
  if (r.Type === 'ImplementationGuide') continue;
  const data = db.parse(r);
  emit(page(r), <ResourcePage r={r} data={data} />, {
    title: r.Title || r.Name || r.Id,
    navActive: artifactsNav,
    crumbs: [{ label: 'Artifacts', href: 'artifacts.html' }, { label: r.Type }, { label: r.Title || r.Id }],
    toc: [{ id: 'overview', label: 'Overview' }, { id: 'source', label: 'Source' }],
    sidebar: <ArtifactSidebar current={page(r)} />,
    machineBase: writeArtifactJson(r),
  });
  nGenericResources++;
}

// ---- examples ----
let nExamples = 0;
for (const r of exampleResources()) {
  const data = db.parse(r);
  emit(page(r), <ExamplePage r={r} data={data} />, {
    title: r.Title || r.Name || r.Id, navActive: artifactsNav,
    crumbs: [{ label: 'Artifacts', href: 'artifacts.html' }, { label: 'Examples', href: 'artifacts.html#examples' }, { label: r.Title || r.Id }],
    toc: [{ id: 'overview', label: 'Overview' }, { id: 'source', label: 'Source' }],
    sidebar: <ArtifactSidebar current={page(r)} />,
    machineBase: writeArtifactJson(r),
  });
  nExamples++;
}

// ---- llms.txt: machine entry point (turns "crawl and guess" into "fetch the manifest") ----
{
  const ig = db.ig();
  const siteBase = (() => {
    try {
      const u = new URL(ig.url || `https://${project.cname}/`);
      return `${u.origin}/`;
    } catch {
      return `https://${project.cname}/`;
    }
  })();
  const lines: string[] = [
    `# ${meta.igName} - ${ig.title || meta.igName}`,
    `> ${(ig.description || '').replace(/\s+/g, ' ').trim()}`,
    '',
    '## Resolution context',
    `- Canonical IG URL: ${ig.url || ''}`,
    `- Published site base URL: ${siteBase}`,
    `- Resolve relative links in this file against: ${siteBase}`,
    '',
  ];
  // Narrative pages: mirror the site menu, linking to the liquid-resolved .md source.
  const pageSlugs = new Set(db.pages().filter((p) => p.Body).map((p) => p.Slug));
  const mdLink = (href: string) => {
    const [slug, anchor] = href.split('#');
    const s = slug.replace(/\.html$/, '');
    return pageSlugs.has(s) ? `${s}.md${anchor ? '#' + anchor : ''}` : href;
  };
  lines.push('## Pages (site navigation; .md = liquid-resolved source)');
  const writeMenu = (parentId: number | null, depth: number) => {
    for (const m of menuChildren.get(parentId) || []) {
      const prefix = '  '.repeat(depth);
      lines.push(m.Href ? `${prefix}- [${m.Label}](${mdLink(m.Href)})` : `${prefix}- ${m.Label}`);
      writeMenu(m.Id, depth + 1);
    }
  };
  writeMenu(null, 0);
  const group = (label: string, type: string) => {
    const rs = artifactResources(type);
    if (!rs.length) return;
    lines.push('', `## ${label}`);
    for (const r of rs) lines.push(`- [${r.Title || r.Name || r.Id}](${r.Type}-${r.Id}.html): ${(r.Description || '').replace(/\s+/g, ' ').split(/(?<=[.?!])\s/)[0]} | JSON: ${r.Type}-${r.Id}.json`);
  };
  group('Profiles', 'StructureDefinition');
  group('Value sets', 'ValueSet');
  group('Code systems', 'CodeSystem');
  const examples = exampleResources();
  if (examples.length) {
    lines.push('', '## Examples');
    for (const r of examples) lines.push(`- [${r.Title || r.Name || r.Id}](${r.Type}-${r.Id}.html): ${(r.Description || '').replace(/\s+/g, ' ').split(/(?<=[.?!])\s/)[0]} | JSON: ${r.Type}-${r.Id}.json`);
  }
  writeFileSync(`${OUT}/llms.txt`, lines.join('\n') + '\n');
}

// ---- client bundle (island hydration + chrome PE) ----
const bundle = await Bun.build({
  entrypoints: ['site-gen/client/entry.tsx'],
  outdir: `${OUT}/assets`,
  naming: 'app.js',
  target: 'browser',
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
});
if (!bundle.success) {
  console.error('✗ client bundle failed:');
  for (const l of bundle.logs) console.error('  ' + l);
  process.exit(1);
}
const bundleKb = Math.round((bundle.outputs.find((o) => o.path.endsWith('app.js'))?.size || 0) / 1024);
console.log(`✓ client bundle → assets/app.js (${bundleKb} KB)`);

// ---- link checker: fail on any dangling internal href ----
console.log(`Rendered ${nPages} narrative + artifacts + ${nProfiles} profiles + VS/CS + ${nGenericResources} generic resources + ${nExamples} examples → ${OUT}/`);
const broken = checkInternalLinks({ outDir: OUT, emitted, files: emitted, isExternalLink });
if (broken.length) {
  console.error(`\n✗ ${broken.length} broken internal links:`);
  for (const b of [...new Set(broken)].slice(0, 40)) console.error('  ' + b);
  process.exit(1);
}
console.log('✓ link check passed (no dangling internal hrefs)');
