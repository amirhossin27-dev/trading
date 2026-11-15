# iPhone-Bedienung und mobile Übersicht – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Umsetzung gemeinsam mit dem Nutzer, eine Etappe pro Freigabe; keine automatische Fortsetzung zur nächsten Etappe.

**Goal:** Die Trading-App auf dem iPhone 15 über das Home-Bildschirm-Symbol bequem bedienen: sichere Abstände, Zoom im Chart und eine verständliche mobile Oberfläche.

**Architecture:** Vorschlag: React-Oberfläche und vorhandenen SVG-Chart behalten. Layout, Gesten und Datenstatus gezielt verbessern; keine neue Chart-Bibliothek für diese Etappen erforderlich.

**Tech Stack:** React, TypeScript, Vite, CSS, eigener SVG-Chart; Vitest/Testing Library und Node-Tests; bestehende .NET-API.

**Spec:** Nutzerauftrag vom 14.11.2026 und Zielbild in diesem Dokument. Etappe 1 wurde am 15.11.2026 durch „Leg los“ freigegeben. Weitere Etappen werden gemeinsam am jeweiligen Checkpoint begonnen. Layoutdetails von Etappe 3/4 werden vor ihrer Umsetzung anhand einer Vorschau abgestimmt.

## Stand und Arbeitsweise

- Datum: 14.11.2026, Europe/Berlin.
- Repository: https://github.com/amirhossin27-dev/trading
- App: https://amirhossin27-dev.github.io/trading/
- Analysierter main-Commit: 659a5032e7b0a8a0b2d21a3c86c4bcd9e54d05cd.
- Nutzer bestätigt: primär Start über Home-Bildschirm-Symbol auf iPhone 15.
- Code und veröffentlichte Ansicht bei 393 × 852 Browser-Viewport untersucht.
- Der Browser-Test simuliert die Größe, nicht iOS-Safari, Dynamic Island, echte Touch-Gesten oder Bildschirmtastatur.
- Ausgangslage am 14.11.2026: lokaler Arbeitsordner war leer. Am 15.11.2026 Arbeitskopie unter app/ auf Branch codex/iphone-header angelegt; Etappe 1 lokal umgesetzt und geprüft; Veröffentlichung noch offen.
- Dieses Dokument ist auch im Arbeitsbranch enthalten. Prüfnachweis: docs/reviews/2026-11-15-iphone-header.md.
- Vor Implementierung aktuellen Remote-Stand und AGENTS.md prüfen, Arbeitskopie/isolierten Branch anlegen, Ausgangstests ausführen.
- Pro Etappe: konkrete Änderung -> technische Prüfung -> Vorschau/Testversion -> Nutzerprüfung am iPhone -> Checkpoint dokumentieren.
- Ein Commit pro abgeschlossener, überprüfter Änderung; Code-Abschluss und Nutzerabnahme getrennt markieren.
- Kein Push nach main ohne vereinbarten Veröffentlichungsschritt: laut Projekt führt main automatisch zu GitHub Pages.

## Global Constraints

- Standalone-, Vollbild-Einbettungs- und Kompaktmodus erhalten.
- Bestehende Watchlist, Sprache, Theme, Indikatoren und Zeichnungen erhalten; vorhandene Speicherformate möglichst unverändert.
- Keine Secrets in Frontend-Dateien oder public/config.js.
- Keine kostenpflichtigen Dienste; Render-Tarif free unverändert.
- Live-Daten niemals im Service Worker cachen; echte API-Ausfälle sichtbar machen.
- Vor Abschluss jeder ausgelieferten Etappe: npm test, npm run build und dotnet build backend/App.Api -c Release.
- Zuerst die ausdrücklich gemeldeten iPhone-Probleme; weitere Funktionen erst in ihrer abgestimmten Etappe.
- Deutsch/Englisch, hell/dunkel/automatisch und Desktop-Bedienung berücksichtigen.

## Befunde und Zielbild

1. **Oberer Abstand:** src/app.css verwendet mobil max(12px, env(safe-area-inset-top)); index.html aktiviert viewport-fit=cover und black-translucent. Die Safe Area ist vorhanden, aber der normale Abstand wird nicht zusätzlich aufaddiert. Plausible Erklärung für die enge Platzierung; am echten Gerät noch zu bestätigen. Ziel: Sicherheitszone plus sichtbarer zusätzlicher Abstand.
2. **Gesten:** PriceChart.tsx hat zoom(), resetView(), Mausrad-Zoom und einen einzelnen Pan-Zustand, aber keine Verwaltung zweier Finger. CSS setzt pan-y im Chart sowie eine mobile none-Regel in app.css. Ziel: eindeutig festgelegte Gesten, zentral geregeltes touch-action und robuste Abbruchbehandlung.
3. **Platz:** In der geprüften schmalen Ansicht beginnt der Chart ungefähr bei y=480. Watchlist, Kurskopf, Zeiträume, Indikatoren und Werkzeuge stehen davor. Ziel: Chart deutlich früher sichtbar; wichtige Aktionen groß genug statt alles kleiner zu machen.
4. **Treffflächen:** Zoomtasten 26 × 26, Zeichentasten 32 × 32, Watchlist-Entfernen 20 × 20 CSS-Pixel. Ziel: mindestens 44 × 44 CSS-Pixel für wichtige mobile Aktionen; Entfernen in einen Bearbeiten-Modus verlagern.
5. **Suche:** kleines Popover mit 13px Eingabeschrift und sofortigem Fokus. Ziel: mobile Suchansicht mit sichtbarem Schließen, ausreichend großer Schrift und Ergebnissen oberhalb der Tastatur.
6. **Verständlichkeit:** Hauptansicht berechnet Änderung gegenüber dem Anfang des gewählten Chartbereichs; Watchlist zeigt Vortag/24h. Im Browser waren bei Apple gleichzeitig -0,69 % und +0,39 % sichtbar. Ziel: Bezugszeitraum ausdrücklich beschriften.
7. **Datenstatus:** Bei fehlgeschlagener Hintergrundaktualisierung bleibt eine vorhandene Serie ohne Fehlerkennzeichnung erhalten; Quote-Fehler werden abgefangen, alte Werte bleiben stehen. Ziel: alte Daten dürfen sichtbar bleiben, müssen aber als nicht aktuell erkennbar sein.

**Ansätze:** A) bestehende App schrittweise verbessern (empfohlen: geringster Eingriff, vorhandene Funktionen bleiben nutzbar); B) Chart-Bibliothek ersetzen (größerer Migrations- und Regressionstestaufwand für Zeichnungen/Indikatoren); C) gesamte mobile Oberfläche neu bauen (mehr Gestaltungsfreiheit, verzögert die Sofortkorrekturen). Ansatz A für Etappe 1 mit „Leg los“ am 15.11.2026 bestätigt.

## Review Focus

- Safe Area bei Home-Bildschirm-Start, Rotation und Safari unterschiedlich: Etappe 1 + 6.
- Übergang ein Finger -> zwei Finger -> ein Finger; Abbruch oder Pointer-Verlust: Etappe 2.
- Bildschirmtastatur, lange Namen, große Schrift und kleine Breiten: Etappe 3 + 4.
- Fehlgeschlagene Aktualisierung nach zuvor erfolgreichen Daten sowie Teilausfälle: Etappe 5.
- Alte installierte App-Version und erhaltene lokale Einstellungen nach Update: Etappe 6.

## Etappe 1 – iPhone-Kopfbereich korrigieren

**Priorität:** sofort. **Dateien:** src/app.css, src/App.tsx; index.html prüfen.
**Schnittstelle:** vorhandene .standalone/.is-embedded-Klassen und Header-Aktionen; keine Änderung an Chart-Props.

- [ ] Echte iOS-Version und bisherigen Abstand auf dem Nutzergerät erfassen.
- [x] Top-Padding auf Safe Area plus zunächst 16px Zusatzabstand auslegen; seitliche/untere Insets bei Rotation prüfen.
- [x] Header-Aktionen auf ausreichende mobile Treffflächen bringen und Umbruch auf kleinen Breiten vermeiden.
- [x] Installationshinweis im installierten Modus ausblenden; im Browser verfügbar lassen. Erkennung über display-mode und iOS-Standalone-Fallback.
- [x] Verhalten der Installationsanzeige in neuem src/App.test.tsx für Browser/Standalone prüfen; Layout visuell prüfen.
- [ ] Pflichtprüfungen ausführen und Testversion bereitstellen.

**Checkpoint CP1:** Auf dem echten iPhone bleiben mindestens die vereinbarten 16px zwischen sicherer Oberkante und Bedienelementen. Keine Überdeckung durch Dynamic Island/Statusleiste; Hoch-/Querformat, Safari und Einbettung bleiben bedienbar. Nutzer bestätigt den Abstand.

## Etappe 2 – Chart-Zoom und App-Gesten

**Priorität:** sofort, nach CP1. **Dateien:** src/features/trading/PriceChart.tsx, trading.css, src/app.css; neue src/features/trading/PriceChart.test.tsx; bei Bedarf klar abgegrenzte chartGestures.ts mit eigener Testdatei.
**Schnittstelle:** vorhandene View {count, shift}, Zoomgrenzen, Zeichnungen und Chart-Props behalten.

**Vorgeschlagenes Verhalten:** Zwei Finger im Chart zoomen um ihren Mittelpunkt; ein Finger verschiebt den Chart im Cursor-Modus; Zeichnen ist ein ausdrücklicher Werkzeugmodus. Außerhalb des Charts scrollt die Seite normal. App-weites Pinch-/Doppeltipp-Vergrößern durch normale Touch-Bedienung unterbinden, entsprechend dem Nutzerwunsch.

- [ ] Vor Änderung Tests für zwei Pointer und Mittelpunktanker schreiben und ihr Scheitern nachweisen.
- [ ] Aktive Pointer getrennt erfassen; aus Ausgangsabstand und Ausgangsansicht den Zoom berechnen; Grenzen des vorhandenen Charts beachten.
- [ ] Pan/Pinch/Zeichnen gegenseitig abgrenzen; zweiter Finger darf keine Zeichnung auslösen; pointercancel und lostpointercapture setzen die Geste sauber zurück.
- [ ] Touch-Regeln für Chart und übrige App zentral festlegen. Scrollen außerhalb des Charts und in Suchlisten erhalten; Querformat einbeziehen.
- [ ] Vorhandene Plus/Minus/Reset-Tasten mobil sichtbar und mit mindestens 44px Trefffläche anbieten.
- [ ] Verhalten prüfen: Pinch hinein/heraus, keine Sprünge beim Fingerwechsel, Zoomgrenzen, 0/1 Datenpunkt, Marktwechsel während Geste, kein versehentliches Löschen/Zeichnen, Maus/Tastatur weiterhin nutzbar.
- [ ] Auf echtem iPhone prüfen, dass Header und App-Schrift beim Chart-Pinch gleich groß bleiben und normales Scrollen funktioniert.
- [ ] Pflichtprüfungen ausführen.

**Checkpoint CP2:** Chart reagiert auf Zwei-Finger-Zoom; App bleibt bei den getesteten Touch-Gesten unvergrößert. Reset funktioniert und keine Geste hängt fest.

**Technische Grenze:** user-scalable=no/maximum-scale=1 allein ist keine belastbare iOS-Lösung; iOS kann diese Angaben ignorieren. OS-Bedienungshilfen/erzwungener Browser-Zoom sind davon getrennt und werden nicht als abschaltbar versprochen. Die gewünschte Gestensteuerung am echten Gerät verifizieren.

## Etappe 3 – Mehr Chart, klarere mobile Bedienung

**Priorität:** hoch, nach CP2. **Dateien:** Trading.tsx, trading.css, tradingCopy.ts, gegebenenfalls src/App.tsx/app.css.
**Schnittstelle:** bestehende Preferences und Chart-Props; keine neue Datenquelle.

- [ ] Eine einfache mobile Vorschau abstimmen: kompakter Kurskopf, direkt erreichbare Zeiträume, Werkzeuge über einen beschrifteten Zugang.
- [ ] Sprache/Darstellung in einem kompakten Einstellungsbereich bündeln; seltene Aktionen sollen den Chart nicht verdrängen.
- [ ] Werkzeugleiste bei Bedarf öffnen; aktives Werkzeug deutlich benennen und Beenden anbieten.
- [ ] Chart-/Preisbereiche ohne unnötig verschachtelte Abstände gestalten; optionaler Chart-Fokusmodus nur nach Zustimmung.
- [ ] Navigation/Präferenzspeicherung in Trading.test.tsx prüfen. Visuell: 320, 375, 393, 430px sowie Desktop, lange Texte, DE/EN, größere Schrift.
- [ ] Pflichtprüfungen ausführen.

**Checkpoint CP3:** Im gleichen 393 × 852 Vergleich startet die Chartfläche im Normalzustand mindestens 100 CSS-Pixel früher als bisher, ohne Text/Treffflächen zu verkleinern. Markt- und Zeitraumwechsel bleiben direkt erreichbar. Nutzer bestätigt die Vorschau und danach die Bedienung.

## Etappe 4 – Suche und Watchlist fingerfreundlich

**Priorität:** mittel, nach CP3. **Dateien:** AssetPicker.tsx, Trading.tsx, trading.css, tradingCopy.ts, Trading.test.tsx; ggf. neue AssetPicker.test.tsx.
**Schnittstelle:** vorhandene AssetPickerProps und Markt-/Watchlist-Speicherung.

- [ ] Suche mobil als großzügigen Dialog mit klarer Schließen-Aktion gestalten; Eingabe mindestens 16px, Liste an verfügbare Höhe anpassen.
- [ ] Fokus beim Öffnen/Schließen sinnvoll führen; Tastatur darf Ergebnisse und Schließen nicht unzugänglich machen.
- [ ] Watchlist-Bearbeiten vom normalen Auswählen trennen; touchfähige Verschieben-Aktionen statt ausschließlichem Drag-and-drop anbieten.
- [ ] Entfernen mit Rückgängig-Möglichkeit versehen; dabei Zeichnungen/Präferenzen nicht unabsichtlich vernichten.
- [ ] Hinzufügen, Suchen, Sortieren, Entfernen/Rückgängig und Reload testen; Suchabbruch/keine Treffer/Fehler sowie lange Namen prüfen.
- [ ] Pflichtprüfungen ausführen.

**Checkpoint CP4:** Einen Wert suchen, hinzufügen, umordnen und versehentliches Entfernen rückgängig machen ist am iPhone ohne präzises Zielen möglich. Tastatur verdeckt keine erforderliche Aktion.

## Etappe 5 – Kurse und Datenzustand verständlich machen

**Priorität:** hoch; nach CP2 bei Bedarf vor Etappe 3/4 vorziehbar.
**Dateien:** Trading.tsx, tradingCopy.ts, marketData.ts, zugehörige Tests; TradingTile.tsx bei gemeinsamer Statusdarstellung.
**Schnittstelle:** Serien-/Quote-Ladestatus erweitern; Abrufzeitpunkt von tatsächlichem Kurszeitpunkt unterscheiden. Keine erfundenen Zeitstempel.

- [ ] Prozentwerte sichtbar mit ihrem Bezugszeitraum versehen, statt nur per title-Tooltip.
- [ ] Börsenstatus, Datenquelle und letzte erfolgreiche Aktualisierung verständlich anzeigen.
- [ ] Fehler beim Hintergrund-Refresh markieren, vorhandene Daten weiter anzeigen und erneuten Abruf anbieten.
- [ ] Quote-Teilausfälle berücksichtigen: erfolgreiche Teilantwort darf alte Kurse anderer Märkte nicht als frisch darstellen.
- [ ] Tests: Erfolg -> Ausfall -> Wiederherstellung; einzelne Quelle ausgefallen; offline; geschlossener Markt; Zeitraumwechsel; kompakte Einbettung.
- [ ] Pflichtprüfungen ausführen.

**Checkpoint CP5:** Unterschiedliche Prozentwerte sind nachvollziehbar. Bei ausbleibenden Daten steht eine klare Aktualitäts-/Fehlermeldung; alte Kurse wirken nicht weiterhin live.

## Etappe 6 – Geräteabnahme und Veröffentlichung

**Dateien:** README.md und dieses Protokoll; vite.config.ts/src/main.tsx nur bei nachgewiesenem Updateproblem.

- [ ] iPhone 15 vom Home-Bildschirm: Hoch-/Querformat, Zoom, Scrollen, Suche mit Tastatur, Theme, Sprache, App-Wechsel und erneutes Öffnen prüfen.
- [ ] Safari, Desktop, volle Dashboard-Einbettung und Kompaktansicht prüfen.
- [ ] Offline/Verbindungswechsel sowie Update einer bereits installierten Version testen; Einstellungen und Zeichnungen bleiben erhalten.
- [ ] npm test, npm run build, dotnet build backend/App.Api -c Release erfolgreich ausführen; Ergebnisse dokumentieren.
- [ ] Prüfbare Änderung/PR und Rückkehrmöglichkeit zum vorherigen Stand vorbereiten.
- [ ] Veröffentlichung mit Nutzer vereinbaren; anschließend Pages-Version und tatsächliches Update auf dem iPhone verifizieren.

**Checkpoint CP6:** Pflichtprüfungen bestanden, Nutzerabnahme dokumentiert, richtige Version auf dem Gerät angekommen. Bei einem Gerätefehler bleibt der betreffende Checkpoint offen.

## Fortsetzungsprotokoll

| Checkpoint | Status | Nachweis / nächste Aktion |
| --- | --- | --- |
| CP0 Analyse und Planentwurf | abgeschlossen | Code und mobile Browseransicht geprüft; Nutzer nutzt Home-Bildschirm |
| CP1 Kopfbereich | lokal umgesetzt; Geräteabnahme offen | 70 Tests und beide Builds erfolgreich; Veröffentlichung und iPhone-Test als Nächstes |
| CP2 Gesten | offen | nach CP1 |
| CP3 Übersicht | offen | Vorschau vor Umsetzung |
| CP4 Suche/Watchlist | offen | nach CP3 |
| CP5 Datenverständlichkeit | offen | nach CP2 vorziehbar |
| CP6 Veröffentlichung | offen | nach vereinbarten Etappen |

Nach jeder Etappe ergänzen: Datum, Branch/Commit, betroffene Dateien, ausgeführte Tests mit Ergebnis, Test-/Deployment-URL, iOS-Version, Nutzerfeedback, offene Punkte und genau eine nächste Aktion.

**Zum späteren Fortsetzen:** „Lies docs/superpowers/plans/2026-11-14-iphone-usability.md, gleiche den aktuellen Repository-Stand ab und setze beim nächsten offenen Checkpoint an. Beginne nur die vereinbarte Etappe.“

## Quellen

- Quellcode am oben genannten Commit: https://github.com/amirhossin27-dev/trading/tree/659a5032e7b0a8a0b2d21a3c86c4bcd9e54d05cd
- Safe Areas: https://webkit.org/blog/7929/designing-websites-for-iphone-x/
- Pinch-Gesten: https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events/Pinch_zoom_gestures
- iOS-Grenzen der Viewport-Zoomangaben: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/meta/name/viewport
