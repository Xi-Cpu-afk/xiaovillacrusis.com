Gemini Proxy Server (example)

This small Express app shows how to proxy chat messages from the browser to Google Gemini (or another Generative AI) without exposing API keys in the client.

Setup
1. Copy `.env.example` -> `.env` and set `GEMINI_API_KEY` and optionally `GEMINI_MODEL` and `PORT`.
2. npm install
3. npm start

Endpoints
- POST /api/gemini_chat  (body: { message: string })  -> { reply: string }
- POST /api/gemini_stream  (body: { message: string })  -> Server-Sent-Events stream of incremental { chunk } messages (SSE-style)
- GET /health  -> { ok: true }

Important
- Keep API keys server-side only. This is a minimal example and should be hardened for production (rate-limiting, auth, input validation, streaming support, logging, error handling, etc.).
- The request/response shapes shown here are illustrative. Refer to the official Gemini / Google Generative AI docs for exact API usage.
