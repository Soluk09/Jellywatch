# Sicherheit

Jellywatch ist absichtlich so gebaut, dass es **nichts kann, was gefährlich werden könnte**:
Es ist reines CSS, ohne JavaScript, lädt nichts aus dem Internet nach und sendet nichts.

## Was das Theme macht und was nicht

| | |
|---|---|
| ✅ Ändert nur Farben, Abstände, Formen und Animationen | ❌ Kein JavaScript, kein Plugin, kein Eingriff in Jellyfin-Dateien |
| ✅ Alle Grafiken (Logo, Verläufe) sind direkt im CSS gezeichnet | ❌ Kein `@import`, kein `url()`, keine Schriften oder Bilder aus dem Internet |
| ✅ Funktioniert komplett offline | ❌ Kein Tracking, keine Statistik, keine Verbindung zu GitHub oder CDNs |

Bei jedem Push prüft ein GitHub-Workflow (`tools/check.py`) automatisch, dass das so bleibt.
Der Check schlägt fehl, wenn jemand (auch versehentlich) `@import`, `url()`, `data:`-Adressen,
Internet-Adressen, Backslash-Escapes oder etwas hinzufügt, das wie ein API-Key aussieht.
Du kannst ihn auch selbst laufen lassen:

```bash
python3 tools/check.py
```

## Warum es keinen API-Key gibt (wichtig!)

Jellyfin liefert den „Benutzerdefinierten CSS-Code“ und die `config.json` an **jeden** aus,
der deinen Server erreicht, **auch ohne Anmeldung**:

- `https://dein-server/Branding/Css`
- `https://dein-server/web/config.json`

Ein Seerr-API-Key im CSS oder in der `config.json` wäre also öffentlich, und mit diesem Key hätte jeder
**Admin-Rechte in Seerr** (Anfragen genehmigen, Benutzer verwalten, Einstellungen ändern).

Deshalb verbindet Jellywatch Seerr nur über einen **normalen Link** (siehe README, Abschnitt Seerr).
Seerr fragt dann selbst nach der Anmeldung, am besten mit dem Jellyfin-Konto. So gibt es nirgends
einen Schlüssel, der gestohlen werden kann.

> **Regel:** Niemals API-Keys, Passwörter oder Tokens in CSS, in die `config.json` oder in dieses Repository schreiben.

## Theme sicher einbinden

**Empfohlen:** Den *Inhalt* von `jellywatch.css` in Jellyfin einfügen (Copy & Paste).
Dann läuft genau der Code, den du gesehen hast, und er ändert sich nie von selbst.

**Nicht empfohlen:** Das Theme per `@import url("https://…")` von GitHub oder einem CDN laden.
Dann lädt jeder Browser bei jedem Aufruf den Code von dort. Wird das Konto, das CDN oder das Repo
jemals manipuliert, landet der veränderte Code sofort bei allen Benutzern. Böswilliges CSS kann zwar
kein JavaScript ausführen, aber zum Beispiel die Oberfläche fälschen (z.B. eine falsche Login-Maske)
oder mit Attribut-Selektoren und `url()` Daten aus der Seite an fremde Server senden.

Wer trotzdem `@import` nutzen will, sollte es auf einen festen Commit festnageln (nicht `@main`)
und vorher prüfen, was in genau diesem Commit steht.

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
