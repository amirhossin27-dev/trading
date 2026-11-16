# Hintergrunddienst für Kursalarme

Stand 17.11.2026: im bestätigten Free-Projekt `uhnepfdhqxwytkaebhlf` (Live Scores) eingerichtet. Edge Function Version 1 und genau ein Minuten-Cronjob sind aktiv; mehrere erfolgreiche HTTP-200-Prüfläufe wurden nachgewiesen. Der echte Test am gesperrten iPhone bleibt offen.

Der Dienst verwendet Supabase PostgreSQL, `pg_cron`, `pg_net`, Vault und eine Edge Function. Es wird kein kostenpflichtiger Zusatzdienst benötigt. Ein Browser-Timer genügt nicht für Alarme bei geschlossener App. Free-Tarife, Datenquellen und Push-Dienste geben keine Garantie für minutengenaue Zustellung. Projektpause, ausgeschöpftes Kontingent und Ausfälle unterbrechen die Überwachung; der sichtbare Prüfzeitpunkt ist deshalb Teil der Oberfläche.

## Einrichtung im kostenlosen Projekt

Die folgenden Schritte dokumentieren die ausgeführte Einrichtung und dienen zur späteren Wiederherstellung. Sie verändern das ausgewählte Supabase-Projekt; auf einem bereits eingerichteten Projekt nicht blind erneut ausführen.

1. Supabase-Verbindung authentifizieren und vor jeder Änderung das Projekt prüfen. Data API eingeschaltet lassen, „Automatically expose new tables“ ausgeschaltet lassen. Die Migration vergibt Rechte ausdrücklich nur an `service_role`; alle sechs Tabellen haben RLS ohne öffentliche Lesepolicies.
2. Die vier Migrationen in `supabase/migrations/` in Reihenfolge anwenden: Tabellen und Daten-RPCs, eingeschränkter Aufruf der automatischen RLS-Funktion, feste Vault-Einstellungen und Cron-Erweiterungen. Ihre Versionsnummern sind mit der gehosteten Migrationshistorie abgeglichen. Die Daten-RPCs laufen mit `SECURITY INVOKER`; nur der serverseitige `service_role` darf sie ausführen. Die Security-Advisors anschließend prüfen.
3. Ein VAPID-Schlüsselpaar einmalig mit der fest gepinnten Bibliothek erzeugen und sicher verwahren. Ein Wechsel des öffentlichen Schlüssels erfordert neue Browser-Abonnements. Einen unabhängigen Scheduler-Schlüssel aus mindestens 32 kryptografisch zufälligen Bytes erzeugen. Keine dieser privaten Angaben in Chat-Nachrichten, Git, Frontend-Variablen oder `public/config.js` kopieren.
4. Die folgenden Werte in Supabase Vault speichern. Die App verwendet sechs feste Namen; die RPC `trading_alert_server_settings()` gibt sie ausschließlich an den Serverdienst weiter. Die RPC hat keine Argumente, einen leeren Suchpfad, ausdrücklich entzogene öffentliche Ausführungsrechte und eine Prüfung der tatsächlichen Aufruferrolle. Ihr eng begrenztes `SECURITY DEFINER` vermeidet einen pauschalen Lesezugriff des Dienstes auf alle Vault-Geheimnisse. Explizite gleichnamige Edge-Umgebungsvariablen überschreiben Vault; der Cache läuft nach 30 Sekunden ab und Fehler sperren die Konfiguration. `SUPABASE_URL` und `SUPABASE_SERVICE_ROLE_KEY` stellt Supabase selbst bereit und sie werden nicht aus Vault übernommen.

| Einstellung / optionale Umgebungsvariable | Vault-Name | Inhalt |
| --- | --- | --- |
| `ALERT_VAPID_PUBLIC_KEY` | `trading_alert_vapid_public_key` | Öffentlicher VAPID-Schlüssel, 65 Bytes als Base64url |
| `ALERT_VAPID_PRIVATE_KEY` | `trading_alert_vapid_private_key` | Privater VAPID-Schlüssel, 32 Bytes als Base64url |
| `ALERT_VAPID_SUBJECT` | `trading_alert_vapid_subject` | Öffentliche Kontakt-URI des Betreibers |
| `ALERT_SCHEDULER_SECRET` | `trading_alert_scheduler_secret` | Separater zufälliger Scheduler-Schlüssel, mindestens 43 Zeichen |
| `ALERT_ALLOWED_ORIGINS` | `trading_alert_allowed_origins` | `https://amirhossin27-dev.github.io` |
| `YAHOO_API_BASE_URL` | `trading_alert_yahoo_api_base_url` | `https://amir-trading-api.onrender.com` |

5. `trading-alerts` veröffentlichen. `verify_jwt = false` ist bewusst gesetzt: Jeder Gerätezugriff wird mit einem eigenen Geräteschlüssel geprüft; `/check` verlangt den separaten Scheduler-Schlüssel. Ein öffentlicher Supabase-Projektschlüssel ersetzt diese Prüfung nicht.
6. In Vault `trading_alert_project_url` = `https://uhnepfdhqxwytkaebhlf.supabase.co` und `trading_alert_scheduler_secret` = genau derselbe Wert wie `ALERT_SCHEDULER_SECRET` anlegen. Anschließend `supabase/setup-scheduler.sql` ausführen. Das richtet genau einen benannten Cronjob pro Minute ein. Erneutes Ausführen ersetzt den Zeitplan desselben Jobs.
7. Nach einem erfolgreichen Prüfzyklus muss `GET /config` `configured: true` liefern. Vorher, bei fehlenden Secrets oder bei einem mehr als fünf Minuten alten erfolgreichen Worker-Lauf bleibt der Zustand ausdrücklich nicht bereit. In die öffentliche App-Konfiguration kommt ausschließlich `alertServiceUrl: "https://uhnepfdhqxwytkaebhlf.supabase.co/functions/v1/trading-alerts"`.

CLI 3.2.0 wurde lokal über `--help` geprüft. In CLI v3 benötigen Datenbankbefehle `--remote=<ref>`, um ein gehostetes Projekt zu verändern; sie zielen sonst auf die lokale Umgebung. Beispiele für den späteren, ausdrücklich ausgewählten Remote-Schritt:

```powershell
npm exec --yes --package=supabase@3.2.0 -- supabase db push --remote=uhnepfdhqxwytkaebhlf --dry-run
npm exec --yes --package=supabase@3.2.0 -- supabase db push --remote=uhnepfdhqxwytkaebhlf
npm exec --yes --package=supabase@3.2.0 -- supabase functions deploy trading-alerts --remote=uhnepfdhqxwytkaebhlf --no-verify-jwt
npm exec --yes --package=supabase@3.2.0 -- supabase db advisors --remote=uhnepfdhqxwytkaebhlf --type security --fail-on error
```

Die Einrichtung erfolgte über das verbundene Supabase-Plugin. Die CLI-Beispiele sind eine Alternative für spätere Änderungen. Vor `db push` zuerst die lokale/gehostete Migrationshistorie vergleichen. Der Cronjob wartet bis zu 58 Sekunden auf eine Antwort; der Worker reserviert getrennte Zeit für Kursquellen und Zustellungen.

## Nachweise der Bereitstellung

- 36 Node- und 111 Frontend-Tests bestanden; Web- und .NET-Release-Build bestanden. Zwei Deno-Tests prüfen echte Push-Verschlüsselung und öffentliche Konfiguration.
- Zehn Prüfungen gegen die veröffentlichte HTTP-API bestanden: aktueller Heartbeat, exakter CORS-Ursprung, fremder Ursprung gesperrt, Gerätepflicht, Registrierung, eigene Daten, fremder Geräteschlüssel gesperrt, keine Aktivierung/Testmitteilung ohne Telefon-Abonnement und separater Scheduler-Zugang.
- Transaktionaler Test in PostgreSQL 17 bestanden: alte Kurse lösen nicht aus, Schwelle löst genau ein Ereignis aus, fremdes Gerät kann nicht bestätigen, Bestätigung/erneute Aktivierung und alte Bestätigung nach neuer Auslösung sind korrekt. Der Test wurde zurückgerollt; die zwei kurzlebigen HTTP-Testgeräte wurden entfernt.
- Alle sechs Tabellen haben RLS und keine Leserechte für `anon` oder `authenticated`. Die Einstellungen-RPC ist für beide Rollen gesperrt. Security-Advisors melden nur sechs beabsichtigte Informationshinweise zu [RLS ohne öffentliche Policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy): Der Zugriff erfolgt hier ausschließlich über den geschützten Serverdienst.
- Offen: tatsächliche Mitteilung am gesperrten iPhone sowie die gemeinsame Abnahme von roter Glocke, Chart-Sprung und Bestätigung.

## HTTP-Vertrag

Basis ist `.../functions/v1/trading-alerts`. JSON wird nicht gecacht. Browser dürfen nur die erlaubten Ursprünge verwenden. Alle geschützten Routen verlangen `X-Device-Id` (UUID) und `X-Device-Token` (43 Zeichen Base64url, genau 256 zufällige Bits). Der Token wird einmal bei Registrierung zurückgegeben; in der Datenbank liegt ausschließlich SHA-256. Die App muss ihn lokal behalten, niemals in eine URL oder eine Push-Nachricht einsetzen.

| Methode / Route | Anfrage | Antwort |
| --- | --- | --- |
| `GET /config` | öffentlich | `{ configured, vapidPublicKey, checkIntervalSeconds: 60, lastCheckedAt, code }` |
| `POST /register` | öffentlich, `{}` | `201 { deviceId, deviceToken }` |
| `POST /subscribe` | `{ subscription: PushSubscriptionJSON }` | `{ subscribed: true }` |
| `POST /test-push` | `{}` | `{ sent: true }` nach Annahme durch den Push-Anbieter |
| `GET /alarms` | – | `{ alarms, lastCheckedAt, monitoringHealthy, subscriptionActive }` |
| `POST /alarms` | `{ id?, asset, direction, target, currency }` | `201 { alarm }` |
| `DELETE /alarms/:id` | – | `{ deleted: true }` |
| `POST /alarms/:id/rearm` | `{}` | `{ alarm }` |
| `GET /events` | – | `{ events }` – alle unbestätigten und höchstens 100 bestätigte Ereignisse |
| `POST /ack` | `{ eventId }` | `{ event }`, wiederholbar |
| `POST /check` | nur Scheduler, `X-Scheduler-Secret` | Anzahl geprüfter Alarme, Beobachtungen und Zustellversuche |

`asset` entspricht dem bestehenden `MarketAsset`-Objekt der App. Yahoo: `id`, `source: "yahoo"`, `yahoo`, `symbol`, `name`, `group`. Krypto: `id`, `source: "binance"`, `pair`, `coingecko`, `symbol`, `name`, `group`. Namen und Symbole sind in der Länge begrenzt. Der Server akzeptiert keine Preisquellen-URLs vom Client. Krypto-Ziele verwenden wie die App USD/USDT; es gibt keine zusätzliche Währungsumrechnung.

`direction` ist `above` (größer/gleich) oder `below` (kleiner/gleich). `target` ist eine endliche JSON-Zahl größer null bis maximal `1e15`. `currency` muss mit der Quelle übereinstimmen. Für wiederholte Erstellversuche sollte der Client dieselbe UUID in `id` schicken: dieselben Daten liefern denselben Alarm zurück, abweichende Daten einen Konflikt.

Ein Alarm enthält `{ id, asset, direction, target, currency, status, createdAt, lastCheckedAt, lastPrice, lastError }`. Ein Ereignis enthält `{ id, alarmId, asset, target, currency, observedPrice, triggeredAt, acknowledgedAt, deliveryStatus }`. `lastError` kann `price_unavailable_or_stale` oder `currency_mismatch` sein. Der Worker-Zeitpunkt bezeichnet einen abgeschlossenen Prüflauf; ein einzelner Alarm kann wegen fehlender aktueller Daten weiter ohne Preisbeobachtung bleiben.

Fehler sind `{ error, code }`: 400 `invalid_input`, 401 `unauthorized`, 403 `origin_not_allowed`, 404 `not_found`, 409 `ack_required`/`id_conflict`/`subscription_required`/`subscription_conflict`, 413 `invalid_input`, 429 `rate_limited`/`alarm_limit`, 503 `server_not_configured`/`monitoring_not_ready`/`push_unavailable`, 500 `internal_error`. Die Prüfroute ist für Geräte nicht freigeschaltet.

Registrierung ist auf 10 pro IP und Stunde sowie 100 insgesamt pro Stunde begrenzt, authentifizierte Zugriffe auf 120 pro Gerät und Minute, Authentifizierungsversuche zusätzlich auf 180 pro weitergereichter IP und Minute. Test-Push: 10 pro Gerät und Stunde. Das ist ein einfacher Schutz für eine kleine private Anwendung; Proxy-Adressen sind keine Identität und ersetzen keine Fähigkeiten oder gegebenenfalls spätere Bot-Abwehr.

## Auslösung, Speicherung und Zustellung

Der Zustand lautet `active → triggered → acked`. Die erste gültige Beobachtung löst sofort aus, wenn die gewählte Bedingung bereits erfüllt ist. Andernfalls wird die letzte Beobachtung gespeichert; Gleichheit und Sprünge über das Ziel werden erfasst. Ein bestätigter Alarm wird nur mit einem ausdrücklichen `rearm` erneut aktiv. Das erhöht seine Generation. Ein spätes Bestätigen eines älteren Ereignisses kann keine neue Generation bestätigen.

Auslösung, Preisbeobachtung und ein unveränderlicher Ereignisschnappschuss werden in derselben Datenbanktransaktion gespeichert. Der eindeutige Schlüssel `(alarm_id, generation)` verhindert doppelte Ereignisse. Ein noch unbestätigter Alarm lässt sich nicht löschen. Bestätigte Ereignisse bleiben bis zu 90 Tage erhalten; unbestätigte Ereignisse werden nicht nach Zeit gelöscht. Pro Gerät sind maximal 100 gespeicherte Alarme erlaubt – die hohe Grenze der gespeicherten Kursliste gilt nicht für Hintergrundalarme.

Fehlgeschlagener Push oder ein fehlendes Abonnement entfernt das Ereignis nicht. Eine dauerhafte Warteschlange versucht die Zustellung mit zunehmender Pause erneut, höchstens einmal pro Stunde nach mehreren Fehlern. 404/410 deaktiviert das abgelaufene Abonnement; ein neues gültiges Abonnement macht wartende Ereignisse wieder zustellbar. Durch bestätigte Ereignisse werden ausstehende Wiederholungen beendet. Ein Worker-Lease verhindert parallele Prüfer; zusätzliche Zustell-Leases schützen Nachrichtenversuche.

Eine exakt einmalige Netzwerkauslieferung kann Web Push nicht zusichern: Nach einem verlorenen HTTP-Ergebnis kann ein erneuter Versuch nötig sein. Der Service Worker verwendet `eventId` im festen Notification-Tag, damit Wiederholungen eine vorhandene Mitteilung ersetzen. Derselbe Ereignis-Identifier wird als Web-Push-Topic verwendet. Bereits geschlossene Mitteilungen können bei einer Wiederholung erneut erscheinen; Safari verlangt eine sichtbare Mitteilung für einen empfangenen Push. Der dauerhafte Alarm in der App bleibt durch den eindeutigen Ereignisschlüssel trotzdem einfach vorhanden. `sent` bedeutet Annahme durch den Push-Anbieter, nicht nachgewiesene Anzeige am iPhone. Ein Klick bestätigt den Alarm ausdrücklich noch nicht.

Kurs-Push enthält `{ type: "price-alert", eventId, asset, target, currency, observedPrice, triggeredAt, range: "1W", mode: "candles" }`. Ein Test enthält `type: "push-test"`, `title` und `body`. Es werden keine Geräte- oder Scheduler-Schlüssel und keine beliebige Ziel-URL übertragen. Der Service Worker erstellt selbst eine URL desselben App-Ursprungs. Der Alarm-Sprung zeigt vorübergehend 1W, Kerzen und die Zielpreislinie; die normale gespeicherte Ansicht bleibt erhalten.

## Preisquellen und Grenzen

Binance wird serverseitig mit höchstens 20 Symbolen pro Anfrage abgefragt. Fehlende, ungültige oder ältere als fünf Minuten datierte `closeTime`-Werte fallen auf CoinGecko mit `last_updated_at` zurück; dort gilt dieselbe Altersgrenze. Identische Instrumente werden pro Lauf nur einmal abgefragt.

Die bestehende .NET-Route `/api/trading/quotes` liefert keinen Quellzeitpunkt. Der Alarmdienst nutzt deshalb die bereits vorhandene Route `/api/trading/candles?symbol=...&interval=5m&days=1` und deren jüngsten Schlusskurs. Dieser muss höchstens 20 Minuten alt sein, damit auch verzögerte Börsenquellen funktionieren. Alte Schlusskurse am Wochenende oder in längeren Handelspausen lösen nichts aus. Der Dienst prüft somit jede Minute aktuelle verfügbare Beobachtungen; er rekonstruiert keine Tick-Kreuzungen zwischen den Abfragen. Sehr kurze Zielberührungen können unbemerkt bleiben.

Ungültige, fehlende, zukünftige oder zur Alarmwährung unpassende Daten lösen nichts aus. Öffentliche Datenquellen können Rate-Limits setzen. Render Free kann den Yahoo-API-Server schlafen legen; der Dienst zeigt dann fehlende Daten und kann betroffene Börsenalarme nicht prüfen. Bis zu 200 aktive Alarme pro Lauf werden nach ältestem Prüfzeitpunkt fair bearbeitet; bei mehr gespeicherten Alarmen verlängert sich das tatsächliche Intervall. Für eine große Mehrbenutzer-Anwendung wäre eine gesonderte Kapazitätsplanung nötig.

Push-Endpunkte sind auf exakte HTTPS-Hosts `web.push.apple.com`, `fcm.googleapis.com` und `updates.push.services.mozilla.com` begrenzt; Credentials, fremde Ports, Fragmente und Weiterleitungen werden abgewiesen. Verschlüsselungsschlüssel müssen gültige P-256-Punkte mit passender Länge sein. Eine weitere Browserfamilie benötigt eine bewusst geprüfte Erweiterung dieser Liste.

## Lokale Prüfung und Geräteabnahme

```powershell
node --test tests/alarm-service*.test.mjs
npm exec --yes --package=deno@2.9.6 -- deno check --config supabase/functions/trading-alerts/deno.json supabase/functions/trading-alerts/index.ts
npm exec --yes --package=deno@2.9.6 -- deno test --allow-env=ECE_KEYLOG --config supabase/functions/trading-alerts/deno.json supabase/functions/trading-alerts/runtime_test.ts
```

Die SQL-Datei `supabase/tests/alarm_lifecycle.sql` läuft nach der Migration mit `psql -v ON_ERROR_STOP=1` auf einer wegwerfbaren PostgreSQL-Datenbank mit den Supabase-Rollen `anon`, `authenticated` und `service_role` (`BYPASSRLS`). Sie rollt Testdaten am Ende zurück. Geprüft wurden PostgreSQL 16, tatsächliche `service_role`-Rechte, RLS/Grants, Gerätegrenzen, Grenzwert-Sprung/Gleichheit, Wiederholungen, Bestätigung, Generationen und Worker-Lease. Die Deno-Prüfung verschlüsselt mit der echten gepinnten Web-Push-Bibliothek ohne Netzwerkzustellung.

Die lokalen Supabase-Advisors konnten ohne vollständigen lokalen Supabase-Stack nicht verbinden (`127.0.0.1:54322`, `ECONNREFUSED`). Deshalb bleiben Projekt-Advisors, die Vault/Cron-Verknüpfung und die tatsächliche Zustellung nach Verbindung separat zu prüfen.

Empfohlene nächste Schritte: Projekt verbinden, Migration und Secrets prüfen, Function und Cron einrichten, `/config` kontrollieren, dann am installierten iPhone nach direktem Tippen Mitteilungen aktivieren und „Testmitteilung“ senden. Anschließend einen echten Grenzwert prüfen: App schließen/iPhone sperren → Systemmitteilung → Antippen → rote Glocke weiterhin sichtbar → 1W/Ziellinie → ausdrücklich bestätigen → App neu starten. Ablehnung, abgelaufenes Abonnement, API-Ausfall und alter Prüfzeitpunkt ebenfalls testen. Lernpunkt: Push-Berechtigung wird auf iOS durch eine bewusste Nutzeraktion angefordert; sie ist keine Garantie, dass ein Hintergrunddienst schon eingerichtet ist.

## Primärquellen

- [Supabase: Edge Functions zeitgesteuert aufrufen](https://supabase.com/docs/guides/functions/schedule-functions)
- [Supabase: Funktionsauthentifizierung](https://supabase.com/docs/guides/functions/auth)
- [Supabase: Data API, Grants und RLS](https://supabase.com/docs/guides/api/securing-your-api)
- [Supabase: Vault](https://supabase.com/docs/guides/database/vault)
- [Supabase: CLI-v3-Änderungen](https://supabase.com/changelog/supabase-cli-v3)
- [web-push: generateRequestDetails und VAPID](https://github.com/web-push-libs/web-push)
- [WebKit: Web Push für Home-Screen-Web-Apps](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
