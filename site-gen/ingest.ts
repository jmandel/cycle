/**
 * ingest.ts — post-publisher step that builds the SINGLE SOURCE OF TRUTH.
 *
 * Copies the Publisher's output/package.db → site-gen/site.db, then augments it
 * with the few things the Publisher's DB does NOT already contain:
 *   - Pages   : page bodies (markdown from input/pagecontent) keyed to the page
 *               tree that ALREADY lives in the IG resource's definition.page
 *   - Menu    : the curated top-nav (sushi-config.yaml `menu:` — submenus/anchors)
 *   - SiteConfig: parsed source config needed by site-generation components
 *   - Assets  : project images and Publisher-generated include outputs referenced
 *               by page markdown
 *
 * Everything else (page structure/titles/order, dependencies, bindings, …) is
 * derived from the DB at render time. In this explicitly selected legacy
 * workflow, build.tsx reads only site.db; portable v2 builds bypass this file.
 *
 * Run: bun site-gen/ingest.ts     (PKG_DB / SITE_DB env override defaults)
 */
import { Database } from 'bun:sqlite';
import { copyFileSync, readFileSync, existsSync, readdirSync, statSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, normalize, relative } from 'node:path';
import YAML from 'yaml';
import { project } from './project';
import { assertPackageDbContract } from './publisher/contract';

const PAGEDIR = project.contentDir;
const CONFIG = process.env.SUSHI_CONFIG || 'sushi-config.yaml';

/** Resolve the Publisher's package.db explicitly — never silently use a stale dev copy. */
function resolvePkgDb(): string {
  if (process.env.PKG_DB) {
    if (!existsSync(process.env.PKG_DB)) throw new Error(`PKG_DB does not exist: ${process.env.PKG_DB}`);
    return process.env.PKG_DB;
  }
  if (existsSync('output/package.db')) return 'output/package.db';
  if (process.env.SITE_GEN_USE_FIXTURE === '1' && existsSync('site-gen/fixtures/package.db')) return 'site-gen/fixtures/package.db';
  throw new Error(
    'No package.db found. Run the IG Publisher to produce output/package.db (or set PKG_DB). ' +
    'For renderer-only dev, set SITE_GEN_USE_FIXTURE=1 with site-gen/fixtures/package.db.',
  );
}

const PKG = resolvePkgDb();
const SITE = process.env.SITE_DB || 'temp/site-gen/site.db';
const preserveAssets = process.env.SITE_GEN_PRESERVE_ASSETS === '1' || PKG.endsWith('site-gen/fixtures/package.db');
mkdirSync(dirname(SITE), { recursive: true });
for (const f of [SITE, `${SITE}-wal`, `${SITE}-shm`]) rmSync(f, { force: true });
copyFileSync(PKG, SITE);
const db = new Database(SITE);
assertPackageDbContract(db);
db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
CREATE TABLE IF NOT EXISTS Pages (Slug TEXT PRIMARY KEY, NameUrl TEXT, Title TEXT, Generation TEXT, Ord INTEGER, Depth INTEGER, Body TEXT);
DROP TABLE IF EXISTS Menu;
DROP TABLE IF EXISTS SiteConfig;
CREATE TABLE Menu (Id INTEGER PRIMARY KEY, ParentId INTEGER, Ord INTEGER, Depth INTEGER, Path TEXT, Label TEXT, Href TEXT, Kind TEXT);
CREATE TABLE SiteConfig (Name TEXT PRIMARY KEY, Json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS Assets (Name TEXT PRIMARY KEY, Mime TEXT, Content TEXT);
DELETE FROM Pages; DELETE FROM Menu;
`);
if (!preserveAssets) db.exec('DELETE FROM Assets;');

// ---- Pages: tree (from DB) + body (from input/pagecontent) ----
const igRow: any = db.query("SELECT Json FROM Resources WHERE Type='ImplementationGuide'").get();
const ig = JSON.parse(typeof igRow.Json === 'string' ? igRow.Json : new TextDecoder().decode(igRow.Json));
let ord = 0;
const pageIncludeNames = new Set<string>();
const insPage = db.prepare('INSERT OR REPLACE INTO Pages (Slug, NameUrl, Title, Generation, Ord, Depth, Body) VALUES (?,?,?,?,?,?,?)');
function liquidAssetNames(body: string): string[] {
  const out: string[] = [];
  const re = /{%-?\s*(?:include|lang-fragment)\s+("[^"]+"|'[^']+'|[^\s%]+)[^%]*-?%}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) out.push(m[1].replace(/^(['"])([\s\S]*)\1$/, '$2'));
  return out;
}
function walkPages(node: any, depth: number) {
  if (!node) return;
  for (const p of Array.isArray(node) ? node : [node]) {
    const nameUrl: string = p.nameUrl || p.name || '';
    const slug = nameUrl.replace(/\.html$/, '');
    if (slug && slug !== 'toc') {
      const mdPath = `${PAGEDIR}/${slug}.md`;
      const xmlPath = `${PAGEDIR}/${slug}.xml`;
      const body = existsSync(mdPath) ? readFileSync(mdPath, 'utf8')
        : existsSync(xmlPath) ? readFileSync(xmlPath, 'utf8') : null;
      if (body) for (const name of liquidAssetNames(body)) pageIncludeNames.add(name);
      // Prefer the page's own first H1 (correctly cased) over the auto-titled definition.page.
      const h1 = body && body.match(/^#\s+(.+?)\s*$/m);
      const title = (h1 ? h1[1] : (p.title || slug)).trim();
      insPage.run(slug, nameUrl, title, p.generation || 'markdown', ord++, depth, body);
    }
    walkPages(p.page, depth + 1);
  }
}
walkPages(ig.definition?.page, 0);

// ---- Menu: sushi-config.yaml `menu:` (submenus + anchors) ----
const cfg = YAML.parse(readFileSync(CONFIG, 'utf8'));
db.prepare('INSERT OR REPLACE INTO SiteConfig (Name, Json) VALUES (?,?)').run('sushi-config', JSON.stringify(cfg, null, 2));
const insMenu = db.prepare('INSERT INTO Menu (Id, ParentId, Ord, Depth, Path, Label, Href, Kind) VALUES (?,?,?,?,?,?,?,?)');
let mord = 0;
let mid = 0;
function isMenuGroup(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function addMenuItems(node: Record<string, unknown>, parentId: number | null, depth: number, path: string[]) {
  for (const [label, val] of Object.entries(node)) {
    const id = ++mid;
    const href = typeof val === 'string' ? val : null;
    const itemPath = [...path, label];
    const kind = href ? 'link' : 'group';
    insMenu.run(id, parentId, mord++, depth, itemPath.join('/'), label, href, kind);
    if (isMenuGroup(val)) addMenuItems(val, id, depth + 1, itemPath);
  }
}
if (isMenuGroup(cfg.menu)) addMenuItems(cfg.menu, null, 0, []);

// ---- Assets: copy first-party files into the DB, then build.tsx writes them out ----
const insAsset = db.prepare('INSERT OR REPLACE INTO Assets (Name, Mime, Content) VALUES (?,?,?)');
function safeAssetName(name: string): string {
  const normalized = name.replace(/\\/g, '/');
  const parts = normalized.split('/');
  if (!normalized || normalized.startsWith('/') || parts.some((part) => !part || part === '..')) {
    throw new Error(`Unsafe asset name: ${name}`);
  }
  return normalized;
}
function safePathUnder(root: string, relName: string): string {
  const safeName = safeAssetName(relName);
  const candidate = normalize(join(root, safeName));
  const rel = relative(root, candidate);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`Asset path escapes ${root}: ${relName}`);
  return candidate;
}
const mimeOf = (f: string) => {
  const lower = f.toLowerCase();
  return lower.endsWith('.png') ? 'image/png' : lower.endsWith('.svg') ? 'image/svg+xml'
    : (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) ? 'image/jpeg' : lower.endsWith('.gif') ? 'image/gif'
    : lower.endsWith('.webp') ? 'image/webp' : lower.endsWith('.xhtml') || lower.endsWith('.html') ? 'text/html'
    : lower.endsWith('.md') ? 'text/markdown' : lower.endsWith('.txt') ? 'text/plain' : 'application/octet-stream';
};
const textLikeMime = (mime: string) => mime.startsWith('text/') || mime === 'image/svg+xml' || mime === 'application/xml' || mime === 'application/xhtml+xml';
let imageAssets = 0;
let includeAssets = 0;
function ingestAsset(name: string, path: string) {
  insAsset.run(safeAssetName(name), mimeOf(name), readFileSync(path));
}
function ingestGeneratedAsset(name: string, mime: string, content: string | Uint8Array) {
  insAsset.run(safeAssetName(name), mime, content);
}
function ingestImageDir(root: string, rel = '') {
  if (!existsSync(root)) return;
  for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
    const next = rel ? `${rel}/${e.name}` : e.name;
    const p = safePathUnder(root, next);
    if (e.isDirectory()) ingestImageDir(root, next);
    else if (e.isFile()) {
      ingestAsset(next, p);
      imageAssets++;
    }
  }
}

// Text assets are copied only when authored markdown references the include.
// Source-only publisher runs should use source dirs such as input/includes or
// template/includes. Java Publisher _includes are generated output and are not
// part of the source-only input contract.
const liquidAssetDirs = project.liquidAssetDirs || [];
const PLANTUML_VERSION = '1.2026.1';
const PLANTUML_MAVEN_URL = `https://repo1.maven.org/maven2/net/sourceforge/plantuml/plantuml-mit/${PLANTUML_VERSION}/plantuml-mit-${PLANTUML_VERSION}.jar`;
async function ensurePlantumlJar(): Promise<string | null> {
  const configured = process.env.PLANTUML_JAR;
  if (configured && existsSync(configured)) return configured;
  const m2 = join(homedir(), '.m2/repository/net/sourceforge/plantuml/plantuml-mit', PLANTUML_VERSION, `plantuml-mit-${PLANTUML_VERSION}.jar`);
  if (existsSync(m2)) return m2;
  const cached = join('temp/site-gen/tools', `plantuml-mit-${PLANTUML_VERSION}.jar`);
  if (existsSync(cached)) return cached;
  try {
    mkdirSync(dirname(cached), { recursive: true });
    const response = await fetch(PLANTUML_MAVEN_URL);
    if (!response.ok) return null;
    await Bun.write(cached, await response.arrayBuffer());
    return cached;
  } catch {
    return null;
  }
}
async function renderPlantumlSvg(sourcePath: string): Promise<Uint8Array> {
  const jar = await ensurePlantumlJar();
  if (!jar) throw new Error(`PlantUML source ${sourcePath} is referenced but no PlantUML renderer is available. Set PLANTUML_JAR or allow ${PLANTUML_MAVEN_URL} to be cached.`);
  const result = spawnSync('java', ['-jar', jar, '-tsvg', '-pipe'], {
    input: readFileSync(sourcePath),
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`PlantUML failed for ${sourcePath}: ${result.stderr.toString() || result.stdout.toString()}`);
  }
  return result.stdout;
}
function plantumlSourceForSvg(safeName: string): string | null {
  if (!safeName.toLowerCase().endsWith('.svg')) return null;
  const plantumlName = safeName.replace(/\.svg$/i, '.plantuml');
  for (const dir of liquidAssetDirs) {
    const sourceRoot = normalize(join(dirname(dir), 'images-source'));
    const candidate = safePathUnder(sourceRoot, plantumlName);
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  const imageCandidate = safePathUnder(project.imageDir, plantumlName);
  if (existsSync(imageCandidate) && statSync(imageCandidate).isFile()) return imageCandidate;
  return null;
}
for (const includeName of pageIncludeNames) {
  const safeName = safeAssetName(includeName);
  let found = false;
  for (const dir of liquidAssetDirs) {
    const p = safePathUnder(dir, safeName);
    if (existsSync(p) && statSync(p).isFile()) {
      const mime = mimeOf(safeName);
      const content = readFileSync(p);
      insAsset.run(safeName, mime, content);
      if (textLikeMime(mime)) {
        for (const nestedName of liquidAssetNames(content.toString('utf8'))) pageIncludeNames.add(nestedName);
      }
      includeAssets++;
      found = true;
      break;
    }
  }
  if (!found) {
    const plantuml = plantumlSourceForSvg(safeName);
    if (plantuml) {
      ingestGeneratedAsset(safeName, 'image/svg+xml', await renderPlantumlSvg(plantuml));
      includeAssets++;
    }
  }
}
ingestImageDir(project.imageDir);

const m = Object.fromEntries((db.query('SELECT Name, Value FROM Metadata').all() as any[]).map((r) => [r.Name, r.Value]));
const counts = {
  pages: (db.query('SELECT count(*) c FROM Pages').get() as any).c,
  withBody: (db.query('SELECT count(*) c FROM Pages WHERE Body IS NOT NULL').get() as any).c,
  menu: (db.query('SELECT count(*) c FROM Menu').get() as any).c,
  assets: (db.query('SELECT count(*) c FROM Assets').get() as any).c,
};
db.close();
console.log(`Ingest: ${PKG} → ${SITE}`);
console.log(`  IG ${m.igId} · ${m.packageId}#${m.igVer} · FHIR ${m.version} · generated ${m.genDay}`);
console.log(`  +${counts.pages} pages (${counts.withBody} with body) · ${counts.menu} menu rows · ${counts.assets} assets (${imageAssets} images, ${includeAssets} publisher includes${preserveAssets ? ', preserved fixture assets' : ''})`);
