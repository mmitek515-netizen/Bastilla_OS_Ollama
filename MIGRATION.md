# Synchronizacja BastillaOS — plan i źródło

**Status: przygotowanie; kod BastillaOS nie został jeszcze skopiowany.**

Źródło: `mmitek515-netizen/SVL_System`, gałąź `main`, Git tree `21e04fed96dd541d2e342db02143945ed7b8de94`.

Docelowo należy zachować:
- `bastillaos/` (Debian 13, KDE Plasma, live-build, ISO, pakiet DEB),
- `apps/bastillaos/` oraz pulpit `src/components/BastillaDashboard.tsx`,
- `src/`, `server.ts`, `svl_kernel.py` i zależności potrzebne do uruchomienia pulpitu,
- terminal, API, DATA_STORE, telemetrię, diagnostykę, snapshoty, historię, Ollamę i niezbędne moduły AI,
- `apps/without_nlp/` jako zależność pakietu, nie jako drugi pulpit,
- testy i skrypty budowania.

Nie kopiować niepowiązanych aplikacji `apps/*`, danych użytkownika, eksportów, sekretów, plików `.env` ani tokenów. Źródłowe `SVL_System` pozostaje bez zmian.

Wymagane osobne sprawdzenie zmian z wcześniejszych sesji, które nie trafiły na GitHub (m.in. terminal live/PTY, synchronizacja na żywo), oraz konfiguracji MCP, Ollama/Aria, Docker/KVM i vision. Nie oznaczać tych funkcji jako wdrożone bez testu.

**Bezpieczeństwo:** przed przeniesieniem kodu ustawić repozytorium docelowe jako prywatne. Dokumentacja źródłowa ostrzega, że lokalne API BastillaOS może wykonywać polecenia z uprawnieniami root; nie wystawiać portu 3000 publicznie bez ochrony.

## Audyt blokujący — 2026-11-03

Stan sprawdzono na gałęzi `copilot/finishing-ollama-integration`, commit
`5bfae771238d85102a08f8ca7700f2613de8fe9f`. W tym checkoutcie są tylko dwa
śledzone pliki: `README.md` i `MIGRATION.md`. Brakuje kodu aplikacji, modułu
Ollama, konfiguracji, zależności, testów i skryptów uruchomienia/budowania.
Nie ma więc czego uruchomić ani testować; nie można potwierdzić diagnostyki,
obsługi braku serwera/modelu, zużycia zasobów ani GUI.

GitHub pokazuje Issue #1 jako otwarte i PR #2 jako roboczy. Jedyny widoczny
workflow to uruchomienie Copilot Cloud Agent na powyższym commicie — nie jest
to workflow testów projektu. Nie ma wyników CI projektu do potwierdzenia.
Lokalny inwentarz nie zawiera plików `.env` ani plików konfiguracyjnych
sekretów. Odczyt alertów secret scanning został odrzucony (HTTP 403), a
CodeQL API zwróciło błąd usługi (HTTP 503); nie można zatem wnioskować, że
repozytorium nie ma alertów. Dostępnych nazw sekretów repozytorium nie
zweryfikowano; wartości sekretów nie były odczytywane.

**Bloker:** to repozytorium jest szkieletem migracji, a nie działającą
integracją. Nie należy deklarować ukończenia ani przenosić szerokiego zakresu
monolitu bez osobnego audytu kodu źródłowego i ochrony repozytorium docelowego.
Następny krok: potwierdzić prywatność repozytorium, zweryfikować wskazany tree
źródłowy, przenieść wyłącznie wymagane moduły i testy Ollama, sprawdzić
uprawnienia API oraz dopiero wtedy uruchomić testy i aplikację na rzeczywistym
commicie. Do tego czasu zakupów ani zobowiązań nie podejmować (koszt = 0).

## Minimalna diagnostyka lokalna — 2026-11-03

Dodano niezależny, lokalny endpoint `GET /api/ai/status` (`server.mjs`) oraz
testy bez zależności zewnętrznych. Serwer wiąże się wyłącznie z `127.0.0.1`,
a skonfigurowany `OLLAMA_HOST` musi być lokalnym adresem HTTP. Endpoint odróżnia
brak połączenia, brak konfiguracji modelu, brak modelu, model zainstalowany i
brak szczegółów załadowanych zasobów. Nie instaluje modeli, nie uruchamia
poleceń ani nie twierdzi, że Ollama jest dostępna. To nie jest przeniesienie
aplikacji źródłowej ani GUI; pełna migracja, pomiary hosta i weryfikacja
integracji pozostają niedokończone.

Weryfikacja w tym środowisku: Node.js `v22.23.4`; `npm test` — 6 testów
`npm start` potwierdził nasłuchiwanie na `127.0.0.1:3000`, odpowiedź
`/api/ai/status` ze stanem `unreachable` oraz 404 dla `/`. Ollama nie
nasłuchiwała pod `127.0.0.1:11434` (połączenie odrzucone). Nie uzyskano dostępu
do prywatnego GitHub Codespace, więc testów ani zrzutów ekranu z Codespaces nie
ma.

## Audyt API czterech agentów — bloker — 2026-11-03

Sprawdzono wskazane źródło `mmitek515-netizen/SVL_System` (`main`:
`c334bee86708b104a1faa9e9be162bf0faab7d40`) przez `README.md`,
`src/kernel/agents.ts`, `src/kernel/agentProtocol.ts`, `src/components/AgentCommsView.tsx`,
`server.ts` i `.env.example`. `SYSTEM_AGENTS` i protokół identyfikują Alex,
Astyria, Aria (`si_1`) i Aurelius jako role w aplikacji. README źródła mówi
wprost, że nie są osobnymi usługami autonomicznymi ani workerami w tle.
`AgentCommsView.tsx` jest częścią upstream GUI, ale nie została przeniesiona do
tego repozytorium. Nie znaleziono pliku `LICENSE` w głównym katalogu źródła;
nie skopiowano żadnego kodu upstream.
`POST /api/triad/command` buduje deterministyczne odpowiedzi z lokalnego stanu
jądra; `POST /api/triad/message` to lokalny czat Ollama/model. W źródle nie
znaleziono kontraktu zdalnego API agentów, adresów usług, tokenów per agent,
endpointu zlecania zadań do workerów ani rzeczywistych logów workerów.
Konfiguracja `.env.example` dotyczy dostawców modeli, nie API czterech agentów.

**Nie wdrożono statusów „online” ani wysyłania zadań do agentów.** Bez
autorytatywnego adresu API, specyfikacji uwierzytelniania i poświadczeń
pochodzących z zatwierdzonego źródła każda taka implementacja udawałaby
łączność. Potrzebne od właściciela: dokumentacja i adres oryginalnego API,
kontrakt zadań/logów, sposób bezpiecznego provisioningu tokenów oraz konta
GitHub, na których wolno wykonywać dozwolone działania. Sekretów nie należy
umieszczać w repozytorium ani zwracać z endpointu statusu.

Nie przenosić obecnej obsługi GitHub ze źródła jako rozwiązania uwierzytelniania:
audytowany kod zapisuje PAT w `.github_credentials.json` bez szyfrowania,
konstruuje URL Git z tokenem i nasłuchuje na `0.0.0.0`. To wymaga osobnego
przeglądu i naprawy przed jakimkolwiek użyciem; nie daje dowodu autoryzacji
użytkownika. Nie rozszerzać uprawnień ani nie uruchamiać poleceń GitHub na
niezweryfikowanych kontach.

### Dowód worker/PR/CI oraz stan w Codespaces

GitHub zgłasza PR #2 jako powiązany z Issue #1, a bieżący workflow Copilot
„Addressing comment on PR #2” (run `41640850198`) wystartował dla SHA
`93ceca4872f7e1f85a9406de23d09dabc4db521e`. Jest to dowód uruchomienia agenta
Copilot dla PR, nie dowód uruchomienia któregokolwiek z czterech agentów
źródłowych ani pełnego cyklu Issue→worker→PR→CI. Statusy PR dla tego SHA mają
`pending`, `total_count: 0`; nie ma potwierdzonych check-runów projektu.
Nie uzyskano dostępu do prywatnego GitHub Codespace. Ten cykl pozostaje
nieweryfikowany; nie należy raportować go jako zaliczonego.

### Zakup — brak zatwierdzonej oferty

Wstępnie sprawdzony Tailwind Plus „Oatmeal” ma widoczny checkout dostawcy:
https://tailwindcss.com/plus/checkout/69024fdd-55bf-4ca7-9f1f-7c1f4e7b7595
Wynik wyszukiwania oficjalnej strony wskazuje licencję Personal, płatność
jednorazową `99 USD`, a podatki są wyliczane dopiero w checkout. Nie udało się
niezależnie potwierdzić u dostawcy natychmiastowej dostępności plików, ceny
całkowitej z podatkiem ani zakresu licencji dla użycia w tym projekcie.
Produkt jest zestawem witryny marketingowej, nie gotowym panelem BastillaOS.
Dlatego **nie jest kwalifikowaną propozycją zakupu i nie jest rekomendowany do
akceptacji**; nie wykonano checkoutu ani płatności, koszt `0 USD`. Darmową
alternatywą jest zbudowanie interfejsu własnymi komponentami po migracji.
Wrócić do zakupów tylko po potwierdzeniu wszystkich wymaganych warunków.
