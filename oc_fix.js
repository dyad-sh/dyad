process.chdir('C:\\Users\\Wise AI\\joycreate\\JoyCreate');
const WebSocket = require('./node_modules/ws');
const uuid = require('./node_modules/uuid/dist/cjs/index.js').v4;
const tok = '7515c668531c06e2fd0be30e021a71e2a10b0a8f7d235cf5';

console.log('Connecting to ws://127.0.0.1:18790 ...');
const ws = new WebSocket('ws://127.0.0.1:18790', {
  headers: { 'Origin': 'http://127.0.0.1:18790' }
});

ws.on('open', () => {
  console.log('WS open');
  ws.send(JSON.stringify({
    type: 'req', method: 'connect', id: uuid(),
    params: {
      client: { id: 'openclaw-control-ui', displayName: 'ModelFix', mode: 'webchat', version: 'dev', platform: 'electron' },
      auth: { token: tok },
      minProtocol: 3, maxProtocol: 3,
      role: 'operator', scopes: ['operator.admin']
    }
  }));
});

let step = 0;
ws.on('message', (data) => {
  const s = data.toString();
  console.log('MSG[' + step + ']:', s.substring(0, 600));
  step++;

  if (step === 2) {
    // After challenge + connect response, send config.get
    console.log('Sending config.get...');
    ws.send(JSON.stringify({ type: 'req', method: 'config.get', id: uuid(), params: { path: 'agents.defaults.model.primary' } }));
  } else if (step === 3) {
    // After config.get response, send config.set
    console.log('Sending config.set...');
    ws.send(JSON.stringify({
      type: 'req', method: 'config.set', id: uuid(),
      params: { path: 'agents.defaults.model.primary', value: 'ollama/llama3.1:8b-instruct-q4_K_M' }
    }));
  } else if (step === 4) {
    // Verify
    console.log('Sending verify config.get...');
    ws.send(JSON.stringify({ type: 'req', method: 'config.get', id: uuid(), params: { path: 'agents.defaults.model.primary' } }));
  } else if (step === 5) {
    console.log('All done. Closing.');
    ws.close();
    process.exit(0);
  }
});

ws.on('error', (e) => { console.error('WS ERROR:', e.message); process.exit(1); });
ws.on('close', (code, reason) => { console.log('WS closed:', code, reason.toString()); });
setTimeout(() => { console.log('Timeout - closing'); ws.close(); process.exit(0); }, 10000);
