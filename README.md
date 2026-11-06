# Preflight

**Turn your privacy policy into enforceable delivery guardrails in Jira.**

When a work item touches personal information, Preflight shows which of your organisation's privacy review
steps apply, what evidence is missing, and blocks the transition to Done until an authorised approver signs off.
It ships with a starter rule pack based on South Africa's Protection of Personal Information Act (POPIA).

Preflight enforces **your own review process**. It never decides or claims that work is "compliant", and it is
not legal advice.

Built on Atlassian Forge for Codegeist 2026.

---

## What it does

| Surface | What happens |
|---|---|
| **Issue panel** | Shows status (Blocked / Clear / Exception / No rules apply), each matching rule with its clause, the phrases that triggered it, and the requirements to complete. Approvers see Approve, Dismiss and Exception controls. Full audit trail. |
| **Workflow validator** | `Preflight privacy evidence gate`. Attach it to the transition into Done and the transition is refused while requirements are open, with a message that names the rule, the clause and what is missing. |
| **Rovo agent** | *Preflight* explains gaps, drafts answers with the user, saves confirmed answers, requests approval, and flags rules keyword matching missed. It **cannot** approve. |
| **MCP server** | `rovo:mcp` exposes `preflight-check-issue`, `preflight-list-rules` and `preflight-request-approval` so coding agents (Claude, Cursor, Rovo Dev) can check a ticket before writing code. |
| **Admin page** | Rules editor, *Test a rule* sandbox, one-click demo loader, approver and policy settings. |
| **JQL** | `preflightStatus = blocked`, `preflightOpen > 0` via an indexed issue property. |

### Design choices that make the gate trustworthy

- **Deterministic engine, no LLM in the gate.** The validator re-runs a pure rules engine (`src/engine/evaluate.js`) on the live
  ticket text. Results are explainable (matched phrase plus snippet) and fast enough for a blocking validator.
- **AI assists, humans approve.** Rovo drafts and saves answers the user confirms; only an approver (listed in settings, or a Jira
  admin) can approve, dismiss a rule or grant an exception, checked server-side.
- **Evidence lives in app storage**, not in editable issue properties, so it cannot be forged through the REST API.
- **Approvals go stale** automatically if the answers change afterwards or the rule is edited.
- **Rules start as drafts.** Nothing is enforced until an admin activates it.
- **False positives and negatives are handled**: approvers can dismiss a rule with a reason; anyone can flag a rule that was missed.
- **Fails open by default** (and logs), with a *fail closed* setting for stricter teams. Optional separation of duties.
- **Free to run.** No Forge LLM calls (those are billed to the developer); Rovo usage is billed to the customer's Rovo plan.

---

## Run it yourself (Windows, macOS or Linux)

Requirements: Node.js 22+, an [Atlassian developer site](https://go.atlassian.com/cloud-dev) (free) with Jira, and Rovo enabled for the agent.

```bash
npm install -g @forge/cli
forge login                 # uses an Atlassian API token
cd preflight
npm install
forge register              # creates your app and writes app.id into manifest.yml
forge deploy
forge install --product jira --site <your-site>.atlassian.net
```

Then in Jira:

1. **Jira settings → Apps → Preflight → Demo setup**: enter a project key and click **Load demo**. This activates the POPIA pack and
   creates five sample work items.
2. **Attach the gate**: project → workflow → transition into *Done* → *Rules / Validators* → add **Preflight privacy evidence gate** → publish.
3. Open *Add SA ID number field to customer signup* and try to move it to Done.

Run tests with `npm test` (13 tests: engine plus an end-to-end flow with Jira and storage faked).

To share with judges: `forge deploy -e production`, then create an installation link in the
[Developer Console](https://developer.atlassian.com/console/myapps/) (*Distribution → Start sharing*).

---

## Project layout

```
manifest.yml               modules, functions, scopes
src/engine/evaluate.js     pure rules engine (shared by every surface)
src/rulepacks/popia.js     POPIA starter pack and demo work items
src/service.js             permissions, approvals, audit (all writes go through here)
src/store.js               Forge KVS data model
src/jira.js                Jira REST helpers
src/backend.js             validator, triggers, Rovo actions / MCP tools
src/resolvers/*.js         issue panel and admin page resolvers
src/frontend/*.jsx         UI Kit panel and admin page
test/                      node:test suites
docs/JUDGES.md             judge setup and test script
```

## POPIA references in the starter pack

s1 (personal information includes identifying numbers), s10 minimality, s13 specific purpose, s14 retention, s19 security
safeguards, s26–27 special personal information, s34–35 children, s69 electronic direct marketing, s72 transfers outside South
Africa. Have your Information Officer review the rules before activating them.

## License

MIT
