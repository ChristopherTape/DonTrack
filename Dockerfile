# =========================================================================
#  DonTrack — image de production
#
#  L'application n'a aucune dépendance npm : ni installation, ni compilation.
#  Node 24 est requis (le module intégré node:sqlite n'est disponible sans
#  option qu'à partir de Node 23.4).
# =========================================================================

FROM node:24-alpine

# tini : transmet correctement SIGTERM à Node lors des redémarrages
RUN apk add --no-cache tini

WORKDIR /app

# Seule la version web est hébergée. On n'embarque donc que le serveur,
# ses pages, et le noyau métier partagé — ni le code Electron (src/main,
# src/renderer) ni l'application Android.
COPY package.json ./
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

# La base vit sur un volume : elle survit aux redéploiements.
RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=4s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "web/server.js"]
