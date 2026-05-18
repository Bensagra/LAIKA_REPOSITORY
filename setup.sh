#!/bin/bash
set -e

# ── 1. Verifica .env ───────────────────────────────────────────────────────
if [ ! -f .env ]; then
  cp .env.example .env
  echo ""
  echo "╔══════════════════════════════════════════════════════════════╗"
  echo "║  Archivo .env creado. Completá las credenciales:            ║"
  echo "║  nano .env                                                   ║"
  echo "║  Luego volvé a correr: bash setup.sh                        ║"
  echo "╚══════════════════════════════════════════════════════════════╝"
  exit 0
fi

# ── 2. Clona la branch del backend ────────────────────────────────────────
if [ ! -d ./app/.git ]; then
  echo "[SETUP] Clonando branch MELI---BACKEND---DEV..."
  rm -rf ./app
  git clone \
    --branch MELI---BACKEND---DEV \
    --single-branch \
    https://github.com/Bensagra/LAIKA_REPOSITORY.git \
    ./app
else
  echo "[SETUP] Branch ya clonada, actualizando..."
  git -C ./app pull origin MELI---BACKEND---DEV
fi

# ── 3. Copia el Dockerfile al contexto de la app ──────────────────────────
cp Dockerfile.app app/Dockerfile

# ── 4. Levanta los contenedores ───────────────────────────────────────────
echo "[SETUP] Levantando contenedores..."
docker compose up --build -d

echo ""
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║  Todo listo!                                                    ║"
echo "╠══════════════════════════════════════════════════════════════════╣"
echo "║  API:     http://$(hostname -I | awk '{print $1}'):3000          ║"
echo "║  Webhook: http://$(hostname -I | awk '{print $1}'):9000/hooks/redeploy ║"
echo "╠══════════════════════════════════════════════════════════════════╣"
echo "║  Configurar webhook en GitHub:                                  ║"
echo "║  Repo → Settings → Webhooks → Add webhook                      ║"
echo "║   Payload URL: http://TU_IP:9000/hooks/redeploy                ║"
echo "║   Content type: application/json                               ║"
echo "║   Secret: (valor de WEBHOOK_SECRET en .env)                    ║"
echo "║   Events: Just the push event                                  ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
