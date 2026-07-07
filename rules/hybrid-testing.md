# Hybrid Renderer+IPC Testing

When a hybrid or chat-flow harness test passes `engine: true`, production code must read Dyad Engine/Gateway URLs at call time. If a test still logs `POST https://engine.dyad.sh/v1/... 401 (Unauthorized)`, search for module-scope `DYAD_ENGINE_URL` constants and switch those call sites to `getDyadEngineBaseUrl()`.
