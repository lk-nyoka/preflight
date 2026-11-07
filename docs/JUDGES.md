# Preflight: judge setup and test script (about 5 minutes)

## 1. Install

1. Open the installation link from the submission and install Preflight on your Jira site.
2. You must be a Jira admin on that site (needed to load the demo and to attach the workflow validator).

## 2. Load the demo (30 seconds)

1. Create a project if you need one (any template; Kanban is fine). Note its key, for example `PRIV`.
2. Go to **Jira settings (⚙) → Apps → Preflight → Demo setup**.
3. Enter the project key and click **Load demo**.
   This activates the POPIA starter pack and creates five work items: four that touch personal information and one control item.

## 3. Attach the gate (one minute, one time)

**Company-managed project:** Project settings → Workflows → edit the workflow → select the transition into **Done** →
**Validators → Add validator → Preflight privacy review gate** → Publish.

**Team-managed project:** Project settings → Work types → open a type → **Edit workflow** → select the transition into **Done** →
**Rules → Add rule → Preflight privacy review gate** → Update workflow.

Exact menu names in the workflow editor vary slightly between Jira versions; look for *Rules* or *Validators* on the transition.

## 4. Test it

1. Open **"Add SA ID number field to customer signup"**. The **Preflight** panel shows *Blocked*, the rule *Identifying numbers
   (POPIA s1, s10, s11, s13, s14, s18)*, the matched phrase, five review questions and an approval.
2. Try to move it to **Done**. The transition is refused with a message naming the rule and the missing evidence.
   (Admin page → Demo setup now lists your project under *Gate status*.)
3. Fill in the answers (one is a pick-list) and click **Save answers**. Click **Approve**. With no named approvers
   configured, Preflight is in small-team mode and Jira admins can approve; the panel says so.
4. Move it to **Done**. It now succeeds.
5. Re-open it, change the retention answer and save: the approval goes stale and the gate closes again.
6. Try to dodge the gate: open **"Sync customer list to our US-based CRM vendor"**, then edit the description and delete
   "US-based" and "us-east". The rules stay open ("matched earlier") until an approver dismisses them with a reason.
7. Admin page → **Test a rule**: paste any ticket text to see which rules match and why.
8. Optional: **Rovo** → agents → **Preflight** on a demo work item: "Preflight this work item", then "Help me answer the retention question".
9. Optional: JQL `preflightStatus = blocked`.

## Notes

- Nothing is enforced until rules are active (Load demo activates the POPIA pack).
- Preflight **fails closed** by default: if it cannot evaluate a work item, the transition is held with a clear message.
  You can switch to fail-open under Settings.
- If the panel says the gate has not run in this project, the validator is not attached to that workflow yet.
- The MCP tools (`rovo:mcp`, Preview) need an org admin to enable external MCP access; the demo video shows them in use.
