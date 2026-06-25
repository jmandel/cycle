import MarkdownIt from 'markdown-it';
import anchor from 'markdown-it-anchor';

export interface TocItem { id: string; label: string; level: number }

const slugify = (s: string) =>
  s.trim().toLowerCase().replace(/<[^>]*>/g, '').replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-');

const md = new MarkdownIt({ html: true, linkify: true, typographer: false });
md.use((md) => {
  md.core.ruler.after('inline', 'task_lists', (state) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      const item = tokens[i];
      if (item.type !== 'list_item_open') continue;

      const inline = tokens.slice(i + 1).find((t) => t.type === 'inline');
      const first = inline?.children?.[0];
      if (!inline || !first || first.type !== 'text') continue;

      const match = first.content.match(/^\[([ xX])\]\s+/);
      if (!match) continue;

      const checked = match[1].toLowerCase() === 'x';
      first.content = first.content.slice(match[0].length);
      inline.content = inline.content.replace(/^\[[ xX]\]\s+/, '');

      item.attrJoin('class', 'task-list-item');
      for (let j = i - 1; j >= 0; j--) {
        if (tokens[j].type === 'bullet_list_open' || tokens[j].type === 'ordered_list_open') {
          tokens[j].attrJoin('class', 'contains-task-list');
          break;
        }
      }

      const checkbox = new state.Token('html_inline', '', 0);
      checkbox.content = `<input class="task-list-item-checkbox" type="checkbox" disabled${checked ? ' checked' : ''}> `;
      inline.children!.unshift(checkbox);
    }
  });
});
md.use(anchor, {
  slugify,
  level: [2, 3, 4],
  permalink: anchor.permalink.linkInsideHeader({ symbol: '', class: 'heading-anchor', placement: 'after', ariaHidden: true }),
});

/** Render markdown → { html, toc } (h2/h3 headings for the On-this-page rail). */
export function renderMarkdown(src: string): { html: string; toc: TocItem[] } {
  const tokens = md.parse(src, {});
  const toc: TocItem[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'heading_open' && (t.tag === 'h2' || t.tag === 'h3')) {
      const id = t.attrGet('id') || '';
      const label = (tokens[i + 1]?.content || '').replace(/<[^>]*>/g, '');
      if (id) toc.push({ id, label, level: Number(t.tag[1]) });
    }
  }
  return { html: md.render(src), toc };
}
