import React from 'react';
import { Menu } from './Menu';
import { MachineFormats } from '../fhir/MachineFormats';
import { Footer } from './Footer';
import { project } from '../project';
import type { MenuRow } from '../core/site-build';

const brand = project.brand;
const BRAND_MARK = brand.mark
  ? <img className="cycle-mark-img" src={`assets/${brand.mark}`} width={30} height={30} alt="" style={{ display: 'block' }} />
  : null;

export interface Crumb { label: string; href?: string }
export interface TocItem { id: string; label: string }

export function Layout({
  meta, title, crumbs, toc, sidebar, navActive, machineBase, aiSource, ig, menu, children,
}: {
  meta: Record<string, string>;
  title: string;
  crumbs?: Crumb[];
  toc?: TocItem[];
  sidebar?: React.ReactNode;
  navActive?: string;
  machineBase?: string;
  aiSource?: string;
  ig?: any;
  menu: readonly MenuRow[];
  children: React.ReactNode;
}) {
  const css = ['fonts', 'colors', 'typography', 'spacing', 'effects'];
  // Only show "On this page" when it's substantive; drop the whole aside if empty.
  const tocItems = toc && toc.length >= 3 ? toc : undefined;
  const hasAside = Boolean(machineBase || aiSource || tocItems);
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{`${title} — ${meta.igName} v${meta.igVer}`}</title>
        {css.map((c) => <link key={c} rel="stylesheet" href={`assets/cycle/${c}.css`} />)}
        <link rel="stylesheet" href="assets/cycle/base.css" />
        <link rel="stylesheet" href="assets/project.css" />
        {brand.mark && <link rel="shortcut icon" href={`assets/${brand.mark}`} />}
      </head>
      <body>
        <a className="skip-link" href="#cycle-main">Skip to content</a>
        <header className="cycle-topbar">
          <div className="cycle-topbar-inner">
            <a className="cycle-brand" href="index.html" aria-label={`${brand.wordmark}${brand.tld || ''} — home`}>
              {BRAND_MARK}
              <span className="cycle-wordmark">{brand.wordmark}{brand.tld && <span className="cycle-tld">{brand.tld}</span>}</span>
            </a>
            <span className="cycle-badge">{meta.igVer} · {meta.releaseLabel || 'draft'}</span>
            <Menu active={navActive} rows={menu} />
            <button type="button" className="cycle-menu-btn" aria-label="Menu" data-toggle="mobile-nav">≡</button>
          </div>
        </header>

        <div className={'cycle-shell' + (sidebar ? '' : ' no-side') + (hasAside ? '' : ' no-aside')}>
          {sidebar && <nav className="cycle-side" aria-label="Section">{sidebar}</nav>}
          <main className="cycle-main" id="cycle-main">
            <article className="cycle-doc">
              {crumbs && crumbs.length > 0 && (
                <nav className="cycle-breadcrumb" aria-label="Breadcrumb">
                  {crumbs.map((c, i) => (
                    <React.Fragment key={i}>
                      {i > 0 && <span className="sep">/</span>}
                      {c.href ? <a href={c.href}>{c.label}</a> : <span>{c.label}</span>}
                    </React.Fragment>
                  ))}
                </nav>
              )}
              {aiSource && (
                <a className="copy-ai-source copy-ai-source-mobile" href={aiSource} data-copy-ai-source={aiSource}>
                  Copy page for AI
                </a>
              )}
              {children}
            </article>
          </main>
          {hasAside && (
            <aside className="cycle-toc">
              {machineBase && <MachineFormats base={machineBase} />}
              {aiSource && (
                <a className="copy-ai-source" href={aiSource} data-copy-ai-source={aiSource}>
                  Copy page for AI
                </a>
              )}
              {tocItems && (
                <>
                  <div className="toc-title">On this page</div>
                  {tocItems.map((t) => <a key={t.id} href={`#${t.id}`}>{t.label}</a>)}
                </>
              )}
            </aside>
          )}
        </div>

        <Footer meta={meta} ig={ig || {}} />
        <script src="assets/app.js" defer />
      </body>
    </html>
  );
}
