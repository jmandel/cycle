import MarkdownIt from 'markdown-it';
import anchor from 'markdown-it-anchor';

export interface TocItem { id: string; label: string; level: number }

const slugify = (s: string) =>
  s.trim().toLowerCase().replace(/<[^>]*>/g, '').replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-');

const md = new MarkdownIt({ html: true, linkify: true, typographer: false });
md.use((md) => {
  const inlineIsCodeOnly = (inline: any) => {
    const children = inline?.children || [];
    const meaningful = children.filter((child: any) => {
      if (child.type === 'text') return child.content.trim() !== '';
      return child.type !== 'softbreak' && child.type !== 'hardbreak';
    });
    if (!meaningful.length) return false;
    let hasCode = false;
    for (const child of meaningful) {
      if (child.type === 'code_inline') {
        hasCode = true;
        continue;
      }
      if (child.type === 'text' && /^[\s,;/|()]+$/.test(child.content)) continue;
      return false;
    }
    return hasCode;
  };

  md.core.ruler.after('inline', 'table_code_columns', (state) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== 'table_open') continue;

      let end = i + 1;
      while (end < tokens.length && tokens[end].type !== 'table_close') end++;

      const rows: Array<{ isHeader: boolean; cells: Array<{ open: number; codeOnly: boolean; hasContent: boolean }> }> = [];
      let inHead = false;
      let currentRow: { isHeader: boolean; cells: Array<{ open: number; codeOnly: boolean; hasContent: boolean }> } | null = null;
      let currentCell: { open: number; inline: any | null } | null = null;

      for (let j = i + 1; j < end; j++) {
        const token = tokens[j];
        if (token.type === 'thead_open') inHead = true;
        if (token.type === 'thead_close') inHead = false;
        if (token.type === 'tr_open') currentRow = { isHeader: inHead, cells: [] };
        if (token.type === 'tr_close' && currentRow) {
          rows.push(currentRow);
          currentRow = null;
        }
        if (token.type === 'th_open' || token.type === 'td_open') currentCell = { open: j, inline: null };
        if (token.type === 'inline' && currentCell) currentCell.inline = token;
        if ((token.type === 'th_close' || token.type === 'td_close') && currentRow && currentCell) {
          const content = currentCell.inline?.content?.trim() || '';
          currentRow.cells.push({
            open: currentCell.open,
            codeOnly: inlineIsCodeOnly(currentCell.inline),
            hasContent: content.length > 0,
          });
          currentCell = null;
        }
      }

      const bodyRows = rows.some((row) => !row.isHeader) ? rows.filter((row) => !row.isHeader) : rows.slice(1);
      const maxCols = Math.max(0, ...rows.map((row) => row.cells.length));
      const codeCols = new Set<number>();
      for (let col = 0; col < maxCols; col++) {
        const cells = bodyRows.map((row) => row.cells[col]).filter((cell) => cell?.hasContent);
        if (cells.length > 0 && cells.every((cell) => cell.codeOnly)) codeCols.add(col);
      }
      if (!codeCols.size) continue;

      for (const row of rows) {
        row.cells.forEach((cell, col) => {
          if (codeCols.has(col)) tokens[cell.open].attrJoin('class', 'code-col');
        });
      }
    }
  });

  md.core.ruler.after('inline', 'task_lists', (state) => {
    const tokens = state.tokens;
    const firstInlineInListItem = (start: number) => {
      let nested = 0;
      for (let j = start + 1; j < tokens.length; j++) {
        const t = tokens[j];
        if (t.type === 'list_item_open') nested++;
        if (t.type === 'list_item_close') {
          if (nested === 0) return null;
          nested--;
        }
        if (nested === 0 && t.type === 'inline') return t;
      }
      return null;
    };
    for (let i = 0; i < tokens.length; i++) {
      const item = tokens[i];
      if (item.type !== 'list_item_open') continue;

      const inline = firstInlineInListItem(i);
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
// Wrap every rendered table in a horizontally scrollable container so wide
// tables scroll within their column on narrow viewports instead of being
// clipped by the page-level `overflow-x: clip` guard. SQL-generated tables get
// the same wrapper in core/liquid.ts.
md.renderer.rules.table_open = () => '<div class="table-scroll"><table>';
md.renderer.rules.table_close = () => '</table></div>';

md.use(anchor, {
  slugify,
  level: [2, 3, 4],
  permalink: anchor.permalink.linkInsideHeader({ symbol: '', class: 'heading-anchor', placement: 'after', ariaHidden: true }),
});

export function sanitizeMarkdownSource(src: string): string {
  return src.replace(/<script\b[\s\S]*?<\/script\s*>/gi, '');
}

/** Render markdown → { html, toc } (h2/h3 headings for the On-this-page rail). */
export function renderMarkdown(src: string): { html: string; toc: TocItem[] } {
  const sanitized = sanitizeMarkdownSource(src);
  const tokens = md.parse(sanitized, {});
  const toc: TocItem[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'heading_open' && (t.tag === 'h2' || t.tag === 'h3')) {
      const id = t.attrGet('id') || '';
      const label = (tokens[i + 1]?.content || '').replace(/<[^>]*>/g, '');
      if (id) toc.push({ id, label, level: Number(t.tag[1]) });
    }
  }
  return { html: md.render(sanitized), toc };
}
