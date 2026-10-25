import { describe, expect, it } from "vitest";
import {
  badgeCount,
  excerpt,
  hasSavedQuestion,
  isProactive,
  isSeen,
  kindLabel,
  mergeMessages,
  relativeTime,
  takeNewUnread,
  tailIsBehind,
  unreadAssistantIds,
  type ThreadMessage,
} from "@/lib/assistant-thread";

function msg(id: number, over: Partial<ThreadMessage> = {}): ThreadMessage {
  return {
    id,
    role: "assistant",
    kind: "chat",
    content: `message ${id}`,
    source: "app",
    readAt: null,
    createdAt: id * 1000,
    meta: null,
    ...over,
  };
}

// Intl insère des espaces insécables : on les normalise pour comparer.
const norm = (s: string) => s.replace(/\s/g, " ");

describe("kindLabel / isProactive", () => {
  it("nomme chaque type de message", () => {
    expect(kindLabel("alert")).toBe("Alerte");
    expect(kindLabel("weekly")).toBe("Bilan de la semaine");
    expect(kindLabel("monthly")).toBe("Bilan du mois");
    expect(kindLabel("chat")).toBe("Claude");
    expect(kindLabel("divider")).toBe("Nouvelle conversation");
  });

  it("distingue les messages proactifs", () => {
    expect(isProactive("alert")).toBe(true);
    expect(isProactive("weekly")).toBe(true);
    expect(isProactive("monthly")).toBe(true);
    expect(isProactive("chat")).toBe(false);
    expect(isProactive("divider")).toBe(false);
  });
});

describe("excerpt", () => {
  it("retire le markdown et aplatit les lignes", () => {
    expect(excerpt("## Budget\n\n**Courses** : 92 % atteint\n- `Loisirs` *dépassé*")).toBe(
      "Budget — Courses : 92 % atteint Loisirs dépassé",
    );
  });

  it("garde le texte court tel quel", () => {
    expect(excerpt("Bonjour", 80)).toBe("Bonjour");
  });

  it("coupe au dernier mot entier avec une ellipse", () => {
    const text = "Votre budget Courses atteint quatre-vingt-douze pour cent du montant prévu ce mois-ci, attention";
    const out = excerpt(text, 40);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(41);
    expect(text.startsWith(out.slice(0, -1))).toBe(true);
  });

  it("n'altère pas les traits de soulignement au milieu des mots", () => {
    expect(excerpt("compte_joint et *ok*")).toBe("compte_joint et ok");
  });
});

describe("relativeTime", () => {
  const now = new Date(2026, 9, 25, 15, 30).getTime();

  it("formate les instants récents", () => {
    expect(relativeTime(now - 10_000, now)).toBe("à l'instant");
    expect(relativeTime(now - 5 * 60_000, now)).toBe("il y a 5 min");
    expect(relativeTime(new Date(2026, 9, 25, 12, 0).getTime(), now)).toBe("il y a 3 h");
  });

  it("formate hier, la semaine et les dates plus anciennes", () => {
    expect(norm(relativeTime(new Date(2026, 9, 24, 14, 5).getTime(), now))).toBe("hier à 14:05");
    expect(norm(relativeTime(new Date(2026, 9, 19, 9, 0).getTime(), now))).toBe("lundi à 09:00");
    expect(norm(relativeTime(new Date(2026, 9, 12, 9, 0).getTime(), now))).toBe("12 oct.");
    expect(norm(relativeTime(new Date(2025, 9, 12, 9, 0).getTime(), now))).toBe("12 oct. 2025");
  });

  it("considère hier un message de la veille au soir même à moins de 24 h", () => {
    const early = new Date(2026, 9, 25, 1, 0).getTime();
    expect(norm(relativeTime(new Date(2026, 9, 24, 23, 0).getTime(), early))).toBe("hier à 23:00");
    expect(norm(relativeTime(new Date(2026, 9, 25, 0, 30).getTime(), early))).toBe("il y a 30 min");
  });

  it("traite une date future (horloge décalée) comme « à l'instant »", () => {
    expect(relativeTime(now + 60_000, now)).toBe("à l'instant");
  });
});

describe("mergeMessages", () => {
  it("fusionne, déduplique et trie par id", () => {
    const merged = mergeMessages([msg(3), msg(1)], [msg(2), msg(3, { readAt: 5 })]);
    expect(merged.map((m) => m.id)).toEqual([1, 2, 3]);
    expect(merged[2].readAt).toBe(5);
  });

  it("ne modifie pas les listes d'origine", () => {
    const a = [msg(2)];
    mergeMessages(a, [msg(1)]);
    expect(a.map((m) => m.id)).toEqual([2]);
  });
});

describe("unreadAssistantIds", () => {
  it("ne retient que les messages de Claude non lus", () => {
    const list = [
      msg(1),
      msg(2, { readAt: 10 }),
      msg(3, { role: "user" }),
      msg(4, { role: "divider", kind: "divider" }),
      msg(5, { kind: "alert" }),
    ];
    expect(unreadAssistantIds(list)).toEqual([1, 5]);
  });
});

describe("takeNewUnread", () => {
  it("renvoie les nouveaux ids du plus ancien au plus récent et les mémorise", () => {
    const seen = new Set<number>([1]);
    const fresh = takeNewUnread([msg(3), msg(2), msg(1)], seen);
    expect(fresh.map((m) => m.id)).toEqual([2, 3]);
    expect([...seen].sort()).toEqual([1, 2, 3]);
    expect(takeNewUnread([msg(3)], seen)).toEqual([]);
  });
});

describe("badgeCount", () => {
  it("plafonne à 9+", () => {
    expect(badgeCount(1)).toBe("1");
    expect(badgeCount(9)).toBe("9");
    expect(badgeCount(10)).toBe("9+");
  });
});

describe("excerpt : titres", () => {
  it("sépare un titre du texte qui suit", () => {
    expect(excerpt("## Bilan de septembre\n\nRevenus **3 200 €**")).toBe("Bilan de septembre — Revenus 3 200 €");
    expect(excerpt("# Titre seul #")).toBe("Titre seul");
  });
});

describe("mergeMessages : référence stable", () => {
  it("renvoie la liste courante telle quelle si rien n'a changé", () => {
    const current = [msg(1), msg(2, { readAt: 5 })];
    expect(mergeMessages(current, [msg(1), msg(2, { readAt: 5 })])).toBe(current);
    expect(mergeMessages(current, [])).toBe(current);
  });

  it("renvoie une nouvelle liste si un message est ajouté ou lu", () => {
    const current = [msg(1), msg(2)];
    expect(mergeMessages(current, [msg(3)])).not.toBe(current);
    const read = mergeMessages(current, [msg(2, { readAt: 9 })]);
    expect(read).not.toBe(current);
    expect(read[1].readAt).toBe(9);
  });
});

describe("isSeen", () => {
  it("vu dès 40 % du message visible", () => {
    expect(isSeen({ ratio: 0.4, visibleHeight: 40, rootHeight: 600 })).toBe(true);
    expect(isSeen({ ratio: 0.39, visibleHeight: 39, rootHeight: 600 })).toBe(false);
  });

  it("message plus haut que la zone : vu s'il en occupe la moitié", () => {
    // 2 000 px de haut dans une zone de 600 px : 30 % au mieux, mais toute la zone.
    expect(isSeen({ ratio: 0.3, visibleHeight: 600, rootHeight: 600 })).toBe(true);
    expect(isSeen({ ratio: 0.15, visibleHeight: 300, rootHeight: 600 })).toBe(true);
    expect(isSeen({ ratio: 0.1, visibleHeight: 200, rootHeight: 600 })).toBe(false);
  });

  it("rien de visible ou zone inconnue", () => {
    expect(isSeen({ ratio: 0, visibleHeight: 0, rootHeight: 600 })).toBe(false);
    expect(isSeen({ ratio: 0.2, visibleHeight: 100, rootHeight: 0 })).toBe(false);
  });
});

describe("hasSavedQuestion", () => {
  it("retrouve la question envoyée parmi les nouveaux messages", () => {
    const fresh = [msg(5, { role: "user", content: "Mes budgets ?" }), msg(6)];
    expect(hasSavedQuestion(fresh, "  Mes budgets ?  ")).toBe(true);
    expect(hasSavedQuestion(fresh, "Autre question")).toBe(false);
  });

  it("rechargement échoué ou question venue de Telegram : non retrouvée", () => {
    expect(hasSavedQuestion(null, "Mes budgets ?")).toBe(false);
    expect(hasSavedQuestion([msg(5, { role: "user", source: "telegram", content: "Mes budgets ?" })], "Mes budgets ?")).toBe(false);
  });
});

describe("tailIsBehind (rechargement du fil piloté par le relevé des non-lus)", () => {
  const base = { ready: true, streaming: false, lastId: 5 };
  it("recharge si un non-lu est plus récent que le dernier message affiché", () => {
    expect(tailIsBehind({ ...base, unread: [msg(4), msg(7)] })).toBe(true);
  });
  it("ne recharge pas si le fil contient déjà tous les non-lus", () => {
    expect(tailIsBehind({ ...base, unread: [msg(5), msg(3)] })).toBe(false);
    expect(tailIsBehind({ ...base, unread: [] })).toBe(false);
  });
  it("recharge si un message déjà lu est plus récent (annulation depuis Telegram)", () => {
    expect(tailIsBehind({ ...base, unread: [], latestId: 6 })).toBe(true);
    expect(tailIsBehind({ ...base, unread: [], latestId: 5 })).toBe(false);
    expect(tailIsBehind({ ...base, streaming: true, unread: [], latestId: 6 })).toBe(false);
  });
  it("attend la fin du chargement initial et d'une réponse en cours", () => {
    expect(tailIsBehind({ ...base, ready: false, unread: [msg(9)] })).toBe(false);
    expect(tailIsBehind({ ...base, streaming: true, unread: [msg(9)] })).toBe(false);
  });
});
