/* Entering and leaving The Evidence, matching the site's chapter feel:
   a dark circle opens from where you tapped, the page changes underneath, and the new page
   fades up from black. Loaded in <head> (it must run before the page paints).
   Respects "reduce motion". Safe to delete: the page works without it, just with no animation. */
(function () {
  'use strict';
  var d = document, root = d.documentElement, KEY = 'iz_ev_go';
  var reduce = false;
  try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  if (reduce) return;

  var st = d.createElement('style');
  st.textContent =
    '.ev-wipe{position:fixed;inset:0;z-index:2147483000;background:#050505;pointer-events:none;visibility:hidden;clip-path:circle(0 at var(--wx,50%) var(--wy,0%))}' +
    '.ev-wipe.on{visibility:visible;pointer-events:auto;clip-path:circle(170vmax at var(--wx,50%) var(--wy,0%));transition:clip-path .64s cubic-bezier(.72,0,.2,1)}' +
    'html.ev-arrive::before{content:"";position:fixed;inset:0;z-index:2147483000;background:#050505;pointer-events:none;animation:evOut .8s ease .12s both}' +
    '@keyframes evOut{from{opacity:1;visibility:visible}to{opacity:0;visibility:hidden}}' +
    'html.ev-in .top{animation:evRise .9s cubic-bezier(.16,1,.3,1) .2s both}' +
    'html.ev-in .ev{animation:evRise .9s cubic-bezier(.16,1,.3,1) .34s both}' +
    '@keyframes evRise{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}';
  (d.head || root).appendChild(st);

  // arriving: if we came from the gallery's wipe, start covered and fade up from black
  var came = false;
  try { came = sessionStorage.getItem(KEY) === '1'; sessionStorage.removeItem(KEY); } catch (e) {}
  root.classList.add('ev-in');
  if (came) {
    root.classList.add('ev-arrive');
    setTimeout(function () { root.classList.remove('ev-arrive'); }, 1400);
  }

  // leaving: the circle opens from the tap, then we go back to the gallery
  function wipe(x, y, url) {
    var w = d.createElement('div');
    w.className = 'ev-wipe';
    w.setAttribute('aria-hidden', 'true');
    w.style.setProperty('--wx', x + 'px');
    w.style.setProperty('--wy', y + 'px');
    (d.body || root).appendChild(w);
    w.getBoundingClientRect();
    w.classList.add('on');
    setTimeout(function () {
      try { sessionStorage.setItem(KEY, '1'); } catch (e) {}
      window.location.href = url;
    }, 680);
  }

  d.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a.back, a.brand') : null;
    if (!a || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    var x = e.clientX, y = e.clientY;
    if (!e.detail) { var r = a.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top + r.height / 2; }
    wipe(x, y, a.href);
  });

  // browser Back can restore this page frozen mid-wipe; clear it
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    var w = d.querySelector('.ev-wipe');
    if (w && w.parentNode) w.parentNode.removeChild(w);
  });
})();
