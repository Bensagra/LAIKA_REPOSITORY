# LAIKA — Unitree Go2 controller local

App local: el `Go2Controller` se conecta al Go2 por WebRTC (LocalSTA) y un
único servidor web (`aiohttp`) expone:

- **UI** en `http://localhost:8080/` (botones, joystick, video, telemetría)
- **REST** en `/api/cmd/*`
- **WebSocket** `/ws/state` con el estado en vivo
- **MJPEG** en `/cam.mjpg` y `/cam.jpg`

Sin MQTT, sin servidor externo. Para probar todo punta a punta en tu Mac.

## Setup

```sh
brew install python@3.12 portaudio ffmpeg
cd /Users/bensagra/LAIKA-REPOSITORY/LAIKA_REPOSITORY
python3.12 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -e .
```

> `ffmpeg` lo usa `aiortc.contrib.media.MediaPlayer` para decodificar audio
> (MP3/WAV/OGG/M4A/…). Sin él el botón de audio no anda.

## Configurar

```sh
cp .env.example .env
# editá UNITREE_ROBOT_IP con la IP real del Go2 en tu WiFi
```

## Correr

```sh
source .venv/bin/activate
python -m laika.main
```

Abrí `http://localhost:8080/`. Deberías ver el video, los botones y la telemetría
actualizándose por WebSocket.

## API REST

| Método | Endpoint | Body |
|---|---|---|
| POST | `/api/cmd/move`   | `{"x":0.4,"y":0,"z":0}` |
| POST | `/api/cmd/stop`   | (vacío) |
| POST | `/api/cmd/action` | `{"name":"Hello"}` |
| POST | `/api/cmd/mode`   | `{"name":"normal"\|"ai"\|"mcf"}` |
| POST | `/api/cmd/camera` | `{"enabled":true}` |
| POST | `/api/cmd/lidar`  | `{"enabled":true}` |
| GET  | `/api/state`      | snapshot JSON |
| GET  | `/ws/state`       | WebSocket push |
| GET  | `/api/audio`      | lista audios subidos |
| POST | `/api/audio/upload` | multipart `file=<archivo>` (opt. `play=1`) |
| POST | `/api/audio/play` | `{"id":"<id>"}` |
| POST | `/api/audio/stop` | corta lo que esté sonando |
| DELETE | `/api/audio/{id}` | borra archivo |
| GET  | `/audio/{id}`     | descarga / preview en el browser |

### Audio

Los archivos se guardan en `./uploads/` (relativo al cwd donde corras laika).
Cualquier MP3/WAV/OGG/M4A/AAC/FLAC/OPUS hasta 50 MB. Bajo el capó: aiortc
`MediaPlayer` decodifica con ffmpeg y se agrega/reutiliza un audio track en el
peer connection del Go2 — no requiere upload previo al perro.

Probar desde curl:

```sh
# subir + reproducir en una sola
curl -F file=@beep.mp3 -F play=1 http://localhost:8080/api/audio/upload

# listar
curl http://localhost:8080/api/audio

# reproducir por id
curl -XPOST -H 'content-type: application/json' \
  -d '{"id":"abc123"}' http://localhost:8080/api/audio/play

# parar
curl -XPOST http://localhost:8080/api/audio/stop
```

Lista completa de acciones: `SPORT_CMD` en
[constants.py](https://github.com/legion1581/unitree_webrtc_connect/blob/master/unitree_webrtc_connect/constants.py)
(`Hello`, `StandUp`, `StandDown`, `Sit`, `RiseSit`, `Stretch`, `Damp`,
`BalanceStand`, `RecoveryStand`, `WiggleHips`, `Dance1`, `Dance2`, `FrontFlip`, …).

## Usar el controller desde Python (sin web)

```python
import asyncio
from laika import Go2Controller

async def main():
    go2 = Go2Controller("192.168.123.161")
    await go2.connect()
    await go2.ensure_normal_mode()
    await go2.hello()
    await go2.move(x=0.3)
    await asyncio.sleep(2)
    await go2.stop()

asyncio.run(main())
```

## Troubleshooting

- `portaudio.h not found` al instalar → `brew install portaudio`.
- El Go2 no responde → `ping <ROBOT_IP>` y verificá que no haya otro cliente
  (app móvil de Unitree) conectado al mismo tiempo: el Go2 sólo acepta un
  WebRTC por vez.
- Video no aparece → revisá los logs (`Video track attached`). Probá apretar
  "Cam OFF" y luego "Cam ON".
