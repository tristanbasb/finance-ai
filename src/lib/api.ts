import { ZodError } from "zod";

/** Opération refusée car l'état des données l'interdit (HTTP 409). */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

/** Ressource inexistante (HTTP 404). */
export class NotFoundError extends Error {
  constructor(message = "Introuvable") {
    super(message);
    this.name = "NotFoundError";
  }
}

/** Requête mal formée hors validation zod (HTTP 400). */
export class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadRequestError";
  }
}

function isForeignKeyError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err as { code?: unknown }).code === "SQLITE_CONSTRAINT_FOREIGNKEY"
  );
}

/** Convertit une erreur en réponse JSON ; toute erreur inattendue est journalisée côté serveur. */
export function errorResponse(err: unknown): Response {
  if (err instanceof ZodError) {
    return Response.json({ error: "Données invalides", issues: err.issues }, { status: 400 });
  }
  if (err instanceof BadRequestError) {
    return Response.json({ error: err.message }, { status: 400 });
  }
  if (err instanceof NotFoundError) {
    return Response.json({ error: "Introuvable" }, { status: 404 });
  }
  if (err instanceof ConflictError) {
    return Response.json({ error: err.message }, { status: 409 });
  }
  if (isForeignKeyError(err)) {
    return Response.json({ error: "Référence invalide ou données liées." }, { status: 409 });
  }
  console.error("[api] erreur interne :", err);
  return Response.json({ error: "Erreur interne" }, { status: 500 });
}

/** Enveloppe un gestionnaire de route : les erreurs levées deviennent des réponses JSON. */
export function withErrors<A extends unknown[]>(
  handler: (...args: A) => Promise<Response> | Response,
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      return await handler(...args);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

/** Lit le corps JSON d'une requête (400 s'il est absent ou invalide). */
export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new BadRequestError("Corps JSON invalide");
  }
}

/** Valide le paramètre dynamique `id` (entier strictement positif). */
export async function parseId(params: Promise<{ id: string }>): Promise<number> {
  const { id } = await params;
  const n = /^[1-9]\d*$/.test(id) ? Number(id) : NaN;
  if (!Number.isSafeInteger(n)) throw new BadRequestError("Identifiant invalide");
  return n;
}
