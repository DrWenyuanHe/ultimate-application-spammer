# Find and screen jobs

Use this when the person wants to find, search for, screen, shortlist or add jobs ("find research coordinator jobs in Toronto", "is this job a good fit?", "add this job: <link>").

You find and judge postings. You do not apply here, sign in to job sites or contact anyone. All data changes go through operations (`AGENTS.md` section 4); run `op describe` for each operation before first use. Input files go in `app/data/tmp/` with new names.

## 1. Know what they want

```
node app/cli.mjs op run profile.get
```

Use `disciplines`, `locations`, `workModels`, `employmentPreferences` and `searchNotes`. If the profile is empty or the request is vague, ask two or three quick questions (job type, place, remote/hybrid/on-site). Save useful answers with `profile.set` (see `app/skills/onboarding.md`).

Write down the criteria you will use in one or two lines and give them a label, the **criteria version**, for example `2026-11-25-coordinator-riverton`. Use the same label for the whole batch. It lets a later check tell which rules were used.

`4 Guides/` lists fields, typical job titles and where jobs are posted. Use it to widen a narrow search.

## 2. Collect candidate postings

Use one or more of these. Discovery results are leads, not verified facts.

**a. Employer job boards (fastest).** `employers.list` shows the employers being tracked. `discover.run` pulls current postings from a board:

```json
{ "url": "https://boards.greenhouse.io/examplelab", "keyword": "research", "location": "Riverton" }
```

```
node app/cli.mjs op run discover.run --file app/data/tmp/discover-1.json
```

- Instead of `url`, you can pass `employerId` (from `employers.list`), or `platform` and `board`. `url` works for Greenhouse, Lever, Ashby, SmartRecruiters and Workday links; use it for Workday. Other sites: use a browser or web search.
- `platform: "jobbank"` with a `keyword` searches Canada's Job Bank. It is a listing service: treat its results as leads, and screen a job only after you find and open the employer's own posting.
- The result has `candidates` and `diagnostics`. Read `diagnostics` and tell the person about boards that failed or results that were cut off.
- To track a new employer, use `employers.add` with `{ "employer": { "name": "…", "sector": "…", "careersUrl": "https://…" } }`. `employers.sectors` and `employers.import-guide` add employers from the bundled guide; only when the person asks.

**b. Web search.** Search for postings, then follow each result to the employer's own posting page or official job board. Use aggregator pages only to find the employer's link. Never put the person's name, email or other personal details in a search.

**c. A search noted for later.** If the person wants a search saved to run later ("remind me to look for these"), record it with `search.queue`:

```json
{ "title": "Coordinator roles, Riverton", "query": "research coordinator", "location": "Riverton" }
```

A queued search runs once, when an assistant picks it up; nothing repeats on a schedule. Tell the person that. To work on one: `search.claim` (keep the `claimToken` from the result), do steps 3 to 5, then within 30 minutes finish it with `search.complete`:

```json
{
  "taskId": "TASK_ID",
  "claimToken": "CLAIM_TOKEN",
  "summary": "Checked 3 employer boards: 1 shortlisted, 1 rejected (on-site only), 1 on hold (fixed-term).",
  "findings": [
    { "company": "Cedar Health Network", "title": "Research Coordinator", "sourceUrl": "https://careers.cedarhealth.example/jobs/R-2231",
      "requisition": "R-2231", "location": "Riverton (hybrid)", "checkedAt": "2026-11-25T15:10:00Z", "postingStatus": "open",
      "deadline": "2026-12-15", "note": "Closing date shown on posting." }
  ]
}
```

Every finding becomes a job in `Review` (existing jobs only get their posting details refreshed). So list only shortlisted postings in `findings`, each with the employer's posting link and `checkedAt`. Put rejected and held counts in `summary`. If the claim expired, claim it again. If a search cannot be finished, put it back with `search.fail` and the reason.

## 3. Remove what was already handled

Put the candidates in a `screen.preflight` input (you can copy `candidates` from a `discover.run` result):

```json
{
  "criteriaVersion": "2026-11-25-coordinator-riverton",
  "candidates": [
    { "company": "Cedar Health Network", "title": "Research Coordinator", "sourceUrl": "https://careers.cedarhealth.example/jobs/R-2231", "requisition": "R-2231" },
    { "company": "Northbank University", "title": "Clinical Research Coordinator II", "sourceUrl": "https://northbank.example.wd3.myworkdayjobs.com/en-US/External/job/CRC-II_JR-0198" }
  ]
}
```

```
node app/cli.mjs op run screen.preflight --file app/data/tmp/preflight-1.json
```

Screen only the `eligible` list. An item with `recheck` was held or reopened earlier and is due again; its `previous` decision is shown. The others are:
- `existing-application`: already saved. Skip it.
- `already-decided`: screened before. Skip it unless the person asks for a recheck. `criteriaChanged` tells you the earlier decision used other criteria; that alone does not reopen it.
- `duplicate-in-batch`, `invalid` (no link): skip.

**Same job or new job?** Links that differ only by tracking parts (`utm_source`, `gh_src`, `ref` and similar) are the same posting; preflight handles these. A different requisition number is a new opportunity, even at the same employer with the same title. If the same requisition appears under a different link, treat it as already handled (check `screen.list` and `jobs.list` with `q` set to the employer). Different links to the same board number also match, and you can pass `aliases` for other links you have confirmed are the same posting. If an employer reuses one link for a new requisition, always include `requisition`: two different requisition numbers are kept apart.

## 4. Judge each eligible posting

Open every posting on the employer's site. For each one, note:

- The duties and qualifications, word for word, to save as `postingText` on shortlisted jobs. Postings disappear, and the resume is matched against this text.
- Is it still open? Closing date?
- Location, work model and employment type as the posting states them. A generic "full-time" label does not say whether it is permanent.
- Main duties and required qualifications.
- Fit against the profile and the career library (`evidence.list` with `q`). Name the evidence for each strong match and name the gaps. Ignore facts marked `disputed` or `outdated`.
- How the work splits (for example lab and analysis, or travel and desk) when the posting says. Save it as `dutySplit`; if it is unclear and matters to the person, say so instead of guessing from the title.
- The date the employer says it was posted, if shown (`postedAt`). Never use a search result's date.

Decide:
- `shortlist`: a real fit worth preparing. This creates a job in `Review` on the dashboard.
- `reject`: clearly outside what they want or require. Give the reason.
- `hold`: a required qualification or eligibility rule is unmet or not established, or the terms need the person's call. Say exactly which. Add `recheckAfter` (a date) if it is worth looking again later.

Required qualifications are a gate, not a stretch; preferred ones are not. Do not reject a role only because a requirement is not established; hold it. Do not shortlist on the employer's name alone. For fixed-term or unusual terms, apply the conditions in `employmentPreferences` and record the evidence for each; a generic "full-time" label or a famous employer is not evidence. Collect held questions for the summary instead of stopping for each one.

Rank shortlisted jobs by how well the evidence covers their key requirements. Evidence with complete STAR fields and dated metrics counts for more than a bare job title (`evidence.strength` shows each record's score and what is missing).

## 5. Record every decision

```json
{
  "criteriaVersion": "2026-11-25-coordinator-riverton",
  "decisions": [
    {
      "decision": "shortlist",
      "company": "Cedar Health Network",
      "title": "Research Coordinator",
      "sourceUrl": "https://careers.cedarhealth.example/jobs/R-2231",
      "requisition": "R-2231",
      "location": "Riverton (hybrid)",
      "reason": "Coordinates participant recruitment across two clinics; matches confirmed recruitment and REDCap experience.",
      "whyFit": "Two years screening and consenting participants; REDCap data entry.",
      "gaps": "Asks for ethics submission experience; not in the career library yet.",
      "evidence": [{ "url": "https://careers.cedarhealth.example/jobs/R-2231", "checkedAt": "2026-11-25T15:10:00Z" }]
    },
    {
      "decision": "reject",
      "company": "Northbank University",
      "title": "Clinical Research Coordinator II",
      "sourceUrl": "https://northbank.example.wd3.myworkdayjobs.com/en-US/External/job/CRC-II_JR-0198",
      "reason": "On-site in Eastport only; the person wants Riverton or remote.",
      "evidence": [{ "url": "https://northbank.example.wd3.myworkdayjobs.com/en-US/External/job/CRC-II_JR-0198", "checkedAt": "2026-11-25T15:18:00Z" }]
    }
  ]
}
```

```
node app/cli.mjs op run screen.record --file app/data/tmp/decisions-1.json
```

- Every decision needs `reason` and at least one `evidence` item `{ url, checkedAt }` from the employer.
- To revisit an earlier decision on purpose, add `"recheckReason": "Posting reopened with a new closing date"`, or make it eligible for a later batch with `screen.reopen` and `{ "id", "reason" }`. The earlier decision is kept and marked as replaced.
- After recording, add the closing date to each shortlisted job with `jobs.update` (`patch: { "deadline": "2026-12-15" }`).

To add a single job the person gave you, open the employer's posting and use `jobs.add`:

```json
{ "job": { "company": "Cedar Health Network", "title": "Research Coordinator", "sourceUrl": "https://careers.cedarhealth.example/jobs/R-2231", "requisition": "R-2231", "location": "Riverton (hybrid)", "deadline": "2026-12-15", "whyFit": "…", "gaps": "…", "lastChecked": "2026-11-25T15:10:00Z" } }
```

Note the field name: screening evidence and search findings use `checkedAt`, but a job uses `lastChecked` (the time you opened the posting). If it is already saved, the error names the existing record.

### Check the links and rank

Before you tell the person a job is open, check the exact link they will click:

```json
{ "jobIds": ["JOB_ID_1", "JOB_ID_2"] }
```

```
node app/cli.mjs op run postings.check --file app/data/tmp/links-1.json
```

- `verified`: fine. `unavailable`: find the right link on the employer's site, or set `postingStatus` to `unknown` with a note. A dead link alone does not prove the employer closed the job; set `closed` only when the employer says so.
- `blocked` or `needs-browser-check`: open it in a browser and look for the title, the employer and how to apply. Do not enter anything.

Then save your rating with `jobs.rank`. `A` prioritize, `B` good option, `C` stretch, `Hold` when a required qualification or eligibility is unmet or not established. Rank 1 is best. The reason names the evidence or the missing requirement. Ratings never change a stage.

```json
{ "items": [{ "id": "JOB_ID_1", "tier": "A", "rank": 1, "reason": "Meets every required qualification; recruitment and REDCap are in the library. No ethics submissions." }] }
```

`jobs.shortlist` then gives the jobs to act on now. A posting checked more than 14 days ago, a passed deadline or a `Hold` drops out of it until it is checked; nothing saved changes.

## 6. Finish

Tell the person, briefly:

- How many postings you looked at, and how many you shortlisted, rejected and held.
- Each shortlisted job: employer, title, location, closing date, one line on fit, one line on gaps.
- Each held job and the question you need them to answer.
- If several good jobs depend on experience that is thin in the library, suggest an experience interview on it (`app/skills/experience-interview.md`).
- Next step: "Say 'help me apply to the Cedar Health job' when you're ready." They can see the shortlist on the dashboard (`node app/cli.mjs start`).
