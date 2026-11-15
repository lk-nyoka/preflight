"""Preflight launch film: build script.

  python3 build.py            voice -> timeline -> frames -> audio -> mp4 (+ captioned copy, .srt)
  python3 build.py --no-frames   reuse rendered frames (audio or caption changes only)
  python3 build.py --timeline    voice and timeline only

Scenes and narration live in scenes.json: each line has a target time inside its scene.
A line never starts before the previous one has finished; a scene grows if its lines need the room.
"""
import json, subprocess, sys, wave, hashlib, pathlib
import numpy as np
HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE.parent))
import build as lib            # audio helpers from the first film's build
SR, FPS = lib.SR, 30
BUILD = HERE / 'build'; VO = BUILD / 'vo'; VO.mkdir(parents=True, exist_ok=True)
MODEL = '/tmp/voices/en_US-lessac-high.onnx'
GAP = 0.22        # least silence between two lines

def speak(text):
    wav = VO / (hashlib.md5(text.encode()).hexdigest()[:12] + '.wav')
    if not wav.exists():
        subprocess.run(['python3', '-m', 'piper', '-m', MODEL, '-f', str(wav), '--length-scale', '1.08', '--sentence-silence', '0.32'],
                       input=text.encode(), check=True, capture_output=True)
    with wave.open(str(wav)) as w:
        return wav, w.getnframes() / w.getframerate()

def make_timeline():
    t, tl = 0.0, []
    for s in json.loads((HERE / 'scenes.json').read_text()):
        lines, cursor = [], 0.0
        for at, text in s['lines']:
            wav, d = speak(text)
            start = max(at, cursor)
            lines.append({'t': round(start, 3), 'd': round(d, 3), 'text': text, 'wav': wav.name})
            cursor = start + d + GAP
        dur = round(max(s['dur'], cursor + 0.3), 2)
        tl.append({'id': s['id'], 'start': round(t, 2), 'dur': dur, 'dark': bool(s.get('dark')), 'lines': lines})
        t += dur
    (BUILD / 'timeline.json').write_text(json.dumps(tl, indent=1))
    return tl

def read_wav(path):
    with wave.open(str(path)) as w:
        x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float64) / 32768
        sr = w.getframerate()
    if sr != SR:
        x = np.interp(np.arange(int(len(x) * SR / sr)) * sr / SR, np.arange(len(x)), x)
    return x

def music(total, tl):
    """Quiet in the hook, a pulse that builds under the stakes, silence, a lift at the reveal,
    a light steady rhythm through the steps, breakdowns for the two held lines, a resolved close."""
    tone, place, note, lowpass, reverb = lib.tone, lib.place, lib.note, lib.lowpass_fast, lib.reverb
    n = int(SR * total) + SR
    pluck, pad, bass, drums, low = (np.zeros(n) for _ in range(5))
    by = {s['id']: s for s in tl}
    T = lambda sid, i=None: by[sid]['start'] + (by[sid]['lines'][i]['t'] if i is not None else 0)
    reveal = T('reveal', 0)
    held = (T('copilot', 6) - 0.4, T('tower'))                 # "AI can help. It can't approve."
    callback = (T('recorder', 2) - 0.2, T('checklist'))        # "Who approved this?"
    bpm = 104; beat = 60 / bpm; bar = 4 * beat
    bright = [['D2', 'A3', 'E4', 'F#4', 'A4', 'C#5'], ['B1', 'F#3', 'D4', 'A4', 'C#5', 'E5'], ['G1', 'D3', 'B3', 'F#4', 'A4', 'D5'], ['A1', 'E3', 'C#4', 'E4', 'A4', 'B4']]
    dark = [['B1', 'F#3', 'B3', 'D4', 'F#4', 'A4'], ['G1', 'D3', 'G3', 'B3', 'D4', 'F#4']]
    rng = np.random.default_rng(3)
    m = int(SR * 0.3); t = np.arange(m) / SR
    kick = np.sin(2 * np.pi * (46 + 70 * np.exp(-t * 34)) * t) * np.exp(-t * 11)
    hn = rng.standard_normal(int(SR * 0.08)); hat = (hn - lowpass(hn, 7000)) * np.exp(-np.arange(len(hn)) / SR * 70)
    cn = rng.standard_normal(int(SR * 0.22)); cn = lowpass(cn, 4200) - lowpass(cn, 900)
    ct = np.arange(len(cn)) / SR; clap = cn * (np.exp(-ct * 24) + 0.6 * np.exp(-np.abs(ct - 0.012) * 300))
    def section(t0):
        if t0 < T('problem'): return 'hook'
        if t0 < T('stakes'): return 'dusk'
        if t0 < T('reveal'): return 'night'
        if t0 < reveal - 0.05: return 'silence'
        if t0 < T('scan'): return 'lift'
        if held[0] <= t0 < held[1] or callback[0] <= t0 < callback[1]: return 'hold'
        if t0 < T('close'): return 'groove'
        return 'final'
    first = -int(reveal / bar) - 1
    for b in range(first, int((total - reveal) / bar) + 2):
        t0 = reveal + b * bar
        if t0 < 0 or t0 > total: continue
        sec = section(t0)
        if sec in ('hook', 'silence'): continue
        chord = (dark if sec == 'night' else bright)[b % (2 if sec == 'night' else 4)]
        padI = {'dusk': 0.6, 'night': 0.5, 'lift': 1.0, 'groove': 0.8, 'hold': 0.55, 'final': 1.1}[sec]
        dur = bar + 0.5; mm = int(SR * dur); tt = np.arange(mm) / SR
        env = np.clip(tt / 0.5, 0, 1) * np.clip((dur - tt) / 0.5, 0, 1)
        sig = sum(np.sin(2 * np.pi * note(x) * tt) + 0.3 * np.sin(2 * np.pi * note(x) * 2.003 * tt) for x in chord[1:5])
        place(pad, 0.04 * padI * sig * env, t0)
        if sec == 'night':
            # heartbeat that tightens and grows toward the reveal
            grow = np.clip((t0 - T('stakes')) / max(reveal - T('stakes'), 1), 0, 1)
            for q in (0, 2): place(low, (0.18 + 0.3 * grow) * kick, t0 + q * beat); place(low, (0.1 + 0.2 * grow) * kick, t0 + q * beat + 0.22)
            place(bass, 0.2 * tone(note(chord[0]) * 2, bar, harmonics=(1, 0.3), decay=0.8, attack=0.05), t0)
            continue
        if sec == 'hold':
            place(bass, 0.12 * tone(note(chord[0]) * 2, bar, harmonics=(1, 0.3), decay=0.7, attack=0.05), t0)
            continue
        pattern = [1, 3, 4, 3, 5, 3, 4, 3] if sec == 'dusk' else [1, 3, 4, 2, 5, 3, 4, 2]
        pv = {'dusk': 0.38, 'lift': 0.5, 'groove': 0.55, 'final': 0.65}[sec]
        for k, idx in enumerate(pattern):
            if sec == 'dusk' and k % 2: continue
            f = note(chord[idx]) * (2 if k == 4 else 1)
            v = (0.6 if k % 2 == 0 else 0.4) * pv * (0.9 + 0.2 * rng.random())
            place(pluck, v * tone(f, 0.9, harmonics=(1, 0.5, 0.22, 0.09), decay=6.5), t0 + k * beat / 2)
        if sec in ('groove', 'final'):
            for k in range(8):
                f = note(chord[0]) * (4 if k in (3, 7) else 2)
                place(bass, 0.15 * tone(f, beat / 2, harmonics=(1, 0.5, 0.2), decay=7, attack=0.008), t0 + k * beat / 2)
            for q in range(4):
                place(drums, 0.30 * kick, t0 + q * beat); place(drums, 0.045 * hat, t0 + q * beat + beat / 2)
            for q in (1, 3): place(drums, 0.08 * clap, t0 + q * beat)
        else:
            place(bass, 0.14 * tone(note(chord[0]) * 2, bar, harmonics=(1, 0.3), decay=0.7, attack=0.03), t0)
    # hook: a low held note, barely there
    hk = int(SR * T('problem')); ht = np.arange(hk) / SR
    low[:hk] += 0.05 * (np.sin(2 * np.pi * 36.7 * ht) + 0.5 * np.sin(2 * np.pi * 55 * ht)) * np.clip(ht / 1.5, 0, 1) * np.clip((T('problem') - ht) / 0.8, 0, 1)
    # unease under the stakes
    tense = lib.tension(reveal - 0.9, {})
    _t = np.arange(len(tense)) / SR
    tense = 0.9 * tense * np.clip((_t - T('stakes')) / 2.0, 0, 1) * np.clip((reveal - 0.9 - _t) / 0.15, 0, 1)
    # lift at the reveal: a rising swell into a bright chord
    sw = int(SR * 3.5); st = np.arange(sw) / SR
    swell = sum(np.sin(2 * np.pi * note(x) * st) for x in ['D3', 'A3', 'D4', 'F#4', 'A4', 'E5']) * np.clip(st / 0.35, 0, 1) * np.exp(-st * 0.7) * 0.05
    place(pad, swell, reveal - 0.05)
    wet = reverb(lowpass(0.34 * pluck + pad, 8000), 1.8, 0.26)
    mix = wet + bass + lowpass(drums, 11000) + low
    mix[: len(tense)] += tense[: n]
    tt = np.arange(n) / SR
    # hard silence before the reveal, and soft dips into the two held lines
    mix *= 1 - np.clip((tt - (reveal - 0.95)) / 0.1, 0, 1) * np.clip((reveal - 0.05 - tt) / 0.05, 0, 1)
    mix *= np.clip(tt / 0.8, 0, 1) * np.clip((total - tt) / 2.5, 0, 1)
    return mix

def audio(tl, cues):
    total = tl[-1]['start'] + tl[-1]['dur']
    n = int(SR * total) + SR
    vo, fx = np.zeros(n), np.zeros(n)
    for s in tl:
        for ln in s['lines']:
            v = read_wav(VO / ln['wav'])
            hp = v - lib.lowpass_fast(v, 3000)
            lib.place(vo, 0.92 * (v + 0.25 * hp), s['start'] + ln['t'])
    for kind, at, *rest in cues:
        lib.place(fx, lib.sfx(kind, rest[0] if rest else None) * (rest[1] if len(rest) > 1 else 1), at)
    fx = lib.reverb(fx, 0.9, 0.18, seed=11)
    mus = music(total, tl)[:n]
    env = np.abs(vo); win = int(SR * 0.25)
    env = np.convolve(env, np.ones(win) / win, mode='same')
    duck = 1 - 0.62 * np.clip(env / (env.max() * 0.15 + 1e-9), 0, 1)      # about -8 dB under the voice
    duck = np.convolve(duck, np.ones(int(SR * 0.3)) / int(SR * 0.3), mode='same')
    left = 0.5 * mus * duck + vo + fx
    d = int(SR * 0.012)
    right = 0.5 * np.concatenate([np.zeros(d), (mus * duck)[:-d]]) + vo + np.concatenate([np.zeros(d // 2), fx[: -(d // 2)]])
    stereo = np.stack([left, right], axis=1)[: int(SR * total)]
    stereo /= max(1e-9, np.abs(stereo).max()) / 0.89
    out = BUILD / 'mix.wav'
    with wave.open(str(out), 'w') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((stereo * 32767).astype(np.int16).tobytes())
    return out, total

def srt(tl):
    def ts(x):
        h, r = divmod(x, 3600); m, s = divmod(r, 60)
        return f'{int(h):02}:{int(m):02}:{int(s):02},{int(round((s % 1) * 1000)) % 1000:03}'
    out, i = [], 1
    for s in tl:
        for ln in s['lines']:
            a = s['start'] + ln['t']
            out.append(f"{i}\n{ts(a)} --> {ts(a + ln['d'] + 0.15)}\n{ln['text']}\n"); i += 1
    (BUILD / 'preflight-launch-demo.srt').write_text('\n'.join(out))

def main():
    tl = make_timeline()
    total = tl[-1]['start'] + tl[-1]['dur']
    print(f'timeline: {len(tl)} scenes, {total:.1f}s')
    for s in tl: print(f"  {s['id']:10} {s['start']:6.2f} {s['dur']:5.2f}")
    if '--timeline' in sys.argv: return
    frames = BUILD / 'frames'
    if '--no-frames' not in sys.argv:
        subprocess.run(['rm', '-rf', str(frames)]); frames.mkdir()
        subprocess.run(['node', str(HERE.parent / 'capture.mjs'), str(BUILD / 'timeline.json'), str(frames), str(FPS), '4'],
                       check=True, env={**__import__('os').environ, 'FILM': str(HERE / 'film.html')})
    cues = json.loads((BUILD / 'cues.json').read_text())
    mix, total = audio(tl, cues); srt(tl)
    out = BUILD / 'preflight-launch-demo.mp4'
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-framerate', str(FPS), '-i', str(frames / 'f%05d.jpg'), '-i', str(mix),
                    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
                    '-c:a', 'aac', '-b:a', '192k', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-t', f'{total:.2f}', str(out)], check=True)
    # Captions: white with a soft shadow on dark frames, dark with a light edge on bright ones, chosen by
    # looking at the rendered frame under each line. No box.
    from PIL import Image
    def tc(x):
        h, r = divmod(x, 3600); m, s = divmod(r, 60); return f'{int(h)}:{int(m):02}:{s:05.2f}'
    ev = []
    for s in tl:
        for ln in s['lines']:
            a0 = s['start'] + ln['t']; mid = a0 + ln['d'] / 2
            im = Image.open(frames / f"f{int(mid * FPS):05d}.jpg").convert('L').crop((520, 985, 1400, 1050))
            lum = sum(im.getdata()) / (im.size[0] * im.size[1])
            ev.append(f"Dialogue: 0,{tc(a0)},{tc(a0 + ln['d'] + 0.15)},{'L' if lum > 125 else 'D'},,0,0,0,,{ln['text']}")
    ass = BUILD / 'captions.ass'
    ass.write_text('[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\nWrapStyle: 2\n\n[V4+ Styles]\n'
        'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n'
        'Style: D,Inter,32,&H00FFFFFF,&H00FFFFFF,&H7818100A,&H96000000,0,0,0,0,100,100,0,0,1,1.2,1.6,2,60,60,40,1\n'
        'Style: L,Inter,32,&H00201208,&H00201208,&H30FFFFFF,&HFF000000,0,0,0,0,100,100,0,0,1,2.2,0,2,60,60,40,1\n\n'
        '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n' + '\n'.join(ev) + '\n')
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', str(out), '-vf', f'ass={ass}',
                    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p', '-c:a', 'copy',
                    str(BUILD / 'preflight-launch-demo-captioned.mp4')], check=True)
    print('wrote', out)

if __name__ == '__main__':
    main()
