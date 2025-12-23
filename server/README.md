# Dyad Web Server

## Development

```bash
cd server
npm install
npm run dev
```

The server will start at `http://localhost:3007`.

## Environment Variables

Create a `.env` file in the `server` directory:

```env
PORT=3007
HOST=0.0.0.0
DATA_DIR=./data
CORS_ORIGIN=http://localhost:5173

# AI Provider Keys
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_GENERATIVE_AI_API_KEY=...
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/health/ready` | GET | Readiness check |
| `/api/apps` | GET, POST | List/Create apps |
| `/api/apps/:id` | GET, PUT, DELETE | Get/Update/Delete app |
| `/api/chats` | GET, POST | List/Create chats |
| `/api/chats/:id` | GET, DELETE | Get/Delete chat |
| `/api/settings` | GET, PUT | Get/Update settings |

## WebSocket

Chat streaming is available at `ws://localhost:3007/ws/chat`.

### Message Format

```json
// Start stream
{ "type": "start_stream", "chatId": 1, "messages": [...], "model": "gpt-4o" }

// Cancel stream
{ "type": "cancel_stream", "requestId": "uuid" }
```

## Production

```bash
npm run build
npm start
```

Or use Docker:

```bash
docker-compose up -d
```
