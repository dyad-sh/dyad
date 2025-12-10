import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const AUTH_URL = 'https://dyad1.ty-dev.site';
const SERVER_SCRIPT = path.join(__dirname, 'dist', 'index.js');

console.log(`[TEST] Starting MCP server check against ${AUTH_URL} `);
console.log(`[TEST] Server script: ${SERVER_SCRIPT} `);

// Spawn the MCP server process
const serverProcess = spawn('node', [SERVER_SCRIPT], {
    env: {
        ...process.env,
        DYAD_API_URL: AUTH_URL
    },
    stdio: ['pipe', 'pipe', 'inherit'] // pipe stdin/stdout, inherit stderr for logs
});

// Buffer for stdout
let buffer = '';

serverProcess.stdout.on('data', (data) => {
    const chunk = data.toString();
    // console.log(`[MCP STDOUT] ${ chunk } `);
    buffer += chunk;

    // Try to parse JSON lines
    const lines = buffer.split('\n');
    buffer = lines.pop(); // Keep incomplete line in buffer

    for (const line of lines) {
        if (!line.trim()) continue;
        try {
            const response = JSON.parse(line);
            handleResponse(response);
        } catch (e) {
            // console.log('[TEST] Non-JSON output:', line);
        }
    }
});

serverProcess.on('close', (code) => {
    console.log(`[TEST] MCP server process exited with code ${code} `);
});

// JSON-RPC Request to list tools
const listToolsRequest = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
    params: {}
};

// Send request
console.log('[TEST] Sending tools/list request...');
serverProcess.stdin.write(JSON.stringify(listToolsRequest) + '\n');

function handleResponse(response) {
    if (response.id === 1) {
        console.log('[TEST] Received response for tools/list:');
        if (response.result && response.result.tools) {
            console.log(`[TEST] Found ${response.result.tools.length} tools: `);
            response.result.tools.forEach(tool => {
                console.log(` - ${tool.name}: ${tool.description.substring(0, 50)}...`);
            });

            // Test dyad_list_apps if available
            if (response.result.tools.find(t => t.name === 'dyad_list_apps')) {
                callListApps();
            } else {
                console.error('[TEST] dyad_list_apps tool not found!');
                process.exit(1);
            }
        } else {
            console.error('[TEST] Invalid response structure:', response);
        }
    } else if (response.id === 2) {
        console.log('[TEST] Received response for dyad_list_apps:');
        // The result from call_tool is structured as content: [{type: 'text', text: '...'}]
        if (response.result && response.result.content && response.result.content[0].text) {
            const toolResult = JSON.parse(response.result.content[0].text);
            console.log('[TEST] Tool Result:', JSON.stringify(toolResult, null, 2));

            if (toolResult && toolResult.apps) {
                console.log(`[TEST] SUCCESS! Retrieved ${toolResult.apps.length} apps from remote API.`);
                process.exit(0);
            } else {
                console.error('[TEST] Failed to retrieve apps structure');
                process.exit(1);
            }
        } else {
            console.error('[TEST] Error executing tool:', response);
            process.exit(1);
        }
    }
}

function callListApps() {
    console.log('[TEST] Calling dyad_list_apps...');
    const callRequest = {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
            name: 'dyad_list_apps',
            arguments: {}
        }
    };
    serverProcess.stdin.write(JSON.stringify(callRequest) + '\n');
}

// Timeout
setTimeout(() => {
    console.error('[TEST] Timeout waiting for response');
    serverProcess.kill();
    process.exit(1);
}, 10000);
