# Preflight: 3-minute demo video script

Judges are not required to watch past 3:00, so everything that wins is inside it. Record on a real Jira site,
one take per scene, no slides before 2:50. Target length: 3:30 (the last 30 s are optional depth).

**Setup before recording:** demo loaded in project `PRIV`; both gates attached; one named approver ("Thandi,
Information Officer") in a second browser profile; a Confluence page "Acme Privacy Policy" with a section on
location data; `PRIV-1` "Add SA ID number field to customer signup" in To Do.

| Time | On screen | Voice-over (keep it this short) |
|---|---|---|
| 0:00–0:12 | `PRIV-1` on the board | "This ticket adds a South African ID number to our signup form. Nobody has asked why we need it, how long we keep it, or whether privacy signed off. Watch what happens when a developer starts work." |
| 0:12–0:30 | Drag `PRIV-1` to **In Progress** → Jira refuses with the Preflight message | "Preflight holds it *before* a line of code is written. The message names the rule, the POPIA section and exactly what's missing." |
| 0:30–0:50 | Open the issue → Preflight panel: "Start work: Blocked", next-step box, four questions, approver shown | "The panel says what to do next and who approves: Thandi, our Information Officer. Every rule cites why it matched: the phrase 'SA ID number'." |
| 0:50–1:15 | Rovo → Preflight agent: "Help me answer these" → agent drafts → panel shows **Rovo draft** → **Use draft** → **Save answers** | "Rovo drafts the answers with me, but a draft never counts. I confirm it. AI helps; it can't approve, and it can't say 'no personal data' for me." |
| 1:15–1:35 | Switch to Thandi → **Apps → Preflight reviews** → item under "Waiting for approval" → Approve | "Thandi sees everything waiting on her in one inbox, and approves." |
| 1:35–1:45 | Back as developer → drag to In Progress → succeeds | "Now work can start." |
| 1:45–2:05 | Edit the description to delete "ID number" → panel still shows the rule ("matched earlier") · change the retention answer → approval goes stale | "Rewording the ticket doesn't make the review disappear. And if anyone changes an approved answer, the approval goes stale and the gate closes again." |
| 2:05–2:20 | Drag to **Done** → held: "Privacy notice updated (link)" → paste link → Done succeeds | "Before Done, the second gate asks for proof it shipped as agreed: the updated privacy notice." |
| 2:20–2:45 | Admin page → Rovo "Draft Preflight rules from our privacy policy page" → new draft appears with examples passing → **Check workflow coverage** → one unprotected Bug workflow | "Rules come from your own policy. Rovo turns a Confluence page into draft rules; nothing is enforced until an approver activates it. And Preflight shows you any workflow that can still skip the gate." |
| 2:45–3:00 | Title card: "Preflight: your privacy policy, enforced before build." | "Scanners find personal data after it's in Jira. Checklists hope someone ticks the box. Preflight puts your privacy review in front of the work and keeps a write-once record of every decision." |
| 3:00–3:30 *(optional)* | Architecture slide: deterministic engine shared by both gates, panel, Rovo and MCP; write-once audit; named-approver governance | "No LLM in the gate. The same engine powers both gates, the panel, Rovo and the MCP tools. Every answer, approval and rule change is a write-once audit event." |

**Do not show:** JQL, separation of duties, exceptions, settings screens. They're real, but they cost seconds.

**Say "POPIA" once, then say "your privacy policy".** Non-South-African judges must see it as a pattern for any
policy (GDPR, HIPAA), with POPIA as the first rule pack.
