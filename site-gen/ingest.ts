/**
 * ingest.ts — post-publisher step that builds the SINGLE SOURCE OF TRUTH.
 *
 * Copies the Publisher's output/package.db → site-gen/site.db, then augments it
 * with the few things the Publisher's DB does NOT already contain:
 *   - Pages   : page bodies (markdown from input/pagecontent) keyed to the page
 *               tree that ALREADY lives in the IG resource's definition.page
 *   - Menu    : the curated top-nav (sushi-config.yaml `menu:` — submenus/anchors)
 *   - SiteConfig: parsed source config needed by site-generation components
 *   - Assets  : generated artifacts (model.svg from input/images-source/*.plantuml)
 *
 * Everything else (page structure/titles/order, dependencies, bindings, …) is
 * derived from the DB at render time. After this runs, build.tsx reads ONLY site.db.
 *
 * Run: bun site-gen/ingest.ts     (PKG_DB / SITE_DB env override defaults)
 */
import { Database } from 'bun:sqlite';
import { copyFileSync, readFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import YAML from 'yaml';
import { project } from './project/cycle';

const PAGEDIR = project.contentDir;

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
mkdirSync(dirname(SITE), { recursive: true });
copyFileSync(PKG, SITE);
const db = new Database(SITE);
db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
CREATE TABLE IF NOT EXISTS Pages (Slug TEXT PRIMARY KEY, NameUrl TEXT, Title TEXT, Generation TEXT, Ord INTEGER, Depth INTEGER, Body TEXT);
DROP TABLE IF EXISTS Menu;
DROP TABLE IF EXISTS SiteConfig;
CREATE TABLE Menu (Id INTEGER PRIMARY KEY, ParentId INTEGER, Ord INTEGER, Depth INTEGER, Path TEXT, Label TEXT, Href TEXT, Kind TEXT);
CREATE TABLE SiteConfig (Name TEXT PRIMARY KEY, Json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS Assets (Name TEXT PRIMARY KEY, Mime TEXT, Content TEXT);
DELETE FROM Pages; DELETE FROM Menu; DELETE FROM Assets;
`);

// ---- Pages: tree (from DB) + body (from input/pagecontent) ----
const igRow: any = db.query("SELECT Json FROM Resources WHERE Type='ImplementationGuide'").get();
const ig = JSON.parse(typeof igRow.Json === 'string' ? igRow.Json : new TextDecoder().decode(igRow.Json));
let ord = 0;
const insPage = db.prepare('INSERT OR REPLACE INTO Pages (Slug, NameUrl, Title, Generation, Ord, Depth, Body) VALUES (?,?,?,?,?,?,?)');
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
const cfg = YAML.parse(readFileSync('sushi-config.yaml', 'utf8'));
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

// ---- Assets: generate model.svg from PlantUML (fall back to publisher's if no jar) ----
const insAsset = db.prepare('INSERT OR REPLACE INTO Assets (Name, Mime, Content) VALUES (?,?,?)');
function findPlantumlJar(): string | null {
  for (const c of ['template/scripts/plantuml.jar', 'input-cache/plantuml.jar', 'site-gen/vendor/plantuml.jar']) if (existsSync(c)) return c;
  return null;
}
const puml = 'input/images-source/model.plantuml';
let svg: string | null = null;
const jar = findPlantumlJar();
if (existsSync(puml) && jar) {
  try {
    execFileSync('java', ['-jar', jar, '-tsvg', '-pipe'], { input: readFileSync(puml), maxBuffer: 1 << 24, stdio: ['pipe', 'pipe', 'ignore'] });
    svg = execFileSync('java', ['-jar', jar, '-tsvg', '-pipe'], { input: readFileSync(puml), maxBuffer: 1 << 24 }).toString('utf8');
  } catch { svg = null; }
}
if (!svg && existsSync('temp/pages/_includes/model.svg')) svg = readFileSync('temp/pages/_includes/model.svg', 'utf8'); // fallback (ingested ONCE, still single-source)
if (svg) insAsset.run('model.svg', 'image/svg+xml', svg);

// IG images referenced by narrative (markdown ![]() / <img src>) — ingest so the
// generator stays single-source. Binary stored as BLOB.
const IMGDIR = project.imageDir;
const mimeOf = (f: string) => f.endsWith('.png') ? 'image/png' : f.endsWith('.svg') ? 'image/svg+xml'
  : (f.endsWith('.jpg') || f.endsWith('.jpeg')) ? 'image/jpeg' : f.endsWith('.gif') ? 'image/gif'
  : f.endsWith('.webp') ? 'image/webp' : 'application/octet-stream';
if (existsSync(IMGDIR)) {
  for (const f of readdirSync(IMGDIR)) {
    const p = `${IMGDIR}/${f}`;
    if (statSync(p).isFile()) insAsset.run(f, mimeOf(f), readFileSync(p));
  }
}

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
console.log(`  +${counts.pages} pages (${counts.withBody} with body) · ${counts.menu} menu rows · ${counts.assets} assets · plantuml=${jar ? 'generated' : 'fallback/none'}`);
