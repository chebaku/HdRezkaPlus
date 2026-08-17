// ==UserScript==
// @name         RezkaPlus Fetch Test
// @namespace    https://www.youtube.com/watch?v=dQw4w9WgXcQ
// @version      0.2
// @description  TEST: fetch iframe.cloud через прокси, ретрай до появления плееров, вставка оригинального HTML шелла
// @author       Cheba
// @match        *://*.hdrezka.ag/*
// @match        *://*.rezka.ag/*
// @match        *://*.rezka.fi/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    const PROXY_URL = 'https://proxy4.rte.net.ru/';
    const MAX_ATTEMPTS = 10;
    const BACKOFF_MS = [500, 1000, 2000, 4000];

    const style = document.createElement('style');
    style.textContent = '@keyframes frkp-spin{to{transform:rotate(360deg)}}@keyframes frkp-fadeout{from{opacity:1}to{opacity:0}}';
    document.head.appendChild(style);

    const sleep = ms => new Promise(r => setTimeout(r, ms));

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
        header.style.cssText = 'padding:8px 15px;background:linear-gradient(90deg,#ff00c8,#8a6bff,#4da3ff,#14c8d4);color:#fff;font-weight:800;font-size:14px;letter-spacing:0.5px;text-transform:uppercase;display:flex;align-items:center;justify-content:space-between';
        header.innerHTML = 'CHEBAREZKA PLAYER (FETCH TEST) <span style="display:flex;align-items:center;gap:10px"><span id="frkp-status" style="font-weight:600;font-size:12px"></span><span id="frkp-reload" style="cursor:pointer;font-size:18px;line-height:1;user-select:none" title="Загрузить заново">↻</span></span>';

        const iframe = document.createElement('iframe');
        iframe.id = 'frkp-frame';
        iframe.style.cssText = 'width:100%;height:480px;border:none;display:block;background:#000';
        iframe.allowFullscreen = true;

        container.appendChild(header);
        container.appendChild(iframe);
        player.parentNode.insertBefore(container, player.nextSibling);

        const statusEl = document.getElementById('frkp-status');
        const reloadIcon = document.getElementById('frkp-reload');

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
        load();
    };

    const run = () => {
        cleanAndStretch();
        injectPlayer();
    };

    run();
    const obs = new MutationObserver(run);
    obs.observe(document.body, { childList: true, subtree: true });
})();
