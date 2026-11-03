import assert from 'node:assert/strict';
import test from 'node:test';
import { createStatusServer, getOllamaStatus } from '../server.mjs';

const response = (body, status = 200) => new Response(JSON.stringify(body), { status });
const host = 'http://127.0.0.1:11434';

test('reports an unavailable Ollama service without claiming it is running', async () => {
  const status = await getOllamaStatus({
    ollamaHost: host,
    model: 'gemma3:4b',
    fetchImpl: async () => { throw new TypeError('fetch failed'); },
  });

  assert.equal(status.service, 'unreachable');
  assert.equal(status.model.status, 'unknown');
  assert.deepEqual(status.installedModels, []);
});

test('distinguishes an Ollama error response from a network failure', async () => {
  const status = await getOllamaStatus({
    ollamaHost: host,
    fetchImpl: async () => response({}, 500),
  });

  assert.equal(status.service, 'error');
  assert.equal(status.model.status, 'unknown');
});

test('distinguishes an unconfigured or missing model from an installed one', async () => {
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/api/tags')) {
      return response({ models: [{ name: 'gemma3:4b', size: 1234 }] });
    }
    return response({ models: [{ name: 'gemma3:4b', size_vram: 567 }] });
  };

  const missing = await getOllamaStatus({ ollamaHost: host, model: 'absent:latest', fetchImpl });
  assert.equal(missing.service, 'available');
  assert.equal(missing.model.status, 'not_found');

  const installed = await getOllamaStatus({ ollamaHost: host, model: 'gemma3:4b', fetchImpl });
  assert.equal(installed.model.status, 'installed');
  assert.equal(installed.resources.status, 'loaded');
  assert.equal(installed.resources.sizeVramBytes, 567);

  const unconfigured = await getOllamaStatus({ ollamaHost: host, fetchImpl });
  assert.equal(unconfigured.model.status, 'not_configured');
});

test('reports resource diagnostics as unavailable when Ollama cannot list running models', async () => {
  const status = await getOllamaStatus({
    ollamaHost: host,
    model: 'gemma3:4b',
    fetchImpl: async (url) => String(url).endsWith('/api/tags')
      ? response({ models: [{ name: 'gemma3:4b', size: 1234 }] })
      : response({}, 500),
  });

  assert.equal(status.service, 'available');
  assert.equal(status.model.status, 'installed');
  assert.equal(status.resources.status, 'unavailable');
});

test('rejects non-local Ollama hosts', async () => {
  const status = await getOllamaStatus({ ollamaHost: 'http://example.com:11434' });
  assert.equal(status.service, 'invalid_configuration');
});

test('serves diagnostics only on the explicit status route', async (context) => {
  const server = createStatusServer({
    ollamaHost: host,
    fetchImpl: async () => { throw new TypeError('fetch failed'); },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));

  const address = server.address();
  assert.equal(address.address, '127.0.0.1');
  const origin = `http://127.0.0.1:${address.port}`;
  const result = await fetch(`${origin}/api/ai/status`);
  assert.equal(result.status, 200);
  assert.equal((await result.json()).service, 'unreachable');
  assert.equal((await fetch(`${origin}/`)).status, 404);
  assert.equal((await fetch(`${origin}/api/ai/status`, { method: 'POST' })).status, 405);
});
