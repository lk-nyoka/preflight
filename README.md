# Preflight

**Your privacy policy, enforced before build, in Jira.**

When a work item proposes a change to how your organisation collects, uses, stores, shares or retains personal
information, Preflight holds it at two points:

1. **Review before build:** moving it to *In Progress* is refused until the team has answered your privacy review
   questions and a named approver (your Information Officer) has signed off. Every rule in the starter pack needs
   that sign-off.
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
| **Two workflow validators** | `Preflight: privacy review before build` (attach to the transition into In Progress) and `Preflight: privacy evidence before Done` (into Done). Declared for company-managed and team-managed projects (team-managed not yet verified live). The refusal message names what is missing and who approves. |
| **Preflight reviews (global page)** | The approver's inbox: work that got past a gate with its review open, work waiting for approval, work waiting on the team, exceptions with their expiry, and proposed rule changes with a full diff. Filtered to work items the viewer can see. Approval itself happens on the work item, where the answers are. |
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
make ambiguous words count only alongside a companion word ("GPS" only with "track", "driver", "employee" and so on;
"salary" only with "employee", "store", "export" and so on). Excludes remove Jira idioms such as "race condition",
"child issue", "health check endpoint", "device fingerprint" and "minor version". Every rule carries must-match and
must-not-match examples, checked in tests and every time an admin saves the rule. A regression corpus
(`test/corpus.test.js`) of about 245 realistic tickets guards the pack.

How well it matches, measured honestly. Three times, a reviewer who had not seen the rules wrote a fresh set of
ticket titles before running them:

| Round | Privacy tickets caught | Everyday tickets wrongly flagged |
|---|---|---|
| 1 | 17 of 25 (68%) | 0 of 25 |
| 2 | 19 of 30 (63%) | 1 of 30 |
| 3 | 28 of 40 (70%) | 1 of 40 |

After each round the misses were fixed (round 2 and 3 titles are now in the corpus and all pass), but the blind
numbers above are the fair estimate for wording no one has seen yet: roughly two in three, rising as the pack learns. That is why
keyword matching is only the first net. The panel offers *Add a rule*, and the optional declaration step asks "Does
this change affect personal information? Yes / No / Unsure" on every work item before work starts.

**Matches are sticky.** Once a rule matches, rewording the ticket does not remove it. Preflight also checks the
wording carried by the create and edit events and the wording seen when someone tries to start work, so text that was
live for only a few seconds still counts. Only an approver can dismiss a match, with a reason of at least 10
characters, and a dismissal covers only the phrases it was given for. Limitation: a *cloned* work item starts with no
history, so it is judged on its own wording.

**Roles**

| Role | Can |
|---|---|
| Anyone who can see the work item | Answer questions, confirm Rovo drafts, request approval, add a rule, declare Yes / Unsure. Declaring No, or lowering a declaration someone else raised, needs an approver |
| Rovo agent | Explain, propose drafts, request approval, declare *yes* or *unsure*, flag a rule, draft rules (admins). **Never**: approve, dismiss, grant exceptions, activate rules, declare *no*, or make a draft count |
| Named approver | Approve, dismiss with a reason, grant an exception (max 90 days), change the approver list and settings, decide proposed rule changes (not their own), cancel a reset |
| Jira admin | Install and configure. In **small-team mode** (no named approvers) also approves and edits rules directly. Once approvers are named: edits, activation and deactivation of active rules become *proposals*; can strengthen settings but not weaken them; cannot approve or add themselves as approver; can request a break-glass reset (below) |

**Every rule needs a named approver's sign-off before work starts.** The answers are the team's; the approval is the
Information Officer's (or, in small-team mode, a Jira admin's). Optional **separation of duties** stops the reporter,
the assignee and anyone who answered the questions from approving.

**Answers must be real answers.** Placeholders ("TBD", "not sure", "we'll do this later"), keyboard filler and repeated
words are rejected, and a retention answer must say when the data goes (a period or the event that ends it). This
raises the floor; it cannot judge whether an answer is *true*, which is the approver's job.

**When an approval goes stale:** an answer it covered (any *before work starts* answer) changes; an edit to the rule
takes effect, including one that was proposed before the approval was given; or the work item starts mentioning
something the approver did not see. Adding *before Done* evidence does not affect approval.

**Exceptions** are time-limited (at most 90 days) and cover only the rules that were open, and the wording they
matched, when the exception was granted. New rules or new wording are not waived.

**Governing the rules.** With approvers named, a change to an active rule waits in the approver's inbox as a
proposal. The approver sees every field that changed, with anything that makes the rule match less or ask for less
(removed phrases, new excludes, removed labels, loosened context, added options, lowered word counts, removed or
moved requirements) listed first as *weakens*, the rule's examples re-run against the new version, and the full rule
after the change. Bulk actions cannot switch enforcement off: the starter pack can only be restored as drafts while
none of its rules is active.

**Break-glass reset** (for when the Information Officer has left): a Jira admin who is not an approver can request a
reset to small-team mode. A **second** Jira admin must confirm it, it takes effect 72 hours after the request, any
approver can cancel it (they see it in the inbox and on every Preflight panel), and for 30 days afterwards the admin
who asked cannot approve work, weaken a control or name the new approvers.

**Bypass detection.** Validators only run on the transitions they are attached to. Work can still get past a gate by
being moved from another project, changing work type, or moving through a workflow without the gate. Preflight checks
every created or updated work item, and the open inbox daily: anything *In Progress* or *Done* whose matching review is
incomplete is recorded in the audit log, announced in a comment that mentions the approvers, shown on the panel, and
listed in the inbox under *Past a gate with the review open*.

**Write-once audit.** Every answer, draft, approval, dismissal, exception, declaration, rule change, setting change,
bypass and gate failure is its own key written with `FAIL_IF_EXISTS`; Preflight has no code path that edits or deletes
an audit event. Answer values are not copied into audit events. Free-text reasons (dismissals, exceptions, approval
notes, reset reasons) are kept with e-mail addresses and digit runs removed, and the UI asks people not to include
personal details; names or addresses typed into a reason would be kept. "Write-once" is a property of Preflight's code:
uninstalling the app, or deploying different code, can still remove app storage.

**Concurrency.** Record updates run under a per-work-item lock (a `FAIL_IF_EXISTS` key with a 10-second TTL and its own
deadline, so a crashed holder's lock is taken over even if storage does not expire it).

**Data minimisation.** E-mail addresses and digit runs of seven or more (ID, phone, account numbers) are removed from
snippets shown in the panel, comments, the inbox, Rovo and MCP. Names and street addresses are not detected. Evidence
is deleted when its work item is deleted (the audit history is kept). Preflight sends nothing outside Atlassian. Rovo
itself can read the work item it is opened on; redaction limits what Preflight's actions add, not what Rovo can see.

**Failure behaviour (fail closed by default).** If Preflight cannot evaluate a work item, the transition is held with a
clear message and the failure is audited. Switching to fail-open is a weakening change: with approvers named only an
approver can make it.

**Evidence is protected from routine tampering.** Evidence, approvals and exceptions live in Preflight's app storage
and are written only through permission-checked server-side functions. The indexed `preflight` issue property is a
projection for JQL and dashboards; the gates never read it, and anyone who can edit an issue could overwrite it, so
do not use it as evidence. *Before Done* link requirements accept any https link a person enters: Preflight records
who claimed the evidence and when; it does not check the page.

**Coverage.** *Check workflow coverage* lists the transitions into In Progress and Done statuses in the workflows
Jira's workflow search returns, and whether the matching gate is attached. Team-managed project workflows may not be
returned by that API, so check those by hand. Bypass detection (above) is the safety net for whatever coverage misses.

**Not yet verified on a live Jira site.** These were built from Atlassian's documentation and are covered by tests
with Jira faked, but have not yet been exercised end to end: the validator payload shape and team-managed support,
`nodejs24.x`, KVS `ttl` together with `FAIL_IF_EXISTS`, the response shapes of the two workflow APIs, Rovo action
context (`context.principal`) and `api.asUser()` inside Rovo and MCP calls (`rovo:mcp` is Preview), and a few UI Kit
props. The first deploy should confirm each; see `docs/DEPLOY.md`.

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

`npm test` runs 63 tests: the engine, the matcher regression corpus (including all three blind-test sets), end-to-end
flows with Jira and storage faked (two-stage gating, stale approvals, sticky matches, drafts that don't count,
governance of approvers and active rules, write-once audit, locks, exception expiry, rate limiting, fail-closed,
deletion, coverage), and one regression test for each hole found in the second independent audit
(`test/exploits.test.js`). They do not replace testing real transitions on a developer site.

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
src/governance.js          approver list, rule-change proposals with full diffs, settings, break-glass reset
src/service.js             answers, drafts, approvals, exceptions, declarations, sticky matches, bypass detection, indexes
src/store.js               Forge KVS: records, write-once audit, locks, inbox queue, gate heartbeat
src/jira.js                Jira REST helpers and workflow coverage
src/backend.js             validators, triggers, Rovo actions / MCP tools
src/resolvers/*.js         issue panel, admin page and reviews inbox resolvers
src/frontend/*.jsx         UI Kit panel, admin page and inbox
test/                      node:test suites (engine, corpus, flows, exploits)
docs/                      judge guide, deploy guide, Devpost draft, demo script, audit prompt
```

## POPIA themes in the starter pack

s1 (personal information includes identifying numbers, contact details, location), s10 minimality, s11 lawful basis,
s13 specific purpose, s14 retention, s18 notification, s19 security safeguards, s26–27 special personal information,
s34–35 children, s69 electronic direct marketing, s72 transfers outside South Africa. These are starter review rules,
not legal advice. Have your Information Officer or privacy counsel review and adapt them before activating.

## License

MIT
