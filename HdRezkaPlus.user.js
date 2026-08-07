// ==UserScript==
// @name         RezkaPlus
// @namespace    https://www.youtube.com/watch?v=dQw4w9WgXcQ
// @version      1.0
// @description  Встраивает iframe.cloud плеер через прокси на Rezka
// @author       Cheba
// @match        *://*.hdrezka.ag/*
// @match        *://*.rezka.ag/*
// @match        *://*.rezka.fi/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const PROXY_URL = 'https://proxy4.rte.net.ru/';

    const style = document.createElement('style');
    style.textContent = '@keyframes frkp-spin{to{transform:rotate(360deg)}}';
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

    const injectPlayer = () => {
        if (document.getElementById('frkp-embedded')) return;

        const helpLink = document.querySelector('a[href*="/help/aHR0cHMlM0ElMkYlMkZ3d3cua2lub3BvaXNrLnJ1"]');
        if (!helpLink) return;

        try {
            const encoded = helpLink.href.split('/help/')[1].replace(/\/$/, "");
            const id = decodeURIComponent(atob(encoded)).match(/film\/(\d+)\//)[1];

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
            header.innerHTML = 'CHEBAREZKA PLAYER <span id="frkp-reload" style="cursor:pointer;font-size:18px;line-height:1;user-select:none" title="Обновить плеер">↻</span>';

            const iframe = document.createElement('iframe');
            iframe.src = PROXY_URL + 'https://iframe.cloud/iframe/' + id;
            iframe.style.cssText = 'width:100%;height:480px;border:none;display:block';
            iframe.loading = 'lazy';
            iframe.allowFullscreen = true;

            container.appendChild(header);
            container.appendChild(iframe);
            player.parentNode.insertBefore(container, player.nextSibling);

            const reloadIcon = document.getElementById('frkp-reload');
            reloadIcon?.addEventListener('click', () => {
                reloadIcon.style.animation = 'frkp-spin 0.6s linear infinite';
                iframe.src = iframe.src;
            });
            iframe.addEventListener('load', () => {
                if (reloadIcon) reloadIcon.style.animation = '';
            });
        } catch(e) {}
    };

    const run = () => {
        cleanAndStretch();
        injectPlayer();
    };

    run();
    const obs = new MutationObserver(run);
    obs.observe(document.body, { childList: true, subtree: true });
})();
