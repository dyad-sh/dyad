import React, { useState, useEffect, useRef, useCallback } from 'react';
import { RefreshCw, Trash2, Filter, Download, Pause, Play } from 'lucide-react';

interface LogEntry {
    timestamp: string;
    level: string;
    message: string;
    source: string;
}

interface LogsData {
    logs: LogEntry[];
    total: number;
    bufferSize: number;
}

const levelColors: Record<string, string> = {
    INFO: 'text-blue-400',
    WARN: 'text-amber-400',
    ERROR: 'text-red-400',
};

const levelBgColors: Record<string, string> = {
    INFO: 'bg-blue-500/20',
    WARN: 'bg-amber-500/20',
    ERROR: 'bg-red-500/20',
};

export default function LogsPage() {
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [autoRefresh, setAutoRefresh] = useState(true);
    const [filterLevel, setFilterLevel] = useState<string>('ALL');
    const [stats, setStats] = useState<{ INFO: number; WARN: number; ERROR: number }>({ INFO: 0, WARN: 0, ERROR: 0 });
    const logsEndRef = useRef<HTMLDivElement>(null);
    const intervalRef = useRef<NodeJS.Timeout | null>(null);

    const fetchLogs = useCallback(async () => {
        try {
            const levelParam = filterLevel !== 'ALL' ? `&level=${filterLevel}` : '';
            const response = await fetch(`/api/logs?limit=500${levelParam}`);
            if (!response.ok) throw new Error('Failed to fetch logs');

            const data = await response.json();
            if (data.success) {
                setLogs(data.data.logs);
                setError(null);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch logs');
        } finally {
            setLoading(false);
        }
    }, [filterLevel]);

    const fetchStats = useCallback(async () => {
        try {
            const response = await fetch('/api/logs/stats');
            if (response.ok) {
                const data = await response.json();
                if (data.success) {
                    setStats(data.data.byLevel);
                }
            }
        } catch (err) {
            // Ignore stats errors
        }
    }, []);

    const clearLogs = async () => {
        try {
            const response = await fetch('/api/logs', { method: 'DELETE' });
            if (response.ok) {
                setLogs([]);
                setStats({ INFO: 0, WARN: 0, ERROR: 0 });
            }
        } catch (err) {
            setError('Failed to clear logs');
        }
    };

    const downloadLogs = () => {
        const logText = logs.map(log =>
            `[${log.timestamp}] [${log.level}] ${log.message}`
        ).join('\n');

        const blob = new Blob([logText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `dyad-logs-${new Date().toISOString().split('T')[0]}.txt`;
        a.click();
        URL.revokeObjectURL(url);
    };

    useEffect(() => {
        fetchLogs();
        fetchStats();
    }, [fetchLogs, fetchStats]);

    useEffect(() => {
        if (autoRefresh) {
            intervalRef.current = setInterval(() => {
                fetchLogs();
                fetchStats();
            }, 3000);
        } else {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
            }
        }
        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
            }
        };
    }, [autoRefresh, fetchLogs, fetchStats]);

    useEffect(() => {
        if (autoRefresh && logsEndRef.current) {
            logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [logs, autoRefresh]);

    const filteredLogs = filterLevel === 'ALL'
        ? logs
        : logs.filter(log => log.level === filterLevel);

    return (
        <div className="flex h-full flex-col overflow-hidden">
            {/* Header */}
            <div className="flex-shrink-0 border-b border-border bg-background/95 backdrop-blur p-4">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h1 className="text-2xl font-bold">System Logs</h1>
                        <p className="text-sm text-muted-foreground">
                            Real-time application and server logs
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setAutoRefresh(!autoRefresh)}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${autoRefresh
                                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                    : 'bg-muted text-muted-foreground border border-border'
                                }`}
                        >
                            {autoRefresh ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                            {autoRefresh ? 'Live' : 'Paused'}
                        </button>
                        <button
                            onClick={fetchLogs}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm bg-muted hover:bg-muted/80 border border-border transition-colors"
                        >
                            <RefreshCw className="h-4 w-4" />
                            Refresh
                        </button>
                        <button
                            onClick={downloadLogs}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm bg-muted hover:bg-muted/80 border border-border transition-colors"
                        >
                            <Download className="h-4 w-4" />
                            Export
                        </button>
                        <button
                            onClick={clearLogs}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/30 transition-colors"
                        >
                            <Trash2 className="h-4 w-4" />
                            Clear
                        </button>
                    </div>
                </div>

                {/* Stats and Filters */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                            <Filter className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm text-muted-foreground">Filter:</span>
                        </div>
                        {['ALL', 'INFO', 'WARN', 'ERROR'].map(level => (
                            <button
                                key={level}
                                onClick={() => setFilterLevel(level)}
                                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${filterLevel === level
                                        ? level === 'ALL'
                                            ? 'bg-foreground text-background'
                                            : `${levelBgColors[level]} ${levelColors[level]}`
                                        : 'bg-muted text-muted-foreground hover:bg-muted/80'
                                    }`}
                            >
                                {level}
                                {level !== 'ALL' && (
                                    <span className="ml-1 opacity-70">({stats[level as keyof typeof stats]})</span>
                                )}
                            </button>
                        ))}
                    </div>
                    <span className="text-xs text-muted-foreground">
                        Showing {filteredLogs.length} logs
                    </span>
                </div>
            </div>

            {/* Log Content */}
            <div className="flex-1 overflow-y-auto bg-zinc-950 font-mono text-sm">
                {loading ? (
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                        <RefreshCw className="h-5 w-5 animate-spin mr-2" />
                        Loading logs...
                    </div>
                ) : error ? (
                    <div className="flex items-center justify-center h-full text-red-400">
                        {error}
                    </div>
                ) : filteredLogs.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                        No logs available
                    </div>
                ) : (
                    <div className="p-4 space-y-1">
                        {filteredLogs.map((log, idx) => (
                            <div
                                key={idx}
                                className={`flex items-start gap-3 py-1 px-2 rounded hover:bg-white/5 ${log.level === 'ERROR' ? 'bg-red-500/5' : ''
                                    }`}
                            >
                                <span className="text-zinc-500 text-xs whitespace-nowrap">
                                    {new Date(log.timestamp).toLocaleTimeString()}
                                </span>
                                <span className={`text-xs font-semibold w-12 ${levelColors[log.level]}`}>
                                    [{log.level}]
                                </span>
                                <span className="text-zinc-300 break-all flex-1">{log.message}</span>
                            </div>
                        ))}
                        <div ref={logsEndRef} />
                    </div>
                )}
            </div>
        </div>
    );
}
