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

- **Detects** when a work item proposes a change to how personal information is collected, used, stored or shared, using rules written by the organisation (trigger phrases and labels), and shows *why* it matched: the exact phrase and a snippet (with ID and phone numbers removed).
- **Matches are sticky**: rewording the ticket to remove "ID number" does not open the gate. Only an approver can dismiss a rule, with a reason.
- **Explains** which internal rule applies and which POPIA section inspired it (for example *Identifying numbers, POPIA s1, s10, s11, s13, s14, s18*).
- **Collects evidence** right on the ticket: purpose, why less data won't do, lawful basis, how people are told, retention period, security review link.
- **Blocks the transition to Done** with a workflow validator until the evidence is complete and an approver signs off. The error message names the rule, the clause and what is missing.
- **Keeps approvals honest**: if someone edits an answer after approval, or the rule itself changes, the approval goes stale and the gate closes again.
- **A Rovo agent** explains the gaps, drafts answers with the developer, saves answers they confirm and requests approval. For admins it reads a privacy policy page and proposes **draft** rules. It can never approve, dismiss, grant exceptions or activate a rule.
- **MCP tools** let a coding agent ask "which privacy steps apply to PRIV-12?" before writing a line of code (Preview; an org admin enables external MCP access).
- **An admin page** to review, edit, test and activate rules, a one-click demo loader, and gate status per project (so a workflow without the gate is visible).
- Everything is **audited**, and blocked work is searchable with JQL (`preflightStatus = blocked`).

It ships with an editable starter pack inspired by POPIA themes (identifying numbers, special personal information, children, electronic direct marketing, cross-border transfers and bulk exports). It is not a complete POPIA assessment; the rules are the organisation's own.

Tools that scan for personal information find data already sitting in Jira. Preflight is different: it controls the *changes* that would introduce new ways of collecting, using or sharing personal information, before they ship.

Preflight enforces your review process. It never claims work is "compliant" and it is not legal advice.

## How I built it

- **Forge** with UI Kit for the issue panel and admin page, a `jira:workflowValidator` (enabled for company-managed and team-managed projects), product triggers, a `jira:entityProperty` for JQL, and the Forge Key-Value Store.
- **A deterministic rules engine** (`src/engine/evaluate.js`) is the single source of truth. The panel, the validator, the Rovo actions and the MCP tools all call the same pure function, so they can never disagree about whether a ticket is blocked.
- **No LLM in the gate.** A blocking validator has to be fast and explainable, so it re-evaluates rules on the live ticket text and stored matches instead of asking a model. AI is used where it helps people: in the **Rovo agent** (`rovo:agent` plus six `action` modules), which drafts and saves answers the user confirms.
- **`rovo:mcp`** exposes the check, list-rules and request-approval actions as MCP tools.
- **Evidence and approvals live in app storage**, not in Jira issue properties, because issue properties can be edited by anyone with edit permission through the REST API. The issue property is only a mirror for search.
- **Permissions are checked server-side** in every resolver. Once an organisation names approvers, only they can approve; a Jira admin is not automatically the Information Officer. With none named, Preflight runs in a labelled small-team mode where Jira admins approve. Optional separation of duties stops reporters approving their own work.
- **Fails closed by default**: if Preflight cannot evaluate a work item, the transition is held with a clear message (switchable to fail-open).
- **Authoring with AI, enforcing without it**: the Rovo agent can turn a Confluence policy page into *draft* rules, but drafts are never enforced until an admin reviews and activates them.
- 21 automated tests cover the engine and end-to-end flows with Jira and storage faked: blocking, approval, stale approval, sticky matches, approver roles, exception expiry, approval-request rate limiting, fail-closed and draft-only rule authoring.

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
   Validators/Rules → add "Preflight privacy review gate" → publish.
4. Open "Add SA ID number field to customer signup". The Preflight panel shows Blocked.
   Try moving it to Done: the transition is refused.
5. Fill the answers → Save answers → Approve (Jira admins approve in small-team mode) → move to Done: it now succeeds.
6. Edit the retention answer: the approval goes stale and the gate closes again.
6b. Rewording a ticket to remove the trigger phrase does not reopen the gate.
7. Optional: Rovo → Preflight agent on a demo work item: "Preflight this work item".
8. Optional: JQL  preflightStatus = blocked
No external services or credentials are needed.
```

## App ID

[[ari:cloud:ecosystem::app/... from manifest.yml after `forge register`]]

## How the project meets the main technology requirement

Preflight is built entirely on Atlassian Forge (Node.js runtime, UI Kit, Forge Key-Value Store) and integrates with:

- **Jira**: an issue panel shows the privacy check and collects evidence; a `jira:workflowValidator` blocks the transition to Done until requirements are met (company-managed and team-managed projects); product triggers re-evaluate work items on create and update; a `jira:entityProperty` makes `preflightStatus` searchable in JQL; an admin page manages rules, testing, demo data and approvers; comments notify approvers.
- **Rovo**: a `rovo:agent` named Preflight with six `action` modules (check a work item, list rules, save a confirmed answer, request approval, flag a missed rule, draft a rule from a policy page). The agent explains gaps and drafts answers, and server-side checks stop it from approving.
- **Rovo MCP** (`rovo:mcp`): exposes the check, list-rules and request-approval actions as MCP tools for external coding agents.

## Category

Apps for Business Teams   [[decide: Business Teams (recommended) or Specialized Industries]]

## Why this track

The Business Teams category explicitly covers legal and compliance work, and privacy review is exactly that: Information Officers and privacy teams, a role POPIA requires every South African organisation to have, need the right information in front of them and a say before work ships. Preflight puts their policy on the ticket and gives them the sign-off. POPIA applies to every industry, so it is a business function rather than one sector, and the engine is regulation-agnostic (GDPR, HIPAA and PCI DSS rule packs are the next step).

*(Alternative if you choose Specialized Industries: "Privacy and data protection is a regulated, specialist field. Preflight turns an Information Officer's expert knowledge into rules that enforce themselves in the delivery workflow.")*

## Bonus prize

Best Agents - Rovo/Assignable agents

(The app also exposes an MCP server via `rovo:mcp`, but a submission can win only one bonus, and the Rovo agent is the more complete story.)

## Experience building with Forge

**What worked well:** UI Kit let me build two full interfaces without managing a frontend build. The workflow validator module is a powerful extension point: being able to stop a transition with a custom message is what makes Preflight a gate rather than a dashboard. Rovo actions were straightforward to define in the manifest, and reusing the same actions as MCP tools through `rovo:mcp` was almost free. The Key-Value Store was all the storage I needed.

**What I struggled with:** Workflow rules default to company-managed projects only, and attaching a validator is still a manual workflow-editor step, so a judge or customer has to configure it by hand. Preflight records a heartbeat when its validator runs so at least the panel can warn when a project isn't protected yet. Some modules I relied on (workflow validator, `rovo:mcp`) are in Preview, which made me check the docs carefully. `forge lint` needs a logged-in account, which made validating in a fresh environment harder. [[Add anything from your own deploy/install.]]

**What I'd improve:** An API to attach an app's validator to a workflow programmatically (so onboarding is one click), a local emulator for product triggers and validators, and clearer guidance on what context a Rovo action receives (issue key, principal).

## AI tools used

Claude (Anthropic) for planning, research on Forge modules and POPIA sections, writing code and tests, and drafting documentation. [[Add any others you used, e.g. Codex, Gemini/Antigravity, Cursor.]]

## How much did this hackathon help you develop new skills?

[[Your answer. Suggested: A lot]]

## How likely are you to use Forge / Atlassian products again?

[[Your answer]]
