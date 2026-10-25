// Verrou de génération en mémoire : une seule réponse de Claude à la fois, dans l'ordre d'arrivée.
// L'état est porté par `globalThis` : Next.js peut charger ce module en plusieurs exemplaires
// (bundle d'instrumentation pour le bot, bundles des routes), qui doivent partager la même file.

type LockState = { tail: Promise<void> };

const g = globalThis as typeof globalThis & { __financeAiGenLock?: LockState };
const state: LockState = (g.__financeAiGenLock ??= { tail: Promise.resolve() });

/**
 * Exécute `fn` quand les générations précédentes sont terminées (file FIFO). L'échec d'une
 * génération est propagé à son appelant mais ne bloque pas les suivantes.
 */
export function withGenerationLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = state.tail.then(() => fn());
  state.tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
