import prisma from "../db/prisma.js";
import bcrypt from "bcrypt";

export const createUser = async (
    gmail,
    username,
    contrasena
) => {


    const hashedPassword =
    await bcrypt.hash(
        contrasena,
        10
    );
    const user = await prisma.usuario.create({
        data: {
            gmail,
            username,
            contrasena_hash:
            hashedPassword
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
    const passwordCorrect =
    await bcrypt.compare(
        contrasena,
        user.contrasena_hash
    );

if (!passwordCorrect) {
    return null;
}

    return user;
};