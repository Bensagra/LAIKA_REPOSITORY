const express = require('express');
const multer = require('multer');
const Groq = require('groq-sdk');
const path = require('path');
const fs = require('fs');
const chokidar = require('chokidar');

const PROMPT_FILE = path.join(__dirname, 'prompt.txt');
const IMAGES_DIR = path.join(__dirname, 'imagenes');
const ALLOWED_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
const MIME_MAP = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function analyzeImageFile(filePath) {
  const prompt = fs.readFileSync(PROMPT_FILE, 'utf-8').trim();
  const ext = path.extname(filePath).toLowerCase();
  const imageBase64 = fs.readFileSync(filePath).toString('base64');
  const dataUrl = `data:${MIME_MAP[ext]};base64,${imageBase64}`;

  const response = await groq.chat.completions.create({
    model: 'meta-llama/llama-4-scout-17b-16e-instruct',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: dataUrl } },
          { type: 'text', text: prompt },
        ],
      },
    ],
    max_tokens: 1024,
  });

  const text = response.choices[0].message.content;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('El modelo no devolvió JSON válido');
  return JSON.parse(jsonMatch[0]);
}

// Vigilante de carpeta: analiza automáticamente cada imagen nueva
chokidar.watch(IMAGES_DIR, { ignoreInitial: false, persistent: true })
  .on('add', async (filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) return;

    const resultPath = filePath.replace(/\.[^.]+$/, '_resultado.json');
    if (fs.existsSync(resultPath)) return; // ya fue analizada

    const nombre = path.basename(filePath);
    console.log(`[watcher] Nueva imagen detectada: ${nombre}`);

    try {
      const analysis = await analyzeImageFile(filePath);
      const output = { imagen: nombre, fecha: new Date().toISOString(), ...analysis };
      fs.writeFileSync(resultPath, JSON.stringify(output, null, 2), 'utf-8');
      console.log(`[watcher] Resultado guardado: ${path.basename(resultPath)}`);
    } catch (err) {
      console.error(`[watcher] Error al analizar ${nombre}:`, err.message);
    }
  });

// Endpoint para ver todos los resultados guardados
app.get('/results', (req, res) => {
  const files = fs.readdirSync(IMAGES_DIR).filter(f => f.endsWith('_resultado.json'));
  const results = files.map(f => JSON.parse(fs.readFileSync(path.join(IMAGES_DIR, f), 'utf-8')));
  res.json(results);
});

// Endpoint manual (subir imagen directo)
app.post('/analyze', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Se requiere una imagen con el campo "image".' });

    const prompt = fs.readFileSync(PROMPT_FILE, 'utf-8').trim();
    const dataUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;

    const response = await groq.chat.completions.create({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: dataUrl } },
            { type: 'text', text: prompt },
          ],
        },
      ],
      max_tokens: 1024,
    });

    const text = response.choices[0].message.content;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(500).json({ error: 'El modelo no devolvió JSON válido', respuesta_cruda: text });

    res.json(JSON.parse(jsonMatch[0]));
  } catch (err) {
    console.error('Error:', err.message);
    res.status(500).json({ error: 'Error al procesar la imagen', detalle: err.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'test.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
  console.log(`Vigilando carpeta: ${IMAGES_DIR}`);
});
