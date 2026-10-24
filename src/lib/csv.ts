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

/** Nombre d'enregistrements examinés pour détecter le délimiteur et la ligne d'en-tête. */
const SCAN_RECORDS = 20;

/**
 * Découpe `src` en enregistrements avec `delimiter` : guillemets (doublés = guillemet littéral,
 * délimiteurs et sauts de ligne autorisés à l'intérieur), lignes vides ignorées. `lines[i]` est
 * la ligne du fichier (1 = première) où commence `records[i]`. S'arrête après `max` enregistrements.
 */
function splitRecords(
  src: string,
  delimiter: Delimiter,
  max = Infinity,
): { records: string[][]; lines: number[] } {
  const records: string[][] = [];
  const lines: number[] = [];
  let record: string[] = [];
  let line = 1; // ligne physique courante
  let recordStart = 1; // ligne où commence l'enregistrement en cours
  let field = "";
  let inQuotes = false;
  let quoted = false; // le champ courant a été ouvert par un guillemet

  const endField = () => {
    record.push(field.trim());
    field = "";
    quoted = false;
  };
  const endRecord = () => {
    endField();
    if (record.some((f) => f !== "")) {
      records.push(record);
      lines.push(recordStart);
    }
    record = [];
  };

  for (let i = 0; i < src.length && records.length < max; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === "\n" || (ch === "\r" && src[i + 1] !== "\n")) line++;
      if (ch !== '"') field += ch;
      else if (src[i + 1] === '"') {
        field += '"';
        i++;
      } else inQuotes = false;
    } else if (ch === '"' && !quoted && field.trim() === "") {
      // Le mode guillemets ne commence qu'en début de champ ; ailleurs, " est un caractère littéral.
      inQuotes = true;
      quoted = true;
    } else if (ch === delimiter) {
      endField();
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      endRecord();
      line++;
      recordStart = line;
    } else {
      field += ch;
    }
  }
  if (records.length < max && (field !== "" || record.length > 0)) endRecord();
  return { records, lines };
}

/** Nombre de champs d'un enregistrement, sans les champs vides finaux (« a;b;c; » → 3). */
function fieldCount(record: string[]): number {
  let n = record.length;
  while (n > 0 && record[n - 1] === "") n--;
  return n;
}

/** Vrai si `guessMapping` reconnaît date, libellé et montant (ou débit/crédit). */
function isRecognizedHeader(record: string[]): boolean {
  const m = guessMapping(record);
  return (
    m.date !== undefined &&
    m.label !== undefined &&
    (m.amount !== undefined || m.debit !== undefined || m.credit !== undefined)
  );
}

/** Nombre de champs le plus fréquent (> 1) et son nombre d'occurrences ; [0, 0] si aucun. */
function modalFieldCount(records: string[][]): [count: number, occurrences: number] {
  const frequency = new Map<number, number>();
  for (const r of records) {
    const n = fieldCount(r);
    if (n > 1) frequency.set(n, (frequency.get(n) ?? 0) + 1);
  }
  let best: [number, number] = [0, 0];
  for (const [n, occ] of frequency) {
    if (occ > best[1] || (occ === best[1] && n > best[0])) best = [n, occ];
  }
  return best;
}

/**
 * Délimiteur choisi par cohérence sur les 20 premiers enregistrements : celui (ou parmi ceux)
 * pour lequel un en-tête est reconnu ; puis celui dont le nombre de champs le plus fréquent
 * revient sur le plus de lignes (puis le plus grand) ; égalité → « ; ». Une virgule dans un
 * libellé ou une virgule décimale ne l'emporte donc pas sur « ; ».
 */
function detectDelimiter(src: string): Delimiter {
  const candidates = DELIMITERS.map((delimiter) => ({
    delimiter,
    records: splitRecords(src, delimiter, SCAN_RECORDS).records,
  }));
  const withHeader = candidates.filter((c) => c.records.some(isRecognizedHeader));
  const pool = withHeader.length > 0 ? withHeader : candidates;
  let best = pool[0];
  let bestScore = modalFieldCount(best.records);
  for (const c of pool.slice(1)) {
    const score = modalFieldCount(c.records);
    if (score[1] > bestScore[1] || (score[1] === bestScore[1] && score[0] > bestScore[0])) {
      best = c;
      bestScore = score;
    }
  }
  return best.delimiter;
}

/**
 * Indice de la ligne d'en-tête : la première (parmi les 20 premières) où `guessMapping` trouve
 * date, libellé et montant (ou débit/crédit) ; à défaut, la première ligne ayant le nombre de
 * champs le plus fréquent (champs vides finaux ignorés). Les exports bancaires commencent
 * souvent par un préambule (« Téléchargement du … », « Compte n° … », « Solde au … ») à ignorer.
 */
function findHeaderIndex(records: string[][]): number {
  const recognized = records.slice(0, SCAN_RECORDS).findIndex(isRecognizedHeader);
  if (recognized >= 0) return recognized;
  const [common] = modalFieldCount(records);
  return Math.max(0, records.findIndex((r) => fieldCount(r) === common));
}

/**
 * Parse un CSV : BOM retiré, délimiteur détecté (voir `detectDelimiter`), guillemets (doublés =
 * guillemet littéral, délimiteurs et sauts de ligne autorisés à l'intérieur), lignes vides ignorées.
 * La ligne d'en-tête est détectée (voir `findHeaderIndex`) : les lignes au-dessus sont ignorées.
 * `lines[i]` est le numéro de ligne dans le fichier (1 = première) où commence `rows[i]`.
 */
export function parseCsv(text: string): {
  headers: string[];
  rows: string[][];
  lines: number[];
  delimiter: Delimiter;
} {
  const src = text.startsWith("﻿") ? text.slice(1) : text;
  const delimiter = detectDelimiter(src);
  const { records, lines } = splitRecords(src, delimiter);
  if (records.length === 0) return { headers: [], rows: [], lines: [], delimiter };
  const headerIndex = findHeaderIndex(records);
  return {
    headers: records[headerIndex],
    rows: records.slice(headerIndex + 1),
    lines: lines.slice(headerIndex + 1),
    delimiter,
  };
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

/**
 * Décode les octets d'un fichier CSV : UTF-8 d'abord ; si le texte contient des caractères
 * de remplacement (U+FFFD), relit en windows-1252 (nombreuses banques françaises exportent en Latin-1).
 */
export function decodeCsvBytes(bytes: ArrayBuffer | Uint8Array): string {
  const utf8 = new TextDecoder("utf-8").decode(bytes);
  return utf8.includes(String.fromCharCode(0xfffd)) ? new TextDecoder("windows-1252").decode(bytes) : utf8;
}

/** Devine le mappage des colonnes à partir des en-têtes (1re colonne correspondante gagne). */
export function guessMapping(headers: string[]): Partial<CsvMapping> {
  const normalized = headers.map(normalize);
  const result: Partial<CsvMapping> = {};
  const used = new Set<number>();
  // Débit/crédit d'abord : « Montant débit » ne doit pas être pris pour la colonne montant,
  // et une colonne montant n'est cherchée que si ni débit ni crédit n'existent.
  for (const key of ["date", "label", "debit", "credit"] as const) {
    const idx = normalized.findIndex(
      (h, i) => !used.has(i) && KEYWORDS[key].some((kw) => h.includes(kw)),
    );
    if (idx >= 0) {
      result[key] = idx;
      used.add(idx);
    }
  }
  if (result.debit === undefined && result.credit === undefined) {
    const idx = normalized.findIndex(
      (h, i) => !used.has(i) && KEYWORDS.amount.some((kw) => h.includes(kw)),
    );
    if (idx >= 0) result.amount = idx;
  }
  return result;
}

/** Montant de la ligne : colonne unique signée, ou débit (négatif) / crédit (positif). */
function rowAmount(row: string[], m: CsvMapping): number | "missing" | "invalid" {
  // Une cellule réduite à un tiret (« - », « – ») signifie « vide » dans beaucoup d'exports.
  const cell = (i: number | undefined) => {
    const v = i === undefined ? "" : (row[i] ?? "").trim();
    return /^[-–—]$/.test(v) ? "" : v;
  };
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
 * Numéros de ligne : `lines[i]` (ligne dans le fichier, fournie par `parseCsv`), sinon
 * en-tête = ligne 1 et 1re donnée = ligne 2.
 */
export function mapRows(
  rows: string[][],
  m: CsvMapping,
  lines?: number[],
): { valid: ParsedTx[]; errors: { line: number; reason: string }[] } {
  const valid: ParsedTx[] = [];
  const errors: { line: number; reason: string }[] = [];
  rows.forEach((row, index) => {
    const line = lines?.[index] ?? index + 2;
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
