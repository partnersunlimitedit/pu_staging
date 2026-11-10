/* Partners Unlimited — 2026 redesign
   Minimal progressive enhancement: mobile nav, header state,
   scroll reveal, password visibility toggle, and same-site prefetch. */
(function () {
  document.documentElement.classList.add('js');

  /* ---- Mobile navigation ---- */
  var toggle = document.querySelector('.nav-toggle');
  var mobileNav = document.getElementById('mobile-nav');
  if (toggle && mobileNav) {
    toggle.addEventListener('click', function () {
      var open = mobileNav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    mobileNav.addEventListener('click', function (e) {
      if (e.target.closest('a')) {
        mobileNav.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  /* ---- Header shadow on scroll ---- */
  var header = document.querySelector('.site-header');
  if (header) {
    var onScroll = function () {
      header.classList.toggle('is-scrolled', window.scrollY > 8);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* ---- Reveal on scroll ---- */
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var revealItems = document.querySelectorAll('[data-reveal]');
  if (revealItems.length) {
    if (reduceMotion || !('IntersectionObserver' in window)) {
      revealItems.forEach(function (el) { el.classList.add('is-visible'); });
    } else {
      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
      revealItems.forEach(function (el) { observer.observe(el); });
    }
  }

  /* ---- Password show/hide (member area) ---- */
  document.querySelectorAll('[data-pw-toggle]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var input = btn.closest('.pw-field').querySelector('input');
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.setAttribute('aria-pressed', show ? 'true' : 'false');
      btn.querySelector('.eye-on').style.display = show ? 'none' : '';
      btn.querySelector('.eye-off').style.display = show ? '' : 'none';
    });
  });

  /* ---- Faster next-page loads (Speculation Rules) ----
     Chromium can prefetch (and, on pointer-down, prerender) in-page
     links to public HTML pages, so header/footer navigation feels
     instant. The site prefix is read from this script's own URL, so
     the same rules work under /pu_staging/ on GitHub Pages and at the
     site root after go-live — the prefix is never hard-coded.

     Skip admin, member, and redesign pages as both sources and
     targets. mailto:, external URLs, and target=_blank links are
     not matched. Do nothing when the browser asks to save data, or
     when it does not support speculation rules (those browsers keep
     today's behaviour). */
  if (document.getElementById('pu-speculation-rules')) {
    return;
  }
  if (!(HTMLScriptElement.supports && HTMLScriptElement.supports('speculationrules'))) {
    return;
  }
  var saveData = navigator.connection && navigator.connection.saveData;
  var reducedData = false;
  try {
    reducedData = window.matchMedia('(prefers-reduced-data: reduce)').matches;
  } catch (err) {}
  if (saveData || reducedData) {
    return;
  }

  var prefix = '/';
  var thisScript = document.currentScript;
  var src = (thisScript && thisScript.src) || '';
  if (!src) {
    var scripts = document.getElementsByTagName('script');
    for (var i = 0; i < scripts.length; i++) {
      if ((scripts[i].src || '').indexOf('assets/js/main.js') !== -1) {
        src = scripts[i].src;
        break;
      }
    }
  }
  if (src) {
    try {
      var scriptPath = new URL(src, document.baseURI).pathname;
      var needle = 'assets/js/main.js';
      var at = scriptPath.indexOf(needle);
      if (at !== -1) {
        prefix = scriptPath.slice(0, at) || '/';
      }
    } catch (err) {}
  }

  var path = location.pathname || '';
  if (
    path.indexOf(prefix + 'admin/') === 0 ||
    path.indexOf(prefix + 'member/') === 0 ||
    path.indexOf(prefix + 'redesign/') === 0
  ) {
    return;
  }

  var publicPages = [prefix, prefix + 'index.html', prefix + '*.html'];
  var excluded = [
    prefix + 'admin',
    prefix + 'admin/*',
    prefix + 'member',
    prefix + 'member/*',
    prefix + 'redesign',
    prefix + 'redesign/*'
  ];
  var where = {
    and: [
      { href_matches: publicPages },
      { not: { href_matches: excluded } },
      { not: { selector_matches: 'a[target=_blank]' } }
    ]
  };

  var script = document.createElement('script');
  script.type = 'speculationrules';
  script.id = 'pu-speculation-rules';
  script.textContent = JSON.stringify({
    prefetch: [{ source: 'document', where: where, eagerness: 'moderate' }],
    prerender: [{ source: 'document', where: where, eagerness: 'conservative' }]
  });
  (document.head || document.documentElement).appendChild(script);
})();
