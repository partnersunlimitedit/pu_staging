/* Partners Unlimited — shared e-mail helper.
   The address is assembled at runtime so it never appears whole in the HTML
   (light protection against e-mail harvesting bots). */
(function () {
  'use strict';
  var parts = ['info', 'partnersunlimited', 'net'];
  function address() { return parts[0] + '\u0040' + parts[1] + '.' + parts[2]; }
  function mailto(subject) {
    return 'mailto:' + address() + (subject ? '?subject=' + encodeURIComponent(subject) : '');
  }
  function memberSubject(company, id) {
    return 'Enquiry about ' + company + (id != null && id !== '' ? ' (member #' + id + ')' : '');
  }
  window.PUEmail = { address: address, mailto: mailto, memberSubject: memberSubject };

  // Fill any placeholders on the page.
  document.querySelectorAll('.js-pu-email').forEach(function (el) { el.textContent = address(); });
  document.querySelectorAll('a.js-pu-mailto').forEach(function (a) {
    a.href = mailto(a.getAttribute('data-subject') || '');
    a.hidden = false;
  });
})();
