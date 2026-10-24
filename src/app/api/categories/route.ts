import { getDb } from "@/lib/db";
import { readJson, withErrors } from "@/lib/api";
import { createCategory, listCategories } from "@/lib/queries/categories";
import { categoryInput } from "@/lib/validation";

export const dynamic = "force-dynamic";

export const GET = withErrors(async () => Response.json(listCategories(getDb())));

export const POST = withErrors(async (req: Request) => {
  const input = categoryInput.parse(await readJson(req));
  return Response.json(createCategory(getDb(), input), { status: 201 });
});
