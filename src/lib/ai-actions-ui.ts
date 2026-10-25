// Cartes d'action de Claude côté navigateur : type d'action, état d'annulation, dates et
// regroupement des ids pour la lecture des statuts. Module pur (aucun accès au DOM ni au
// réseau), testé avec vitest.

import { relativeTime, type ThreadMessage } from "@/lib/assistant-thread";
import type { WriteToolName } from "@/lib/ai/write-tool-names";

export type ActionFamily =
  | "operation"
  | "recategorization"
  | "budget"
  | "category"
  | "goal"
  | "account"
  | "holding"
  | "other";

/** Nom d'icône lucide (résolu par le composant). */
export type ActionIconName =
  | "ArrowLeftRight"
  | "Tags"
  | "Gauge"
  | "Shapes"
  | "Target"
  | "Landmark"
  | "ChartLine"
  | "PencilLine";

/** Teinte de la pastille : jetons de couleur existants. */
export type ActionTone = "accent" | "positive" | "warning";

export type ActionKind = { family: ActionFamily; icon: ActionIconName; label: string; tone: ActionTone };

const FAMILIES: Record<Exclude<ActionFamily, "other">, { icon: ActionIconName; tone: ActionTone }> = {
  operation: { icon: "ArrowLeftRight", tone: "accent" },
  recategorization: { icon: "Tags", tone: "accent" },
  budget: { icon: "Gauge", tone: "warning" },
  category: { icon: "Shapes", tone: "accent" },
  goal: { icon: "Target", tone: "positive" },
  account: { icon: "Landmark", tone: "accent" },
  holding: { icon: "ChartLine", tone: "positive" },
};

const TOOLS: Record<WriteToolName, { family: Exclude<ActionFamily, "other">; label: string }> = {
  add_transaction: { family: "operation", label: "Opération ajoutée" },
  update_transaction: { family: "operation", label: "Opération modifiée" },
  delete_transaction: { family: "operation", label: "Opération supprimée" },
  recategorize_transactions: { family: "recategorization", label: "Recatégorisation" },
  set_budget: { family: "budget", label: "Budget" },
  create_category: { family: "category", label: "Catégorie créée" },
  rename_category: { family: "category", label: "Catégorie renommée" },
  create_goal: { family: "goal", label: "Objectif créé" },
  update_goal: { family: "goal", label: "Objectif modifié" },
  delete_goal: { family: "goal", label: "Objectif supprimé" },
  create_account: { family: "account", label: "Compte créé" },
  rename_account: { family: "account", label: "Compte renommé" },
  archive_account: { family: "account", label: "Compte archivé" },
  add_holding: { family: "holding", label: "Position ajoutée" },
  update_holding: { family: "holding", label: "Position modifiée" },
  delete_holding: { family: "holding", label: "Position supprimée" },
};

const FALLBACK: ActionKind = { family: "other", icon: "PencilLine", label: "Modification", tone: "accent" };

/**
 * Type d'une action d'après le nom de l'outil : famille, icône, libellé court, teinte. Le résumé
 * précise le libellé quand un même outil fait deux choses (`archive_account` désarchive aussi).
 */
export function actionKind(tool: string, summary?: string): ActionKind {
  const entry = Object.hasOwn(TOOLS, tool) ? TOOLS[tool as WriteToolName] : undefined;
  if (!entry) return FALLBACK;
  const label = tool === "archive_account" && summary?.trimEnd().endsWith("désarchivé") ? "Compte désarchivé" : entry.label;
  return { family: entry.family, label, ...FAMILIES[entry.family] };
}

/**
 * Résumé sans le libellé du type quand il le répète (« Opération ajoutée : Pain » sous le titre
 * « Opération ajoutée » → « Pain »). Résumé inchangé s'il ne resterait rien.
 */
export function actionSummaryText(summary: string, label: string): string {
  const prefix = `${label} : `;
  if (!summary.startsWith(prefix)) return summary;
  const rest = summary.slice(prefix.length).trim();
  return rest || summary;
}

/** Statut d'une action tel que renvoyé par `GET /api/ai/actions`. */
export type ActionStatus = { undoneAt: number | null; undoable: boolean; reason?: string };

/** Vue complète d'une action (`GET /api/ai/actions`). */
export type ActionView = ActionStatus & {
  id: number;
  tool: string;
  summary: string;
  createdAt: number;
  items: string[];
};

export type ActionDisplayState =
  | { state: "undoable"; label: "Annulable" }
  | { state: "undone"; label: "Annulée" }
  | { state: "expired"; label: "Expirée"; reason: string }
  | { state: "changed"; label: "Modifiée depuis"; reason: string }
  | { state: "blocked"; label: "Non annulable"; reason: string };

const UNDO_WINDOW_MS = 24 * 60 * 60 * 1000;
const EXPIRED_REASON = "Plus de 24 h : annulation impossible.";

/**
 * État affiché d'une action : annulable, annulée, expirée, modifiée depuis (ou autre refus).
 * Avec `clock`, une action annulable dont les 24 h sont écoulées s'affiche expirée sans attendre
 * une nouvelle lecture des statuts.
 */
export function actionDisplayState(
  status: ActionStatus,
  clock?: { createdAt: number; now: number },
): ActionDisplayState {
  if (status.undoneAt !== null || status.reason === "Déjà annulée.") return { state: "undone", label: "Annulée" };
  if (status.undoable) {
    if (clock && clock.now - clock.createdAt >= UNDO_WINDOW_MS) {
      return { state: "expired", label: "Expirée", reason: EXPIRED_REASON };
    }
    return { state: "undoable", label: "Annulable" };
  }
  const reason = status.reason?.trim() || "Annulation impossible.";
  if (reason.startsWith("Plus de 24 h")) return { state: "expired", label: "Expirée", reason };
  if (reason.startsWith("Modifié depuis")) return { state: "changed", label: "Modifiée depuis", reason };
  return { state: "blocked", label: "Non annulable", reason };
}

/** Date de l'action, relative et courte (« il y a 5 min », « hier à 09:30 »). */
export function actionTime(createdAt: number, now: number = Date.now()): string {
  return relativeTime(createdAt, now);
}

const hourFormat = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });

function sameDay(a: number, b: number): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

/** Échéance d'annulation (24 h après l'action) : « jusqu'à 16:20 », « jusqu'à demain à 14:05 ». */
export function undoUntil(createdAt: number, now: number = Date.now()): string {
  const end = createdAt + UNDO_WINDOW_MS;
  const time = hourFormat.format(end);
  return sameDay(end, now) ? `jusqu'à ${time}` : `jusqu'à demain à ${time}`;
}

function isId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** Ids des actions faites par Claude dans ce message (`meta.actions`). */
export function messageActionIds(message: ThreadMessage): number[] {
  if (message.role !== "assistant") return [];
  const actions = message.meta?.actions;
  return Array.isArray(actions) ? actions.filter(isId) : [];
}

/** Id de l'action annulée si ce message est la note système « Action annulée : … », sinon null. */
export function undoneActionId(message: ThreadMessage): number | null {
  if (message.role !== "assistant" || message.source !== "system") return null;
  const id = message.meta?.undoneAction;
  return isId(id) ? id : null;
}

/** Ids des actions de tous les messages affichés, sans doublon, dans l'ordre du fil. */
export function threadActionIds(messages: readonly ThreadMessage[]): number[] {
  const seen = new Set<number>();
  for (const m of messages) for (const id of messageActionIds(m)) seen.add(id);
  return [...seen];
}

/** Ids acceptés au plus par `GET /api/ai/actions`. */
export const ACTION_IDS_PER_REQUEST = 50;

/** Lots d'ids : une requête par lot (une seule tant que le fil compte 50 actions au plus). */
export function actionIdBatches(ids: readonly number[]): number[][] {
  const batches: number[][] = [];
  for (let i = 0; i < ids.length; i += ACTION_IDS_PER_REQUEST) batches.push(ids.slice(i, i + ACTION_IDS_PER_REQUEST));
  return batches;
}

export function actionsUrl(ids: readonly number[]): string {
  return `/api/ai/actions?ids=${ids.join(",")}`;
}

// ---------------------------------------------------------------------------------------------
// Réglage « Autoriser Claude à modifier mes données »

/**
 * `confirmed` : dernière valeur confirmée par le serveur ; `shown` : valeur affichée (optimiste
 * pendant un enregistrement). Une seule bascule à la fois.
 */
export type WriteToggleState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; confirmed: boolean; shown: boolean; saving: boolean };

export type WriteToggleEvent =
  | { type: "loaded"; enabled: boolean }
  | { type: "loadFailed" }
  | { type: "retry" }
  | { type: "toggle"; next: boolean }
  | { type: "saved"; enabled: boolean }
  | { type: "saveFailed" };

export function writeToggleReducer(state: WriteToggleState, event: WriteToggleEvent): WriteToggleState {
  switch (event.type) {
    case "loaded":
      return { status: "ready", confirmed: event.enabled, shown: event.enabled, saving: false };
    case "loadFailed":
      return { status: "error" };
    case "retry":
      return state.status === "error" ? { status: "loading" } : state;
    case "toggle":
      if (state.status !== "ready" || state.saving) return state;
      return { ...state, shown: event.next, saving: true };
    case "saved":
      if (state.status !== "ready") return state;
      return { status: "ready", confirmed: event.enabled, shown: event.enabled, saving: false };
    case "saveFailed":
      if (state.status !== "ready") return state;
      return { ...state, shown: state.confirmed, saving: false };
  }
}
