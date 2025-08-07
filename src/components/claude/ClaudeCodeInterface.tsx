import React, { useState, useEffect } from 'react';
import { ClaudeTerminal } from './ClaudeTerminal';
import { ClaudeCodeSettings } from './ClaudeCodeSettings';
import { PermissionDialog, PermissionHistory } from './PermissionDialog';
import { useClaudeCode } from '@/hooks/useClaudeCode';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Terminal,
  Settings,
  Shield,
  Activity,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
} from 'lucide-react';

interface ClaudeCodeInterfaceProps {
  workingDirectory?: string;
  initialSettings?: any;
  onSettingsChange?: (settings: any) => void;
}

export function ClaudeCodeInterface({
  workingDirectory,
  initialSettings,
  onSettingsChange,
}: ClaudeCodeInterfaceProps) {
  const [settings, setSettings] = useState(initialSettings || {});
  const [permissionHistory, setPermissionHistory] = useState<any[]>([]);
  const [currentPermission, setCurrentPermission] = useState<any>(null);
  
  const {
    isRunning,
    isLoading,
    error,
    output,
    pendingPermission,
    sessionInfo,
    startClaude,
    stopClaude,
    sendCommand,
    approvePermission,
    denyPermission,
    clearOutput,
    clearError,
    getOutputHistory,
    hasOutput,
    canStart,
    canStop,
  } = useClaudeCode({
    workingDirectory: settings.workingDirectory || workingDirectory,
    apiKey: settings.apiKey,
    dangerouslySkipPermissions: settings.dangerouslySkipPermissions,
  });

  // Handle permission requests
  useEffect(() => {
    if (pendingPermission && !currentPermission) {
      const permission = {
        id: Date.now().toString(),
        operation: 'unknown',
        description: pendingPermission,
        riskLevel: 'medium' as const,
        timestamp: Date.now(),
      };
      setCurrentPermission(permission);
    }
  }, [pendingPermission, currentPermission]);

  const handleApprovePermission = async () => {
    if (currentPermission) {
      setPermissionHistory(prev => [...prev, { ...currentPermission, approved: true }]);
      setCurrentPermission(null);
      await approvePermission();
    }
  };

  const handleDenyPermission = async () => {
    if (currentPermission) {
      setPermissionHistory(prev => [...prev, { ...currentPermission, approved: false }]);
      setCurrentPermission(null);
      await denyPermission();
    }
  };

  const handleSettingsChange = (newSettings: any) => {
    setSettings(newSettings);
    onSettingsChange?.(newSettings);
  };

  const getStatusBadge = () => {
    if (isLoading) {
      return <Badge variant="secondary">Starting...</Badge>;
    }
    if (isRunning) {
      return <Badge className="bg-green-500">Running</Badge>;
    }
    if (error) {
      return <Badge variant="destructive">Error</Badge>;
    }
    return <Badge variant="outline">Stopped</Badge>;
  };

  const getSessionStats = () => {
    const stats = [];
    
    if (sessionInfo.startTime) {
      const runtime = Date.now() - sessionInfo.startTime;
      const minutes = Math.floor(runtime / 60000);
      stats.push(`Runtime: ${minutes}m`);
    }
    
    if (hasOutput) {
      const lines = output.split('\n').length;
      stats.push(`Output lines: ${lines}`);
    }
    
    stats.push(`Permissions: ${permissionHistory.length}`);
    
    return stats.join(' • ');
  };

  return (
    <div className="w-full h-full flex flex-col space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Terminal className="w-6 h-6" />
          <h1 className="text-2xl font-bold">Claude Code</h1>
          {getStatusBadge()}
        </div>
        
        <div className="flex items-center gap-2">
          {error && (
            <Button onClick={clearError} variant="outline" size="sm">
              Clear Error
            </Button>
          )}
          {hasOutput && (
            <Button onClick={clearOutput} variant="outline" size="sm">
              Clear Output
            </Button>
          )}
        </div>
      </div>

      {/* Status Bar */}
      {(isRunning || sessionInfo.projectPath) && (
        <Card>
          <CardContent className="py-3">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Activity className={`w-4 h-4 ${isRunning ? 'text-green-500' : 'text-gray-400'}`} />
                  <span>Status: {isRunning ? 'Active' : 'Inactive'}</span>
                </div>
                
                {sessionInfo.projectPath && (
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-blue-500" />
                    <span>Project: {sessionInfo.projectPath}</span>
                  </div>
                )}
              </div>
              
              <div className="text-gray-600">
                {getSessionStats()}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Interface */}
      <div className="flex-1">
        <Tabs defaultValue="terminal" className="w-full h-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="terminal">Terminal</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
            <TabsTrigger value="permissions">
              Permissions
              {permissionHistory.length > 0 && (
                <Badge variant="secondary" className="ml-2 text-xs">
                  {permissionHistory.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="logs">Logs</TabsTrigger>
          </TabsList>

          {/* Terminal Tab */}
          <TabsContent value="terminal" className="h-full">
            <ClaudeTerminal
              workingDirectory={settings.workingDirectory || workingDirectory}
              apiKey={settings.apiKey}
              onOutput={(output) => {
                // Handle terminal output if needed
              }}
              onError={(error) => {
                // Handle terminal errors if needed
              }}
            />
          </TabsContent>

          {/* Settings Tab */}
          <TabsContent value="settings">
            <ClaudeCodeSettings
              settings={settings}
              onSettingsChange={handleSettingsChange}
            />
          </TabsContent>

          {/* Permissions Tab */}
          <TabsContent value="permissions" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="w-5 h-5" />
                  Permission Management
                </CardTitle>
              </CardHeader>
              <CardContent>
                {currentPermission ? (
                  <div className="mb-6">
                    <h3 className="font-medium mb-2 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-yellow-500" />
                      Pending Permission Request
                    </h3>
                    <div className="p-4 border border-yellow-200 rounded-lg bg-yellow-50">
                      <pre className="whitespace-pre-wrap text-sm">
                        {currentPermission.description}
                      </pre>
                      <div className="flex gap-2 mt-3">
                        <Button
                          onClick={handleApprovePermission}
                          size="sm"
                          className="bg-green-600 hover:bg-green-700"
                        >
                          <CheckCircle className="w-4 h-4 mr-1" />
                          Approve
                        </Button>
                        <Button
                          onClick={handleDenyPermission}
                          size="sm"
                          variant="destructive"
                        >
                          <XCircle className="w-4 h-4 mr-1" />
                          Deny
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <Shield className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p>No pending permission requests</p>
                  </div>
                )}

                <PermissionHistory
                  requests={permissionHistory}
                  onClear={() => setPermissionHistory([])}
                />
              </CardContent>
            </Card>
          </TabsContent>

          {/* Logs Tab */}
          <TabsContent value="logs">
            <Card>
              <CardHeader>
                <CardTitle>Session Logs</CardTitle>
              </CardHeader>
              <CardContent>
                {hasOutput ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">
                        Output History ({output.split('\n').length} lines)
                      </span>
                      <Button onClick={clearOutput} variant="outline" size="sm">
                        Clear Logs
                      </Button>
                    </div>
                    
                    <div className="bg-black text-green-400 p-4 rounded font-mono text-sm max-h-96 overflow-y-auto">
                      <pre>{output}</pre>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <Terminal className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p>No output logs yet</p>
                    <p className="text-sm">Start Claude to see command output here</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Permission Dialog */}
      <PermissionDialog
        request={currentPermission}
        onApprove={handleApprovePermission}
        onDeny={handleDenyPermission}
        showApproveAll={false}
      />
    </div>
  );
}