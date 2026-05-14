import fiftyone as fo
import fiftyone.zoo as foz
import os
import shutil

DESTINO = "imagenes_raw"
os.makedirs(DESTINO, exist_ok=True)

print("Descargando imagenes de Open Images...")

dataset = foz.load_zoo_dataset(
    "open-images-v7",
    split="train",
    classes=["Building"],
    max_samples=300,
    only_matching=True,
)

print(f"Descargadas: {len(dataset)} imagenes")

copiadas = 0
for muestra in dataset:
    origen = muestra.filepath
    ext = os.path.splitext(origen)[1].lower()
    if ext in [".jpg", ".jpeg", ".png"]:
        nombre = f"edificio_{copiadas:04d}{ext}"
        shutil.copy2(origen, os.path.join(DESTINO, nombre))
        copiadas += 1

print(f"Listo. {copiadas} imagenes guardadas en '{DESTINO}/'")
