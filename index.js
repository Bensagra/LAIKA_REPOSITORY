import pkg from "@prisma/client";

const { PrismaClient } = pkg;
import express from "express";
const app = express();
const prisma = new PrismaClient();

app.use(express.json());


app.get("/", (req, res) => {
    res.send("LAIKA backend funcionando");
});

/*
para conectarse al robot, por ahora fake
app.get("/robot", (req, res) => {
    res.json({
        battery: 82,
        speed: 1.4,
        status: "walking"
    });
});

app.post("/move", (req, res) => {

   const direction = req.body.direction;

console.log("El robot se mueve hacia:", direction);

res.send(`Moviendo robot hacia ${direction}`);

});*/

app.post("/register", async (req, res) => {

    const { gmail, username, contrasena } = req.body;

    const user = await prisma.usuario.create({
        data: {
            gmail,
            username,
            contrasena_hash: contrasena
        }
    });

    res.json(user);

});

app.listen(3000, () => {
    console.log("Servidor corriendo");
});


