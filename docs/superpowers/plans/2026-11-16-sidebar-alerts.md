# Seitenschieber und Hintergrundalarme – Implementation Plan

**Goal:** Den ausgewählten Seitenschieber mit dauerhaft gespeicherten Ansichten, Kerzenstandard, Einstellungen unten und echten Hintergrundalarmen umsetzen.
**Architecture:** React/CSS-Oberfläche und bestehender Chart; bisherige .NET-Daten-API bleibt erhalten. Alarmregeln/Ereignisse werden gerätebezogen in Supabase gespeichert und per Cron/Edge Function geprüft; Systemmitteilungen über Web Push.
**Spec:** ../specs/2026-11-16-sidebar-alerts-design.md. Nutzer wählte den Seitenschieber und bestätigte ausdrücklich Alarme bei geschlossener App.

## Global Constraints

- Kein kostenpflichtiger Dienst/Tarifwechsel. Supabase-Projekt `uhnepfdhqxwytkaebhlf` (Live Scores), Organisation Amski, Tarif Free am 16.11.2026 verbunden und geprüft.
- Standalone, volle Einbettung, Kompaktansicht, bestehende Watchlist und Zeichnungen erhalten.
- Keine privaten Schlüssel/Device-Tokens in Frontend-Konfiguration oder Git. Live-Daten nicht im Service Worker cachen.
- Pflichtprüfungen: npm test, npm run build, dotnet build backend/App.Api -c Release.

## Task 1: Ansichten, Kapazität und Datenabrufe

- [x] Tests für Kerzenstandard, Migration bestehender Einstellungen, instrumentbezogene Ansichten und mehr als 14 gespeicherte Kurse zuerst ausführen.
- [x] marketPrefs.ts: MarketPrefs.views: Record<string,ChartView>, ChartView {kind,range,timeframe}; updateMarketPrefs(current,patch) stellt gespeicherte Ansicht beim Instrumentwechsel wieder her. Neue Ansicht Kerzen/1D/auto; Schutzgrenze 5000.
- [x] marketData.ts: Timeframe auto für range-basierte Kerzen ergänzen. Bestehende manuelle Intervalle weiterhin verfügbar. Yahoo-Anfragen in Blöcke <=20 aufteilen.
- [x] Nur aktiven und aktuell sichtbaren Watchlist-Abschnitt aktualisieren; keine Abfrage aller 5000 Kurse.

## Task 2: Seitenschieber und Einstellungen unten

- [x] Trading.tsx/CSS: Chart als Hauptfläche, Watchlist als rechte Überlagerung, Filter/Seiten mit 20 Einträgen. Fokus, Escape, Außenklick und reduzierte Bewegung beachten.
- [x] App.tsx/CSS: Sprache/Theme/Installationshilfe in Einstellungen unten; sichere obere Abstände erhalten.
- [x] Zeiträume auch bei Kerzen sichtbar; Zeitraumauswahl stellt auto-Intervall ein. Seltene Werkzeuge unten auf Abruf. Embed behält angedockte Liste.
- [x] Nutzerinteraktionen und Reload/Marktwechsel prüfen; Chartgröße und Zoom beim Öffnen der Liste erhalten.

## Task 3: Alarmdienst

- [x] supabase/: private Datenbanktabellen, authentifizierte Edge API, Cron, atomare Auslösung/Bestätigung und wiederholbare Push-Zustellung ohne doppelte Ereignisse.
- [x] HTTP-Vertrag: /config, /register, /subscribe, /alarms, /events, /ack; X-Device-Id/X-Device-Token nach Registrierung. /check nur Scheduler.
- [x] Schwellenüberquerung >=/<=, einmaliger Alarm, veraltete/fehlende Kurse, Push-Fehler, abgelehnte Berechtigung und fremde Geräte testen.
- [x] Backend erst nach bestätigter Supabase-Verbindung bereitstellen; Free-Plan und Projektziel verifizieren.

## Task 4: Alarmbedienung und Service Worker

- [x] alertService.ts/AlarmControls.tsx: Alarm erstellen, Status, rote Glocke mit unbestätigten Ereignissen, ausdrückliches Bestätigen und Sprung zum Kurs.
- [x] Sprung temporär Kerzen/1W mit Zielpreislinie; gespeicherte Standardansicht nicht unbemerkt überschreiben. Eine anschließende bewusste Änderung speichert die vollständige sichtbare Ansicht.
- [x] Push-Berechtigung nur nach Nutzeraktion; Notification-Klick gleichwertig zum In-App-Sprung. Keine Alarmaktivierung vortäuschen, wenn Dienst nicht eingerichtet ist. Veraltete Kursquelle und entzogene Geräteberechtigung sichtbar.
- [ ] Nach Serverprüfung eine testbare Veröffentlichung bereitstellen und im gesperrten iPhone End-to-End abnehmen.

## Aktueller Checkpoint, 16.11.2026

CP3.1 Oberfläche lokal geprüft: 390×844, Chart344×614 ohne Seitenüberlauf; Seitenschieber erhält Chartgröße. 320×568 ohne Seitenüberlauf, fünf Tasten unten mindestens44px hoch. Kerzen, Zeitraum, Reload, Kurswechsel und Alarm-Sprung durch Tests abgedeckt.

CP3.2 am 17.11.2026 bereitgestellt und serverseitig geprüft: vier Migrationen, sieben geschützte Vault-Werte, Edge Function Version 1, ein aktiver Minuten-Cronjob. Mehrere erfolgreiche Prüfläufe, zehn HTTP-Prüfungen und ein zurückgerollter PostgreSQL-Lifecycle-Test bestätigt. Gesamtprüfung: 36 Node + 111 Frontend + 2 Deno-Tests, Web- und .NET-Build. Unabhängige Prüfung hat drei relevante Fehler gefunden und nach Korrektur erneut geprüft: vollständige Alarmansicht speichern, Fokus in geschlossener Historie und getrennte Zeitbudgets für langsame Quellen/Zustellungen. Kein offener konkreter Codebefund. Nächster Schritt: Oberfläche veröffentlichen, dann CP3.3 am Gerät abnehmen.

CP3.3 bleibt offen: echter Test-Push, Schwellenalarm bei geschlossenem/gesperrtem iPhone, rote Glocke nach Neustart, 1W-Zielmarkierung, ausdrückliche Bestätigung und erneute Aktivierung. Die Annahme eines Pushs durch den Anbieter beweist noch keine Anzeige am Gerät.

## Review Focus

- Migration alter Präferenzen und Blockierung des Browserspeichers.
- Viele gespeicherte Kurse ohne Überlastung der öffentlichen APIs.
- Einmalige Auslösung bei wiederholten/gleichzeitigen Prüfungen, Ziel übersprungen, Neustart.
- Bestätigung bleibt erhalten; Öffnen bestätigt nicht automatisch.
- Nicht eingerichteter Push, verweigerte Berechtigung, pausierter Dienst und veraltete Kursdaten.

## Ausführung

Unabhängige UI- und Alarmdienst-Dateien parallel bearbeiten; Preferences und Integration beim Hauptagenten. Keine gemeinsamen Dateien gleichzeitig verändern. Fortschritt in .superpowers/sdd/sidebar-alerts/progress.md. Neue Cloud-Verbindung blockiert nicht die lokale Umsetzung.
