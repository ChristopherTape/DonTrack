/* Applique le thème avant le premier rendu : évite le clignotement.
   Fichier séparé car la politique de sécurité interdit les scripts en ligne.

   Clé versionnée : une version antérieure écrivait « dark » à chaque
   démarrage, ce qui imposait le mode nuit aux navigateurs qui l'avaient
   visitée. On repart donc du mode jour, sauf choix explicite de l'utilisateur. */
(function () {
  try {
    localStorage.removeItem('dontrack.theme');          // réglage hérité, ignoré
    if (localStorage.getItem('dontrack.theme.v2') === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  } catch (e) { /* stockage indisponible */ }
})();
