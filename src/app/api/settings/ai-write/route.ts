import { z } from "zod";
import { readJson, withErrors } from "@/lib/api";
import { getDb } from "@/lib/db";
import { aiCanWrite, setAiCanWrite } from "@/lib/settings";

export const dynamic = "force-dynamic";

const body = z.object({ enabled: z.boolean() });

/** « Autoriser Claude à modifier mes données » : `{ enabled }` (vrai par défaut). */
export const GET = withErrors(async () => Response.json({ enabled: aiCanWrite(getDb()) }));

/** `{ enabled: boolean }` → 200 `{ enabled }` ; 400 sinon. */
export const PUT = withErrors(async (req: Request) => {
  const { enabled } = body.parse(await readJson(req));
  setAiCanWrite(getDb(), enabled);
  return Response.json({ enabled });
});
