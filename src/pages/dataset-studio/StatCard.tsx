import { motion } from "framer-motion";
import { fadeUpVariant } from "./constants";

interface StatCardProps {
  label: string;
  value: string | number;
  accent?: string;
  icon?: React.ReactNode;
}

export function StatCard({ label, value, accent, icon }: StatCardProps) {
  return (
    <motion.div
      {...fadeUpVariant}
      className={`relative overflow-hidden rounded-xl border border-border/50 p-4 text-center transition-all duration-200 hover:border-border ${accent ? `bg-gradient-to-br ${accent}` : "bg-muted/30"}`}
    >
      {icon && (
        <div className="mx-auto mb-1.5 flex h-8 w-8 items-center justify-center rounded-lg bg-background/60">
          {icon}
        </div>
      )}
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-xl font-bold tracking-tight">{String(value)}</p>
    </motion.div>
  );
}
