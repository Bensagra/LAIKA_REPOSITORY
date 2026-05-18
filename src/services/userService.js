import prisma from "../db/prisma.js";

export const createUser = async (
    gmail,
    username,
    contrasena
) => {

    const user = await prisma.usuario.create({
        data: {
            gmail,
            username,
            contrasena_hash: contrasena
        }
    });

    return user;

};

export const loginUser = async (
    gmail,
    contrasena
) => {

    const user = await prisma.usuario.findUnique({
        where: {
            gmail
        }
    });

    if (!user) {
        throw new Error("Usuario no encontrado");
    }

    if (user.contrasena_hash !== contrasena) {
        throw new Error("Contraseña incorrecta");
    }

    return user;

};