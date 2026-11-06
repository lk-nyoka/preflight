# Devpost submission draft: Codegeist 2026

Fields in `[[double brackets]]` need your real values after you deploy. Edit anything that doesn't sound like you.

---

## Project name (60 max)

Preflight: privacy evidence gate for Jira

## Elevator pitch (200 max)

Preflight turns your privacy policy into an enforceable check in Jira: work that touches personal data can't close until the required evidence and an approver's sign-off are recorded.

---

## About the project (Markdown)

```markdown
## Inspiration

In South Africa every organisation that handles personal information falls under POPIA, and every one of them has to appoint an Information Officer. In practice the privacy policy lives in a PDF or a Confluence page, and the work that actually changes how personal data is collected, stored or shared lives in Jira. Nothing connects the two. A ticket like "add the customer's ID number to signup" can be built, reviewed and shipped without anyone asking why the ID number is needed, how long it is kept, or whether the Information Officer has seen it.

I wanted the policy to show up at the exact moment it matters, on the ticket, and to have teeth: the work should not be able to close until the review has happened.

## What it does

Preflight is a Forge app for Jira that turns an organisation's privacy rules into a pre-flight check for work items.

- **Detects** when a work item touches personal information, using rules written by the organisation (trigger phrases and labels), and shows *why* it matched: the exact phrase and a snippet.
- **Explains** which internal rule applies and which POPIA section motivates it (for example *Identifying numbers, POPIA s1, s10, s13, s14*).
- **Collects evidence** right on the ticket: purpose, why less data won't do, retention period, lawful basis, security review link.
- **Blocks the transition to Done** with a workflow validator until the evidence is complete and an approver signs off. The error message names the rule, the clause and what is missing.
- **Keeps approvals honest**: if someone edits an answer after approval, or the rule itself changes, the approval goes stale and the gate closes again.
- **A Rovo agent** explains the gaps, drafts answers with the developer, saves confirmed answers and requests approval. It can never approve.
- **MCP tools** let a coding agent ask "which privacy steps apply to PRIV-12?" before writing a line of code.
- **An admin page** to review, edit, test and activate rules, plus a one-click demo loader.
- Everything is **audited**, and blocked work is searchable with JQL (`preflightStatus = blocked`).

It ships with a POPIA starter rule pack (identifying numbers, special personal information, children, electronic direct marketing, cross-border transfers and bulk exports), but the rules are the organisation's own and fully editable.

Preflight enforces your review process. It never claims work is "compliant" and it is not legal advice.

## How I built it

- **Forge** with UI Kit for the issue panel and admin page, a `jira:workflowValidator` (enabled for company-managed and team-managed projects), product triggers, a `jira:entityProperty` for JQL, and the Forge Key-Value Store.
- **A deterministic rules engine** (`src/engine/evaluate.js`) is the single source of truth. The panel, the validator, the Rovo actions and the MCP tools all call the same pure function, so they can never disagree about whether a ticket is blocked.
- **No LLM in the gate.** A blocking validator has to be fast and explainable, so it re-evaluates rules on the live ticket text instead of asking a model. AI is used where it helps people: in the **Rovo agent** (`rovo:agent` plus five `action` modules), which drafts and saves answers the user confirms.
- **`rovo:mcp`** exposes the check, list-rules and request-approval actions as MCP tools.
- **Evidence and approvals live in app storage**, not in Jira issue properties, because issue properties can be edited by anyone with edit permission through the REST API. The issue property is only a mirror for search.
- **Permissions are checked server-side** in every resolver: approvers are configured users or Jira admins; admin resolvers re-check the admin permission even though Jira only shows the page to admins.
- 13 automated tests cover the engine and an end-to-end flow (blocked → answers → approval → clear → edit → blocked again) with Jira and storage faked.

## Challenges

- **Making a gate people won't hate.** A blocker that fires on "race condition" or "child issue" would be uninstalled in a day, so trigger phrases match whole words and the starter pack deliberately avoids words like *child* and *minor* that mean something else in Jira. Approvers can dismiss a false positive with a reason, and anyone can flag a rule that was missed.
- **Deciding where AI belongs.** It would have been easy to let an LLM decide whether a ticket is "POPIA compliant". That would be slow, unexplainable and legally dangerous. Keeping the decision deterministic and the AI assistive made the product more trustworthy.
- **Getting the law right.** I checked every section reference in the starter pack against the Act. For example, an ID number is ordinary personal information (it is in the s1 definition), not special personal information under s26.
- [[Add anything that went wrong while deploying or testing on your site.]]

## What I learned

- How Forge's workflow validators, triggers, entity properties, Rovo actions and `rovo:mcp` fit together into one product.
- That trust features (stale approvals, audit trails, separation of duties, fail-open vs fail-closed) matter more for a compliance tool than clever AI.
- [[Add one or two things you learned building it.]]

## What's next

- Rules authored directly from Confluence policy pages, with an Information Officer approval step before activation.
- More rule packs (GDPR, HIPAA, PCI DSS) and JSM support for data-subject access requests (POPIA s23).
- A Marketplace listing, so South African teams can install it in minutes.
```

---

## Built with (tags)

forge, atlassian-forge, jira, jira-cloud, rovo, rovo-agents, mcp, forge-ui-kit, react, javascript, node.js, forge-kvs, popia, privacy

## "Try it out" links

- GitHub: https://github.com/lk-nyoka/preflight
- [[Optional: link to the demo video]]

## Demo video URL

[[YouTube link. Under 5 minutes, but put the blocked-transition moment in the first 90 seconds. Judges don't have to watch past 3 minutes.]]

## Installation link

[[From Developer Console → your app → Distribution → Start sharing (after `forge deploy -e production`).]]

## Testing instructions

```
Full guide: https://github.com/lk-nyoka/preflight/blob/main/docs/JUDGES.md

1. Install with the link above on a Jira site where you are a Jira admin.
2. Jira settings → Apps → Preflight → Demo setup → enter any project key → Load demo.
   This activates the POPIA starter pack and creates 5 sample work items.
3. Attach the gate (one time): open the project's workflow → transition into Done →
   Validators/Rules → add "Preflight privacy evidence gate" → publish.
4. Open "Add SA ID number field to customer signup". The Preflight panel shows Blocked.
   Try moving it to Done: the transition is refused.
5. Fill the three answers → Save answers → Approve → move to Done: it now succeeds.
6. Edit the retention answer: the approval goes stale and the gate closes again.
7. Optional: Rovo → Preflight agent on a demo work item: "Preflight this work item".
8. Optional: JQL  preflightStatus = blocked
No external services or credentials are needed.
```

## App ID

[[ari:cloud:ecosystem::app/... from manifest.yml after `forge register`]]

## How the project meets the main technology requirement

Preflight is built entirely on Atlassian Forge (Node.js runtime, UI Kit, Forge Key-Value Store) and integrates with:

- **Jira**: an issue panel shows the privacy check and collects evidence; a `jira:workflowValidator` blocks the transition to Done until requirements are met (company-managed and team-managed projects); product triggers re-evaluate work items on create and update; a `jira:entityProperty` makes `preflightStatus` searchable in JQL; an admin page manages rules, testing, demo data and approvers; comments notify approvers.
- **Rovo**: a `rovo:agent` named Preflight with five `action` modules (check a work item, list rules, save a confirmed answer, request approval, flag a missed rule). The agent explains gaps and drafts answers, and server-side checks stop it from approving.
- **Rovo MCP** (`rovo:mcp`): exposes the check, list-rules and request-approval actions as MCP tools for external coding agents.

## Category

Apps for Specialized Industries

## Why this track

Privacy and data protection is a regulated, specialised field. Preflight is built for Information Officers and privacy teams, a role POPIA requires every South African organisation to have, and for the engineers whose work they need to review. It turns expert knowledge (which sections of POPIA apply to which kinds of change, and what evidence each needs) into a rule pack that enforces itself inside the delivery workflow. The engine is regulation-agnostic, so the same approach extends to finance (PCI DSS), healthcare (HIPAA) and the EU (GDPR).

## Bonus prize

Best Agents - Rovo/Assignable agents

(The app also exposes an MCP server via `rovo:mcp`, but a submission can win only one bonus, and the Rovo agent is the more complete story.)

## Experience building with Forge

**What worked well:** UI Kit let me build two full interfaces without managing a frontend build. The workflow validator module is a powerful extension point: being able to stop a transition with a custom message is what makes Preflight a gate rather than a dashboard. Rovo actions were straightforward to define in the manifest, and reusing the same actions as MCP tools through `rovo:mcp` was almost free. The Key-Value Store was all the storage I needed.

**What I struggled with:** Workflow rules default to company-managed projects only, and attaching a validator is still a manual workflow-editor step, so a judge or customer has to configure it by hand. Some modules I relied on (workflow validator, `rovo:mcp`) are in Preview, which made me check the docs carefully. `forge lint` needs a logged-in account, which made validating in a fresh environment harder. [[Add anything from your own deploy/install.]]

**What I'd improve:** An API to attach an app's validator to a workflow programmatically (so onboarding is one click), a local emulator for product triggers and validators, and clearer guidance on what context a Rovo action receives (issue key, principal).

## AI tools used

Claude (Anthropic) for planning, research on Forge modules and POPIA sections, writing code and tests, and drafting documentation. [[Add any others you used, e.g. Codex, Gemini/Antigravity, Cursor.]]

## How much did this hackathon help you develop new skills?

[[Your answer. Suggested: A lot]]

## How likely are you to use Forge / Atlassian products again?

[[Your answer]]
