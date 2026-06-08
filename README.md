# LAIKA Wound AI

Pipeline para entrenar modelos de vision que detectan y categorizan quemaduras o heridas usando Ultralytics YOLO.

## Dataset recomendado

Para deteccion de quemaduras, el mejor arranque practico es:

1. `shubhambaid/skin-burn-dataset` en Kaggle: aprox. 1300 imagenes, labels YOLO, clases `first_degree_burn`, `second_degree_burn`, `third_degree_burn`, licencia CC0.
2. `binussss/burn-wound-classification` en Roboflow Universe: 3691 imagenes, object detection, licencia CC BY 4.0. Es mas grande, pero requiere cuenta/API de Roboflow y sus clases aparecen como `0`, `1`, `2`.

Para heridas generales, `yasinpratomo/wound-dataset` en Kaggle sirve para clasificacion de tipo de herida, pero no trae bounding boxes. Por eso este repo soporta dos tareas:

- `detect`: localiza la lesion y predice clase cuando el dataset tiene labels YOLO.
- `classify`: predice la categoria de una imagen cuando el dataset viene en carpetas por clase.

Importante: esto es investigacion/triage visual, no diagnostico medico. Antes de usarlo en salud real hace falta validacion clinica, control de sesgos, consentimiento/licencias y revision profesional.

## Setup

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

## Descargar y preparar el dataset de quemaduras

```bash
laika-prepare kaggle-detect \
  --dataset shubhambaid/skin-burn-dataset \
  --output data/processed/skin_burn
```

Esto descarga el dataset con `kagglehub`, busca imagenes y labels YOLO, crea `train/val/test` si hace falta y genera:

```text
data/processed/skin_burn/data.yaml
```

## Entrenar detector

```bash
laika-train detect \
  --data data/processed/skin_burn/data.yaml \
  --model yolo11n.pt \
  --epochs 80 \
  --imgsz 640 \
  --batch 16 \
  --project runs/wound-ai \
  --name burn-detector
```

El mejor peso queda normalmente en:

```text
runs/wound-ai/burn-detector/weights/best.pt
```

## Predecir sobre una imagen o carpeta

```bash
laika-predict detect \
  --model runs/wound-ai/burn-detector/weights/best.pt \
  --source path/a/imagen_o_carpeta \
  --conf 0.25
```

## Clasificacion de heridas generales

Si descargaste un dataset organizado por carpetas de clase:

```text
data/raw/wounds/
  burns/
  cuts/
  bruises/
  abrasions/
```

preparalo asi:

```bash
laika-prepare classify-folders \
  --input data/raw/wounds \
  --output data/processed/wounds_cls
```

y entrenalo:

```bash
laika-train classify \
  --data data/processed/wounds_cls \
  --model yolo11n-cls.pt \
  --epochs 50 \
  --imgsz 224 \
  --batch 32 \
  --project runs/wound-ai \
  --name wound-classifier
```

## Exportar para produccion

```bash
yolo export model=runs/wound-ai/burn-detector/weights/best.pt format=onnx imgsz=640
```

## Siguiente paso recomendado

Entrena primero con Kaggle Skin Burn para tener una baseline reproducible. Luego mezcla Roboflow si tenes API key y revisa manualmente una muestra de labels, porque en datasets medicos web-scraped suele haber ruido y sesgo visual. Si actualizas Ultralytics a una version con YOLO26, podes cambiar `yolo11n.pt` por `yolo26n.pt`.
