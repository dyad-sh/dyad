import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';

const PORT = parseInt(process.env.MCP_HTTP_PORT || '3008', 10);
const HOST = process.env.MCP_HTTP_HOST || '0.0.0.0';
const MCP_API_URL = process.env.DYAD_API_URL || 'http://localhost:3007';

const app = express();

// Middleware
app.use(cors({ origin: '*' }));
app.use(express.json());

// Request logging
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        server: 'dyad-mcp-http-proxy',
        version: '0.1.0',
        timestamp: new Date().toISOString(),
        mcpApiUrl: MCP_API_URL
    });
});

// Proxy to Dyad API - List apps
app.get('/api/apps', async (req, res) => {
    try {
        const response = await fetch(`${MCP_API_URL}/api/apps`);
        const data = await response.json();
        res.json(data);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        res.status(500).json({ error: message });
    }
});

// Proxy to Dyad API - Get app
app.get('/api/apps/:id', async (req, res) => {
    try {
        const response = await fetch(`${MCP_API_URL}/api/apps/${req.params.id}`);
        const data = await response.json();
        res.json(data);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        res.status(500).json({ error: message });
    }
});

// Proxy to Dyad API - List chats
app.get('/api/chats', async (req, res) => {
    try {
        const response = await fetch(`${MCP_API_URL}/api/chats`);
        const data = await response.json();
        res.json(data);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        res.status(500).json({ error: message });
    }
});

// Proxy to Dyad API - Get chat
app.get('/api/chats/:id', async (req, res) => {
    try {
        const response = await fetch(`${MCP_API_URL}/api/chats/${req.params.id}`);
        const data = await response.json();
        res.json(data);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        res.status(500).json({ error: message });
    }
});

// Start server
app.listen(PORT, HOST, () => {
    console.log('');
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║  Dyad MCP HTTP Proxy                                       ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log(`  Server:     http://${HOST}:${PORT}`);
    console.log(`  Health:     http://${HOST}:${PORT}/health`);
    console.log(`  Apps API:   http://${HOST}:${PORT}/api/apps`);
    console.log(`  Chats API:  http://${HOST}:${PORT}/api/chats`);
    console.log('');
    console.log(`  Proxying to: ${MCP_API_URL}`);
    console.log('');
    console.log('  Ready to accept HTTP requests!');
    console.log('');
});
