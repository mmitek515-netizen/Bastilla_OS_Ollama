const messagesElement = document.querySelector('#messages');
const form = document.querySelector('#chat-form');
const input = document.querySelector('#message-input');
const sendButton = document.querySelector('#send-button');
const stopButton = document.querySelector('#stop-button');
const channelButtons = [...document.querySelectorAll('[data-channel]')];
const conversation = [];
const MAX_CONTEXT_MESSAGES = 40;
const MAX_CONTEXT_CHARS = 24_000;
let currentChannel = 'ollama';
let activeRequest;
let toastTimer;

function showToast(message) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 3500);
}

function addMessage(role, text = '', error = false) {
  const welcome = messagesElement.querySelector('.welcome-message');
  welcome?.remove();
  const row = document.createElement('div');
  row.className = `message ${role}`;
  const mark = document.createElement('span');
  mark.className = 'message-mark';
  mark.textContent = role === 'user' ? 'Y' : 'O';
  const content = document.createElement('div');
  content.className = `message-body${error ? ' error' : ''}`;
  content.textContent = text;
  row.append(mark, content);
  messagesElement.append(row);
  messagesElement.scrollTop = messagesElement.scrollHeight;
  return content;
}

function setBusy(busy) {
  sendButton.disabled = busy;
  stopButton.hidden = !busy;
  input.disabled = busy;
}

function showDisconnected(channel) {
  messagesElement.replaceChildren();
  const panel = document.createElement('div');
  panel.className = 'disconnected-panel';
  const eyebrow = document.createElement('p');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = 'AGENT_DISCONNECTED';
  const title = document.createElement('h3');
  title.textContent = `${channel === 'all' ? 'Original agents' : channel} unavailable`;
  const detail = document.createElement('p');
  detail.textContent = 'No verified original-agent API is configured. Messages are not sent to Ollama as this identity and no simulated reply will be shown.';
  const attemptButton = document.createElement('button');
  attemptButton.type = 'button';
  attemptButton.textContent = 'Log blocked delivery attempt';
  attemptButton.addEventListener('click', () => logAgentAttempt(channel));
  const logButton = document.createElement('button');
  logButton.type = 'button';
  logButton.textContent = 'View local delivery log';
  logButton.addEventListener('click', () => void showAgentLogs(panel));
  const log = document.createElement('pre');
  log.className = 'agent-log';
  log.hidden = true;
  log.setAttribute('aria-live', 'polite');
  panel.append(eyebrow, title, detail, attemptButton, logButton, log);
  messagesElement.append(panel);
}

async function showAgentLogs(panel) {
  const log = panel.querySelector('.agent-log');
  try {
    const response = await fetch('/api/agents/logs', { cache: 'no-store' });
    const result = await response.json();
    log.textContent = result.logs.length
      ? result.logs.map((entry) => `${entry.time} · ${entry.agent} · ${entry.status} · ${entry.delivery}`).join('\n')
      : 'No blocked delivery attempts in this server session.';
    log.hidden = false;
  } catch {
    showToast('Could not read the local delivery log.');
  }
}

async function logAgentAttempt(channel) {
  const message = input.value.trim() || 'Connectivity check';
  try {
    const response = await fetch('/api/agents/message', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent: channel, message }),
    });
    const result = await response.json();
    if (result.error?.code === 'agent_disconnected') {
      showToast('No message sent. The blocked attempt was recorded locally.');
      const panel = messagesElement.querySelector('.disconnected-panel');
      if (panel) await showAgentLogs(panel);
    } else {
      showToast(result.error || 'The attempt could not be recorded.');
    }
    await loadAgentStatus();
  } catch {
    showToast('Could not reach the local app to record this attempt.');
  }
}

function selectChannel(channel) {
  if (activeRequest) activeRequest.abort();
  currentChannel = channel;
  for (const button of channelButtons) {
    const active = button.dataset.channel === channel;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  const ollama = channel === 'ollama';
  document.querySelector('#chat-title').textContent = ollama ? 'Local Ollama' : channel === 'all' ? 'All original agents' : channel;
  document.querySelector('#chat-eyebrow').textContent = ollama ? 'LOCAL MODEL' : 'ORIGINAL AGENT';
  document.querySelector('#history-label').textContent = ollama ? 'This tab · private history' : 'Original agent channel';
  document.querySelector('#composer-note').textContent = ollama
    ? 'Enter to send · Shift + Enter for a new line'
    : 'Send attempts are logged; no agent API is configured';
  input.placeholder = ollama ? 'Ask your local model anything…' : 'Message not sent: original API unavailable';
  input.disabled = !ollama;
  sendButton.disabled = !ollama;
  stopButton.hidden = true;
  if (!ollama) showDisconnected(channel);
  else renderConversation();
}

function renderConversation() {
  messagesElement.replaceChildren();
  if (!conversation.length) {
    const welcome = document.createElement('div');
    welcome.className = 'welcome-message';
    welcome.innerHTML = '<span class="welcome-mark" aria-hidden="true">✳</span><p class="eyebrow">A QUIETER KIND OF AI</p><h3>Start with a question.</h3><p>Your conversation stays in this tab and is sent only to your configured local Ollama.</p><div class="suggestions"><button type="button" class="suggestion">Help me think through an idea</button><button type="button" class="suggestion">Summarize what we discussed</button></div>';
    messagesElement.append(welcome);
    bindSuggestions();
    return;
  }
  for (const message of conversation) addMessage(message.role, message.content);
}

function bindSuggestions() {
  for (const button of messagesElement.querySelectorAll('.suggestion')) {
    button.addEventListener('click', () => {
      input.value = button.textContent;
      input.focus();
    });
  }
}

function removePendingTurn() {
  conversation.splice(-2, 2);
}

function trimConversation(nextMessage) {
  const maxHistoryChars = MAX_CONTEXT_CHARS - nextMessage.length;
  while (conversation.length > MAX_CONTEXT_MESSAGES - 2
    || conversation.reduce((total, message) => total + message.content.length, 0) > maxHistoryChars) {
    conversation.splice(0, 2);
  }
}

function applyError(code, message) {
  const messages = {
    connection_refused: 'Ollama is not reachable at its configured local address. Start it locally, then refresh status.',
    model_not_found: 'The configured model is not installed in Ollama.',
    out_of_memory: 'Ollama ran out of memory. Stop other workloads or choose a smaller installed model.',
    timeout: 'The local model took too long to respond. Try again or choose a smaller model.',
    incomplete_stream: 'Ollama ended the response before completion. Try again.',
    model_not_configured: 'No model is configured. Set OLLAMA_MODEL on the server to an installed model.',
    agent_disconnected: 'No message was sent. The original agent API is not configured.',
  };
  return messages[code] || message || 'The local request failed.';
}

async function sendOllamaMessage(text) {
  trimConversation(text);
  conversation.push({ role: 'user', content: text });
  addMessage('user', text);
  const responseBody = addMessage('assistant');
  const assistantMessage = { role: 'assistant', content: '' };
  conversation.push(assistantMessage);
  const request = new AbortController();
  activeRequest = request;
  setBusy(true);

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: conversation.slice(0, -1) }),
      signal: request.signal,
    });
    if (!response.ok) {
      const result = await response.json();
      const error = result.error || {};
      const friendly = applyError(error.code, error.message);
      responseBody.textContent = friendly;
      responseBody.classList.add('error');
      removePendingTurn();
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    let failure = null;
    while (true) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split('\n');
      pending = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const chunk = JSON.parse(line);
        if (chunk.error) {
          failure = chunk.error;
          break;
        }
        assistantMessage.content += chunk.content || '';
        responseBody.textContent = assistantMessage.content;
        messagesElement.scrollTop = messagesElement.scrollHeight;
      }
      if (failure || done) break;
    }
    if (failure) {
      responseBody.textContent = applyError(failure.code, failure.message);
      responseBody.classList.add('error');
      removePendingTurn();
    }
    if (!assistantMessage.content && !failure && !request.signal.aborted) {
      responseBody.textContent = 'The model returned an empty response.';
      responseBody.classList.add('error');
      removePendingTurn();
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      if (assistantMessage.content) responseBody.textContent = `${assistantMessage.content}\n\n[Response stopped]`;
      else {
        responseBody.textContent = 'Response stopped.';
        removePendingTurn();
      }
    } else {
      responseBody.textContent = 'Could not reach the local app. Check that it is still running.';
      responseBody.classList.add('error');
      removePendingTurn();
    }
  } finally {
    activeRequest = null;
    setBusy(false);
    input.focus();
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text || currentChannel === 'ollama' && activeRequest) return;
  if (currentChannel !== 'ollama') {
    void logAgentAttempt(currentChannel);
    return;
  }
  input.value = '';
  void sendOllamaMessage(text);
});

input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});
stopButton.addEventListener('click', () => activeRequest?.abort());
document.querySelector('#clear-chat').addEventListener('click', () => {
  conversation.splice(0);
  if (currentChannel === 'ollama') renderConversation();
  else showDisconnected(currentChannel);
});
document.querySelector('#refresh-status').addEventListener('click', () => void loadStatus());
for (const button of channelButtons) {
  button.addEventListener('click', () => selectChannel(button.dataset.channel));
}

async function loadStatus() {
  const label = document.querySelector('#service-label');
  const detail = document.querySelector('#service-detail');
  const dot = document.querySelector('#service-dot');
  try {
    const response = await fetch('/api/ai/status', { cache: 'no-store' });
    const status = await response.json();
    const available = status.service === 'available';
    dot.classList.toggle('ok', available);
    dot.classList.toggle('bad', !available);
    label.textContent = available ? 'Ollama service connected' : status.service === 'unreachable' ? 'Ollama not reachable' : 'Ollama needs attention';
    detail.textContent = status.model.status === 'not_found'
      ? 'Configured model was not found. Check the server configuration.'
      : status.model.status === 'not_configured'
        ? 'No model is configured on the server.'
        : status.model.status === 'unknown'
          ? status.error || 'Model status could not be verified.'
          : status.resources.status === 'loaded'
            ? 'Configured model is installed and loaded.'
            : 'Configured model is installed; it may load when you send a message.';
    document.querySelector('#ollama-indicator').classList.toggle('ok', available);
    document.querySelector('#composer-note').textContent = available
      ? 'Enter to send · Shift + Enter for a new line'
      : 'Ollama must be running locally to chat';
  } catch {
    dot.classList.add('bad');
    label.textContent = 'Local app unavailable';
    detail.textContent = 'Could not read the local status endpoint.';
  }
}

async function loadAgentStatus() {
  try {
    const response = await fetch('/api/agents/status', { cache: 'no-store' });
    const status = await response.json();
    const connected = status.agents.filter((agent) => agent.status !== 'agent_disconnected').length;
    document.querySelector('#agent-count').textContent = `${connected}/${status.agents.length} connected`;
    for (const agent of status.agents) {
      const button = document.querySelector(`[data-channel="${agent.id}"]`);
      button?.querySelector('small')?.replaceChildren(document.createTextNode(`Original agent · ${agent.status === 'agent_disconnected' ? 'offline' : 'online'}`));
    }
  } catch {
    document.querySelector('#agent-count').textContent = 'Status unavailable';
  }
}

for (const channel of channelButtons) {
  if (channel.dataset.channel === 'ollama') continue;
  channel.addEventListener('click', () => {
    input.disabled = false;
    sendButton.disabled = false;
    document.querySelector('#composer-note').textContent = 'Send attempts are logged; no agent API is configured';
  });
}

bindSuggestions();
void loadStatus();
void loadAgentStatus();
