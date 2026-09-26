// ==UserScript==
// @name         RezkaPlus TEST Optimized
// @namespace    https://www.youtube.com/watch?v=dQw4w9WgXcQ
// @version      1.5
// @description  Встраивает iframe.cloud плеер через прокси на Rezka
// @author       Cheba
// @match        *://*.hdrezka.ag/*
// @match        *://*.rezka.ag/*
// @match        *://*.rezka.fi/*
// @match        *://*.hdrezka.la/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    const PROXY_URL = 'https://proxy4.rte.net.ru/';
    const EXTERNAL_IDS_URL = 'https://akter-black.com/externalids';
    const MAX_ATTEMPTS = 10;
    const BACKOFF_MS = [500, 1000, 2000, 4000];
    const FETCH_TIMEOUT_MS = 10000;
    const OBSERVER_DELAY_MS = 250;
    const GARBAGE_SELECTOR = [
        '[id^="brnd"]',
        '[id^="ibrnd"]',
        '[class^="brnd"]',
        'iframe[src*="schulist.link"]',
        'div[style*="position: fixed"]:has(img[src*="schulist.link"])',
        '#player.b-player > a[href^="/help/"][style*="background-image"]',
        '.wide.b-dwnapp',
        '.b-content__main > div[style^="height: 250px"]',
        '.b-content__main > div[id]:not([class]):empty',
        '.b-post__support_holder',
        '.tooltipstered.hd-tooltip.b-post__support_holder_report',
        '.b-post__social_holder_wrapper',
        '.b-post__social_holder',
        '.vk-group',
        '.vk-group__header',
        '.b-footer__social',
        '#vk_groups',
        '#vk_widget',
        '[id^="vkwidget"]',
        '.b-sharing-social'
    ].join(',');

    const style = document.createElement('style');
    style.textContent = `${GARBAGE_SELECTOR}{display:none!important;visibility:hidden!important}@keyframes frkp-spin{to{transform:rotate(360deg)}}@keyframes frkp-fadeout{from{opacity:1}to{opacity:0}}`;
    (document.head || document.documentElement).appendChild(style);

    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

    const fetchWithTimeout = async (url, signal, options = {}) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        const abort = () => controller.abort();
        signal.addEventListener('abort', abort, { once: true });
        try {
            return await fetch(url, Object.assign({}, options, { signal: controller.signal }));
        } finally {
            clearTimeout(timeout);
            signal.removeEventListener('abort', abort);
        }
    };

    const stopAndRemove = el => {
        const media = el.matches('video, audio') ? [el] : el.querySelectorAll('video, audio');
        media.forEach(player => {
            player.pause();
            player.removeAttribute('src');
            player.load();
        });
        el.remove();
    };

    const cleanAndStretch = () => {
        document.querySelectorAll(GARBAGE_SELECTOR).forEach(stopAndRemove);

        document.querySelectorAll('#player a, #player button').forEach(el => {
            if (!/^Перейти на Premium\b/.test(el.textContent.trim())) return;
            const wrapper = el.parentElement;
            (wrapper && /^Перейти на Premium\b/.test(wrapper.textContent.trim()) ? wrapper : el).remove();
        });

        if (document.body.classList.contains('has-brand')) {
            document.body.style.setProperty('padding-top', '0', 'important');
        }

        const contentTable = document.querySelector('.b-content__columns');
        if (contentTable) {
            contentTable.style.width = '100%';
            contentTable.style.display = 'table';
        }
        const main = document.querySelector('.b-content__main');
        if (main) {
            main.style.float = 'none';
            main.style.width = 'auto';
        }
    };

    const hasPlayers = html => {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        return Boolean(doc.querySelector('#cinemaplayerItems .cinemaplayer-item-select[data-value]'));
    };

    const getPageIds = () => {
        const ids = { kinopoiskId: null, imdbId: null };
        document.querySelectorAll('a[href*="/help/"]').forEach(link => {
            try {
                const encoded = link.href.split('/help/')[1]?.replace(/\/$/, '');
                const decoded = encoded && decodeURIComponent(atob(encoded));
                if (!decoded) return;
                ids.kinopoiskId ||= decoded.match(/kinopoisk\.[^/]+\/film\/(\d+)/i)?.[1] || null;
                ids.imdbId ||= decoded.match(/imdb\.com\/title\/(tt\d+)/i)?.[1] || null;
            } catch (error) {
                // На странице могут быть служебные help-ссылки с другим форматом.
            }
        });
        return ids;
    };

    const resolveKinopoiskId = async (imdbId, serial, signal) => {
        try {
            const url = EXTERNAL_IDS_URL + '?imdb_id=' + encodeURIComponent(imdbId) + '&serial=' + (serial ? 1 : 0);
            const response = await fetchWithTimeout(url, signal);
            if (!response.ok) throw new Error('HTTP ' + response.status);
            const json = await response.json();
            return json.kinopoisk_id ? String(json.kinopoisk_id) : null;
        } catch (error) {
            if (!signal.aborted) console.debug('RezkaPlus: IMDb → Kinopoisk не удался', error);
            return null;
        }
    };

    const fetchShell = async (id, onStatus, signal) => {
        for (let attempt = 0; attempt < MAX_ATTEMPTS && !signal.aborted; attempt++) {
            onStatus('Поиск плееров...');
            try {
                const response = await fetchWithTimeout(PROXY_URL + 'https://iframe.cloud/iframe/' + id, signal);
                if (!response.ok) throw new Error('HTTP ' + response.status);
                const html = await response.text();
                if (hasPlayers(html)) return html;
                console.debug(`RezkaPlus: попытка ${attempt + 1} — плееры не найдены`);
            } catch (error) {
                if (!signal.aborted) console.debug(`RezkaPlus: попытка ${attempt + 1} не удалась`, error);
            }

            if (attempt < MAX_ATTEMPTS - 1 && !signal.aborted) {
                await sleep(BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]);
            }
        }
        return null;
    };

    const injectPlayer = () => {
        if (document.getElementById('frkp-embedded')) return;

        const { kinopoiskId: directId, imdbId } = getPageIds();
        if (!directId && !imdbId) return;

        const player = document.querySelector('.b-player') ||
            document.querySelector('#main-player') ||
            document.querySelector('[data-player]') ||
            document.querySelector('.video-player');
        if (!player) return;

        const container = document.createElement('div');
        container.id = 'frkp-embedded';
        container.style.cssText = 'width:100%;margin:20px 0;border-radius:4px;overflow:hidden;box-shadow:0 2px 20px rgba(0,0,0,0.3)';

        const header = document.createElement('div');
        header.style.cssText = 'padding:8px 15px;background:linear-gradient(90deg,#ff00c8,#8a6bff,#4da3ff,#14c8d4);color:#fff;font-weight:800;font-size:14px;letter-spacing:0.5px;text-transform:uppercase;display:flex;align-items:center;justify-content:space-between';
        header.innerHTML = 'HDREZKA PLUS <span style="display:flex;align-items:center;gap:10px"><span id="frkp-status" style="font-weight:600;font-size:12px"></span><span id="frkp-reload" style="cursor:pointer;font-size:18px;line-height:1;user-select:none" title="Загрузить заново">↻</span></span>';

        const iframe = document.createElement('iframe');
        iframe.id = 'frkp-frame';
        iframe.style.cssText = 'width:100%;height:480px;border:none;display:block;background:#000';
        iframe.allowFullscreen = true;

        container.append(header, iframe);
        player.parentNode.insertBefore(container, player.nextSibling);

        const statusEl = document.getElementById('frkp-status');
        const reloadIcon = document.getElementById('frkp-reload');
        let loadController = null;
        let loadNumber = 0;

        const setStatus = text => {
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
            const currentLoad = ++loadNumber;
            loadController?.abort();
            loadController = new AbortController();
            iframe.srcdoc = '';
            iframe.style.display = 'none';
            reloadIcon.style.animation = 'frkp-spin 0.6s linear infinite';
            let id = directId;
            if (!id) {
                setStatus('Поиск Kinopoisk ID по IMDb...');
                id = await resolveKinopoiskId(imdbId, /\/series\//i.test(location.pathname), loadController.signal);
            }
            if (currentLoad !== loadNumber) return;
            if (!id) {
                reloadIcon.style.animation = '';
                setStatus('Ошибка: Kinopoisk ID не найден');
                return;
            }

            setStatus('Поиск плееров...');

            const html = await fetchShell(id, setStatus, loadController.signal);
            if (currentLoad !== loadNumber) return;

            reloadIcon.style.animation = '';
            if (!html) {
                setStatus('Ошибка: нет плееров');
                return;
            }

            iframe.srcdoc = html;
            iframe.style.display = 'block';
            flashOK();
        };

        reloadIcon.addEventListener('click', load);
        load();
    };

    const run = () => {
        cleanAndStretch();
        injectPlayer();
    };

    const start = () => {
        run();
        let observerTimer;
        const observer = new MutationObserver(() => {
            clearTimeout(observerTimer);
            observerTimer = setTimeout(run, OBSERVER_DELAY_MS);
        });
        observer.observe(document.body, { childList: true, subtree: true });
    };

    if (document.body) {
        start();
    } else {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    }
})();
