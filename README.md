# Bastilla OS · Local AI

A small, standalone local Ollama chat app. This repository is public and does
not contain the migrated BastillaOS application or the original agent APIs.
Aria, Alex, Astyria, and Aurelius are displayed as disconnected identities;
their messages are never forwarded to Ollama or answered by simulated agents.

## Run locally

Requires Node.js 20 or newer. Install and start Ollama separately, then
configure the model on the server:

```sh
OLLAMA_BASE_URL=http://127.0.0.1:11434 OLLAMA_MODEL=your-installed-model npm start
```

Open `http://127.0.0.1:3000`. The app binds only to `127.0.0.1`; Ollama's
address is validated as a local HTTP URL. Do not expose either service publicly.
No npm packages or paid model APIs are required. The server does not install
Ollama/models, perform privileged operations, or persist conversations. Chat
context stays in the current browser tab and is sent only to the configured
local Ollama provider, bounded to the latest 40 messages. Clear the
conversation to remove the tab's in-memory history.

If Ollama is unavailable, the configured model is missing, or Ollama reports
resource exhaustion, the UI shows an actionable error. A connection-refused
request is retried once; timeouts and generation failures are not replayed.
Streaming can be stopped; aborting the browser request cancels the upstream
Ollama request.

## Original agent/API status

The source audit found chat roles and a local deterministic command API, not
four separate remote agent services. Until the owner provides a verified API
contract, endpoint, credential provisioning method, and authorized GitHub
accounts, the app reports `agent_disconnected`. Blocked send attempts are
logged locally with agent, timestamp, and outcome only; message text is not
stored. No remote agent task dispatch, worker ID, or trace is claimed.

## Test

```sh
npm test
```

Tests use Node's built-in test runner and stub the Ollama HTTP responses; they
do not prove a live Ollama/model conversation. A real Ollama, GUI, and
Codespaces acceptance run must be completed separately before calling the
integration finished. See [MIGRATION.md](MIGRATION.md) for the audited
limitations and required next steps.
