import React from 'react';
import { project } from '../project/cycle';

const brand = project.brand;
const guide = project.footer.guide;
const MARK = <img src={`assets/${brand.mark}`} width={26} height={26} alt="" style={{ display: 'block' }} />;

const LICENSE_URLS: Record<string, string> = {
  'CC0-1.0': 'https://creativecommons.org/publicdomain/zero/1.0/',
  'CC-BY-4.0': 'https://creativecommons.org/licenses/by/4.0/',
};

export function Footer({ meta, ig }: { meta: Record<string, string>; ig: any }) {
  const repo: string | undefined = ig.contact?.flatMap((c: any) => c.telecom || [])
    .find((t: string) => typeof t === 'string' && /github\.com|gitlab|bitbucket/.test(t));
  const license: string | undefined = ig.license;
  const canonical = meta.canonical;
  return (
    <footer className="cycle-footer">
      <div className="cycle-footer-inner">
        <div className="foot-grid">
          <div className="foot-brand">
            <a className="foot-mark" href="index.html" aria-label={`${brand.wordmark}${brand.tld} — home`}>
              {MARK}<span className="foot-word">{brand.wordmark}<span className="cycle-tld">{brand.tld}</span></span>
            </a>
            <p className="foot-tag">{brand.tagline}</p>
            <span className="foot-ver">{meta.igVer} · {meta.releaseLabel || 'draft'} · FHIR {meta.version}</span>
          </div>

          {/* Curated in project/cycle.ts (project.footer.guide) — real destinations. */}
          <nav className="foot-col" aria-label="Guide">
            <h4>Guide</h4>
            {guide.map((g) => <a key={g.label} href={g.href}>{g.label}</a>)}
          </nav>

          {/* Machine-facing outputs site-gen always emits. */}
          <nav className="foot-col" aria-label="For machines">
            <h4>For machines</h4>
            <a href="llms.txt">llms.txt</a>
            <a href="artifacts.html">Artifacts &amp; JSON</a>
            {canonical && <a href={canonical}>Canonical: {canonical.replace(/^https?:\/\//, '')}</a>}
          </nav>

          {/* Project metadata — derived from the IG resource. */}
          <nav className="foot-col" aria-label="Project">
            <h4>Project</h4>
            {repo && <a href={repo}>Source on GitHub ↗</a>}
            {license && <a href={LICENSE_URLS[license] || '#'}>License: {license}</a>}
            {ig.publisher && <span className="foot-pub">{ig.publisher}</span>}
          </nav>
        </div>

        <div className="foot-base">
          <span>{meta.packageId}#{meta.igVer} · FHIR {meta.version} · generated {meta.genDay}</span>
          {ig.copyright && <span>{ig.copyright}</span>}
        </div>
      </div>
    </footer>
  );
}
