require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-pro';
const TIMEOUT = parseInt(process.env.REQUEST_TIMEOUT || '30000', 10);

app.use(express.json({ limit: '256kb' }));
// Enable CORS for all routes (adjust origin in production as needed)
app.use(cors());
// Simple request logger
app.use((req, res, next) => { console.log(`${new Date().toISOString()} - ${req.method} ${req.originalUrl}`); next(); });

// Streaming proxy endpoint — relays upstream chunks to the client as text/event-stream
// Improvements: CORS friendly, abort if client disconnects, heartbeat to keep connection alive and lifecycle logging
app.post('/api/gemini_stream', async (req, res) => {
  const { message } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message required' });
  if (!GEMINI_API_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY not configured in server' });

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  // allow CORS for ease of local testing (adjust in production)
  res.setHeader('Access-Control-Allow-Origin', '*');

  let closed = false;
  // Keep the connection alive with a heartbeat
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch (e) { /* ignore */ }
  }, 15000);

  // Abort controller for upstream request
  const controller = new AbortController();
  // If client disconnects, abort the upstream request
  req.on('close', () => {
    closed = true;
    clearInterval(heartbeat);
    console.log('Client disconnected, aborting upstream request');
    try { controller.abort(); } catch (e) {}
  });

  try {
    const url = `https://generative.googleapis.com/v1beta2/models/${GEMINI_MODEL}:generateText`;
    const id = setTimeout(() => controller.abort(), TIMEOUT);

    const body = {
      prompt: { text: message },
      maxOutputTokens: 512
    };

    const upstream = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GEMINI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(id);

    if (!upstream.ok) {
      const errText = await upstream.text().catch(()=>null);
      console.error('Gemini stream failed', upstream.status, errText);
      if(!closed) res.write(`data: ${JSON.stringify({ error: 'Upstream error' })}\n\n`);
      clearInterval(heartbeat);
      return res.end();
    }

    // If upstream returns a readable body, relay chunks to client
    if(!upstream.body){
      if(!closed) res.write(`data: ${JSON.stringify({ error: 'No stream from upstream' })}\n\n`);
      clearInterval(heartbeat);
      return res.end();
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    while(true){
      const { done, value } = await reader.read();
      if(done) break;
      const chunk = decoder.decode(value, { stream: true });
      if(closed) break;
      // Send as SSE "data:" messages; clients should parse and append
      try { res.write(`data: ${JSON.stringify({ chunk })}\n\n`); } catch(e){ console.warn('Failed to write chunk to client', e && e.message); break; }
    }

    if(!closed) res.write('data: [DONE]\n\n');
    clearInterval(heartbeat);
    res.end();
  } catch (err) {
    console.error('Error in stream proxy', err && err.message);
    clearInterval(heartbeat);
    if(err.name === 'AbortError'){
      if(!closed) res.write(`data: ${JSON.stringify({ error: 'AI request timed out' })}\n\n`);
      return res.end();
    }
    if(!closed) res.write(`data: ${JSON.stringify({ error: 'Internal server error' })}\n\n`);
    res.end();
  }
});

// Legacy simple JSON proxy (non-streaming)
app.post('/api/gemini_chat', async (req, res) => {
  const { message } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message required' });
  if (!GEMINI_API_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY not configured in server' });

  try {
    // NOTE: This is an example of calling the Generative AI REST endpoint.
    // The real Gemini endpoint, request body and response shape may differ. Check Google's docs and adapt.
    const url = `https://generative.googleapis.com/v1beta2/models/${GEMINI_MODEL}:generateText`;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), TIMEOUT);

    const body = {
      // This is a simple example prompt wrapper — adapt to your use-case
      prompt: { text: message },
      maxOutputTokens: 512
    };

    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GEMINI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(id);

    if (!r.ok) {
      const errText = await r.text().catch(()=>null);
      console.error('Gemini call failed', r.status, errText);
      return res.status(502).json({ error: 'Upstream AI API error' });
    }

    const data = await r.json().catch(()=>null);
    // Try common response locations. You should inspect and adapt to actual API response.
    const reply = (data && (data.candidates && data.candidates[0] && data.candidates[0].output)) || (data && data.output && data.output[0] && data.output[0].content) || JSON.stringify(data);
    return res.json({ reply });
  } catch (err) {
    console.error('Error in proxy /api/gemini_chat', err && err.message);
    if (err.name === 'AbortError') return res.status(504).json({ error: 'AI request timed out' });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, ()=> console.log(`Gemini proxy running on http://localhost:${PORT}`));
