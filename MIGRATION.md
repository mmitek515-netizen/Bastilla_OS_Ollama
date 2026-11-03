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
