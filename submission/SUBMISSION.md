# Devpost submission sheet - Preflight (Codegeist 2026)

Everything below is ready to paste, field by field, in the order Devpost asks for it.
Three fields are left blank on purpose and are marked `>>> YOUR WORDS <<<`.

Video: https://youtu.be/kvaGZFoxu_Q (2:50)
Repo: https://github.com/lk-nyoka/preflight (public)
App ID: `ari:cloud:ecosystem::app/e9581f7b-84df-42b6-a25d-0cfb7c31f886`
Tests: 85 passing (`npm test`)

---

## 1. Project name (60 max)

```
Preflight: privacy review before build, in Jira
```

## 2. Elevator pitch (200 max)

```
Preflight puts your privacy policy in front of the work: Jira holds a work item that changes personal data until the review is answered and your Information Officer signs off, before a line is built.
```

---

## 3. About the project

Paste everything between the two `---8<---` markers into the "About the project" editor.

---8<---

## Inspiration

A person loses control of their ID number the moment a feature that collects it ships without anyone asking why it was needed.

That is not hypothetical in South Africa any more. In October 2026 the Information Regulator fined First National Bank R1 million after a flaw in its app exposed the personal information of 88 home-loan applicants, including nine people's account numbers, to 696 unauthorised individuals. The finding was not only that the flaw existed. It was that the bank reasonably ought to have known of the risk and had not taken reasonable steps to prevent it, with inadequate section 19 safeguards and weak governance over how long personal information was kept. In the same announcement a TVET college was fined R500,000, and not for its original incident: that fine was for failing to follow through on corrective action the Regulator had already ordered, including building a compliance framework.

Two very different cases, one question behind both: did anyone ask, and can you show it?

Every South African organisation that handles personal information falls under POPIA and has to appoint an Information Officer. In practice that person's policy lives in a PDF or a Confluence page, and the work that changes how personal data is collected, stored or shared lives in Jira. Nothing connects the two. A ticket like "add the customer's ID number to signup" can be built, reviewed and shipped without anyone asking why the ID number is needed, how long it is kept, or whether the Information Officer has seen it. When a complaint arrives the first question is "who approved this?", and if the decision was made in a Jira ticket, nobody can answer it.

Privacy scanners find personal data *after* it is in Jira. Checklist apps can block Done, but by then the field has shipped. I wanted the policy to show up at the moment it still costs nothing to change: when someone starts building.

## What it does

Preflight is a Forge app for Jira. One loop is the whole product, and it is the loop I proved end to end:

**A work item proposes collecting an ID number → the move to In Progress is refused → the panel asks why it is needed, why less data won't do, the lawful basis and when it is deleted → a named approver signs off → it moves → the move to Done is refused until the updated privacy notice is recorded.**

Around that loop:

- **It knows which review applies, and says why.** A deterministic, stem-aware engine reads the work item and shows the phrase that matched ("mentions 'SA ID number'"). Rewording the ticket does not make the review disappear; only an approver can dismiss a rule, and only with a reason.
- **An inbox for the Information Officer.** One page listing what is waiting on them and what is waiting on the team.
- **Rules come from your own policy.** An admin gives the Rovo agent their policy text and it proposes a **draft** rule with example tickets that must and must not match. A draft enforces nothing.
- **Answers have to be real.** "TBD", "not sure" and keyboard filler are rejected, and a retention answer has to say when the data goes.
- **A write-once audit history** of every answer, approval, rule change, setting change and bypass, plus a coverage check that lists workflow transitions with no gate on them.
- **It keeps the privacy rules itself.** Preflight reports the account IDs it stores to Atlassian's personal data API weekly and anonymises closed accounts everywhere, including in the audit history.

It ships with two editable starter packs, **POPIA (South Africa)** and **GDPR (EU / EEA)**, seven rules each: identifying numbers, contact details and location, special categories, children, electronic direct marketing, cross-border transfers and bulk exports. The GDPR pack knows that hosting in Ireland is not a transfer but hosting in South Africa is. The engine is regulation-agnostic, so HIPAA or an internal policy is a new pack, not new code.

## What it refuses

A privacy gate is only worth having if it holds when someone pushes on it. Each of these has a regression test that reproduces the original attack:

- **The agent cannot approve.** Not because it is told not to: because there is no tool in its manifest that approves. It drafts and explains; a person clicks.
- **An admin cannot switch on the rule the agent drafted.** Once approvers are named, that becomes a proposal the approver has to accept. An admin also can't approve work, can't add themselves as approver, and their edits to active rules become proposals, with anything that weakens a rule flagged first and the rule's examples re-run against the new version.
- **Rewording does not clear the gate.** A match sticks to the work item once it is recorded.
- **Editing an approved answer re-closes the gate.** Approvals carry a fingerprint of what they approved and go stale if the answers or the rule change.
- **A malformed transition payload fails closed.** If Preflight cannot tell which work item is moving, it refuses the move.
- **An agent call with no signed-in user behind it writes nothing at all.**
- **Going round the gate is reported.** Work that reaches In Progress or Done another way, moved from another project, type changed, a workflow with no validator, is flagged to the approvers in a comment and in the inbox.
- **Bulk actions cannot switch enforcement off**, and a break-glass approver reset needs a second admin and 72 hours.

## How I built it

- **Forge**: UI Kit for the issue panel, admin page and the global *Preflight reviews* page; two `jira:workflowValidator` modules; product triggers on create, update and delete; a `jira:entityProperty` for JQL; the Forge Key-Value Store.
- **One deterministic engine** (`src/engine/evaluate.js`) powers both gates, the panel, the Rovo actions and the MCP tools, so they cannot disagree. No LLM sits in the enforcement path: a blocking validator has to be fast, explainable and free to run.
- **Trust engineering on KVS.** Audit events are separate keys written with `FAIL_IF_EXISTS`, so history cannot be rewritten through the app. Record updates run under a per-work-item lock (a `FAIL_IF_EXISTS` key with a TTL) so concurrent saves do not overwrite each other. Evidence is deleted with its work item.
- **Permissions are checked server-side** in every resolver and action, and the panel always takes the work item from Jira's context, never from the request.
- **Rovo agent** (`rovo:agent`, seven `action` modules) and **`rovo:mcp`** exposing the read-only check and rule tools plus a rate-limited approval request to external coding agents.

### What has actually been measured

- **85 automated tests pass** (`npm test`), covering the engine, the matcher corpus and end-to-end flows with Jira and storage faked.
- **A regression corpus of about 245 realistic work items**, so the matcher cannot quietly get worse.
- **Three blind tests**, with titles written by a reviewer who had not seen the rules: **68%, 63% and 70%** of privacy work items caught, with **at most 1 false alarm in 40**. Each round's misses were then fixed. Keywords will always miss some wording, which is why there is also a Yes / No / Unsure declaration step.
- **Verified on a real Jira site**, not only in tests: the build gate refused the first move and named the approver, the answer-approve-move sequence worked, the Done gate asked for the privacy notice, rewording stayed blocked, the Rovo agent drafted an answer, the audit log recorded it as coming via Rovo, and the sign-off released the work item. The demo film is screen recordings of those runs.
- **Public sources behind the rule packs:** the text of POPIA itself and the Information Regulator's own published enforcement and infringement notices. Each rule lists the sections it draws on.

There are no usage numbers, because nobody is running Preflight in production yet. Everything above is a measurement of the code and of my own test site.

## Known limits

- **It is not a vulnerability scanner.** It would not have caught FNB's app flaw. It governs the decision to collect, keep and share personal data, not the implementation that then leaks it. Those are different failures, and Preflight only addresses the first.
- **It does not read your code or your database.** It reads the work item's words and the answers people give. Someone determined to ship a quiet change without a ticket is outside its reach.
- **Keyword matching misses wording.** Blind-test recall was 63-70%, not 100%. The declaration step exists because of that gap, not as a nice extra.
- **The starter packs are not a legal assessment.** They are a seven-rule starting point for an Information Officer or DPO to adapt. Preflight never says work is "compliant", and it is not legal advice.
- **Company-managed projects are what I verified.** The validators are declared for team-managed projects too, but I have not tested that path.
- **Attaching the gates is a manual step** in the workflow editor, because Forge has no API to do it. The coverage check exists to show where they are missing, which is a workaround, not a fix.
- **The agent's conversational quality is not guaranteed.** Its drafts are a starting point and a person has to confirm each one in the panel before it counts.
- **Several modules I depend on are in Preview** (workflow validators, `rovo:mcp`), so they may change.

## Challenges

- **Making a gate people will not hate.** My first matcher blocked "Promo code bug" and "race condition" and missed "ID numbers" because of the plural. I rebuilt it with stemming, context triggers ("GPS" only counts alongside "track" or "driver") and excludes for Jira idioms, then tested it on titles it had never seen.
- **Putting the gate in the right place.** Blocking Done is too late; the code has shipped. The review belongs before build, with only proof-of-delivery checked at Done.
- **Deciding where AI belongs.** Letting an LLM rule on whether a work item is "POPIA compliant" would be slow, unexplainable and legally dangerous. So the agent has no approving tool at all.
- **Governing the governors.** A privacy control is only as strong as whoever can switch it off. Three independent reviews of the code attacked it and found ways for an admin to weaken a rule without the approver noticing, to override someone else's declaration in two steps, and for an approval to survive a rule change. Each is fixed and has a test.
- **Getting the law right.** I kept the distinctions POPIA makes: an ID number is ordinary personal information under s1, not special personal information under s26.
- Jira refuses an app's work-item creation unless the space's permission scheme grants the hidden `atlassian-addons-project-access` role, so "Load demo" now names the permission to fix instead of failing with a bare 403.

## What I learned

- How Forge validators, triggers, entity properties, KVS key policies and TTLs, Rovo actions and `rovo:mcp` fit together into one product.
- That in a compliance tool, trust features matter more than clever AI: stale approvals, sticky matches, a write-once audit log, and limiting what the agent *can* do rather than telling it what it *shouldn't*.
- That a feature I had written but never run was the weakest thing in the submission. The Rovo rule-drafting path existed in code and in the demo before it had a single test. Writing that test found nothing broken, but until it ran I could not honestly claim it.
- >>> YOUR WORDS <<< One or two lines: what deploying and testing on a real Jira site taught you that the automated tests did not.

## What's next

- JSM support for data-subject access requests (POPIA s23, GDPR Art 15), and packs beyond POPIA and GDPR.
- Watching a Confluence policy page and proposing rule changes when the policy changes.
- Verifying the team-managed project path, which is declared but untested.

---8<---

---

## 4. Built with (tags)

```
forge, atlassian-forge, jira, jira-cloud, rovo, rovo-agents, mcp, forge-ui-kit, forge-kvs, react, javascript, node.js, popia, gdpr, privacy, governance
```

## 5. "Try it out" links

```
https://github.com/lk-nyoka/preflight
https://youtu.be/kvaGZFoxu_Q
```

## 6. Demo video URL

```
https://youtu.be/kvaGZFoxu_Q
```

Check before submitting: the video must be **Public**, not Unlisted, and must be the 2:50 launch cut.

## 7. Installation link (required)

```
https://developer.atlassian.com/console/install/e9581f7b-84df-42b6-a25d-0cfb7c31f886?signature=AYABeM%2BMkkX%2FCaON50xGitY%2BkicAAAADAAdhd3Mta21zAEthcm46YXdzOmttczp1cy13ZXN0LTI6NzA5NTg3ODM1MjQzOmtleS83MDVlZDY3MC1mNTdjLTQxYjUtOWY5Yi1lM2YyZGNjMTQ2ZTcAuAECAQB4CxqLTo9l4lqXuFjNim1xJM%2Bp%2F3TVP9xHS2BrU5DRRucBCMZ%2BovKO5SgebI9IJqb9yAAAAH4wfAYJKoZIhvcNAQcGoG8wbQIBADBoBgkqhkiG9w0BBwEwHgYJYIZIAWUDBAEuMBEEDAm2%2F3NEvqkd3jfdbwIBEIA7Fqe2o8YBa4y%2F5ddq%2Fbd2ehoZ8IsNk%2FMYu%2Bm9n1RJYjYNM0hri1Vcex1kd9pWfpZcyfzpz8%2BIGFIP%2BXwAB2F3cy1rbXMAS2Fybjphd3M6a21zOmV1LXdlc3QtMTo3MDk1ODc4MzUyNDM6a2V5LzQ2MzBjZTZiLTAwYzMtNGRlMi04NzdiLTYyN2UyMDYwZTVjYwC4AQICAHi9bVMAkme4qVQX1fQHo6ePw3H40A7cGfz7yrmSfBWMXgHtoMIT%2Bqm1cwVEJ47KXnC2AAAAfjB8BgkqhkiG9w0BBwagbzBtAgEAMGgGCSqGSIb3DQEHATAeBglghkgBZQMEAS4wEQQMuTY1uxKJzX0GN1MNAgEQgDvwI8L2YftJO9zEoFQgo2EJ%2F2Cv9NNNqKrhHyww3yFsWdyTveBozBrrFycFkn48y%2Fu0ZDtXc81s70iYlQAHYXdzLWttcwBLYXJuOmF3czprbXM6dXMtZWFzdC0xOjcwOTU4NzgzNTI0MzprZXkvNmMxMjBiYTAtNGNkNS00OTg1LWI4MmUtNDBhMDQ5NTJjYzU3ALgBAgIAeDYASx0XCjkny4iLV6vz%2BKtEGSGT6kdt0QRpkn6D%2FlVEAdrxsdza%2FxyQmMBQ83VlHB0AAAB%2BMHwGCSqGSIb3DQEHBqBvMG0CAQAwaAYJKoZIhvcNAQcBMB4GCWCGSAFlAwQBLjARBAx9azf6cQ2rEWdjBmgCARCAO%2F3%2FlvJ8EpTZTZpPG7KiOeGNAzlWZrB8N9oBkV1IGvXwI1L%2FIGYo9kb4feOwO2MVZ0C4HquIOlGAeJwoAgAAAAAMAAAQAAAAAAAAAAAAAAAAAKnpoG31uy3yYMtYAGy6V3D%2F%2F%2F%2F%2FAAAAAQAAAAAAAAAAAAAAAQAAADK%2BVdoXbTEKw74LwjIlNODyu8uKS3PPKR9Tp7ihDMRnpUM5%2B0zHiUuXoh1KMwdgf%2Bs8YquSpsh4XaUppe%2BAQdF4Ddo%3D&product=jira
```

Run `forge deploy -e production` first, then open this link yourself in a private window.
Stage 1 is pass/fail on whether a judge can install from it and see what the video shows.

## 8. App ID (required)

```
ari:cloud:ecosystem::app/e9581f7b-84df-42b6-a25d-0cfb7c31f886
```

## 9. Testing instructions

```
Full guide: https://github.com/lk-nyoka/preflight/blob/main/docs/JUDGES.md

1. Install with the link above on a Jira site where you are a Jira admin.
2. Create a Kanban space and choose Company-managed (team-managed is not verified). Note its key, e.g. PRIV.
   Jira settings → Apps → Preflight → Setup → choose POPIA → enter the key → Load demo.
   This activates the POPIA starter rules and creates 5 sample work items. If it reports a permission
   problem, the message names the role to add under Space settings → Permissions.
3. Attach the gates (one time): Jira settings → Work items → Workflows → edit the space's workflow, add
   "Preflight: privacy review before build" to the transition into In Progress and
   "Preflight: privacy evidence before Done" to the transition into Done. Publish.
   Setup → Check workflow coverage should show both as protected.
4. Open "Add SA ID number field to customer signup" and drag it to In Progress: refused.
5. Click the Preflight (hexagon) icon under the title to open the panel. Answer the 4 questions → Save answers →
   Approve (with no approvers named, a Jira admin can approve) → drag to In Progress: it moves.
6. Drag to Done: refused until "Privacy notice updated (link)" is filled in.
7. Edit an approved answer: the approval goes stale and the gate closes again.
8. Try to talk your way out of it: rename the work item to something harmless, e.g. "Update signup form".
   The gate still holds, because the match sticks once it is recorded. Only an approver can dismiss a rule,
   with a reason, and that goes in the audit log.
9. Apps → Preflight reviews shows the approver's inbox, and Setup → Audit log shows every step above.
10. Optional, on a site with Rovo: Ask Rovo → Agents → Preflight: "Check PRIV-1 and draft an answer for the purpose question".
    Say yes, then click Use draft in the panel. Then ask the agent to approve it: it has no tool that can.
No external services or credentials are needed.
```

## 10. How the project meets the main technology requirement

```
Preflight is built entirely on Atlassian Forge (Node.js runtime, UI Kit, Forge Key-Value Store) and integrates with:

- **Jira**: an issue panel shows the review and collects evidence; two `jira:workflowValidator` modules hold the transitions into In Progress and Done (company-managed and team-managed projects); product triggers re-evaluate work items on create and update and delete evidence on delete; a global page is the approver's inbox; a `jira:entityProperty` makes the status searchable in JQL; an admin page manages rules, testing, demo data, approvers, coverage and the audit log; comments notify approvers; the workflow APIs power the coverage check.
- **Rovo**: a `rovo:agent` named Preflight with seven `action` modules (check a work item, list rules, propose an answer, request approval, flag a missed rule, record a yes/unsure declaration, draft a rule from a policy page). Server-side checks stop it from approving or making a draft count.
- **Rovo MCP** (`rovo:mcp`): exposes the check, list-rules and request-approval actions as MCP tools for external coding agents.
```

## 11. Category

```
Apps for Business Teams
```

## 12. Why this track

```
The Business Teams category explicitly covers legal and compliance work, and privacy review is exactly that. Information Officers and privacy teams (a role POPIA requires every South African organisation to have) need the right information in front of them and a say before work ships. Preflight puts their policy on the ticket, gives them an inbox and the sign-off, and governs who can change the rules. POPIA applies to every industry, so this is a business function rather than one sector, and the engine is regulation-agnostic.
```

## 13. Bonus prize

```
Best Agents - Rovo/Assignable agents
```

## 14. Experience building with Forge

```
**What worked well:** UI Kit let me build three full interfaces without a frontend build. Workflow validators are what make Preflight a gate rather than a dashboard. KVS key policies were a pleasant surprise: `FAIL_IF_EXISTS` gave me both a write-once audit log and a lock with a TTL. Rovo actions were straightforward to define, and reusing them as MCP tools through `rovo:mcp` was almost free.

**What I struggled with:** Workflow rules default to company-managed projects only, and attaching a validator is still a manual step in the workflow editor, so I built a coverage check to show where the gates are missing. Several modules I rely on (workflow validators, `rovo:mcp`) are in Preview. `forge lint` needs a logged-in account, which made validating in a fresh environment harder. On a real site the build gate refused the first move with the approver's name in the message, exactly as designed, and let it through once the answers were approved.

**What I'd improve:** An API to attach an app's validator to a workflow programmatically (one-click onboarding), a local emulator for validators and triggers, and clearer documentation of the context a Rovo action receives (issue key, principal).
```

## 15. AI tools used

```
Claude (Anthropic) for planning, research on Forge modules and POPIA sections, writing code and tests, independent review of the code, and drafting documentation, and producing the demo film (animation code, generated music and sound effects, and a synthetic narration voice from the open-source Piper model).
```

Add any others you used (Kiro, Copilot, Antigravity, Codex) before you paste.

## 16. How much did this hackathon help you develop new skills?

```
>>> YOUR WORDS <<<   (suggested: A lot)
```

## 17. How likely are you to use Forge / Atlassian products again?

```
>>> YOUR WORDS <<<
```

---

## 18. Image gallery

JPG/PNG/GIF, 5 MB max each, 3:2 works best, up to 15 images.
All of these are in `submission/gallery/`, already 3:2 and well under 5 MB.

Thumbnail first:

| File | Use |
|---|---|
| `00-thumbnail-devpost-3x2.jpg` | Thumbnail (1500 x 1000) |

Then the gallery, in this order (1800 x 1200 each):

| # | File | What it shows |
|---|---|---|
| 1 | `01-refused.jpg` | The move to In Progress refused, approver named - real recording |
| 2 | `02-whats-missing.jpg` | The panel listing what the review still needs |
| 3 | `03-rovo-draft.jpg` | The Rovo agent drafting an answer - real recording |
| 4 | `04-principle.jpg` | AI can help, it can't approve |
| 5 | `05-inbox.jpg` | The Information Officer's inbox - real recording |
| 6 | `06-signed-off.jpg` | Signed off, and the work item moves - real recording |
| 7 | `07-scanner.jpg` | The engine showing which phrase matched |
| 8 | `08-no-sneaking.jpg` | Bypass detection: going round the gate is reported |
| 9 | `09-checklist.jpg` | The write-once audit history |

Each image is tagged "REAL RECORDING" or "ILLUSTRATION" in its corner, so nothing claims
to be live screen capture when it isn't.

`youtube-thumbnail-16x9.jpg` (1280 x 720) is for YouTube, not Devpost.

---

## Before you hit submit

1. `forge deploy` then `forge deploy -e production` from this folder.
2. Open the installation link in a private window, install on a clean site, and walk
   steps 4 to 8 of the testing instructions. This is the Stage 1 pass/fail check.
3. Set the YouTube video to **Public** and confirm it is the 2:50 cut.
4. Paste every field above and fill the three `>>> YOUR WORDS <<<` fields.
5. Upload `00-thumbnail-devpost-3x2.jpg` as the thumbnail, then the nine gallery images.
6. One live run worth doing, because the film shows it: ask the Rovo agent on the demo
   site to draft a rule from a pasted policy paragraph, check it appears as a draft on
   the admin page, and check it enforces nothing until an approver activates it. The
   code path has a test (`test/exploits.test.js`), but you have not watched it happen.

## What changed in this version, and why

Applied against the hackathon-winner lessons:

- **Start from a person.** Inspiration now opens on the 88 home-loan applicants whose ID
  and account numbers were exposed, with the R1 million FNB fine and the R500,000 college
  fine stated correctly: the bank's was for inadequate safeguards and weak retention
  governance, the college's for failing to act on an enforcement notice. The earlier draft
  said both were for sharing data without a lawful reason. That was wrong.
- **Measured numbers first, estimates labelled.** A "What has actually been measured"
  section: 85 tests, a 245-item corpus, blind-test recall of 68/63/70% with at most 1 false
  alarm in 40, and what was verified on a real site. It states plainly that there are no
  usage numbers because nobody runs it in production.
- **Known limits.** A new section saying what it does not do, starting with the admission
  that it would not have caught the FNB flaw.
- **Show it saying no.** A new "What it refuses" section, eight refusals, each with a test.
- **Safety in one sentence.** "The agent cannot approve. Not because it is told not to:
  because there is no tool in its manifest that approves."
- **Only claim what has run.** The Rovo rule-drafting path had no test. It has one now,
  proving the policy -> draft -> approver -> gate loop and that the agent cannot enforce
  its own rule. The "What I learned" section says this out loud.
- **Deep, not wide.** "What it does" now leads with the single loop and groups the rest,
  instead of thirteen equal-weight feature bullets.
