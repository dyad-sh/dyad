import React from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Shield, FileText, Terminal, Settings } from 'lucide-react';

export interface PermissionRequest {
  id: string;
  operation: string;
  path?: string;
  description: string;
  riskLevel: 'low' | 'medium' | 'high';
  timestamp: number;
}

interface PermissionDialogProps {
  request: PermissionRequest | null;
  onApprove: () => void;
  onDeny: () => void;
  onApproveAll?: () => void;
  showApproveAll?: boolean;
}

export function PermissionDialog({
  request,
  onApprove,
  onDeny,
  onApproveAll,
  showApproveAll = false,
}: PermissionDialogProps) {
  if (!request) return null;

  const getRiskColor = (level: string) => {
    switch (level) {
      case 'low': return 'bg-green-100 text-green-800 border-green-200';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'high': return 'bg-red-100 text-red-800 border-red-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getRiskIcon = (level: string) => {
    switch (level) {
      case 'low': return <Shield className="w-4 h-4" />;
      case 'medium': return <AlertTriangle className="w-4 h-4" />;
      case 'high': return <AlertTriangle className="w-4 h-4" />;
      default: return <Settings className="w-4 h-4" />;
    }
  };

  const getOperationIcon = (operation: string) => {
    if (operation.includes('read') || operation.includes('list')) {
      return <FileText className="w-5 h-5" />;
    }
    if (operation.includes('write') || operation.includes('create') || operation.includes('modify')) {
      return <FileText className="w-5 h-5" />;
    }
    if (operation.includes('execute') || operation.includes('run')) {
      return <Terminal className="w-5 h-5" />;
    }
    return <Settings className="w-5 h-5" />;
  };

  const formatOperation = (operation: string) => {
    return operation
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  return (
    <AlertDialog open={!!request}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            {getOperationIcon(request.operation)}
            Permission Required
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-medium">Operation:</span>
              <Badge variant="outline" className="font-mono">
                {formatOperation(request.operation)}
              </Badge>
            </div>

            <div className="flex items-center justify-between">
              <span className="font-medium">Risk Level:</span>
              <Badge className={getRiskColor(request.riskLevel)}>
                {getRiskIcon(request.riskLevel)}
                <span className="ml-1 capitalize">{request.riskLevel}</span>
              </Badge>
            </div>

            {request.path && (
              <div className="space-y-1">
                <span className="font-medium">Path:</span>
                <code className="block text-xs bg-gray-100 p-2 rounded break-all">
                  {request.path}
                </code>
              </div>
            )}

            <div className="space-y-1">
              <span className="font-medium">Details:</span>
              <div className="text-sm bg-gray-50 p-3 rounded border-l-4 border-blue-400">
                <pre className="whitespace-pre-wrap font-sans text-gray-700">
                  {request.description}
                </pre>
              </div>
            </div>

            {request.riskLevel === 'high' && (
              <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded">
                <AlertTriangle className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-red-700">
                  <strong>High Risk Operation:</strong> This action could potentially modify system files, 
                  execute code, or access sensitive areas. Please review carefully before approving.
                </div>
              </div>
            )}

            <div className="text-xs text-gray-500">
              Requested at: {new Date(request.timestamp).toLocaleTimeString()}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel onClick={onDeny} className="flex-1">
            Deny
          </AlertDialogCancel>
          
          {showApproveAll && onApproveAll && (
            <AlertDialogAction
              onClick={onApproveAll}
              className="bg-blue-600 hover:bg-blue-700"
            >
              Approve All Similar
            </AlertDialogAction>
          )}
          
          <AlertDialogAction
            onClick={onApprove}
            className={
              request.riskLevel === 'high'
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-green-600 hover:bg-green-700'
            }
          >
            Approve
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// Permission history component
interface PermissionHistoryProps {
  requests: PermissionRequest[];
  onClear?: () => void;
}

export function PermissionHistory({ requests, onClear }: PermissionHistoryProps) {
  if (requests.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        <Shield className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p>No permission requests yet</p>
      </div>
    );
  }

  const formatOperation = (operation: string) => {
    return operation
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const getRiskColor = (level: string) => {
    switch (level) {
      case 'low': return 'bg-green-100 text-green-800 border-green-200';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'high': return 'bg-red-100 text-red-800 border-red-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Permission History</h3>
        {onClear && (
          <button
            onClick={onClear}
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            Clear History
          </button>
        )}
      </div>

      <div className="space-y-2 max-h-64 overflow-y-auto">
        {requests.map((request) => (
          <div
            key={request.id}
            className="p-3 border rounded-lg bg-gray-50 text-sm"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-medium">{formatOperation(request.operation)}</span>
              <Badge className={getRiskColor(request.riskLevel)}>
                {request.riskLevel}
              </Badge>
            </div>
            
            {request.path && (
              <div className="text-xs text-gray-600 mb-1">
                Path: <code>{request.path}</code>
              </div>
            )}
            
            <div className="text-xs text-gray-500">
              {new Date(request.timestamp).toLocaleString()}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}