# Preflight: demo video script (2:45)

Judges are not required to watch past 3:00, so the whole story fits inside it. The film in `video/` follows this
script. Its app scenes are animated recreations; before submitting, record each one on a real Jira site and drop the
clip into `video/recordings/<scene>.mp4` (same name as the scene). `python3 build.py` swaps it in and keeps the music,
narration and captions. Record each clip at the scene's length (see `video/build/timeline.json`).

The structure: **the disaster, told backwards → why it keeps happening → rewind → the rescue → the payoff.**

| Scene | Time | On screen | Narration |
|---|---|---|---|
| `cold` | 0:00 | Dark. A complaint letter to a fictional company: ID numbers collected with no purpose, kept forever, shared with a vendor. "Provide the records showing who approved this." | "Eight months after launch, a complaint arrives…" |
| `who` | 0:12 | Chat messages: "Who approved storing customer ID numbers?" "Not sure." … then **Who approved this?** | "The first question is always the same…" |
| `trace` | 0:20 | The old ticket: created Tuesday, In Progress Tuesday, Done Thursday. **Privacy questions asked: 0** | "Because the decision was made here, in a Jira ticket…" |
| `stakes` | 0:32 | R1 million · R500,000 · 10 years, with the source line | "And South Africa's Information Regulator is fining…" |
| `why` | 0:45 | 400 tickets a sprint. 1 Information Officer. Review after the code ships. | "It keeps happening because…" |
| `rewind` | 0:56 | Tape rewinds to Tuesday 09:12, then **Preflight** | "So, rewind. Same ticket. Same Tuesday…" |
| `blocked` | 1:04 | **Record:** drag `PRIV-1` to In Progress; Jira refuses with the Preflight message (names the approver) | "The moment someone starts work, Preflight holds the ticket…" |
| `panel` | 1:14 | **Record:** the Preflight panel: next step, four questions, why it matched | "Four questions: the purpose…" |
| `rovo` | 1:23 | **Record:** Rovo drafts an answer → *Rovo draft* in the panel → Use draft → Save | "Rovo can draft the answers. But a draft never counts…" |
| `inbox` | 1:36 | **Record:** as Thandi, *Apps → Preflight reviews* → open the item → **Approve** in its panel | "The Information Officer sees it in one inbox…" |
| `pass` | 1:47 | **Record:** drag to In Progress: it moves | "Now, work can start." |
| `dodge` | 1:52 | **Record:** reword the summary AND description (remove "SA ID number") → panel shows "matched earlier"; then change the retention answer → approval goes stale | "Reword the ticket, and it's still caught…" |
| `done` | 2:04 | **Record:** drag to Done → refused → add the privacy notice link → Done | "Before Done, a second gate asks for proof…" |
| `policy` | 2:14 | **Record:** Rovo drafts a rule from a Confluence policy page; *Check workflow coverage* shows one unprotected workflow | "The rules come from your own policy…" |
| `payoff` | 2:26 | The same complaint beside the Preflight record: who approved, when, purpose, basis, retention, notice link, history | "Eight months later, someone asks the same question…" |
| `end` | 2:39 | **Preflight. Privacy review, before you build.** | "Preflight. Privacy review, before you build." |

**Setup before recording:** demo loaded in project `PRIV`; both gates attached; one named approver ("Thandi M.,
Information Officer") in a second browser profile; a Confluence page "Acme Privacy Policy" with a section on location
data; `PRIV-1` "Add SA ID number field to customer signup" in To Do.

**Facts on screen** (checked 7 November 2026): the R1 million and R500,000 fines were announced by the Information
Regulator on 26 October 2026 (reported by ITWeb and Accounting Weekly); POPIA allows imprisonment of up to 10 years
for serious offences. The complaint letter and Acme Retail are fictional and labelled as such.

**Say "POPIA" sparingly, then "your privacy policy".** Non-South-African judges should see a pattern for any policy
(GDPR, HIPAA), with POPIA as the first rule pack.
