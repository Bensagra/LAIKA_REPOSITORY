import cv2
import numpy as np
import matplotlib.pyplot as plt
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler

# ── CONFIGURACION ──────────────────────────────────────────────────────────────
IMAGEN_PATH = "../daños/imagenes/descarga (22).jpeg"
GUARDAR     = True

# Canny - sensibilidad para detectar grietas (bajar = detecta mas, subir = menos)
CANNY_MIN = 50
CANNY_MAX = 150

# K-means - clusters para daños de area (corrosion, humedad)
K = 4
# ──────────────────────────────────────────────────────────────────────────────


# PASO 1: Cargar imagen
imagen_bgr = cv2.imread(IMAGEN_PATH)
if imagen_bgr is None:
    raise FileNotFoundError(f"No se encontro la imagen: {IMAGEN_PATH}")

imagen_rgb = cv2.cvtColor(imagen_bgr, cv2.COLOR_BGR2RGB)
alto, ancho, _ = imagen_rgb.shape
print(f"[1] Imagen cargada: {ancho}x{alto} px")


# ══════════════════════════════════════════════════════════════════════════════
# RAMA A — GRIETAS con deteccion de bordes (Canny)
# Las grietas son lineas finas de alto contraste. Canny detecta exactamente eso.
# ══════════════════════════════════════════════════════════════════════════════

gris = cv2.cvtColor(imagen_bgr, cv2.COLOR_BGR2GRAY) 

# CLAHE: mejora el contraste localmente para que grietas sutiles se vean mas
clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
gris_mejorado = clahe.apply(gris)

# blur suave para eliminar ruido antes de Canny
gris_blur = cv2.GaussianBlur(gris_mejorado, (5, 5), 0)

# Canny: detecta bordes (cambios bruscos de intensidad = grietas)
bordes = cv2.Canny(gris_blur, CANNY_MIN, CANNY_MAX)

# morfologia: dilatar los bordes para hacer las grietas mas visibles
kernel_crack = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
mascara_grietas = cv2.dilate(bordes, kernel_crack, iterations=1)

# eliminar bordes pequenos (ruido) — solo conservar estructuras de grieta
contornos, _ = cv2.findContours(mascara_grietas, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
mascara_grietas_limpia = np.zeros_like(mascara_grietas)
for cnt in contornos:
    # solo conservar contornos de longitud minima (grietas reales son largas)
    if cv2.arcLength(cnt, False) > 15:
        cv2.drawContours(mascara_grietas_limpia, [cnt], -1, 255, 2)

print(f"[A] Grietas detectadas con Canny")


# ══════════════════════════════════════════════════════════════════════════════
# RAMA B — DAÑOS DE AREA con K-means (corrosion, humedad, manchas)
# Estos daños son zonas amplias de color diferente. K-means los separa bien.
# ══════════════════════════════════════════════════════════════════════════════

# usar HSV: H=tono, S=saturacion, V=brillo
# - corrosion: tono naranja/marron (H: 5-25), saturacion alta
# - humedad:   tono gris/azulado, saturacion baja, V bajo
imagen_hsv = cv2.cvtColor(imagen_bgr, cv2.COLOR_BGR2HSV).astype(np.float32)
imagen_lab = cv2.cvtColor(imagen_bgr, cv2.COLOR_BGR2LAB).astype(np.float32)

# features: H, S, V, canal_A (verde-rojo, detecta oxido/corrosion)
features = np.stack([
    imagen_hsv[:, :, 0],   # Hue (tono de color)
    imagen_hsv[:, :, 1],   # Saturacion
    imagen_hsv[:, :, 2],   # Valor/brillo
    imagen_lab[:, :, 1],   # A: eje verde(-) a rojo(+), clave para corrosion
], axis=-1).reshape(-1, 4)

scaler = StandardScaler()
features_norm = scaler.fit_transform(features)

print(f"[B] Aplicando K-means (K={K}) para daños de area...")
kmeans = KMeans(n_clusters=K, random_state=42, n_init=10)
kmeans.fit(features_norm)
labels      = kmeans.labels_
centroides  = scaler.inverse_transform(kmeans.cluster_centers_)
mapa        = labels.reshape(alto, ancho)

# analizar cada cluster para identificar corrosion y humedad
print(f"\n    Clusters encontrados:")
print(f"    {'#':<4} {'Hue':>6} {'Sat':>6} {'Val':>6} {'A(rojo)':>9}  Tipo estimado")

mascara_corrosion = np.zeros((alto, ancho), dtype=np.uint8)
mascara_humedad   = np.zeros((alto, ancho), dtype=np.uint8)

for i, c in enumerate(centroides):
    hue, sat, val, canal_a = c

    # corrosion: canal A alto (rojizo/anaranjado) y saturacion alta
    es_corrosion = canal_a > 135 and sat > 40

    # humedad: brillo bajo, saturacion baja, tono neutral
    es_humedad = val < 100 and sat < 60 and canal_a < 130

    tipo = "CORROSION" if es_corrosion else ("HUMEDAD" if es_humedad else "normal")
    print(f"    {i:<4} {hue:>6.1f} {sat:>6.1f} {val:>6.1f} {canal_a:>9.1f}  {tipo}")

    if es_corrosion:
        mascara_corrosion[mapa == i] = 255
    if es_humedad:
        mascara_humedad[mapa == i] = 255

# limpiar mascaras de area
kernel_area = np.ones((5, 5), np.uint8)
mascara_corrosion = cv2.morphologyEx(mascara_corrosion, cv2.MORPH_OPEN,  kernel_area)
mascara_corrosion = cv2.morphologyEx(mascara_corrosion, cv2.MORPH_CLOSE, kernel_area)
mascara_humedad   = cv2.morphologyEx(mascara_humedad,   cv2.MORPH_OPEN,  kernel_area)
mascara_humedad   = cv2.morphologyEx(mascara_humedad,   cv2.MORPH_CLOSE, kernel_area)

print(f"\n[B] Mascaras de corrosion y humedad generadas")


# ══════════════════════════════════════════════════════════════════════════════
# COMBINAR y calcular metricas
# ══════════════════════════════════════════════════════════════════════════════

total = alto * ancho
pct_grietas    = np.sum(mascara_grietas_limpia > 0) / total * 100
pct_corrosion  = np.sum(mascara_corrosion > 0)      / total * 100
pct_humedad    = np.sum(mascara_humedad > 0)         / total * 100
pct_total      = min(pct_grietas + pct_corrosion + pct_humedad, 100)

def severidad(pct):
    if pct < 5:   return 1
    if pct < 10:  return 2
    if pct < 20:  return 4
    if pct < 35:  return 6
    if pct < 50:  return 8
    return 10

print(f"\n{'='*50}")
print(f"  RESUMEN DE DAÑOS")
print(f"{'='*50}")
print(f"  Grietas    : {pct_grietas:.1f}%  (severidad {severidad(pct_grietas)}/10)")
print(f"  Corrosion  : {pct_corrosion:.1f}%  (severidad {severidad(pct_corrosion)}/10)")
print(f"  Humedad    : {pct_humedad:.1f}%  (severidad {severidad(pct_humedad)}/10)")
print(f"  TOTAL      : {pct_total:.1f}%  (severidad {severidad(pct_total)}/10)")
print(f"{'='*50}")


# ══════════════════════════════════════════════════════════════════════════════
# VISUALIZAR
# ══════════════════════════════════════════════════════════════════════════════

# imagen combinada: grietas=rojo, corrosion=naranja, humedad=azul
resultado = imagen_rgb.copy().astype(np.float32)

# aplicar colores semitransparentes por tipo
def aplicar_color(img, mascara, color, alpha=0.5):
    overlay = img.copy()
    overlay[mascara > 0] = color
    img[mascara > 0] = img[mascara > 0] * (1 - alpha) + overlay[mascara > 0] * alpha
    return img

resultado = aplicar_color(resultado, mascara_corrosion,       [255, 165,   0])  # naranja
resultado = aplicar_color(resultado, mascara_humedad,         [  0, 120, 255])  # azul
resultado = aplicar_color(resultado, mascara_grietas_limpia,  [255,   0,   0])  # rojo
resultado = resultado.astype(np.uint8)

fig, axes = plt.subplots(2, 3, figsize=(15, 9))
fig.suptitle("Deteccion hibrida: Canny (grietas) + K-means (corrosion/humedad)", fontsize=13)

axes[0, 0].imshow(imagen_rgb);             axes[0, 0].set_title("Original");             axes[0, 0].axis("off")
axes[0, 1].imshow(mascara_grietas_limpia, cmap="Reds");   axes[0, 1].set_title(f"Grietas — Canny ({pct_grietas:.1f}%)");   axes[0, 1].axis("off")
axes[0, 2].imshow(resultado);              axes[0, 2].set_title("Resultado combinado");   axes[0, 2].axis("off")

# segmentacion K-means coloreada
colores = (plt.cm.Set2(np.linspace(0, 1, K))[:, :3] * 255).astype(np.uint8)
seg = np.zeros_like(imagen_rgb)
for i in range(K):
    seg[mapa == i] = colores[i]
axes[1, 0].imshow(seg);                    axes[1, 0].set_title(f"Segmentacion K-means (K={K})"); axes[1, 0].axis("off")
axes[1, 1].imshow(mascara_corrosion, cmap="Oranges"); axes[1, 1].set_title(f"Corrosion ({pct_corrosion:.1f}%)"); axes[1, 1].axis("off")
axes[1, 2].imshow(mascara_humedad,   cmap="Blues");   axes[1, 2].set_title(f"Humedad ({pct_humedad:.1f}%)");     axes[1, 2].axis("off")

plt.tight_layout()

if GUARDAR:
    plt.savefig("resultado.png", dpi=150, bbox_inches="tight")
    print(f"\nResultado guardado en: resultado.png")

plt.show()
