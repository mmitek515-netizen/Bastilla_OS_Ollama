import { createServer as createHttpServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
const MAX_BODY_BYTES = 64 * 1024;
const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 8_000;
const MAX_TOTAL_CHARS = 24_000;
const CHAT_TIMEOUT_MS = 10 * 60 * 1000;
const AGENTS = ['Aria', 'Alex', 'Astyria', 'Aurelius'];
const APP_DIR = fileURLToPath(new URL('.', import.meta.url));
const STATIC_FILES = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
]);

function localOllamaUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== 'http:'
    || !['127.0.0.1', 'localhost'].includes(url.hostname)
    || url.username
    || url.password
    || (url.pathname !== '/' && url.pathname !== '')
    || url.search
    || url.hash
  ) {
    throw new Error('OLLAMA_BASE_URL must be a local HTTP address.');
  }
  return url;
}

function modelConfig(options) {
  return {
    baseUrl: options.ollamaBaseUrl ?? options.ollamaHost ?? DEFAULT_OLLAMA_BASE_URL,
    model: options.model ?? '',
  };
}

function friendlyOllamaError(status, detail = '') {
  const text = detail.toLowerCase();
  if (status === 404 || /model .* not found|model_not_found/.test(text)) {
    return { code: 'model_not_found', message: 'The configured Ollama model is not installed.' };
  }
  if (/out of memory|cuda.*alloc|memory allocation|failed to allocate.*memory/.test(text)) {
    return { code: 'out_of_memory', message: 'Ollama ran out of memory while loading or generating the model.' };
  }
  return { code: 'ollama_error', message: 'Ollama could not complete the request.' };
}

function connectionError(error) {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
    return { code: 'timeout', message: 'Ollama did not respond before the request timed out.' };
  }
  return { code: 'connection_refused', message: 'Could not connect to Ollama at the configured local address.' };
}

async function writeStreamChunk(response, chunk) {
  if (response.destroyed) return false;
  if (response.write(`${JSON.stringify(chunk)}\n`)) return true;
  await new Promise((resolveDrain) => {
    const cleanup = () => {
      response.off('drain', cleanup);
      response.off('close', cleanup);
      resolveDrain();
    };
    response.once('drain', cleanup);
    response.once('close', cleanup);
  });
  return !response.destroyed;
}

function isLoopbackHost(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(`http://${value}`);
    return ['127.0.0.1', 'localhost'].includes(url.hostname)
      && !url.username
      && !url.password
      && (url.pathname === '/' || url.pathname === '')
      && !url.search
      && !url.hash;
  } catch {
    return false;
  }
}

function isSameLocalOrigin(request) {
  const host = request.headers.host;
  if (!isLoopbackHost(host)) return false;
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  try {
    const url = new URL(origin);
    return url.protocol === 'http:'
      && ['127.0.0.1', 'localhost'].includes(url.hostname)
      && url.host === host;
  } catch {
    return false;
  }
}

async function getJson(fetchImpl, url) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(2500) });
  if (!response.ok) return { ok: false };
  try {
    return { ok: true, data: await response.json() };
  } catch {
    return { ok: false };
  }
}

export async function getOllamaStatus(options = {}) {
  const { baseUrl: ollamaBaseUrl, model } = modelConfig(options);
  const fetchImpl = options.fetchImpl ?? fetch;
  let base;
  try {
    base = localOllamaUrl(ollamaBaseUrl);
  } catch {
    return {
      service: 'invalid_configuration',
      error: 'OLLAMA_BASE_URL must point to a local HTTP address.',
      model: { configured: Boolean(model), status: 'unknown' },
      resources: { status: 'unknown' },
    };
  }

  let tagsResponse;
  try {
    tagsResponse = await getJson(fetchImpl, new URL('/api/tags', base));
  } catch {
    return {
      service: 'unreachable',
      error: 'Could not connect to Ollama at the configured local address.',
      model: { configured: Boolean(model), status: 'unknown' },
      resources: { status: 'unknown' },
    };
  }

  const tags = tagsResponse.data;
  if (!tagsResponse.ok || !Array.isArray(tags?.models)) {
    return {
      service: 'error',
      error: 'Ollama returned an invalid response while listing models.',
      model: { configured: Boolean(model), status: 'unknown' },
      resources: { status: 'unknown' },
    };
  }

  const selectedModel = model
    ? tags.models.find((entry) => entry?.name === model)
    : undefined;
  const modelStatus = !model ? 'not_configured' : selectedModel ? 'installed' : 'not_found';
  let resources = { status: 'unknown' };
  if (selectedModel) {
    try {
      const runningResponse = await getJson(fetchImpl, new URL('/api/ps', base));
      const running = runningResponse.data;
      if (runningResponse.ok && Array.isArray(running?.models)) {
        const loadedModel = running.models.find((entry) => entry?.name === model);
        resources = loadedModel
          ? {
            status: 'loaded',
            sizeVramBytes: Number.isFinite(loadedModel.size_vram) ? loadedModel.size_vram : null,
          }
          : { status: 'not_loaded' };
      } else {
        resources = { status: 'unavailable' };
      }
    } catch {
      resources = { status: 'unavailable' };
    }
  }

  return {
    service: 'available',
    model: { configured: Boolean(model), status: modelStatus },
    resources,
  };
}

async function readJsonBody(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) {
      const error = new Error('Request body is too large.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Request body must be valid JSON.');
    error.statusCode = 400;
    throw error;
  }
}

function validateMessages(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some((key) => key !== 'messages')
    || !Array.isArray(body.messages)
    || body.messages.length === 0
    || body.messages.length > MAX_MESSAGES) {
    return false;
  }
  let total = 0;
  for (const message of body.messages) {
    if (!message || typeof message !== 'object' || Array.isArray(message)
      || Object.keys(message).some((key) => !['role', 'content'].includes(key))
      || !['user', 'assistant'].includes(message.role)
      || typeof message.content !== 'string'
      || message.content.trim().length === 0
      || message.content.length > MAX_MESSAGE_CHARS) {
      return false;
    }
    total += message.content.length;
  }
  return total <= MAX_TOTAL_CHARS && body.messages.at(-1).role === 'user';
}

async function sendJson(response, status, body) {
  response.writeHead(status);
  response.end(JSON.stringify(body));
}

async function handleChat(request, response, options) {
  let body;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    return sendJson(response, error.statusCode ?? 400, { error: error.message });
  }
  if (!validateMessages(body)) {
    return sendJson(response, 400, {
      error: 'Provide up to 40 valid user/assistant messages; the final message must be from the user.',
    });
  }

  const { baseUrl: ollamaBaseUrl, model } = modelConfig(options);
  if (!model) {
    return sendJson(response, 503, {
      error: { code: 'model_not_configured', message: 'Set OLLAMA_MODEL to an installed local model.' },
    });
  }

  let base;
  try {
    base = localOllamaUrl(ollamaBaseUrl);
  } catch {
    return sendJson(response, 503, {
      error: { code: 'invalid_configuration', message: 'OLLAMA_BASE_URL must point to a local HTTP address.' },
    });
  }

  const abortController = new AbortController();
  const timeout = setTimeout(
    () => abortController.abort(new DOMException('Request timed out', 'TimeoutError')),
    options.chatTimeoutMs ?? CHAT_TIMEOUT_MS,
  );
  response.on('close', () => {
    if (!response.writableEnded) abortController.abort(new DOMException('Client disconnected', 'AbortError'));
  });

  let upstream;
  try {
    const fetchImpl = options.fetchImpl ?? fetch;
    const url = new URL('/api/chat', base);
    const init = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, messages: body.messages, stream: true }),
      signal: abortController.signal,
    };
    try {
      upstream = await fetchImpl(url, init);
    } catch (error) {
      if (abortController.signal.aborted
        || error?.cause?.code !== 'ECONNREFUSED') {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
      if (abortController.signal.aborted) throw abortController.signal.reason;
      upstream = await fetchImpl(url, init);
    }
  } catch (error) {
    clearTimeout(timeout);
    if (abortController.signal.aborted && abortController.signal.reason?.name === 'AbortError') {
      return;
    }
    const friendly = connectionError(abortController.signal.aborted ? abortController.signal.reason : error);
    return sendJson(response, 503, { error: friendly });
  }

  if (!upstream.ok || !upstream.body) {
    clearTimeout(timeout);
    let detail = '';
    try {
      const payload = await upstream.json();
      detail = typeof payload?.error === 'string' ? payload.error : '';
    } catch {}
    return sendJson(response, 503, { error: friendlyOllamaError(upstream.status, detail) });
  }

  response.writeHead(200, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-store',
    'x-accel-buffering': 'no',
  });
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let streamFailed = false;
  let streamFinished = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const chunk = JSON.parse(line);
        if (typeof chunk.error === 'string') {
          await writeStreamChunk(response, { error: friendlyOllamaError(500, chunk.error) });
          streamFailed = true;
          break;
        }
        streamFinished ||= Boolean(chunk.done);
        if (!await writeStreamChunk(response, {
          content: typeof chunk.message?.content === 'string' ? chunk.message.content : '',
          done: Boolean(chunk.done),
        })) break;
      }
      if (done || response.destroyed || streamFailed) break;
    }
    if (pending.trim() && !response.destroyed && !streamFailed) {
      const chunk = JSON.parse(pending);
      if (typeof chunk.error === 'string') {
        await writeStreamChunk(response, { error: friendlyOllamaError(500, chunk.error) });
        streamFailed = true;
      } else {
        streamFinished ||= Boolean(chunk.done);
        await writeStreamChunk(response, {
          content: typeof chunk.message?.content === 'string' ? chunk.message.content : '',
          done: Boolean(chunk.done),
        });
      }
    }
    if (!streamFinished && !streamFailed && !response.destroyed) {
      await writeStreamChunk(response, {
        error: { code: 'incomplete_stream', message: 'Ollama ended the response before it was complete.' },
      });
    }
  } catch (error) {
    if (!response.destroyed
      && !(abortController.signal.aborted && abortController.signal.reason?.name === 'AbortError')) {
      const friendly = abortController.signal.aborted
        ? connectionError(abortController.signal.reason)
        : error instanceof SyntaxError
          ? { code: 'ollama_error', message: 'Ollama returned an invalid response stream.' }
          : connectionError(error);
      await writeStreamChunk(response, { error: friendly });
    }
  } finally {
    clearTimeout(timeout);
    if (!response.writableEnded && !response.destroyed) response.end();
    try {
      await reader.cancel();
    } catch {}
  }
}

async function serveStatic(pathname, response) {
  const entry = STATIC_FILES.get(pathname);
  if (!entry) return sendJson(response, 404, { error: 'Not found' });
  try {
    const content = await readFile(join(APP_DIR, entry[0]));
    response.writeHead(200, {
      'content-type': entry[1],
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'self'; connect-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'",
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    });
    response.end(content);
  } catch {
    sendJson(response, 500, { error: 'The application UI could not be loaded.' });
  }
}

export function createStatusServer(options = {}) {
  const logs = [];
  const server = createHttpServer(async (request, response) => {
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.setHeader('cache-control', 'no-store');
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('referrer-policy', 'no-referrer');
    if (!isLoopbackHost(request.headers.host)) {
      return sendJson(response, 403, { error: 'Local requests only.' });
    }
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;

    if (request.method === 'GET' && STATIC_FILES.has(pathname)) {
      return serveStatic(pathname, response);
    }
    if (request.method === 'GET' && pathname === '/api/ai/status') {
      return sendJson(response, 200, await getOllamaStatus(options));
    }
    if (request.method === 'GET' && pathname === '/api/agents/status') {
      return sendJson(response, 200, {
        agents: AGENTS.map((id) => ({ id, status: 'agent_disconnected', reason: 'original_agent_api_unconfigured' })),
      });
    }
    if (request.method === 'GET' && pathname === '/api/agents/logs') {
      return sendJson(response, 200, { logs: logs.slice(-50) });
    }
    if (request.method === 'POST' && pathname === '/api/agents/message') {
      if (!isSameLocalOrigin(request)) {
        return sendJson(response, 403, { error: 'Same-origin local requests only.' });
      }
      let body;
      try {
        body = await readJsonBody(request);
      } catch (error) {
        return sendJson(response, error.statusCode ?? 400, { error: error.message });
      }
      const targets = body?.agent === 'all' ? AGENTS : [body?.agent];
      if (!targets.every((agent) => AGENTS.includes(agent))
        || typeof body?.message !== 'string'
        || !body.message.trim()
        || body.message.length > MAX_MESSAGE_CHARS) {
        return sendJson(response, 400, { error: 'Provide a known agent and a message up to 8000 characters.' });
      }
      for (const agent of targets) {
        if (logs.length >= 50) logs.shift();
        logs.push({
          time: new Date().toISOString(),
          agent,
          status: 'agent_disconnected',
          reason: 'original_agent_api_unconfigured',
          delivery: 'not_attempted',
        });
      }
      return sendJson(response, 503, {
        error: {
          code: 'agent_disconnected',
          message: 'No verified API for the original agents is configured; no message was sent.',
        },
      });
    }
    if (request.method === 'POST' && pathname === '/api/chat') {
      if (!isSameLocalOrigin(request)) {
        return sendJson(response, 403, { error: 'Same-origin local requests only.' });
      }
      return handleChat(request, response, options);
    }
    if (pathname.startsWith('/api/')) {
      return sendJson(response, request.method === 'GET' ? 404 : 405, { error: 'Not found' });
    }
    return serveStatic(pathname, response);
  });
  server.agentLogs = logs;
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('PORT must be an integer from 1 to 65535.');
    process.exitCode = 1;
  } else {
    const server = createStatusServer({
      ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? process.env.OLLAMA_HOST ?? DEFAULT_OLLAMA_BASE_URL,
      model: process.env.OLLAMA_MODEL ?? '',
    });
    server.listen(port, '127.0.0.1', () => {
      console.log(`Bastilla local app listening at http://127.0.0.1:${port}`);
    });
  }
}
