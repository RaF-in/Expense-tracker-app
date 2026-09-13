#!/bin/sh
# Renders /usr/share/nginx/html/config.js from the template at container start.
# Runs as part of the nginx base image's documented /docker-entrypoint.d/
# startup hook — no ENTRYPOINT override. The app bundle cannot carry these
# values: Vite bakes them at build time, but the pod runs nginx while the code
# that needs them runs in the user's browser.
#
# Fail fast and name the cause: a blank value would render a syntactically
# valid config that fails much later, at Auth0, as an opaque-token error.
set -eu

template="/usr/share/nginx/app-config/config.js.template"
output="/usr/share/nginx/html/config.js"

missing=""
[ -n "${AUTH0_DOMAIN:-}" ]    || missing="$missing AUTH0_DOMAIN"
[ -n "${AUTH0_CLIENT_ID:-}" ] || missing="$missing AUTH0_CLIENT_ID"
[ -n "${AUTH0_AUDIENCE:-}" ]  || missing="$missing AUTH0_AUDIENCE"

if [ -n "$missing" ]; then
    echo "40-app-config.sh: missing required environment variable(s):$missing" >&2
    echo "  Set AUTH0_DOMAIN, AUTH0_CLIENT_ID and AUTH0_AUDIENCE (secretKeyRef" >&2
    echo "  from k8s/secrets.yaml) — see docs/auth0-setup-runbook.md." >&2
    exit 1
fi

# The values below are interpolated into a double-quoted JS string literal in
# config.js.template with no further escaping. A stray " or \ would break out
# of that literal and inject arbitrary JS into every browser that loads the
# app, so reject any value that could do that before envsubst ever runs.
unsafe=""
case "$AUTH0_DOMAIN"    in *'"'*|*'\'*) unsafe="$unsafe AUTH0_DOMAIN" ;; esac
case "$AUTH0_CLIENT_ID" in *'"'*|*'\'*) unsafe="$unsafe AUTH0_CLIENT_ID" ;; esac
case "$AUTH0_AUDIENCE"  in *'"'*|*'\'*) unsafe="$unsafe AUTH0_AUDIENCE" ;; esac

if [ -n "$unsafe" ]; then
    echo "40-app-config.sh: unsafe character (\" or \\) in:$unsafe" >&2
    exit 1
fi

# Substitute only the three named variables, leaving any other $… untouched.
envsubst '${AUTH0_DOMAIN} ${AUTH0_CLIENT_ID} ${AUTH0_AUDIENCE}' \
    < "$template" > "$output"

# The domain is public by design (core-api logs it too); clientId and audience
# are equally public, but keep logs minimal — domain alone confirms the render.
echo "40-app-config.sh: rendered config.js (domain: ${AUTH0_DOMAIN})"
