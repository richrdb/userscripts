// ==UserScript==
// @name         TUWEL Subtitle Download
// @namespace    local.tuwel-subtitles
// @version      1.5.0
// @description  Download subtitles for one recording or all listed recordings for a selected subtitle track.
// @match        https://tuwel.tuwien.ac.at/mod/opencast/view.php*
// @run-at       document-idle
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @connect      cdn.video.tuwien.ac.at
// ==/UserScript==

(() => {
    "use strict";

    const player = document.querySelector(".player-wrapper");
    const main = document.querySelector('#region-main [role="main"]');
    if (!main) return;
    const course = (document.querySelector('#page-navbar a[href*="/course/view.php"]')?.title || "")
        .replace(/^\d+\.\d+\s+/, "").replace(/\s+\((?:VO|VU|UE|SE|PR|LU|EX)\b.*$/, "").trim();
    const row = document.createElement("div");
    row.className = "small text-muted";
    row.style.cssText = "display:flex;justify-content:flex-end;align-items:center;flex-wrap:wrap;gap:8px;margin:8px 0 16px";
    row.textContent = player ? "Download subtitles:" : "Download all subtitles:";
    const status = document.createElement("span");
    status.setAttribute("role", "status");
    row.append(status);

    function requestSubtitles(url) {
        return new Promise((resolve, reject) => {
            const fail = () => reject(new Error("Could not load subtitles."));
            GM_xmlhttpRequest({
                method: "GET", url, responseType: "text", timeout: 30000,
                onerror: fail, ontimeout: fail,
                onload: ({ status, responseText }) => {
                    if (status !== 200 || !responseText?.trimStart().startsWith("WEBVTT")) return fail();
                    resolve(responseText);
                },
            });
        });
    }

    async function download(episode, caption, index) {
        const text = await requestSubtitles(caption.url);
        const title = [course, episode.metadata?.title?.trim() || document.title]
            .filter(Boolean).join(" - ").slice(0, 160);
        const link = document.createElement("a");
        link.href = URL.createObjectURL(new Blob([text], { type: "text/vtt;charset=utf-8" }));
        link.download = `${title}.${caption.lang || index + 1}.vtt`
            .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_");
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    }

    function addButton(label, action) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "btn btn-outline-secondary btn-sm";
        button.textContent = label;
        button.onclick = async () => {
            row.querySelectorAll("button").forEach(button => button.disabled = true);
            status.textContent = "";
            try {
                await action();
            } catch (error) {
                status.textContent = `${error.message} Please try again.`;
            } finally {
                row.querySelectorAll("button").forEach(button => button.disabled = false);
            }
        };
        row.insertBefore(button, status);
        return button;
    }

    function trackLabel(caption, index) {
        return caption.text?.trim() || caption.lang || `Track ${index + 1}`;
    }

    if (player) {
        const episode = unsafeWindow.episode;
        if (!Array.isArray(episode?.captions)) return;
        episode.captions.forEach((caption, index) => {
            if (caption?.url) addButton(trackLabel(caption, index),
                () => download(episode, caption, index));
        });
        if (row.querySelector("button")) player.after(row);
        return;
    }

    const recordings = [...new Set([...main.querySelectorAll('a[href*="/mod/opencast/view.php"]')]
        .map(link => link.href).filter(href => new URL(href).searchParams.has("e")))];
    if (!recordings.length) return;

    const groups = new Map();
    const pending = new Set(recordings);

    async function downloadAll(tracks) {
        let failed = 0;
        for (const [index, track] of tracks.entries()) {
            status.textContent = `${index + 1} / ${tracks.length}`;
            try {
                await download(track.episode, track.caption, track.index);
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch {
                failed++;
            }
        }
        status.textContent = `${tracks.length - failed} downloads started` +
            (failed ? ` · ${failed} errors` : "") +
            (pending.size ? ` · ${pending.size} recordings not loaded` : "");
    }

    const loadButton = addButton("Load subtitle tracks", async () => {
        const urls = [...pending];
        for (const [index, url] of urls.entries()) {
            status.textContent = `Loading ${index + 1} / ${urls.length}`;
            try {
                const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
                if (!response.ok) throw new Error("Could not load recording.");
                const page = new DOMParser().parseFromString(await response.text(), "text/html");
                // Read the embedded JSON without executing page scripts.
                const data = [...page.scripts].map(script => script.textContent.match(/window\.episode\s*=\s*(\{[\s\S]*\})/))
                    .find(Boolean);
                if (!data) throw new Error("Recording data not found.");
                const episode = JSON.parse(data[1]);
                if (!Array.isArray(episode.captions)) throw new Error("Subtitle data not found.");
                episode.captions.forEach((caption, index) => {
                    if (!caption?.url) return;
                    const label = trackLabel(caption, index);
                    const key = JSON.stringify([caption.lang || "", label]);
                    if (!groups.has(key)) groups.set(key, { label, tracks: [] });
                    groups.get(key).tracks.push({ episode, caption, index });
                });
                pending.delete(url);
            } catch {
                // Keep failed pages for the next attempt.
            }
        }
        for (const group of groups.values()) {
            if (!group.button) group.button = addButton(group.label, () => downloadAll(group.tracks));
            group.button.title = `${group.tracks.length} subtitle files`;
        }
        if (pending.size) loadButton.textContent = "Retry failed recordings";
        else loadButton.remove();
        status.textContent = pending.size ? `${pending.size} recordings could not be loaded` :
            groups.size ? "" : "No subtitles found";
    });
    main.prepend(row);
})();
