# Prepare an application

Use this when the person wants help applying to a job: tailoring a resume or CV, writing a cover letter, or drafting answers to application questions.

You prepare drafts and the person reviews them. Submitting is a separate step (`app/skills/submit-application.md`). You never sign in or send messages for the person. All data changes go through operations (`AGENTS.md` section 4); run `op describe` for each operation before first use. Input files go in `app/data/tmp/` with new names.

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

Run `brief.get` with `{ "applicationId": "JOB_ID" }`. The result contains:
- `application`: the saved posting details.
- `profile`: contact details and preferences.
- `rules.active`: writing rules in force. Apply each one only for its `materialKinds` and when its `whenRelevant` condition fits.
- `rules.proposed`: suggestions the person has not approved. Do not apply them silently. You may mention one if it would help ("Would you like me to date every metric?").
- `evidence`: every career fact, with `reviewStatus`. Only `candidate-confirmed` and `source-verified` facts can go into a document.
- `templates`, `previousSubmissions`, `checklist`.

## 3. Re-check the posting

Open the live employer posting again. Note whether it is still open, the closing date, the documents and fields it asks for, and any word limits. Save what you checked with `jobs.update`:

```json
{ "id": "JOB_ID", "patch": { "postingStatus": "open", "lastChecked": "2026-11-25T16:02:00Z", "deadline": "2026-12-15", "postingCheckNote": "Asks for resume and cover letter; 2 screening questions, 150 words each." }, "expectedVersion": 3 }
```

If you could not open it, say so; do not assume.

## 4. Map qualifications to evidence

Make a short table and show it to the person:

| Posting asks for | Evidence (ID) | Status |
|---|---|---|
| Participant recruitment | Clinical Research Assistant (EVIDENCE_ID) | confirmed |
| REDCap | skill: REDCap (EVIDENCE_ID) | needs review |
| Ethics submissions | none | gap |

Pick the evidence that fits this job. Do not force the same examples into every application. Name every gap; never paper over one. Prefer examples with complete STAR fields and dated metrics (`evidence.strength` shows each record's score). If the evidence for a key requirement is thin, offer a short experience interview on it first (`app/skills/experience-interview.md`).

Anything marked `needs-review` stays out of the documents until the person confirms it. Ask ("Your old resume lists REDCap. Is that right, and how did you use it?"), then update the record to `candidate-confirmed` (step 5). `source-verified` means the fact was checked against an official document, such as a degree certificate or a published paper.

## 5. Ask about missing facts

Ask short, specific questions: "Have you prepared an ethics submission? Roughly when, and what was your part?" Save each answer as evidence the person has confirmed, with `evidence.add`:

```json
{ "item": { "kind": "achievement", "title": "Prepared ethics amendment for an outpatient study", "organization": "Riverton General Hospital", "period": "2025", "content": "Drafted the amendment and consent form changes; the study lead submitted it.", "parentId": "EXPERIENCE_ID", "sources": [{ "label": "Told to the assistant", "locator": "chat, 2026-11-25" }], "reviewStatus": "candidate-confirmed" } }
```

Confirmations and corrections to an existing record use `evidence.update`:

```json
{ "id": "EVIDENCE_ID", "patch": { "reviewStatus": "candidate-confirmed" }, "expectedVersion": 1 }
```

## 6. Write the content

The content shapes are in `app/templates/resume-master.json` and `app/templates/cover-letter-master.json`, and `3 Templates/Format Guide.md` explains them. Use `**bold**` and `*italic*` inside text.

Resume, as a `docs.resume` input (`app/data/tmp/resume-JOB_ID-1.json`):

```json
{
  "applicationId": "JOB_ID",
  "save": true,
  "title": "Resume - Cedar Health Research Coordinator",
  "evidenceRefs": ["EVIDENCE_ID_1", "EVIDENCE_ID_2"],
  "content": {
    "name": "Jordan Lee",
    "contact": ["Riverton", "(555) 010-0142", "jordan.lee@example.com"],
    "tagline": "Clinical research coordination",
    "summary": "Clinical research assistant with two years of participant recruitment and study documentation in outpatient trials.",
    "sections": [
      { "heading": "Research Experience",
        "entries": [ { "title": "Clinical Research Assistant", "organization": "Riverton General Hospital", "unit": "Outpatient Research", "dates": "2023 – present",
                       "bullets": ["**Recruitment.** Screened and consented participants for two outpatient studies.", "Drafted an ethics amendment and consent form changes that the study lead submitted."] } ] },
      { "heading": "Education", "type": "education",
        "entries": [ { "title": "BSc, Health Sciences", "organization": "Riverton University", "dates": "2022" } ] },
      { "heading": "Skills", "paragraphs": ["**Data:** REDCap, Excel"] }
    ]
  }
}
```

Section options: `intro` (one line under the heading), `type: "education"`, `paragraphs`, `bullets`, `pageBreakBefore: true`. Entry options: `title`, `organization`, `unit`, `dates`, `note`, `bullets`.

Cover letter (`docs.cover-letter`, same outer fields): `content` has `name`, `heading` ("Application for …"), `contact`, `date`, `recipient` (lines), `salutation`, `paragraphs` (4–5 short ones, about 280–380 words), `closing`, `signature`.

Never shrink fonts to fit a page count. Cut or tighten instead. To change the look, change the format files in `3 Templates/` with the person (then run `docs.refresh-templates`), not the content.

## 7. Build the documents

```
node app/cli.mjs op run docs.resume --file app/data/tmp/resume-JOB_ID-1.json
node app/cli.mjs op run docs.cover-letter --file app/data/tmp/letter-JOB_ID-1.json
```

Then make a PDF of each `.docx` the result names, with `docs.pdf`:

```json
{ "file": "1 Applications/Drafts/Cedar Health Network - Research Coordinator/Jordan Lee Resume.docx" }
```

- Files go to `1 Applications/Drafts/<Employer - Role>/`. Existing files are never replaced; a new copy gets a number, such as `Jordan Lee Resume (2).docx`. Use the exact path the result prints.
- `save: true` stores the content and file in the career library as a material. The result's `material` shows its `id` and `version`. For a revision of the same document, add `"materialId": "MATERIAL_ID"` and `"expectedVersion": N` so it becomes the next version instead of a new material.
- `pdf: true` in `docs.resume` does both steps at once, but if the PDF step fails, nothing is saved to the library. The two-step form is safer.
- If PDF export fails (for example, no converter is installed), keep the `.docx`, tell the person, and offer to install LibreOffice (`app/skills/setup.md`).

Written answers to application questions are saved with `materials.save`:

```json
{ "material": { "kind": "answer", "title": "Cedar Health - Why this role", "content": "…", "applicationId": "JOB_ID", "evidenceRefs": ["EVIDENCE_ID_1"] } }
```

When the person approves the exact text of an answer, save it again as a new version of the same material with `"reviewStatus": "approved"` inside `material` (and the material's `id` and `expectedVersion`). Only approved answers can be used when submitting.

## 8. Check every document

1. Run `docs.check` with `{ "file": "…docx" }`. `placeholdersLeft` must be empty. Check `fonts`, `sizesPt` and `words` against the format file and any word limit.
2. Look at every page of every PDF as an image. Check for clipped or overlapping text, missing characters, a heading stranded at the bottom of a page, dates colliding with titles, and the page count.
3. Contact details must match across all documents.
4. Check that the content still sounds like the person and uses only confirmed facts.
5. Do an independent review pass: a second agent or a fresh read that compares each document with the posting and the evidence. It checks factual scope, attribution (who did what, who held the grant), chronology, fit and layout. Apply its suggestions only if they add no new claim.
6. Fix problems in a new input file and build again.

## 9. Hand over

Tell the person where the files are, what you emphasised and why, and the gaps they may want to address. Ask them to read everything, and to change anything that does not sound like them. If the stage is `Preparing`, move it to `Ready` with `jobs.update` (`"patch": { "stage": "Ready", "nextAction": "Read documents and submit" }`).

Optional: when the person says the documents are final, freeze the exact versions with `packets.create`:

```json
{ "applicationId": "JOB_ID", "items": [{ "materialId": "MATERIAL_ID", "version": 2 }], "answers": [{ "question": "Why this role?", "answer": "…" }] }
```

Then ask how they want to submit:
- "I'll submit it myself": afterwards, follow `app/skills/record-submission.md`.
- "Submit it for me": follow `app/skills/submit-application.md`, which uses their saved submission mode.

## Writing preferences the person gives you

When the person states a preference that should apply to future documents ("always put my publications in the experience section"):

1. Write the rule in words that match what they said, without adding to it. Show it and ask once: "Should I keep this as a rule for future resumes: 'Put my publications in the experience section'? (yes/no)"
2. Only if they clearly say yes, propose it with `rules.propose`:

   ```json
   { "rule": { "title": "Publications inside research experience", "rule": "Put publications in the experience section.", "rationale": "The person's stated preference.", "whenRelevant": "Resumes that mention publications", "materialKinds": ["resume"] } }
   ```

3. Then approve it with `rules.approve`, using the `id` and `version` from the result:

   ```json
   { "id": "RULE_ID", "version": 1, "approvalText": "THEIR EXACT REPLY", "approvalSource": "chat, YYYY-MM-DD" }
   ```

- `approvalText` is the person's actual reply, quoted; `approvalSource` is where and when they said it.
- To change an existing rule's wording: `rules.revise` with `{ "id", "rule": {…} }`, then approve the new version the same way. The old wording stays in force until then.
- To turn a rule off, only when the person asks: `rules.retire` with `{ "id", "reason" }`.
- Silence, "looks good" about a document, or a one-off edit is not approval of a rule. A preference for one application stays with that application.
