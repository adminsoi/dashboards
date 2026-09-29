# Caddy with DNS-01 challenge support.
#
# The stock caddy image can only prove domain ownership over HTTP, which needs
# Let's Encrypt to reach port 80 from the internet. This host has no public IP
# by design, so that is impossible — and Entra will not accept a plain-http
# redirect URI, so a real certificate is not optional.
#
# DNS-01 proves ownership by writing a temporary TXT record instead. Nothing is
# ever exposed. That needs a provider plugin compiled in, which is what this
# build does.
#
# Both providers are included so switching is a Caddyfile edit, not a rebuild:
#   godaddy — where soiaviation.com DNS lives today
#   route53 — if the zone (or a delegated subdomain) moves to AWS; it can then
#             use the instance's IAM role and needs no API key at all
FROM caddy:2-builder AS build
RUN xcaddy build \
    --with github.com/caddy-dns/godaddy \
    --with github.com/caddy-dns/route53

FROM caddy:2
COPY --from=build /usr/bin/caddy /usr/bin/caddy
