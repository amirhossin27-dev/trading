# Etappe 1 – Prüfung vom 15.11.2026

## Umsetzung

- Ausgangscommit: 659a5032e7b0a8a0b2d21a3c86c4bcd9e54d05cd.
- Branch: codex/iphone-header.
- Lokale Arbeitskopie: app/ unter dem bisherigen Projektordner.
- Oberer Abstand: Safe Area plus 16px bei schmalen Ansichten; plus 20px bei breiteren Ansichten einschließlich Querformat.
- Header-Schaltflächen: mindestens 44 × 44 CSS-Pixel; Installationsbutton im Browser bleibt verfügbar.
- Unter 381px wird das dekorative Logo ausgeblendet, damit die Header-Aktionen in einer Zeile bleiben.
- Bei display-mode: standalone oder navigator.standalone entfällt der Installationsbutton.
- Keine Änderung an Chart-Gesten, Datenabrufen oder gespeicherten Einstellungen.

## Nachweise

- Vor Änderung: npm test mit 5 Node- und 59 Vitest-Tests erfolgreich.
- Neue Header-Tests vor Implementierung: 3 bestanden, 3 wegen sichtbarem Installationsbutton fehlgeschlagen.
- Nach Implementierung: alle 6 Header-Tests erfolgreich.
- Vollständige Prüfung: npm test mit 5 Node- und 65 Vitest-Tests erfolgreich.
- npm run build erfolgreich. Vite meldet weiterhin den extern geladenen klassischen config.js-Script; diese Ladeweise ist unverändert.
- dotnet build backend/App.Api -c Release erfolgreich, 0 Warnungen/Fehler.
- Unabhängige Codeprüfung: keine offenen Befunde für Etappe 1.
- Browser bei 320, 375, 393, 852 und 1280px Breite: kein horizontaler Überlauf, Header-Aktionen ohne Überschneidung und mindestens 44px groß.
- Browser-Insets: 16px bei schmaler Ansicht und 20px bei breiter Ansicht; Hardware-Safe-Area ist dort 0.
- Vollständige und kompakte Einbettung: kein Header, Padding 0, kein horizontaler Überlauf.
- Lokale Testansicht unter .superpowers/ simuliert ausschließlich navigator.standalone. Sie wird nicht committed oder veröffentlicht.

## Offener Checkpoint CP1

Die echte Safe Area, Dynamic Island, iOS-Version, Hoch-/Querformat und eine bereits installierte App-Version müssen auf dem iPhone 15 geprüft werden. Der aktuelle Stand ist lokal und noch nicht auf GitHub Pages veröffentlicht.

Nächster Schritt: Veröffentlichung der geprüften Etappe vereinbaren; danach App vom Home-Bildschirm vollständig schließen und neu öffnen und den oberen Abstand gemeinsam prüfen. Erst nach CP1 zur Chart-Gesten-Etappe wechseln.

## Entscheidungen

Die frische Arbeitskopie auf einem eigenen Branch dient der Isolation. Ein weiterer verknüpfter Worktree war bei vorher leerem Projektordner nicht erforderlich. Das Fortsetzungsprotokoll wird direkt gepflegt, weil der Plan Etappen statt der von Hilfsskripten erwarteten Task-Überschriften verwendet.
