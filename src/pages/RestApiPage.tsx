import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Copy, Check } from 'lucide-react';

// API Endpoint definition
interface ApiEndpoint {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    path: string;
    description: string;
    requestBody?: string;
    responseExample?: string;
}

interface ApiGroup {
    name: string;
    description: string;
    endpoints: ApiEndpoint[];
}

// API Documentation Data
const apiGroups: ApiGroup[] = [
    {
        name: 'Health',
        description: 'Health check endpoints',
        endpoints: [
            {
                method: 'GET',
                path: '/api/health',
                description: 'Returns the health status of the server',
                responseExample: JSON.stringify({
                    success: true,
                    data: {
                        status: 'healthy',
                        timestamp: '2026-01-12T12:00:00Z',
                        version: '0.29.0'
                    }
                }, null, 2)
            },
            {
                method: 'GET',
                path: '/api/health/ready',
                description: 'Returns readiness status including database connection',
                responseExample: JSON.stringify({
                    success: true,
                    data: {
                        status: 'ready',
                        database: 'connected'
                    }
                }, null, 2)
            }
        ]
    },
    {
        name: 'Apps',
        description: 'Application management endpoints',
        endpoints: [
            {
                method: 'GET',
                path: '/api/apps',
                description: 'List all applications',
                responseExample: JSON.stringify({
                    success: true,
                    data: [{ id: 1, name: 'My App', description: 'App description' }]
                }, null, 2)
            },
            {
                method: 'POST',
                path: '/api/apps',
                description: 'Create a new application',
                requestBody: JSON.stringify({
                    name: 'New App',
                    description: 'App description',
                    templateId: 'react'
                }, null, 2),
                responseExample: JSON.stringify({
                    success: true,
                    data: { id: 1, name: 'New App' }
                }, null, 2)
            },
            {
                method: 'GET',
                path: '/api/apps/:id',
                description: 'Get a specific application by ID',
                responseExample: JSON.stringify({
                    success: true,
                    data: { id: 1, name: 'My App', files: [] }
                }, null, 2)
            },
            {
                method: 'PUT',
                path: '/api/apps/:id',
                description: 'Update an application',
                requestBody: JSON.stringify({
                    name: 'Updated App Name'
                }, null, 2)
            },
            {
                method: 'DELETE',
                path: '/api/apps/:id',
                description: 'Delete an application'
            },
            {
                method: 'POST',
                path: '/api/apps/:id/run',
                description: 'Run/start an application'
            },
            {
                method: 'POST',
                path: '/api/apps/:id/stop',
                description: 'Stop a running application'
            }
        ]
    },
    {
        name: 'Chats',
        description: 'Chat management endpoints',
        endpoints: [
            {
                method: 'GET',
                path: '/api/chats',
                description: 'List all chats (optionally filter by appId)',
                responseExample: JSON.stringify({
                    success: true,
                    data: [{ id: 1, appId: 1, title: 'Chat 1' }]
                }, null, 2)
            },
            {
                method: 'POST',
                path: '/api/chats',
                description: 'Create a new chat',
                requestBody: JSON.stringify({
                    appId: 1,
                    title: 'New Chat'
                }, null, 2)
            },
            {
                method: 'GET',
                path: '/api/chats/:id',
                description: 'Get a chat with its messages'
            },
            {
                method: 'PUT',
                path: '/api/chats/:id',
                description: 'Update chat title',
                requestBody: JSON.stringify({
                    title: 'Updated Title'
                }, null, 2)
            },
            {
                method: 'DELETE',
                path: '/api/chats/:id',
                description: 'Delete a chat and its messages'
            }
        ]
    },
    {
        name: 'Settings',
        description: 'Application settings management',
        endpoints: [
            {
                method: 'GET',
                path: '/api/settings',
                description: 'Get all settings including API keys'
            },
            {
                method: 'PUT',
                path: '/api/settings',
                description: 'Update settings',
                requestBody: JSON.stringify({
                    theme: 'dark',
                    defaultModel: 'gemini-2.0-flash-exp'
                }, null, 2)
            }
        ]
    },
    {
        name: 'Providers',
        description: 'LLM provider management',
        endpoints: [
            {
                method: 'GET',
                path: '/api/providers',
                description: 'List all configured LLM providers'
            },
            {
                method: 'GET',
                path: '/api/providers/:id/models',
                description: 'Get available models for a provider'
            }
        ]
    },
    {
        name: 'Prompts',
        description: 'System prompts management',
        endpoints: [
            {
                method: 'GET',
                path: '/api/prompts',
                description: 'List all prompts'
            },
            {
                method: 'POST',
                path: '/api/prompts',
                description: 'Create a new prompt'
            },
            {
                method: 'PUT',
                path: '/api/prompts/:id',
                description: 'Update a prompt'
            },
            {
                method: 'DELETE',
                path: '/api/prompts/:id',
                description: 'Delete a prompt'
            }
        ]
    },
    {
        name: 'Templates',
        description: 'App template management',
        endpoints: [
            {
                method: 'GET',
                path: '/api/templates',
                description: 'List available app templates'
            }
        ]
    },
    {
        name: 'WebSocket',
        description: 'Real-time communication endpoints',
        endpoints: [
            {
                method: 'GET',
                path: 'ws://host/ws/chat',
                description: 'WebSocket endpoint for real-time chat streaming'
            },
            {
                method: 'GET',
                path: 'ws://host/ws/terminal',
                description: 'WebSocket endpoint for terminal access'
            }
        ]
    }
];

// Method badge colors
const methodColors: Record<string, string> = {
    GET: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    POST: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    PUT: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    DELETE: 'bg-red-500/20 text-red-400 border-red-500/30',
};

function EndpointCard({ endpoint }: { endpoint: ApiEndpoint }) {
    const [isExpanded, setIsExpanded] = useState(false);
    const [copied, setCopied] = useState<string | null>(null);

    const copyToClipboard = (text: string, type: string) => {
        navigator.clipboard.writeText(text);
        setCopied(type);
        setTimeout(() => setCopied(null), 2000);
    };

    return (
        <div className="border border-border/50 rounded-lg overflow-hidden bg-card/50 hover:bg-card/80 transition-colors">
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full flex items-center gap-3 p-3 text-left"
            >
                <span className={`px-2 py-0.5 rounded text-xs font-mono font-semibold border ${methodColors[endpoint.method]}`}>
                    {endpoint.method}
                </span>
                <code className="text-sm font-mono text-foreground/90 flex-1">{endpoint.path}</code>
                <span className="text-xs text-muted-foreground hidden sm:block">{endpoint.description}</span>
                {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
            </button>

            {isExpanded && (
                <div className="border-t border-border/50 p-4 space-y-4 bg-background/50">
                    <p className="text-sm text-muted-foreground">{endpoint.description}</p>

                    {endpoint.requestBody && (
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-semibold text-muted-foreground uppercase">Request Body</span>
                                <button
                                    onClick={() => copyToClipboard(endpoint.requestBody!, 'request')}
                                    className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                                >
                                    {copied === 'request' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                                    {copied === 'request' ? 'Copied!' : 'Copy'}
                                </button>
                            </div>
                            <pre className="bg-zinc-900 rounded-md p-3 text-xs overflow-x-auto">
                                <code className="text-emerald-400">{endpoint.requestBody}</code>
                            </pre>
                        </div>
                    )}

                    {endpoint.responseExample && (
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-semibold text-muted-foreground uppercase">Response Example</span>
                                <button
                                    onClick={() => copyToClipboard(endpoint.responseExample!, 'response')}
                                    className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                                >
                                    {copied === 'response' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                                    {copied === 'response' ? 'Copied!' : 'Copy'}
                                </button>
                            </div>
                            <pre className="bg-zinc-900 rounded-md p-3 text-xs overflow-x-auto">
                                <code className="text-blue-400">{endpoint.responseExample}</code>
                            </pre>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function ApiGroupSection({ group }: { group: ApiGroup }) {
    const [isExpanded, setIsExpanded] = useState(true);

    return (
        <div className="border border-border rounded-xl overflow-hidden bg-card shadow-sm">
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full flex items-center justify-between p-4 bg-muted/30 hover:bg-muted/50 transition-colors"
            >
                <div className="flex items-center gap-3">
                    {isExpanded ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
                    <h2 className="text-lg font-semibold">{group.name}</h2>
                    <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                        {group.endpoints.length} endpoints
                    </span>
                </div>
                <span className="text-sm text-muted-foreground hidden sm:block">{group.description}</span>
            </button>

            {isExpanded && (
                <div className="p-4 space-y-2">
                    {group.endpoints.map((endpoint, idx) => (
                        <EndpointCard key={idx} endpoint={endpoint} />
                    ))}
                </div>
            )}
        </div>
    );
}

export default function RestApiPage() {
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';

    return (
        <div className="flex h-full flex-col overflow-hidden">
            {/* Header */}
            <div className="flex-shrink-0 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 p-6">
                <div className="max-w-5xl mx-auto">
                    <h1 className="text-2xl font-bold mb-2">REST API Documentation</h1>
                    <p className="text-muted-foreground mb-4">
                        Explore the available API endpoints for the Dyad application.
                    </p>
                    <div className="flex items-center gap-2 text-sm">
                        <span className="text-muted-foreground">Base URL:</span>
                        <code className="bg-muted px-2 py-1 rounded font-mono text-xs">{baseUrl}/api</code>
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
                <div className="max-w-5xl mx-auto space-y-4">
                    {apiGroups.map((group, idx) => (
                        <ApiGroupSection key={idx} group={group} />
                    ))}
                </div>
            </div>
        </div>
    );
}
