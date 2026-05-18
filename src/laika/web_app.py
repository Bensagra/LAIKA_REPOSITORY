import asyncio
import io
import json
import logging
import re
import time
import uuid
from pathlib import Path
from typing import Any

from aiohttp import WSMsgType, web
from PIL import Image

from .config import Config
from .controller import Go2Controller

log = logging.getLogger(__name__)

_BOUNDARY = "laikaframe"
_STATIC_DIR = Path(__file__).parent / "static"
_UPLOADS_DIR = Path("uploads").resolve()
_AUDIO_EXTS = {".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac", ".opus"}
_MAX_UPLOAD_BYTES = 50 * 1024 * 1024
_SAFE_NAME = re.compile(r"[^A-Za-z0-9._-]+")


class WebApp:
    """One aiohttp server: UI + REST commands + WebSocket state + MJPEG.

    Routes:
      GET  /                        index.html
      GET  /cam.mjpg                MJPEG stream
      GET  /cam.jpg                 JPEG snapshot
      GET  /api/state               last state snapshot (json)
      WS   /ws/state                live state push
      POST /api/cmd/move            {"x":0,"y":0,"z":0}
      POST /api/cmd/stop
      POST /api/cmd/action          {"name":"Hello"}
      POST /api/cmd/mode            {"name":"normal"|"ai"|"mcf"}
      POST /api/cmd/camera          {"enabled":true|false}
      POST /api/cmd/lidar           {"enabled":true|false}
      GET  /api/audio               list uploaded audios
      POST /api/audio/upload        multipart: file=<audio>  (optional play=1)
      POST /api/audio/play          {"id":"<audio-id>"}
      POST /api/audio/stop
      DELETE /api/audio/{id}        delete uploaded audio
      GET  /audio/{id}              fetch raw audio (for browser preview)
    """

    def __init__(self, cfg: Config, controller: Go2Controller):
        self.cfg = cfg
        self.controller = controller
        self._loop: asyncio.AbstractEventLoop | None = None

        # Latest frames / state
        self._latest_jpeg: bytes | None = None
        self._frame_event = asyncio.Event()
        self._last_encoded = 0.0
        self._min_frame_interval = (
            1.0 / cfg.mjpeg_target_fps if cfg.mjpeg_target_fps > 0 else 0.0
        )

        self._state: dict[str, Any] = {
            "sportmode": None,
            "lowstate": None,
            "lidar_state": None,
        }
        self._state_seq = 0
        self._state_event = asyncio.Event()

        self._runner: web.AppRunner | None = None

    # -- lifecycle ----------------------------------------------------------

    async def start(self) -> None:
        self._loop = asyncio.get_running_loop()

        # Wire telemetry callbacks from the Go2.
        self.controller.subscribe_sportmode(self._on_sportmode)
        self.controller.subscribe_lowstate(self._on_lowstate)
        self.controller.subscribe_lidar_state(self._on_lidar_state)
        self.controller.add_video_track_callback(self._on_track)

        # Start with camera on so the user sees something. Lidar stays off
        # (heavier) — toggle via the UI.
        self.controller.set_video(True)

        _UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

        app = web.Application(client_max_size=_MAX_UPLOAD_BYTES)
        app.router.add_get("/", self._index)
        app.router.add_get("/healthz", lambda _r: web.Response(text="ok"))
        app.router.add_get("/cam.mjpg", self._mjpeg)
        app.router.add_get("/cam.jpg", self._snapshot)
        app.router.add_get("/api/state", self._get_state)
        app.router.add_get("/ws/state", self._ws_state)
        app.router.add_post("/api/cmd/move", self._cmd_move)
        app.router.add_post("/api/cmd/stop", self._cmd_stop)
        app.router.add_post("/api/cmd/action", self._cmd_action)
        app.router.add_post("/api/cmd/mode", self._cmd_mode)
        app.router.add_post("/api/cmd/camera", self._cmd_camera)
        app.router.add_post("/api/cmd/lidar", self._cmd_lidar)
        app.router.add_get("/api/audio", self._audio_list)
        app.router.add_post("/api/audio/upload", self._audio_upload)
        app.router.add_post("/api/audio/play", self._audio_play)
        app.router.add_post("/api/audio/stop", self._audio_stop)
        app.router.add_delete("/api/audio/{aid}", self._audio_delete)
        app.router.add_get("/audio/{aid}", self._audio_get)

        self._runner = web.AppRunner(app)
        await self._runner.setup()
        site = web.TCPSite(self._runner, self.cfg.http_host, self.cfg.http_port)
        await site.start()
        log.info(
            "Web UI on http://%s:%d/",
            "localhost" if self.cfg.http_host in ("0.0.0.0", "") else self.cfg.http_host,
            self.cfg.http_port,
        )

    async def stop(self) -> None:
        if self._runner is not None:
            await self._runner.cleanup()

    # -- video ingestion ----------------------------------------------------

    async def _on_track(self, track: Any) -> None:
        log.info("Video track attached (%s)", getattr(track, "kind", "?"))
        try:
            while True:
                frame = await track.recv()
                self._encode_frame(frame)
        except Exception as e:
            log.warning("Video track ended: %s", e)

    def _encode_frame(self, frame: Any) -> None:
        now = time.monotonic()
        if now - self._last_encoded < self._min_frame_interval:
            return
        self._last_encoded = now
        img = frame.to_ndarray(format="bgr24")
        h, w = img.shape[:2]
        pil = Image.fromarray(img[:, :, ::-1])
        if self.cfg.mjpeg_max_width and w > self.cfg.mjpeg_max_width:
            new_w = self.cfg.mjpeg_max_width
            new_h = int(h * (new_w / w))
            pil = pil.resize((new_w, new_h), Image.BILINEAR)
        buf = io.BytesIO()
        pil.save(buf, format="JPEG", quality=self.cfg.mjpeg_quality, optimize=False)
        self._latest_jpeg = buf.getvalue()
        if self._loop is not None:
            self._loop.call_soon_threadsafe(self._wake_frame)

    def _wake_frame(self) -> None:
        self._frame_event.set()
        self._frame_event.clear()

    # -- state ingestion ----------------------------------------------------

    def _on_sportmode(self, data: dict[str, Any]) -> None:
        self._state["sportmode"] = data
        self._bump_state()

    def _on_lowstate(self, data: dict[str, Any]) -> None:
        # Trim noisy fields — keep what's useful for a UI.
        self._state["lowstate"] = {
            "imu_rpy": (data.get("imu_state") or {}).get("rpy"),
            "bms": {
                "soc": (data.get("bms_state") or {}).get("soc"),
                "current": (data.get("bms_state") or {}).get("current"),
                "cycle": (data.get("bms_state") or {}).get("cycle"),
            },
            "foot_force": data.get("foot_force"),
            "temperature_ntc1": data.get("temperature_ntc1"),
            "power_v": data.get("power_v"),
        }
        self._bump_state()

    def _on_lidar_state(self, data: dict[str, Any]) -> None:
        self._state["lidar_state"] = data
        self._bump_state()

    def _bump_state(self) -> None:
        self._state_seq += 1
        if self._loop is not None:
            self._loop.call_soon_threadsafe(self._wake_state)

    def _wake_state(self) -> None:
        self._state_event.set()
        self._state_event.clear()

    # -- handlers: pages / media -------------------------------------------

    async def _index(self, _request: web.Request) -> web.Response:
        path = _STATIC_DIR / "index.html"
        if not path.exists():
            return web.Response(status=500, text="static/index.html is missing")
        return web.Response(text=path.read_text(), content_type="text/html")

    async def _snapshot(self, _request: web.Request) -> web.Response:
        if self._latest_jpeg is None:
            return web.Response(status=503, text="no frame yet")
        return web.Response(
            body=self._latest_jpeg,
            content_type="image/jpeg",
            headers={"Cache-Control": "no-store"},
        )

    async def _mjpeg(self, request: web.Request) -> web.StreamResponse:
        response = web.StreamResponse(
            status=200,
            reason="OK",
            headers={
                "Content-Type": f"multipart/x-mixed-replace; boundary=--{_BOUNDARY}",
                "Cache-Control": "no-store",
                "Connection": "close",
            },
        )
        await response.prepare(request)
        log.info("MJPEG client connected from %s", request.remote)
        try:
            while not request.transport.is_closing():
                try:
                    await asyncio.wait_for(self._frame_event.wait(), timeout=1.0)
                except asyncio.TimeoutError:
                    continue
                jpeg = self._latest_jpeg
                if jpeg is None:
                    continue
                chunk = (
                    f"--{_BOUNDARY}\r\n"
                    "Content-Type: image/jpeg\r\n"
                    f"Content-Length: {len(jpeg)}\r\n\r\n"
                ).encode("ascii") + jpeg + b"\r\n"
                await response.write(chunk)
        except (ConnectionResetError, asyncio.CancelledError):
            pass
        finally:
            log.info("MJPEG client disconnected (%s)", request.remote)
        return response

    # -- handlers: state ----------------------------------------------------

    async def _get_state(self, _request: web.Request) -> web.Response:
        return web.json_response(self._state)

    async def _ws_state(self, request: web.Request) -> web.WebSocketResponse:
        ws = web.WebSocketResponse(heartbeat=15)
        await ws.prepare(request)
        log.info("WS state client connected from %s", request.remote)
        last_seq = -1
        try:
            # Send initial snapshot.
            await ws.send_json(self._state)
            last_seq = self._state_seq
            while not ws.closed:
                try:
                    await asyncio.wait_for(self._state_event.wait(), timeout=1.0)
                except asyncio.TimeoutError:
                    pass
                if self._state_seq != last_seq:
                    last_seq = self._state_seq
                    await ws.send_json(self._state)
                # Drain any pings/closes
                if not request.transport or request.transport.is_closing():
                    break
        except ConnectionResetError:
            pass
        finally:
            log.info("WS state client disconnected (%s)", request.remote)
            await ws.close()
        return ws

    # -- handlers: commands -------------------------------------------------

    async def _cmd_move(self, request: web.Request) -> web.Response:
        body = await self._json_body(request)
        await self.controller.move(
            x=float(body.get("x", 0.0)),
            y=float(body.get("y", 0.0)),
            z=float(body.get("z", 0.0)),
        )
        return web.json_response({"ok": True})

    async def _cmd_stop(self, _request: web.Request) -> web.Response:
        await self.controller.stop()
        return web.json_response({"ok": True})

    async def _cmd_action(self, request: web.Request) -> web.Response:
        body = await self._json_body(request)
        name = body.get("name")
        if not isinstance(name, str):
            return web.json_response({"ok": False, "error": "missing 'name'"}, status=400)
        try:
            await self.controller.action(name)
        except ValueError as e:
            return web.json_response({"ok": False, "error": str(e)}, status=400)
        return web.json_response({"ok": True})

    async def _cmd_mode(self, request: web.Request) -> web.Response:
        body = await self._json_body(request)
        name = body.get("name")
        if not isinstance(name, str):
            return web.json_response({"ok": False, "error": "missing 'name'"}, status=400)
        await self.controller.set_motion_mode(name)
        return web.json_response({"ok": True})

    async def _cmd_camera(self, request: web.Request) -> web.Response:
        body = await self._json_body(request)
        self.controller.set_video(bool(body.get("enabled", False)))
        return web.json_response({"ok": True})

    async def _cmd_lidar(self, request: web.Request) -> web.Response:
        body = await self._json_body(request)
        await self.controller.set_lidar(bool(body.get("enabled", False)))
        return web.json_response({"ok": True})

    @staticmethod
    async def _json_body(request: web.Request) -> dict[str, Any]:
        if not request.body_exists:
            return {}
        try:
            body = await request.json()
        except json.JSONDecodeError:
            return {}
        if not isinstance(body, dict):
            return {}
        return body

    # -- handlers: audio ----------------------------------------------------

    async def _audio_list(self, _request: web.Request) -> web.Response:
        return web.json_response({"items": self._scan_audio_dir()})

    async def _audio_upload(self, request: web.Request) -> web.Response:
        reader = await request.multipart()
        play_after = False
        audio_path: Path | None = None
        original_name: str | None = None

        while True:
            field = await reader.next()
            if field is None:
                break
            if field.name == "play":
                txt = (await field.text()).strip().lower()
                play_after = txt in {"1", "true", "yes", "on"}
            elif field.name == "file":
                original_name = field.filename or "audio"
                ext = Path(original_name).suffix.lower()
                if ext not in _AUDIO_EXTS:
                    return web.json_response(
                        {"ok": False, "error": f"Unsupported audio extension {ext!r}"},
                        status=400,
                    )
                aid = uuid.uuid4().hex[:12]
                safe = _SAFE_NAME.sub("_", Path(original_name).stem) or "audio"
                audio_path = _UPLOADS_DIR / f"{aid}__{safe}{ext}"
                size = 0
                with audio_path.open("wb") as out:
                    while True:
                        chunk = await field.read_chunk()
                        if not chunk:
                            break
                        size += len(chunk)
                        if size > _MAX_UPLOAD_BYTES:
                            out.close()
                            audio_path.unlink(missing_ok=True)
                            return web.json_response(
                                {"ok": False, "error": "file too large"}, status=413
                            )
                        out.write(chunk)
                log.info("Audio uploaded: %s (%d bytes)", audio_path.name, size)

        if audio_path is None:
            return web.json_response(
                {"ok": False, "error": "no 'file' field in multipart body"}, status=400
            )

        item = self._describe_audio(audio_path)
        if play_after:
            try:
                await self.controller.play_audio_file(str(audio_path))
            except Exception as e:
                log.exception("Failed to play audio after upload")
                return web.json_response(
                    {"ok": False, "error": str(e), "item": item}, status=500
                )
        return web.json_response({"ok": True, "item": item, "played": play_after})

    async def _audio_play(self, request: web.Request) -> web.Response:
        body = await self._json_body(request)
        aid = body.get("id")
        if not isinstance(aid, str):
            return web.json_response({"ok": False, "error": "missing 'id'"}, status=400)
        path = self._find_audio(aid)
        if path is None:
            return web.json_response({"ok": False, "error": "not found"}, status=404)
        try:
            await self.controller.play_audio_file(str(path))
        except Exception as e:
            log.exception("play_audio_file failed")
            return web.json_response({"ok": False, "error": str(e)}, status=500)
        return web.json_response({"ok": True, "item": self._describe_audio(path)})

    async def _audio_stop(self, _request: web.Request) -> web.Response:
        await self.controller.stop_audio()
        return web.json_response({"ok": True})

    async def _audio_delete(self, request: web.Request) -> web.Response:
        aid = request.match_info["aid"]
        path = self._find_audio(aid)
        if path is None:
            return web.json_response({"ok": False, "error": "not found"}, status=404)
        path.unlink(missing_ok=True)
        return web.json_response({"ok": True})

    async def _audio_get(self, request: web.Request) -> web.StreamResponse:
        aid = request.match_info["aid"]
        path = self._find_audio(aid)
        if path is None:
            return web.Response(status=404, text="not found")
        return web.FileResponse(path, headers={"Cache-Control": "no-store"})

    # -- audio helpers ------------------------------------------------------

    def _scan_audio_dir(self) -> list[dict[str, Any]]:
        if not _UPLOADS_DIR.exists():
            return []
        items: list[dict[str, Any]] = []
        for p in sorted(_UPLOADS_DIR.iterdir()):
            if p.is_file() and "__" in p.stem and p.suffix.lower() in _AUDIO_EXTS:
                items.append(self._describe_audio(p))
        return items

    @staticmethod
    def _describe_audio(path: Path) -> dict[str, Any]:
        aid, _, rest = path.stem.partition("__")
        return {
            "id": aid,
            "name": (rest or path.stem) + path.suffix,
            "size": path.stat().st_size,
            "url": f"/audio/{aid}",
        }

    @staticmethod
    def _find_audio(aid: str) -> Path | None:
        if not _UPLOADS_DIR.exists() or "/" in aid or "\\" in aid or aid == "":
            return None
        for p in _UPLOADS_DIR.iterdir():
            if p.is_file() and p.stem.startswith(f"{aid}__"):
                return p
        return None
