import jwt from "jsonwebtoken";

const SECRET =
    "laika_super_secret";

export const authMiddleware =
    (req, res, next) => {

        try {

            const authHeader =
                req.headers.authorization;

            if (!authHeader) {

                return res.status(401).json({
                    error: "Token faltante"
                });

            }

            const token =
                authHeader.split(" ")[1];

            const decoded =
                jwt.verify(
                    token,
                    SECRET
                );

            req.user = decoded;

            next();

        } catch (error) {

            return res.status(401).json({
                error: "Token inválido"
            });

        }

    };

    router.get(
        "/profile",
    
        authMiddleware,
    
        (req, res) => {
    
            res.json({
                message:
                    "Ruta protegida",
    
                user: req.user
            });
    
        }
    );