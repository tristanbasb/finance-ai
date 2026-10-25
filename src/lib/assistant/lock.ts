// Verrou de génération en mémoire : une seule réponse de Claude à la fois, dans l'ordre d'arrivée.

let tail: Promise<void> = Promise.resolve();

/**
 * Exécute `fn` quand les générations précédentes sont terminées (file FIFO). L'échec d'une
 * génération est propagé à son appelant mais ne bloque pas les suivantes.
 */
export function withGenerationLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(() => fn());
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
