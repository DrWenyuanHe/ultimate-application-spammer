# Setup and repair

Use this when the start-up check says `first-run` or `needs-repair`, or when the person says "set me up" or "something is broken". Profile questions, application questions and importing documents are in `app/skills/onboarding.md`, which follows this.

Keep the tone friendly and short. The person may never have used a terminal. Explain what you are about to do in one sentence, and ask before installing anything.

## 1. Check the prerequisites

Run these and note the results:

```
node --version
git --version
```

- **Node.js 24 or newer** is required. The app cannot run without it.
- **Git** is required for updates.
- **LibreOffice** (Windows or Mac) **or Microsoft Word** (Windows only) is optional. Without one, documents are made as Word files (`.docx`) and the person can use Word's own Save as PDF.

If something is missing, tell the person what it is for and ask: "Can I install Node.js for you? (yes/no)". Run one command only after they say yes.

| What | Windows (winget) | macOS (Homebrew) |
|---|---|---|
| Node.js | `winget install --id OpenJS.NodeJS.LTS -e` | `brew install node` |
| Git | `winget install --id Git.Git -e` | `xcode-select --install` (or `brew install git`) |
| LibreOffice (optional) | `winget install --id TheDocumentFoundation.LibreOffice -e` | `brew install --cask libreoffice` |

- If winget stops because it needs the person to accept its source or package agreements, do not accept them yourself. Show the person the message and the agreement links. They can either install from the official download page (nodejs.org, git-scm.com, libreoffice.org) or run the same `winget` command in their own PowerShell window and answer the agreement question there. Continue setup after they finish.
- If the installer asks for an administrator password, the person types it. You never do.
- On a Mac without Homebrew, do not install Homebrew yourself. Point the person to the installers at nodejs.org and git-scm.com instead.
- After installing Node.js or Git, the app usually cannot see it until it restarts. Say: "Please close and reopen this app, then open this folder again and say 'continue setup'." Then stop.

## 2. Create the workspace

Run the full check:

```
node app/cli.mjs doctor
```

Look at the check with `"id": "install"`.

- **ZIP download** (the detail says `not-git` or `incomplete`): run `node app/cli.mjs setup --convert-zip`. It adds Git's hidden `.git` folder to link this copy to the matching release so updates work, then runs the normal setup. It needs Git and an internet connection, and it leaves the app's files as they are. In the result, `git.pinned: true` means the copy matches the release exactly. If `pinned` is `false` and `differences` lists files, tell the person their copy differs from the published release and that updates may archive those files.
- **Anything else**: run `node app/cli.mjs setup`.

Setup is safe to run again. It creates the numbered folders, the database, the starter writing rules, the Word masters in `3 Templates/` and a separate demo workspace (made-up data, kept apart from the person's own). Add `--no-demo` if the person does not want the demo.

Run `node app/cli.mjs doctor --brief` again. The status should now be `onboarding-needed` or `ready`.

## 3. Show them around

Offer both:

- "Want to see a demo with a made-up person first?" `node app/cli.mjs start --demo`
- "Open your own dashboard?" `node app/cli.mjs start`

`start` reuses a dashboard that is already running and opens it in the browser. Use `--no-open` only if the person does not want a browser window. The dashboard only shows information; to change anything, the person tells you. Closing the browser tab does not stop the dashboard; `node app/cli.mjs stop` does.

## 4. Continue with onboarding

Say: "Next I'd like to ask a few questions about you and the jobs you want, so I never have to guess on an application. It takes about 15 minutes, and everything stays on this computer. Shall we start now?"

If yes, follow `app/skills/onboarding.md`. If not, tell them they can say "let's finish setting up" any time.

## Repair mode

Run `node app/cli.mjs doctor` and fix every check with `"ok": false`, in this order. Rerun `doctor --brief` after each fix.

| Check | Fix |
|---|---|
| `node` | Install Node.js 24+ (step 1), then ask the person to restart the app. |
| `git` | Install Git (step 1). |
| `install` (detail says `not-git` or `incomplete`) | `node app/cli.mjs setup --convert-zip`. It is safe to retry after an interrupted attempt. |
| `folders`, `database` | `node app/cli.mjs setup` |
| `templates` | `node app/cli.mjs op run docs.refresh-templates` |
| `database-open` | Explain the error in plain words. If it says the database is locked or busy, run `node app/cli.mjs stop` and try again. For any other error, stop and ask what they want to do. Never move, replace or rebuild `app/data/workspace.sqlite` without their clear yes. Backups are listed by the `backup.list` operation (see `app/skills/storage-and-backups.md`). |
| `profile`, `screening-answers` | Not repairs. Offer `app/skills/onboarding.md` when convenient. If the person prefers to leave something blank, do not keep asking in the same session. |
| `pdf` | Optional. Offer to install LibreOffice. |

If a fix fails, explain the error in plain words and stop. Do not try workarounds that delete or overwrite files.
