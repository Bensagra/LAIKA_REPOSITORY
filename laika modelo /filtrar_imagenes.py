import requests
import os
import shutil

SERVIDOR = "http://localhost:3000/analyze"
CARPETAS_ORIGEN = ["grieta", "humedad", "corrosion", "desgaste", "sin_danos"]
DESCARTADAS = "descartadas"
EXTS = (".jpg", ".jpeg", ".png", ".webp")

for c in ["grieta", "humedad", "corrosion", "desgaste", "sin_danos", DESCARTADAS]:
    os.makedirs(c, exist_ok=True)

procesadas = 0
movidas = 0
descartadas = 0

todas = []
for carpeta in CARPETAS_ORIGEN:
    for f in os.listdir(carpeta):
        if f.lower().endswith(EXTS):
            todas.append(os.path.join(carpeta, f))

print(f"Total a analizar: {len(todas)} imagenes\n")

for ruta in todas:
    nombre = os.path.basename(ruta)
    try:
        with open(ruta, "rb") as f:
            resp = requests.post(SERVIDOR, files={"image": (nombre, f, "image/jpeg")}, timeout=30)

        if resp.status_code != 200:
            shutil.move(ruta, os.path.join(DESCARTADAS, nombre))
            descartadas += 1
            continue

        data = resp.json()

        if not data.get("tiene_daños"):
            destino = "sin_danos"
        else:
            danos = data.get("daños_detectados", [])
            if not danos:
                destino = "sin_danos"
            else:
                tipo = danos[0].get("tipo", "").lower()
                if "grieta" in tipo or "crack" in tipo or "rotura" in tipo:
                    destino = "grieta"
                elif "humedad" in tipo or "agua" in tipo or "mancha" in tipo:
                    destino = "humedad"
                elif "corrosión" in tipo or "corrosion" in tipo or "oxidación" in tipo:
                    destino = "corrosion"
                elif "desgaste" in tipo or "deterioro" in tipo or "deformación" in tipo:
                    destino = "desgaste"
                else:
                    destino = "grieta"

        destino_ruta = os.path.join(destino, nombre)
        if ruta != destino_ruta:
            shutil.move(ruta, destino_ruta)
            movidas += 1

        procesadas += 1
        sev = data.get("nivel_severidad_general", 0)
        print(f"[{procesadas}/{len(todas)}] {nombre} → {destino} (severidad {sev})")

    except Exception as e:
        print(f"  Error en {nombre}: {e}")
        shutil.move(ruta, os.path.join(DESCARTADAS, nombre))
        descartadas += 1

print(f"\nListo.")
for c in ["grieta", "humedad", "corrosion", "desgaste", "sin_danos"]:
    print(f"  {c}/: {len(os.listdir(c))} imagenes")
print(f"  descartadas/: {descartadas}")
