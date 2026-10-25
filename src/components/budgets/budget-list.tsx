import { sortBudgetRows, type BudgetRowData } from "@/lib/budget-month";
import { BudgetRow } from "./budget-row";

/** Catégories de dépense : dépassées d'abord, puis les plus consommées, puis celles sans budget. */
export function BudgetList({ rows }: { rows: BudgetRowData[] }) {
  return (
    <ul className="divide-y divide-border">
      {sortBudgetRows(rows).map((row) => (
        <BudgetRow key={row.id} row={row} />
      ))}
    </ul>
  );
}
