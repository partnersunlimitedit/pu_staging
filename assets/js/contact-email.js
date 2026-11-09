/* Contact page: when opened from the Member Directory
   (contact-us.html?member=<id>&company=<name>), note the member and
   pre-fill the e-mail subject. Text is only ever set via textContent. */
(function () {
  'use strict';
  if (!window.PUEmail) return;
  var p = new URLSearchParams(location.search);
  var id = (p.get('member') || '').trim();
  var company = (p.get('company') || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200);
  if (!company) return;
  if (!/^\d{1,12}$/.test(id)) id = '';
  var note = document.getElementById('email-member');
  var name = document.getElementById('email-member-name');
  var btn = document.getElementById('email-btn');
  if (name) name.textContent = company;
  if (note) note.hidden = false;
  if (btn) {
    btn.href = PUEmail.mailto(PUEmail.memberSubject(company, id || null));
    btn.setAttribute('aria-label', 'Email us about ' + company);
  }
})();
