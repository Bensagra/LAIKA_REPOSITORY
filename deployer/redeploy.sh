#!/bin/bash
set -e

BRANCH="MELI---BACKEND---DEV"

echo "[DEPLOY] $(date): Iniciando redeploy desde $BRANCH..."

git config --global --add safe.directory /workspace/app 2>/dev/null || true

# Actualiza el código de la branch del backend
git -C /workspace/app pull origin "$BRANCH"

# Copia el Dockerfile de infra al directorio de la app
cp /workspace/Dockerfile.app /workspace/app/Dockerfile

echo "[DEPLOY] Rebuildeando y reiniciando contenedor app..."
docker compose -f /workspace/docker-compose.yml up --build -d app

echo "[DEPLOY] Listo en $(date)"
