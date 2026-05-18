import asyncio
import logging
import signal

from .config import Config
from .controller import Go2Controller
from .web_app import WebApp

log = logging.getLogger("laika")


async def _amain() -> None:
    cfg = Config.from_env()
    logging.basicConfig(
        level=cfg.log_level,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    log.info("Starting laika (robot=%s, web=http://%s:%d)",
             cfg.robot_ip, cfg.http_host, cfg.http_port)

    controller = Go2Controller(cfg.robot_ip)
    await controller.connect()

    app = WebApp(cfg, controller)
    await app.start()

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop.set)
        except NotImplementedError:
            pass

    await stop.wait()
    log.info("Shutdown.")
    await app.stop()


def run() -> None:
    try:
        asyncio.run(_amain())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    run()
