# Preflight: judge setup and test script (about 6 minutes)

**Install Preflight:** use the installation link on the Devpost page ([direct link](https://developer.atlassian.com/console/install/e9581f7b-84df-42b6-a25d-0cfb7c31f886?signature=AYABeM%2BMkkX%2FCaON50xGitY%2BkicAAAADAAdhd3Mta21zAEthcm46YXdzOmttczp1cy13ZXN0LTI6NzA5NTg3ODM1MjQzOmtleS83MDVlZDY3MC1mNTdjLTQxYjUtOWY5Yi1lM2YyZGNjMTQ2ZTcAuAECAQB4CxqLTo9l4lqXuFjNim1xJM%2Bp%2F3TVP9xHS2BrU5DRRucBCMZ%2BovKO5SgebI9IJqb9yAAAAH4wfAYJKoZIhvcNAQcGoG8wbQIBADBoBgkqhkiG9w0BBwEwHgYJYIZIAWUDBAEuMBEEDAm2%2F3NEvqkd3jfdbwIBEIA7Fqe2o8YBa4y%2F5ddq%2Fbd2ehoZ8IsNk%2FMYu%2Bm9n1RJYjYNM0hri1Vcex1kd9pWfpZcyfzpz8%2BIGFIP%2BXwAB2F3cy1rbXMAS2Fybjphd3M6a21zOmV1LXdlc3QtMTo3MDk1ODc4MzUyNDM6a2V5LzQ2MzBjZTZiLTAwYzMtNGRlMi04NzdiLTYyN2UyMDYwZTVjYwC4AQICAHi9bVMAkme4qVQX1fQHo6ePw3H40A7cGfz7yrmSfBWMXgHtoMIT%2Bqm1cwVEJ47KXnC2AAAAfjB8BgkqhkiG9w0BBwagbzBtAgEAMGgGCSqGSIb3DQEHATAeBglghkgBZQMEAS4wEQQMuTY1uxKJzX0GN1MNAgEQgDvwI8L2YftJO9zEoFQgo2EJ%2F2Cv9NNNqKrhHyww3yFsWdyTveBozBrrFycFkn48y%2Fu0ZDtXc81s70iYlQAHYXdzLWttcwBLYXJuOmF3czprbXM6dXMtZWFzdC0xOjcwOTU4NzgzNTI0MzprZXkvNmMxMjBiYTAtNGNkNS00OTg1LWI4MmUtNDBhMDQ5NTJjYzU3ALgBAgIAeDYASx0XCjkny4iLV6vz%2BKtEGSGT6kdt0QRpkn6D%2FlVEAdrxsdza%2FxyQmMBQ83VlHB0AAAB%2BMHwGCSqGSIb3DQEHBqBvMG0CAQAwaAYJKoZIhvcNAQcBMB4GCWCGSAFlAwQBLjARBAx9azf6cQ2rEWdjBmgCARCAO%2F3%2FlvJ8EpTZTZpPG7KiOeGNAzlWZrB8N9oBkV1IGvXwI1L%2FIGYo9kb4feOwO2MVZ0C4HquIOlGAeJwoAgAAAAAMAAAQAAAAAAAAAAAAAAAAAKnpoG31uy3yYMtYAGy6V3D%2F%2F%2F%2F%2FAAAAAQAAAAAAAAAAAAAAAQAAADK%2BVdoXbTEKw74LwjIlNODyu8uKS3PPKR9Tp7ihDMRnpUM5%2B0zHiUuXoh1KMwdgf%2Bs8YquSpsh4XaUppe%2BAQdF4Ddo%3D&product=jira)), choose your Jira site and accept the permissions. Then follow the steps below.

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
2. Drag it to **In Progress**. Jira refuses with a message naming the rule, what is missing and who approves.
3. Answer the four questions (one is a pick-list) and click **Save answers**. Then click **Approve**.
4. Drag it to **In Progress**: it moves.
5. Drag it to **Done**: refused, because *Privacy notice updated (link)* is still open. Paste any https link, save, and
   move it to Done.
6. Try to dodge it: open **"Store learner allergy and medical notes for school trip bookings"** and reword BOTH the
   summary and the description so neither mentions learners, allergies or medical notes (for example "School trip
   booking form update"). The panel still shows the rules, now marked "matched earlier", until an approver dismisses
   them with a reason. (If any matched phrase is left in the text, the panel shows "mentions …" instead.)
7. Change an approved answer on any item and save: the approval goes stale and the build gate closes again.
8. **Apps → Preflight reviews** shows everything waiting for approval and everything waiting on the team. Approval
   happens on the work item itself, where the answers are.
9. Optional, bypass detection: create a work item "Store customer passport numbers" and use a workflow without the
   gates (or drag it straight to Done in a project where the gates aren't attached). Within a few seconds Preflight
   comments on it, mentioning the approvers, and it appears in the inbox under *Past a gate with the review open*.
10. **Setup → Test a rule**: paste any ticket text and see which rules match and why.
11. Optional, **Rovo → Preflight agent** on a demo item: "What do I need before I can start this?", then "Help me answer
    the retention question". The answer appears in the panel as a **Rovo draft**; it only counts after you click
    *Use draft* and *Save answers*.

## Notes

- Preflight **fails closed**: if it cannot evaluate a work item, the transition is held with a clear message.
- To see governance: in **Settings**, name yourself as the only approver; then, from a second admin account, edit an
  active rule (for example add "id number" to its *Ignore* list). The edit becomes a proposal; under *Preflight
  reviews* the approver sees it flagged *WEAKENS*, with the examples that no longer match.
- The MCP tools (`rovo:mcp`, Preview) need an org admin to enable external MCP access; the demo video shows them.
- Preflight records your organisation's review. It is not legal advice and never says work is "compliant".
