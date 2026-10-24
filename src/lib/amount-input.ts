/** Centimes signés → texte de champ de saisie (« -123456 » → « -1234,56 »), relisible par `parseAmount`. */
export function centsToInput(cents: number): string {
  const abs = Math.abs(cents);
  const text = `${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
  return cents < 0 ? `-${text}` : text;
}
