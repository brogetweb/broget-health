FROM node:22-bookworm-slim AS web
RUN apt-get update && apt-get install -y --no-install-recommends git curl unzip xz-utils ca-certificates libglu1-mesa && rm -rf /var/lib/apt/lists/*
# Use the same Flutter release used for local validation.
ARG FLUTTER_VERSION=3.47.5
RUN git clone --depth 1 --branch ${FLUTTER_VERSION} https://github.com/flutter/flutter.git /opt/flutter
ENV PATH="/opt/flutter/bin:${PATH}"
WORKDIR /app
COPY pubspec.yaml pubspec.lock ./
RUN flutter config --no-analytics && flutter pub get
COPY lib ./lib
COPY web ./web
COPY assets ./assets
COPY scripts/web-build-config.mjs scripts/prepare-web.mjs ./scripts/
RUN mkdir -p config
# These are public SDK identifiers only. Never declare database, AI or Cloudinary secrets as build ARGs.
ARG PUBLIC_APP_ORIGIN
ARG FIREBASE_API_KEY
ARG FIREBASE_APP_ID
ARG FIREBASE_PROJECT_ID
ARG FIREBASE_MESSAGING_SENDER_ID
ARG FIREBASE_AUTH_DOMAIN
ARG RECAPTCHA_SITE_KEY
ARG APP_DOWNLOAD_URL
RUN node scripts/web-build-config.mjs && flutter build web --release --dart-define-from-file=config/railway-build.local.json && node scripts/prepare-web.mjs

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY backend/src ./src
COPY --from=web /app/build/web /app/build/web
USER node
EXPOSE 8080
CMD ["node", "src/server.js"]
