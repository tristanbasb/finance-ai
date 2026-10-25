// Noms des outils d'écriture de Claude. Module pur (sans base ni serveur), utilisable côté
// client : l'indicateur d'outil affiche « Modification de vos données… » pour ces noms.
// Les définitions sont dans `write-tools.ts` (un test vérifie que les deux listes concordent).

export const WRITE_TOOL_NAME_LIST = [
  "add_transaction",
  "update_transaction",
  "delete_transaction",
  "recategorize_transactions",
  "set_budget",
  "create_category",
  "rename_category",
  "create_goal",
  "update_goal",
  "delete_goal",
  "create_account",
  "rename_account",
  "archive_account",
  "add_holding",
  "update_holding",
  "delete_holding",
] as const;

export type WriteToolName = (typeof WRITE_TOOL_NAME_LIST)[number];

const NAMES: ReadonlySet<string> = new Set(WRITE_TOOL_NAME_LIST);

export function isWriteTool(name: string): name is WriteToolName {
  return NAMES.has(name);
}
