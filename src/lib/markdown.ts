// Markdown minimal et sûr pour les réponses de l'assistant : paragraphes, retours à la ligne,
// **gras**, *italique*, `code`, listes à puces / numérotées, blocs ``` et titres (rendus en gras).
// Le parseur ne produit que des nœuds de texte : le rendu construit des éléments React,
// jamais de HTML brut, donc toute balise reste du texte affiché.

export type Inline =
  | { type: "text"; text: string }
  | { type: "bold"; children: Inline[] }
  | { type: "italic"; text: string }
  | { type: "code"; text: string };

/** Une ligne = suite de nœuds en ligne ; les lignes d'un même bloc sont séparées par un retour à la ligne. */
export type Line = Inline[];

export type Block =
  | { type: "paragraph"; lines: Line[] }
  | { type: "list"; ordered: boolean; start: number; items: Line[][] }
  | { type: "code"; text: string };

// Code en ligne, puis gras (contenu non vide, sans espace aux bords), puis italique avec `*`.
const INLINE =
  /`([^`\n]+)`|\*\*(?=\S)([^\n]*?\S)\*\*(?!\*)|\*(?=[^\s*])([^*\n]*?[^\s*])\*(?!\*)/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  const push = (node: Inline) => {
    const prev = out[out.length - 1];
    if (node.type === "text" && prev?.type === "text") prev.text += node.text;
    else out.push(node);
  };
  for (const m of text.matchAll(INLINE)) {
    const index = m.index ?? 0;
    if (index > last) push({ type: "text", text: text.slice(last, index) });
    if (m[1] !== undefined) push({ type: "code", text: m[1] });
    else if (m[2] !== undefined) push({ type: "bold", children: parseInline(m[2]) });
    else push({ type: "italic", text: m[3] });
    last = index + m[0].length;
  }
  if (last < text.length) push({ type: "text", text: text.slice(last) });
  return out;
}

const BULLET = /^\s*[-*•]\s+(.*)$/;
const ORDERED = /^\s*(\d{1,9})[.)]\s+(.*)$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const FENCE = /^\s*```/;

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: Line[] | null = null;
  let list: Extract<Block, { type: "list" }> | null = null;

  const flush = () => {
    if (paragraph) blocks.push({ type: "paragraph", lines: paragraph });
    if (list) blocks.push(list);
    paragraph = null;
    list = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (FENCE.test(line)) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i])) body.push(lines[i++]);
      blocks.push({ type: "code", text: body.join("\n") });
      continue;
    }

    if (line.trim() === "") {
      flush();
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ type: "paragraph", lines: [[{ type: "bold", children: parseInline(heading[1]) }]] });
      continue;
    }

    const bullet = BULLET.exec(line);
    const ordered = bullet ? null : ORDERED.exec(line);
    if (bullet || ordered) {
      const isOrdered = ordered !== null;
      const content = bullet ? bullet[1] : ordered![2];
      if (paragraph || (list && list.ordered !== isOrdered)) flush();
      if (!list) {
        list = { type: "list", ordered: isOrdered, start: ordered ? Number(ordered[1]) : 1, items: [] };
      }
      list.items.push([parseInline(content.trim())]);
      continue;
    }

    // Ligne de continuation indentée sous un élément de liste.
    if (list && /^\s+\S/.test(line)) {
      list.items[list.items.length - 1].push(parseInline(line.trim()));
      continue;
    }

    if (list) flush();
    paragraph ??= [];
    paragraph.push(parseInline(line.trim()));
  }
  flush();
  return blocks;
}
