/** Délai dépassé (le service distant ne répond pas). */
export class TimeoutError extends Error {
  name = "TimeoutError";
}

/**
 * Exécute `task` avec un délai maximal : le signal transmis est annulé au bout de `ms`, et la
 * promesse rejette à ce moment même si la tâche ignore le signal.
 */
export async function withTimeout<T>(
  task: (signal: AbortSignal) => Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new TimeoutError(`${label} : pas de réponse après ${ms / 1000} s`);
      controller.abort(err);
      reject(err);
    }, ms);
  });
  try {
    return await Promise.race([task(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
