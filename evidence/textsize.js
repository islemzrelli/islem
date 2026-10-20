/* Text size: A / A+. Remembered on this device. Applied before the page paints, so nothing jumps. */
(function () {
  var KEY = 'evidence-text-size', root = document.documentElement;
  function get() { try { return localStorage.getItem(KEY) === 'large' ? 'large' : 'normal'; } catch (e) { return 'normal'; } }
  function set(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }
  function apply(v) { root.classList.toggle('ts-large', v === 'large'); }
  apply(get());
  function build() {
    var bar = document.querySelector('.bar');
    if (!bar || bar.querySelector('.textsize')) return;
    var box = document.createElement('div');
    box.className = 'textsize'; box.setAttribute('role', 'group'); box.setAttribute('aria-label', 'Text size');
    var lab = document.createElement('span'); lab.className = 'ts-label'; lab.textContent = 'Text size:';
    function btn(cls, text, label, val) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'ts-btn ' + cls; b.textContent = text; b.setAttribute('aria-label', label);
      b.addEventListener('click', function () { apply(val); set(val); sync(); });
      return b;
    }
    var a = btn('ts-a', 'A', 'Normal text size', 'normal'), ap = btn('ts-ap', 'A+', 'Larger text size', 'large');
    function sync() { var v = get(); a.setAttribute('aria-pressed', v === 'normal'); ap.setAttribute('aria-pressed', v === 'large'); }
    box.append(lab, a, ap); bar.appendChild(box); sync();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
