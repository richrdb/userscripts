// ==UserScript==
// @name         TUWEL Subtitle Download
// @namespace    local.tuwel-subtitles
// @version      1.6.8
// @description  Download subtitles for one recording or all listed recordings for a selected subtitle track.
// @match        https://tuwel.tuwien.ac.at/mod/opencast/view.php*
// @run-at       document-idle
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @connect      cdn.video.tuwien.ac.at
// ==/UserScript==

(() => {
    "use strict";

    // A page with a player has one episode; the course overview lists episode links.
    const player = document.querySelector(".player-wrapper");
    const main = document.querySelector('#region-main [role="main"]');
    if (!main) return;
    const episode = player ? unsafeWindow.episode : null;
    const captions = Array.isArray(episode?.captions) ? episode.captions : [];
    if (player && !captions.some(caption => caption?.url)) return;

    // The "e" parameter identifies recordings. An overview may link to each twice.
    const recordings = player ? [] : [...new Set([...main.querySelectorAll('a[href*="/mod/opencast/view.php"]')]
        .map(link => link.href).filter(href => new URL(href).searchParams.has("e")))];
    if (!player && !recordings.length) return;

    const course = (document.querySelector('#page-navbar a[href*="/course/view.php"]')?.title || "")
        .replace(/^\d+\.\d+\s+/, "").replace(/\s+\((?:VO|VU|UE|SE|PR|LU|EX)\b.*$/, "").trim();
    const row = document.createElement("div");
    row.className = "small text-muted";
    row.style.cssText = "display:flex;justify-content:flex-end;align-items:center;flex-wrap:wrap;gap:6px 12px;margin:8px 0 16px";
    const title = document.createElement("span");
    title.textContent = player ? "Download subtitles" : "Download all subtitles";
    title.style.fontWeight = "600";
    const controls = document.createElement("div");
    controls.style.cssText = "display:flex;align-items:center;flex-wrap:wrap;gap:6px";
    const status = document.createElement("span");
    status.setAttribute("role", "status");
    status.style.cssText = "flex-basis:100%;text-align:right";
    const formats = document.createElement("div");
    formats.className = "btn-group btn-group-sm";
    formats.setAttribute("role", "group");
    formats.setAttribute("aria-label", "Subtitle file format");
    let selectedFormat = "vtt";
    for (const value of ["vtt", "txt"]) {
        const button = createButton(value.toUpperCase(), () => {
            selectedFormat = value;
            for (const option of formats.querySelectorAll("button")) {
                const active = option === button;
                option.classList.toggle("active", active);
                option.setAttribute("aria-pressed", String(active));
            }
        });
        button.setAttribute("aria-pressed", String(value === selectedFormat));
        button.classList.toggle("active", value === selectedFormat);
        formats.append(button);
    }
    controls.append(formats);
    row.append(title, controls, status);

    // Keep cue text and line breaks, omitting IDs, timestamps, and metadata.
    function vttToText(vtt) {
        // Reuse an inert template to strip cue markup and decode entities.
        const decoder = document.createElement("template");
        return vtt.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split(/\n\s*\n/)
            .flatMap(block => {
                if (/^(?:WEBVTT|NOTE|STYLE|REGION)(?:\s|$)/.test(block)) return [];
                const lines = block.split("\n");
                const timing = lines.findIndex(line => /\b\d{2}:\d{2}(?::\d{2})?\.\d{3}\s+-->\s+\d{2}:\d{2}(?::\d{2})?\.\d{3}\b/.test(line));
                if (timing < 0) return [];
                const cue = lines.slice(timing + 1).join("\n").replace(/<\d{2}:\d{2}(?::\d{2})?\.\d{3}>/g, "");
                decoder.innerHTML = cue;
                return [decoder.content.textContent.trim()];
            }).filter(Boolean).join("\n\n") + "\n";
    }

    // Caption files are served from the video CDN, so fetch them through the
    // userscript's cross-origin request permission.
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
        const extension = selectedFormat;
        const title = [course, episode.metadata?.title?.trim() || document.title]
            .filter(Boolean).join(" - ").slice(0, 160);
        const link = document.createElement("a");
        link.href = URL.createObjectURL(new Blob([extension === "txt" ? vttToText(text) : text],
            { type: `text/${extension === "txt" ? "plain" : "vtt"};charset=utf-8` }));
        link.download = `${title}.${caption.lang || index + 1}.${extension}`
            .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_");
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    }

    function createButton(label, onClick) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "btn btn-outline-secondary btn-sm";
        button.textContent = label;
        button.onclick = onClick;
        return button;
    }

    // Freeze format selection for the whole action, including a bulk download.
    function addButton(label, action) {
        const button = createButton(label, async () => {
            row.querySelectorAll("button").forEach(button => button.disabled = true);
            status.textContent = "";
            try {
                await action();
            } catch (error) {
                status.textContent = `${error.message} Please try again.`;
            } finally {
                row.querySelectorAll("button").forEach(button => button.disabled = false);
            }
        });
        controls.append(button);
        return button;
    }

    function trackLabel(caption, index) {
        return caption.text?.trim() || caption.lang || `Track ${index + 1}`;
    }

    if (player) {
        captions.forEach((caption, index) => {
            if (caption?.url) addButton(trackLabel(caption, index),
                () => download(episode, caption, index));
        });
        player.after(row);
        return;
    }

    const groups = new Map();
    // Remove successful pages only; retries must not duplicate their tracks.
    const pending = new Set(recordings);
    const recordingsWithSubtitles = new Set();

    function parseEpisode(html) {
        const page = new DOMParser().parseFromString(html, "text/html");
        // TUWEL embeds episode data as JSON assigned to window.episode.
        // Parse that data without evaluating the surrounding page scripts.
        for (const script of page.scripts) {
            const data = script.textContent.match(/window\.episode\s*=\s*(\{[\s\S]*\})/);
            if (!data) continue;
            const episode = JSON.parse(data[1]);
            if (!Array.isArray(episode?.captions)) throw new Error("Subtitle data not found.");
            return episode;
        }
        throw new Error("Recording data not found.");
    }

    async function downloadAll(tracks) {
        let failed = 0;
        // Pace download attempts; completion here means the browser was asked to save.
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

    const loadButton = addButton("Load tracks", async () => {
        const urls = [...pending];
        for (const [index, url] of urls.entries()) {
            status.textContent = `Loading ${index + 1} / ${urls.length}`;
            try {
                const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
                if (!response.ok) throw new Error("Could not load recording.");
                const episode = parseEpisode(await response.text());
                episode.captions.forEach((caption, index) => {
                    if (!caption?.url) return;
                    recordingsWithSubtitles.add(url);
                    const label = trackLabel(caption, index);
                    // Group the same named/language track across recordings.
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
        status.textContent = `Available ${recordingsWithSubtitles.size} / ${recordings.length}` +
            (pending.size ? ` · ${pending.size} recordings could not be loaded` : "");
    });
    main.prepend(row);
})();
