import React from 'react';
import * as db from '../core/db';

/** Top nav with submenus, built from the ingested Menu table (sushi-config). */
export function Menu({ active }: { active?: string }) {
  const rows = db.menu();
  const childrenByParent = new Map<number | null, db.MenuRow[]>();
  for (const r of rows) {
    const key = r.ParentId ?? null;
    childrenByParent.set(key, [...(childrenByParent.get(key) || []), r]);
  }
  const childrenOf = (id: number | null) => childrenByParent.get(id) || [];
  const firstHref = (r: db.MenuRow): string | null => {
    if (r.Href) return r.Href;
    for (const child of childrenOf(r.Id)) {
      const href = firstHref(child);
      if (href) return href;
    }
    return null;
  };
  const renderSubmenuItem = (item: db.MenuRow, depth: number): React.ReactNode => {
    const kids = childrenOf(item.Id);
    if (!kids.length) {
      return item.Href
        ? <a key={item.Id} className="cycle-submenu-link" data-depth={depth} role="menuitem" href={item.Href}>{item.Label}</a>
        : <div key={item.Id} className="cycle-submenu-label" data-depth={depth}>{item.Label}</div>;
    }
    return (
      <div key={item.Id} className="cycle-submenu-group" data-depth={depth}>
        {item.Href
          ? <a className="cycle-submenu-link" data-depth={depth} role="menuitem" href={item.Href}>{item.Label}</a>
          : <div className="cycle-submenu-label" data-depth={depth}>{item.Label}</div>}
        <div className="cycle-submenu-children">
          {kids.map((k) => renderSubmenuItem(k, depth + 1))}
        </div>
      </div>
    );
  };
  const tops = childrenOf(null);
  return (
    <nav className="cycle-nav" aria-label="Main">
      {tops.map((t) => {
        const kids = childrenOf(t.Id);
        const on = t.Label === active ? { 'aria-current': 'page' as const } : {};
        if (kids.length) {
          const overviewHref = t.Href || kids.find((k) => k.Label.toLowerCase() === 'overview')?.Href || firstHref(t);
          return (
            <div className="cycle-nav-item has-sub" key={t.Id}>
              {overviewHref ? (
                <a className="cycle-nav-link" href={overviewHref} aria-haspopup="true" {...on}>
                  {t.Label}<span className="caret" aria-hidden="true"> ▾</span>
                </a>
              ) : (
                <button type="button" className="cycle-nav-link" aria-haspopup="true" aria-expanded="false" {...on}>
                  {t.Label}<span className="caret" aria-hidden="true"> ▾</span>
                </button>
              )}
              <div className="cycle-submenu" role="menu">
                {kids.map((k) => renderSubmenuItem(k, 0))}
              </div>
            </div>
          );
        }
        return <a className="cycle-nav-link" key={t.Id} href={t.Href!} {...on}>{t.Label}</a>;
      })}
    </nav>
  );
}
