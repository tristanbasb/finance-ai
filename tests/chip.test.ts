import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Chip, type ChipProps } from "@/components/ui/chip";

const html = (props: ChipProps) => renderToStaticMarkup(createElement(Chip, props, "Pastille"));

describe("Chip : état annoncé", () => {
  it("bouton simple (exemple) : ni aria-pressed ni aria-current", () => {
    const out = html({ onClick: () => {} });
    expect(out).not.toContain("aria-pressed");
    expect(out).not.toContain("aria-current");
  });

  it("bascule : aria-pressed seulement si `selected` est fourni", () => {
    expect(html({ selected: true, onClick: () => {} })).toContain('aria-pressed="true"');
    expect(html({ selected: false, onClick: () => {} })).toContain('aria-pressed="false"');
  });

  it("navigation par rubrique : aria-current sur la rubrique en cours, jamais aria-pressed", () => {
    const on = html({ current: true, onClick: () => {} });
    expect(on).toContain('aria-current="true"');
    expect(on).toContain("bg-brand-gradient");
    const off = html({ current: false, onClick: () => {} });
    expect(off).not.toContain("aria-current");
    expect(off).not.toContain("aria-pressed");
  });

  it("lien : aria-current quand il est sélectionné", () => {
    expect(html({ href: "/x", selected: true })).toContain('aria-current="true"');
    expect(html({ href: "/x", selected: false })).not.toContain("aria-current");
  });
});
