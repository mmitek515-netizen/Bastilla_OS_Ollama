import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import test from 'node:test';
import { createStatusServer, getOllamaStatus } from '../server.mjs';

const response = (body, status = 200) => new Response(JSON.stringify(body), { status });
const host = 'http://127.0.0.1:11434';
const agentIds = ['Aria', 'Alex', 'Astyria', 'Aurelius'];

async function withServer(options, run) {
  const server = createStatusServer(options);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    return await run(`http://127.0.0.1:${address.port}`, server);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('reports an unavailable Ollama service without exposing the configured model', async () => {
  const status = await getOllamaStatus({
    ollamaBaseUrl: host,
    model: 'private-model-name',
    fetchImpl: async () => { throw new TypeError('fetch failed'); },
  });

  assert.equal(status.service, 'unreachable');
  assert.deepEqual(status.model, { configured: true, status: 'unknown' });
  assert.equal(JSON.stringify(status).includes('private-model-name'), false);
});

test('distinguishes model configuration, installed state, and loaded resources', async () => {
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/api/tags')) {
      return response({ models: [{ name: 'private-model-name', size: 1234 }] });
    }
    return response({ models: [{ name: 'private-model-name', size_vram: 567 }] });
  };
  const options = { ollamaBaseUrl: host, model: 'private-model-name', fetchImpl };
  const installed = await getOllamaStatus(options);
  assert.equal(installed.service, 'available');
  assert.equal(installed.model.status, 'installed');
  assert.equal(installed.resources.status, 'loaded');
  assert.equal(JSON.stringify(installed).includes('private-model-name'), false);

  const missing = await getOllamaStatus({ ...options, model: 'absent:latest' });
  assert.equal(missing.model.status, 'not_found');
  const unconfigured = await getOllamaStatus({ ...options, model: '' });
  assert.equal(unconfigured.model.status, 'not_configured');
});

test('reports resource diagnostics as unavailable when Ollama cannot list running models', async () => {
  const status = await getOllamaStatus({
    ollamaBaseUrl: host,
    model: 'gemma3:4b',
    fetchImpl: async (url) => String(url).endsWith('/api/tags')
      ? response({ models: [{ name: 'gemma3:4b' }] })
      : response({}, 500),
  });
  assert.equal(status.resources.status, 'unavailable');
});

test('rejects remote Ollama endpoints and malformed API responses', async () => {
  const invalid = await getOllamaStatus({ ollamaBaseUrl: 'http://example.com:11434' });
  assert.equal(invalid.service, 'invalid_configuration');
  const malformed = await getOllamaStatus({
    ollamaBaseUrl: host,
    fetchImpl: async () => response({ models: 'invalid' }),
  });
  assert.equal(malformed.service, 'error');
});

test('proxies streamed chat with server-selected model and bounded conversation history', async () => {
  let upstreamRequest;
  const fetchImpl = async (url, init) => {
    if (String(url).endsWith('/api/chat')) {
      upstreamRequest = { url: String(url), body: JSON.parse(init.body), signal: init.signal };
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"model":"hidden-model","message":{"role":"assistant","content":"Hello"},"done":false}\n'));
          controller.enqueue(new TextEncoder().encode('{"model":"hidden-model","message":{"role":"assistant","content":" there"},"done":true}\n'));
          controller.close();
        },
      }), { status: 200 });
    }
    throw new Error('unexpected upstream URL');
  };

  await withServer({ ollamaBaseUrl: host, model: 'hidden-model', fetchImpl }, async (origin) => {
    const result = await fetch(`${origin}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello!' },
        { role: 'user', content: 'Follow-up question' },
      ] }),
    });
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('content-type'), 'application/x-ndjson; charset=utf-8');
    const chunks = (await result.text()).trim().split('\n').map((line) => JSON.parse(line));
    assert.deepEqual(chunks, [
      { content: 'Hello', done: false },
      { content: ' there', done: true },
    ]);
  });

  assert.equal(upstreamRequest.url, `${host}/api/chat`);
  assert.equal(upstreamRequest.body.model, 'hidden-model');
  assert.equal(upstreamRequest.body.stream, true);
  assert.deepEqual(upstreamRequest.body.messages, [
    { role: 'user', content: 'Hi' },
    { role: 'assistant', content: 'Hello!' },
    { role: 'user', content: 'Follow-up question' },
  ]);
});

test('retries a refused local connection once before returning a friendly error', async () => {
  let attempts = 0;
  const fetchImpl = async () => {
    attempts += 1;
    if (attempts === 1) {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    }
    return response({ error: 'model "missing-model" not found' }, 404);
  };
  await withServer({ ollamaBaseUrl: host, model: 'missing-model', fetchImpl }, async (origin) => {
    const result = await fetch(`${origin}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello' }] }),
    });
    assert.equal(result.status, 503);
    assert.equal((await result.json()).error.code, 'model_not_found');
  });
  assert.equal(attempts, 2);
});

test('maps Ollama model and resource failures to actionable errors', async () => {
  await withServer({
    ollamaBaseUrl: host,
    model: 'missing-model',
    fetchImpl: async () => response({ error: 'model "missing-model" not found' }, 404),
  }, async (origin) => {
    const result = await fetch(`${origin}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello' }] }),
    });
    assert.equal(result.status, 503);
    assert.equal((await result.json()).error.code, 'model_not_found');
  });
});

test('maps memory exhaustion to an actionable error', async () => {
  await withServer({
    ollamaBaseUrl: host,
    model: 'large-model',
    fetchImpl: async () => response({ error: 'CUDA out of memory' }, 500),
  }, async (origin) => {
    const result = await fetch(`${origin}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello' }] }),
    });
    assert.equal((await result.json()).error.code, 'out_of_memory');
  });
});

test('reports an interrupted Ollama response instead of accepting partial text', async () => {
  await withServer({
    ollamaBaseUrl: host,
    model: 'test-model',
    fetchImpl: async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"message":{"content":"partial"},"done":false}\n'));
        controller.close();
      },
    }), { status: 200 }),
  }, async (origin) => {
    const result = await fetch(`${origin}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello' }] }),
    });
    const chunks = (await result.text()).trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(chunks.at(-1).error.code, 'incomplete_stream');
  });
});

test('returns a timeout event if Ollama times out during streaming', async () => {
  const fetchImpl = async (_url, init) => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"message":{"content":"partial"},"done":false}\n'));
      init.signal.addEventListener('abort', () => controller.error(init.signal.reason), { once: true });
    },
  }));
  await withServer({
    ollamaBaseUrl: host,
    model: 'test-model',
    chatTimeoutMs: 20,
    fetchImpl,
  }, async (origin) => {
    const result = await fetch(`${origin}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Wait' }] }),
    });
    const chunks = (await result.text()).trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(chunks.at(-1).error.code, 'timeout');
  });
});

test('does not contact Ollama when the configured model is absent', async () => {
  let contacted = false;
  await withServer({ ollamaBaseUrl: host, fetchImpl: async () => { contacted = true; } }, async (origin) => {
    const result = await fetch(`${origin}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello' }] }),
    });
    assert.equal(result.status, 503);
    assert.equal((await result.json()).error.code, 'model_not_configured');
  });
  assert.equal(contacted, false);
});

test('rejects cross-origin browser chat requests before contacting Ollama', async () => {
  let contacted = false;
  await withServer({
    ollamaBaseUrl: host,
    model: 'test-model',
    fetchImpl: async () => { contacted = true; },
  }, async (origin) => {
    const result = await fetch(`${origin}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://attacker.example' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello' }] }),
    });
    assert.equal(result.status, 403);
  });
  assert.equal(contacted, false);
});

test('does not send messages to disconnected original agents and logs blocked attempts without content', async () => {
  await withServer({}, async (origin) => {
    const status = await (await fetch(`${origin}/api/agents/status`)).json();
    assert.deepEqual(status.agents.map((agent) => agent.id), agentIds);
    assert.ok(status.agents.every((agent) => agent.status === 'agent_disconnected'));

    const result = await fetch(`${origin}/api/agents/message`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent: 'all', message: 'do not persist this secret text' }),
    });
    assert.equal(result.status, 503);
    assert.equal((await result.json()).error.code, 'agent_disconnected');
    const logs = await (await fetch(`${origin}/api/agents/logs`)).json();
    assert.deepEqual(logs.logs.map((entry) => entry.agent), agentIds);
    assert.ok(logs.logs.every((entry) => entry.delivery === 'not_attempted'));
    assert.equal(JSON.stringify(logs).includes('do not persist'), false);
  });
});

test('serves the responsive UI locally with a restrictive content security policy', async () => {
  await withServer({}, async (origin) => {
    const result = await fetch(origin);
    assert.equal(result.status, 200);
    assert.match(result.headers.get('content-security-policy'), /default-src 'self'/);
    assert.match(result.headers.get('content-security-policy'), /connect-src 'self'/);
    const html = await result.text();
    assert.match(html, /ORIGINAL AGENTS/);
    assert.match(html, /Local Ollama/);
    const styles = await (await fetch(`${origin}/styles.css`)).text();
    assert.match(styles, /max-width: 760px/);
    assert.match(styles, /max-width: 380px/);
    assert.equal(styles.includes('fonts.googleapis.com'), false);
  });
});

test('cancels an active upstream response stream when the browser disconnects', async () => {
  let upstreamSignal;
  let firstChunkReceived;
  const firstChunk = new Promise((resolve) => { firstChunkReceived = resolve; });
  const fetchImpl = async (_url, init) => {
    upstreamSignal = init.signal;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"message":{"content":"partial"},"done":false}\n'));
        init.signal.addEventListener('abort', () => controller.error(init.signal.reason), { once: true });
      },
    });
    return new Response(stream, { status: 200 });
  };
  const server = createStatusServer({ ollamaBaseUrl: host, model: 'test-model', fetchImpl });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const clientRequest = httpRequest({
      host: '127.0.0.1',
      port,
      method: 'POST',
      path: '/api/chat',
      headers: { 'content-type': 'application/json' },
    });
    clientRequest.on('error', () => {});
    clientRequest.on('response', (clientResponse) => {
      clientResponse.once('data', () => {
        clientResponse.destroy();
        firstChunkReceived();
      });
    });
    clientRequest.end(JSON.stringify({ messages: [{ role: 'user', content: 'Cancel me' }] }));
    await firstChunk;
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(upstreamSignal.aborted, true);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
