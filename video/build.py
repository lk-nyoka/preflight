"""
Build the Preflight demo film.

  python3 build.py            narration -> timeline -> frames -> music + SFX -> mix -> MP4 (+ captions)
  python3 build.py --no-frames   reuse frames already rendered (audio/edit changes only)

Real screen recordings: put a clip at recordings/<scene-id>.mp4 (for example
recordings/blocked.mp4) and that scene uses your footage, framed Apple-style on
the soft background, instead of the animated recreation. Audio for the scene
(narration, music, SFX) stays the same, so record to the scene's length.

AI story shots: put a clip at story/<scene-id>.mp4 (for example story/cold.mp4)
and it fills the whole frame for that scene, slightly darkened, looping if it is
shorter than the scene. Use these only for the dark story scenes; every app
scene must be a real recording, because the rules require showing the app.

Everything here is original: the music and sound effects are synthesized from
scratch, the voice is Piper (neural TTS, voice "lessac").
"""
import json, math, os, subprocess, sys, wave
from pathlib import Path
import numpy as np

HERE = Path(__file__).parent
BUILD = HERE / 'build'
FPS = 30
SR = 44100
VO_OFFSET = 0.7

def sh(*cmd):
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)

# ---------------------------------------------------------------- timeline
def make_timeline():
    scenes = json.loads((BUILD / 'scenes.voiced.json').read_text())
    t, tl = 0.0, []
    for s in scenes:
        dur = round(max(s['min'], s['voDur'] + VO_OFFSET + 1.6), 2)
        tl.append({'id': s['id'], 'start': round(t, 2), 'dur': dur, 'vo': s['vo'], 'voDur': s['voDur']})
        t += dur
    (BUILD / 'timeline.json').write_text(json.dumps(tl, indent=1))
    return tl

# ---------------------------------------------------------------- audio helpers
def tone(freq, dur, amp=1.0, harmonics=(1.0,), decay=3.0, attack=0.005):
    n = int(SR * dur); t = np.arange(n) / SR
    sig = sum(a * np.sin(2 * np.pi * freq * (i + 1) * t) for i, a in enumerate(harmonics))
    env = np.exp(-t * decay) * np.clip(t / attack, 0, 1)
    return amp * sig * env

def lowpass(x, cutoff):
    # one-pole low-pass
    a = math.exp(-2 * math.pi * cutoff / SR); y = np.empty_like(x); acc = 0.0
    for i in range(len(x)):
        acc = (1 - a) * x[i] + a * acc; y[i] = acc
    return y

def lowpass_fast(x, cutoff):
    # FFT brick-ish low-pass with a soft knee (fast for long signals)
    X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / SR)
    X *= 1 / (1 + (f / cutoff) ** 4)
    return np.fft.irfft(X, len(x))

def reverb(x, seconds=1.6, mix=0.22, seed=7):
    rng = np.random.default_rng(seed)
    n = int(SR * seconds); t = np.arange(n) / SR
    ir = rng.standard_normal(n) * np.exp(-t * 4.0); ir[0] = 0
    ir = lowpass_fast(ir, 5000); ir /= np.sqrt((ir ** 2).sum())
    wet = np.fft.irfft(np.fft.rfft(x, len(x) + n) * np.fft.rfft(ir, len(x) + n), len(x) + n)[: len(x)]
    return (1 - mix) * x + mix * wet

def place(track, sig, at):
    i = int(at * SR)
    if i >= len(track): return
    j = min(len(track), i + len(sig)); track[i:j] += sig[: j - i]

def note(name):
    names = {'C': -9, 'C#': -8, 'D': -7, 'D#': -6, 'E': -5, 'F': -4, 'F#': -3, 'G': -2, 'G#': -1, 'A': 0, 'A#': 1, 'B': 2}
    return 440.0 * 2 ** ((names[name[:-1]] + 12 * (int(name[-1]) - 4)) / 12)

# ---------------------------------------------------------------- music
def music(total, tl):
    n = int(SR * total) + SR
    piano, pad, bass, pulse = (np.zeros(n) for _ in range(4))
    bpm = 92; beat = 60 / bpm; bar = 4 * beat
    prog = [  # bright, calm, Apple-keynote-ish
        ['D3', 'A3', 'E4', 'F#4', 'A4', 'C#5'],   # Dmaj9
        ['B2', 'F#3', 'D4', 'A4', 'C#5', 'E5'],   # Bm11
        ['G2', 'D3', 'B3', 'F#4', 'A4', 'D5'],    # Gmaj9
        ['A2', 'E3', 'C#4', 'E4', 'A4', 'B4'],    # A add9
    ]
    starts = {s['id']: s['start'] for s in tl}
    calm_from = starts['rewind'] + 4.4   # the score turns calm and bright as "Preflight" appears
    def intensity(t):
        # calm score: piano and pad from the reveal, pulse while the product works, thinner for the payoff, swell at the end
        if t < starts['blocked']: return 0.6, 0.6, 0.0
        if t < starts['payoff']: return 0.7, 1.0, 0.55
        if t < starts['end']: return 0.6, 0.7, 0.0
        return 0.9, 1.0, 0.0
    tense = tension(calm_from + 0.8, starts)
    if 'nocheck' in starts:  # the airport opening is calm; the unease only builds once tickets start taking off unchecked
        _tt = np.arange(len(tense)) / SR
        tense = tense * np.clip((_tt - starts['nocheck']) / 5.0, 0.1, 1)
    bars = int((total - calm_from) / bar) + 2
    rng = np.random.default_rng(3)
    for b in range(bars):
        chord = prog[b % 4]; t0 = calm_from + b * bar
        padI, pianoI, pulseI = intensity(t0)
        # pad: sustained chord, slow attack/release
        dur = bar + 0.6; m = int(SR * dur); tt = np.arange(m) / SR
        env = np.clip(tt / 0.9, 0, 1) * np.clip((dur - tt) / 0.9, 0, 1)
        sig = sum(np.sin(2 * np.pi * note(x) * tt) + 0.3 * np.sin(2 * np.pi * note(x) * 2.003 * tt) for x in chord[1:5])
        place(pad, 0.045 * padI * sig * env * (1 + 0.08 * np.sin(2 * np.pi * 0.25 * tt)), t0)
        # bass
        place(bass, 0.16 * max(padI, pianoI) * tone(note(chord[0]), bar, harmonics=(1, 0.25), decay=0.6, attack=0.03), t0)
        # piano arpeggio in eighths
        if pianoI > 0:
            pattern = [1, 3, 4, 5, 2, 4, 5, 3]
            for k, idx in enumerate(pattern):
                f = note(chord[idx]) * (2 if k in (3, 6) and pianoI > 0.8 else 1)
                v = (0.55 if k % 2 == 0 else 0.38) * pianoI * (0.9 + 0.2 * rng.random())
                place(piano, v * tone(f, 1.4, harmonics=(1, 0.42, 0.18, 0.07), decay=3.2), t0 + k * beat / 2 + 0.004 * rng.standard_normal())
        # soft pulse (felt kick) on 1 and 3
        if pulseI > 0:
            for q in (0, 2):
                m2 = int(SR * 0.28); tt2 = np.arange(m2) / SR
                kick = np.sin(2 * np.pi * (48 + 50 * np.exp(-tt2 * 30)) * tt2) * np.exp(-tt2 * 14)
                place(pulse, 0.22 * pulseI * kick, t0 + q * beat)
    mix = 0.33 * piano + pad + bass + pulse
    mix = reverb(lowpass_fast(mix, 7000), 2.2, 0.3)
    tt = np.arange(n) / SR
    mix *= np.clip((tt - calm_from) / 1.2, 0, 1) * np.clip((total - tt) / 2.5, 0, 1)
    mix[: len(tense)] += tense[: n]
    return mix

def tension(until, starts):
    """Dark opening: low D drone, a slow heartbeat, a high uneasy shimmer, building to the rewind."""
    n = int(SR * until); tt = np.arange(n) / SR
    rng = np.random.default_rng(5)
    rise_ = np.clip(tt / until, 0, 1)
    drone = (np.sin(2 * np.pi * 36.7 * tt) + 0.6 * np.sin(2 * np.pi * 55.0 * tt) + 0.25 * np.sin(2 * np.pi * 73.4 * tt * 1.003))
    drone *= 0.05 * (0.6 + 0.6 * rise_) * (1 + 0.15 * np.sin(2 * np.pi * 0.11 * tt))
    shimmer = 0.012 * rise_ * (np.sin(2 * np.pi * 1174.7 * tt) + np.sin(2 * np.pi * 1244.5 * tt)) * (0.5 + 0.5 * np.sin(2 * np.pi * 0.3 * tt))
    beat = np.zeros(n)
    t = 1.0
    while t < until - 1.0:
        for off, v in ((0, 1.0), (0.28, 0.6)):
            m = int(SR * 0.25); t2 = np.arange(m) / SR
            k = np.sin(2 * np.pi * (42 + 30 * np.exp(-t2 * 30)) * t2) * np.exp(-t2 * 16)
            place(beat, 0.10 * v * (0.7 + 0.5 * (t / until)) * k, t + off)
        t += 60 / 62
    air = 0.008 * lowpass_fast(rng.standard_normal(n), 900) * rise_
    mix = reverb(drone + shimmer + air, 2.6, 0.35) + beat
    fade = np.clip(tt / 2.0, 0, 1) * np.clip((until - tt) / 1.0, 0, 1)
    return mix * fade

# ---------------------------------------------------------------- sound effects
def sfx(kind, length=None):
    rng = np.random.default_rng(abs(hash(kind)) % 2**32)
    if kind == 'click':
        n = int(SR * 0.03); t = np.arange(n) / SR
        return 0.25 * (rng.standard_normal(n) * np.exp(-t * 400) + np.sin(2 * np.pi * 3200 * t) * np.exp(-t * 250))
    if kind == 'pop':
        n = int(SR * 0.09); t = np.arange(n) / SR
        f = 700 + 600 * (1 - np.exp(-t * 60))
        return 0.18 * np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 45)
    if kind == 'tick':
        return 0.10 * tone(2100, 0.06, decay=80)
    if kind == 'whoosh':
        n = int(SR * 0.6); t = np.arange(n) / SR
        noise = rng.standard_normal(n)
        sweep = np.zeros(n)
        for a, b, c in ((0, n // 3, 600), (n // 3, 2 * n // 3, 2200), (2 * n // 3, n, 900)):
            sweep[a:b] = lowpass_fast(noise[a:b], c)
        return 0.12 * sweep * np.sin(np.pi * t / 0.6) ** 2
    if kind == 'deny':
        a = tone(233, 0.16, harmonics=(1, 0.3), decay=18); b = tone(175, 0.22, harmonics=(1, 0.3), decay=14)
        out = np.zeros(int(SR * 0.4)); out[: len(a)] += a; out[int(SR * 0.1): int(SR * 0.1) + len(b)] += b
        return 0.32 * out
    if kind == 'chime':
        out = np.zeros(int(SR * 1.6))
        for f, at, v in ((1318.5, 0, 1), (1975.5, 0.11, 0.8)):
            s = tone(f, 1.4, harmonics=(1, 0.0, 0.25, 0.0, 0.08), decay=3.5); i = int(at * SR); out[i:i + len(s)] += v * s
        return 0.14 * out
    if kind == 'success':
        out = np.zeros(int(SR * 0.8))
        for f, at in ((659.3, 0), (987.8, 0.09)):
            s = tone(f, 0.6, harmonics=(1, 0.2), decay=6); i = int(at * SR); out[i:i + len(s)] += s
        return 0.14 * out
    if kind == 'type':
        dur = length or 1.5; out = np.zeros(int(SR * dur)); t = 0.0
        while t < dur - 0.05:
            k = sfx('click') * (0.35 + 0.25 * rng.random()); i = int(t * SR); out[i:i + len(k)] += k[: len(out) - i]
            t += 0.06 + 0.07 * rng.random()
        return out
    if kind == 'hit':   # low cinematic hit
        n = int(SR * 2.2); t = np.arange(n) / SR
        boom = np.sin(2 * np.pi * (38 + 40 * np.exp(-t * 8)) * t) * np.exp(-t * 2.2)
        crack = lowpass_fast(rng.standard_normal(n), 2500) * np.exp(-t * 25)
        return 0.42 * boom + 0.08 * crack
    if kind == 'drop':  # paper landing
        n = int(SR * 0.5); t = np.arange(n) / SR
        return 0.10 * lowpass_fast(rng.standard_normal(n), 1400) * np.exp(-t * 14) + 0.12 * np.sin(2 * np.pi * 90 * t) * np.exp(-t * 20)
    if kind == 'msg':   # soft message arrive
        out = np.zeros(int(SR * 0.5))
        for f, at in ((880, 0), (1174.7, 0.07)):
            s = tone(f, 0.4, harmonics=(1, 0.15), decay=10); i = int(at * SR); out[i:i + len(s)] += s
        return 0.08 * out
    if kind == 'rewind':  # tape rewinding: rising whir with flutter
        n = int(SR * 2.3); t = np.arange(n) / SR
        f = 300 + 1500 * (t / 2.3) ** 1.5
        whir = np.sin(2 * np.pi * np.cumsum(f) / SR) * (1 + 0.4 * np.sin(2 * np.pi * 23 * t))
        noise = lowpass_fast(rng.standard_normal(n), 3000)
        env = np.clip(t / 0.15, 0, 1) * np.clip((2.3 - t) / 0.2, 0, 1)
        return (0.07 * whir + 0.05 * noise) * env
    if kind == 'swell':
        n = int(SR * 1.4); t = np.arange(n) / SR
        return 0.06 * lowpass_fast(rng.standard_normal(n), 1800) * (t / 1.4) ** 2 * np.exp(-np.maximum(t - 1.2, 0) * 20)
    raise ValueError(kind)

# ---------------------------------------------------------------- voice
def load_vo(scene_id):
    src = BUILD / 'vo' / f'{scene_id}.wav'; dst = BUILD / 'vo' / f'{scene_id}.44k.wav'
    if not dst.exists():
        sh('ffmpeg', '-y', '-i', str(src), '-ar', str(SR), '-ac', '1', str(dst))
    with wave.open(str(dst)) as w:
        return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float64) / 32768.0

def audio(tl, cues):
    total = tl[-1]['start'] + tl[-1]['dur']
    n = int(SR * total) + SR
    vo, fx = np.zeros(n), np.zeros(n)
    for s in tl:
        v = load_vo(s['id'])
        # gentle presence lift: slight high-shelf by adding a little of the high-passed signal
        hp = v - lowpass_fast(v, 3000)
        place(vo, 0.92 * (v + 0.25 * hp), s['start'] + VO_OFFSET)
        for cue in cues.get(s['id'], []):
            kind, at = cue[0], cue[1]
            length = cue[2] if len(cue) > 2 else None
            place(fx, sfx(kind, length), s['start'] + at)
    fx = reverb(fx, 0.9, 0.18, seed=11)
    mus = music(total, tl)[:n]
    # duck music under narration (smooth envelope, about -8 dB)
    env = np.abs(vo); win = int(SR * 0.25)
    env = np.convolve(env, np.ones(win) / win, mode='same')
    duck = 1 - 0.6 * np.clip(env / (env.max() * 0.15 + 1e-9), 0, 1)
    duck = np.convolve(duck, np.ones(int(SR * 0.3)) / int(SR * 0.3), mode='same')
    left = 0.55 * mus * duck + vo + fx
    # stereo: small Haas widening on music and fx only
    d = int(SR * 0.012)
    right = 0.55 * np.concatenate([np.zeros(d), (mus * duck)[:-d]]) + vo + np.concatenate([np.zeros(d // 2), fx[: -(d // 2)]])
    stereo = np.stack([left, right], axis=1)[: int(SR * total)]
    stereo /= max(1e-9, np.abs(stereo).max()) / 0.89
    out = BUILD / 'mix.wav'
    with wave.open(str(out), 'w') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((stereo * 32767).astype(np.int16).tobytes())
    return out, total

# ---------------------------------------------------------------- captions
def srt(tl):
    def ts(x):
        h, r = divmod(x, 3600); m, s = divmod(r, 60)
        return f'{int(h):02}:{int(m):02}:{int(s):02},{int((s % 1) * 1000):03}'
    lines, i = [], 1
    for s in tl:
        sentences = [x.strip() for x in s['vo'].replace('. ', '.|').replace('? ', '?|').split('|') if x.strip()]
        words = sum(len(x.split()) for x in sentences)
        t = s['start'] + VO_OFFSET
        for sent in sentences:
            d = s['voDur'] * len(sent.split()) / words
            lines.append(f'{i}\n{ts(t)} --> {ts(t + d)}\n{sent}\n'); i += 1; t += d
    (BUILD / 'preflight-demo.srt').write_text('\n'.join(lines))

# ---------------------------------------------------------------- video
def probe_seconds(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(path)],
                         capture_output=True, text=True, check=True).stdout.strip()
    return float(out or 0)

def video(tl, total, mix):
    frames = BUILD / 'frames'
    rec = HERE / 'recordings'
    story = HERE / 'story'
    overlays = [s for s in tl if (rec / f"{s['id']}.mp4").exists()]
    stories = [s for s in tl if (story / f"{s['id']}.mp4").exists()]
    out = BUILD / 'preflight-demo.mp4'
    base = ['ffmpeg', '-y', '-framerate', str(FPS), '-i', str(frames / 'f%05d.jpg')]
    inputs, filters, last = [], [], '[0:v]'
    k = 2
    for s in stories:
        # Full-bleed, cover-cropped, a touch darker, looped to the scene's length, faded in and out.
        inputs += ['-stream_loop', '-1', '-i', str(story / f"{s['id']}.mp4")]
        d = s['dur']
        filters.append(
            f"[{k}:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps={FPS},"
            f"eq=brightness=-0.06:saturation=0.85,trim=duration={d:.3f},format=rgba,"
            f"fade=t=in:st=0:d=0.4:alpha=1,fade=t=out:st={max(d - 0.4, 0):.3f}:d=0.4:alpha=1,"
            f"setpts=PTS-STARTPTS+{s['start']}/TB[s{k}]")
        filters.append(f"{last}[s{k}]overlay=0:0:eof_action=pass:enable='between(t,{s['start']},{s['start'] + d})'[v{k}]")
        last = f'[v{k}]'
        k += 1
    for s in overlays:
        clip = rec / f"{s['id']}.mp4"
        inputs += ['-i', str(clip)]
        # A take longer than its scene is sped up to fit (at most 3x), so nothing is cut off.
        speed = max(1.0, min(3.0, probe_seconds(clip) / s['dur']))
        # Apple-style frame: scale into a rounded window on the soft background
        filters.append(f"[{k}:v]scale=1600:-2,fps={FPS},setpts=(PTS-STARTPTS)/{speed:.4f}+{s['start']}/TB,format=rgba[r{k}]")
        filters.append(f"{last}[r{k}]overlay=(W-w)/2:(H-h)/2:enable='between(t,{s['start']},{s['start'] + s['dur']})'[v{k}]")
        last = f'[v{k}]'
        k += 1
    cmd = base + ['-i', str(mix)] + inputs
    if filters:
        cmd += ['-filter_complex', ';'.join(filters), '-map', last, '-map', '1:a']
    else:
        cmd += ['-map', '0:v', '-map', '1:a']
    cmd += ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
            '-c:a', 'aac', '-b:a', '192k', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-t', f'{total:.2f}', str(out)]
    sh(*cmd)
    # Captions burned in (for judges watching muted) as a second file
    sh('ffmpeg', '-y', '-i', str(out), '-vf',
       f"subtitles={BUILD / 'preflight-demo.srt'}:force_style='FontName=Inter,FontSize=13,PrimaryColour=&H00FFFFFF,BackColour=&H80000000,BorderStyle=4,Outline=0,Shadow=0,MarginV=10'",
       '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p', '-c:a', 'copy', str(BUILD / 'preflight-demo-captioned.mp4'))
    return out

if __name__ == '__main__':
    tl = make_timeline()
    total = tl[-1]['start'] + tl[-1]['dur']
    print(f'timeline: {len(tl)} scenes, {total:.1f}s')
    if '--no-frames' not in sys.argv:
        subprocess.run(['node', str(HERE / 'capture.mjs'), str(BUILD / 'timeline.json'), str(BUILD / 'frames'), str(FPS), '6'], check=True)
    cues = json.loads((BUILD / 'cues.json').read_text())
    mix, total = audio(tl, cues)
    srt(tl)
    out = video(tl, total, mix)
    print('wrote', out)
