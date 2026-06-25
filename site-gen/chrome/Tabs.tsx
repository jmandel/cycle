import React from 'react';

/**
 * Tabs — for REDUNDANT alternative representations of one thing (snapshot/diff,
 * JSON/XML/FSH). All panes are SSR'd into the DOM: with JS off the reader sees
 * every pane stacked (complete); the chrome script (entry.tsx) turns it into a
 * tab strip and shows one at a time. Never use to gate primary content.
 */
export function Tabs({ id, tabs }: { id: string; tabs: { label: string; content: React.ReactNode }[] }) {
  return (
    <div className="tabs" data-tabs>
      <div className="tablist" role="tablist" aria-label="Views">
        {tabs.map((t, i) => (
          <button key={i} type="button" role="tab" className="tab" id={`${id}-tab-${i}`} aria-controls={`${id}-pane-${i}`} aria-selected={i === 0 ? 'true' : 'false'} data-tab={i}>
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t, i) => (
        <section key={i} role="tabpanel" className="tabpane" id={`${id}-pane-${i}`} aria-labelledby={`${id}-tab-${i}`} data-pane={i}>
          <div className="tabpane-label" aria-hidden="true">{t.label}</div>
          {t.content}
        </section>
      ))}
    </div>
  );
}
