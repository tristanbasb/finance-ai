import { describe, expect, it } from "vitest";
import {
  ACTION_IDS_PER_REQUEST,
  actionDisplayState,
  actionIdBatches,
  actionKind,
  actionsUrl,
  actionSummaryText,
  actionTime,
  messageActionIds,
  threadActionIds,
  undoneActionId,
  undoUntil,
  writeToggleReducer,
  type WriteToggleState,
  type ActionStatus,
} from "@/lib/ai-actions-ui";
import { WRITE_TOOL_NAME_LIST } from "@/lib/ai/write-tool-names";
import type { ThreadMessage } from "@/lib/assistant-thread";

function msg(partial: Partial<ThreadMessage> & { id: number }): ThreadMessage {
  return {
    role: "assistant",
    kind: "chat",
    content: "",
    source: "app",
    readAt: null,
    createdAt: 0,
    meta: null,
    ...partial,
  } as ThreadMessage;
}

describe("actionKind", () => {
  it("couvre chaque outil d'écriture avec une icône et un libellé", () => {
    for (const tool of WRITE_TOOL_NAME_LIST) {
      const kind = actionKind(tool);
      expect(kind.icon).toMatch(/^[A-Z][A-Za-z0-9]+$/);
      expect(kind.label.length).toBeGreaterThan(3);
      expect(kind.family).not.toBe("other");
    }
  });

  it("regroupe par famille", () => {
    expect(actionKind("add_transaction")).toMatchObject({ family: "operation", label: "Opération ajoutée" });
    expect(actionKind("update_transaction")).toMatchObject({ family: "operation", label: "Opération modifiée" });
    expect(actionKind("delete_transaction")).toMatchObject({ family: "operation", label: "Opération supprimée" });
    expect(actionKind("recategorize_transactions")).toMatchObject({ family: "recategorization", label: "Recatégorisation" });
    expect(actionKind("set_budget")).toMatchObject({ family: "budget", label: "Budget" });
    expect(actionKind("create_category")).toMatchObject({ family: "category", label: "Catégorie créée" });
    expect(actionKind("rename_category")).toMatchObject({ family: "category", label: "Catégorie renommée" });
    expect(actionKind("create_goal").family).toBe("goal");
    expect(actionKind("archive_account")).toMatchObject({ family: "account", label: "Compte archivé" });
    expect(actionKind("delete_holding")).toMatchObject({ family: "holding", label: "Placement supprimé" });
  });

  it("une même famille partage icône et teinte", () => {
    expect(actionKind("create_goal").icon).toBe(actionKind("delete_goal").icon);
    expect(actionKind("add_holding").tone).toBe(actionKind("update_holding").tone);
  });

  it("outil inconnu : repli générique", () => {
    expect(actionKind("mystere")).toEqual({ family: "other", icon: "PencilLine", label: "Modification", tone: "accent" });
  });
});

describe("actionDisplayState", () => {
  const base: ActionStatus = { undoneAt: null, undoable: true };

  it("annulable", () => {
    expect(actionDisplayState(base)).toEqual({ state: "undoable", label: "Annulable" });
  });

  it("annulée (journal ou annulation locale)", () => {
    expect(actionDisplayState({ undoneAt: 5, undoable: false, reason: "Déjà annulée." })).toEqual({
      state: "undone",
      label: "Annulée",
    });
    expect(actionDisplayState({ ...base, reason: "Déjà annulée.", undoable: false })).toMatchObject({ state: "undone" });
  });

  it("expirée", () => {
    expect(actionDisplayState({ undoneAt: null, undoable: false, reason: "Plus de 24 h : annulation impossible." })).toEqual({
      state: "expired",
      label: "Expirée",
      reason: "Plus de 24 h : annulation impossible.",
    });
  });

  it("modifiée depuis, avec la raison", () => {
    const reason = "Modifié depuis : Opération « Pain »";
    expect(actionDisplayState({ undoneAt: null, undoable: false, reason })).toEqual({
      state: "changed",
      label: "Modifiée depuis",
      reason,
    });
  });

  it("annulable devenue expirée après 24 h (horloge locale)", () => {
    const createdAt = 1_000_000;
    const day = 24 * 60 * 60 * 1000;
    expect(actionDisplayState(base, { createdAt, now: createdAt + day - 1 })).toMatchObject({ state: "undoable" });
    expect(actionDisplayState(base, { createdAt, now: createdAt + day })).toEqual({
      state: "expired",
      label: "Expirée",
      reason: "Plus de 24 h : annulation impossible.",
    });
  });

  it("autre refus : non annulable, raison affichée", () => {
    expect(actionDisplayState({ undoneAt: null, undoable: false, reason: "Journal illisible : annulation impossible." })).toEqual({
      state: "blocked",
      label: "Non annulable",
      reason: "Journal illisible : annulation impossible.",
    });
    expect(actionDisplayState({ undoneAt: null, undoable: false })).toEqual({
      state: "blocked",
      label: "Non annulable",
      reason: "Annulation impossible.",
    });
  });
});

describe("actionTime / undoUntil", () => {
  const now = new Date(2026, 9, 20, 15, 0).getTime();

  it("date relative courte", () => {
    expect(actionTime(now - 10_000, now)).toBe("à l'instant");
    expect(actionTime(now - 5 * 60_000, now)).toBe("il y a 5 min");
    expect(actionTime(new Date(2026, 9, 19, 9, 30).getTime(), now)).toBe("hier à 09:30");
  });

  it("échéance d'annulation (24 h)", () => {
    expect(undoUntil(new Date(2026, 9, 20, 14, 5).getTime(), now)).toBe("jusqu'à demain à 14:05");
    expect(undoUntil(new Date(2026, 9, 19, 16, 20).getTime(), now)).toBe("jusqu'à 16:20");
  });
});

describe("ids d'actions du fil", () => {
  it("lit meta.actions (entiers positifs uniquement)", () => {
    expect(messageActionIds(msg({ id: 1, meta: { replyTo: 1, actions: [3, 4] } }))).toEqual([3, 4]);
    expect(messageActionIds(msg({ id: 1, meta: { actions: [0, -1, 2.5, "7", 8] } }))).toEqual([8]);
    expect(messageActionIds(msg({ id: 1, meta: { actions: "3" } }))).toEqual([]);
    expect(messageActionIds(msg({ id: 1, meta: null }))).toEqual([]);
    expect(messageActionIds(msg({ id: 1, role: "user", meta: { actions: [1] } }))).toEqual([]);
  });

  it("message système d'annulation", () => {
    expect(undoneActionId(msg({ id: 1, source: "system", meta: { undoneAction: 4, replyTo: 1 } }))).toBe(4);
    expect(undoneActionId(msg({ id: 1, source: "app", meta: { undoneAction: 4 } }))).toBeNull();
    expect(undoneActionId(msg({ id: 1, source: "system", meta: { undoneAction: "4" } }))).toBeNull();
    expect(undoneActionId(msg({ id: 1, source: "system", meta: null }))).toBeNull();
  });

  it("rassemble les ids visibles, sans doublon, dans l'ordre", () => {
    const list = [
      msg({ id: 1, meta: { actions: [5, 6] } }),
      msg({ id: 2, role: "user" }),
      msg({ id: 3, meta: { actions: [7, 5] } }),
    ];
    expect(threadActionIds(list)).toEqual([5, 6, 7]);
  });

  it("une seule requête par lot de 50 ids", () => {
    expect(ACTION_IDS_PER_REQUEST).toBe(50);
    expect(actionIdBatches([])).toEqual([]);
    expect(actionIdBatches([1, 2, 3])).toEqual([[1, 2, 3]]);
    const many = Array.from({ length: 120 }, (_, i) => i + 1);
    const batches = actionIdBatches(many);
    expect(batches.map((b) => b.length)).toEqual([50, 50, 20]);
    expect(batches.flat()).toEqual(many);
  });

  it("URL de lecture des statuts", () => {
    expect(actionsUrl([3, 1, 2])).toBe("/api/ai/actions?ids=3,1,2");
  });
});

describe("actionSummaryText", () => {
  it("retire le libellé déjà affiché en tête du résumé", () => {
    expect(actionSummaryText("Opération ajoutée : Pain −12,00 €", "Opération ajoutée")).toBe("Pain −12,00 €");
    expect(actionSummaryText("Budget « Courses » : 300,00 €", "Budget")).toBe("Budget « Courses » : 300,00 €");
    expect(actionSummaryText("Opération ajoutée : ", "Opération ajoutée")).toBe("Opération ajoutée : ");
  });
});

describe("writeToggleReducer", () => {
  const ready = (confirmed: boolean): WriteToggleState => ({ status: "ready", confirmed, shown: confirmed, saving: false });

  it("chargement réussi ou échoué, puis nouvel essai", () => {
    expect(writeToggleReducer({ status: "loading" }, { type: "loaded", enabled: false })).toEqual(ready(false));
    expect(writeToggleReducer({ status: "loading" }, { type: "loadFailed" })).toEqual({ status: "error" });
    expect(writeToggleReducer({ status: "error" }, { type: "retry" })).toEqual({ status: "loading" });
  });

  it("bascule optimiste, puis valeur confirmée", () => {
    const s1 = writeToggleReducer(ready(true), { type: "toggle", next: false });
    expect(s1).toEqual({ status: "ready", confirmed: true, shown: false, saving: true });
    expect(writeToggleReducer(s1, { type: "saved", enabled: false })).toEqual(ready(false));
  });

  it("aucune bascule pendant un enregistrement", () => {
    const s1 = writeToggleReducer(ready(true), { type: "toggle", next: false });
    expect(writeToggleReducer(s1, { type: "toggle", next: true })).toBe(s1);
    expect(writeToggleReducer({ status: "loading" }, { type: "toggle", next: true })).toEqual({ status: "loading" });
  });

  it("échec : retour à la dernière valeur confirmée par le serveur", () => {
    const s1 = writeToggleReducer(ready(true), { type: "toggle", next: false });
    expect(writeToggleReducer(s1, { type: "saveFailed" })).toEqual(ready(true));
  });
});
