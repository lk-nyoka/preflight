# Preflight: demo film script (2:13)

The film explains Preflight with one picture: a plane cannot leave the gate until its pre-flight check is done. Each part of the app has an airport equivalent, and a line on screen says what it is in Jira. Characters: **Nicholas**, the Information Officer, and **Ben**, a developer. The company, complaint and people are illustrative.

| Scene | Starts | On screen | In Jira | Narration |
| --- | --- | --- | --- | --- |
| `gate` | 0:00 | A plane at the gate; ground crew ticks Fuel, Doors, Cargo | — | Every flight starts the same way. A walk-around. A checklist. Fuel. Doors. Cargo. It's why flying works. |
| `nocheck` | 0:10 | Tickets take off as planes; one carries a suitcase of ID numbers | — | Software? It just takes off. Written on Tuesday. Shipped on Thursday. And nobody checks what's on board. |
| `storm` | 0:19 | Storm, the complaint letter, "Who approved this?" | — | Until the complaint lands. Customer ID numbers. No reason. No end date. And one question. Who approved this? |
| `stakes` | 0:29 | The Information Regulator's fines | — | Regulators are asking too. One million rand for a bank. Half a million for a college. |
| `rewind` | 0:36 | Rewind to the gate; the Preflight wordmark | — | So let's go back to the gate. This is Preflight. |
| `scan` | 0:41 | Baggage scanner reads the ticket and tags it "Identifying numbers" | Rules read each work item's title and description | Step one. The scanner. Preflight reads every Jira ticket as it's written, and spots personal data on board. ID numbers. Health details. Children's data. |
| `blocked` | 0:54 | The gate arm stays down; the checklist appears | `preflight-build-gate` workflow validator refuses the move to In Progress | Step two. The gate. Start work too soon, and it stays closed. Three questions first. Why do you need it? What's your lawful basis? When is it deleted? |
| `copilot` | 1:06 | Rovo hands Ben a draft; Ben confirms it | Rovo agent action saves a draft; a person clicks Use draft | Step three. Your co-pilot. Rovo drafts the answers. A person confirms them. AI can help. It can't approve. |
| `tower` | 1:17 | Nicholas in the control tower clears PRIV-1 from the inbox | Preflight reviews inbox; only a named approver can approve | Step four. The control tower. Nicholas, the Information Officer, sees every waiting ticket, and clears it for take-off. |
| `takeoff` | 1:26 | Gate opens; the plane takes off | The move to In Progress succeeds | Gate open. Ben is cleared to build. |
| `dodge` | 1:30 | Label peeled off the suitcase, still flagged; edited answer cancels the clearance | Sticky matches; an edited answer makes the approval stale | Try to sneak past? Reword the ticket. It's still flagged. Change an answer. The clearance is cancelled. |
| `landing` | 1:39 | Landing check: privacy notice link before Done | `preflight-done-gate` validator asks for done-stage evidence | Before landing, one last check. Proof. A link to the updated privacy notice. |
| `payoff` | 1:46 | Flight recorder; the record answers "Who approved this?" | Write-once audit history on the work item | And everything lands in the flight recorder. Write-once. So next time someone asks, who approved this? Ten seconds. |
| `policy` | 1:55 | POPIA pack, GDPR pack, rules drafted from your own policy | Starter packs load as drafts; an approver activates rules | Your airline. Your checklist. Start with POPIA or GDPR, or let Rovo draft rules from your own policy. Nothing is enforced until an approver switches it on. |
| `end` | 2:07 | Wordmark and the five parts | — | Preflight. Privacy review, before you build. |

## How it is built

Everything is code: `video/film.html` draws each scene, `video/scenes.json` holds the narration, `video/voice.py` speaks it with the open-source Piper voice, and `video/build.py` renders the frames, synthesises the music and sound effects, and assembles the MP4 (plus a captioned copy). No stock footage, no third-party music, no logos.

```
cd video
python3 voice.py && python3 build.py
```

## Adding real app footage

Codegeist asks for the video to show the app running. Save a screen recording as `video/recordings/<scene>.mp4` (for example `blocked.mp4`, `copilot.mp4`, `tower.mp4`) and rebuild: the recording replaces that scene's animation, framed in a window, and is sped up to fit the narration. Record at least `blocked`, `copilot` and `tower` on a site with Rovo: drag the SA ID item to In Progress and hold on the refusal; ask the Preflight agent to draft an answer, say yes, then click Use draft in the panel; open Preflight reviews, open the item and click Approve.

The earlier dark "complaint" film is kept as `video/film-classic.html` and `video/scenes-classic.json`.
