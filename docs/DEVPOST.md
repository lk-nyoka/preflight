# Devpost submission draft: Codegeist 2026

Fields in `[[double brackets]]` need your real values after you deploy. Edit anything that doesn't sound like you.

---

## Project name (60 max)

Preflight: privacy review before build, in Jira

## Elevator pitch (200 max)

Preflight puts your privacy policy in front of the work: Jira holds a ticket that changes personal data until the review is answered and your Information Officer signs off, before a line is built.

---

## About the project (Markdown)

```markdown
## Inspiration

In South Africa every organisation that handles personal information falls under POPIA and has to appoint an Information Officer. In practice the privacy policy lives in a PDF or a Confluence page, and the work that changes how personal data is collected, stored or shared lives in Jira. Nothing connects the two. A ticket like "add the customer's ID number to signup" can be built, reviewed and shipped without anyone asking why the ID number is needed, how long it is kept, or whether the Information Officer has seen it.

The cost of that gap is now real. In October 2026 South Africa's Information Regulator announced a R1 million fine for a major bank and a R500,000 fine for a college that shared personal information without a lawful reason. When a complaint arrives, the first question is always "who approved this?", and if the decision was made in a Jira ticket nobody can answer it.

Existing tools don't close that gap. Privacy scanners find personal data *after* it is already in Jira. Checklist apps can block Done, but only if someone remembered to add the right checklist, and by the time a ticket is closed the field has already shipped. I wanted the policy to show up at the moment it matters: when someone starts building.

## What it does

Preflight is a Forge app for Jira that turns an organisation's privacy review into two gates.

- **Review before build.** When a work item proposes a change to how personal information is collected, used, stored or shared, moving it to *In Progress* is refused until the team answers the review questions your policy requires (purpose, why less data won't do, lawful basis, retention) and a **named approver** signs off.
- **Evidence before Done.** Moving it to *Done* is refused until the ship-time evidence is recorded, such as the updated privacy notice.
- **It knows which review applies.** A deterministic, stem-aware rules engine reads the ticket and shows exactly why a rule matched ("mentions 'SA ID number'"). Rewording the ticket doesn't make a review disappear; only an approver can dismiss a rule, with a reason.
- **The panel says what to do next and who approves.** Questions are grouped *before work starts* and *before Done*.
- **An inbox for the Information Officer.** *Preflight reviews* lists everything waiting for approval and everything waiting on the team.
- **Rovo helps, humans decide.** The Preflight agent explains the gaps and drafts answers with the developer, but a draft only counts after the person confirms it in the panel. The agent can never approve, dismiss, grant exceptions, activate rules, or declare that a change has no personal data.
- **Rules come from your policy.** Admins ask the agent to turn a Confluence policy page into **draft** rules, with example tickets that must and must not match. Nothing is enforced until it is activated.
- **Answers have to be real.** "TBD", "not sure" and keyboard filler are rejected, and a retention answer has to say when the data goes.
- **Governance built in.** Once approvers are named, a Jira admin can't approve, can't add themselves as approver, and changes to active rules become proposals. The approver sees every changed field, with anything that weakens the rule flagged first and the rule's examples re-run against the new version. Weakening a setting needs an approver, a break-glass reset needs a second admin and 72 hours, and bulk actions can't switch enforcement off.
- **Bypasses are caught.** Work that reaches In Progress or Done another way (moved from another project, changed type, a workflow without the gate) is flagged to the approvers in a comment and in the inbox.
- **A write-once audit history** of every answer, approval, rule change, setting change and bypass, plus a coverage check that lists workflow transitions without a gate.

It ships with an editable starter pack inspired by POPIA themes (identifying numbers, contact details and location, special personal information, children, electronic direct marketing, cross-border transfers, bulk exports). It is not a complete POPIA assessment. The engine is regulation-agnostic, so the same pattern works for GDPR or HIPAA.

Preflight enforces your organisation's own review process. It never says work is "compliant" and it is not legal advice.

## How I built it

- **Forge** with UI Kit for the issue panel, the admin page and a global *Preflight reviews* page; two `jira:workflowValidator` modules (enabled for company-managed and team-managed projects); product triggers for create, update and delete; a `jira:entityProperty` for JQL; and the Forge Key-Value Store.
- **One deterministic engine** (`src/engine/evaluate.js`) powers both gates, the panel, the Rovo actions and the MCP tools, so they can never disagree. No LLM sits in the enforcement path: a blocking validator has to be fast, explainable and free to run.
- **Matching that respects Jira, measured honestly.** Stem-aware phrases, context triggers ("GPS" only counts with "track" or "driver"), excludes for Jira idioms ("race condition", "child issue", "health check endpoint"), per-rule examples checked on every save, and a regression corpus of about 245 realistic tickets. Three blind tests (titles written by a reviewer who hadn't seen the rules) caught 68%, 63% and 70% of privacy tickets with at most 1 false alarm in 40; each round's misses were fixed. Keywords will always miss some wording, which is why there is also a Yes / No / Unsure declaration step.
- **Rovo agent** (`rovo:agent` with seven `action` modules) and **`rovo:mcp`** exposing the read-only check and rule tools plus a rate-limited approval request to coding agents.
- **Trust engineering on KVS.** Audit events are separate keys written with `FAIL_IF_EXISTS`, so history can't be rewritten through the app. Record updates run under a per-ticket lock (a `FAIL_IF_EXISTS` key with a TTL) so concurrent saves don't overwrite each other. Approvals carry a fingerprint of the answers they approved and go stale if those answers or the rule change. Evidence is deleted with its ticket.
- **Permissions are checked server-side** in every resolver and action. The panel always takes the issue from Jira's context, never from the request.
- **63 automated tests** cover the engine, the matcher corpus and end-to-end flows with Jira and storage faked, plus one regression test for each hole found by two independent security reviews of the code (for example: an admin hiding a weakened rule from the approver, overriding someone else's "Yes" in two steps, or an approval surviving a rule change).

## Challenges

- **Making a gate people won't hate.** My first matcher blocked "Promo code bug" and "race condition" tickets and missed "ID numbers" because of the plural. I rebuilt it with stemming, context triggers and excludes, then tested it on tickets it had never seen. It now ships with a regression corpus so it can't quietly get worse.
- **Putting the gate in the right place.** Blocking *Done* is too late: the code has shipped. The real value is a review before build, with only proof-of-delivery checked at Done.
- **Deciding where AI belongs.** It would be easy to let an LLM decide whether a ticket is "POPIA compliant". That would be slow, unexplainable and legally dangerous. AI drafts and explains; deterministic rules and humans decide.
- **Governing the governors.** A privacy control is only as strong as whoever can switch it off. I had two independent reviews attack the code; they found ways for an admin to weaken a rule without the approver noticing and for a user to undo someone else's declaration. Each is now fixed and has a regression test.
- **Getting the law right.** Each rule lists the POPIA sections it draws on, and I kept the distinctions the Act makes: an ID number is ordinary personal information (s1), not special personal information under s26. It is still a starter pack for an Information Officer to adapt, not legal advice.
- [[Add anything that went wrong while deploying or testing on your site.]]

## What I learned

- How Forge validators, triggers, entity properties, KVS key policies and TTLs, Rovo actions and `rovo:mcp` fit together into one product.
- That trust features (stale approvals, sticky matches, write-once audit, governance) matter more in a compliance tool than clever AI.
- [[Add one or two things you learned building it.]]

## What's next

- JSM support for data-subject access requests (POPIA s23) and a GDPR rule pack.
- Reading policy pages from Confluence directly into rule proposals.
- A Marketplace listing for South African teams.
```

---

## Built with (tags)

forge, atlassian-forge, jira, jira-cloud, rovo, rovo-agents, mcp, forge-ui-kit, forge-kvs, react, javascript, node.js, popia, privacy, governance

## "Try it out" links

- GitHub: https://github.com/lk-nyoka/preflight
- [[Optional: demo video link]]

## Demo video URL

[[YouTube link. Follow docs/DEMO_SCRIPT.md: the blocked "In Progress" move happens by 0:30 and the whole story ends by 3:00.]]

## Installation link

[[From Developer Console → your app → Distribution → Start sharing (after `forge deploy -e production`).]]

## Testing instructions

```
Full guide: https://github.com/lk-nyoka/preflight/blob/main/docs/JUDGES.md

1. Install with the link above on a Jira site where you are a Jira admin.
2. Jira settings → Apps → Preflight → Setup → enter any project key → Load demo.
   This activates the POPIA starter rules and creates 5 sample work items.
3. Attach the gates (one time): in the project's workflow, add
   "Preflight: privacy review before build" to the transition into In Progress and
   "Preflight: privacy evidence before Done" to the transition into Done. Publish.
   Setup → Check workflow coverage should show both as protected.
4. Open "Add SA ID number field to customer signup" and drag it to In Progress: refused.
5. Answer the 4 questions → Save → Approve (Jira admins approve in small-team mode) → In Progress works.
6. Drag to Done: refused until "Privacy notice updated (link)" is filled in.
7. Edit an approved answer: the approval goes stale and the gate closes again.
8. Apps → Preflight reviews shows the approver's inbox.
9. Optional: Rovo → Preflight agent: "What do I need before I can start this?"
No external services or credentials are needed.
```

## App ID

[[ari:cloud:ecosystem::app/... from manifest.yml after `forge register`]]

## How the project meets the main technology requirement

Preflight is built entirely on Atlassian Forge (Node.js runtime, UI Kit, Forge Key-Value Store) and integrates with:

- **Jira**: an issue panel shows the review and collects evidence; two `jira:workflowValidator` modules hold the transitions into In Progress and Done (company-managed and team-managed projects); product triggers re-evaluate work items on create and update and delete evidence on delete; a global page is the approver's inbox; a `jira:entityProperty` makes the status searchable in JQL; an admin page manages rules, testing, demo data, approvers, coverage and the audit log; comments notify approvers; the workflow APIs power the coverage check.
- **Rovo**: a `rovo:agent` named Preflight with seven `action` modules (check a work item, list rules, propose an answer, request approval, flag a missed rule, record a yes/unsure declaration, draft a rule from a policy page). Server-side checks stop it from approving or making a draft count.
- **Rovo MCP** (`rovo:mcp`): exposes the check, list-rules and request-approval actions as MCP tools for external coding agents.

## Category

Apps for Business Teams   [[decide: Business Teams (recommended) or Specialized Industries]]

## Why this track

The Business Teams category explicitly covers legal and compliance work, and privacy review is exactly that. Information Officers and privacy teams (a role POPIA requires every South African organisation to have) need the right information in front of them and a say before work ships. Preflight puts their policy on the ticket, gives them an inbox and the sign-off, and governs who can change the rules. POPIA applies to every industry, so this is a business function rather than one sector, and the engine is regulation-agnostic.

## Bonus prize

Best Agents - Rovo/Assignable agents

(The app also exposes an MCP server via `rovo:mcp`, but a submission can win only one bonus, and the agent, which drafts answers a human confirms and turns policy pages into draft rules, is the more complete story.)

## Experience building with Forge

**What worked well:** UI Kit let me build three full interfaces without a frontend build. Workflow validators are what make Preflight a gate rather than a dashboard. KVS key policies were a pleasant surprise: `FAIL_IF_EXISTS` gave me both a write-once audit log and a lock with a TTL. Rovo actions were straightforward to define, and reusing them as MCP tools through `rovo:mcp` was almost free.

**What I struggled with:** Workflow rules default to company-managed projects only, and attaching a validator is still a manual step in the workflow editor, so I built a coverage check to show where the gates are missing. Several modules I rely on (workflow validators, `rovo:mcp`) are in Preview. `forge lint` needs a logged-in account, which made validating in a fresh environment harder. [[Add anything from your own deploy/install.]]

**What I'd improve:** An API to attach an app's validator to a workflow programmatically (one-click onboarding), a local emulator for validators and triggers, and clearer documentation of the context a Rovo action receives (issue key, principal).

## AI tools used

Claude (Anthropic) for planning, research on Forge modules and POPIA sections, writing code and tests, independent review of the code, and drafting documentation. [[Add any others you used.]]

## How much did this hackathon help you develop new skills?

[[Your answer. Suggested: A lot]]

## How likely are you to use Forge / Atlassian products again?

[[Your answer]]
