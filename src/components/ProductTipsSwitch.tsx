import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/useSettings";

export function ProductTipsSwitch() {
  const { settings, updateSettings } = useSettings();
  const disabled = settings?.disableProductTips === true;

  return (
    <div className="flex items-center space-x-2">
      <Switch
        id="product-tips"
        checked={disabled}
        onCheckedChange={(checked) => {
          void updateSettings({ disableProductTips: checked });
        }}
      />
      <Label htmlFor="product-tips">Do not show any product tips</Label>
    </div>
  );
}
