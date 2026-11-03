# Oryginalni agenci — zasady pracy w Bastilla_OS_Ollama

Cztery profile w `.github/agents/` zostały przeniesione **bez zmian** z oryginalnego źródła `u6930438163-code/AI_Studio_BastillaOS`: Alex, Aria, Astyria, Aurelius. Ich format `target: github-copilot` oznacza **konfiguracje GitHub Copilot custom agents**, a nie samodzielne procesy AI podłączone do repozytorium.

## Role i priorytety
- **Alex:** architektura, backend, Codespaces, API GitHub.
- **Aria:** Ollama, MCP, GPT Actions, ChatGPT/AI oraz uwierzytelnione integracje.
- **Astyria:** prawdziwe GUI, design, responsywność 320/360/412/1440 px, kanały rozmów.
- **Aurelius:** bezpieczeństwo, testy, CI, audyt, wydajność.

**Specyfika:** Repozytorium zawiera dokumentację migracji, nie pełną aplikację. Nie kopiuj sekretów ani nie publikuj na publicznym repo niezabezpieczonych API.

## Uruchomienie pracy — nie symulować
1. Dla każdego zadania wybierz odpowiedni profil custom agent w obsługiwanym interfejsie GitHub Copilot. Samo `@copilot`, przypisanie Issue i obecność pliku profilu nie potwierdza, że działa konkretny agent; wymagaj sesji/worker ID, commita, PR i logów.
2. Jeśli celem są **niezależne oryginalne procesy** z AI Studio, potrzebny jest uwierzytelniony bridge do rzeczywiście uruchomionych workerów (nie wyłącznie `GET /api/agent-tasks` z rejestru). Źródłowy rejestr nie potwierdza wykonania zadań przez LLM. Do odbioru wymagaj realnego zlecenia, potwierdzenia agenta, zmienionego pliku, PR, testów i sygnowanego źródła wyniku. Nie wpisuj niezweryfikowanych endpointów lub tokenów do kodu.
3. Dla repo z czatem: skontroluj prawdziwy Ollama provider i osobną tożsamość czterech agentów. Model z promptem roli nie zastępuje oryginalnego workera. Zawsze ujawniaj status `offline/unverified`, gdy nie można potwierdzić połączenia.
4. PR-y wyłącznie przez gałęzie, przed scaleniem wymagane działające build/test/lint i ręczny test GUI w prywatnym Codespace z logiem i screenshotem. Nie nadawaj automatycznie praw admin/root do konta GitHub: dostęp Codespaces i role repozytorium to różne uprawnienia.
5. Płatny design/GUI: najpierw konkretny URL, pełna cena, licencja i natychmiastowa dostępność. Żadnego zakupu, płatności, pobrania licencjonowanych zasobów ani auto-merge bez osobnej zgody właściciela. Nie udostępniaj sekretów.

**Warunek ukończenia:** rzeczywista poprawka kodu, potwierdzone uruchomienie i działające GUI (jeżeli projekt go potrzebuje), wiarygodne testy i status integracji wszystkich wymaganych agentów. Nie oznaczaj `completed` tylko na podstawie profili lub dokumentacji.
