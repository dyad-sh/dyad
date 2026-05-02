const WebSocket = require('ws');
const { v4: uuid } = require('uuid');
const tok = '7515c668531c06e2fd0be30e021a71e2a10b0a8f7d235cf5';
const ws = new WebSocket('ws://127.0.0.1:18789');
let step = 0;

ws.on('open', () => {
  ws.send(JSON.stringify({
    type: 'req', method: 'connect', id: uuid(),
    params: {
      client: { id: 'openclaw-control-ui', displayName: 'Config Fix', mode: 'webchat', version: 'dev', platform: 'electron' },
      auth: { token: tok },
      minProtocol: 3, maxProtocol: 3,
      role: 'operator', scopes: ['operator.admin']
    }
  }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  const s = JSON.stringify(msg);
  if (step === 0 && s.includes('"ok":true')) {
    console.log('Connected OK');
    step = 1;
    // Try to call agents.defaults - config get
    ws.send(JSON.stringify({ type: 'req', method: 'config.get', id: uuid(), params: { path: 'agents.defaults.model.primary' } }));
  } else if (step >= 1) {
    console.log('RESP:', s.substring(0, 600));
    step++;
    if (step === 2) {
      // Try config.set
      ws.send(JSON.stringify({ type: 'req', method: 'config.set', id: uuid(), params: { path: 'agents.defaults.model.primary', value: 'ollama/llama3.1:8b-instruct-q4_K_M' } }));
    } else if (step >= 3) {
      ws.close(); process.exit(0);
    }
  }
});

ws.on('error', e => console.error('ERR:', e.message));
setTimeout(() => { ws.close(); process.exit(0); }, 6000);
