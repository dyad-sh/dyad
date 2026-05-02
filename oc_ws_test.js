const WebSocket = require('ws');
const { v4: uuid } = require('uuid');
const tok = '7515c668531c06e2fd0be30e021a71e2a10b0a8f7d235cf5';
const ws = new WebSocket('ws://127.0.0.1:18789');
let connected = false;

ws.on('open', () => {
  ws.send(JSON.stringify({
    type: 'req', method: 'connect', id: uuid(),
    params: {
      client: { id: 'openclaw-control-ui', displayName: 'Config Fix', mode: 'webchat', version: '1.0', platform: 'node' },
      auth: { token: tok },
      minProtocol: 3, maxProtocol: 3,
      role: 'user', scopes: ['user.read', 'user.write']
    }
  }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  const s = JSON.stringify(msg).substring(0, 400);
  console.log('MSG:', s);
  if (!connected && (s.includes('"connected"') || s.includes('"result"'))) {
    connected = true;
    ws.send(JSON.stringify({ type: 'req', method: 'commands.list', id: uuid(), params: {} }));
  }
});

ws.on('error', e => console.error('ERR:', e.message));
setTimeout(() => { ws.close(); process.exit(0); }, 5000);
