
import { spawn } from 'child_process';

console.log('[TEST] Starting Docker MCP server verification...');
console.log('[TEST] Target Container: dyad-mcp');

// Spawn the MCP server process via docker exec
// We use 'docker exec -i' to keep stdin open for communication
const serverProcess = spawn('docker', ['exec', '-i', 'dyad-mcp', 'node', 'dist/index.js'], {
    stdio: ['pipe', 'pipe', 'inherit'] // pipe stdin/stdout, inherit stderr for logging
});

// Buffer for stdout
let buffer = '';

serverProcess.stdout.on('data', (data) => {
    const chunk = data.toString();
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
            // Ignore non-JSON output
        }
    }
});

serverProcess.on('error', (err) => {
    console.error('[TEST] Failed to spawn docker process:', err);
    console.error('[TEST] Make sure docker is installed and in your PATH.');
    process.exit(1);
});

serverProcess.on('close', (code) => {
    if (code !== 0) {
        console.log(`[TEST] Docker process exited with code ${code}`);
        console.log('[TEST] Ensure the container "dyad-mcp" is running via "docker compose ps"');
    }
});

// JSON-RPC Request to list tools
const listToolsRequest = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
    params: {}
};

// Send request
console.log('[TEST] Sending tools/list request to container...');
serverProcess.stdin.write(JSON.stringify(listToolsRequest) + '\n');

function handleResponse(response) {
    if (response.id === 1) {
        console.log('[TEST] Received response for tools/list:');
        if (response.result && response.result.tools) {
            console.log(`[TEST] Found ${response.result.tools.length} tools:`);
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
        if (response.result && response.result.content && response.result.content[0].text) {
            const toolResult = JSON.parse(response.result.content[0].text);
            console.log('[TEST] Tool Result:', JSON.stringify(toolResult, null, 2));

            if (toolResult && toolResult.apps) {
                console.log(`[TEST] SUCCESS! Retrieved ${toolResult.apps.length} apps from remote API (inside Docker).`);
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
    console.error('[TEST] Timeout waiting for response. Container might be unresponsive.');
    serverProcess.kill();
    process.exit(1);
}, 10000);
