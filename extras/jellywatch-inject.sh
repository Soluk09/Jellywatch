#!/bin/sh
# Jellywatch: bindet jellywatch.js in die Weboberfläche von Jellyfin ein.
#
# Fügt in index.html genau eine Zeile ein, und nur, wenn sie noch fehlt:
#   <script defer src="jellywatch.js"></script>
# Lädt nichts herunter und ändert sonst nichts. Bricht nie den Start von Jellyfin ab.
#
# Aufruf:   sh jellywatch-inject.sh [WEB-ORDNER] [PROGRAMM ...]
# WEB-ORDNER   Ordner mit der index.html von Jellyfin (ohne Angabe wird gesucht)
# PROGRAMM     wird danach gestartet, z.B. /jellyfin/jellyfin im Docker-Image
#
# Entfernen: die Zeile oben aus index.html löschen (oder Jellyfin neu installieren).

LINE='<script defer src="jellywatch.js"></script>'

dir=""
if [ "$#" -gt 0 ]; then
    dir="$1"
    shift
fi
if [ -z "$dir" ]; then
    for d in /jellyfin/jellyfin-web /usr/share/jellyfin/web /usr/lib/jellyfin/bin/jellyfin-web; do
        if [ -f "$d/index.html" ]; then
            dir="$d"
            break
        fi
    done
fi

inject() {
    if [ -z "$dir" ] || [ ! -f "$dir/index.html" ]; then
        echo "Jellywatch: index.html von Jellyfin nicht gefunden, nichts geändert." >&2
        return
    fi
    if [ ! -f "$dir/jellywatch.js" ]; then
        echo "Jellywatch: $dir/jellywatch.js fehlt, nichts geändert." >&2
        return
    fi
    if grep -q 'src="jellywatch.js"' "$dir/index.html"; then
        echo "Jellywatch: schon eingebunden."
        return
    fi
    if ! grep -q '</body>' "$dir/index.html"; then
        echo "Jellywatch: unbekannter Aufbau von index.html, nichts geändert." >&2
        return
    fi
    if sed -i "s#</body>#$LINE</body>#" "$dir/index.html"; then
        echo "Jellywatch: in $dir/index.html eingebunden."
    else
        echo "Jellywatch: keine Schreibrechte für $dir/index.html, nichts geändert." >&2
    fi
}

inject

if [ "$#" -gt 0 ]; then
    exec "$@"
fi
exit 0
