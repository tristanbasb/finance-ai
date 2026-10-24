// Lecture des CSV bancaires et mappage des colonnes vers des transactions.
// Module pur, sans dépendance : utilisé dans le navigateur (assistant d'import).

import { parseAmount, parseDate } from "./money";

export type Delimiter = ";" | "," | "\t";

export type CsvMapping = {
  date: number;
  label: number;
  amount?: number;
  debit?: number;
  credit?: number;
};

export type ParsedTx = { date: string; label: string; amount: number };

const DELIMITERS: Delimiter[] = [";", ",", "\t"];

/** Délimiteur le plus fréquent hors guillemets sur la première ligne (« ; » par défaut). */
function detectDelimiter(text: string): Delimiter {
  const counts = new Map<Delimiter, number>(DELIMITERS.map((d) => [d, 0]));
  let inQuotes = false;
  for (const ch of text) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === "\n" || ch === "\r")) break;
    else if (!inQuotes && counts.has(ch as Delimiter)) {
      counts.set(ch as Delimiter, counts.get(ch as Delimiter)! + 1);
    }
  }
  let best: Delimiter = ";";
  let bestCount = 0;
  for (const d of DELIMITERS) {
    if (counts.get(d)! > bestCount) {
      best = d;
      bestCount = counts.get(d)!;
    }
  }
  return best;
}

/**
 * Parse un CSV : BOM retiré, délimiteur détecté, guillemets (doublés = guillemet littéral,
 * délimiteurs et sauts de ligne autorisés à l'intérieur), lignes vides ignorées.
 * La première ligne non vide donne `headers`.
 */
export function parseCsv(text: string): { headers: string[]; rows: string[][]; delimiter: Delimiter } {
  const src = text.startsWith("﻿") ? text.slice(1) : text;
  const delimiter = detectDelimiter(src);

  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;

  const endField = () => {
    record.push(field.trim());
    field = "";
  };
  const endRecord = () => {
    endField();
    if (record.some((f) => f !== "")) records.push(record);
    record = [];
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch !== '"') field += ch;
      else if (src[i + 1] === '"') {
        field += '"';
        i++;
      } else inQuotes = false;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      endField();
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      endRecord();
    } else {
      field += ch;
    }
  }
  if (field !== "" || record.length > 0) endRecord();

  const [headers = [], ...rows] = records;
  return { headers, rows, delimiter };
}

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

const KEYWORDS: Record<keyof CsvMapping, string[]> = {
  date: ["date"],
  label: ["libelle", "label", "description", "intitule"],
  amount: ["montant", "amount"],
  debit: ["debit"],
  credit: ["credit"],
};

/** Devine le mappage des colonnes à partir des en-têtes (1re colonne correspondante gagne). */
export function guessMapping(headers: string[]): Partial<CsvMapping> {
  const normalized = headers.map(normalize);
  const result: Partial<CsvMapping> = {};
  const used = new Set<number>();
  for (const key of Object.keys(KEYWORDS) as (keyof CsvMapping)[]) {
    const idx = normalized.findIndex(
      (h, i) => !used.has(i) && KEYWORDS[key].some((kw) => h.includes(kw)),
    );
    if (idx >= 0) {
      result[key] = idx;
      used.add(idx);
    }
  }
  return result;
}

/** Montant de la ligne : colonne unique signée, ou débit (négatif) / crédit (positif). */
function rowAmount(row: string[], m: CsvMapping): number | "missing" | "invalid" {
  const cell = (i: number | undefined) => (i === undefined ? "" : (row[i] ?? "").trim());
  if (m.amount !== undefined) {
    const raw = cell(m.amount);
    if (raw === "") return "missing";
    return parseAmount(raw) ?? "invalid";
  }
  const debitRaw = cell(m.debit);
  const creditRaw = cell(m.credit);
  if (debitRaw === "" && creditRaw === "") return "missing";
  const debit = debitRaw === "" ? 0 : parseAmount(debitRaw);
  const credit = creditRaw === "" ? 0 : parseAmount(creditRaw);
  if (debit === null || credit === null) return "invalid";
  return Math.abs(credit) - Math.abs(debit);
}

/**
 * Convertit les lignes de données en transactions valides, et liste les erreurs.
 * Numéros de ligne comme affichés à l'utilisateur : en-tête = ligne 1, 1re donnée = ligne 2.
 */
export function mapRows(
  rows: string[][],
  m: CsvMapping,
): { valid: ParsedTx[]; errors: { line: number; reason: string }[] } {
  const valid: ParsedTx[] = [];
  const errors: { line: number; reason: string }[] = [];
  rows.forEach((row, index) => {
    const line = index + 2;
    const date = parseDate(row[m.date] ?? "");
    if (date === null) return void errors.push({ line, reason: "Date invalide" });
    const label = (row[m.label] ?? "").trim();
    if (label === "") return void errors.push({ line, reason: "Libellé vide" });
    const amount = rowAmount(row, m);
    if (amount === "missing") return void errors.push({ line, reason: "Montant manquant" });
    if (amount === "invalid") return void errors.push({ line, reason: "Montant invalide" });
    valid.push({ date, label, amount });
  });
  return { valid, errors };
}
