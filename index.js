import pkg from "@prisma/client";
const { PrismaClient } = pkg;
import express from "express";

const app = express();
const prisma = new PrismaClient();

app.use(express.json({ limit: '50mb' }));

// CORS — permite llamadas desde el frontend Expo
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get("/", (req, res) => {
  res.send("LAIKA backend funcionando");
});

// Estado del robot (fake por ahora — reemplazar con datos reales del GO2)
app.get("/robot", (req, res) => {
  res.json({ battery: 82, speed: 1.4, status: "walking" });
});

// Comando de movimiento al robot
app.post("/move", (req, res) => {
  const { direction } = req.body;
  console.log("Movimiento recibido:", direction);
  res.json({ ok: true, direction });
});

// Registro de usuario
app.post("/register", async (req, res) => {
  try {
    const { gmail, username, contrasena } = req.body;
    const user = await prisma.usuario.create({
      data: { gmail, username, contrasena_hash: contrasena }
    });
    res.json(user);
  } catch (e) {
    console.error("[register]", e.message);
    res.status(400).json({ error: e.message });
  }
});

// Login de usuario
app.post("/login", async (req, res) => {
  try {
    const { gmail, contrasena } = req.body;
    const user = await prisma.usuario.findFirst({
      where: { gmail, contrasena_hash: contrasena }
    });
    if (!user) return res.status(401).json({ error: "Credenciales incorrectas" });
    res.json(user);
  } catch (e) {
    console.error("[login]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Misiones ──────────────────────────────────────────────────────────────────

app.post("/misiones", async (req, res) => {
  try {
    const { nombre, id_usuario } = req.body;
    const mision = await prisma.mision.create({
      data: {
        nombre: nombre || `Misión ${new Date().toLocaleDateString('es-AR')}`,
        estado_mision: "en_progreso",
        id_usuario: id_usuario || null,
      },
    });
    res.json(mision);
  } catch (e) {
    console.error("[misiones/crear]", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get("/misiones", async (req, res) => {
  try {
    const misiones = await prisma.mision.findMany({ orderBy: { created_at: "desc" } });
    res.json(misiones);
  } catch (e) {
    console.error("[misiones/listar]", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.delete("/misiones/:id", async (req, res) => {
  try {
    await prisma.mision.delete({ where: { id_mision: parseInt(req.params.id) } });
    res.json({ ok: true });
  } catch (e) {
    console.error("[misiones/eliminar]", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.patch("/misiones/:id/nombre", async (req, res) => {
  try {
    const mision = await prisma.mision.update({
      where: { id_mision: parseInt(req.params.id) },
      data: { nombre: req.body.nombre, updated_at: new Date() },
    });
    res.json(mision);
  } catch (e) {
    console.error("[misiones/renombrar]", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.put("/misiones/:id", async (req, res) => {
  try {
    const mision = await prisma.mision.update({
      where: { id_mision: parseInt(req.params.id) },
      data: {
        estado_mision: "finalizada",
        descripcion: JSON.stringify(req.body.edificios || []),
        updated_at: new Date(),
      },
    });
    res.json(mision);
  } catch (e) {
    console.error("[misiones/finalizar]", e.message);
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor LAIKA corriendo en http://localhost:${PORT}`);
});
