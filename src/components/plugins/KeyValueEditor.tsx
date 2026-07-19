import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { showError, showSuccess } from "@/lib/toast";
import { Edit2, Plus, Save, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";

export type KeyValue = { key: string; value: string };

export function parseJsonToArray(
  json?: Record<string, string> | string | null,
): KeyValue[] {
  if (!json) return [];
  try {
    const obj =
      typeof json === "string"
        ? (JSON.parse(json) as unknown as Record<string, string>)
        : (json as Record<string, string>);
    return Object.entries(obj).map(([key, value]) => ({
      key,
      value: String(value ?? ""),
    }));
  } catch {
    return [];
  }
}

export function arrayToJsonObject(envVars: KeyValue[]): Record<string, string> {
  const env: Record<string, string> = {};
  for (const { key, value } of envVars) {
    if (key.trim().length === 0) continue;
    env[key.trim()] = value;
  }
  return env;
}

export function KeyValueEditor({
  id,
  json,
  disabled,
  onSave,
  isSaving,
  itemLabel = "Environment Variable",
}: {
  id: number;
  json?: Record<string, string> | null;
  disabled?: boolean;
  onSave: (envVars: KeyValue[]) => Promise<void>;
  isSaving: boolean;
  itemLabel?: string;
}) {
  const { t } = useTranslation(["settings", "common", "home"]);
  const initial = useMemo(() => parseJsonToArray(json), [json]);
  const [envVars, setEnvVars] = useState<KeyValue[]>(initial);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingKeyValue, setEditingKeyValue] = useState("");
  const [editingValue, setEditingValue] = useState("");
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [isAddingNew, setIsAddingNew] = useState(false);

  React.useEffect(() => {
    setEnvVars(initial);
  }, [id, initial]);

  const saveAll = async (next: KeyValue[]) => {
    await onSave(next);
    setEnvVars(next);
  };

  const handleAdd = async () => {
    if (!newKey.trim() || !newValue.trim()) {
      showError(t("toolsMcp.keyValueRequired"));
      return;
    }
    if (envVars.some((e) => e.key === newKey.trim())) {
      showError(t("settings:toolsMcp.duplicateKey"));
      return;
    }
    const next = [...envVars, { key: newKey.trim(), value: newValue.trim() }];
    await saveAll(next);
    setNewKey("");
    setNewValue("");
    setIsAddingNew(false);
    showSuccess(
      t("home:plugins.keyValueSaved", {
        item:
          itemLabel === "Header"
            ? t("home:plugins.headers")
            : t("home:plugins.environmentVariables"),
      }),
    );
  };

  const handleEdit = (kv: KeyValue) => {
    setEditingKey(kv.key);
    setEditingKeyValue(kv.key);
    setEditingValue(kv.value);
  };

  const handleSaveEdit = async () => {
    if (!editingKey) return;
    if (!editingKeyValue.trim() || !editingValue.trim()) {
      showError(t("toolsMcp.keyValueRequired"));
      return;
    }
    if (
      envVars.some(
        (e) => e.key === editingKeyValue.trim() && e.key !== editingKey,
      )
    ) {
      showError(t("settings:toolsMcp.duplicateKey"));
      return;
    }
    const next = envVars.map((e) =>
      e.key === editingKey
        ? { key: editingKeyValue.trim(), value: editingValue.trim() }
        : e,
    );
    await saveAll(next);
    setEditingKey(null);
    setEditingKeyValue("");
    setEditingValue("");
    showSuccess(
      t("home:plugins.keyValueSaved", {
        item:
          itemLabel === "Header"
            ? t("home:plugins.headers")
            : t("home:plugins.environmentVariables"),
      }),
    );
  };

  const handleCancelEdit = () => {
    setEditingKey(null);
    setEditingKeyValue("");
    setEditingValue("");
  };

  const handleDelete = async (key: string) => {
    const next = envVars.filter((e) => e.key !== key);
    await saveAll(next);
    showSuccess(
      t("home:plugins.keyValueSaved", {
        item:
          itemLabel === "Header"
            ? t("home:plugins.headers")
            : t("home:plugins.environmentVariables"),
      }),
    );
  };

  return (
    <div className="mt-3 space-y-3">
      {isAddingNew ? (
        <div className="space-y-3 p-3 border rounded-md bg-muted/50">
          <div className="space-y-2">
            <Label htmlFor={`env-new-key-${id}`}>
              {t("settings:toolsMcp.key")}
            </Label>
            <Input
              id={`env-new-key-${id}`}
              placeholder={
                itemLabel === "Header"
                  ? t("settings:toolsMcp.key")
                  : t("settings:toolsMcp.keyPlaceholder")
              }
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              autoFocus
              disabled={disabled || isSaving}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`env-new-value-${id}`}>
              {t("settings:toolsMcp.value")}
            </Label>
            <Input
              id={`env-new-value-${id}`}
              placeholder={
                itemLabel === "Header"
                  ? t("settings:toolsMcp.value")
                  : t("settings:toolsMcp.valuePlaceholder")
              }
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              disabled={disabled || isSaving}
            />
          </div>
          <div className="flex gap-2">
            <Button
              onClick={handleAdd}
              size="sm"
              disabled={disabled || isSaving}
            >
              <Save size={14} />
              {isSaving ? t("common:saving") : t("common:save")}
            </Button>
            <Button
              onClick={() => {
                setIsAddingNew(false);
                setNewKey("");
                setNewValue("");
              }}
              variant="outline"
              size="sm"
            >
              <X size={14} />
              {t("common:cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          onClick={() => setIsAddingNew(true)}
          variant="outline"
          className="w-full"
          disabled={disabled}
        >
          <Plus size={14} />
          {itemLabel === "Header"
            ? t("home:plugins.addHeader")
            : t("settings:toolsMcp.addEnvVar")}
        </Button>
      )}

      <div className="space-y-2">
        {envVars.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            {t("home:plugins.noItemsConfigured", {
              item:
                itemLabel === "Header"
                  ? t("home:plugins.headers")
                  : t("home:plugins.environmentVariables"),
            })}
          </p>
        ) : (
          envVars.map((kv) => (
            <div
              key={kv.key}
              className="flex items-center space-x-2 p-2 border rounded-md"
            >
              {editingKey === kv.key ? (
                <>
                  <div className="flex-1 space-y-2">
                    <Input
                      value={editingKeyValue}
                      onChange={(e) => setEditingKeyValue(e.target.value)}
                      placeholder={t("settings:toolsMcp.key")}
                      aria-label={t("settings:toolsMcp.key")}
                      className="h-8"
                      disabled={disabled || isSaving}
                    />
                    <Input
                      value={editingValue}
                      onChange={(e) => setEditingValue(e.target.value)}
                      placeholder={t("settings:toolsMcp.value")}
                      aria-label={t("settings:toolsMcp.value")}
                      className="h-8"
                      disabled={disabled || isSaving}
                    />
                  </div>
                  <div className="flex gap-1">
                    <Button
                      onClick={handleSaveEdit}
                      size="sm"
                      variant="outline"
                      disabled={disabled || isSaving}
                    >
                      <Save size={14} />
                    </Button>
                    <Button
                      onClick={handleCancelEdit}
                      size="sm"
                      variant="outline"
                    >
                      <X size={14} />
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{kv.key}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {kv.value}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      onClick={() => handleEdit(kv)}
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0"
                      disabled={disabled}
                    >
                      <Edit2 size={14} />
                    </Button>
                    <Button
                      onClick={() => handleDelete(kv.key)}
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                      disabled={disabled || isSaving}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
