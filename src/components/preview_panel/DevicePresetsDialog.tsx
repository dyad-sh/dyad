import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IpcClient } from "@/ipc/ipc_client";
import { DevicePreset } from "@/ipc/ipc_client";
import { showError, showSuccess } from "@/lib/toast";
import { Pencil, Trash2, Plus } from "lucide-react";

interface DevicePresetsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onPresetsChanged: () => void;
}

export const DevicePresetsDialog = ({
  isOpen,
  onClose,
  onPresetsChanged,
}: DevicePresetsDialogProps) => {
  const [presets, setPresets] = useState<DevicePreset[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");

  // Load presets when dialog opens
  useEffect(() => {
    if (isOpen) {
      loadPresets();
    }
  }, [isOpen]);

  const loadPresets = async () => {
    setLoading(true);
    try {
      const data = await IpcClient.getInstance().getDevicePresets();
      setPresets(data);
    } catch (error) {
      showError("Failed to load device presets");
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setName("");
    setWidth("");
    setHeight("");
    setEditingId(null);
    setIsAdding(false);
  };

  const handleAdd = () => {
    setIsAdding(true);
    resetForm();
    setIsAdding(true);
  };

  const handleEdit = (preset: DevicePreset) => {
    setEditingId(preset.id);
    setName(preset.name);
    setWidth(preset.width.toString());
    setHeight(preset.height.toString());
    setIsAdding(false);

    // Scroll to top to show the edit form
    setTimeout(() => {
      const dialogContent = document.querySelector('[role="dialog"]');
      dialogContent?.scrollTo({ top: 0, behavior: "smooth" });
    }, 0);
  };

  const handleSave = async () => {
    if (!name.trim() || !width || !height) {
      showError("Please fill in all fields");
      return;
    }

    const widthNum = parseInt(width);
    const heightNum = parseInt(height);

    if (
      isNaN(widthNum) ||
      isNaN(heightNum) ||
      widthNum <= 0 ||
      heightNum <= 0
    ) {
      showError("Width and height must be positive numbers");
      return;
    }

    setLoading(true);
    try {
      if (editingId) {
        // Update existing preset
        await IpcClient.getInstance().updateDevicePreset({
          id: editingId,
          name: name.trim(),
          width: widthNum,
          height: heightNum,
        });
        showSuccess("Device preset updated successfully");
      } else {
        // Add new preset
        await IpcClient.getInstance().addDevicePreset({
          name: name.trim(),
          width: widthNum,
          height: heightNum,
          isCustom: true,
        });
        showSuccess("Device preset added successfully");
      }

      resetForm();
      await loadPresets();
      onPresetsChanged();
    } catch (error: any) {
      showError(error?.message || "Failed to save device preset");
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Are you sure you want to delete this device preset?")) {
      return;
    }

    setLoading(true);
    try {
      await IpcClient.getInstance().deleteDevicePreset(id);
      showSuccess("Device preset deleted successfully");
      await loadPresets();
      onPresetsChanged();
    } catch (error: any) {
      showError(error?.message || "Failed to delete device preset");
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    resetForm();
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Manage Device Presets</DialogTitle>
          <DialogDescription>
            Add, edit, or delete custom device presets. Default presets cannot
            be modified.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Add/Edit Form */}
          {(isAdding || editingId) && (
            <div className="p-4 border rounded-lg bg-gray-50 dark:bg-gray-900 space-y-3">
              <h3 className="text-sm font-medium">
                {editingId ? "Edit Device Preset" : "Add New Device Preset"}
              </h3>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-gray-600 dark:text-gray-400 block mb-1">
                    Name
                  </label>
                  <Input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g., iPhone 16"
                    className="h-8"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-600 dark:text-gray-400 block mb-1">
                    Width (px)
                  </label>
                  <Input
                    type="number"
                    value={width}
                    onChange={(e) => setWidth(e.target.value)}
                    placeholder="390"
                    className="h-8"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-600 dark:text-gray-400 block mb-1">
                    Height (px)
                  </label>
                  <Input
                    type="number"
                    value={height}
                    onChange={(e) => setHeight(e.target.value)}
                    placeholder="844"
                    className="h-8"
                  />
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCancel}
                  disabled={loading}
                >
                  Cancel
                </Button>
                <Button size="sm" onClick={handleSave} disabled={loading}>
                  {loading ? "Saving..." : "Save"}
                </Button>
              </div>
            </div>
          )}

          {/* Add Button */}
          {!isAdding && !editingId && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleAdd}
              className="w-full"
            >
              <Plus size={16} className="mr-2" />
              Add New Device Preset
            </Button>
          )}

          {/* Presets List */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Device Presets
            </h3>
            {loading && presets.length === 0 ? (
              <div className="text-sm text-gray-500 dark:text-gray-400 py-4 text-center">
                Loading...
              </div>
            ) : presets.length === 0 ? (
              <div className="text-sm text-gray-500 dark:text-gray-400 py-4 text-center">
                No device presets found
              </div>
            ) : (
              <div className="space-y-1">
                {presets.map((preset) => (
                  <div
                    key={preset.id}
                    className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-900"
                  >
                    <div className="flex items-center gap-3">
                      <div>
                        <div className="font-medium text-sm">{preset.name}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {preset.width}×{preset.height}
                          {preset.isDefault && (
                            <span className="ml-2 text-blue-600 dark:text-blue-400">
                              (Default)
                            </span>
                          )}
                          {preset.isCustom && (
                            <span className="ml-2 text-green-600 dark:text-green-400">
                              (Custom)
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    {!preset.isDefault && (
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEdit(preset)}
                          disabled={loading}
                          className="h-8 w-8 p-0"
                        >
                          <Pencil size={14} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(preset.id)}
                          disabled={loading}
                          className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
                        >
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
