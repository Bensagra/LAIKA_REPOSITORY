FROM docker:cli

RUN apk add --no-cache bash git curl libc6-compat

# Instala el webhook listener de adnanh
RUN WEBHOOK_VER=2.8.1 && \
    curl -sSL "https://github.com/adnanh/webhook/releases/download/${WEBHOOK_VER}/webhook-linux-amd64.tar.gz" \
    | tar -xz --strip-components=1 -C /usr/local/bin

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
COPY redeploy.sh /usr/local/bin/redeploy.sh
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/redeploy.sh

EXPOSE 9000
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
