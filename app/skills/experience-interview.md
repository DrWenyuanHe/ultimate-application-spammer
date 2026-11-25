# Experience interview

Use this when the person wants to strengthen their experience ("grill me on my experience", "help me make my resume stronger"), after importing documents, when a job search shows key evidence is weak, or before an interview to rehearse STAR stories.

You interview the person, one question at a time, until each important experience is a specific, checkable story: what the situation was, what they were responsible for, what they personally did, and what changed, with numbers and dates. You never supply the facts yourself.

## 1. Pick where to start

```
node app/cli.mjs op run evidence.strength
node app/cli.mjs op run profile.get
```

`evidence.strength` lists experiences, projects and achievements, weakest first. Each has a `score` (0–100) and `missing`: any of `situation`, `task`, `action`, `result`, `measuredResult` (a metric with value, unit and period) and `evidence` (a source).

Start with the weakest items that matter most for the jobs the person wants (`disciplines` in the profile, or the job they are applying to). Tell them which one you are starting with and why, and that they can stop any time.

## 2. Interview, one question at a time

Ask one question, wait for the answer, then ask the next. Cover, in roughly this order:

- **Situation:** "What was going on when you started this? What was the problem or goal?"
- **Task:** "What were you responsible for, specifically?"
- **Action:** "What did you do, step by step? What did you decide yourself?"
- **Result:** "What changed because of it? How do you know?"
- **Numbers:** "Roughly how many?" Then, only if still open: "Over what period?" Then: "Compared with what before?" Get the unit and the time frame (per week, per year, in total). Each of these is its own question.
- **Scope:** team size, budget, number of users, sites or partners.
- **Your part versus the team's:** "Which parts were yours, and which were the team's or your manager's?"
- **Proof:** "Where could an employer check this? A report, a publication, a reference, a public page?"

Push back on vague answers, politely and firmly:
- "You said you 'improved efficiency'. Improved what, by how much, and how did you measure it?"
- "'We launched it': what was your own part?"
- "Is that number for the whole team or for you?"

Never put words in their mouth. Do not suggest numbers, outcomes or titles. If they do not know a number, accept "I don't know" and note it as a gap. If they give a range or an estimate, record it as one.

## 3. Save after each experience

When an experience is done, read back the wording you will save and ask the person to confirm it. Then update the record with `evidence.update`. First read the full record with `evidence.list` (use `q` with its title): you need its current `version`, and you must keep its existing `sources`, `metrics` and `gapsNoted` in the new lists, since these fields are replaced as a whole. Read back the complete wording before marking it confirmed. Input file `app/data/tmp/interview-1.json`:

```json
{
  "id": "EVIDENCE_ID",
  "expectedVersion": 3,
  "patch": {
    "star": {
      "situation": "Enrolment for an outpatient study was 30% behind target six months in.",
      "task": "Responsible for screening and booking eligible patients.",
      "action": "Proposed and ran evening screening calls twice a week; rewrote the call script with the study nurse.",
      "result": "Enrolment rose from 40 to 65 participants in four months and the study met its target."
    },
    "metrics": [
      { "value": "40 to 65", "unit": "participants enrolled", "period": "March–June 2024", "baseline": "40", "source": "study enrolment log", "note": "the person's own count" }
    ],
    "sources": [{ "label": "Study enrolment log", "locator": "monthly report, June 2024" }],
    "gapsNoted": ["Unsure whether the target was 60 or 65"],
    "reviewStatus": "candidate-confirmed"
  }
}
```

```
node app/cli.mjs op run evidence.update --file app/data/tmp/interview-1.json
```

- Set `reviewStatus` to `candidate-confirmed` only when the person has confirmed the final wording. Otherwise leave it as `needs-review`.
- Put anything unresolved in `gapsNoted`.
- A new example that is not in the library yet: add it with `evidence.add` (with `parentId` set to the job's `id`).
- `star`, `metrics` and `sources` are saved as whole fields. To change one metric, send the full list.

Run `evidence.strength` again and move to the next item. Every few items, tell the person how the average has changed and ask whether to continue.

## 4. Before an interview

To rehearse, pick the 3–5 stories that best match the job (use the application's folder in `1 Applications/` to see what was submitted). Ask the person to tell each story aloud in about two minutes, then give short feedback: was the situation clear, was their own action clear, was there a number, did they finish with the result? Do not change saved facts during rehearsal unless they correct something.
