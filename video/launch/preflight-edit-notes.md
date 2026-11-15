# Preflight launch film: edit notes

## What this is

A re-direction of the Preflight demo as a launch film: a dark keynote stage, one idea of type at a time, real Jira
recordings shown through a moving camera, and a five-step spine told with the airport illustrations.

## Files

| File | What it is |
| --- | --- |
| `build/preflight-launch-demo.mp4` | The film, 1920 x 1080, 30 fps, H.264 + AAC, no captions |
| `build/preflight-launch-demo-captioned.mp4` | The same film with captions burned in |
| `build/preflight-launch-demo.srt` | Captions as a separate file |
| `film.html` | Every scene: markup, styles and the per-frame drawing code |
| `scenes.json` | Scene order, minimum lengths, and each narration line with its target time |
| `build.py` | Voice, timeline, frame render, music, sound effects, mix, encode, captions |
| `footage/` | Frames cut from the original screen recording (15 per second) |

## Rebuilding

```
cd video/launch
python3 build.py              # everything (about 10 minutes)
python3 build.py --no-frames  # audio or caption changes only
python3 build.py --timeline   # voice and timings only
```

Needs Python with numpy and Pillow, Node with playwright-core, Chrome, ffmpeg, and the Piper voice model.

## How the real recordings are used

The recordings are never redrawn. `footage/` holds frames cropped from the original capture (browser bar removed).
`film.html` shows them inside a screen and moves a camera over them: `shot(name, time, view, box, ring)` takes a view
rectangle in the recording's own pixels, so a push-in is two rectangles and an easing. The blue ring and the dimming
around it are drawn over the footage; everything inside the ring is the original pixels.

| Clip | Source time in the original take | Shows |
| --- | --- | --- |
| `blocked` | 0:01.5 to 0:13 | The ticket dragged to In Progress and refused, with Preflight's message |
| `rovo` | 1:30 to 3:13, eight cuts | The Rovo agent: question, check, draft, confirm card, saved; then the Rovo draft box and Use draft |
| `inbox` | 4:32 to 4:38 | The Preflight reviews inbox |
| `approve` | 3:13 to 3:29, three cuts | Save answers, Approve, and the signed-off line with name, date and time |

Illustrated scenes carry a small "Illustration" label.

## Narration and timing

Each line in `scenes.json` has a target time inside its scene. A line never starts before the previous one ends, and
a scene grows if its lines need more room. The drawing code reads the real start of every line, so animation and
sound effects follow the words when the script changes. To use a recorded human voice, replace the files in
`build/vo/` (one per line) and rebuild with `--no-frames` if the lengths are close, or fully if not.

## Sound

All generated in code: no samples and no existing tunes. A low held note under the hook; a heartbeat that grows
under the stakes; 0.8 s of silence; a lift at the reveal; a light rhythm through the steps; the rhythm drops out for
"AI can help. It can't approve." and for "Who approved this?"; a resolved close. Music ducks about 8 dB under the
voice. Final loudness is normalised to -16 LUFS with a -1.5 dBTP ceiling.

## Known limits

- The voice is synthetic (Piper). A human read would be the largest single improvement.
- Depth is 2.5D built in code, not rendered 3D.
- Health details, the failed sneak-past, the cancelled clearance and the Done gate are illustrations, because the
  original take does not include them. Recording them would let each be replaced with real footage.
- "Ten seconds" was removed from the script because nothing on screen demonstrates it.
- Zoomed footage is limited by the resolution of the original take (1918 px wide).

## Regenerating `footage/`

The frame folders are not kept in git. They are made from the clips in `video/recordings/`:

```
cd video/launch
for c in blocked:live_blocked rovo:live_rovo inbox:live_inbox approve:live_approve; do
  mkdir -p footage/${c%%:*}; ffmpeg -i ../recordings/${c##*:}.mp4 -vf fps=15 -q:v 3 footage/${c%%:*}/%04d.jpg
done
```
