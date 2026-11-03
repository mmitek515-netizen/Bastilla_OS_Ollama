import { createServer as createHttpServer } from 'node:http';

const DEFAULT_OLLAMA_HOST = 'http://127.0.0.1:11434';
const TIMEOUT_MS = 2500;

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
    throw new Error('OLLAMA_HOST must be a local HTTP address.');
  }
  return url;
}

async function getJson(fetchImpl, url) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) return { ok: false };
  try {
    return { ok: true, data: await response.json() };
  } catch {
    return { ok: false };
  }
}

export async function getOllamaStatus({
  ollamaHost = DEFAULT_OLLAMA_HOST,
  model = '',
  fetchImpl = fetch,
} = {}) {
  let base;
  try {
    base = localOllamaUrl(ollamaHost);
  } catch {
    return {
      service: 'invalid_configuration',
      error: 'OLLAMA_HOST must point to a local HTTP address.',
      model: { name: model || null, status: 'unknown' },
      resources: { status: 'unknown' },
      installedModels: [],
    };
  }

  let tagsResponse;
  try {
    tagsResponse = await getJson(fetchImpl, new URL('/api/tags', base));
  } catch {
    return {
      service: 'unreachable',
      error: 'Could not connect to Ollama at the configured local address.',
      model: { name: model || null, status: 'unknown' },
      resources: { status: 'unknown' },
      installedModels: [],
    };
  }

  const tags = tagsResponse.data;
  if (!tagsResponse.ok || !Array.isArray(tags?.models)) {
    return {
      service: 'error',
      error: 'Ollama returned an invalid response while listing models.',
      model: { name: model || null, status: 'unknown' },
      resources: { status: 'unknown' },
      installedModels: [],
    };
  }

  const installedModels = tags.models
    .filter((entry) => entry && typeof entry.name === 'string')
    .map((entry) => ({ name: entry.name, sizeBytes: Number.isFinite(entry.size) ? entry.size : null }));
  const selectedModel = installedModels.find((entry) => entry.name === model);
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
    model: { name: model || null, status: modelStatus },
    resources,
    installedModels,
  };
}

export function createStatusServer(options = {}) {
  const handler = async (request, response) => {
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.setHeader('x-content-type-options', 'nosniff');

    if (request.method !== 'GET' || request.url !== '/api/ai/status') {
      response.writeHead(request.method === 'GET' ? 404 : 405);
      response.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    const status = await getOllamaStatus(options);
    response.writeHead(200);
    response.end(JSON.stringify(status));
  };
  return createHttpServer(handler);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('PORT must be an integer from 1 to 65535.');
    process.exitCode = 1;
  } else {
    const server = createStatusServer({
      ollamaHost: process.env.OLLAMA_HOST ?? DEFAULT_OLLAMA_HOST,
      model: process.env.OLLAMA_MODEL ?? '',
    });
    server.listen(port, '127.0.0.1', () => {
      console.log(`Local Ollama diagnostics listening at http://127.0.0.1:${port}`);
    });
  }
}
