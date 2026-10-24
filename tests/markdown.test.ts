import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown } from "@/lib/markdown";

describe("parseInline", () => {
  it("texte brut", () => {
    expect(parseInline("Bonjour")).toEqual([{ type: "text", text: "Bonjour" }]);
  });

  it("gras, italique et code en ligne", () => {
    expect(parseInline("Total **1 234 €** en *octobre* via `search`")).toEqual([
      { type: "text", text: "Total " },
      { type: "bold", children: [{ type: "text", text: "1 234 €" }] },
      { type: "text", text: " en " },
      { type: "italic", text: "octobre" },
      { type: "text", text: " via " },
      { type: "code", text: "search" },
    ]);
  });

  it("italique imbriqué dans du gras", () => {
    expect(parseInline("**très *net***")).toEqual([
      {
        type: "bold",
        children: [
          { type: "text", text: "très " },
          { type: "italic", text: "net" },
        ],
      },
    ]);
  });

  it("marqueurs non fermés ou isolés laissés tels quels (flux en cours)", () => {
    expect(parseInline("Total **12")).toEqual([{ type: "text", text: "Total **12" }]);
    expect(parseInline("5 * 3 = 15")).toEqual([{ type: "text", text: "5 * 3 = 15" }]);
  });

  it("le code n'interprète pas le gras", () => {
    expect(parseInline("`**x**`")).toEqual([{ type: "code", text: "**x**" }]);
  });
});

describe("parseMarkdown", () => {
  it("paragraphes séparés par une ligne vide, retours à la ligne conservés", () => {
    expect(parseMarkdown("Ligne 1\nLigne 2\n\nParagraphe 2")).toEqual([
      {
        type: "paragraph",
        lines: [[{ type: "text", text: "Ligne 1" }], [{ type: "text", text: "Ligne 2" }]],
      },
      { type: "paragraph", lines: [[{ type: "text", text: "Paragraphe 2" }]] },
    ]);
  });

  it("listes à puces (-, *, •) et numérotées", () => {
    expect(parseMarkdown("Points :\n- un\n* **deux**\n• trois\n\n1. premier\n2) second")).toEqual([
      { type: "paragraph", lines: [[{ type: "text", text: "Points :" }]] },
      {
        type: "list",
        ordered: false,
        start: 1,
        items: [
          [[{ type: "text", text: "un" }]],
          [[{ type: "bold", children: [{ type: "text", text: "deux" }] }]],
          [[{ type: "text", text: "trois" }]],
        ],
      },
      {
        type: "list",
        ordered: true,
        start: 1,
        items: [[[{ type: "text", text: "premier" }]], [[{ type: "text", text: "second" }]]],
      },
    ]);
  });

  it("liste numérotée commençant à 3, ligne de continuation rattachée à l'élément", () => {
    expect(parseMarkdown("3. trois\n   suite\n4. quatre")).toEqual([
      {
        type: "list",
        ordered: true,
        start: 3,
        items: [
          [[{ type: "text", text: "trois" }], [{ type: "text", text: "suite" }]],
          [[{ type: "text", text: "quatre" }]],
        ],
      },
    ]);
  });

  it("titres rendus en paragraphe gras, bloc de code clôturé", () => {
    expect(parseMarkdown("## Bilan\n```\nconst a = 1;\n```")).toEqual([
      {
        type: "paragraph",
        lines: [[{ type: "bold", children: [{ type: "text", text: "Bilan" }] }]],
      },
      { type: "code", text: "const a = 1;" },
    ]);
  });

  it("le HTML reste du texte (aucune interprétation)", () => {
    expect(parseMarkdown("<script>alert(1)</script>")).toEqual([
      { type: "paragraph", lines: [[{ type: "text", text: "<script>alert(1)</script>" }]] },
    ]);
  });

  it("texte vide → aucun bloc ; CRLF accepté", () => {
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown("a\r\n\r\nb")).toHaveLength(2);
  });
});
