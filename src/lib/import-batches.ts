// Envoi d'un import par lots, avec reprise après un échec partiel. Module pur.

/**
 * Envoie `rows` par lots de `size` à partir du décalage `start`, en séquence, et s'arrête au
 * premier échec. `imported` est le décalage ABSOLU atteint (nombre de lignes déjà enregistrées,
 * `start` inclus) : en cas d'échec, relancer avec `start = imported` n'envoie que le reste,
 * sans jamais renvoyer un lot déjà enregistré.
 */
export async function importInBatches<T>(
  rows: readonly T[],
  size: number,
  send: (chunk: T[]) => Promise<void>,
  start = 0,
): Promise<{ imported: number; error?: unknown }> {
  let imported = start;
  while (imported < rows.length) {
    const chunk = rows.slice(imported, imported + size);
    try {
      await send(chunk);
    } catch (error) {
      return { imported, error };
    }
    imported += chunk.length;
  }
  return { imported };
}
