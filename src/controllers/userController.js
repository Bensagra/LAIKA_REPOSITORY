import { createUser, loginUser } from "../services/userService.js";
import {
    generateToken
} from "../utils/jwt.js";

export const register = async (req, res) => {

    try {

        const { gmail, username, contrasena } = req.body;

        const user = await createUser(
            gmail,
            username,
            contrasena
        );
        const {
            contrasena_hash,
            ...safeUser
        } = user;

res.json(safeUser);

    } catch (error) {

        console.log(error);

        res.status(500).json({
            error: "Error al registrar usuario"
        });

    }

};
export const login = async (req, res) => {

    try {

        const {
            gmail,
            contrasena
        } = req.body;

        const user = await loginUser(
            gmail,
            contrasena
        );

        if (!user) {

            return res.status(401).json({
                error: "Credenciales incorrectas"
            });

        }

        const token =
        generateToken(user);

        const {
            contrasena_hash,
            ...safeUser
        } = user;

        res.json({
    message: "Login exitoso",
    token,
    user: safeUser
});
        
    } catch (error) {

        console.log(error);

        res.status(500).json({
            error: "Error en login"
        });

    }

};