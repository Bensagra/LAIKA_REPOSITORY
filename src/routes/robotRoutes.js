import express from "express";

const router = express.Router();

import {
    getStatus,
    moveRobot,
    stopRobot
} from "../controllers/robotController.js";

router.get(
    "/status",
    getStatus
);

router.post(
    "/move",
    moveRobot
);

router.post(
    "/stop",
    stopRobot
);

export default router;