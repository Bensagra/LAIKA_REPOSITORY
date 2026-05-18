from duckduckgo_search import DDGS
import requests
import os
import time

CARPETAS = ["grieta", "humedad", "corrosion", "desgaste", "sin_danos"]
for c in CARPETAS:
    os.makedirs(c, exist_ok=True)

busquedas = [
    ("building facade crack damage wall", "grieta", 60),
    ("cracked concrete wall exterior building", "grieta", 60),
    ("building wall humidity water stain damage", "humedad", 60),
    ("facade water damage moisture building", "humedad", 60),
    ("metal corrosion rust building structure", "corrosion", 50),
    ("corroded iron beam building deterioration", "corrosion", 50),
    ("building facade wear deterioration old", "desgaste", 50),
    ("worn exterior wall building paint peeling", "desgaste", 50),
    ("clean new building facade exterior", "sin_danos", 60),
    ("modern building wall no damage", "sin_danos", 60),
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

total = 0
for termino, carpeta, cantidad in busquedas:
    print(f"\nBuscando: '{termino}'")
    existentes = len(os.listdir(carpeta))
    descargadas = 0
    try:
        with DDGS() as ddgs:
            resultados = list(ddgs.images(termino, max_results=cantidad))
        for r in resultados:
            nombre = f"{existentes + descargadas:04d}.jpg"
            ruta = os.path.join(carpeta, nombre)
            if descargar(r["image"], ruta):
                descargadas += 1
            time.sleep(0.3)
    except Exception as e:
        print(f"  Error: {e}")
    print(f"  Descargadas: {descargadas}")
    total += descargadas

print(f"\nTotal: {total} imagenes")
for c in CARPETAS:
    print(f"  {c}/: {len(os.listdir(c))} imagenes")
