# Onboarding

Use this right after setup, when the start-up check says `onboarding-needed`, or when the person says "let's finish setting up my profile".

Onboarding has four parts. Do them in order, but let the person stop at any point and pick up later; saved answers are kept.

1. About you and the jobs you want (profile).
2. The questions application forms usually ask (saved answers).
3. Your documents (resumes, CVs and so on).
4. An optional experience interview.

Start by explaining: "The app keeps your answers on this computer, in this folder. I (your assistant) read them while we work, under the privacy terms of the app you are using (ChatGPT or Claude), and I use them only for applications you choose, so I never have to guess. You can skip anything and change any answer later."

If the person skips a part, do not ask about it again in the same session.

Ask one or two questions at a time, in plain words. Never guess an answer, and never fill one in from a document without asking.

## 1. Profile

Check what is already saved: `node app/cli.mjs op run profile.get` (operations that need no input take no `--file`). Ask only what is missing:

1. Your full name, and the name you like to be called.
2. The email and phone number you use for job applications.
3. The city you live in.
4. What kinds of jobs are you looking for? (Fields or job types. `4 Guides/` has examples if they are unsure.)
5. Where would you work? (Cities, regions, or "remote".)
6. Remote, hybrid or on-site?
7. Anything else about the job you want: permanent or contract, full-time or part-time, things to avoid.
8. Optional: links for your resume (LinkedIn, portfolio).
9. **How should I submit applications?** Explain both choices plainly:
   - "**Check first** (recommended): I fill in the whole application, then stop on the last page so you can look it over. I only press Submit when you tell me to."
   - "**Submit for me**: once every question has a saved answer, I submit without waiting for you. I still stop and ask whenever a form asks something new."
   - Either way: "You always sign in yourself. I never type passwords, solve 'I'm not a robot' checks or pay fees, and I keep an exact copy of everything sent."

   Save `"review-first"` for check first and `"auto-submit"` for submit for me. If they are unsure, use `"review-first"`.

Write the answers to a new input file, for example `app/data/tmp/profile-1.json`. Only the fields that change go inside `fields`:

```json
{
  "fields": {
    "name": "Jordan Lee",
    "preferredName": "Jordan",
    "email": "jordan.lee@example.com",
    "phone": "(555) 010-0142",
    "city": "Riverton",
    "links": ["https://www.linkedin.com/in/example"],
    "headline": "Clinical research assistant moving into research coordination",
    "disciplines": ["Research coordination", "Clinical research"],
    "locations": ["Riverton", "Remote within the country"],
    "workModels": ["Hybrid", "Remote"],
    "employmentPreferences": "Permanent full-time preferred; open to a one-year contract if it is a clear step up.",
    "searchNotes": "Avoid roles that are only lab bench work.",
    "submissionMode": "review-first"
  }
}
```

```
node app/cli.mjs op run profile.set --file app/data/tmp/profile-1.json
```

Running `profile.set` again later merges new fields into the saved profile.

## 2. Common application questions

```
node app/cli.mjs op run answers.get
```

The result lists every question in the bank (`app/templates/screening-questions.json`) with its `id`, `category`, `options`, whether it is `required`, `sensitive` or `voluntary`, and any saved `answer`. `missingRequired` lists what is still needed.

- Go category by category (Eligibility, Background checks, Availability, Compensation, Languages, Education, References, History, Accommodation, Voluntary self-identification). Ask a few questions at a time.
- For choice questions, offer the listed options in plain words. For multi-choice questions, save a list.
- Ask a question only when it applies (for example, permit expiry only if they hold a permit).
- **Sensitive questions** (criminal record, references, accommodation, self-identification): ask gently, say why forms ask, and say they can answer now or later. If they skip a required one, any form that asks it will stop and wait for them.
- **Voluntary self-identification** already defaults to "Prefer not to say". Only change it if the person wants to.
- The bank is written for Canada. If the person lives elsewhere, say so, answer what fits, and save their own wording for questions like work eligibility in `custom`.

Save after each category, in a new file:

```json
{
  "answers": {
    "work-eligibility": "Yes",
    "work-status": "Permanent resident",
    "sponsorship": "No",
    "work-models": ["Hybrid", "Remote"],
    "notice-period": "Two weeks",
    "salary-expectation": "CAD 65,000–72,000, negotiable"
  },
  "custom": [
    { "question": "Are you legally entitled to work in the United States?", "answer": "No" }
  ]
}
```

```
node app/cli.mjs op run answers.set --file app/data/tmp/answers-1.json
```

New answers are merged into the saved ones. If the result reports a conflict, run `answers.get` again and add `"expectedVersion": N` to the input, using the `version` it shows.

## 3. Documents

Ask: "Please put all your resumes, CVs, cover letters, transcripts, award letters and portfolio pieces into the `2 Career Library` folder. Older versions help too; they often mention things the newest one left out. Tell me when they're in."

Then follow `app/skills/import-documents.md`.

## 4. Experience interview (optional)

When the import is done, offer: "Would you like me to interview you about your experience? I'll ask one question at a time to turn each job into specific examples with numbers, which makes every application stronger. It takes 20–40 minutes and you can stop any time."

If yes, follow `app/skills/experience-interview.md`.

## Finish

Run `node app/cli.mjs doctor --brief`. Then end with:

> You're all set. You can ask me things like:
> - "Find research coordinator jobs in Riverton."
> - "Help me apply to this job: <link>."
> - "How strong is my experience for this kind of job?"
