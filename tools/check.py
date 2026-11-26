#!/usr/bin/env python3
"""Sicherheits-Check für Jellywatch (nur Python-Standardbibliothek).

Prüft, dass das Theme reines, eigenständiges CSS bleibt und dass keine
Geheimnisse (API-Keys, Tokens, Passwörter) im Repository landen.

Aufruf:  python3 tools/check.py
Exit-Code 0 = alles in Ordnung, 1 = Problem gefunden.
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
THEME = ROOT / "jellywatch.css"
CONFIG = ROOT / "extras" / "config.json"
MAX_CSS_BYTES = 300_000

# Alles, womit CSS etwas nachladen, ausführen oder nach aussen senden könnte.
FORBIDDEN_IN_CSS = [
    (r"@import", "@import lädt fremde Dateien nach"),
    (r"\burl\s*\(", "url() lädt Dateien nach (auch data:-URLs sind nicht erlaubt)"),
    (r"image-set\s*\(", "image-set() lädt Bilder nach"),
    (r"(?<![-\w])image\s*\(", "image() lädt Bilder nach"),
    (r"cross-fade\s*\(", "cross-fade() lädt Bilder nach"),
    (r"element\s*\(", "element() ist nicht erlaubt"),
    (r"(?<![-\w])src\s*\(", "src() lädt Dateien nach"),
    (r"@font-face", "keine externen Schriften"),
    (r"@namespace", "nicht benötigt"),
    (r"expression\s*\(", "veraltete Skript-Ausführung (IE)"),
    (r"javascript\s*:", "Skript-URL"),
    (r"vbscript\s*:", "Skript-URL"),
    (r"behavior\s*:", "veraltete Skript-Einbindung (IE)"),
    (r"-moz-binding", "veraltete Skript-Einbindung (Firefox)"),
    (r"\bhttps?\s*:", "Internet-Adresse im Code"),
    (r"//", "Adresse ohne Protokoll (//host)"),
    (r"\bdata\s*:", "data:-URL"),
    (r"\\", "Backslash-Escapes sind verboten (könnten Verbotenes verschleiern)"),
]

# Typische Formen von Zugangsdaten.
SECRET_PATTERNS = [
    (r"(?i)(api[_-]?key|apikey|x-emby-token|x-mediabrowser-token|access[_-]?token|password|passwd|secret)\s*[\"']?\s*[:=]\s*[\"']?[A-Za-z0-9_\-+/=.]{8,}",
     "sieht nach einem Schlüssel/Passwort mit Wert aus"),
    (r"(?<![A-Za-z0-9_\-+/=])[A-Fa-f0-9]{32,}(?![A-Za-z0-9_\-+/=])", "langer Hex-Wert (z.B. Jellyfin-API-Key)"),
    (r"(?<![A-Za-z0-9_\-+/=])[A-Za-z0-9+/]{40,}={0,2}(?![A-Za-z0-9_\-+/=])", "langer Base64-Wert (z.B. Seerr-API-Key)"),
    (r"-----BEGIN [A-Z ]*PRIVATE KEY-----", "privater Schlüssel"),
    (r"\bgh[pousr]_[A-Za-z0-9]{20,}", "GitHub-Token"),
]

SKIP_DIRS = {".git", ".github", "node_modules"}
TEXT_SUFFIXES = {".css", ".md", ".json", ".txt", ".py", ".yml", ".yaml", ".sh", ".html", ".js", ""}

errors = []


def fail(msg):
    errors.append(msg)


def strip_comments(css):
    # Kommentare durch gleich viele Zeilenumbrüche ersetzen, damit Zeilennummern stimmen.
    return re.sub(r"/\*.*?\*/", lambda m: "\n" * m.group(0).count("\n"), css, flags=re.S)


def line_of(text, pos):
    return text.count("\n", 0, pos) + 1


def check_css():
    if not THEME.exists():
        fail(f"{THEME.name} fehlt")
        return
    raw = THEME.read_bytes()
    if len(raw) > MAX_CSS_BYTES:
        fail(f"{THEME.name} ist grösser als {MAX_CSS_BYTES} Bytes")
    try:
        css = raw.decode("utf-8")
    except UnicodeDecodeError:
        fail(f"{THEME.name} ist kein gültiges UTF-8")
        return
    if "/*" in strip_comments(css) or "*/" in strip_comments(css):
        fail(f"{THEME.name}: unvollständiger Kommentar")
    code = strip_comments(css)
    for pattern, why in FORBIDDEN_IN_CSS:
        for m in re.finditer(pattern, code, flags=re.I):
            fail(f"{THEME.name}:{line_of(code, m.start())}: verboten: {m.group(0)!r} – {why}")
    if code.count("{") != code.count("}"):
        fail(f"{THEME.name}: geschweifte Klammern sind nicht ausgeglichen")
    if re.search(r"</?\s*(style|script)", code, flags=re.I):
        fail(f"{THEME.name}: enthält HTML-Tags")


def check_config():
    if not CONFIG.exists():
        return
    try:
        cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    except (ValueError, UnicodeDecodeError) as exc:
        fail(f"{CONFIG.relative_to(ROOT)}: ungültiges JSON ({exc})")
        return
    for i, link in enumerate(cfg.get("menuLinks", [])):
        url = str(link.get("url", ""))
        if not url.startswith("https://"):
            fail(f"{CONFIG.relative_to(ROOT)}: menuLinks[{i}].url muss mit https:// beginnen")
        if re.search(r"(?i)(javascript|data|vbscript)\s*:", url):
            fail(f"{CONFIG.relative_to(ROOT)}: menuLinks[{i}].url enthält ein verbotenes Schema")
        if re.search(r"[?&](api[_-]?key|token)=", url, flags=re.I):
            fail(f"{CONFIG.relative_to(ROOT)}: menuLinks[{i}].url enthält einen Schlüssel – niemals Keys in Links!")
    allowed_ids = {"dark", "light", "appletv", "blueradiance", "purplehaze", "wmc"}
    for t in cfg.get("themes", []):
        if t.get("id") not in allowed_ids:
            fail(f"{CONFIG.relative_to(ROOT)}: unbekannte Theme-ID {t.get('id')!r}")


def check_secrets():
    for path in sorted(ROOT.rglob("*")):
        if not path.is_file() or any(part in SKIP_DIRS for part in path.relative_to(ROOT).parts):
            continue
        if path.suffix.lower() not in TEXT_SUFFIXES or path == pathlib.Path(__file__).resolve():
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        for pattern, why in SECRET_PATTERNS:
            for m in re.finditer(pattern, text):
                fail(f"{path.relative_to(ROOT)}:{line_of(text, m.start())}: möglicher Geheimwert ({why})")
    for name in (".env", "secrets.json", "credentials.json", "config.local.json"):
        for path in ROOT.rglob(name):
            if not any(part in SKIP_DIRS for part in path.relative_to(ROOT).parts):
                fail(f"{path.relative_to(ROOT)}: Datei mit möglichen Zugangsdaten gehört nicht ins Repository")


def main():
    check_css()
    check_config()
    check_secrets()
    if errors:
        print("Sicherheits-Check FEHLGESCHLAGEN:")
        for e in errors:
            print("  -", e)
        return 1
    print("Sicherheits-Check OK: reines CSS ohne externe Zugriffe, keine Geheimwerte gefunden.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
