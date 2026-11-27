# Sicherheit

Jellywatch besteht aus zwei Teilen:

- **`jellywatch.css`**, das Theme. Reines CSS, es kann **nichts ausführen**, lädt nichts aus dem Internet nach und sendet nichts.
- **`jellywatch.js`**, optional: die Slideshow mit Hintergrundbildern. Das Skript ist so gebaut, dass es **nur liest** und **nur mit deinem eigenen Jellyfin-Server** spricht.

## Was das Theme (CSS) macht und was nicht

- Es ändert nur Farben, Abstände, Formen und Animationen.
- Alle Grafiken sind direkt im CSS gezeichnet. Es gibt kein `@import`, kein `url()` und keine Schriften oder Bilder aus dem Internet.
- Das Theme selbst braucht kein JavaScript, kein Plugin und keinen Eingriff in Jellyfin-Dateien.
- Kein Tracking und keine Verbindung zu GitHub oder anderen Servern. Es funktioniert komplett offline.

## Was `jellywatch.js` macht und was nicht

Es macht:

- Auf der Startseite nur **lesende Anfragen** an deinen Jellyfin-Server:
  - 6 zufällige Filme mit Titel, Beschreibung und den Kennungen ihrer Bilder für die Slideshow
  - Laufzeit und Fortschritt der Karten unter „Weiterschauen“ für die Restzeit

  Das ist dieselbe Art Anfrage, die Jellyfin für seine eigenen Seiten stellt, mit der Anmeldung, die im Browser schon besteht. Jeder Benutzer sieht deshalb nur, was er sehen darf (Bibliotheks-Rechte und Altersfreigaben gelten weiter).
- Es zeigt Hintergrundbild und Logo von deinem Server an.
- Abspielen, „Mehr Infos“, Favorit und das Rechtsklick-Menü erledigt **Jellyfins eigener Code**, wie bei jeder anderen Karte.
- Für die Knopffarbe rechnet es die Durchschnittsfarbe des Hintergrundbilds aus, nur im Browser.

Es macht nicht:

- **Keine Verbindung zu anderen Servern.** Im Code steht keine einzige Adresse.
- **Kein HTML aus der Datenbank.** Titel, Beschreibung, Genres und die Restzeit werden nur als Text eingefügt (`textContent`). Ein Film mit dem Titel `<img src=x onerror=alert(1)>` zeigt genau diesen Text an und führt nichts aus.
- **Keine ungeprüften Werte in Adressen.** IDs und Bild-Kennungen werden geprüft (nur Buchstaben und Ziffern), bevor sie in eine Bild-Adresse kommen.
- **Nichts speichern.** Kein `localStorage`, keine Cookies, kein Tracking. Die zuletzt gezeigten Filme merkt es sich nur im Arbeitsspeicher, bis die Seite neu geladen wird.
- **Keine Zugangsdaten.** Es liest keine Passwörter, Tokens oder API-Keys.
- **Kein nachgeladener Code.** Kein `eval`, kein `import()`, keine weiteren Skripte.
- Wenn etwas schiefgeht, entfernt es seine Slideshow wieder, und die CSS-Version bleibt.

## Automatische Prüfung

Bei jedem Push prüft ein GitHub-Workflow (`tools/check.py`), dass das so bleibt. Der Check schlägt fehl, wenn

- im CSS `@import`, `url()`, `data:`-Adressen, Internet-Adressen, Backslash-Escapes oder etwas wie ein API-Key auftaucht,
- im Skript eines davon auftaucht: `eval` oder `Function`, `innerHTML` und andere HTML-Funktionen, `fetch`, `XMLHttpRequest` oder `WebSocket`, Adressen (`http:`, `https:`, `//`), `localStorage` oder Cookies, Fenster öffnen oder umleiten, Event-Handler als Text, Wörter wie Token oder Passwort, schreibende Funktionen von Jellyfin,
- das Skript vom Jellyfin-API-Client etwas anderes benutzt als die lesenden Funktionen `getUrl`, `getJSON`, `getCurrentUserId` und `serverId`,
- das Einbinde-Skript etwas herunterlädt, Befehle zusammensetzt oder Dateien löscht.

Du kannst den Check auch selbst laufen lassen:

```bash
python3 tools/check.py
```

## Das Einbinde-Skript (`extras/jellywatch-inject.sh`)

- Es fügt in die `index.html` von Jellyfin genau eine Zeile ein, und nur, wenn sie noch fehlt: `<script defer src="jellywatch.js"></script>`
- Es lädt nichts herunter und ändert sonst nichts.
- Es bricht den Start von Jellyfin nie ab. Fehlt etwas oder fehlen die Schreibrechte, schreibt es eine Meldung ins Log und Jellyfin startet normal.
- Im Docker-Container läuft es bei jedem Start als root, weil die `index.html` root gehört. Es ist kurz: bitte vor dem Einsatz lesen.

## Warum es keinen API-Key gibt (wichtig!)

Jellyfin liefert den „Benutzerdefinierten CSS-Code“ und die `config.json` an **jeden** aus,
der deinen Server erreicht, **auch ohne Anmeldung**:

- `https://dein-server/Branding/Css`
- `https://dein-server/web/config.json`

Dasselbe gilt für `jellywatch.js` und die `index.html`. Ein Seerr-API-Key in einer dieser Dateien wäre also öffentlich, und mit diesem Key hätte jeder
**Admin-Rechte in Seerr** (Anfragen genehmigen, Benutzer verwalten, Einstellungen ändern).

Deshalb verbindet Jellywatch Seerr nur über einen **normalen Link** (siehe README, Abschnitt Seerr).
Seerr fragt dann selbst nach der Anmeldung, am besten mit dem Jellyfin-Konto. So gibt es nirgends
einen Schlüssel, der gestohlen werden kann.

> **Regel:** Niemals API-Keys, Passwörter oder Tokens in CSS, JavaScript, die `config.json` oder in dieses Repository schreiben.

## Theme und Skript sicher einbinden

**Theme:** Den *Inhalt* von `jellywatch.css` in Jellyfin einfügen (Copy & Paste).
Dann läuft genau der Code, den du gesehen hast, und er ändert sich nie von selbst.

**Nicht empfohlen:** Das Theme per `@import url("https://…")` von GitHub oder einem CDN laden.
Dann lädt jeder Browser bei jedem Aufruf den Code von dort. Wird das Konto, das CDN oder das Repo
jemals manipuliert, landet der veränderte Code sofort bei allen Benutzern. Böswilliges CSS kann zwar
kein JavaScript ausführen, aber zum Beispiel die Oberfläche fälschen (z.B. eine falsche Login-Maske)
oder mit Attribut-Selektoren und `url()` Daten aus der Seite an fremde Server senden.

**Skript:** `jellywatch.js` als Datei auf deinen Server kopieren, so wie in der README beschrieben.
**Niemals** per `<script src="https://…">` von GitHub oder einem CDN laden. JavaScript kann viel mehr als CSS:
Ein manipuliertes Skript könnte im Namen des angemeldeten Benutzers handeln, bei einem Admin sogar den
Server verwalten. Deshalb die Datei vor dem Einsatz ansehen, eine bestimmte Version (Commit) verwenden und
bei Updates die Änderungen prüfen.

## Seerr-Link (`extras/config.json`)

- Nur `https://`-Adressen verwenden.
- Jellyfin öffnet solche Links in einem neuen Tab mit `rel="noopener noreferrer"`,
  Seerr bekommt also keinen Zugriff auf das Jellyfin-Fenster.
- Deine echte Seerr-Adresse gehört nur auf deinen Server, **nicht** in dieses öffentliche Repository.
  Lokale Dateien wie `config.local.json` und `.env` sind deshalb in `.gitignore` eingetragen.

## Empfohlene Einstellungen für das GitHub-Repository

Unter **Settings → Code security** (für öffentliche Repos kostenlos):

- **Secret scanning** und **Push protection** einschalten: GitHub blockiert dann Pushes mit Zugangsdaten.
- **Private vulnerability reporting** einschalten, damit Lücken vertraulich gemeldet werden können.

Ausserdem:

- Zwei-Faktor-Anmeldung (2FA) für das GitHub-Konto aktivieren.
- Unter **Settings → Branches** den `main`-Branch schützen (z.B. „Require a pull request before merging“
  und „Require status checks to pass“ mit dem Sicherheits-Check).

## Sicherheitslücke melden

Bitte **kein** öffentliches Issue erstellen. Stattdessen im Repository unter
**Security → Report a vulnerability** eine vertrauliche Meldung schicken.
