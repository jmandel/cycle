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
import type { ResolveType } from './fhir/ElementTable';
import { renderLiquid } from './core/liquid';
import { includes } from './project/includes';
import { renderMarkdown } from './core/markdown';
import { isExternalLink } from './config';
import { checkInternalLinks } from './core/link-check';
import { project } from './project/cycle';

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
const igResource = db.ig();
const RESOURCE_SORT = 'http://hl7.org/fhir/tools/StructureDefinition/resource-sort';
const EXAMPLE_PROFILE_EXTENSION = 'http://hl7.org/fhir/5.0/StructureDefinition/extension-ImplementationGuide.definition.resource.profile';
const CANONICAL_RESOURCE_TYPES = new Set(['StructureDefinition', 'ValueSet', 'CodeSystem', 'ImplementationGuide']);
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
function isExampleRow(r: db.ResourceRow): boolean {
  return !CANONICAL_RESOURCE_TYPES.has(r.Type) && exampleRefs.has(resourceReference(r));
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
const resolve: ResolveType = (code, profileUrl) => {
  if (profileUrl && byUrl.has(profileUrl)) return byUrl.get(profileUrl)!;
  if (profileUrl) return profileUrl;
  if (PRIMS.has(code) || DTYPES.has(code)) return `https://hl7.org/fhir/R4/datatypes.html#${code}`;
  return `https://hl7.org/fhir/R4/${code.toLowerCase()}.html`;
};

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
  return (
    <>
      <div className="side-group">
        <div className="side-title">Profiles</div>
        {configuredProfileGroups.map((group) => {
          const rows = sds.filter((r) => profileGroupLabel(r.Id) === group.label);
          if (!rows.length) return null;
          return (
            <React.Fragment key={group.label}>
              <div className="side-subtitle">{group.label}</div>
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
      assetInclude: db.textAsset,
      sql: (query) => db.db.query(query).all() as Record<string, any>[],
    });
  } catch (e: any) {
    // A broken include/directive must NOT silently publish. Fail the build unless
    // explicitly running in lenient dev mode.
    if (process.env.SITE_GEN_LENIENT === '1') { console.warn(`  ! liquid failed for ${p.Slug}: ${e.message}`); liquidOut = p.Body; }
    else throw new Error(`Liquid failed for ${p.Slug}.md: ${e.message}`);
  }
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
console.log(`Rendered ${nPages} narrative + artifacts + ${nProfiles} profiles + VS/CS + ${nExamples} examples → ${OUT}/`);
const broken = checkInternalLinks({ outDir: OUT, emitted, files: emitted, isExternalLink });
if (broken.length) {
  console.error(`\n✗ ${broken.length} broken internal links:`);
  for (const b of [...new Set(broken)].slice(0, 40)) console.error('  ' + b);
  process.exit(1);
}
console.log('✓ link check passed (no dangling internal hrefs)');
