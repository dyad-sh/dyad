import { useTranslation } from "react-i18next";

interface ToolbarColorPickerProps {
  color: string;
  onChange: (color: string) => void;
}

export const ToolbarColorPicker = ({
  color,
  onChange,
}: ToolbarColorPickerProps) => {
  const { t } = useTranslation("home");
  return (
    <label
      className="h-[16px] w-[16px] rounded-sm cursor-pointer transition-all overflow-hidden block self-center"
      style={{ backgroundColor: color }}
      title={t("preview.visualEditing.chooseColor")}
    >
      <input
        type="color"
        value={color}
        onChange={(e) => onChange(e.target.value)}
        className="opacity-0 w-full h-full"
        aria-label={t("preview.visualEditing.chooseColor")}
      />
    </label>
  );
};
