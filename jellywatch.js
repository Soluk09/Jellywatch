/*!
 * Jellywatch – Slideshow mit Hintergrundbildern für die Jellyfin-Startseite
 * Teil von Soluk09/Jellywatch auf GitHub. Optional, braucht das Jellywatch-CSS.
 *
 * Zeigt oben auf der Startseite zufällige Filme aus der ganzen Bibliothek, mit
 * dem grossen Hintergrundbild, Logo, Beschreibung, Pfeilen und Punkten.
 * Bei "Weiterschauen" steht zusätzlich die Restzeit unter dem Titel.
 *
 * Sicherheit:
 * - Spricht nur mit deinem eigenen Jellyfin-Server, über die Anmeldung, die im
 *   Browser schon besteht. Es gibt keine Adressen zu anderen Servern.
 * - Stellt nur lesende Anfragen: eine Liste von Filmen für die Slideshow und
 *   Laufzeit und Fortschritt der Karten bei "Weiterschauen". Abspielen, Favorit
 *   und "Mehr Infos" laufen über Jellyfins eigene Knöpfe und Funktionen.
 * - Titel und Beschreibungen werden nur als Text eingefügt, nie als HTML.
 * - IDs und Bild-Kennungen werden geprüft, bevor sie in eine Adresse kommen.
 * - Speichert nichts und liest keine Zugangsdaten.
 * - Wenn etwas schiefgeht, verschwindet die Slideshow und die CSS-Version bleibt.
 */
(function () {
    'use strict';

    if (window.__jellywatch) {
        return;
    }
    window.__jellywatch = true;

    var COUNT = 6;
    var ID_RE = /^[0-9a-f]{32}$/i;
    var TAG_RE = /^[0-9a-z]{1,64}$/i;
    var HTML = document.documentElement;
    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    var MEMORY_MS = 30 * 60 * 1000;

    var building = false;
    var failures = 0;
    var active = null;
    var memory = null; /* zuletzt gezeigte Filme, nur im Arbeitsspeicher dieser Seite */

    function t(de, en) {
        return (HTML.getAttribute('lang') || '').toLowerCase().indexOf('de') === 0 ? de : en;
    }

    /* Nur laufen, wenn das Jellywatch-CSS installiert ist (und --jw-js nicht auf 0 steht) */
    function themeReady() {
        return getComputedStyle(HTML).getPropertyValue('--jw-js').trim() === '1';
    }

    function getClient() {
        var c = window.ApiClient;
        if (!c || typeof c.getUrl !== 'function' || typeof c.getJSON !== 'function'
            || typeof c.getCurrentUserId !== 'function' || typeof c.serverId !== 'function') {
            return null;
        }
        var userId = c.getCurrentUserId();
        var serverId = c.serverId();
        if (typeof userId !== 'string' || !ID_RE.test(userId) || typeof serverId !== 'string' || !ID_RE.test(serverId)) {
            return null;
        }
        return c;
    }

    function el(tag, className, attrs) {
        var e = document.createElement(tag);
        if (className) {
            e.className = className;
        }
        if (attrs) {
            Object.keys(attrs).forEach(function (k) {
                e.setAttribute(k, String(attrs[k]));
            });
        }
        return e;
    }

    function icon(name) {
        return el('span', 'material-icons ' + name, { 'aria-hidden': 'true' });
    }

    function text(value, className) {
        var s = el('span', className);
        s.textContent = value;
        return s;
    }

    function isValidItem(it) {
        return it !== null && typeof it === 'object'
            && typeof it.Id === 'string' && ID_RE.test(it.Id)
            && Array.isArray(it.BackdropImageTags) && typeof it.BackdropImageTags[0] === 'string'
            && TAG_RE.test(it.BackdropImageTags[0]);
    }

    function imageWidth() {
        var w = window.innerWidth * (window.devicePixelRatio || 1);
        return w <= 800 ? 960 : w <= 1500 ? 1440 : 1920;
    }

    function imageUrl(client, id, path, tag, maxWidth) {
        return client.getUrl('Items/' + id + '/Images/' + path, { maxWidth: maxWidth, quality: 90, tag: tag });
    }

    function runtime(ticks) {
        var minutes = Math.round(ticks / 600000000);
        if (!isFinite(minutes) || minutes <= 0) {
            return '';
        }
        var h = Math.floor(minutes / 60);
        var m = minutes % 60;
        return h > 0 ? h + ' h ' + m + ' min' : m + ' min';
    }

    function loadItems(client) {
        var userId = client.getCurrentUserId();
        var fields = {
            userId: userId,
            IncludeItemTypes: 'Movie',
            Recursive: true,
            ImageTypes: 'Backdrop',
            Fields: 'Overview,Genres',
            EnableImageTypes: 'Backdrop,Logo',
            ImageTypeLimit: 1,
            EnableUserData: true,
            EnableTotalRecordCount: false
        };
        var random = Object.assign({ SortBy: 'Random', Limit: COUNT }, fields);

        function items(res) {
            return res && Array.isArray(res.Items) ? res.Items.filter(isValidItem) : [];
        }

        /* Zurück auf der Startseite: dieselben Filme (mit frischem Favoriten- und Fortschritts-Stand) */
        if (memory && memory.user === userId && Date.now() - memory.time < MEMORY_MS) {
            var ids = memory.ids;
            return client.getJSON(client.getUrl('Items', Object.assign({ Ids: ids.join(',') }, fields))).then(function (res) {
                var list = items(res).sort(function (a, b) {
                    return ids.indexOf(a.Id) - ids.indexOf(b.Id);
                });
                if (list.length) {
                    return list;
                }
                memory = null;
                return loadItems(client);
            });
        }

        /* Sonst zufällig: zuerst ungesehene Filme, wenn es zu wenige gibt alle */
        return client.getJSON(client.getUrl('Items', Object.assign({ IsPlayed: false }, random))).then(function (res) {
            var list = items(res);
            if (list.length >= 3) {
                return list;
            }
            return client.getJSON(client.getUrl('Items', random)).then(items);
        }).then(function (list) {
            list = list.slice(0, COUNT);
            memory = {
                user: userId,
                ids: list.map(function (it) {
                    return it.Id;
                }),
                index: 0,
                time: Date.now()
            };
            return list;
        });
    }

    /* ---------- Knopffarbe aus dem Hintergrundbild ---------- */

    function hslToRgb(h, s, l) {
        var c = (1 - Math.abs(2 * l - 1)) * s;
        var x = c * (1 - Math.abs((h / 60) % 2 - 1));
        var m = l - c / 2;
        var p = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
        return [p[0] + m, p[1] + m, p[2] + m];
    }

    function luminance(rgb) {
        var lin = rgb.map(function (v) {
            return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
    }

    /* Durchschnittsfarbe kräftiger machen und so weit abdunkeln, dass weisse Schrift gut lesbar ist */
    function buttonTone(r, g, b) {
        var max = Math.max(r, g, b);
        var min = Math.min(r, g, b);
        var d = max - min;
        var l = (max + min) / 2;
        var s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
        var h = 0;
        if (d > 0) {
            if (max === r) {
                h = ((g - b) / d + 6) % 6;
            } else if (max === g) {
                h = (b - r) / d + 2;
            } else {
                h = (r - g) / d + 4;
            }
            h *= 60;
        }
        if (s < 0.08) {
            return null; /* fast grau: Theme-Farbe verwenden */
        }
        s = Math.min(0.7, Math.max(0.4, s * 1.4));
        l = Math.min(0.42, Math.max(0.24, l));
        var rgb = hslToRgb(h, s, l);
        while (luminance(rgb) > 0.17 && l > 0.1) {
            l -= 0.02;
            rgb = hslToRgb(h, s, l);
        }
        return rgb.map(function (v) {
            return Math.round(Math.min(1, Math.max(0, v)) * 255);
        });
    }

    function filmColor(img) {
        try {
            var w = 32;
            var h = 18;
            var canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            var ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) {
                return null;
            }
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, w, h);
            var data = ctx.getImageData(0, 0, w, h).data;
            var r = 0;
            var g = 0;
            var b = 0;
            for (var i = 0; i < data.length; i += 4) {
                r += data[i];
                g += data[i + 1];
                b += data[i + 2];
            }
            var n = data.length / 4 * 255;
            return buttonTone(r / n, g / n, b / n);
        } catch (e) {
            return null; /* z.B. Bild von einer anderen Adresse: dann bleibt die Theme-Farbe */
        }
    }

    /* ---------- Folien ---------- */

    function buildSlide(client, item, index, total) {
        var serverId = client.serverId();
        var slide = el('div', 'jw-slide itemAction', {
            'data-action': 'link',
            'data-id': item.Id,
            'data-serverid': serverId,
            'data-type': 'Movie',
            'data-mediatype': 'Video',
            'data-isfolder': 'false',
            role: 'group',
            'aria-roledescription': t('Folie', 'slide'),
            'aria-label': (index + 1) + ' / ' + total
        });

        var bg = el('img', 'jw-slide-bg', { alt: '', decoding: 'async', draggable: 'false' });
        bg.addEventListener('load', function () {
            slide.classList.add('is-loaded');
            var rgb = filmColor(bg);
            if (rgb) {
                slide.style.setProperty('--jw-film', 'rgb(' + rgb.join(' ') + ')');
                slide.style.setProperty('--jw-film-ch', rgb.join(' '));
            }
        });
        slide.appendChild(bg);

        var content = el('div', 'jw-slide-content');
        var name = typeof item.Name === 'string' ? item.Name : '';
        var title = el('h2', 'jw-slide-title');
        title.textContent = name;

        var logo = null;
        var logoTag = item.ImageTags && item.ImageTags.Logo;
        if (typeof logoTag === 'string' && TAG_RE.test(logoTag)) {
            logo = el('img', 'jw-slide-logo', { decoding: 'async', draggable: 'false' });
            logo.alt = name;
            logo.addEventListener('error', function () {
                logo.remove();
                title.classList.remove('jw-sr-only');
            });
            title.classList.add('jw-sr-only');
            content.appendChild(logo);
        }
        content.appendChild(title);

        var meta = el('div', 'jw-slide-meta');
        if (Number.isInteger(item.ProductionYear)) {
            meta.appendChild(text(String(item.ProductionYear)));
        }
        if (typeof item.RunTimeTicks === 'number' && runtime(item.RunTimeTicks)) {
            meta.appendChild(text(runtime(item.RunTimeTicks)));
        }
        if (typeof item.OfficialRating === 'string' && item.OfficialRating) {
            meta.appendChild(text(item.OfficialRating.slice(0, 20), 'jw-badge'));
        }
        if (typeof item.CommunityRating === 'number' && isFinite(item.CommunityRating)) {
            meta.appendChild(text('★ ' + item.CommunityRating.toFixed(1)));
        }
        if (Array.isArray(item.Genres)) {
            var genres = item.Genres.filter(function (g) {
                return typeof g === 'string' && g;
            }).slice(0, 3);
            if (genres.length) {
                meta.appendChild(text(genres.join(', ')));
            }
        }
        if (meta.childNodes.length) {
            content.appendChild(meta);
        }

        if (typeof item.Overview === 'string' && item.Overview) {
            var overview = el('p', 'jw-slide-overview');
            overview.textContent = item.Overview;
            content.appendChild(overview);
        }

        var userData = item.UserData && typeof item.UserData === 'object' ? item.UserData : {};
        var position = typeof userData.PlaybackPositionTicks === 'number' && isFinite(userData.PlaybackPositionTicks)
            ? Math.max(0, Math.floor(userData.PlaybackPositionTicks)) : 0;
        if (position > 0) {
            slide.setAttribute('data-positionticks', String(position));
        }

        var buttons = el('div', 'jw-slide-buttons');
        var play = el('button', 'jw-btn jw-btn-play itemAction', { type: 'button', 'data-action': position > 0 ? 'resume' : 'play' });
        play.appendChild(icon('play_arrow'));
        play.appendChild(text(position > 0 ? t('Fortsetzen', 'Resume') : t('Abspielen', 'Play')));

        var info = el('button', 'jw-btn jw-btn-info itemAction', { type: 'button', 'data-action': 'link' });
        info.appendChild(icon('info_outline'));
        info.appendChild(text(t('Mehr Infos', 'More info')));

        /* Jellyfins eigener Favoriten-Knopf (merkt sich den Favoriten selbst) */
        var fav = el('button', 'jw-btn jw-btn-round itemAction', {
            is: 'emby-ratingbutton',
            type: 'button',
            'data-action': 'none',
            'data-id': item.Id,
            'data-serverid': serverId,
            'data-itemtype': 'Movie',
            'data-likes': '',
            'data-isfavorite': userData.IsFavorite === true ? 'true' : 'false',
            title: t('Favorit', 'Favorite')
        });
        fav.appendChild(icon('favorite'));

        buttons.appendChild(play);
        buttons.appendChild(info);
        buttons.appendChild(fav);
        content.appendChild(buttons);
        slide.appendChild(content);

        var width = imageWidth();
        function load() {
            if (!bg.getAttribute('src')) {
                bg.src = imageUrl(client, item.Id, 'Backdrop/0', item.BackdropImageTags[0], width);
                if (logo) {
                    logo.src = imageUrl(client, item.Id, 'Logo', logoTag, 800);
                }
            }
        }

        return { slide: slide, load: load };
    }

    /* ---------- Ablauf ---------- */

    function Hero(root, parts) {
        this.root = root;
        this.slides = parts.map(function (p) {
            return p.slide;
        });
        this.loaders = parts.map(function (p) {
            return p.load;
        });
        this.dots = [];
        this.index = 0;
        this.timer = 0;
        this.started = 0;
        this.remaining = 0;
        this.hovered = false;
        this.focused = false;
        this.visible = true;
        this.interval = this.readInterval();
    }

    Hero.prototype.readInterval = function () {
        var raw = getComputedStyle(HTML).getPropertyValue('--jw-hero-interval').trim();
        var n = parseFloat(raw);
        if (!isFinite(n) || n <= 0) {
            return 7000;
        }
        var ms = /ms$/.test(raw) ? n : n * 1000;
        return Math.min(60000, Math.max(3000, ms));
    };

    Hero.prototype.show = function (i) {
        var n = this.slides.length;
        var next = ((i % n) + n) % n;
        var old = this.slides[this.index];

        /* Tastatur-Fokus auf den gleichen Knopf der neuen Folie mitnehmen */
        var focusTarget = null;
        var current = document.activeElement;
        if (old && current && old !== this.slides[next] && old.contains(current)) {
            var oldButtons = Array.prototype.slice.call(old.querySelectorAll('.jw-btn'));
            var k = oldButtons.indexOf(current);
            focusTarget = this.slides[next].querySelectorAll('.jw-btn')[k < 0 ? 0 : k] || this.root;
        }

        this.index = next;
        if (memory) {
            memory.index = next;
        }
        this.loaders[next]();
        this.loaders[(next + 1) % n]();

        this.slides.forEach(function (s, k) {
            var on = k === next;
            s.classList.toggle('is-active', on);
            s.setAttribute('aria-hidden', on ? 'false' : 'true');
            s.inert = !on;
        });
        this.dots.forEach(function (d, k) {
            d.classList.remove('is-active');
            d.setAttribute('aria-current', k === next ? 'true' : 'false');
        });
        var dot = this.dots[next];
        if (dot) {
            void dot.offsetWidth; /* Fortschritts-Animation neu starten */
            dot.classList.add('is-active');
        }
        if (focusTarget) {
            focusTarget.focus({ preventScroll: true });
        }
        this.remaining = this.interval;
        this.schedule();
    };

    Hero.prototype.canRun = function () {
        /* .dialogContainer: ein Menü oder Dialog von Jellyfin ist offen (z.B. Rechtsklick-Menü) */
        return !reduceMotion.matches && !this.hovered && !this.focused && this.visible
            && !document.hidden && this.slides.length > 1 && !document.querySelector('.dialogContainer');
    };

    Hero.prototype.schedule = function () {
        var self = this;
        clearTimeout(this.timer);
        this.timer = 0;
        this.root.classList.toggle('is-paused', !this.canRun());
        if (!this.canRun()) {
            return;
        }
        this.started = Date.now();
        this.timer = setTimeout(function () {
            self.timer = 0;
            if (!self.root.isConnected) {
                self.destroy();
                return;
            }
            self.show(self.index + 1);
        }, this.remaining);
    };

    Hero.prototype.pause = function () {
        if (this.timer) {
            this.remaining = Math.max(400, this.remaining - (Date.now() - this.started));
            clearTimeout(this.timer);
            this.timer = 0;
        }
        this.root.classList.add('is-paused');
    };

    Hero.prototype.update = function () {
        if (this.canRun()) {
            if (!this.timer) {
                this.schedule();
            }
        } else {
            this.pause();
        }
    };

    Hero.prototype.destroy = function () {
        clearTimeout(this.timer);
        this.timer = 0;
        if (this.io) {
            this.io.disconnect();
        }
        document.removeEventListener('visibilitychange', this.handleVisibility);
        if (active === this) {
            active = null;
        }
    };

    Hero.prototype.start = function (controls, first) {
        var self = this;
        var root = this.root;
        this.dots = controls.dots;
        root.style.setProperty('--jw-dot-duration', this.interval + 'ms');

        function go(delta) {
            return function (e) {
                e.preventDefault();
                e.stopPropagation();
                self.show(self.index + delta);
            };
        }
        controls.prev.addEventListener('click', go(-1));
        controls.next.addEventListener('click', go(1));
        controls.dots.forEach(function (d, k) {
            d.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                self.show(k);
            });
        });

        /* Anhalten, solange die Maus darauf ist oder ein Knopf per Tastatur fokussiert ist */
        root.addEventListener('pointerenter', function (e) {
            if (e.pointerType === 'mouse') {
                self.hovered = true;
                self.update();
            }
        });
        root.addEventListener('pointerleave', function (e) {
            if (e.pointerType === 'mouse') {
                self.hovered = false;
                self.update();
            }
        });
        root.addEventListener('focusin', function (e) {
            var keyboard = false;
            try {
                keyboard = e.target.matches(':focus-visible');
            } catch (err) {
                keyboard = false;
            }
            self.focused = keyboard;
            self.update();
        });
        root.addEventListener('focusout', function (e) {
            if (!e.relatedTarget || !root.contains(e.relatedTarget)) {
                self.focused = false;
                self.update();
            }
        });
        root.addEventListener('keydown', function (e) {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
                self.show(self.index + (e.key === 'ArrowRight' ? 1 : -1));
            }
        });

        /* Wischen auf dem Handy */
        var startX = null;
        var startY = 0;
        root.addEventListener('pointerdown', function (e) {
            startX = e.pointerType === 'mouse' ? null : e.clientX;
            startY = e.clientY;
        });
        root.addEventListener('pointerup', function (e) {
            if (startX === null) {
                return;
            }
            var dx = e.clientX - startX;
            var dy = e.clientY - startY;
            startX = null;
            if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
                self.show(self.index + (dx < 0 ? 1 : -1));
            }
        });
        root.addEventListener('pointercancel', function () {
            startX = null;
        });

        this.handleVisibility = function () {
            self.update();
        };
        document.addEventListener('visibilitychange', this.handleVisibility);

        if ('IntersectionObserver' in window) {
            this.io = new IntersectionObserver(function (entries) {
                self.visible = entries[entries.length - 1].isIntersecting;
                self.update();
            });
            this.io.observe(root);
        }

        this.show(first);
    };

    function buildHero(client, items) {
        var root = el('div', 'jw-hero', {
            is: 'emby-itemscontainer',
            'data-contextmenu': 'true',
            'data-jw-user': client.getCurrentUserId(),
            role: 'region',
            'aria-roledescription': t('Karussell', 'carousel'),
            'aria-label': t('Empfohlene Filme', 'Featured movies'),
            tabindex: '-1'
        });
        var parts = items.map(function (it, i) {
            return buildSlide(client, it, i, items.length);
        });
        parts.forEach(function (p) {
            root.appendChild(p.slide);
        });

        var prev = el('button', 'jw-hero-arrow jw-hero-prev', { type: 'button', 'aria-label': t('Vorheriger Film', 'Previous movie') });
        prev.appendChild(icon('chevron_left'));
        var next = el('button', 'jw-hero-arrow jw-hero-next', { type: 'button', 'aria-label': t('Nächster Film', 'Next movie') });
        next.appendChild(icon('chevron_right'));
        var dotBar = el('div', 'jw-hero-dots');
        var dots = items.map(function (it, i) {
            var d = el('button', 'jw-dot', { type: 'button', 'aria-label': t('Film ', 'Movie ') + (i + 1) });
            dotBar.appendChild(d);
            return d;
        });
        if (items.length > 1) {
            root.appendChild(prev);
            root.appendChild(next);
            root.appendChild(dotBar);
        }
        return { root: root, parts: parts, controls: { prev: prev, next: next, dots: dots } };
    }

    /* ---------- Restzeit bei "Weiterschauen" ---------- */

    var remainInfo = {}; /* id -> { key: Position laut Karte, rt: Laufzeit, pos: Position } */
    var remainBusy = false;

    function remainingText(ticks) {
        var minutes = Math.max(1, Math.round(ticks / 600000000));
        var h = Math.floor(minutes / 60);
        var m = minutes % 60;
        var value = h > 0 ? h + ' h ' + m + ' min' : m + ' min';
        return t('noch ' + value, value + ' left');
    }

    function resumeCards() {
        return Array.prototype.slice.call(document.querySelectorAll(
            '#indexPage:not(.hide) .homeSectionsContainer .overflowBackdropCard[data-positionticks]'));
    }

    function showRemaining(card, info) {
        var line = card.querySelector('.cardText-secondary');
        if (!line || !info || !(info.rt > 0) || !(info.rt > info.pos)) {
            return;
        }
        var label = remainingText(info.rt - info.pos);
        var span = line.querySelector(':scope > .jw-remain');
        if (!span) {
            span = el('span', 'jw-remain');
            line.appendChild(span);
        }
        if (span.textContent !== label) {
            span.textContent = label;
        }
    }

    function updateRemaining() {
        if (remainBusy || HTML.classList.contains('layout-tv')) {
            return;
        }
        var cards = resumeCards();
        if (!cards.length || !themeReady()) {
            return;
        }
        var client = getClient();
        if (!client) {
            return;
        }
        var missing = [];
        cards.forEach(function (card) {
            var id = card.getAttribute('data-id');
            if (typeof id !== 'string' || !ID_RE.test(id)) {
                return;
            }
            var key = card.getAttribute('data-positionticks') || '';
            var info = remainInfo[id];
            if (info && info.key === key) {
                if (!card.querySelector('.cardText-secondary > .jw-remain')) {
                    showRemaining(card, info);
                }
            } else if (missing.length < 50) {
                /* jede Karte mit derselben Position nur einmal nachfragen */
                remainInfo[id] = { key: key, rt: 0, pos: 0 };
                missing.push(id);
            }
        });
        if (!missing.length) {
            return;
        }
        remainBusy = true;
        client.getJSON(client.getUrl('Items', {
            userId: client.getCurrentUserId(),
            Ids: missing.join(','),
            EnableImages: false,
            EnableUserData: true,
            EnableTotalRecordCount: false
        })).then(function (res) {
            (res && Array.isArray(res.Items) ? res.Items : []).forEach(function (it) {
                if (!it || typeof it.Id !== 'string' || !ID_RE.test(it.Id) || !remainInfo[it.Id]) {
                    return;
                }
                var rt = typeof it.RunTimeTicks === 'number' && isFinite(it.RunTimeTicks) ? it.RunTimeTicks : 0;
                var ud = it.UserData && typeof it.UserData === 'object' ? it.UserData : {};
                var pos = typeof ud.PlaybackPositionTicks === 'number' && isFinite(ud.PlaybackPositionTicks) ? ud.PlaybackPositionTicks : 0;
                remainInfo[it.Id].rt = rt;
                remainInfo[it.Id].pos = pos;
            });
            resumeCards().forEach(function (card) {
                var info = remainInfo[card.getAttribute('data-id')];
                if (info && info.key === (card.getAttribute('data-positionticks') || '')) {
                    showRemaining(card, info);
                }
            });
        }).catch(function () {
            /* ohne Restzeit weitermachen */
        }).then(function () {
            remainBusy = false;
        });
    }

    /* ---------- Einbau in die Startseite ---------- */

    function homeTab() {
        return document.querySelector('#indexPage:not(.hide) #homeTab');
    }

    function ensure() {
        if (building || HTML.classList.contains('layout-tv')) {
            return;
        }
        var tab = homeTab();
        if (!tab) {
            return;
        }
        var client = getClient();
        if (!client) {
            return;
        }
        var existing = tab.querySelector(':scope > .jw-hero');
        if (existing) {
            if (existing.getAttribute('data-jw-user') === client.getCurrentUserId()) {
                return;
            }
            existing.remove(); /* anderer Benutzer angemeldet: neu laden */
        }
        if (failures > 2 || !themeReady()) {
            return;
        }

        building = true;
        HTML.classList.add('jw-js-hero');
        var placeholder = el('div', 'jw-hero is-loading', { 'aria-hidden': 'true', 'data-jw-user': client.getCurrentUserId() });
        tab.insertBefore(placeholder, tab.firstChild);

        loadItems(client).then(function (items) {
            if (!items.length) {
                throw new Error(t('keine Filme mit Hintergrundbild gefunden', 'no movies with a backdrop found'));
            }
            if (!placeholder.isConnected) {
                return;
            }
            var first = memory && memory.index < items.length ? memory.index : 0;
            var hero = buildHero(client, items);
            placeholder.replaceWith(hero.root);
            if (active) {
                active.destroy();
            }
            active = new Hero(hero.root, hero.parts);
            active.start(hero.controls, first);
        }).catch(function (err) {
            failures += 1;
            placeholder.remove();
            HTML.classList.remove('jw-js-hero');
            console.warn('[Jellywatch]', t('Slideshow nicht verfügbar, die CSS-Version bleibt aktiv:', 'slideshow unavailable, using the CSS version:'),
                err && err.message ? err.message : err);
        }).then(function () {
            building = false;
        });
    }

    var queued = false;
    function queue() {
        if (queued) {
            return;
        }
        queued = true;
        setTimeout(function () {
            queued = false;
            try {
                ensure();
                if (active) {
                    active.update();
                }
                updateRemaining();
            } catch (e) {
                building = false;
                console.warn('[Jellywatch]', e && e.message ? e.message : e);
            }
        }, 150);
    }

    new MutationObserver(queue).observe(HTML, { childList: true, subtree: true });
    window.addEventListener('hashchange', queue);
    queue();
}());
