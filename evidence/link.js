/* Adds "The Evidence" to the main site in two places:
   1) the landing-page menu (between About and Contact)
   2) the last row of the Chapters panel, with an optional intro photo.
   Loaded from index.html with one line; keeps all Evidence code out of the main page.

   INTRO PHOTO: put a picture named intro.jpg in this same folder (evidence/intro.jpg).
   It becomes the row's background and the big preview in Chapters. No photo = no problem,
   the row simply shows without one. The Evidence page itself never shows images. */
(function () {
  'use strict';
  var base = '/islem/evidence/';
  try { if (document.currentScript && document.currentScript.src) base = new URL('./', document.currentScript.src).pathname; } catch (e) {}

  var NAME = 'The Evidence';
  var COUNT_LABEL = 'Documented evidence';
  var STORY = 'Studies, laboratory analyses, audits and legal texts about Gabès, each traced to its source.';
  var photo = '';            // set once intro.jpg is confirmed to exist

  /* ---------- optional intro photo ---------- */
  var probe = new Image();
  probe.onload = function () {
    photo = base + 'intro.jpg';
    var row = document.querySelector('.chap-ev');
    if (row) decorate(row);
  };
  probe.src = base + 'intro.jpg';


  /* ---------- the same circle-wipe the chapters use, then go to the page ---------- */
  var KEY = 'iz_ev_go', reduce = false;
  try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  var wiping = false;
  function go(e, el) {
    // plain left-click only; ctrl/cmd/middle-click keep their normal "open in new tab" behaviour
    if (reduce || wiping || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
    e.preventDefault();
    wiping = true;
    var x = e.clientX, y = e.clientY;
    if (!e.detail) { var r = el.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top + r.height / 2; }
    if (!document.getElementById('evWipeCss')) {
      var st = document.createElement('style');
      st.id = 'evWipeCss';
      st.textContent = '.ev-wipe{position:fixed;inset:0;z-index:2147483000;background:#050505;pointer-events:none;visibility:hidden;clip-path:circle(0 at var(--wx,50%) var(--wy,0%))}' +
        '.ev-wipe.on{visibility:visible;pointer-events:auto;clip-path:circle(170vmax at var(--wx,50%) var(--wy,0%));transition:clip-path .64s cubic-bezier(.72,0,.2,1)}';
      document.head.appendChild(st);
    }
    var w = document.createElement('div');
    w.className = 'ev-wipe';
    w.setAttribute('aria-hidden', 'true');
    w.style.setProperty('--wx', x + 'px');
    w.style.setProperty('--wy', y + 'px');
    document.body.appendChild(w);
    w.getBoundingClientRect();
    w.classList.add('on');
    setTimeout(function () {
      try { sessionStorage.setItem(KEY, '1'); } catch (er) {}
      window.location.href = base;
    }, 680);
    return true;
  }
  // coming back with the browser's Back button can restore the site frozen mid-wipe; clear it
  window.addEventListener('pageshow', function (e) {
    wiping = false;
    var w = document.querySelector('.ev-wipe');
    if (w && w.parentNode) w.parentNode.removeChild(w);
  });

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

  function decorate(a) {
    if (!photo || a.querySelector('.chap-thumb')) return;
    var img = document.createElement('img');
    img.className = 'chap-thumb';
    img.alt = '';
    img.draggable = false;
    img.decoding = 'async';
    img.src = photo;
    a.insertBefore(img, a.firstChild);
    a.setAttribute('data-img', photo);
  }

  /* ---------- 1) Chapters panel row ---------- */
  function build(list) {
    if (list.querySelector('.chap-ev')) return;
    var sep = document.createElement('div');
    sep.className = 'chap-sep chap-ev-sep';
    sep.setAttribute('aria-hidden', 'true');
    var a = document.createElement('a');
    a.className = 'chap-row chap-ev';
    a.href = base;
    a.style.textDecoration = 'none';
    a.setAttribute('data-slug', 'evidence');
    a.setAttribute('data-name', NAME);
    a.setAttribute('data-count', '');
    a.setAttribute('data-story', STORY);
    a.style.setProperty('--i', Math.min(list.querySelectorAll('.chap-row').length, 14));
    a.innerHTML = '<span class="chap-num"></span><span class="chap-name"><span class="in">' + esc(NAME) + '</span></span><span class="chap-count" aria-hidden="true">\u2192</span>';
    // the panel treats every .chap-row click as "open this chapter"; this one is a normal link
    a.addEventListener('click', function (e) { e.stopPropagation(); go(e, a); });
    decorate(a);
    list.appendChild(sep);
    list.appendChild(a);
  }

  // the preview would say "0 photographs" for this row; show our own label instead
  function watchPreview() {
    var p = document.getElementById('chapPreview');
    if (!p || p.__evWatched) return;
    p.__evWatched = true;
    function fix() {
      if (p.getAttribute('data-cur') !== 'evidence') return;
      var c = p.querySelector('.c');
      if (c && c.textContent !== COUNT_LABEL) c.textContent = COUNT_LABEL;
    }
    new MutationObserver(fix).observe(p, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-cur'] });
  }

  var seen = null;
  function scan() {
    var list = document.getElementById('chapList');
    if (!list || list === seen) return;
    seen = list;
    build(list);
    watchPreview();
    // the panel rewrites #chapList each time it opens, so put the row back
    new MutationObserver(function () { build(list); }).observe(list, { childList: true });
  }

  // the panel is created lazily and appended to <body>
  new MutationObserver(scan).observe(document.body, { childList: true });
  scan();


  /* ---------- special icon + second-row placement for the landing menu ---------- */
  // ghost-pill style: the label plus a small arrow, signalling that this leaves the gallery
  var ICON = '<svg class="nav-ico ev-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17L17 7M8 7h9v9"/></svg>';
  (function () {
    var st = document.createElement('style');
    st.id = 'evNavCss';
    st.textContent =
      // the site forces every .cat-btn border transparent, so the hairline is an inset shadow
      'html body #catNav .cat-evidence{flex-direction:row-reverse;gap:7px!important;padding:8px 16px!important;border-radius:999px;box-shadow:inset 0 0 0 1px rgba(246,244,239,.28);transition:box-shadow .26s var(--ease),background .26s var(--ease),color .26s var(--ease)}' +
      'html body #catNav .cat-evidence:hover{background:rgba(246,244,239,.07);box-shadow:inset 0 0 0 1px rgba(246,244,239,.6)}' +
      'html body #catNav .cat-evidence .ev-arrow{width:13px;height:13px;transition:transform .34s var(--ease-out,var(--ease))}' +
      'html body #catNav .cat-evidence:hover .ev-arrow{transform:translate(2px,-2px)}' +
      '@media (prefers-reduced-motion:reduce){html body #catNav .cat-evidence,html body #catNav .cat-evidence .ev-arrow{transition:none}}' +
      '@media (max-width:859px){html body #catNav .cat-evidence{order:9!important;margin-inline-end:100%!important;margin-top:2px}}';
    document.head.appendChild(st);
  })();

  /* ---------- 2) Landing-page menu ---------- */
  function addNav(nav) {
    if (nav.querySelector('.cat-evidence')) return;
    var contact = nav.querySelector('.cat-contact');   // only the landing menu has Contact
    if (!contact) return;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'cat-btn cat-evidence has-ico';
    b.setAttribute('aria-label', NAME);
    b.innerHTML = ICON + '<span>' + esc(NAME) + '</span>';  // row-reverse in CSS puts the arrow after the label
    b.addEventListener('click', function (e) { e.stopPropagation(); if (!go(e, b)) window.location.href = base; });
    nav.insertBefore(b, contact);
  }

  function watchNav() {
    var nav = document.getElementById('catNav');
    if (!nav) return false;
    addNav(nav);
    // the site rebuilds this menu whenever you move between home and a chapter
    new MutationObserver(function () { addNav(nav); }).observe(nav, { childList: true });
    return true;
  }
  if (!watchNav()) document.addEventListener('DOMContentLoaded', watchNav);
})();
