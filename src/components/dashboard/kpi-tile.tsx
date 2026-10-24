import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";

export type KpiTileProps = {
  label: string;
  value: ReactNode;
  caption?: ReactNode;
  icon?: LucideIcon;
  className?: string;
};

/** Indicateur : libellé, valeur, précision. */
export function KpiTile({ label, value, caption, icon: Icon, className }: KpiTileProps) {
  return (
    <Card className={cn("flex flex-col justify-between gap-3 p-4 sm:p-5", className)}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[13px] font-medium text-muted">{label}</h2>
        {Icon && <Icon aria-hidden className="hidden size-4 shrink-0 text-subtle lg:block" />}
      </div>
      <div className="space-y-1">
        <p className="num text-xl font-semibold tracking-[-0.02em] text-fg lg:text-2xl">{value}</p>
        {caption && <p className="text-[12px] text-muted">{caption}</p>}
      </div>
    </Card>
  );
}
