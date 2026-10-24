/** Message d'erreur lisible extrait d'une réponse d'API non réussie. */
export async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    /* corps absent ou illisible */
  }
  return "Une erreur est survenue. Réessayez.";
}
