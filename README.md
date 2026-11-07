# Preflight

**Turn your organisation's privacy-review policy into enforceable delivery guardrails in Jira.**

When a work item proposes a change to how your organisation collects, uses, stores, shares or retains personal
information, Preflight identifies the applicable internal review rules, shows what evidence is missing, and prevents
the transition to Done until an authorised approver signs off or records a time-limited exception.

It includes an editable starter rule pack inspired by selected themes in South Africa's Protection of Personal
Information Act (POPIA). It is not a complete POPIA assessment. Preflight enforces **your organisation's own review
process**; it does not determine legal compliance and is not legal advice.

> Tools that scan for personal information find data that is already sitting in Jira. Preflight controls the
> **changes** that would introduce new ways of collecting, using or sharing it, before they ship.

Built on Atlassian Forge for Codegeist 2026.

---

## What it does

| Surface | What happens |
|---|---|
| **Issue panel** | Status (Blocked / Clear / Exception / No configured rule matched), each matching rule with its clause, the phrase that triggered it and the requirements to complete. Approvers see Approve, Not relevant and Exception controls. Audit history of matches, answers, approvals, dismissals, exceptions and approval requests. |
| **Workflow validator** | **Preflight privacy review gate.** Attached to the transition into Done, it refuses the transition while review evidence is outstanding, with a message naming the rule, the clause and what is missing. |
| **Rovo agent** | *Preflight* explains why a rule matched, drafts answers with the user, saves answers the user confirms, requests approval, flags a rule the matcher missed, and (for admins) drafts new rules from a policy page. It **cannot** approve, dismiss, grant exceptions or activate rules. |
| **MCP tools** | `rovo:mcp` exposes `preflight-check-issue` (read-only), `preflight-list-rules` (read-only) and `preflight-request-approval` (write, rate-limited) so coding agents can check a ticket before writing code.¹ |
| **Admin page** | Rules editor, *Test a rule* sandbox, one-click demo loader, gate status by project, approver and failure-mode settings. |
| **JQL** | `preflightStatus = blocked`, `preflightOpen > 0` via an indexed issue property (a search projection only, see below). |

¹ `rovo:mcp` is a Forge Preview feature. External MCP clients only reach the tools after an org admin enables external
MCP access for the installation.

## Trust model

**No generative AI in the enforcement path.** The validator re-runs a deterministic rules engine
(`src/engine/evaluate.js`) on the live work item and the stored evidence. Every result is explainable (matched phrase
plus snippet). Rovo is optional: it explains, drafts and requests, and its usage counts against the customer's Rovo
plan. Preflight makes no Forge LLM calls.

**Matches are sticky.** Once a rule matches a work item, it stays applicable even if the text is reworded. Deleting
"ID number" from the description does not open the gate. Only an approver can dismiss a rule, and must give a reason.

**Roles**

| Role | Can |
|---|---|
| Anyone who can see the work item | Answer requirements, request approval, flag a missed rule |
| Rovo agent | Explain, draft, save answers the user confirmed, request approval. Never approve. |
| Approver (named in settings) | Approve, dismiss a rule with a reason, grant a time-limited exception, revoke |
| Jira admin | Manage rules and settings. Approves **only** in small-team mode (no named approvers configured) |

Optional **separation of duties** stops the reporter of a work item from approving it.

**When an approval goes stale:** an answer to that rule changes; the rule's text, triggers or requirements are edited;
an exception passes its expiry date. A rule that is deactivated simply stops applying. Approvals are tied to the
answers they approved, not to the approver, so changing the approver list does not invalidate past approvals.

**Evidence is protected from routine tampering.** Evidence, approvals, dismissals, exceptions and the audit history
are stored in Preflight's app storage and written only through permission-checked server-side functions. They are not
kept in user-editable issue fields or issue properties. The indexed `preflight` issue property is a projection for JQL
and dashboards only; the validator never reads it.

**Data minimisation.** Long digit runs (ID, phone and account numbers) are removed from evidence snippets shown in
the panel, comments, the agent and MCP. Preflight sends nothing to services outside Atlassian.

**Failure behaviour (fail closed by default).** Rules apply and evidence is missing: blocked. No configured rule
matched: allowed (the panel says this is not proof of no privacy impact and offers *flag a rule*). Preflight itself
cannot evaluate: the transition is **held** with a clear message. Teams that prefer availability can switch to
fail-open, which allows the transition and logs the error.

**Gate coverage.** The validator records a heartbeat per project. The panel warns when the gate has not run in a
project, and the admin page lists where it is active, so a forgotten workflow is visible.

---

## Run it yourself

*This section is for people building from the repo. Judges should use the installation link and
[`docs/JUDGES.md`](docs/JUDGES.md).*

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

Then in Jira:

1. **Jira settings → Apps → Preflight → Demo setup**: enter a project key and click **Load demo**. This activates the
   POPIA starter pack and creates five sample work items.
2. **Attach the gate** to the transition into *Done* (works in company-managed and team-managed projects; see
   `docs/JUDGES.md` for the clicks).
3. Open *Add SA ID number field to customer signup* and try to move it to Done.

`npm test` runs 21 tests: the engine, plus end-to-end flows with Jira and storage faked (blocking, approval, stale
approval, sticky matches, approver roles, exception expiry, rate limiting, fail-closed, draft-only rule authoring).
They do not replace testing real transitions on a developer site.

To share with judges: `forge deploy -e production`, then create an installation link in the
[Developer Console](https://developer.atlassian.com/console/myapps/) (*Distribution → Start sharing*).

**Running costs:** Forge compute and storage stay within the free monthly allowances at hackathon scale; heavy use can
exceed them. Rovo usage is billed to the customer's Rovo plan.

---

## Project layout

```
manifest.yml               modules, functions, scopes
src/engine/evaluate.js     pure rules engine (shared by every surface)
src/rulepacks/popia.js     POPIA-inspired starter pack and demo work items
src/rules.js               rule validation (admin editor and Rovo drafts)
src/service.js             permissions, approvals, sticky matches, audit (all writes go through here)
src/store.js               Forge KVS data model
src/jira.js                Jira REST helpers
src/backend.js             validator, triggers, Rovo actions / MCP tools
src/resolvers/*.js         issue panel and admin page resolvers
src/frontend/*.jsx         UI Kit panel and admin page
test/                      node:test suites
docs/JUDGES.md             judge setup and test script
docs/DEVPOST.md            submission draft
```

## POPIA themes in the starter pack

s1 (personal information includes identifying numbers), s10 minimality, s11 lawful basis, s13 specific purpose, s14
retention, s18 notification, s19 security safeguards, s26–27 special personal information, s34–35 children, s69
electronic direct marketing, s72 transfers outside South Africa. These are starter review rules, not legal advice. Have
your Information Officer or privacy counsel review and adapt them before activating.

## License

MIT
