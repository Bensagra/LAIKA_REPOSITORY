export const register = async (req, res) => {

    const { gmail, username, contrasena } = req.body;

    res.json({
        mensaje: "Usuario registrado",
        gmail,
        username
    });

};