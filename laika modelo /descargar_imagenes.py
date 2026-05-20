from duckduckgo_search import DDGS
import requests
import os
import time

busquedas = [
    ("rust corrosion metal building structure", "corrosion", 80),
    ("corroded iron pipe building deterioration", "corrosion", 80),
    ("rusted metal facade building exterior", "corrosion", 80),
    ("concrete crack building wall exterior close", "grieta", 80),
    ("cracked plaster wall building damage", "grieta", 80),
    ("building paint peeling worn deteriorated facade", "desgaste", 80),
    ("old building worn exterior deterioration", "desgaste", 80),
]

HEADERS = {"User-Agent": "Mozilla/5.0"}

def descargar(url, ruta):
    try:
        r = requests.get(url, headers=HEADERS, timeout=8)
        if r.status_code == 200 and "image" in r.headers.get("Content-Type", ""):
            with open(ruta, "wb") as f:
                f.write(r.content)
            return True
    except:
        pass
    return False

for termino, carpeta, cantidad in busquedas:
    os.makedirs(carpeta, exist_ok=True)
    existentes = len(os.listdir(carpeta))
    print(f"\nBuscando: '{termino}'")
    descargadas = 0
    try:
        with DDGS() as ddgs:
            resultados = list(ddgs.images(termino, max_results=cantidad))
        for r in resultados:
            nombre = f"{existentes + descargadas:04d}_b.jpg"
            ruta = os.path.join(carpeta, nombre)
            if descargar(r["image"], ruta):
                descargadas += 1
            time.sleep(0.3)
    except Exception as e:
        print(f"  Error: {e}")
    print(f"  Descargadas: {descargadas}")

print("\nResumen:")
for c in ["grieta", "humedad", "corrosion", "desgaste", "sin_danos"]:
    n = len(os.listdir(c)) if os.path.exists(c) else 0
    print(f"  {c}/: {n} imagenes")
