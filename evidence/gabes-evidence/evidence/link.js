/* Adds "The Evidence" as the last row of the Chapters panel.
   Loaded from index.html with one line; keeps all Evidence code out of the main page.
   The row reuses the panel's own classes so it looks like the other chapters. */
(function () {
  'use strict';
  var base = '/islem/evidence/';
  try { if (document.currentScript && document.currentScript.src) base = new URL('./', document.currentScript.src).pathname; } catch (e) {}

  function build(list) {
    if (list.querySelector('.chap-ev')) return;
    var sep = document.createElement('div');
    sep.className = 'chap-sep chap-ev-sep';
    sep.setAttribute('aria-hidden', 'true');
    var a = document.createElement('a');
    a.className = 'chap-row chap-ev';
    a.href = base;
    a.style.textDecoration = 'none';
    a.style.setProperty('--i', Math.min(list.querySelectorAll('.chap-row').length, 14));
    a.innerHTML = '<span class="chap-num"></span><span class="chap-name"><span class="in">The Evidence</span></span><span class="chap-count" aria-hidden="true">\u2192</span>';
    // the panel treats every .chap-row click as "open this chapter"; this one is a normal link
    a.addEventListener('click', function (e) { e.stopPropagation(); });
    list.appendChild(sep);
    list.appendChild(a);
  }

  var seen = null;
  function scan() {
    var list = document.getElementById('chapList');
    if (!list || list === seen) return;
    seen = list;
    build(list);
    // the panel rewrites #chapList each time it opens, so put the row back
    new MutationObserver(function () { build(list); }).observe(list, { childList: true });
  }

  // the panel is created lazily and appended to <body>
  new MutationObserver(scan).observe(document.body, { childList: true });
  scan();
})();
