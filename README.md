# Preflight

**Your privacy policy, enforced before build, in Jira.**

When a work item proposes a change to how your organisation collects, uses, stores, shares or retains personal
information, Preflight holds it at two points:

1. **Review before build:** moving it to *In Progress* is refused until the team has answered your privacy review
   questions and a named approver (your Information Officer) has signed off.
2. **Evidence before Done:** moving it to *Done* is refused until the ship-time evidence (for example the updated
   privacy notice) is recorded.

It ships with an editable starter rule pack inspired by selected themes in South Africa's Protection of Personal
Information Act (POPIA). It is not a complete POPIA assessment. Preflight enforces **your organisation's own review
process**; it does not determine legal compliance and is not legal advice.

> Scanners find personal data after it is already in Jira. Checklist apps block Done until someone ticks boxes.
> Preflight decides *which* review a change needs from what the ticket says, puts it **before** the work is built,
> lets only your named approver sign off, and keeps a write-once record of every decision.

Built on Atlassian Forge for Codegeist 2026.

---

## What it does

| Surface | What happens |
|---|---|
| **Issue panel** | "Start work" and "Close" status, a next-step box that says exactly what to do and who approves, each matching rule with its clause and the phrase that triggered it, questions grouped *Before work starts* / *Before Done*, Rovo drafts to confirm or discard, and the audit history. |
| **Two workflow validators** | `Preflight: privacy review before build` (attach to the transition into In Progress) and `Preflight: privacy evidence before Done` (into Done). Both work in company-managed and team-managed projects. |
| **Preflight reviews (global page)** | The approver's inbox: work waiting for approval, work waiting on the team, and proposed rule changes to apply or reject. Filtered to work items the viewer can see. |
| **Rovo agent** | Explains why a rule matched, drafts answers with the developer (saved as **drafts** that a person must confirm), requests approval, records "yes/unsure" declarations, flags missed rules, and for admins turns a privacy policy page into **draft** rules with examples. |
| **MCP tools** | `rovo:mcp` exposes `preflight-check-issue` and `preflight-list-rules` (read-only) and `preflight-request-approval` (rate-limited) so coding agents can check a ticket before writing code.¹ |
| **Admin page** | Setup (demo loader, how to attach the gates, workflow coverage check, gate activity), a structured rule editor with must-match / must-not-match examples, a *Test a rule* sandbox, settings and the admin audit log. |
| **JQL** | `preflightStatus = blocked`, `preflightBuild = blocked`, `preflightAwaitingApproval = yes`, `preflightOpen > 0` (a search projection only; see below). |

¹ `rovo:mcp` is a Forge Preview feature. External MCP clients reach the tools only after an org admin enables external
MCP access for the installation.

## Trust model

**No generative AI in the enforcement path.** Both validators re-run a deterministic rules engine
(`src/engine/evaluate.js`) on the live work item and the stored evidence. Every result is explainable (matched phrase
plus redacted snippet). The same engine powers the panel, Rovo actions and MCP tools, so they can never disagree.

**Matching.** Phrases match whole words, ignore case and plurals ("ID numbers" matches "id number"). Context triggers
make ambiguous words count only alongside a companion word ("promo" only with "SMS/email/WhatsApp"). Global excludes
remove Jira idioms such as "race condition", "child issue", "health check" and "minor version". Every rule carries
must-match and must-not-match examples, checked in tests and every time an admin saves the rule. A regression corpus
(`test/corpus.test.js`) of realistic tickets guards the pack. Keyword matching will still miss things, so the panel
offers *Add a rule*, and the optional declaration step asks "Does this change affect personal information? Yes / No /
Unsure" before work starts.

**Matches are sticky.** Once a rule matches, rewording the ticket does not remove it. Only an approver can dismiss it,
with a reason of at least 10 characters.

**Roles**

| Role | Can |
|---|---|
| Anyone who can see the work item | Answer questions, confirm Rovo drafts, request approval, add a rule, declare Yes / No / Unsure |
| Rovo agent | Explain, propose drafts, request approval, declare *yes* or *unsure*, flag a rule, draft rules (admins). **Never**: approve, dismiss, grant exceptions, activate rules, declare *no*, or make a draft count |
| Named approver | Approve, dismiss with a reason, grant an exception (max 90 days), change the approver list, decide proposed rule changes (not their own) |
| Jira admin | Install and configure. In **small-team mode** (no named approvers) also approves and edits rules directly. Once approvers are named: can only *propose* edits to active rules and changes that weaken a control; cannot approve; cannot add themselves as approver; can reset to small-team mode with an audited reason |

Optional **separation of duties** stops the reporter of a work item approving it.

**When an approval goes stale:** an answer it covered (any *before work starts* answer) changes; the rule's text,
triggers or requirements are edited. Adding *before Done* evidence does not affect approval. Exceptions expire.

**Write-once audit.** Every answer, draft, approval, dismissal, exception, declaration, rule change, setting change and
gate failure is its own key written with `FAIL_IF_EXISTS`; Preflight has no code path that edits or deletes an audit
event. Audit text records who did what to which rule, never the answer values themselves.

**Concurrency.** Record updates run under a per-work-item lock (a `FAIL_IF_EXISTS` key with a 10-second TTL), so two
people saving at once cannot overwrite each other.

**Data minimisation.** E-mail addresses and long digit runs (ID, phone, account numbers) are removed from snippets
shown in the panel, comments, the inbox, Rovo and MCP. Evidence is deleted when its work item is deleted (the audit
history is kept). Preflight sends nothing outside Atlassian. Note that Rovo itself can read the work item it is opened
on; redaction limits what Preflight's actions add, not what Rovo can see.

**Failure behaviour (fail closed by default).** If Preflight cannot evaluate a work item, the transition is held with a
clear message and the failure is audited. Switching to fail-open is a "weakening" change: in named-approver mode only
an approver can make it.

**Evidence is protected from routine tampering.** Evidence, approvals and exceptions live in Preflight's app storage
and are written only through permission-checked server-side functions, not in user-editable issue fields or issue
properties. The indexed `preflight` issue property is a projection for JQL and dashboards; the gates never read it.

**Coverage.** *Check workflow coverage* lists every transition into an In Progress or Done status and whether the
matching gate is attached (using Jira's workflow search and the app's own transition-rule configuration), so a
workflow that can skip the review is visible. The gates also record a heartbeat per project.

---

## Run it yourself

*For people building from the repo. Judges should use the installation link and [`docs/JUDGES.md`](docs/JUDGES.md).*

Requirements: Node.js 22.23.4+ or 24.22.1+ (Forge CLI requirement), an
[Atlassian developer site](https://go.atlassian.com/cloud-dev) (free) with Jira, and Rovo enabled for the agent.

```bash
npm install -g @forge/cli
forge login                 # uses an Atlassian API token
cd preflight
npm install
forge register              # run ONCE: creates your app and writes app.id into manifest.yml
forge deploy
forge install --product jira --site <your-site>.atlassian.net
```

Then: **Jira settings → Apps → Preflight → Setup → Load demo**, attach both gates, and drag *Add SA ID number field to
customer signup* to In Progress.

`npm test` runs 36 tests: the engine, the matcher regression corpus, and end-to-end flows with Jira and storage faked
(two-stage gating, stale approvals, sticky matches, drafts that don't count, governance of approvers and active rules,
write-once audit, locks, exception expiry, rate limiting, fail-closed, deletion, coverage). They do not replace testing
real transitions on a developer site.

Sharing with judges: `forge deploy -e production`, then create an installation link in the
[Developer Console](https://developer.atlassian.com/console/myapps/) (*Distribution → Start sharing*).

**Running costs:** Forge compute and storage stay within the free monthly allowances at hackathon scale; heavy use can
exceed them. Preflight makes no Forge LLM calls. Rovo usage is billed to the customer's Rovo plan.

---

## Project layout

```
manifest.yml               modules, functions, scopes
src/engine/evaluate.js     pure rules engine: stemming, context triggers, stages, approvals, declarations
src/rulepacks/popia.js     POPIA-inspired starter pack (with examples) and demo work items
src/rules.js               rule validation shared by the editor and Rovo drafts
src/governance.js          approver list, proposals for active-rule edits, weakening settings
src/service.js             answers, drafts, approvals, exceptions, declarations, sticky matches, indexes
src/store.js               Forge KVS: records, write-once audit, locks, inbox queue, gate heartbeat
src/jira.js                Jira REST helpers and workflow coverage
src/backend.js             validators, triggers, Rovo actions / MCP tools
src/resolvers/*.js         issue panel, admin page and reviews inbox resolvers
src/frontend/*.jsx         UI Kit panel, admin page and inbox
test/                      node:test suites (engine, corpus, flows)
docs/                      judge guide, Devpost draft, demo script, audit prompt
```

## POPIA themes in the starter pack

s1 (personal information includes identifying numbers, contact details, location), s10 minimality, s11 lawful basis,
s13 specific purpose, s14 retention, s18 notification, s19 security safeguards, s26–27 special personal information,
s34–35 children, s69 electronic direct marketing, s72 transfers outside South Africa. These are starter review rules,
not legal advice. Have your Information Officer or privacy counsel review and adapt them before activating.

## License

MIT
