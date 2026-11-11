# Deploy Preflight and get the installation link

About 30 minutes the first time. Everything here is free: an Atlassian developer site and Forge's free allowance.

## 1. One-time setup on your PC

1. **Node.js 22.23.4 or newer** (or 24.22.1+). Check with `node -v`. Install the LTS from nodejs.org if needed.
2. **Forge CLI:** `npm install -g @forge/cli`, then `forge --version`.
3. **A free Atlassian developer site** with Jira: https://go.atlassian.com/cloud-dev. Turn on Rovo for the site if
   the option is offered (needed only for the agent scenes).
4. **An API token:** https://id.atlassian.com/manage-profile/security/api-tokens → *Create API token*.
5. `forge login` → your Atlassian e-mail and the token.

## 2. Register, deploy, install

From the `preflight` folder:

```bash
npm install
forge register            # once: name it "Preflight". This writes app.id into manifest.yml.
forge lint                # should report no problems
forge deploy              # development environment
forge install --product jira --site <your-site>.atlassian.net
```

Commit the `manifest.yml` change that `forge register` made.

## 3. Check the things that could only be tested live

The code is covered by 77 tests with Jira faked. These behaviours depend on the real platform. Check each one once
and note anything odd. `forge logs` (or `forge tunnel` while you click) shows server errors.

| # | Check | How | If it fails |
|---|---|---|---|
| 1 | The app installs and the admin page opens | Jira settings → Apps → Preflight | Read `forge logs`; usually a manifest scope or runtime issue |
| 2 | Load demo creates 5 work items and activates 7 rules | Setup → Load demo with your project key | |
| 3 | The validators can be attached | Workflow editor → transition into In Progress → Rules/Validators → *Preflight: privacy review before build* | In a team-managed project, try a company-managed one; note it in the Devpost "challenges" |
| 4 | The build gate blocks `PRIV-1` and names the approver | Drag it to In Progress | If it never blocks, the validator payload may differ: `forge logs` shows "gate failed" |
| 5 | Saving answers and approving works; the gate then allows | Panel → answer → Save → Approve → drag | |
| 6 | Locks work (no "Someone else is updating" errors in normal use) | Save answers twice quickly | If every save says busy, KVS TTL/FAIL_IF_EXISTS behaves differently: tell Claude the error text |
| 7 | Inbox loads and lists the item | Apps → Preflight reviews | |
| 8 | Coverage check lists your transitions | Setup → Check workflow coverage | If it says "could not find any transitions", note it; check by hand |
| 9 | Bypass detection | In a project without the gates, drag a privacy item to Done; a Preflight comment appears | Comments need the app's write access; check `forge logs` |
| 10 | Rovo agent answers and its draft shows in the panel | Rovo → Preflight → "Help me answer the retention question" on `PRIV-1` | Note the error; the agent is a bonus, the gates are the product |

## 4. Production and the installation link (what judges need)

```bash
forge deploy -e production
```

Then in the Developer Console (https://developer.atlassian.com/console/myapps/) → Preflight → **Distribution** →
**Start sharing** (or *Manage distribution*). Fill in the short form (privacy: Preflight stores data only in Forge
storage; no personal data leaves Atlassian). Copy the **installation link** into the Devpost form.

Test the link yourself on a second free developer site before submitting.

## 5. Record the real screens

Follow `docs/DEMO_SCRIPT.md`. Record the app scenes at 1920×1080, put each clip in `video/recordings/<scene>.mp4`, and
run `python3 build.py --no-frames` in `video/` (or the full build). Upload the result to YouTube (public or unlisted)
and paste the link into Devpost.
