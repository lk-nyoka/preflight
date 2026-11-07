# Preflight: judge setup and test script (about 6 minutes)

## 1. Install (1 minute)

1. Open the installation link from the submission and install Preflight on your Jira site. You need to be a Jira admin
   there (to load the demo and attach the gates).
2. Optional, for the agent: Rovo must be enabled on the site.

## 2. Load the demo (30 seconds)

1. Create a project if you need one (any template; a Kanban project is fine). Note its key, for example `PRIV`.
2. **Jira settings (⚙) → Apps → Preflight → Setup → Load demo** with that key.
   This activates the POPIA starter rules and creates five sample work items: four that touch personal information and
   one control item ("Update footer copyright year").

## 3. Attach the two gates (2 minutes, one time)

Open the project's workflow:
- **Company-managed:** Project settings → Workflows → edit.
- **Team-managed:** Project settings → Work types → open a type → Edit workflow.

Then:
1. Transition into **In Progress** → *Rules* / *Validators* → add **Preflight: privacy review before build**.
2. Transition into **Done** → add **Preflight: privacy evidence before Done**.
3. Publish / update the workflow.

Back on **Setup**, click **Check workflow coverage**: both transitions should show *protected*. (Menu names in the
workflow editor vary slightly; look for *Rules* or *Validators* on the transition.)

## 4. The test (about 3 minutes)

1. Open **"Add SA ID number field to customer signup"**. The Preflight panel shows *Start work: Blocked*, a next-step
   box ("answer 4 questions before work starts") and who approves. With no named approvers, Preflight is in
   **small-team mode** and Jira admins approve; the panel says so.
2. Drag it to **In Progress**. Jira refuses with a message naming the rule, the POPIA sections and what is missing.
3. Answer the four questions (one is a pick-list) and click **Save answers**. Then click **Approve**.
4. Drag it to **In Progress**: it moves.
5. Drag it to **Done**: refused, because *Privacy notice updated (link)* is still open. Paste any https link, save, and
   move it to Done.
6. Try to dodge it on another item: open **"Sync customer list to our US-based CRM vendor"**, edit the description and
   remove "US-based" and "us-east". The rules stay ("matched earlier") until an approver dismisses them with a reason.
7. Change an approved answer on any item and save: the approval goes stale and the build gate closes again.
8. **Apps → Preflight reviews** shows everything waiting for approval and everything waiting on the team.
9. **Setup → Test a rule**: paste any ticket text and see which rules match and why.
10. Optional, **Rovo → Preflight agent** on a demo item: "What do I need before I can start this?", then "Help me answer
    the retention question". The answer appears in the panel as a **Rovo draft**; it only counts after you click
    *Use draft* and *Save answers*.

## Notes

- Preflight **fails closed**: if it cannot evaluate a work item, the transition is held with a clear message.
- To see governance: in **Settings**, name yourself as the only approver; then try editing an active rule from a second
  admin account. The edit becomes a proposal that the approver applies or rejects under *Preflight reviews*.
- The MCP tools (`rovo:mcp`, Preview) need an org admin to enable external MCP access; the demo video shows them.
- Preflight records your organisation's review. It is not legal advice and never says work is "compliant".
