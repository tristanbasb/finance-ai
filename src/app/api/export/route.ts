import { getDb } from "@/lib/db";
import { withErrors } from "@/lib/api";
import { exportAll } from "@/lib/queries/export";

export const dynamic = "force-dynamic";

export const GET = withErrors(async () => {
  const today = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(exportAll(getDb()), null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="finance-ai-export-${today}.json"`,
    },
  });
});
