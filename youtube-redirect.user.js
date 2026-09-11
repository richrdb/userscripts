// ==UserScript==
// @name         YouTube Auto Redirect
// @version      1.0
// @description  Instantly skips YouTube's external link warning page.
// @match        *://*.youtube.com/redirect*
// @run-at       document-start
// @grant        none
// ==/UserScript==

const target = new URLSearchParams(location.search).get('q');
if (target) location.replace(target);