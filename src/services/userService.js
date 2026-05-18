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
        return null;
    }

    if (user.contrasena_hash !== contrasena) {
        return null;
    }

    return user;
};