# Etappe 2 und Header-Nachbesserung – 15.11.2026

Ausgangscommit: 430ff05f70cbfabacc5a7073415313727022c22d. Arbeitsbranch: codex/iphone-chart-gestures.

## Nutzerfeedback und Umsetzung

Der Nutzer möchte den Header weiter unten, die vier Footer-Hinweise entfernt und die nächste Etappe fortgesetzt haben.

- Oberer Zusatzabstand auf 32px erhöht (schmale Ansichten und Geräte mit grobem Zeiger, jeweils zusätzlich zur Safe Area).
- Hinweise zu reiner Kursanzeige, Quelle, lokal gespeicherten Einstellungen und Internetbedarf entfernt.
- Zwei Finger zoomen den Chart um ihren Mittelpunkt; ein Finger verschiebt im Cursor-Modus.
- Touch-Zeichnungen werden erst beim Loslassen festgeschrieben; Trend/Fibonacci/Messung behalten während des Ziehens ihre Vorschau. Zwei separate Berührungen bleiben möglich.
- Zweiter Finger bricht eine vorläufige Zeichnung ab. Abbruch, verlorene Pointer-Capture, Werkzeug-/Marktwechsel und geänderte Chartgeometrie hinterlassen keine aktive Geste.
- Bei Drehung/Größen- oder Lageänderung wird die Geste beendet; danach mit einer neuen Geste fortfahren.
- Dritter Finger verändert den laufenden Zoom nicht; Entfernungs- und Zoomgrenzen bleiben endlich.
- Touch-Zoomtasten sind 44 × 44px groß, dauerhaft sichtbar und innerhalb der Plotfläche oberhalb der Zeitachse platziert.
- App und scrollbare Listen erlauben normales Verschieben/Scrollen; Browser-Pinch-Zoom wird über touch-action auf diesen Flächen unterbunden. Im Chart übernimmt die App die Gesten.
- Eingabeschrift auf kleinen/Touch-Ansichten mindestens 16px, um iPhone-Fokuszoom zu vermeiden.
- Betriebssystem-Bedienungshilfen und tatsächlich auf iOS wirksame Gestensteuerung bleiben Teil der Geräteabnahme.

## Prüfungen

- Neue Chart-Tests vor Umsetzung: 7 von 11 fehlgeschlagen.
- Zusätzliche Prüfungen zu Zeichenvorschau, Größe und Ursprung erkennen die jeweiligen Fehler vor ihrer Korrektur.
- Alle 16 Chart-Tests erfolgreich.
- npm test: 5 Node-Tests und 81 Vitest-Tests bestanden (86 insgesamt).
- npm run build erfolgreich. Unveränderte Vite-Meldung zum extern geladenen config.js bleibt bestehen.
- dotnet build backend/App.Api -c Release erfolgreich, keine Warnungen/Fehler.
- Unabhängige Codeprüfung: fehlende Zeichenvorschau und vermischte Koordinaten bei Größenänderung erkannt und korrigiert; jeweils durch fehlgeschlagene und danach erfolgreiche Tests belegt.
- Browserprüfung: zusätzliche 32px auf schmalen Ansichten; beide Footer verschwunden; Zoom/Reset funktionieren. Kein horizontaler Überlauf in geprüften schmalen und breiten Ansichten.
- Keine Änderung an Preferences, Watchlist-Speicherformat, Backend oder Daten-Caching.

## Entscheidungen und offener Checkpoint

Die zwei Review-Befunde wurden wegen ihrer Wirkung auf die vorhandene Zeichenfunktion und die geplante Rotationsprüfung als zu beheben eingestuft. Statt laufende Finger nach Rotation neu zu berechnen, wird die Geste beendet; das verhindert Sprünge durch gemischte Koordinaten.

CP1 (Abstand) und CP2 (Touch) bleiben bis zur Rückmeldung vom iPhone 15 offen. Nach Veröffentlichung: App über den Home-Bildschirm neu starten, Abstand prüfen, zwei Finger im Chart auseinander/zusammen bewegen, einen Finger zum Verschieben verwenden, Reset und Scrollen außerhalb des Charts prüfen. Erst danach Etappe 3 gemeinsam beginnen.
