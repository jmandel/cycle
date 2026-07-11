import React from 'react';
import type { SemanticMenuNode } from '../core/semantic-site-build';

/** Top navigation rendered directly from the closed recursive v2 menu. */
export function Menu({ active, items }: { active?: string; items: readonly SemanticMenuNode[] }) {
  const firstHref = (item: SemanticMenuNode): string | null => {
    if (item.href) return item.href;
    for (const child of item.items) {
      const href = firstHref(child);
      if (href) return href;
    }
    return null;
  };
  const renderSubmenuItem = (item: SemanticMenuNode, depth: number, key: string): React.ReactNode => {
    if (!item.items.length) {
      return item.href
        ? <a key={key} className="cycle-submenu-link" data-depth={depth} role="menuitem" href={item.href}>{item.label}</a>
        : <div key={key} className="cycle-submenu-label" data-depth={depth}>{item.label}</div>;
    }
    return (
      <div key={key} className="cycle-submenu-group" data-depth={depth}>
        {item.href
          ? <a className="cycle-submenu-link" data-depth={depth} role="menuitem" href={item.href}>{item.label}</a>
          : <div className="cycle-submenu-label" data-depth={depth}>{item.label}</div>}
        <div className="cycle-submenu-children">
          {item.items.map((child, index) => renderSubmenuItem(child, depth + 1, `${key}/${index}:${child.label}`))}
        </div>
      </div>
    );
  };
  return (
    <nav className="cycle-nav" aria-label="Main">
      {items.map((item, index) => {
        const key = `${index}:${item.label}`;
        const on = item.label === active ? { 'aria-current': 'page' as const } : {};
        if (item.items.length) {
          const overviewHref = item.href
            || item.items.find((child) => child.label.toLowerCase() === 'overview')?.href
            || firstHref(item);
          return (
            <div className="cycle-nav-item has-sub" key={key}>
              {overviewHref ? (
                <a className="cycle-nav-link" href={overviewHref} aria-haspopup="true" {...on}>
                  {item.label}<span className="caret" aria-hidden="true"> ▾</span>
                </a>
              ) : (
                <button type="button" className="cycle-nav-link" aria-haspopup="true" aria-expanded="false" {...on}>
                  {item.label}<span className="caret" aria-hidden="true"> ▾</span>
                </button>
              )}
              <div className="cycle-submenu" role="menu">
                {item.items.map((child, childIndex) => renderSubmenuItem(child, 0, `${key}/${childIndex}:${child.label}`))}
              </div>
            </div>
          );
        }
        return <a className="cycle-nav-link" key={key} href={item.href!} {...on}>{item.label}</a>;
      })}
    </nav>
  );
}
