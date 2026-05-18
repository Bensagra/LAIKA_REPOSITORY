import pg from "pg";

const { Pool } = pg;

import pkg from "@prisma/client";

const { PrismaClient } = pkg;
import express from "express";
const app = express();
const prisma = new PrismaClient();
const pool = new Pool({
    user: "prisma_backend",
    host: "10.40.5.7",
    database: "rescue_dog_db",
    password: "benyi2907",
    port: 5432
});


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

import userRoutes from "./src/routes/userRoutes.js";
app.use("/users", userRoutes);


app.listen(3000, () => {
    console.log("Servidor corriendo");
});


