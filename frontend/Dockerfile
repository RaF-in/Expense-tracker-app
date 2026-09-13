# Stage 1 — build. Keeps the Node toolchain off the host (ARCH A13).
FROM node:22-alpine AS build
WORKDIR /src

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Stage 2 — serve. No path to a dev server exists (R6).
FROM nginx:stable-alpine AS runtime

COPY --from=build /src/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY config.js.template /usr/share/nginx/app-config/config.js.template
COPY docker-entrypoint.d/40-app-config.sh /docker-entrypoint.d/40-app-config.sh
# A non-executable file in /docker-entrypoint.d/ is silently skipped by the
# nginx entrypoint — a running container with no config.js at all.
RUN chmod +x /docker-entrypoint.d/40-app-config.sh

EXPOSE 80
