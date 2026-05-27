import cors from "cors"; // para rpbar csas con live sever
import pg from "pg";
import pkg from "@prisma/client";
import express from "express";
import userRoutes from "./src/routes/userRoutes.js";
import "dotenv/config";

import robotRoutes
from "./src/routes/robotRoutes.js";

const { Pool } = pg;
const { PrismaClient } = pkg;

const app = express();
app.use(cors());
const prisma = new PrismaClient();
 
const pool = new Pool({
    user: "prisma_backend",
    host: "10.40.5.4",
    database: "rescue_dog_db",
    password: "benyi2907",
    port: 5432
});

app.use(express.json());

app.use("/users", userRoutes);

app.get("/", (req, res) => {
    res.send("LAIKA backend funcionando");
});


app.use(
    "/robot",
    robotRoutes
);


/*
para conectarse al robot, por ahora fake
*/
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

});

app.listen(process.env.PORT, () => {

    console.log("Servidor corriendo");
});