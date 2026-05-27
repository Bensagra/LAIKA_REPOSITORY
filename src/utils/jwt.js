import jwt from "jsonwebtoken";

const SECRET =
    "laika_super_secret";

export const generateToken =
    (user) => {

        const token = jwt.sign(
            {
                id: user.id_usuario,
                gmail: user.gmail
            },

            SECRET,

            {
                expiresIn: "7d"
            }
        );

        return token;

    };