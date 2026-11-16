# Review und Bereitstellung: Seitenschieber und Kursalarme

Basis: `9501b2972068bdaf48e1b2254a38ad3addd52029`; Branch: `codex/sidebar-alerts`. Anforderungen und Checkpoints stehen im Detailplan vom 16.11.2026.

Die unabhängige Prüfung fand drei relevante Fehler; alle wurden korrigiert und erneut geprüft:

- P1: Langsame Börsenabfragen konnten fertige Kryptobeobachtungen und anstehende Pushs blockieren. Ergebnisse werden jetzt sofort verarbeitet; Quellen und Zustellungen erhalten getrennte Zeitbudgets. Regressionstest erst fehlgeschlagen, dann erfolgreich.
- P2: Bei einer bewussten Änderung aus einer Alarmansicht wurde nur ein Feld der ursprünglichen Präferenz gespeichert. Jetzt wird die vollständige sichtbare Ansicht gespeichert. Regression prüft Kerzen/1Y/auto nach vorheriger Linienansicht.
- P2: Fokusfilter übersah sichtbare summary-Elemente und erfasste Inhalte geschlossener details-Elemente. Beide Tab-Richtungen und Verschachtelung sind abgedeckt.

Zusätzlich geprüft: alarmbezogene Kursfehler trotz gesundem Worker, entzogene Handy-Berechtigung, Zeiträume in voller Einbettung, Erhalt fremder Präferenzen bei voller Kursliste, Gerätezugriff und feste serverseitige Vault-Grenze. Die erneute unabhängige Quellenprüfung meldete keine weiteren konkreten Befunde; 15 Einstellungen-/HTTP-/Worker-Tests wurden unabhängig ausgeführt.

Abschlussprüfung: 36 Node-Tests, 111 Frontend-Tests und zwei Deno-Tests bestanden. Web-Build und .NET-Release-Build bestanden; bestehender Vite-Hinweis zum separaten öffentlichen config.js-Skript bleibt unverändert. Ein Typfehler im neuen Test wurde vor dem erfolgreichen Build korrigiert.

Browserprüfung: 390×844 mit 344×614 Chartfläche, bei geöffnetem Seitenschieber gleiche Box; 320×568 ohne Seitenüberlauf. Untere Tasten mindestens 44px hoch. Physische Safe-Area- und iOS-Abnahme bleibt offen.

Serverprüfung am 17.11.2026: bestätigtes Free-Projekt, vier angewandte Migrationen, Vault, Edge Function Version 1, ein Minuten-Cronjob mit mehreren HTTP-200-Antworten. Zehn Live-API-Prüfungen und transaktionale PostgreSQL-Prüfung bestanden; Testdaten zurückgerollt bzw. entfernt. Sechs Informationshinweise zu beabsichtigter RLS ohne öffentliche Policies; keine Warnungen aus dem Security-Advisor.

Transportgrenze: stabile Ereignis-ID und Notification-Tag ersetzen bestehende Mitteilungen; nach verlorenem HTTP-Ergebnis kann eine bereits geschlossene Mitteilung erneut erscheinen. Der dauerhafte In-App-Treffer bleibt eindeutig. Anbieterannahme beweist keine Anzeige am iPhone.

Nächster Checkpoint: Veröffentlichung der Oberfläche und gemeinsamer Test bei geschlossener App/gesperrtem iPhone. Erst dann die tatsächliche Handy-Zustellung als abgenommen markieren.
