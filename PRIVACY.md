# Preflight privacy policy

_Last updated: 11 November 2026_

Preflight is a Forge app for Jira, built by Lindokuhle Nyoka as an independent developer. This policy explains what
the app stores, where, and for how long.

## Where data lives

Everything Preflight stores is kept in Atlassian's Forge storage for your Jira site, on Atlassian's infrastructure.
Preflight runs entirely on Atlassian (Forge, "Runs on Atlassian"). It has no servers of its own, sends nothing to any
outside service, and uses no analytics or tracking. The developer cannot see your data.

## What Preflight stores

| Data | Why | Kept until |
|---|---|---|
| Rules and settings an admin configures, including the Atlassian account IDs of named approvers | To run the privacy review | Changed by an admin, or the app is uninstalled |
| For each work item a rule applies to: the answers people type, links they add, approvals, dismissals, exceptions and declarations, each with the Atlassian account ID of the person and a timestamp | This is the review record the app exists to keep | The work item is deleted (the record is deleted with it), or the app is uninstalled |
| A write-once audit history of those actions: account IDs, timestamps, rule names and reasons (with e-mail addresses and long digit runs removed). Answer text is not copied into it | So an organisation can show who decided what, and when | The app is uninstalled |
| A short snippet of the work item text that triggered a rule (e-mail addresses and digit runs removed) | To explain why a rule applies | As for the work item record |

Preflight reads work item text, labels and statuses through Jira's APIs to decide whether a rule applies. It does
not copy names, e-mail addresses or avatars; it shows them live from Jira.

## Who can see it

People who can see a work item in Jira can see its Preflight panel. Approvers and Jira admins see the review inbox,
filtered to work items they can see. Rovo, if your organisation uses it, can read Preflight's explanations for work
items the signed-in user can see.

## Closed Atlassian accounts

Once a week Preflight reports the account IDs it stores to Atlassian's personal data reporting API. When Atlassian says
an account has been closed, Preflight replaces that ID with "closed-account" everywhere it is stored, the audit history
included. The record of what happened stays; who did it no longer identifies anyone.

## Your choices

- An admin can delete all of Preflight's data by uninstalling the app.
- Deleting a work item deletes its review record (the audit history is kept until uninstall, so the organisation can
  still show what happened).
- Please do not type other people's personal details into free-text reasons; they are kept in the audit history.

## Contact

Questions or requests: open an issue at https://github.com/lk-nyoka/preflight/issues or e-mail
lindokuhle.nyoka03@gmail.com.
