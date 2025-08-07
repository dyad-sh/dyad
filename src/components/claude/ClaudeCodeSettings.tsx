import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { 
  Settings, 
  Shield, 
  Terminal, 
  FolderOpen, 
  Key, 
  AlertTriangle,
  Info 
} from 'lucide-react';

interface ClaudeCodeSettingsProps {
  settings: ClaudeCodeSettings;
  onSettingsChange: (settings: ClaudeCodeSettings) => void;
}

interface ClaudeCodeSettings {
  // Authentication
  apiKey?: string;
  useApiKey: boolean;
  
  // Security
  dangerouslySkipPermissions: boolean;
  autoApproveRead: boolean;
  autoApproveWrite: boolean;
  blockedPaths: string[];
  allowedOperations: string[];
  
  // Session
  autoSaveSession: boolean;
  maxHistoryEntries: number;
  sessionTimeout: number; // minutes
  
  // Terminal
  terminalTheme: 'dark' | 'light' | 'auto';
  fontSize: number;
  fontFamily: string;
  
  // Advanced
  workingDirectory?: string;
  customFlags: string[];
  enableLogging: boolean;
  logLevel: 'error' | 'warn' | 'info' | 'debug';
}

const DEFAULT_SETTINGS: ClaudeCodeSettings = {
  useApiKey: false,
  dangerouslySkipPermissions: false,
  autoApproveRead: true,
  autoApproveWrite: false,
  blockedPaths: ['/etc', '/bin', '/usr/bin', '/system32', '~/.ssh', '~/.aws'],
  allowedOperations: ['read', 'write-to-project', 'list-directory', 'analyze-code'],
  autoSaveSession: true,
  maxHistoryEntries: 1000,
  sessionTimeout: 60,
  terminalTheme: 'dark',
  fontSize: 14,
  fontFamily: 'Menlo, Monaco, "Courier New", monospace',
  customFlags: [],
  enableLogging: true,
  logLevel: 'info',
};

export function ClaudeCodeSettings({ 
  settings = DEFAULT_SETTINGS, 
  onSettingsChange 
}: ClaudeCodeSettingsProps) {
  const [localSettings, setLocalSettings] = useState<ClaudeCodeSettings>(settings);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    setLocalSettings(settings);
    setHasChanges(false);
  }, [settings]);

  const updateSetting = <K extends keyof ClaudeCodeSettings>(
    key: K,
    value: ClaudeCodeSettings[K]
  ) => {
    const newSettings = { ...localSettings, [key]: value };
    setLocalSettings(newSettings);
    setHasChanges(true);
  };

  const saveSettings = () => {
    onSettingsChange(localSettings);
    setHasChanges(false);
  };

  const resetSettings = () => {
    setLocalSettings(DEFAULT_SETTINGS);
    setHasChanges(true);
  };

  const addBlockedPath = () => {
    const path = prompt('Enter path to block:');
    if (path && !localSettings.blockedPaths.includes(path)) {
      updateSetting('blockedPaths', [...localSettings.blockedPaths, path]);
    }
  };

  const removeBlockedPath = (path: string) => {
    updateSetting('blockedPaths', localSettings.blockedPaths.filter(p => p !== path));
  };

  const addAllowedOperation = () => {
    const operation = prompt('Enter operation to allow:');
    if (operation && !localSettings.allowedOperations.includes(operation)) {
      updateSetting('allowedOperations', [...localSettings.allowedOperations, operation]);
    }
  };

  const removeAllowedOperation = (operation: string) => {
    updateSetting('allowedOperations', localSettings.allowedOperations.filter(o => o !== operation));
  };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings className="w-6 h-6" />
          <h2 className="text-2xl font-bold">Claude Code Settings</h2>
        </div>
        
        <div className="flex items-center gap-2">
          {hasChanges && (
            <Badge variant="secondary" className="bg-yellow-100 text-yellow-800">
              Unsaved Changes
            </Badge>
          )}
          <Button onClick={resetSettings} variant="outline" size="sm">
            Reset to Defaults
          </Button>
          <Button 
            onClick={saveSettings} 
            disabled={!hasChanges}
            className="bg-blue-600 hover:bg-blue-700"
          >
            Save Settings
          </Button>
        </div>
      </div>

      <Tabs defaultValue="authentication" className="w-full">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="authentication">Authentication</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="session">Session</TabsTrigger>
          <TabsTrigger value="terminal">Terminal</TabsTrigger>
          <TabsTrigger value="advanced">Advanced</TabsTrigger>
        </TabsList>

        {/* Authentication Tab */}
        <TabsContent value="authentication" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Key className="w-5 h-5" />
                Authentication Method
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center space-x-2">
                <Switch
                  id="use-api-key"
                  checked={localSettings.useApiKey}
                  onCheckedChange={(checked) => updateSetting('useApiKey', checked)}
                />
                <Label htmlFor="use-api-key">Use API Key instead of CLI authentication</Label>
              </div>

              {localSettings.useApiKey && (
                <div className="space-y-2">
                  <Label htmlFor="api-key">Anthropic API Key</Label>
                  <Input
                    id="api-key"
                    type="password"
                    placeholder="sk-ant-..."
                    value={localSettings.apiKey || ''}
                    onChange={(e) => updateSetting('apiKey', e.target.value)}
                  />
                  <p className="text-sm text-gray-600">
                    Get your API key from the{' '}
                    <a 
                      href="https://console.anthropic.com/" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline"
                    >
                      Anthropic Console
                    </a>
                  </p>
                </div>
              )}

              {!localSettings.useApiKey && (
                <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="flex items-start gap-3">
                    <Info className="w-5 h-5 text-blue-500 mt-0.5" />
                    <div className="text-sm text-blue-700">
                      <p className="font-medium mb-1">CLI Authentication</p>
                      <p>
                        Claude Code will use your existing CLI authentication. 
                        Make sure you've run <code className="bg-blue-100 px-1 rounded">claude login</code> first.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Security Tab */}
        <TabsContent value="security" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="w-5 h-5" />
                Permission Management
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center space-x-2">
                <Switch
                  id="skip-permissions"
                  checked={localSettings.dangerouslySkipPermissions}
                  onCheckedChange={(checked) => updateSetting('dangerouslySkipPermissions', checked)}
                />
                <Label htmlFor="skip-permissions">Skip all permission prompts (dangerous)</Label>
              </div>

              {localSettings.dangerouslySkipPermissions && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-red-500 mt-0.5" />
                    <div className="text-sm text-red-700">
                      <p className="font-medium mb-1">Warning: Security Risk</p>
                      <p>
                        Skipping permissions allows Claude to perform any action without asking. 
                        Only enable this in trusted environments.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center space-x-2">
                  <Switch
                    id="auto-approve-read"
                    checked={localSettings.autoApproveRead}
                    onCheckedChange={(checked) => updateSetting('autoApproveRead', checked)}
                  />
                  <Label htmlFor="auto-approve-read">Auto-approve read operations</Label>
                </div>

                <div className="flex items-center space-x-2">
                  <Switch
                    id="auto-approve-write"
                    checked={localSettings.autoApproveWrite}
                    onCheckedChange={(checked) => updateSetting('autoApproveWrite', checked)}
                  />
                  <Label htmlFor="auto-approve-write">Auto-approve write operations</Label>
                </div>
              </div>

              <div className="space-y-3">
                <Label>Blocked Paths</Label>
                <div className="flex flex-wrap gap-2">
                  {localSettings.blockedPaths.map((path) => (
                    <Badge
                      key={path}
                      variant="destructive"
                      className="cursor-pointer"
                      onClick={() => removeBlockedPath(path)}
                    >
                      {path} ×
                    </Badge>
                  ))}
                  <Button onClick={addBlockedPath} variant="outline" size="sm">
                    Add Path
                  </Button>
                </div>
              </div>

              <div className="space-y-3">
                <Label>Allowed Operations</Label>
                <div className="flex flex-wrap gap-2">
                  {localSettings.allowedOperations.map((operation) => (
                    <Badge
                      key={operation}
                      variant="secondary"
                      className="cursor-pointer"
                      onClick={() => removeAllowedOperation(operation)}
                    >
                      {operation} ×
                    </Badge>
                  ))}
                  <Button onClick={addAllowedOperation} variant="outline" size="sm">
                    Add Operation
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Session Tab */}
        <TabsContent value="session" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Session Management</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center space-x-2">
                <Switch
                  id="auto-save"
                  checked={localSettings.autoSaveSession}
                  onCheckedChange={(checked) => updateSetting('autoSaveSession', checked)}
                />
                <Label htmlFor="auto-save">Auto-save session history</Label>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="max-history">Max History Entries</Label>
                  <Input
                    id="max-history"
                    type="number"
                    value={localSettings.maxHistoryEntries}
                    onChange={(e) => updateSetting('maxHistoryEntries', parseInt(e.target.value))}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="session-timeout">Session Timeout (minutes)</Label>
                  <Input
                    id="session-timeout"
                    type="number"
                    value={localSettings.sessionTimeout}
                    onChange={(e) => updateSetting('sessionTimeout', parseInt(e.target.value))}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Terminal Tab */}
        <TabsContent value="terminal" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Terminal className="w-5 h-5" />
                Terminal Appearance
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="terminal-theme">Theme</Label>
                  <Select
                    value={localSettings.terminalTheme}
                    onValueChange={(value: any) => updateSetting('terminalTheme', value)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="dark">Dark</SelectItem>
                      <SelectItem value="light">Light</SelectItem>
                      <SelectItem value="auto">Auto</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="font-size">Font Size</Label>
                  <Input
                    id="font-size"
                    type="number"
                    min="8"
                    max="24"
                    value={localSettings.fontSize}
                    onChange={(e) => updateSetting('fontSize', parseInt(e.target.value))}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="font-family">Font Family</Label>
                  <Input
                    id="font-family"
                    value={localSettings.fontFamily}
                    onChange={(e) => updateSetting('fontFamily', e.target.value)}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Advanced Tab */}
        <TabsContent value="advanced" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Advanced Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="working-directory">Working Directory</Label>
                <div className="flex gap-2">
                  <Input
                    id="working-directory"
                    placeholder="Leave empty to use project directory"
                    value={localSettings.workingDirectory || ''}
                    onChange={(e) => updateSetting('workingDirectory', e.target.value)}
                  />
                  <Button variant="outline" size="sm">
                    <FolderOpen className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="custom-flags">Custom CLI Flags</Label>
                <Textarea
                  id="custom-flags"
                  placeholder="Enter custom flags, one per line"
                  value={localSettings.customFlags.join('\n')}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => updateSetting('customFlags', e.target.value.split('\n').filter(Boolean))}
                />
              </div>

              <div className="flex items-center space-x-2">
                <Switch
                  id="enable-logging"
                  checked={localSettings.enableLogging}
                  onCheckedChange={(checked) => updateSetting('enableLogging', checked)}
                />
                <Label htmlFor="enable-logging">Enable detailed logging</Label>
              </div>

              {localSettings.enableLogging && (
                <div className="space-y-2">
                  <Label htmlFor="log-level">Log Level</Label>
                  <Select
                    value={localSettings.logLevel}
                    onValueChange={(value: any) => updateSetting('logLevel', value)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="error">Error</SelectItem>
                      <SelectItem value="warn">Warning</SelectItem>
                      <SelectItem value="info">Info</SelectItem>
                      <SelectItem value="debug">Debug</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}