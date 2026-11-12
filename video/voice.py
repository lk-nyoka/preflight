"""Generate narration per scene with Piper (neural TTS) and report durations."""
import json, subprocess, wave, sys, pathlib
here = pathlib.Path(__file__).parent
model = sys.argv[1] if len(sys.argv) > 1 else '/tmp/voices/en_US-lessac-high.onnx'
out = here / 'build' / 'vo'; out.mkdir(parents=True, exist_ok=True)
scenes = json.loads((here / 'scenes.json').read_text())
for s in scenes:
    wav = out / f"{s['id']}.wav"
    subprocess.run(['python3', '-m', 'piper', '-m', model, '-f', str(wav), '--length-scale', '1.0', '--sentence-silence', '0.3'],
                   input=s['vo'].encode(), check=True, capture_output=True)
    with wave.open(str(wav)) as w:
        s['voDur'] = round(w.getnframes() / w.getframerate(), 2)
    print(f"{s['id']:8} {s['voDur']:5.2f}s")
(here / 'build' / 'scenes.voiced.json').write_text(json.dumps(scenes, indent=1))
