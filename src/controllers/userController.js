import { createUser } from "../services/userService.js";
import { loginUser } from "../services/userService.js";

export const register = async (req, res) => {

    try {

        const { gmail, username, contrasena } = req.body;

        const user = await createUser(
            gmail,
            username,
            contrasena
        );

        res.json(user);

    } catch (error) {

        console.log(error);

        res.status(500).json({
            error: "Error al registrar usuario"
        });

    }

};

export const login = async (req, res) => {

    try {

        const { gmail, contrasena } = req.body;

        const user = await loginUser(
            gmail,
            contrasena
        );

        res.json(user);

    } catch (error) {

        console.log(error);

        res.status(401).json({
            error: error.message
        });

    }

};