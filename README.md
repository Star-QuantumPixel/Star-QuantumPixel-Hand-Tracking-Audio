# Star-QuantumPixel-Hand-Tracking-Audio

An interactive browser app that translates real-time hand gestures into dynamic audio.

## Run locally

Because webcam access is required, serve the repository over HTTP:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000/index.html` in a modern desktop browser and click **Start**.

## Controls

- Move your hand left/right to change pitch.
- Move your hand up/down to change volume.
- Pinch thumb and index finger to brighten the tone.