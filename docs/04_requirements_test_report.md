# Requirements Test Report (2026-10-18)

Basis: **Grade Encoding System – Requirements and Test Cases** (USA, built from the AY 2024-2025 to 2026-2027 Mastersoft issues): 25 requirements, 37 test cases. The filled-in workbook is `docs/test-results/Grade_Encoding_Requirements_and_Test_Cases - Results 2026-10-18.xlsx`.

How it was tested: 18 automated checks in [tests/requirements/usa-test-cases.test.ts](../tests/requirements/usa-test-cases.test.ts) and 4 in [tests/app/saveQueue.test.ts](../tests/app/saveQueue.test.ts) (made-up students), plus browser tests for saving, two open tabs and duplicate IDs, and a code review for save errors.

## Results

| | Count | Test cases |
|---|---|---|
| **Pass** | 24 | TC-001, 002, 004, 005, 006, 007, 008, 010, 012, 013, 016, 017, 018, 019, 020, 021, 026, 027, 028, 030, 032, 033, 034, 035 |
| **Fail** | 4 | TC-009, 014, 015, 029 |
| **Not applicable** (marked Blocked) | 9 | TC-003, 011, 022, 023, 024, 025, 031, 036, 037 |

The "not applicable" cases test Mastersoft's own workflow: draft/submit/approve/release states, stored Final Ratings, subject activation, graduate transmutation schemes. This app is a companion calculator; those steps stay in Mastersoft.

Requirements: 13 Done, 5 In Progress, 1 Not Started, 6 Deferred (not applicable).

First run: 19 pass, 9 fail. TC-020, 026, 027 and 028 were then fixed and retested (see below).

## What already meets the requirements

- **One computation everywhere** (REQ-01, 03, 22): every grade on every screen and in the Encoding Guide comes from the same engine and the same half-up rounding.
- **Transmutation from 0 to the maximum** (REQ-04): 0/60, 1/60, 5/60 and 60/60 all compute, with no errors or blanks.
- **75 always passes** (REQ-05): 75 gives 3.0 Passed, never 5.0.
- **Blank vs 0** (REQ-07): blank is "not encoded" and not computed; 0 is computed.
- **Late-added students and missing grades** (REQ-10, 11): new students appear everywhere, and the Mastersoft export is blocked with a list of students who are missing scores.
- **Point grade format** (REQ-23): always one fixed decimal (3.0, 1.8).

## Fixed and retested (2026-10-18, TC-032 on 2026-10-28)

| Test case | Fix |
|---|---|
| **TC-028** two tabs | Each edit is saved as a change re-applied to the latest saved copy inside one database transaction (`src/app/saveQueue.ts`), so a tab with an old copy can no longer erase another tab's work. Open tabs reload a class when another tab saves it. Retest: both edits kept; each tab saw the other's change. |
| **TC-026** save confirmation | The header shows "Saving…" then "Saved" with the time. |
| **TC-027** failed save | The header shows "Not saved · Retry" and a red banner explains the changes are still on screen; "Try again" saves them. The tab warns before closing with unsaved changes. Retested by forcing database writes to fail. |
| **TC-020** duplicate IDs | Duplicate Student IDs (ignoring case and spaces) turn red with who else uses them, are counted in the status bar, reachable with "Next blank or error", noted in the Encoding Guide, and block the Mastersoft export. |
| **TC-032** readiness | "All classes overview" at the top of the Gradebook menu lists every class with its student count (and a red badge for duplicate IDs), the state of Prelim, Midterm and Final ("Needs setup", "Ready (n)", or graded / blank / to-fix counts) and whether the class is backed up. Each cell opens that class and term. Automated check in `tests/requirements/usa-test-cases.test.ts`. |

## Remaining failures and what they need

Highest risk first.

| # | Test case | Finding | Suggested fix |
|---|---|---|---|
| 1 | **TC-009** just below 75 (High, decision) | 74.5–74.9 rounds half-up to 75 and passes (D2). The test expects anything below 75.00 to fail. | Confirm Mastersoft's rule at 74.5–74.9 before changing anything. |
| 2 | **TC-014 / TC-015** invalid entries (Medium, decision) | Out-of-range, negative and text entries are highlighted with a message and never computed or exported, but they stay in the cell and are saved. The test expects them to be rejected. | Either reject them on entry (test wording), or keep the current highlighting. |
| 3 | **TC-029** history (Medium) | No change history or undo; only a manual backup can restore earlier values. | A per-class change history with "restore this value". |
