// Montants (entiers en centimes, signés) et dates (YYYY-MM-DD).
// Module pur, sans dépendance : utilisable côté client comme côté serveur.

const eurFormatter = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });

/** Formate des centimes en euros à la française (ex. « 1 234,56 € »). */
export function formatEUR(cents: number): string {
  return eurFormatter.format(cents / 100);
}

export function toCents(euros: number): number {
  return Math.round(euros * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}

type DecimalParts = { negative: boolean; intPart: string; fracPart: string };

/**
 * Découpe un nombre saisi à la française ou à l'anglaise en signe, partie entière et décimales
 * (chaînes de chiffres), ou null s'il est illisible.
 *
 * Séparateur décimal : si « , » et « . » apparaissent, le DERNIER est le décimal ;
 * une « , » seule est décimale (FR) ; un « . » seul est décimal sauf s'il y a
 * plusieurs groupes (« 1.234.567 » = milliers).
 * Espaces, espaces insécables, « € » et « EUR » sont ignorés ; signe « + »/« - »
 * en tête ou « - »/« + » en fin.
 */
function parseDecimalParts(raw: string): DecimalParts | null {
  let s = raw.replace(/[\s  ]/g, "").replace(/€|EUR/gi, "");
  let negative = false;
  const lead = /^[+-]/.exec(s);
  if (lead) {
    negative = lead[0] === "-";
    s = s.slice(1);
  } else {
    const trail = /[+-]$/.exec(s);
    if (trail) {
      negative = trail[0] === "-";
      s = s.slice(0, -1);
    }
  }
  if (!/^[\d.,]*\d[\d.,]*$/.test(s)) return null;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  const count = (ch: string) => s.split(ch).length - 1;

  let decimalSep: "," | "." | null;
  let thousandsSep: "," | "." | null;
  if (lastComma >= 0 && lastDot >= 0) {
    decimalSep = lastComma > lastDot ? "," : ".";
    thousandsSep = decimalSep === "," ? "." : ",";
  } else if (lastComma >= 0) {
    [decimalSep, thousandsSep] = count(",") === 1 ? [",", null] : [null, ","];
  } else if (lastDot >= 0) {
    [decimalSep, thousandsSep] = count(".") === 1 ? [".", null] : [null, "."];
  } else {
    decimalSep = null;
    thousandsSep = null;
  }

  let intPart = s;
  let fracPart = "";
  if (decimalSep) {
    if (count(decimalSep) !== 1) return null;
    const i = s.indexOf(decimalSep);
    intPart = s.slice(0, i);
    fracPart = s.slice(i + 1);
  }
  if (thousandsSep) {
    const groups = intPart.split(thousandsSep);
    const wellFormed =
      /^\d{1,3}$/.test(groups[0]) && groups.slice(1).every((g) => /^\d{3}$/.test(g));
    if (!wellFormed) return null;
    intPart = groups.join("");
  }
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart)) return null;
  return { negative, intPart, fracPart };
}

/** Convertit un texte de montant en centimes entiers (arrondi au centime), ou null s'il est illisible. */
export function parseAmount(raw: string): number | null {
  const parts = parseDecimalParts(raw);
  if (!parts) return null;
  const { negative, intPart, fracPart } = parts;
  // Arrondi demi-supérieur sur la chaîne décimale (évite les erreurs de flottants).
  const frac = fracPart.padEnd(3, "0");
  let cents = Number(intPart || "0") * 100 + Number(frac.slice(0, 2));
  if (frac.charCodeAt(2) >= 53 /* '5' */) cents += 1;
  return negative ? -cents : cents;
}

/**
 * Convertit un prix unitaire saisi en euros en centimes RÉELS, sans arrondir au centime
 * (crypto : « 0,00001 » → 0.001). Null si illisible ou négatif.
 */
export function parseUnitPrice(raw: string): number | null {
  const parts = parseDecimalParts(raw);
  if (!parts || (parts.negative && /[1-9]/.test(parts.intPart + parts.fracPart))) return null;
  const frac = parts.fracPart.padEnd(2, "0");
  // Décalage de deux rangs fait sur la chaîne : « 0,00001 » → « 000.001 » sans erreur de flottant.
  return Number(`${parts.intPart || "0"}${frac.slice(0, 2)}.${frac.slice(2) || "0"}`);
}

/** Convertit une quantité saisie (« 0,0523 ») en nombre, ou null si illisible ou négative. */
export function parseQuantity(raw: string): number | null {
  const parts = parseDecimalParts(raw);
  if (!parts || (parts.negative && /[1-9]/.test(parts.intPart + parts.fracPart))) return null;
  return Number(`${parts.intPart || "0"}.${parts.fracPart || "0"}`);
}

const unitPriceFormatter = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
});

/** Prix unitaire en centimes réels : jusqu'à 6 décimales sous 1 €, 2 décimales sinon. */
export function formatUnitPrice(cents: number): string {
  return Math.abs(cents) < 100 ? unitPriceFormatter.format(cents / 100) : formatEUR(cents);
}

function isoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1) return null;
  if (day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null;
  const p = (n: number, w: number) => String(n).padStart(w, "0");
  return `${p(year, 4)}-${p(month, 2)}-${p(day, 2)}`;
}

/**
 * Convertit une date en YYYY-MM-DD, ou null si elle est illisible ou inexistante.
 * Formats : DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, YYYY-MM-DD, DD/MM/YY (YY → 20YY).
 */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (iso) return isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const fr = /^(\d{1,2})([/.-])(\d{1,2})\2(\d{4}|\d{2})$/.exec(s);
  if (!fr) return null;
  const year = fr[4].length === 2 ? 2000 + Number(fr[4]) : Number(fr[4]);
  return isoDate(year, Number(fr[3]), Number(fr[1]));
}
