# Preflight: hostile pre-submission audit prompt

You are auditing **Preflight**, an Atlassian Forge app for Jira entering Codegeist 2026 (judged equally on
Technological Implementation, Design, Potential Impact, Innovation and Presentation; judges may watch only 3 minutes
of video and install from a link). The repository is at `/home/claude/preflight`. You have not seen it before.

Preflight's claims (verify each, do not assume):
1. Work that changes how personal information is collected, used, stored or shared is held at **two gates**:
   "review before build" (into In Progress) and "evidence before Done".
2. A deterministic, stem-aware rules engine decides; no LLM is in the enforcement path.
3. Rovo can only *propose* answers (drafts a person must confirm) and can never approve, dismiss, grant exceptions,
   activate rules or declare "no personal data".
4. Once approvers are named, a Jira admin cannot approve, cannot add themselves as approver, and edits to active rules
   or weakening settings become proposals an approver must decide.
5. Audit events are write-once (KVS `FAIL_IF_EXISTS`), including admin changes; evidence is deleted with the issue.
6. Approvals go stale when build answers or the rule change; matches are sticky across rewording; exceptions expire.
7. Fail-closed by default; coverage check lists unprotected workflow transitions.

## What to do

1. Read every file under `src/`, `test/`, `manifest.yml`, `README.md`, `docs/`.
2. Run `npm test` and report the real output.
3. **Matcher test with unseen data.** Before looking at the trigger lists in `src/rulepacks/popia.js`, write down 25
   realistic Jira ticket titles that clearly involve personal information (SA context welcome: FICA, ID numbers, payroll,
   learners, health, WhatsApp marketing, offshore vendors) and 25 everyday engineering tickets that do not. Then run them
   through `evaluate()` from `src/engine/evaluate.js` with all `POPIA_RULES` set to `status: 'active'` (write a small
   `.mjs` script in /tmp). Report recall and false-positive counts and list every miss and false positive.
4. Hunt for real defects, ranked by severity, in:
   - **Authorization**: any path where a non-approver can approve, dismiss, grant an exception, change approvers, weaken
     settings, activate/deactivate/delete rules, or decide their own proposal. Check every resolver, every Rovo action,
     and bulk operations (load demo, restore pack, reset approvers). Check that issue identity comes from context, not
     payload, in the panel.
   - **Bypass**: ways to move work past the gates (rewording, declarations, dismissals, exceptions, issue type change,
     unprotected transitions, errors that fail open, the agent being prompt-injected via ticket text).
   - **Correctness**: stage logic, stale approvals, fingerprints, sticky matches, exception expiry, declaration logic,
     index/queue sync, lock behaviour and release, KVS query pagination, fail-closed paths.
   - **Forge platform**: anything in `manifest.yml` or code that is unlikely to work on a real Jira Cloud site (module
     shapes, scopes, event names, API endpoints, UI Kit component props, validator function contract, Rovo action
     payload/context assumptions). Mark these UNVERIFIED rather than guessing.
   - **Privacy of the privacy tool**: personal data leaking into logs, audit text, comments, the inbox, or agent output.
   - **UX**: what a developer sees the first time they are blocked; whether they know exactly what to do and who approves;
     anything confusing in the panel, admin page or inbox copy.
   - **Claims**: any README/DEVPOST statement the code does not back up, or that overclaims legal compliance.
5. Do not fix anything. Output a report with sections: Test results · Unseen matcher test (with lists) · Defects
   (each: severity P0/P1/P2, file:line, what breaks, concrete fix) · Unverified platform assumptions · Overclaims ·
   Top 5 changes that would most raise the score.

Be specific and brutal. Do not praise. If something is fine, skip it.
