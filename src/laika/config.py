import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


@dataclass(frozen=True)
class Config:
    robot_ip: str
    http_host: str
    http_port: int
    mjpeg_max_width: int | None
    mjpeg_quality: int
    mjpeg_target_fps: float
    log_level: str

    @classmethod
    def from_env(cls, env_file: str | Path | None = ".env") -> "Config":
        if env_file:
            load_dotenv(env_file, override=False)
        max_w = os.getenv("MJPEG_MAX_WIDTH", "1280").strip()
        return cls(
            robot_ip=os.getenv("UNITREE_ROBOT_IP", "192.168.123.161"),
            http_host=os.getenv("HTTP_HOST", "0.0.0.0"),
            http_port=int(os.getenv("HTTP_PORT", "8080")),
            mjpeg_max_width=int(max_w) if max_w and max_w != "0" else None,
            mjpeg_quality=int(os.getenv("MJPEG_QUALITY", "70")),
            mjpeg_target_fps=float(os.getenv("MJPEG_TARGET_FPS", "15")),
            log_level=os.getenv("LOG_LEVEL", "INFO").upper(),
        )
