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
**Validators → Add validator → Preflight privacy evidence gate** → Publish.

**Team-managed project:** Project settings → Work types → open a type → **Edit workflow** → select the transition into **Done** →
**Rules → Add rule → Preflight privacy evidence gate** → Update workflow.

## 4. Test it

1. Open **"Add SA ID number field to customer signup"**. The **Preflight** panel shows *Blocked*, the rule *Identifying numbers
   (POPIA s1, s10, s13, s14)*, the matched phrase and three questions plus an approval.
2. Try to move it to **Done**. The transition is refused with a message naming the missing evidence.
3. Fill in the three answers and click **Save answers**. Click **Approve** (as a Jira admin you are an approver).
4. Move it to **Done**. It now succeeds.
5. Re-open it, change the retention answer and save: the approval goes stale and the gate closes again.
6. Admin page → **Test a rule**: paste any ticket text to see which rules match and why.
7. Optional: **Rovo** → agents → **Preflight** on a demo work item: "Preflight this work item", then "Help me answer the retention question".
8. Optional: JQL `preflightStatus = blocked`.

## Notes

- Nothing is enforced until rules are active (Load demo activates the POPIA pack).
- The **Fail closed** setting is off by default, so a Preflight error never blocks your workflow.
- The MCP tools (`rovo:mcp`, Preview) need an org admin to enable external MCP access; the demo video shows them in use.
