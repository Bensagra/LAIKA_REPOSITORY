const express = require('express');
const multer = require('multer');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const PROMPT = `Eres un experto resolviendo laberintos. Analiza esta imagen de un laberinto y encuentra la ruta óptima (más corta) desde la entrada hasta la salida.

Devuelve SOLO un JSON con este formato exacto:
{
  "resuelto": true,
  "entrada": "descripción de dónde está la entrada (ej: esquina inferior izquierda)",
  "salida": "descripción de dónde está la salida (ej: esquina superior derecha)",
  "longitud_pasos": 12,
  "pasos": [
    { "direccion": "derecha", "cantidad": 3, "descripcion": "Avanzá 3 celdas hacia la derecha" },
    { "direccion": "arriba", "cantidad": 2, "descripcion": "Subí 2 celdas" }
  ],
  "descripcion_general": "Resumen breve del camino óptimo encontrado"
}

Si no podés identificar la entrada/salida o el laberinto no tiene solución, devolvé:
{ "resuelto": false, "motivo": "explicación del problema" }

Las direcciones válidas son: derecha, izquierda, arriba, abajo.`;

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.post('/resolver', upload.single('imagen'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Se requiere una imagen.' });

    const base64 = req.file.buffer.toString('base64');
    const mediaType = req.file.mimetype;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: PROMPT },
          ],
        },
      ],
    });

    const text = response.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(500).json({ error: 'El modelo no devolvió JSON válido', respuesta_cruda: text });

    res.json(JSON.parse(jsonMatch[0]));
  } catch (err) {
    console.error('Error:', err.message);
    res.status(500).json({ error: 'Error al procesar la imagen', detalle: err.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Servidor corriendo en http://localhost:${PORT}`));
