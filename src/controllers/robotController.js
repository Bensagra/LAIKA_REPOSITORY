let robotState = {

    battery: 100,
    speed: 0,
    status: "stopped",
    mode: "idle",
    direction: null

};

export const getStatus = (req, res) => {

    res.json(robotState);

};

export const moveRobot = (req, res) => {

    const { direction } = req.body;

    robotState.direction =
        direction;

    robotState.status =
        "moving";

    robotState.mode =
        "searching";

    robotState.speed = 1.5;

    robotState.battery -= 1;

    console.log(
        "Robot moviéndose hacia:",
        direction
    );

    res.json({
        message:
            `Moviendo robot hacia ${direction}`,
        robot: robotState
    });

};  

export const stopRobot = (req, res) => {

    robotState.speed = 0;

    robotState.status =
        "stopped";

    robotState.mode =
        "idle";

    console.log(
        "Robot detenido"
    );

    res.json({
        message:
            "Robot detenido",
        robot: robotState
    });

};