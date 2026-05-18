#!/bin/bash
set -e

# Genera hooks.json con el secreto real del entorno
cat > /tmp/hooks.json << EOF
[
  {
    "id": "redeploy",
    "execute-command": "/usr/local/bin/redeploy.sh",
    "command-working-directory": "/workspace",
    "response-message": "Redeploy iniciado",
    "trigger-rule": {
      "and": [
        {
          "match": {
            "type": "payload-hmac-sha256",
            "secret": "${WEBHOOK_SECRET}",
            "parameter": {
              "source": "header",
              "name": "X-Hub-Signature-256"
            }
          }
        },
        {
          "match": {
            "type": "value",
            "value": "refs/heads/MELI---BACKEND---DEV",
            "parameter": {
              "source": "payload",
              "name": "ref"
            }
          }
        }
      ]
    }
  }
]
EOF

exec webhook -hooks /tmp/hooks.json -verbose -ip 0.0.0.0 -port 9000
