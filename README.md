# DonTrack

Suivi et répartition des dons, en **desktop (Windows)**, en **mobile (Android)**
et en **web multi-utilisateurs** (serveur centralisé avec comptes et connexion).
Chaque don est enregistré avec son donateur et son montant, puis réparti
nominativement entre plusieurs bénéficiaires — ce qui donne une traçabilité
complète : qui a donné combien, et qui a reçu quoi.

Les trois versions partagent le même modèle de données, les mêmes calculs et le
même rapport PDF. Les versions desktop et mobile gardent tout sur l'appareil ;
la version web centralise les saisies de toute l'équipe sur un serveur unique.

---

## Version desktop (Windows)

```bash
npm install     # une seule fois
npm start       # lance l'application
```

Livrables déjà construits dans `dist/` :

| Fichier | Usage |
|---|---|
| `DonTrack Setup 1.0.0.exe` | installateur classique |
| `DonTrack 1.0.0.exe` | version portable, sans installation |

Pour reconstruire : `npm run build`.

### Les trois sections

| Section | Contenu |
|---|---|
| **Tableau de bord** | 4 indicateurs, filtres (période, recherche, statut), tableau des dons. Un clic sur une ligne déplie sa répartition ; le bouton `⋯` ouvre le détail (modifier / supprimer). |
| **Statistiques** | Évolution mensuelle collecté/réparti, jauge du taux de répartition, principaux bénéficiaires et donateurs. Chaque graphique a une vue *Tableau* équivalente. |
| **Rapports** | Aperçu en direct, choix du contenu, génération d'un PDF A4 paginé enregistré où vous voulez sur le PC. |

### Raccourcis

`Ctrl+N` nouveau don · `Ctrl+F` recherche · `Ctrl+Entrée` valider l'étape ·
`Échap` fermer une pop-up

### Où sont les données

```
%APPDATA%\DonTrack\dontrack-data.json
%APPDATA%\DonTrack\sauvegardes\        (30 sauvegardes datées, une par démarrage)
```

---

## Version mobile (Android)

APK prêt à installer : **`dist/DonTrack-1.0.0.apk`** (environ 240 Ko).

Installation : copier le fichier sur le téléphone, l'ouvrir, et autoriser
l'installation depuis cette source si Android le demande (l'application n'est
pas distribuée par le Play Store).

Compatible **Android 7.0 et plus** (minSdk 24, targetSdk 35).

### Interface

- **Dons** — carte de synthèse (collecté / réparti / reste), filtres en pastilles,
  liste des dons. Appui court sur une carte : déplier la répartition.
  Appui long : fiche détaillée (modifier / supprimer). Bouton **+** : nouveau don.
- **Statistiques** — tuiles, jauge du taux de répartition, évolution mensuelle
  (6 derniers mois), principaux bénéficiaires et donateurs, chacun avec sa vue tableau.
- **Rapport** — mêmes options que sur desktop, aperçu intégré, puis **Générer le PDF**
  qui ouvre l'impression Android : choisir *« Enregistrer au format PDF »*.
  En dessous, export **CSV** et **sauvegarde JSON** déposés dans *Téléchargements*.

La saisie reprend le même parcours en deux étapes. À l'étape 2, le bandeau
*Montant / Attribué / Reste à répartir* reste collé en haut de l'écran pendant
toute la saisie ; il passe au vert à zéro et au rouge en cas de dépassement
(l'enregistrement est alors bloqué). Le bouton **Retour** d'Android ferme la
couche affichée avant de quitter.

### Où sont les données

Fichier privé de l'application, inaccessible aux autres applications :

```
/data/data/com.dontrack.app/files/dontrack-data.json
```

*Paramètres → Importer une sauvegarde* restaure un fichier JSON exporté depuis
le téléphone ou depuis la version desktop : les deux formats sont identiques.

### Reconstruire l'APK

```bash
npx electron tools/make-mobile-assets.js   # icônes + logo (si le logo change)
node tools/build-apk.js                    # APK signé dans dist/
```

Le build n'utilise **pas Gradle** : il enchaîne directement les outils du SDK
Android (`aapt2` → `javac` → `d8` → `zipalign` → `apksigner`). Il n'a donc rien
à télécharger et prend quelques secondes. Prérequis : un SDK Android avec
build-tools 34+ et un JDK (celui d'Android Studio convient).

La clé de signature est créée au premier build dans `mobile/signing/dontrack.keystore`
(mot de passe `dontrack`). **Conservez ce fichier** : sans lui, Android refusera
d'installer une future mise à jour par-dessus la version actuelle.

---

## Version web (serveur centralisé)

C'est la version multi-utilisateurs : chaque collecteur se connecte avec son
propre compte, saisit ses dons, et **tout remonte dans une base unique chez
l'administrateur**. Aucun poste ne conserve de copie locale.

```bash
npm run web                 # démarre le serveur sur le port 8080
PORT=9000 npm run web       # autre port
```

Au démarrage, le serveur affiche les adresses d'accès (poste local et réseau
local) ainsi que les identifiants de l'administrateur **lors du tout premier
lancement** :

```
identifiant : admin
mot de passe : admin123
```

Le changement de ce mot de passe est **exigé dès la première connexion** :
aucune autre action n'est possible avant.

### Ce qu'on enregistre

Un don n'est pas forcément de l'argent. À la première étape, on choisit sa
**forme** :

- **Argent** — un montant dans la devise de l'organisation (FCFA par défaut) ;
- **En nature** — vivres, animaux, matériel. On saisit alors la *nature du don*
  (« sacs de riz », « chèvres », « cartons de lait »…) et la *quantité reçue*.

La répartition fonctionne à l'identique dans les deux cas : on attribue des
quantités à des bénéficiaires nommés, et le bandeau *Reste à répartir* se met à
jour en direct dans la bonne unité (« 12 sacs de riz » et non « 12 FCFA »).

Les deux formes ne sont **jamais additionnées** : les totaux en argent restent
en argent, et chaque unité en nature a sa propre ligne dans *Statistiques →
Dons en nature* ainsi que dans le rapport PDF.

Le **type de donateur** propose Particulier, Association, Entreprise et
*Autre…* ; en choisissant *Autre*, un champ demande de préciser (mosquée,
établissement scolaire, collectivité…). La précision s'affiche ensuite partout
à la place du mot « Autre », et les saisies précédentes sont proposées en
suggestion.

### Les deux rôles

| | Collecteur | Administrateur |
|---|---|---|
| Enregistrer un don et sa répartition | oui | oui |
| Voir les dons | **les siens uniquement** | **tous, avec le nom du collecteur** |
| Modifier / supprimer un don | les siens | **tous** |
| Statistiques et rapport PDF | sur ses propres saisies | sur l'ensemble, avec filtre par collecteur |
| Créer et gérer les comptes | non | oui |
| Journal d'activité | non | oui |

L'administrateur dispose en plus d'un graphique **Collecte par utilisateur** et
d'une section correspondante dans le rapport PDF : qui a fait entrer combien.

### Créer les comptes des collecteurs

*Utilisateurs → Nouvel utilisateur* : nom complet, identifiant de connexion,
rôle et mot de passe provisoire (un bouton en génère un au hasard). La personne
devra le changer à sa première connexion. Un compte se **désactive** plutôt
qu'il ne se supprime : les dons qu'il a saisis restent dans les comptes, et ses
sessions ouvertes sont immédiatement coupées.

### Échelle de temps

Une collecte se joue souvent sur quelques jours. Le graphique d'évolution est
donc **journalier par défaut** : un point par jour, les jours sans don restés à
zéro pour ne pas lisser le rythme. Deux autres pas sont disponibles d'un clic —
*Semaine* et *Mois* — et le graphique défile horizontalement quand les jours
sont trop nombreux pour tenir à l'écran. Le rapport PDF reprend le pas choisi.

### Thème et affichage

Le **thème clair est le réglage par défaut** ; le **mode nuit** se bascule
depuis le menu du compte (ou l'icône de lune sur téléphone) et reste mémorisé
sur l'appareil. Il est appliqué avant le premier rendu, sans clignotement.

La mise en page s'adapte à trois formats :

| Format | Mise en page |
|---|---|
| Téléphone (< 640 px) | une colonne, navigation basse, bouton flottant, menu latéral en tiroir |
| Tablette (640–1023 px) | deux colonnes, navigation basse, feuilles centrées |
| Ordinateur (≥ 1024 px) | barre latérale fixe, bandeau d'indicateurs asymétrique, boîtes de dialogue centrées |

### Accès depuis les téléphones

L'interface est responsive : barre latérale sur ordinateur, navigation basse et
bouton flottant sur téléphone. Les collecteurs ouvrent simplement l'adresse
réseau affichée au démarrage (`http://<ip-du-serveur>:8080`) depuis le
navigateur de leur téléphone, sur le même réseau Wi-Fi.

### Où sont les données

Une base SQLite unique, côté serveur. Par défaut un simple fichier :

```
web/data/dontrack.db          (DONTRACK_DATA pour choisir un autre dossier)
```

En ligne, la même base peut être distante — voir *Mettre l'application en
ligne*. Le code est identique dans les deux cas : seule `DONTRACK_DB_URL`
change.

Sauvegarde du fichier local : copiez-le (ainsi que `dontrack.db-wal` s'il
existe) pendant que le serveur est arrêté. Dans tous les cas, l'administrateur
peut télécharger une sauvegarde JSON depuis *Paramètres de l'organisation*.

### Sécurité

- Mots de passe hachés en **scrypt** avec sel individuel — jamais stockés en clair.
- Sessions en cookie **HttpOnly / SameSite=Strict**, valables 12 h.
- En-tête applicatif exigé sur toute écriture (protection CSRF), **CSP stricte**,
  `nosniff`, `X-Frame-Options`.
- Blocage temporaire après 8 tentatives de connexion échouées.
- **Journal d'activité** : connexions, échecs, créations, modifications et
  suppressions, avec l'auteur et l'horodatage.

> Le serveur parle en HTTP. Sur un réseau local fermé c'est l'usage normal. Pour
> un accès depuis Internet, placez-le derrière un reverse proxy HTTPS (nginx,
> Caddy) et démarrez-le avec `DONTRACK_HTTPS=1` afin que le cookie de session
> porte l'attribut `Secure`.


### Mettre l'application en ligne

**Seule la version web est hébergée.** Les versions desktop et Android sont des
applications installées sur l'appareil. L'image de production ne contient que
le serveur, ses pages et le noyau métier partagé — ni le code Electron, ni
l'application Android.

#### Le point qui décide de l'hébergeur

La base est un fichier SQLite. Or les offres d'hébergement gratuites ont un
disque **éphémère** : il est remis à zéro à chaque redéploiement et à chaque
réveil de l'instance. Sur un registre de dons, cela veut dire perdre toutes les
saisies sans prévenir.

La solution retenue sépare les deux : l'application tourne sur un hébergeur
gratuit, la base vit chez un service de base de données gratuit. Le code ne voit
aucune différence — `DONTRACK_DB_URL` désigne soit un fichier local
(`file:…`, pour le poste de travail), soit une base distante (`libsql://…`).

#### Render + Turso — gratuit, sans carte bancaire

| | Service | Offre gratuite |
|---|---|---|
| Application | [Render](https://render.com) | sans carte ; veille après 15 min d'inactivité, ~1 min au réveil |
| Base de données | [Turso](https://turso.tech) | sans carte ; 5 Go, 500 millions de lectures par mois |

**1. Créer la base**

```bash
# https://turso.tech → créer un compte (aucune carte demandée)
turso db create dontrack
turso db show dontrack --url        # → DONTRACK_DB_URL  (libsql://…)
turso db tokens create dontrack     # → DONTRACK_DB_TOKEN
```

La console web de Turso donne les mêmes informations sans installer d'outil.

**2. Déployer l'application**

Sur [dashboard.render.com](https://dashboard.render.com) : **New + → Blueprint**,
choisir le dépôt GitHub. Render lit `render.yaml`, construit le `Dockerfile` et
demande les trois valeurs à renseigner :

| Variable | Valeur |
|---|---|
| `DONTRACK_DB_URL` | l'adresse `libsql://…` de l'étape 1 |
| `DONTRACK_DB_TOKEN` | le jeton de l'étape 1 |
| `DONTRACK_ADMIN_PASSWORD` | le mot de passe du premier administrateur |

Le reste (port, HTTPS, proxy, sonde `/health`) est déjà dans `render.yaml`.

Si `DONTRACK_ADMIN_PASSWORD` est laissé vide, un mot de passe est tiré au hasard
et affiché **une seule fois** dans les journaux Render.

**La mise en veille.** Sans visite pendant 15 minutes, Render endort le service ;
la visite suivante attend environ une minute. C'est le prix du gratuit, et cela
ne touche pas aux données : elles sont chez Turso.

#### Autres hébergeurs

- **Fly.io** (`fly.toml` fourni) — volume persistant, donc la base peut rester un
  simple fichier et Turso devient inutile. Pas de mise en veille gênante, mais
  **une carte bancaire est exigée** et les cartes prépayées sont refusées.
  Comptez quelques dizaines de centimes à ~2 $/mois.
- **Oracle Cloud « Always Free »** — une vraie machine virtuelle gratuite sans
  limite de durée. Davantage d'installation (Docker et HTTPS à poser soi-même).
- **Votre propre machine** — `npm run web` suffit sur le réseau de
  l'association, sans compte ni mise en ligne.

#### Variables d'environnement

| Variable | Rôle | Hors ligne | En ligne |
|---|---|---|---|
| `DONTRACK_DB_URL` | emplacement de la base | `file:…` (par défaut) | `libsql://…` |
| `DONTRACK_DB_TOKEN` | jeton de la base distante | — | jeton Turso |
| `DONTRACK_DATA` | dossier du fichier local | `web/data` | inutilisé |
| `PORT` | port d'écoute | `8080` | `8080` |
| `DONTRACK_HTTPS` | cookie `Secure` + HSTS | — | `1` |
| `DONTRACK_TRUST_PROXY` | lire l'IP réelle du visiteur | — | `1` |
| `DONTRACK_ADMIN_PASSWORD` | mot de passe initial | facultatif | recommandé |

#### Sauvegardes

Une fois en ligne, le fichier de base n'est plus à portée de main.
L'administrateur dispose donc, dans *Paramètres de l'organisation*, d'un bouton
**« Télécharger une sauvegarde complète »** : un fichier JSON contenant tous les
dons, leur répartition et la liste des comptes — jamais les mots de passe.
Prenez-en une régulièrement.

#### Sécurité en accès public

- Le mot de passe du premier administrateur n'est **jamais** une valeur connue :
  il est fourni par vous ou tiré au hasard, et son changement est exigé à la
  première connexion.
- `DONTRACK_HTTPS=1` ajoute `Secure` au cookie de session et l'en-tête HSTS.
- Le blocage après tentatives répétées compte par **adresse réelle du
  visiteur** grâce à `DONTRACK_TRUST_PROXY=1`, et non par celle du proxy.
- La sonde `/health` ne touche ni aux sessions ni à la base.

### Structure

```
web/server.js        serveur HTTP, routage, fichiers statiques, en-têtes de sécurité
web/lib/db.js        base SQLite (node:sqlite) : utilisateurs, dons, journal
web/lib/auth.js      scrypt, sessions, limitation des tentatives
web/lib/api.js       API JSON et règles d'accès par rôle
web/public/          page de connexion + application (réutilise src/shared/)
```

Aucune dépendance npm : SQLite et le hachage viennent de Node lui-même.

> **Portée des dons en nature et de l'échelle journalière.** Ces deux ajouts,
> ainsi que la refonte visuelle, concernent la version web. Les versions
> desktop et Android partagent le même noyau de calcul et affichent sans
> problème des données en nature qui leur seraient importées, mais leur
> formulaire de saisie reste celui des dons en argent. Dites-le-moi si vous
> voulez que je les aligne.


---

## Structure

```
src/shared/core.js       modèle, formatage, filtres, agrégats — commun aux 2 versions
src/shared/charts.js     graphiques SVG sans dépendance (survol + appui tactile)
src/shared/report.js     document du rapport (aperçu écran et PDF)

src/main/main.js         desktop : fenêtre, IPC, dialogues, impression PDF
src/main/store.js        desktop : persistance JSON atomique + sauvegardes
src/main/preload.js      desktop : pont sécurisé (contextIsolation)
src/renderer/            desktop : page unique, 3 sections + pop-ups

mobile/www/              mobile : interface tactile (index.html, styles.css, app.js)
mobile/www/platform.js   mobile : couche plateforme, avec repli navigateur
mobile/android/          mobile : manifeste, ressources, MainActivity.java

web/server.js            web : serveur HTTP sans dépendance
web/lib/                 web : base SQLite, authentification, API
web/public/              web : page de connexion et application

tools/make-icons.js         détoure le logo, génère assets/icon.png
tools/make-mobile-assets.js icônes de lanceur Android + logo embarqué
tools/build-apk.js          construction de l'APK signé
```

## Choix techniques

- **Aucune dépendance d'exécution** : Electron d'un côté, une WebView Android de
  l'autre ; graphiques, rapport et PDF faits maison.
- **Un seul noyau métier** (`src/shared/core.js`) : les deux versions calculent
  les mêmes totaux et produisent le même rapport.
- **Palette de données validée** pour le daltonisme et le contraste, en thème
  sombre comme en thème clair (bleu = collecté, vert = réparti, ambre = reste).
- **Sécurité** : desktop en `contextIsolation` sans Node dans l'interface et CSP
  stricte ; Android sans aucune permission, pont JavaScript réduit à six méthodes.
