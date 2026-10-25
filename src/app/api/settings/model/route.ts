import { z } from "zod";
import { getAi } from "@/lib/ai/client";
import { listModels } from "@/lib/ai/models";
import { readJson, withErrors } from "@/lib/api";
import { getDb } from "@/lib/db";
import { setModelSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

const body = z.object({ model: z.string().min(1).max(200) });

/** `{ model }` → 200 `{ model }` si le modèle figure dans la liste proposée, sinon 400. */
export const PUT = withErrors(async (req: Request) => {
  const { model } = body.parse(await readJson(req));
  const models = await listModels(getAi());
  if (!models.some((m) => m.id === model)) {
    return Response.json({ error: "Modèle inconnu" }, { status: 400 });
  }
  setModelSetting(getDb(), model);
  return Response.json({ model });
});
