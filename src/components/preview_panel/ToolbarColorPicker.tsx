interface ToolbarColorPickerProps {
  color: string;
  onChange: (color: string) => void;
}

export const ToolbarColorPicker = ({
  color,
  onChange,
}: ToolbarColorPickerProps) => {
  return (
    <label
      className="h-[16px] w-[16px] rounded-sm cursor-pointer transition-all overflow-hidden block self-center"
      style={{ backgroundColor: color }}
      title="Choose color"
    >
      <input
        type="color"
        value={color}
        onChange={(e) => onChange(e.target.value)}
        className="opacity-0 w-full h-full"
        aria-label="Choose color"
      />
    </label>
  );
};
