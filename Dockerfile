# Pinned by digest so Dependabot proposes a fix: commit, and so a release, when the image is rebuilt with security updates.
FROM node:26-slim@sha256:e4db4c914bf8ad241bd24804fc25d272d89bad97e68cdc8a1414862790a02c39
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY LICENSE THIRD_PARTY_NOTICES.md server.js ./
COPY src ./src
COPY public ./public
RUN mkdir -p /data /media && chown node:node /data
ENV DATA_DIR=/data HOST=0.0.0.0 MEDIA_DIR=/media
VOLUME /data
EXPOSE 3000
USER node
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
