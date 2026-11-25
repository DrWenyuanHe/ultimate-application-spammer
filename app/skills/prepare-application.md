# Prepare an application

Use this when the person wants help applying to a job: tailoring a resume or CV, writing a cover letter, or drafting answers to application questions.

You prepare drafts and the person reads them. Submitting is a separate step (`app/skills/submit-application.md`). You never sign in or send messages for the person. All data changes go through operations (`AGENTS.md` section 4); run `op describe` for each operation before first use. Input files go in `app/data/tmp/` with new names.

**Keep questions few.** What the person put in (documents, answers, things they told you) is theirs, so use it without asking them to confirm it. Do the whole draft first, then raise what is left in the hand-over. Stop to ask only if this application needs something the library does not have.

## 1. Find the job

Find it with `jobs.list` and `{ "q": "Cedar" }`, then read it with `jobs.get` and `{ "id": "JOB_ID" }`.

If the job is not saved yet, open the posting and add it first (see "add a single job" in `app/skills/find-jobs.md`). Only if the stage is `Review`, mark it as in progress. For a later stage (for example revising documents after `Applied`), change only `nextAction`.

```json
{ "id": "JOB_ID", "patch": { "stage": "Preparing", "nextAction": "Draft tailored resume and cover letter" }, "expectedVersion": 2 }
```

```
node app/cli.mjs op run jobs.update --file app/data/tmp/job-patch-1.json
```

`expectedVersion` is the `version` you just read with `jobs.get`.

## 2. Read the brief

First make sure the posting is in the app: if `jobs.get` shows no `postingText`, open the posting and save its duties and qualifications word for word with `jobs.update` (`patch: { "postingText": "…" }`). It is what evidence is matched against, and what you reread before an interview.

Then run `brief.get` with `{ "applicationId": "JOB_ID", "materialKind": "resume" }`. The result contains:
- `application`: the saved posting, and `freshness` (whether it needs a recheck).
- `topMatches`: facts that share the posting's words, best first. Start here. It matches words only, so also scan the rest.
- `profile`: contact details and preferences. If papers are under another name (`publicationName`), say so once, in the publications line.
- `narratives`: saved resume angles. The suggested one lists the roles and achievements it leads with, and `suggestedBecause` says why. If `topMatches` holds stronger evidence that it lacks, follow the posting, not the narrative.
- `rules.active`: writing rules in force. Apply each one for its `materialKinds` when its `whenRelevant` fits. If a rule shows `evidenceChanged`, check its example against the current fact.
- `experiences` and `projects`, each with its `achievements`. Everything under a role is in one list; `under` names the project or item it belongs to. Every item has its story (`star`), numbers (`metrics`), saved `bullets`, ready `wording`, `cautions` and `gapsNoted` (what may not be claimed). Long records are cut (`more: true`); read the rest with `evidence.get` and `{ "ids": ["…"] }` before you rely on one.
- `otherEvidence`: education, skills, publications and the rest.
- `setAside`: facts whose sources disagree or that were replaced. Leave them out.
- `materials`, `previousSubmissions`, `checklist`, `guidance`.

## 3. Re-check the posting

Open the live employer posting again. Note whether it is still open, the closing date, the documents and fields it asks for, and any word limits. `postings.check` with `{ "jobIds": ["JOB_ID"] }` tells you quickly whether the link still works; if it answers `blocked` or `needs-browser-check`, open it yourself. Save what you checked:

```json
{ "id": "JOB_ID", "patch": { "postingStatus": "open", "lastChecked": "2026-11-25T16:02:00Z", "deadline": "2026-12-15", "postingCheckNote": "Asks for resume and cover letter; 2 screening questions, 150 words each." }, "expectedVersion": 3 }
```

If you could not open it, say so; do not assume.

## 4. Match qualifications to evidence

Save the match on the job with `jobs.update`. This is for you and for later interview preparation; show it in the hand-over, not as a question.

```json
{ "id": "JOB_ID", "expectedVersion": 4, "patch": { "qualificationMap": [
  { "qualification": "Participant recruitment", "required": true, "status": "met", "evidence": ["EVIDENCE_ID"], "note": "Lead with the enrolment result" },
  { "qualification": "REDCap", "required": true, "status": "partial", "evidence": ["EVIDENCE_ID_2"], "note": "Named in the 2024 CV; depth not stated" },
  { "qualification": "Ethics submissions", "required": false, "status": "gap" }
] } }
```

Pick the evidence that fits this job. Do not force the same examples into every application, and never paper over a gap. Prefer items with a result and a dated number. Keep `note` short: how to use the example, and what not to claim from it.

## 5. Fill only the gaps that matter

Ask only when a **required** qualification has no evidence, or when the document cannot be written without a fact. Ask everything in one short message, then carry on with the rest of the draft while you wait. Save each answer straight away; what the person tells you needs no second confirmation:

```json
{ "item": { "kind": "achievement", "title": "Prepared ethics amendment for an outpatient study", "organization": "Riverton General Hospital", "period": "2025", "content": "Drafted the amendment and consent form changes; the study lead submitted it.", "parentId": "EXPERIENCE_ID", "sources": [{ "label": "Told to the assistant", "locator": "chat, 2026-11-25" }] } }
```

While you work, improve the records you use: if one has only prose, copy its own facts into `star`, `metrics` and `gapsNoted` with `evidence.update` (no new facts, no need to ask). If a record's `cautions` cast doubt on a number another record states, set the plain one to `disputed`. If only one number in a good record is doubtful, keep the record and put the reason in that metric's `doubt`.

If the person corrects a saved fact, update it with `evidence.update`. If a newer figure replaces an older record, set the older one's `reviewStatus` to `outdated`; if two sources disagree and you cannot tell which is right, set both to `disputed` and mention it in the hand-over.

## 6. Write the content

The content shapes are in `app/templates/resume-master.json` and `app/templates/cover-letter-master.json`, and `3 Templates/Format Guide.md` explains them. Use `**bold**` and `*italic*` inside text.

### Choose what goes in

1. Start from the suggested narrative, if there is one: its order of roles and its achievements.
2. Swap in achievements that answer this posting better, and drop ones that do not.
3. Put the roles and bullets that answer required qualifications first. A section can hold bullets with no roles: for a job about grants, for example, open with `{ "heading": "Grant Development", "bullets": [{ "text": "**Field grant (2024).** …", "evidence": ["ID"] }] }`.
4. Aim for two pages, 18 to 24 bullets and 750 to 900 words unless the posting says otherwise. Give each accomplishment one home. When you are over, merge and cut what answers the posting least before you trim wording.

### Write each bullet

1. Look for a saved bullet on the record. If one fits, use it, adjusted only as this posting needs.
2. Otherwise build it from the record: **what they did** (`star.action`), **how big or with whom** (`star.situation`, `content`), **what came of it** (`star.result`, `metrics`).
3. Put in the number with its date and unit if the record has one. If it has no number, name the concrete outcome. If it has neither, describe the method or responsibility plainly; do not invent a result.
4. Credit the person fully and name others' roles (who led, who held the grant, which company earned it).
5. Keep it to one idea, about 20 to 35 words, starting with a strong verb in the right tense. No "I".
6. Read `cautions` and `gapsNoted` again, clause by clause. Cut any part they rule out, even if the rest of the bullet is solid. Keep qualifiers such as "approximately" or "at baseline".

| Weak | Why | Stronger |
|---|---|---|
| Responsible for participant recruitment. | A duty, no result | Ran evening screening calls for an outpatient study, raising enrolment from 40 to 65 in four months (2024). |
| Helped with a successful grant. | Understates and hides the outcome | Wrote the full proposal and generated its supporting data (PI: Dr. Example); funded for three years. |
| Combined surveys, interviews and statistics to study stream recovery. | Method only | Combined surveys, interviews and statistics into the region's first stream-recovery baseline, adopted by two councils. |
| Ran all partner outreach, building 30 partnerships. (Another record: "total unconfirmed".) | Joins a solid action to a doubtful number | Personally ran all partner outreach and negotiated the agreements with two city councils. |
| Studied coastal erosion. | Topic only | Wrote the first draft of a joint-first-author paper on coastal erosion (2021). |
| Built a tool. | No change shown | Replaced a shared spreadsheet that hid overdue cases with a stage board showing each next step. |

Name the records behind each role (`evidenceId`) and, where a bullet rests on a different record, on the bullet (`{ "text", "evidence": ["ID"] }`). The app then lists and pins the evidence for you and checks the numbers.

Resume, as a `docs.resume` input (`app/data/tmp/resume-JOB_ID-1.json`):

```json
{
  "applicationId": "JOB_ID",
  "save": true,
  "title": "Resume - Cedar Health Research Coordinator",
  "content": {
    "name": "Jordan Lee",
    "contact": ["Riverton", "(555) 010-0142", "jordan.lee@example.com"],
    "tagline": "Clinical research coordination",
    "summary": "Clinical research assistant with two years of participant recruitment and study documentation in outpatient trials.",
    "sections": [
      { "heading": "Research Experience",
        "entries": [ { "title": "Clinical Research Assistant", "organization": "Riverton General Hospital", "unit": "Outpatient Research", "dates": "2023 – present", "evidenceId": "EXPERIENCE_ID",
                       "bullets": [
                         { "text": "Ran evening screening calls for an outpatient study, raising enrolment from 40 to 65 participants (March–June 2024).", "evidence": ["ACHIEVEMENT_ID"] },
                         "Drafted an ethics amendment and consent form changes that the study lead submitted." ] } ] },
      { "heading": "Education", "type": "education",
        "entries": [ { "title": "BSc, Health Sciences", "organization": "Riverton University", "dates": "2022" } ] },
      { "heading": "Skills", "paragraphs": ["**Data:** REDCap, Excel"] }
    ]
  }
}
```

Section options: `evidence` (records behind its intro, paragraphs or bullets), `intro` (one line under the heading), `type: "education"`, `paragraphs`, `bullets`, `pageBreakBefore: true`. Entry options: `title`, `organization`, `unit`, `dates`, `note`, `evidenceId`, `bullets`.

Cover letter (`docs.cover-letter`, same outer fields): `content` has `name`, `heading` ("Application for …"), `contact`, `date`, `recipient` (lines), `salutation`, `paragraphs` (4–5 short ones, about 280–380 words), `closing`, `signature`. Say how the person meets the main qualifications, with evidence, and why they want this role.

Never shrink fonts to fit a page count. Cut repetition and weaker examples, but keep the substance of roles that matter. To change the look, change the format files in `3 Templates/` with the person (then run `docs.refresh-templates`), not the content.

### Academic CV

Use `docs.cv` (same content as a resume, any length). Run `publications.report` first: it groups publications by status (published, accepted, preprint, submitted, in preparation) and lists what each citation still needs. Keep the groups separate, never turn a count into invented citations, and list only citations with authors, title, venue and year. Add teaching, mentoring, grants, presentations, service and awards when the posting wants them. Mention missing citation details in the hand-over.

## 7. Build the documents

```
node app/cli.mjs op run docs.resume --file app/data/tmp/resume-JOB_ID-1.json
node app/cli.mjs op run docs.cover-letter --file app/data/tmp/letter-JOB_ID-1.json
```

Read `bulletNotes` in the result and fix what they point out: a number that is not in the evidence or that another record doubts (`number-in-doubt`), a dropped `qualifier`, a missing date or outcome, a weak or repeated start, too many bullets or words. They are notes, not rules; keep a bullet as it is if you have a good reason. (`bullets.check` gives the same notes without building a file.)

Then make a PDF of each `.docx` the result names, with `docs.pdf`:

```json
{ "file": "1 Applications/Drafts/Cedar Health Network - Research Coordinator/Jordan Lee Resume.docx" }
```

- For layout rounds, build previews with `"out": "app/data/tmp/preview-JOB_ID-1.docx"` and no `save`. Build the final one into Drafts with `save: true`.
- Files go to `1 Applications/Drafts/<Employer - Role>/`. Existing files are never replaced; a new copy gets a number, such as `Jordan Lee Resume (2).docx`. Use the exact path the result prints.
- `save: true` stores the content and file in the career library as a material. The result's `material` shows its `id` and `version`. For a revision of the same document, add `"materialId": "MATERIAL_ID"` and `"expectedVersion": N` so it becomes the next version instead of a new material.
- `pdf: true` in `docs.resume` does both steps at once, but if the PDF step fails, nothing is saved to the library. The two-step form is safer.
- If PDF export fails (for example, no converter is installed), keep the `.docx`, tell the person, and offer to install LibreOffice (`app/skills/setup.md`).

Written answers to application questions are saved with `materials.save`, with the question as `prompt` and the form's limit as `wordLimit`:

```json
{ "material": { "kind": "answer", "title": "Cedar Health - Why this role", "prompt": "Why do you want this role?", "wordLimit": 150, "content": "…", "applicationId": "JOB_ID", "evidenceRefs": ["EVIDENCE_ID_1"] } }
```

## 8. Check every document

1. Run `docs.check` with `{ "file": "…docx", "materialId": "MATERIAL_ID" }`. `placeholdersLeft` must be empty and `matchesSaved` true. Check `fonts`, `sizesPt` and `words` against the format file and any word limit.
2. Look at every page of every PDF as an image (open the PDF with your own file tools, or turn it into images with `pdftoppm -png` if it is installed). `docs.pdf` returns the page count. Check for clipped or overlapping text, missing characters, a heading stranded at the bottom of a page, a large blank area while relevant evidence is unused, dates colliding with titles, roles formatted differently from each other, and the page count.
3. Contact details, dates and figures must match across all documents.
4. Check that it still sounds like the person and that each role that matters kept its substance.
5. Do an independent review pass: a second agent or a fresh read that compares each document with the posting and the evidence. It goes clause by clause, for overstatement and understatement: factual scope, denominators and qualifiers, attribution (who did what, who held the grant), chronology, fit, repeated phrasing and layout. Apply its suggestions only if they add no new claim.
6. Fix problems in a new input file and build again.

## 9. Hand over

In one message: where the files are (name the final ones; earlier numbered drafts stay in the folder), what you emphasised and why, the gaps, and any conflicting facts you left out. Ask them to read everything and change anything that does not sound like them. If the stage is `Preparing` and every document the posting asks for is ready, move it to `Ready` with `jobs.update` (`"patch": { "stage": "Ready", "nextAction": "Read documents and submit" }`).

If they go ahead after you showed them the documents and answers, that is their approval. Do not ask for it again item by item.

Keep wording that worked, so the next application starts from it:

```json
{ "items": [{ "evidenceId": "ACHIEVEMENT_ID", "text": "Ran evening screening calls for an outpatient study, raising enrolment from 40 to 65 participants (March–June 2024).", "usedFor": "Cedar Health Research Coordinator" }] }
```

```
node app/cli.mjs op run bullets.save --file app/data/tmp/bullets-1.json
```

If this resume is a good angle for a kind of job, save it as a narrative with `narratives.save` (`label`, `headline`, `summary`, `capabilities`, `disciplines`, and `experience` as `[{ "evidenceId", "achievements": ["ID"] }]`).

Optional: when the person says the documents are final, freeze the exact versions, posting and facts with `packets.create`. It may return `warnings`, such as a fact that changed since; fix what matters and mention the rest.

```json
{ "applicationId": "JOB_ID", "items": [{ "materialId": "MATERIAL_ID", "version": 2 }], "answers": [{ "question": "Why this role?", "answer": "…" }] }
```

Then ask how they want to submit:
- "I'll submit it myself": afterwards, follow `app/skills/record-submission.md`.
- "Submit it for me": follow `app/skills/submit-application.md`, which uses their saved submission mode.

## When the person corrects something

1. Fix it everywhere it appears in this application: summary, bullets, letter and answers.
2. If it is a fact, update the career-library record (`evidence.update`), so every later document is right too.
3. If it is about how to write or lay things out, and it would apply to other documents, save it as a rule straight away with `rules.save`. Their words are the approval, so do not ask "should I keep this as a rule?". Say in one line that you saved it.

   ```json
   { "rule": { "title": "Publications inside research experience", "rule": "Put the publication count and journals in the research experience section.", "whenRelevant": "Research resumes", "materialKinds": ["resume"] }, "approvalText": "put my publications in the experience section", "approvalSource": "chat, 2026-11-25" }
   ```

- Write the rule in words that match what they said, without adding to it.
- If it clearly belongs to one job only, add `"applicationIds": ["JOB_ID"]`; for one kind of job, `"narrativeIds": ["NARRATIVE_ID"]`. When you cannot tell, limit it to this job.
- To replace a rule's wording, pass its `id`. To turn a rule off, only when the person asks: `rules.retire` with `{ "id", "reason" }`.
- Use `rules.propose` only for your own ideas. A proposed rule is not used until the person says yes.
