/**
 * entry.tsx — the client bundle. Two jobs:
 *  1. Hydrate every <Island> so its component gains full React behaviour.
 *  2. Chrome progressive-enhancement (toggle-all, mobile nav, TOC scrollspy).
 * The page is fully usable without this script; it only adds capability.
 */
import React from 'react';
import { hydrateRoot } from 'react-dom/client';
import { ISLANDS } from './registry';

function hydrateIslands() {
  document.querySelectorAll<HTMLElement>('[data-island]').forEach((el) => {
    const name = el.getAttribute('data-island') || '';
    const C = ISLANDS[name];
    if (!C) return;
    let props: any = {};
    try { props = JSON.parse(el.getAttribute('data-props') || '{}'); } catch { /* keep {} */ }
    hydrateRoot(el, React.createElement(C, props));
  });
}

function chrome() {
  document.documentElement.classList.add('js');

  // Tabs — redundant alt-views. JS off → all panes stacked; JS on → one at a time.
  document.querySelectorAll<HTMLElement>('[data-tabs]').forEach((root) => {
    const tabs = Array.from(root.querySelectorAll<HTMLElement>('[role="tab"]'));
    const panes = Array.from(root.querySelectorAll<HTMLElement>('[role="tabpanel"]'));
    const activate = (i: number) => {
      tabs.forEach((t, j) => t.setAttribute('aria-selected', j === i ? 'true' : 'false'));
      panes.forEach((p, j) => { (p as HTMLElement).hidden = j !== i; });
    };
    tabs.forEach((t, i) => t.addEventListener('click', () => activate(i)));
    activate(0);
  });

  // Expand/collapse all matching <details>
  document.querySelectorAll<HTMLElement>('[data-toggle-all]').forEach((btn) => {
    const sel = btn.getAttribute('data-toggle-all')!;
    btn.addEventListener('click', () => {
      const items = Array.from(document.querySelectorAll<HTMLDetailsElement>(sel));
      const anyClosed = items.some((d) => !d.open);
      items.forEach((d) => { d.open = anyClosed; });
      btn.textContent = anyClosed
        ? (btn.getAttribute('data-label-expanded') || 'Collapse all')
        : (btn.getAttribute('data-label-collapsed') || 'Expand all');
    });
  });

  // Heading deep-link anchors → copy the durable URL to clipboard
  document.querySelectorAll<HTMLAnchorElement>('.heading-anchor').forEach((a) => {
    const heading = (a.parentElement as HTMLElement) || a;
    heading.classList.add('has-anchor');
    heading.addEventListener('click', (e) => {
      const clicked = (e.target as HTMLElement).closest('a');
      if (clicked && clicked !== a) return; // a different link inside the heading
      const href = a.getAttribute('href') || '';
      if (!navigator.clipboard) { location.hash = href; return; }
      e.preventDefault();
      navigator.clipboard.writeText(location.origin + location.pathname + href).then(() => {
        history.replaceState(null, '', href);
        a.classList.add('copied');
        setTimeout(() => a.classList.remove('copied'), 1200);
      }).catch(() => { location.hash = href; });
    });
  });

  // Copy buttons for canonical URLs, computable names, and other fixed IDs.
  document.querySelectorAll<HTMLButtonElement>('[data-copy-value]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const root = btn.closest<HTMLElement>('.copy-value');
      const code = root?.querySelector<HTMLElement>('.copy-value-code');
      const text = code?.textContent || '';
      const label = btn.querySelector<HTMLElement>('[data-copy-label]');
      const markCopied = () => {
        btn.setAttribute('data-copied', 'true');
        if (label) label.textContent = 'Copied';
        window.setTimeout(() => {
          btn.removeAttribute('data-copied');
          if (label) label.textContent = 'Copy';
        }, 1200);
      };
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(markCopied).catch(() => {});
      } else if (code) {
        const range = document.createRange();
        range.selectNodeContents(code);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    });
  });

  // Mobile nav drawer
  const menuBtn = document.querySelector('[data-toggle="mobile-nav"]');
  const nav = document.querySelector('.cycle-nav');
  if (menuBtn && nav) menuBtn.addEventListener('click', () => nav.classList.toggle('open-mobile'));

  // TOC scrollspy
  const tocLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('.cycle-toc a[href^="#"]'));
  if (tocLinks.length && 'IntersectionObserver' in window) {
    const map: Record<string, HTMLAnchorElement> = {};
    tocLinks.forEach((a) => { map[a.getAttribute('href')!.slice(1)] = a; });
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          tocLinks.forEach((a) => a.removeAttribute('data-active'));
          map[(e.target as HTMLElement).id]?.setAttribute('data-active', '');
        }
      });
    }, { rootMargin: '-80px 0px -70% 0px' });
    Object.keys(map).forEach((id) => { const el = document.getElementById(id); if (el) obs.observe(el); });
  }
}

hydrateIslands();
chrome();
