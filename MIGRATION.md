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
