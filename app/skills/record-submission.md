# Record a submitted application

Use this when the person says they applied or submitted an application themselves, wants to save what they sent, or is preparing for an interview. If you submitted it for them, `app/skills/submit-application.md` already recorded it.

The goal is a faithful copy of exactly what was filed, so the person can reread it before an interview. A draft, a prepared document or the `Applied` stage on its own is not a record of what was submitted.

## 1. Confirm first

Record a submission only after the person tells you they actually submitted it. If they are unsure (the page timed out, they did not see a confirmation), say so and do not record it yet. Suggest they check their email or the employer's portal.

## 2. Collect what was filed

Ask, in plain words, and only for what applies:

1. **Which files did you upload?** Point to the exact files. If they edited a draft before uploading, ask for the version they uploaded (for example, downloaded back from the employer's portal). Do not assume the newest draft in `1 Applications/Drafts/` is what was sent.
2. **Did you paste any text** into the form (a cover letter, a summary, a message)? Ask them to paste it to you exactly.
3. **Questions on the form:** every question exactly as worded, the answer they chose or typed, and whether it was required. Saved answers (`answers.get`) can remind them what they usually answer, but record only what they say they actually entered.
4. **When did you submit?** Use the precision they actually know: `2026-11-25`, or `2026-11` if they only know the month, or `2026` if only the year. Never invent a day or month.
5. **How?** For example the employer's portal, Workday, email, or a referral.
6. **Confirmation:** the confirmation page text, a confirmation email, or a reference number. Ask them to paste it or save it as a file.

Never ask for or record passwords, sign-in codes or account details.

Anything you cannot get goes in `gaps`, named plainly. Never rebuild a missing item from a draft and present it as what was filed.

`files` is only for documents the person actually uploaded or attached. Confirmation text goes in `receipt`. If you saved a copy of the posting text when you checked it, keep it as a separate reference with `materials.save`, not in `files`:

```json
{ "material": { "kind": "other", "title": "Posting text as checked 2026-11-25 - Cedar Health Research Coordinator", "content": "…", "applicationId": "JOB_ID" } }
```

```
node app/cli.mjs op run materials.save --file app/data/tmp/posting-JOB_ID-1.json
```

## 3. Save the record

All changes go through operations (`AGENTS.md` section 4). Find the job's ID with `jobs.list` and `{ "q": "EMPLOYER" }`. If the job was never saved, add it first with `jobs.add` (see `app/skills/find-jobs.md`).

Write a new input file for `submissions.record`, for example `app/data/tmp/submission-JOB_ID-1.json`:

```json
{
  "applicationId": "JOB_ID",
  "confirmedBySubmitter": true,
  "submittedBy": "person",
  "submittedAt": "2026-11-25",
  "method": "portal-form",
  "files": [
    "1 Applications/Drafts/Cedar Health Network - Research Coordinator/Jordan Lee Resume.pdf",
    "1 Applications/Drafts/Cedar Health Network - Research Coordinator/Jordan Lee Cover Letter.pdf"
  ],
  "pastedText": [
    { "label": "Message to the hiring team", "text": "Exactly what they pasted." }
  ],
  "answers": [
    { "question": "Are you legally entitled to work in Canada?", "answer": "Yes", "required": true, "source": "asked the person" },
    { "question": "Describe your experience with participant recruitment (150 words).", "answer": "Exactly what they typed.", "required": true, "source": "asked the person" }
  ],
  "receipt": "Thank you for applying. Your application for Research Coordinator (R-2231) has been received.",
  "gaps": ["Did not keep a copy of the portal's education section."]
}
```

Optional fields:
- `"packetId": "PACKET_ID"` if the documents were frozen in a packet (`app/skills/prepare-application.md`). This only links the packet. Still list the uploaded files in `files` and the answers in `answers`.
- `"historical": true` for an application submitted in the past whose details are being reconstructed now. Name what is missing in `gaps`.

```
node app/cli.mjs op run submissions.record --file app/data/tmp/submission-JOB_ID-1.json
```

This:
- copies each file, unchanged, into a new folder named after the date and job, such as `1 Applications/2026-11-25 Cedar Health Network - Research Coordinator/` (or `2026-11 …` when only the month is known), with its SHA-256 fingerprint;
- writes `submission.json` and a readable `What I submitted.md` in that folder;
- moves the job to `Applied` (it never moves a later stage backwards), which the dashboard then shows.

Tell the person where the folder is and list any gaps.

## 4. Later changes

The first record is never edited. If the person later submits again (a corrected document, an extra document requested through the portal, or a second application), record that as a new submission with its own date; it gets its own folder. An ordinary follow-up, such as a thank-you or a status question, is not a submission: note it on the job instead.

To note a follow-up date or next step:

```json
{ "id": "JOB_ID", "patch": { "nextAction": "Follow up if no reply", "followUpOn": "2026-12-09" }, "expectedVersion": 4 }
```

```
node app/cli.mjs op run jobs.update --file app/data/tmp/job-patch-2.json
```

## 5. Interview preparation

When the person gets an interview:

1. Check the stage with `jobs.get`. If it is `Applied`, move it to `Interview` with `jobs.update`. Never move a later stage (such as `Offer`) backwards.
2. Open the folder in `1 Applications/` for this job. Read `What I submitted.md` and the filed documents. These are what was sent; the newest drafts may differ.
3. Re-open the posting if it is still online, and use the career library (`evidence.list`) for examples.
4. Prepare likely questions and answers from what was filed and from confirmed evidence only.
