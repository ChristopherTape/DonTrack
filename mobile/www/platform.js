/* =========================================================================
   DonTrack mobile — couche plateforme

   Un seul point de contact avec Android. Si le pont natif est absent
   (ouverture dans un navigateur pour mise au point), on retombe sur
   localStorage et les API web : l'interface reste utilisable à l'identique.
   ========================================================================= */

(function (global) {
  'use strict';

  const bridge = global.AndroidBridge || null;
  const KEY = 'dontrack.data';

  let importResolver = null;

  const Platform = {
    isNative: !!bridge,

    /** Lit l'intégralité des données (objet déjà normalisé par l'appelant). */
    async load() {
      try {
        const raw = bridge ? bridge.load() : global.localStorage.getItem(KEY);
        if (!raw) return null;
        return JSON.parse(raw);
      } catch (e) {
        console.error('load', e);
        return null;
      }
    },

    /** Écrit l'intégralité des données. Appelé après chaque modification. */
    async save(data) {
      const json = JSON.stringify(data);
      if (bridge) bridge.save(json);
      else global.localStorage.setItem(KEY, json);
      return true;
    },

    /**
     * Envoie un document HTML complet vers l'impression Android : la
     * destination « Enregistrer au format PDF » produit le fichier final.
     */
    async printPdf(html, jobName) {
      if (bridge) {
        bridge.printHtml(html, jobName || 'DonTrack');
        return { ok: true, native: true };
      }
      const w = global.open('', '_blank');
      if (!w) return { ok: false, error: 'Fenêtre bloquée' };
      w.document.write(html);
      w.document.close();
      setTimeout(() => w.print(), 400);
      return { ok: true, native: false };
    },

    /** Dépose un fichier texte dans le dossier Téléchargements, puis le partage. */
    async exportFile(name, mime, content) {
      if (bridge) {
        const path = bridge.exportFile(name, mime, content);
        return path ? { ok: true, path } : { ok: false };
      }
      const blob = new Blob([content], { type: mime + ';charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      return { ok: true, path: name };
    },

    /** Ouvre le sélecteur de fichiers Android et résout avec le texte lu. */
    importFile() {
      if (!bridge) {
        return new Promise((resolve) => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'application/json,.json';
          input.onchange = () => {
            const file = input.files && input.files[0];
            if (!file) return resolve(null);
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => resolve(null);
            reader.readAsText(file);
          };
          input.click();
        });
      }
      return new Promise((resolve) => {
        importResolver = resolve;
        bridge.pickImport();
      });
    },

    /** Rappelé depuis Java à la fin du sélecteur de fichiers. */
    _onImport(text) {
      if (importResolver) {
        const r = importResolver;
        importResolver = null;
        r(text || null);
      }
    },

    version() {
      try { return bridge ? bridge.appVersion() : '1.0.0 (web)'; } catch (_) { return '1.0.0'; }
    },

    storageLabel() {
      try { return bridge ? bridge.storageLabel() : 'Stockage du navigateur'; } catch (_) { return ''; }
    }
  };

  global.DTPlatform = Platform;
})(window);
