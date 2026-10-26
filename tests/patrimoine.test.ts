import { describe, expect, it } from "vitest";
import { parseSection, patrimoineSections, redirectTargetFor, sectionFor } from "@/lib/patrimoine";

describe("sectionFor", () => {
  it("associe les anciens chemins à une rubrique de Patrimoine", () => {
    expect(sectionFor("/savings")).toBe("comptes");
    expect(sectionFor("/investments")).toBe("investissements");
    expect(sectionFor("/savings/")).toBe("comptes");
  });

  it("ignore les autres chemins", () => {
    expect(sectionFor("/")).toBeNull();
    expect(sectionFor("/patrimoine")).toBeNull();
    expect(sectionFor("/savings/x")).toBeNull();
  });
});

describe("redirectTargetFor", () => {
  it("passe la rubrique en paramètre de requête", () => {
    expect(redirectTargetFor("/savings")).toBe("/patrimoine?section=comptes");
    expect(redirectTargetFor("/investments")).toBe("/patrimoine?section=investissements");
    expect(redirectTargetFor("/transactions")).toBeNull();
  });
});

describe("parseSection", () => {
  it("accepte identifiants, hash et alias", () => {
    expect(parseSection("comptes")).toBe("comptes");
    expect(parseSection("#objectifs")).toBe("objectifs");
    expect(parseSection("epargne")).toBe("comptes");
    expect(parseSection("#Investissements")).toBe("investissements");
    expect(parseSection("#actualites")).toBe("actualites");
  });

  it("refuse les valeurs inconnues", () => {
    expect(parseSection("")).toBeNull();
    expect(parseSection(null)).toBeNull();
    expect(parseSection("x")).toBeNull();
    expect(parseSection("constructor")).toBeNull();
  });
});

describe("patrimoineSections", () => {
  it("liste les rubriques dans l'ordre de la page, Actualités en dernier", () => {
    expect(patrimoineSections({ news: true }).map((s) => [s.id, s.label])).toEqual([
      ["comptes", "Comptes"],
      ["objectifs", "Objectifs"],
      ["investissements", "Investissements"],
      ["actualites", "Actualités"],
    ]);
  });

  it("masque Actualités quand la section est masquée", () => {
    expect(patrimoineSections({ news: false }).map((s) => s.id)).toEqual(["comptes", "objectifs", "investissements"]);
  });
});
