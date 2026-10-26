import { describe, expect, it } from "vitest";
import { displayTitle, hasMore, newsAge, updatedLabel } from "@/lib/news-ui";

const now = new Date(2026, 9, 26, 15, 0).getTime();
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();

describe("newsAge", () => {
  it("à l'instant sous une minute (ou dans le futur)", () => {
    expect(newsAge(now - 30_000, now)).toBe("à l'instant");
    expect(newsAge(now + 60_000, now)).toBe("à l'instant");
  });
  it("en minutes sous une heure", () => {
    expect(newsAge(now - 60_000, now)).toBe("il y a 1 min");
    expect(newsAge(at(26, 14, 1), now)).toBe("il y a 59 min");
  });
  it("en heures le même jour", () => {
    expect(newsAge(at(26, 12), now)).toBe("il y a 3 h");
    expect(newsAge(at(26, 0, 5), now)).toBe("il y a 14 h");
  });
  it("hier, puis la date courte", () => {
    expect(newsAge(at(25, 23), now)).toBe("hier");
    expect(newsAge(at(25, 1), now)).toBe("hier");
    expect(newsAge(at(24, 23), now)).toBe("24 oct.");
    expect(newsAge(at(12, 8), now)).toBe("12 oct.");
    expect(newsAge(new Date(2025, 11, 30, 8).getTime(), now)).toBe("30 déc. 2025");
  });
});

describe("updatedLabel", () => {
  it("formule la dernière mise à jour", () => {
    expect(updatedLabel(at(26, 12), now)).toBe("Mis à jour il y a 3 h");
    expect(updatedLabel(now, now)).toBe("Mis à jour à l'instant");
    expect(updatedLabel(at(25, 20), now)).toBe("Mis à jour hier");
    expect(updatedLabel(at(12, 8), now)).toBe("Mis à jour le 12 oct.");
  });
});

describe("displayTitle", () => {
  it("affiche le titre traduit avec l'original en info-bulle", () => {
    expect(displayTitle({ title: "Apple beats", titleFr: "Apple dépasse" })).toEqual({
      text: "Apple dépasse",
      original: "Apple beats",
    });
  });
  it("garde le titre d'origine sans traduction", () => {
    expect(displayTitle({ title: "Apple beats", titleFr: null })).toEqual({ text: "Apple beats" });
    expect(displayTitle({ title: "Même", titleFr: "Même" })).toEqual({ text: "Même" });
  });
});

describe("hasMore", () => {
  it("vrai seulement si la page est pleine", () => {
    expect(hasMore(10, 10)).toBe(true);
    expect(hasMore(9, 10)).toBe(false);
  });
});
