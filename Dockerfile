# syntax=docker/dockerfile:1

# Builds the same static output the Pages deploy publishes, and serves it.
#
# The point is running the app without a Node toolchain on the host — not a production
# hosting story. There is no server-side anything: the result is HTML, CSS, JS and one JSON
# file of interest rates.

FROM node:26-alpine AS build

WORKDIR /app

# Dependencies first, so a source change does not re-run the install.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Docker serves the app at the root, unlike GitHub Pages which serves it from a
# subdirectory. `BASE_PATH` is what makes the same build work for both.
ENV BASE_PATH=/
RUN npm run build


FROM nginx:1.31-alpine AS serve

# `nginx:alpine` runs as root by default to bind port 80. Copying in a config that listens
# above 1024 lets it drop to the unprivileged user.
COPY --from=build /app/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/security-headers.conf /etc/nginx/snippets/security-headers.conf

# Dropping to `nginx` is not enough on its own: the base image leaves the paths nginx writes
# at runtime owned by root, so an unprivileged master exits immediately with
# `mkdir() "/var/cache/nginx/client_temp" failed (13: Permission denied)`. The temp caches
# and the pid file have to change hands here, while we are still root.
#
# The `user` directive in the stock nginx.conf is dropped for the same reason — it is
# meaningless once the master is not privileged, and it logs a warning on every start.
RUN chown -R nginx:nginx /var/cache/nginx \
  && touch /var/run/nginx.pid \
  && chown nginx:nginx /var/run/nginx.pid \
  && sed -i '/^user  *nginx;/d' /etc/nginx/nginx.conf

USER nginx
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget --quiet --tries=1 --spider http://localhost:8080/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
