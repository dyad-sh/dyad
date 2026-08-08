import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface NumberInputProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  step?: string;
  min?: string;
  className?: string;
}

export function NumberInput({
  id,
  label,
  value,
  onChange,
  placeholder = "0",
  step = "1",
  min = "0",
  className = "",
}: NumberInputProps) {
  return (
    <div className={className}>
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        placeholder={placeholder}
        className="mt-1 h-8 text-xs"
        value={value.replace(/[^\d.-]/g, "") || ""}
        onChange={(e) => onChange(e.target.value)}
        step={step}
        min={min}
      />
    </div>
  );
}
