# =========================================================================
#  DonTrack — image de production (version web uniquement)
#
#  Base Debian « slim » plutôt qu'Alpine : le client libSQL embarque un
#  module natif dont les binaires précompilés visent la glibc.
# =========================================================================

FROM node:24-slim

# tini : transmet correctement SIGTERM à Node lors des redémarrages
RUN apt-get update && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dépendances d'abord : cette couche est réutilisée tant qu'elles ne bougent pas.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Seule la version web est hébergée : ni le code Electron (src/main,
# src/renderer) ni l'application Android ne sont embarqués.
COPY src/shared ./src/shared
COPY web/server.js ./web/server.js
COPY web/lib ./web/lib
COPY web/public ./web/public

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    DONTRACK_DATA=/data \
    DONTRACK_HTTPS=1 \
    DONTRACK_TRUST_PROXY=1

# Utilisé seulement si la base reste un fichier local (hébergeur avec volume).
# Avec Turso, DONTRACK_DB_URL prend le relais et ce dossier reste vide.
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]

USER node
EXPOSE 8080

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "web/server.js"]
