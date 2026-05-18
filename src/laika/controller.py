import asyncio
import json
import logging
from typing import Any, Awaitable, Callable

from unitree_webrtc_connect.constants import RTC_TOPIC, SPORT_CMD
from unitree_webrtc_connect.webrtc_driver import (
    UnitreeWebRTCConnection,
    WebRTCConnectionMethod,
)

log = logging.getLogger(__name__)

MOTION_SWITCHER_GET = 1001
MOTION_SWITCHER_SET = 1002

StateCallback = Callable[[dict[str, Any]], Awaitable[None] | None]
TrackCallback = Callable[[Any], Awaitable[None]]


class Go2Controller:
    """High-level async wrapper around the Unitree Go2 WebRTC driver.

    Designed for LocalSTA (same WiFi, by IP) without AES key.
    """

    def __init__(self, robot_ip: str):
        self._robot_ip = robot_ip
        self._conn: UnitreeWebRTCConnection | None = None
        self._lock = asyncio.Lock()
        self._audio_sender: Any = None  # RTCRtpSender, lazily created
        self._audio_player: Any = None  # MediaPlayer, held to prevent GC

    async def connect(self) -> None:
        if self._conn is not None:
            return
        log.info("Connecting to Go2 at %s (LocalSTA)...", self._robot_ip)
        conn = UnitreeWebRTCConnection(
            WebRTCConnectionMethod.LocalSTA, ip=self._robot_ip
        )
        await conn.connect()
        self._conn = conn
        log.info("Go2 connected.")

    @property
    def conn(self) -> UnitreeWebRTCConnection:
        if self._conn is None:
            raise RuntimeError("Go2Controller.connect() not called yet")
        return self._conn

    # -- motion mode --------------------------------------------------------

    async def get_motion_mode(self) -> str | None:
        resp = await self.conn.datachannel.pub_sub.publish_request_new(
            RTC_TOPIC["MOTION_SWITCHER"], {"api_id": MOTION_SWITCHER_GET}
        )
        try:
            if resp["data"]["header"]["status"]["code"] == 0:
                return json.loads(resp["data"]["data"]).get("name")
        except (KeyError, TypeError, json.JSONDecodeError):
            log.exception("Unexpected motion_switcher response: %r", resp)
        return None

    async def set_motion_mode(self, name: str, settle_seconds: float = 5.0) -> None:
        log.info("Switching motion mode -> %s", name)
        await self.conn.datachannel.pub_sub.publish_request_new(
            RTC_TOPIC["MOTION_SWITCHER"],
            {"api_id": MOTION_SWITCHER_SET, "parameter": {"name": name}},
        )
        if settle_seconds > 0:
            await asyncio.sleep(settle_seconds)

    async def ensure_normal_mode(self) -> None:
        current = await self.get_motion_mode()
        if current and current != "normal":
            await self.set_motion_mode("normal")

    # -- raw command --------------------------------------------------------

    async def _sport_request(
        self, api_id: int, parameter: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {"api_id": api_id}
        if parameter is not None:
            payload["parameter"] = parameter
        async with self._lock:
            return await self.conn.datachannel.pub_sub.publish_request_new(
                RTC_TOPIC["SPORT_MOD"], payload
            )

    async def action(self, name: str) -> dict[str, Any]:
        """Run a named SPORT_CMD (e.g. 'Hello', 'StandUp', 'Sit')."""
        if name not in SPORT_CMD:
            raise ValueError(f"Unknown sport command: {name!r}")
        return await self._sport_request(SPORT_CMD[name])

    async def move(self, x: float = 0.0, y: float = 0.0, z: float = 0.0) -> dict[str, Any]:
        """Velocity command. x: forward m/s, y: lateral m/s, z: yaw rad/s."""
        return await self._sport_request(
            SPORT_CMD["Move"], {"x": float(x), "y": float(y), "z": float(z)}
        )

    async def stop(self) -> dict[str, Any]:
        return await self._sport_request(SPORT_CMD["StopMove"])

    async def stand_up(self) -> dict[str, Any]:
        return await self._sport_request(SPORT_CMD["StandUp"])

    async def stand_down(self) -> dict[str, Any]:
        return await self._sport_request(SPORT_CMD["StandDown"])

    async def damp(self) -> dict[str, Any]:
        return await self._sport_request(SPORT_CMD["Damp"])

    async def hello(self) -> dict[str, Any]:
        return await self._sport_request(SPORT_CMD["Hello"])

    # -- state subscriptions ------------------------------------------------

    def subscribe_sportmode(self, callback: StateCallback) -> None:
        """Receive sportmode state (~50Hz). Message has 'data' with imu, position, etc."""
        self.conn.datachannel.pub_sub.subscribe(
            RTC_TOPIC["LF_SPORT_MOD_STATE"], lambda msg: callback(msg.get("data", {}))
        )

    def subscribe_lowstate(self, callback: StateCallback) -> None:
        """Receive low-level state: motors, BMS, foot force."""
        self.conn.datachannel.pub_sub.subscribe(
            RTC_TOPIC["LOW_STATE"], lambda msg: callback(msg.get("data", {}))
        )

    # -- lidar --------------------------------------------------------------

    async def set_lidar(self, enabled: bool) -> None:
        """Switch the LiDAR sensor on/off."""
        log.info("LiDAR -> %s", "on" if enabled else "off")
        # The lidar stream is heavy; the SDK needs traffic-saving disabled.
        if enabled:
            await self.conn.datachannel.disableTrafficSaving(True)
        self.conn.datachannel.pub_sub.publish_without_callback(
            RTC_TOPIC["ULIDAR_SWITCH"], "on" if enabled else "off"
        )

    def subscribe_lidar_raw(self, callback: StateCallback) -> None:
        """Receive the compressed LiDAR voxel map frame untouched.

        The callback receives the payload dict; the compressed bytes live under
        the `data` key (format depends on firmware: bytes or base64 string).
        """
        self.conn.datachannel.pub_sub.subscribe(
            RTC_TOPIC["ULIDAR_ARRAY"], lambda msg: callback(msg)
        )

    def subscribe_lidar_state(self, callback: StateCallback) -> None:
        """Lidar housekeeping state (mode, errors, etc.)."""
        self.conn.datachannel.pub_sub.subscribe(
            RTC_TOPIC["ULIDAR_STATE"], lambda msg: callback(msg.get("data", {}))
        )

    # -- video --------------------------------------------------------------

    def set_video(self, enabled: bool) -> None:
        """Turn the front-camera WebRTC video track on/off."""
        log.info("Video -> %s", "on" if enabled else "off")
        self.conn.video.switchVideoChannel(enabled)

    def add_video_track_callback(self, callback: TrackCallback) -> None:
        """Register an async callback `(track) -> None` that consumes frames.

        The callback typically loops `await track.recv()` to pull `VideoFrame`s.
        """
        self.conn.video.add_track_callback(callback)

    # -- audio playback -----------------------------------------------------

    async def play_audio_file(self, path: str) -> None:
        """Stream a local audio file (MP3 / WAV / etc.) out the Go2's speaker.

        Uses aiortc's MediaPlayer (which shells out to ffmpeg). The first call
        adds a sendonly audio track on the existing peer connection; later
        calls reuse the same sender via replaceTrack — no renegotiation needed.
        """
        from aiortc.contrib.media import MediaPlayer  # lazy import

        player = MediaPlayer(path)
        if player.audio is None:
            raise ValueError(f"No audio track in file: {path}")

        if self._audio_sender is None:
            log.info("Attaching audio track to peer connection")
            self._audio_sender = self.conn.pc.addTrack(player.audio)
        else:
            log.info("Swapping audio track on existing sender")
            await self._audio_sender.replaceTrack(player.audio)

        # Hold a reference; MediaPlayer drops its decoder if GC'd.
        self._audio_player = player

    async def stop_audio(self) -> None:
        """Stop whatever is currently playing (track becomes silent)."""
        if self._audio_sender is not None:
            try:
                await self._audio_sender.replaceTrack(None)
            except Exception:
                log.exception("Failed to clear audio track")
        self._audio_player = None
