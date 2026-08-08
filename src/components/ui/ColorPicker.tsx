import { Input } from "@/components/ui/input";

interface ColorPickerProps {
  id: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function ColorPicker({
  id,
  value,
  onChange,
  className = "",
}: ColorPickerProps) {
  return (
    <div className={`flex gap-2 ${className}`}>
      <Input
        id={id}
        type="color"
        className="h-8 w-12 p-1 cursor-pointer"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <Input
        type="text"
        placeholder="#000000"
        className="h-8 text-xs flex-1"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
