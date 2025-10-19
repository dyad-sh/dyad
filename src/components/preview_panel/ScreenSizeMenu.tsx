import { ChevronDown, RotateCw, Settings } from "lucide-react";
import { useState, useEffect } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { IpcClient } from "@/ipc/ipc_client";
import { DevicePreset } from "@/ipc/ipc_client";
import { showError } from "@/lib/toast";
import { DevicePresetsDialog } from "./DevicePresetsDialog";

interface ScreenSizeMenuProps {
  screenWidth: string;
  screenHeight: string;
  selectedDevice: string;
  onDeviceSelect: (name: string, width: number, height: number) => void;
  onWidthChange: (value: string) => void;
  onHeightChange: (value: string) => void;
  onRotate: () => void;
  getDisplayWidth: () => string;
  getDisplayHeight: () => string;
}

export const ScreenSizeMenu = ({
  screenWidth,
  screenHeight,
  selectedDevice,
  onDeviceSelect,
  onWidthChange,
  onHeightChange,
  onRotate,
  getDisplayWidth,
  getDisplayHeight,
}: ScreenSizeMenuProps) => {
  const [devicePresets, setDevicePresets] = useState<DevicePreset[]>([]);
  const [loading, setLoading] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  // Load device presets from database
  useEffect(() => {
    loadDevicePresets();
  }, []);

  const loadDevicePresets = async () => {
    setLoading(true);
    try {
      const presets = await IpcClient.getInstance().getDevicePresets();
      setDevicePresets(presets);
    } catch (error) {
      showError("Failed to load device presets");
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handlePresetsChanged = () => {
    loadDevicePresets();
  };

  return (
    <div className="flex items-center p-2 border-b space-x-2 bg-gray-50 dark:bg-gray-900 flex justify-center">
      {/* Device Presets Dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <div className="flex items-center justify-between px-3 py-1 bg-gray-100 dark:bg-gray-700 rounded text-sm text-gray-700 dark:text-gray-200 cursor-pointer min-w-[180px]">
            <span className="truncate flex-1 mr-2">
              {loading ? "Loading..." : selectedDevice}
            </span>
            <ChevronDown size={14} className="flex-shrink-0" />
          </div>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="max-h-[300px] overflow-y-auto">
          {devicePresets.map((device) => (
            <DropdownMenuItem
              key={device.id}
              onClick={() =>
                onDeviceSelect(device.name, device.width, device.height)
              }
              className="flex justify-between"
            >
              <span>{device.name}</span>
              <span className="text-gray-500 dark:text-gray-400 text-xs ml-2">
                {device.width}×{device.height}
              </span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setIsDialogOpen(true)}
            className="flex items-center gap-2 text-blue-600 dark:text-blue-400"
          >
            <Settings size={14} />
            <span>Manage Presets...</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Width Input */}
      <div className="flex items-center space-x-1">
        <label className="text-xs text-gray-600 dark:text-gray-400">W:</label>
        <div className="relative flex items-center">
          <input
            type="text"
            value={getDisplayWidth()}
            onChange={(e) => onWidthChange(e.target.value)}
            className="px-2 py-1 pr-7 bg-gray-100 dark:bg-gray-700 rounded text-sm text-gray-700 dark:text-gray-200 w-20 border-none focus:ring-1 focus:ring-gray-300 dark:focus:ring-gray-600"
            placeholder="Width"
          />
          {!screenWidth.includes("%") && (
            <span className="absolute right-2 text-xs text-gray-500 dark:text-gray-400 pointer-events-none">
              px
            </span>
          )}
        </div>
      </div>

      {/* Height Input */}
      <div className="flex items-center space-x-1">
        <label className="text-xs text-gray-600 dark:text-gray-400">H:</label>
        <div className="relative flex items-center">
          <input
            type="text"
            value={getDisplayHeight()}
            onChange={(e) => onHeightChange(e.target.value)}
            className="px-2 py-1 pr-7 bg-gray-100 dark:bg-gray-700 rounded text-sm text-gray-700 dark:text-gray-200 w-20 border-none focus:ring-1 focus:ring-gray-300 dark:focus:ring-gray-600"
            placeholder="Height"
          />
          {!screenHeight.includes("%") && (
            <span className="absolute right-2 text-xs text-gray-500 dark:text-gray-400 pointer-events-none">
              px
            </span>
          )}
        </div>
      </div>

      {/* Rotate Button */}
      <button
        onClick={onRotate}
        className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 dark:text-gray-300"
        title="Rotate"
      >
        <RotateCw size={16} />
      </button>

      {/* Device Presets Dialog */}
      <DevicePresetsDialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        onPresetsChanged={handlePresetsChanged}
      />
    </div>
  );
};
