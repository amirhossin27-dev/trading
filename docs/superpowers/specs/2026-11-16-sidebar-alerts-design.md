# Seitenschieber, Ansichten und Kursalarme

## Vom Nutzer festgelegt

- Konzept Seitenschieber aus work/etappe-3-konzepte.html als Basis. Der Chart bekommt den Hauptbereich. Die Kursliste liegt als rechte Überlagerung darüber und braucht geschlossen keinen Platz.
- Gewählte Ansichten wie 1J dauerhaft merken. Kerzen als Standard.
- Einstellungen unten statt oben rechts.
- Kursalarme auch bei geschlossener App/gesperrtem iPhone. Systemmitteilung plus rote Glocke in der App; Alarm ausdrücklich bestätigen; direkter Sprung zum Instrument und Zielwert in die 1W-Ansicht.
- Bisherige Grenze von 14 Kursen aufheben bzw. sehr hoch setzen.

## Umsetzung der bereits gewählten Oberfläche

- Kompakter Kurskopf; Zeiträume immer für Linie und Kerzen verfügbar. Kerzenintervall separat unter Chart-Optionen. 1W bedeutet eine Woche Verlauf, nicht eine einzelne Wochenkerze.
- Ansicht pro Instrument speichern; nach Schließen/Neustart und nach Instrumentwechsel wiederherstellen. Bestehende Preferences und Zeichnungen migrieren, bewusste ältere Linienauswahl erhalten. Neue/fehlende Auswahl startet mit Kerzen und automatischem Intervall.
- Vorschlag des Implementierers: 5.000 gespeicherte Instrumente als Schutzgrenze. Nur aktiven und sichtbaren Kurslistenabschnitt regelmäßig abrufen. API-Grenze 20 Symbole pro Anfrage durch Aufteilung einhalten, nicht tausende Kurse gleichzeitig abfragen.
- Sprache, Theme und Installationshilfe in Einstellungen unten. Seitenschieber per Taste, Schließen-Taste, Escape und außerhalb schließen; Fokus beim Öffnen/Schließen führen; reduzierte Bewegung respektieren.
- Kompakte Dashboard-Kachel unverändert; volle Einbettung weiterhin bedienbar.

## Alarmablauf und zusätzlicher Serverteil

- Separater Dienst mit dauerhaftem Speicher und zeitgesteuerter Prüfung. Aktueller Render-Free-Webdienst schläft nach Inaktivität; browserseitige Timer leisten keine Prüfung bei geschlossener iPhone-App.
- Supabase Free, PostgreSQL + Cron + Edge Functions für Web Push. Projekt `uhnepfdhqxwytkaebhlf` (Live Scores) und kostenloser Tarif am 16.11.2026 bestätigt; keine kostenpflichtigen Dienste oder Tarifwechsel.
- Ausdrückliche Richtung am Alarm: erreicht/überschreitet Ziel von unten oder erreicht/unterschreitet von oben. Auch Sprünge über den Grenzwert erfassen. Gültige aktuelle Kurse verwenden; bei Ausfall keine erfundenen Auslösungen.
- Einmaliger Alarm: aktiv -> ausgelöst/unbestätigt -> bestätigt; explizites erneutes Aktivieren für Wiederholung. Idempotente Auslösung und Zustellung; Bestätigen muss Neuladen überleben. Nur ausdrückliches Bestätigen entfernt die rote Markierung, Öffnen allein nicht.
- Ereignis speichert Instrument, Zielpreis/Währung, beobachteten Auslösepreis und Zeit. „Zum Kurs“ und Antippen der Systemmitteilung öffnen 1W mit Kerzen und einer sichtbaren Zielpreislinie. Benutzeransicht vor Alarm-Sprung nicht dauerhaft überschreiben, bis der Nutzer eine neue Ansicht wählt.
- Berechtigung für iPhone-Mitteilungen erst nach direktem Tippen auf Aktivieren. Abgelehnte Berechtigung, abgelaufene Push-Abonnements, nicht eingerichteter Server und alter Prüfzeitpunkt sichtbar behandeln.
- Alarmdaten und Push-Abonnements gerätebezogen schützen; keine Server-Geheimnisse in Frontend/public-Konfiguration. Keine Datenbank öffentlich lesbar machen.
- Vorgeschlagener Prüfzyklus: eine Minute, ausdrücklich keine Tick-genaue Auslösegarantie; Datenquelle und Zustellung können verzögern. End-to-End-Abnahme am gesperrten iPhone erforderlich.

## Checkpoints

1. Oberfläche/Preferences/Kurskapazität lokal prüfen.
2. Supabase-Verbindung und kostenloses Projekt klären; Alarmdienst prüfen.
3. Alarm erstellen -> echter Test-Push -> rote Glocke -> 1W-Sprung -> Bestätigung -> Neustart prüfen.
4. npm test, npm run build, dotnet build backend/App.Api -c Release; Veröffentlichung und Geräteabnahme.
