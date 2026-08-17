// ==UserScript==
// @name         RezkaPlus Fetch Test
// @namespace    https://www.youtube.com/watch?v=dQw4w9WgXcQ
// @version      0.3
// @description  TEST: fetch iframe.cloud через прокси + ретрай + ловля .m3u8 потоков для скачивания
// @author       Cheba
// @match        *://*/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    const PROXY_URL = 'https://proxy4.rte.net.ru/';
    const MAX_ATTEMPTS = 10;
    const BACKOFF_MS = [500, 1000, 2000, 4000];
    const M3U8_RE = /\.m3u8([?#]|$)/i;

    const isRezka = /(^|\.)(hdrezka|rezka)\.(ag|fi)$/i.test(location.hostname);
    const isTop = (window === window.top);

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    const hostOf = (u) => { try { return new URL(u).hostname; } catch (e) { return ''; } };
    const esc = (s) => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

    // ---------------------------------------------------------------
    // Ловля .m3u8: работает внутри iframe плееров (кросс-доменных тоже),
    // шлёт найденные URL наверх через postMessage.
    // ---------------------------------------------------------------
    function installCaptureHook() {
        if (window.__frkpCapture) return;
        window.__frkpCapture = true;

        const seen = new Set();

        const send = (msg) => { try { window.top.postMessage(msg, '*'); } catch (e) {} };

        const parseMaster = async (url) => {
            try {
                const resp = await window.fetch(url);
                if (!resp.ok) return;
                const text = await resp.text();
                if (!text.includes('#EXT-X-STREAM-INF')) return;
                const qualities = [];
                const re = /#EXT-X-STREAM-INF:([^\r\n]*)[\r\n]+([^\r\n#][^\r\n]*)/g;
                let m;
                while ((m = re.exec(text))) {
                    const attrs = m[1] || '';
                    const rmatch = attrs.match(/RESOLUTION=(\d+)x(\d+)/i);
                    const name = rmatch ? (rmatch[2] + 'p') : ('Вариант ' + (qualities.length + 1));
                    let u;
                    try { u = new URL(m[2].trim(), url).href; } catch (e) { u = m[2]; }
                    qualities.push({ name, url: u });
                }
                if (qualities.length > 0) {
                    send({ source: 'frkp-dl', type: 'qualities', master: url, qualities });
                }
            } catch (e) {}
        };

        const report = (url) => {
            if (typeof url !== 'string') return;
            if (!M3U8_RE.test(url)) return;
            if (seen.has(url)) return;
            seen.add(url);
            send({ source: 'frkp-dl', type: 'm3u8', url });
            parseMaster(url);
        };

        const origFetch = window.fetch;
        if (origFetch) {
            window.fetch = function(...args) {
                try {
                    const a0 = args[0];
                    if (typeof a0 === 'string') report(a0);
                    else if (a0 && a0.url) report(a0.url);
                } catch (e) {}
                return origFetch.apply(this, args);
            };
        }

        const origOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url, ...rest) {
            try { report(String(url)); } catch (e) {}
            return origOpen.call(this, method, url, ...rest);
        };
    }

    if (!isTop) {
        installCaptureHook();
        return;
    }

    if (!isRezka) return;

    // ---------------------------------------------------------------
    // Дальше — только top-frame на Rezka: UI плеера + скачивание.
    // ---------------------------------------------------------------

    const dlEntries = [];
    const dlSeen = new Set();
    let dlPanelEl = null;

    const addEntry = (label, url) => {
        if (dlSeen.has(url)) return;
        dlSeen.add(url);
        dlEntries.push({ label, url });
        renderDlPanel();
    };

    window.addEventListener('message', (e) => {
        const d = e.data;
        if (!d || d.source !== 'frkp-dl') return;
        if (d.type === 'qualities') {
            const h = hostOf(d.master);
            d.qualities.forEach(q => addEntry(q.name + (h ? ' · ' + h : ''), q.url));
        } else if (d.type === 'm3u8') {
            const h = hostOf(d.url);
            addEntry('Поток' + (h ? ' · ' + h : ''), d.url);
        }
    });

    let toastEl = null;
    const toast = (text) => {
        if (!toastEl) {
            toastEl = document.createElement('div');
            toastEl.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#1a2035;color:#fff;padding:10px 18px;border-radius:8px;font-size:13px;z-index:999999;box-shadow:0 4px 20px rgba(0,0,0,.5);pointer-events:none;transition:opacity .3s';
            document.body.appendChild(toastEl);
        }
        toastEl.textContent = text;
        toastEl.style.opacity = '1';
        clearTimeout(toastEl.__t);
        toastEl.__t = setTimeout(() => { toastEl.style.opacity = '0'; }, 1800);
    };

    const copyText = async (t) => {
        try { await navigator.clipboard.writeText(t); toast('URL скопирован'); }
        catch (e) {
            const ta = document.createElement('textarea');
            ta.value = t;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); toast('URL скопирован'); } catch (e2) { toast('Не удалось скопировать'); }
            ta.remove();
        }
    };

    function renderDlPanel() {
        if (!dlPanelEl) return;
        if (dlEntries.length === 0) {
            dlPanelEl.innerHTML = '<div style="padding:12px;font-size:12px;opacity:.7">Пока ничего не поймано. Запусти плеер — потоки подхватятся автоматически.</div>';
            return;
        }
        const rows = dlEntries.map((e, i) =>
            '<div class="frkp-dl-row" data-i="' + i + '" style="padding:8px 12px;font-size:12px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,.06)">' +
            '<div style="font-weight:600">' + esc(e.label) + '</div>' +
            '<div style="opacity:.55;font-size:11px;word-break:break-all">' + esc(e.url) + '</div>' +
            '</div>'
        ).join('');
        dlPanelEl.innerHTML = rows + '<div style="padding:8px 12px;font-size:11px;opacity:.6">Клик — скопировать URL. Вставь в yt-dlp / ffmpeg.</div>';
        dlPanelEl.querySelectorAll('.frkp-dl-row').forEach(row => {
            row.addEventListener('mouseenter', () => row.style.background = 'rgba(255,255,255,.08)');
            row.addEventListener('mouseleave', () => row.style.background = '');
            row.addEventListener('click', () => copyText(dlEntries[+row.dataset.i].url));
        });
    }

    const startUI = () => {
        const style = document.createElement('style');
        style.textContent = '@keyframes frkp-spin{to{transform:rotate(360deg)}}@keyframes frkp-fadeout{from{opacity:1}to{opacity:0}}';
        document.head.appendChild(style);

        const cleanAndStretch = () => {
            const garbage = ['#vk_groups', '#vk_widget', '[id^="vkwidget"]', '#j90599c8fdd2fwp39y76g', '.b-sharing-social'];
            garbage.forEach(s => document.querySelectorAll(s).forEach(el => el.remove()));

            const contentTable = document.querySelector('.b-content__columns');
            if (contentTable) {
                contentTable.style.width = '100%';
                contentTable.style.display = 'table';
            }
            const main = document.querySelector('.b-content__main');
            if (main) { main.style.float = 'none'; main.style.width = 'auto'; }
        };

        const countPlayers = (html) => {
            const doc = new DOMParser().parseFromString(html, 'text/html');
            return doc.querySelectorAll('#cinemaplayerItems .cinemaplayer-item-select[data-value]').length;
        };

        const fetchShell = async (id, onStatus) => {
            for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
                onStatus('Поиск плееров...');
                try {
                    const resp = await fetch(PROXY_URL + 'https://iframe.cloud/iframe/' + id);
                    if (!resp.ok) throw new Error('HTTP ' + resp.status);
                    const html = await resp.text();
                    const n = countPlayers(html);
                    if (n > 0) {
                        console.log('Fetch test: got shell with ' + n + ' players');
                        return html;
                    }
                    console.log('Fetch test: attempt ' + (attempt + 1) + ' -> empty player list');
                } catch (e) {
                    console.log('Fetch test: attempt ' + (attempt + 1) + ' -> error: ' + e.message);
                }
                const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
                await sleep(delay);
            }
            return null;
        };

        const injectPlayer = () => {
            if (document.getElementById('frkp-embedded')) return;

            const helpLink = document.querySelector('a[href*="/help/aHR0cHMlM0ElMkYlMkZ3d3cua2lub3BvaXNrLnJ1"]');
            if (!helpLink) return;

            const player = document.querySelector('.b-player') ||
                          document.querySelector('#main-player') ||
                          document.querySelector('[data-player]') ||
                          document.querySelector('.video-player');
            if (!player) return;

            let id;
            try {
                const encoded = helpLink.href.split('/help/')[1].replace(/\/$/, "");
                id = decodeURIComponent(atob(encoded)).match(/film\/(\d+)\//)[1];
            } catch (e) {
                console.log('Fetch test: failed to decode film id', e);
                return;
            }

            const container = document.createElement('div');
            container.id = 'frkp-embedded';
            container.style.cssText = 'width:100%;margin:20px 0;border-radius:4px;overflow:hidden;box-shadow:0 2px 20px rgba(0,0,0,0.3)';

            const header = document.createElement('div');
            header.style.cssText = 'position:relative;padding:8px 15px;background:linear-gradient(90deg,#ff00c8,#8a6bff,#4da3ff,#14c8d4);color:#fff;font-weight:800;font-size:14px;letter-spacing:0.5px;text-transform:uppercase;display:flex;align-items:center;justify-content:space-between';
            header.innerHTML = 'CHEBAREZKA PLAYER (FETCH TEST) <span style="display:flex;align-items:center;gap:10px">' +
                '<span id="frkp-status" style="font-weight:600;font-size:12px"></span>' +
                '<span id="frkp-dl" style="cursor:pointer;font-size:16px;line-height:1;user-select:none" title="Скачать">⤓</span>' +
                '<span id="frkp-reload" style="cursor:pointer;font-size:18px;line-height:1;user-select:none" title="Загрузить заново">↻</span></span>';

            const dlPanel = document.createElement('div');
            dlPanel.id = 'frkp-dl-panel';
            dlPanel.style.cssText = 'display:none;position:absolute;top:100%;right:0;background:#1a2035;color:#fff;min-width:280px;max-width:420px;border-radius:6px;box-shadow:0 6px 24px rgba(0,0,0,.5);z-index:9999;overflow:hidden;text-transform:none;font-weight:400;letter-spacing:0';
            header.appendChild(dlPanel);
            dlPanelEl = dlPanel;
            renderDlPanel();

            const iframe = document.createElement('iframe');
            iframe.id = 'frkp-frame';
            iframe.style.cssText = 'width:100%;height:480px;border:none;display:block;background:#000';
            iframe.allowFullscreen = true;

            container.appendChild(header);
            container.appendChild(iframe);
            player.parentNode.insertBefore(container, player.nextSibling);

            const statusEl = document.getElementById('frkp-status');
            const reloadIcon = document.getElementById('frkp-reload');
            const dlIcon = document.getElementById('frkp-dl');

            const setStatus = (text) => {
                statusEl.style.animation = '';
                statusEl.textContent = text;
            };

            const flashOK = () => {
                setStatus('С КАЙФОМ!');
                statusEl.style.animation = 'frkp-fadeout 2s ease forwards';
                setTimeout(() => {
                    if (statusEl.textContent === 'С КАЙФОМ!') statusEl.textContent = '';
                    statusEl.style.animation = '';
                }, 2000);
            };

            const load = async () => {
                iframe.srcdoc = '';
                iframe.style.display = 'none';
                reloadIcon.style.animation = 'frkp-spin 0.6s linear infinite';
                setStatus('Поиск плееров...');

                const html = await fetchShell(id, setStatus);

                reloadIcon.style.animation = '';

                if (!html) {
                    setStatus('Ошибка: нет плееров');
                    console.log('Fetch test: all attempts failed, no players');
                    return;
                }

                iframe.srcdoc = html;
                iframe.style.display = 'block';
                flashOK();
            };

            reloadIcon.addEventListener('click', load);
            dlIcon.addEventListener('click', () => {
                const shown = dlPanel.style.display === 'block';
                dlPanel.style.display = shown ? 'none' : 'block';
            });
            load();
        };

        const run = () => {
            cleanAndStretch();
            injectPlayer();
        };

        run();
        const obs = new MutationObserver(run);
        obs.observe(document.body, { childList: true, subtree: true });
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startUI);
    } else {
        startUI();
    }
})();
