# Bastilla_OS_Ollama

**Status: migration planning only.** This repository currently contains no
full application or GUI. It now includes a small, standalone Ollama status
diagnostic; this is not the migrated BastillaOS application. See
[MIGRATION.md](MIGRATION.md) for the audited baseline, blockers, and safe next
steps.

## Local Ollama status diagnostic

Requires Node.js 20 or newer. Run `npm test` for offline tests. To start the
diagnostic, optionally set `OLLAMA_HOST` (local HTTP only), `OLLAMA_MODEL`, and
`PORT`, then run `npm start`. The server binds only to `127.0.0.1`; do not
change this to a public interface. Query `http://127.0.0.1:3000/api/ai/status`
to check service reachability, model presence, and Ollama-reported loaded-model
VRAM details. The diagnostic does not install Ollama or models, and reports
resource details as unavailable if Ollama cannot provide them. It does not
measure total host CPU or RAM usage.