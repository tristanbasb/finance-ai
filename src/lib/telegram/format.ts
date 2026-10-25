import { parseMarkdown, type Inline, type Line } from "@/lib/markdown";

/** Longueur maximale d'un morceau (Telegram : 4 096 caractères par message). */
export const TELEGRAM_MAX = 4000;

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inline(nodes: Inline[]): string {
  return nodes
    .map((n) => {
      switch (n.type) {
        case "text":
          return escapeHtml(n.text);
        case "bold":
          return `<b>${inline(n.children)}</b>`;
        case "italic":
          return `<i>${escapeHtml(n.text)}</i>`;
        case "code":
          return `<code>${escapeHtml(n.text)}</code>`;
      }
    })
    .join("");
}

const lines = (ls: Line[], indent = "") => ls.map(inline).join(`\n${indent}`);

/**
 * Markdown restreint de l'assistant (même parseur que l'app) → HTML Telegram : `<b>`, `<i>`,
 * `<code>`, `<pre>`, puces « • », listes numérotées conservées, paragraphes séparés par une
 * ligne vide. Tout le texte est échappé (`& < >`) : aucune balise ne vient du contenu.
 */
export function toTelegramHtml(markdown: string): string {
  return parseMarkdown(markdown)
    .map((block) => {
      if (block.type === "code") return `<pre>${escapeHtml(block.text)}</pre>`;
      if (block.type === "paragraph") return lines(block.lines);
      return block.items
        .map((item, i) => `${block.ordered ? `${block.start + i}.` : "•"} ${lines(item, "   ")}`)
        .join("\n");
    })
    .join("\n\n");
}

/** Coupe une ligne trop longue, de préférence sur un espace, sans couper une paire UTF-16. */
function hardSplit(line: string, max: number): string[] {
  const out: string[] = [];
  let rest = line;
  while (rest.length > max) {
    let cut = rest.lastIndexOf(" ", max);
    if (cut < max / 2) cut = max;
    const code = rest.charCodeAt(cut - 1);
    if (code >= 0xd800 && code <= 0xdbff) cut--;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^ /, "");
  }
  if (rest) out.push(rest);
  return out;
}

/**
 * Découpe un texte (markdown source) en morceaux de `max` caractères au plus : aux paragraphes,
 * puis aux lignes, puis en dur. À convertir morceau par morceau (aucune balise coupée).
 */
export function splitMessage(text: string, max: number = TELEGRAM_MAX): string[] {
  const source = text.replace(/\r\n?/g, "\n").trim();
  if (source.length <= max) return source ? [source] : [];

  const chunks: string[] = [];
  let current = "";
  const add = (piece: string, sep: string) => {
    if (!current) current = piece;
    else if (current.length + sep.length + piece.length <= max) current += sep + piece;
    else {
      chunks.push(current);
      current = piece;
    }
  };

  for (const paragraph of source.split(/\n{2,}/)) {
    if (paragraph.length <= max) {
      add(paragraph, "\n\n");
      continue;
    }
    paragraph.split("\n").forEach((line, i) => {
      const pieces = line.length <= max ? [line] : hardSplit(line, max);
      pieces.forEach((piece, j) => add(piece, i === 0 && j === 0 ? "\n\n" : "\n"));
    });
  }
  if (current) chunks.push(current);
  return chunks;
}
