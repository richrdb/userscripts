// ==UserScript==
// @name         Clean URL
// @version      1.0
// @description  Rewrites the address bar URL to its shortest clean form so copied links are free of tracking junk.
// @match        *://*/*
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

// Tracking parameters that are safe to drop on every site.
// Strings match the lowercased name exactly, regexes are tested against it.
const GLOBAL_STRIP = [
    /^utm_/, 'fbclid', 'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'yclid', 'ysclid',
    'twclid', 'ttclid', 'li_fat_id', 'igshid', 'mc_cid', 'mc_eid', 'mkt_tok', '_hsenc', '_hsmi',
    '__hssc', '__hstc', '__hsfp', 'hsctatracking', 'oly_anon_id', 'oly_enc_id', 'vero_id', 'vero_conv',
    '_openstat', 'wickedid', 'rb_clickid', 's_cid', 'srsltid', '_ga', '_gl', 'ml_subscriber',
    'ml_subscriber_hash',
];

// Per-site rules. The first rule whose `host` matches is used.
//   paths: [regex, replacement, keep] - the first regex matching the pathname rewrites it
//          (replacement as in String.replace, or a function (match, query) => path | null).
//          `keep` lists the only query parameters that survive; omit it to keep the query.
//   strip: extra tracking parameters for this site, same format as GLOBAL_STRIP.
const RULES = [
    {
        host: /(^|\.)amazon\.(com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/,
        paths: [
            [/^.*\/(?:dp|gp\/product|gp\/aw\/d|exec\/obidos\/ASIN|o\/ASIN)\/([A-Z0-9]{10})(?:\/.*)?$/, '/dp/$1', []],
            [/^(.*?)\/ref=[^/]*$/, (m) => m[1] || '/'],
        ],
        strip: [
            'ref', 'ref_', /^pf_rd_/, /^pd_rd_/, 'crid', 'qid', 'sr', 'sprefix', 'dib', 'dib_tag',
            'content-id', 'linkcode', 'linkid', '_encoding', 'ascsubtag', 'smid',
        ],
    },
    {
        host: /(^|\.)ebay\.(com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/,
        paths: [[/^\/itm\/(?:[^/]+\/)?(\d{9,})\/?$/, '/itm/$1', ['var']]],
    },
    {
        host: /(^|\.)aliexpress\.(com|us|ru)$/,
        paths: [[/^\/(?:item|i)\/\d+\.html$/, '$&', []]],
    },
    {
        host: /(^|\.)etsy\.com$/,
        paths: [[/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?listing\/(\d+)(?:\/.*)?$/, '/listing/$1', []]],
    },
    {
        host: /(^|\.)walmart\.com$/,
        paths: [[/^\/ip\/(?:[^/]+\/)?(\d+)\/?$/, '/ip/$1', []]],
    },
    {
        host: /(^|\.)(youtube\.com|youtube-nocookie\.com)$/,
        strip: ['si', 'pp', 'feature', 'ab_channel'],
    },
    {
        host: /(^|\.)(stackoverflow\.com|stackexchange\.com|superuser\.com|serverfault\.com|askubuntu\.com|mathoverflow\.net|stackapps\.com)$/,
        paths: [
            [/^\/questions\/\d+\/[^/]+\/(\d+)\/?$/, '/a/$1', []],
            // The short form always lands on page 1, so leave paginated views alone.
            [/^\/questions\/(\d+)(?:\/[^/]*)?\/?$/, (m, query) => (/[?&]page=/.test(query) ? null : `/q/${m[1]}`), []],
        ],
    },
    {
        host: /(^|\.)reddit\.com$/,
        paths: [
            [/^\/(?:r|u|user)\/[^/]+\/comments\/([a-z0-9]+)\/[^/]*\/([a-z0-9]+)\/?$/, '/comments/$1/_/$2', ['context']],
            [/^\/(?:r|u|user)\/[^/]+\/comments\/([a-z0-9]+)(?:\/[^/]*)?\/?$/, '/comments/$1', []],
        ],
        strip: ['share_id', 'rdt', 'ref', 'ref_source', 'ref_campaign', '$deep_link', '_branch_match_id', '_branch_referrer'],
    },
    {
        host: /(^|\.)(twitter\.com|x\.com)$/,
        paths: [[/^\/\w+\/status\/\d+(?:\/(?:photo|video)\/\d+)?\/?$/, '$&', []]],
        strip: ['ref_src', 'ref_url'],
    },
    {
        host: /(^|\.)instagram\.com$/,
        strip: ['igsh'],
    },
    {
        host: /(^|\.)tiktok\.com$/,
        paths: [[/^\/@[^/]+\/(?:video|photo)\/\d+\/?$/, '$&', []]],
        strip: ['_r', '_t', '_d', 'is_from_webapp', 'sender_device', 'web_id', 'share_app_id', 'share_link_id'],
    },
    {
        host: /(^|\.)facebook\.com$/,
        strip: [/^__(cft|tn|xts)__/, 'mibextid', 'rdid', 'share_url'],
    },
    {
        host: /(^|\.)linkedin\.com$/,
        paths: [[/^\/jobs\/view\/(?:[^/]*-)?(\d+)\/?$/, '/jobs/view/$1', []]],
        strip: ['trk', 'trackingid', 'refid', 'lipi', 'midtoken', 'midsig', 'trkemail', 'ebp', 'rcm'],
    },
    {
        host: /(^|\.)pinterest\.(com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/,
        paths: [[/^\/pin\/(?:[^/]*--)?(\d+)\/?$/, '/pin/$1/', []]],
    },
    {
        host: /^(www\.)?google\.(com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/,
        strip: [
            'sca_esv', 'sca_upv', 'sxsrf', 'ei', 'ved', 'uact', 'oq', 'gs_lp', 'gs_lcrp', 'gs_l', 'gs_ssp',
            'sclient', 'source', 'sourceid', 'iflsig', 'biw', 'bih', 'dpr', 'client', 'rlz', 'aqs', 'ie',
            'oe', 'sa', 'fbs', 'sei', 'zx', 'pccc',
        ],
    },
    {
        host: /^play\.google\.com$/,
        paths: [[/^\/store\/apps\/details$/, '$&', ['id']]],
    },
    {
        host: /(^|\.)bing\.com$/,
        strip: ['form', 'pc', 'qs', 'sp', 'pq', 'sc', 'sk', 'cvid', 'ghsh', 'ghacc', 'ghpl', 'lq', 'refig'],
    },
    {
        host: /^open\.spotify\.com$/,
        strip: ['si', 'nd', 'dl_branch', 'pi'],
    },
    {
        host: /^store\.steampowered\.com$/,
        paths: [[/^\/(app|sub|bundle)\/(\d+)(?:\/[^/]*)?\/?$/, '/$1/$2', []]],
        strip: ['snr'],
    },
    {
        host: /^apps\.apple\.com$/,
        paths: [[/^\/([a-z]{2})\/app\/[^/]+\/(id\d+)$/, '/$1/app/$2', []]],
    },
    {
        host: /(^|\.)goodreads\.com$/,
        paths: [[/^\/book\/show\/(\d+)[^/]*$/, '/book/show/$1', []]],
    },
    {
        host: /(^|\.)imdb\.com$/,
        strip: ['ref_', /^pf_rd_/],
    },
    {
        host: /(^|\.)bilibili\.com$/,
        paths: [[/^\/video\/(BV\w+|av\d+)\/?$/, '/video/$1', ['p', 't']]],
    },
    {
        host: /(^|\.)twitch\.tv$/,
        strip: [/^tt_/],
    },
    {
        host: /(^|\.)medium\.com$/,
        strip: ['source'],
    },
    {
        host: /(^|\.)wikipedia\.org$/,
        strip: ['wprov'],
    },
];

const matches = (list, name) => list.some((p) => (typeof p === 'string' ? p === name : p.test(name)));

// Drops parameters from the raw query string so the remaining ones stay byte-for-byte intact.
function filterQuery(query, shouldKeep) {
    if (query.length < 2) return query;
    const parts = query.slice(1).split('&');
    const kept = parts.filter((part) => {
        if (!part) return true;
        let name = part.split('=')[0].replace(/\+/g, ' ');
        try { name = decodeURIComponent(name); } catch { /* malformed escape, compare as is */ }
        return shouldKeep(name.toLowerCase());
    });
    if (kept.length === parts.length) return query;
    return kept.length ? `?${kept.join('&')}` : '';
}

function cleanUrl(href) {
    const url = new URL(href);
    if (!/^https?:$/.test(url.protocol)) return href;

    const rule = RULES.find((r) => r.host.test(url.hostname));
    let path = url.pathname;
    let keep;
    for (const [regex, replacement, keepParams] of rule?.paths ?? []) {
        const m = path.match(regex);
        if (!m) continue;
        const newPath = typeof replacement === 'function' ? replacement(m, url.search) : path.replace(regex, replacement);
        if (newPath === null) continue;
        path = newPath;
        keep = keepParams;
        break;
    }

    const strip = rule?.strip ? GLOBAL_STRIP.concat(rule.strip) : GLOBAL_STRIP;
    const query = filterQuery(url.search, (name) => (keep ? keep.includes(name) : !matches(strip, name)));
    // Return the input itself when nothing changed: rebuilding would drop a bare "?" or "#".
    if (path === url.pathname && query === url.search) return href;
    return url.origin + path + query + url.hash;
}

function update() {
    try {
        const clean = cleanUrl(location.href);
        if (clean !== location.href) history.replaceState(history.state, '', clean);
    } catch { /* never let a URL we cannot handle affect the page */ }
}

update();

// Single-page apps change the URL without loading a new page.
window.addEventListener('popstate', update);
window.addEventListener('hashchange', update);
if (window.navigation) window.navigation.addEventListener('currententrychange', update);
else setInterval(update, 500);
