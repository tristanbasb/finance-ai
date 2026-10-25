import { describe, expect, it } from "vitest";
import {
  greeting,
  headerTitle,
  isActive,
  isColumnCollapsed,
  showClaudeColumn,
} from "@/lib/navigation";

describe("isActive", () => {
  it("« / » ne correspond qu'à l'accueil", () => {
    expect(isActive("/", "/")).toBe(true);
    expect(isActive("/transactions", "/")).toBe(false);
  });

  it("reconnaît chacune des 4 rubriques et leurs sous-pages", () => {
    for (const href of ["/transactions", "/patrimoine", "/budgets"]) {
      expect(isActive(href, href)).toBe(true);
      expect(isActive(`${href}/123`, href)).toBe(true);
      expect(isActive("/", href)).toBe(false);
    }
  });

  it("ignore l'ancre du lien (/patrimoine#…)", () => {
    expect(isActive("/patrimoine", "/patrimoine#epargne")).toBe(true);
    expect(isActive("/patrimoine", "/patrimoine#investissements")).toBe(true);
  });

  it("n'active pas une rubrique sur un simple préfixe", () => {
    expect(isActive("/budgetsx", "/budgets")).toBe(false);
    expect(isActive("/settings", "/budgets")).toBe(false);
  });
});

describe("greeting", () => {
  it("dit bonjour le matin, de 5 h à midi", () => {
    expect(greeting(5)).toBe("Bonjour");
    expect(greeting(11)).toBe("Bonjour");
  });

  it("dit bon après-midi de midi à 18 h", () => {
    expect(greeting(12)).toBe("Bon après-midi");
    expect(greeting(17)).toBe("Bon après-midi");
  });

  it("dit bonsoir le soir et la nuit", () => {
    expect(greeting(18)).toBe("Bonsoir");
    expect(greeting(23)).toBe("Bonsoir");
    expect(greeting(0)).toBe("Bonsoir");
    expect(greeting(4)).toBe("Bonsoir");
  });

  it("ne contient aucun emoji", () => {
    for (let h = 0; h < 24; h++) expect(greeting(h)).toMatch(/^[\p{L} -]+$/u);
  });
});

describe("headerTitle", () => {
  it("salue sur l'accueil, « Accueil » tant que l'heure est inconnue", () => {
    expect(headerTitle("/", 9)).toBe("Bonjour");
    expect(headerTitle("/", 20)).toBe("Bonsoir");
    expect(headerTitle("/", null)).toBe("Accueil");
  });

  it("donne le nom de la rubrique ailleurs", () => {
    expect(headerTitle("/transactions", 9)).toBe("Activité");
    expect(headerTitle("/patrimoine", 9)).toBe("Patrimoine");
    expect(headerTitle("/budgets", 9)).toBe("Budgets");
    expect(headerTitle("/settings", 9)).toBe("Réglages");
    expect(headerTitle("/assistant", 9)).toBe("Assistant");
    expect(headerTitle("/inconnu", 9)).toBe("Finance AI");
  });
});

describe("colonne Claude", () => {
  it("lit l'état replié stocké", () => {
    expect(isColumnCollapsed("collapsed")).toBe(true);
    expect(isColumnCollapsed(null)).toBe(false);
    expect(isColumnCollapsed("open")).toBe(false);
  });

  it("n'est affichée que sur grand écran, dépliée, hors page Assistant", () => {
    expect(showClaudeColumn({ wide: true, collapsed: false, pathname: "/" })).toBe(true);
    expect(showClaudeColumn({ wide: false, collapsed: false, pathname: "/" })).toBe(false);
    expect(showClaudeColumn({ wide: true, collapsed: true, pathname: "/" })).toBe(false);
    expect(showClaudeColumn({ wide: true, collapsed: false, pathname: "/assistant" })).toBe(false);
  });
});
