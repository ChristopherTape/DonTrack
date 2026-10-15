/* Page de connexion. */
(function () {
  'use strict';

  const form = document.getElementById('loginForm');
  const btn = document.getElementById('loginBtn');
  const err = document.getElementById('loginError');

  document.getElementById('togglePwd').addEventListener('click', () => {
    const input = document.getElementById('password');
    const shown = input.type === 'text';
    input.type = shown ? 'password' : 'text';
    input.focus();
  });

  function fail(message) {
    err.textContent = message;
    err.hidden = false;
    btn.disabled = false;
    btn.textContent = 'Se connecter';
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    btn.disabled = true;
    btn.textContent = 'Connexion…';

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-DonTrack': '1' },
        body: JSON.stringify({
          username: document.getElementById('username').value,
          password: document.getElementById('password').value
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return fail(data.error || 'Connexion impossible.');
      window.location.href = '/app';
    } catch (e2) {
      fail('Serveur injoignable. Vérifiez votre connexion.');
    }
  });

  document.getElementById('username').focus();
})();
