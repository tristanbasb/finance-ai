import { getDb } from "@/lib/db";
import { parseId, readJson, withErrors } from "@/lib/api";
import { deleteCategory, updateCategory } from "@/lib/queries/categories";
import { categoryInput } from "@/lib/validation";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withErrors(async (req: Request, { params }: Ctx) => {
  const id = await parseId(params);
  const patch = categoryInput.partial().parse(await readJson(req));
  return Response.json(updateCategory(getDb(), id, patch));
});

export const DELETE = withErrors(async (_req: Request, { params }: Ctx) => {
  deleteCategory(getDb(), await parseId(params));
  return new Response(null, { status: 204 });
});
