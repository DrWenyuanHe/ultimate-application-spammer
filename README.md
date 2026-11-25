# Ultimate Application Spammer

A private job-application workspace that lives in one folder on your computer. You open the folder in an AI assistant (Codex in the ChatGPT app, or Claude Code in the Claude desktop app) and talk to it in plain language. It finds job postings, checks them against what you want, tailors your resume and cover letter from your own documents and answers, fills in application forms, and keeps an exact copy of everything that was submitted.

Despite the joke name, it does not spam. It only applies to jobs you chose, with facts you gave it. By default it stops on every application's final page and waits for you to say "submit". You can let it submit on its own once every question has a saved answer, but it still stops whenever a form asks something new. You always sign in yourself; it never types passwords, solves "I'm not a robot" checks or pays fees.

## Quick start

1. **Download the latest release.** On the GitHub page, open **Releases** (right-hand side), pick the newest version and download **Source code (zip)**. Unzip it somewhere easy to find, such as your Documents folder. (If you use Git, clone the repository instead.)
2. **Open the folder in your assistant.**
   - ChatGPT desktop app: open **Codex** and choose this folder.
   - Claude desktop app: open the **Code** tab and choose this folder.
3. **Say "set me up".** The assistant checks what your computer needs, asks before installing anything, creates your private folders, and then asks about you, the jobs you want and the questions application forms usually ask.

After that, just say what you need.

## What the folders are

| Folder | What's in it |
|---|---|
| `1 Applications` | One folder per application that was submitted, with exactly what was sent. Drafts in progress are in `Drafts`. |
| `2 Career Library` | Put your resumes, CVs, cover letters, transcripts and award letters here so the assistant can read them. |
| `3 Templates` | The look of your resume and cover letter, the Word masters and your writing rules. |
| `4 Guides` | Job fields, typical job titles and where jobs are posted. These come with the app. |
| `Archive` | Anything moved out of the way. Nothing is ever deleted automatically. |
| `app` | The program itself. You don't need to open it. Your database and its backups are in `app/data`. |

To see your dashboard, say "open my dashboard", or double-click `Start Dashboard.cmd` (Windows) or `Start Dashboard.command` (Mac). The dashboard shows your jobs, stages, deadlines and progress. It is for looking only: to change anything, tell your assistant.

## What to say to your assistant

- "Set me up."
- "Show me the demo."
- "I put my old resumes in the Career Library folder. Read them."
- "Grill me on my experience." (It interviews you, one question at a time, to turn each job into specific examples with numbers.)
- "Find research coordinator jobs in Toronto, hybrid or remote."
- "Is this job a good fit for me? <link>"
- "What should I apply to next?" / "Am I on track for my goal?"
- "Help me apply to the Cedar Health job."
- "Always put my publications in the experience section." (It remembers corrections, so you don't repeat them.)
- "Submit it." or "I submitted it myself. Save what I sent."
- "I have an interview with Cedar Health. Help me prepare."
- "How much space is this using?" / "Back up my data."
- "Go back to the previous version."

## Privacy

- The app keeps everything in this folder on your computer: the database, its backups, your documents and your saved answers. There is no account, no cloud service of its own and no tracking.
- Your assistant (Codex or Claude) reads what it works on, such as your documents and answers, under that service's own privacy terms. Applications you ask it to submit go to the employer you chose.
- Updates are checked by asking GitHub for the list of release versions. Nothing about you is sent.
- Git is told to ignore your personal files (see `.gitignore`): `app/data/`, everything in folders 1–3 except their `README.md`, and `Archive/`. Updates never touch them. Anything you add to `4 Guides` is not protected this way, so keep personal notes elsewhere. If you copy or zip the whole folder to share it, your files go with it.
- Job pages, forms and emails are treated as information, never as instructions to the assistant.

## Backups and space

- Each time the dashboard starts, the app saves a snapshot of your database if the last one is more than a day old. It keeps two weeks of daily and a year of monthly snapshots. You can also ask it to copy every snapshot to a second folder, such as a USB drive.
- To back up everything, copy the whole folder to a drive or a cloud folder you trust. A cloud folder stores your private files with that provider.
- "Clean up" moves temporary and old files into `Archive/Clearable`. Delete that folder yourself when you want the space back. The assistant never deletes anything.

## Updates

When a new version is out, the assistant asks you once, after it finishes what it is doing: "Version X is available: … Install it now? (yes/no)". Say yes and it installs the update, backing up your database to `Archive/` first. Say no and it waits a week before asking again. If something goes wrong, say "go back to the previous version".

## FAQ

**Do I need to install anything?** Node.js (version 24 or newer) and Git. The assistant checks for them and offers to install them. You may need to restart the app once afterwards.

**Why won't it make a PDF?** PDF export needs LibreOffice (free, Windows or Mac) or Microsoft Word on Windows. Without either, you still get Word files; open one in Word and use Save as PDF.

**How do I empty the Archive?** Delete files from `Archive/` yourself whenever you like. Keep the newest "before vX.Y.Z database" backup if you might want to undo an update.

**Can it apply for me?** Yes, if you ask. It fills in the form after you sign in, stops on anything it has no answer for, and (unless you choose otherwise) waits for you to say "submit". It records every question and answer it sent.

**Will it make things up?** It is told never to invent facts, numbers, dates, credentials or form answers, and to ask you instead. Read your documents before they are sent.

## For contributors

- Requirements: Node.js 24+ and Git. There are no npm dependencies; use Node built-ins only.
- Run the checks: `node app/tests/check-repo.mjs` and `node --test "app/tests/**/*.test.mjs"` (`npm run check` runs both).
- Command-line help: `node app/cli.mjs help`. All workspace data is read and changed through operations (`node app/cli.mjs op list`, defined in `app/lib/operations.mjs`). A new capability is one new operation plus a test; the dashboard server stays read-only.
- Agent rules are in `AGENTS.md`; workflow playbooks are in `app/skills/`, with thin wrappers in `.claude/skills/` and `.agents/skills/`.
- Archive-only rule: code, tests and scripts never delete files. Anything that would be removed is moved to `Archive/`.
- Release process:
  1. Bump `version` in `package.json`.
  2. Add a `## X.Y.Z — YYYY-MM-DD` section at the top of `CHANGELOG.md`, written for non-technical users (the update prompt shows it).
  3. Commit, tag `vX.Y.Z` and push the tag.
  4. Publish a GitHub Release for the tag.

  Users only receive tagged releases, never unreleased work on `main`.

## License

MIT. See `LICENSE`.
