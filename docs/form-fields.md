# Form & sheet field reference

The script reads the Google Form's response sheet **by column header name** (see `colMap`/`readFormData` in `src/kvk_signup.gs`). The header text must match exactly -- if you rename a question, update the matching value in `CONFIG` too.

## Form fields

### Identity (asked once)

| Response column | Type | Notes |
|---|---|---|
| `Timestamp` | auto | Added by Google Forms. Used to track latest submission. |
| `Player Name` | Short answer | **Primary key.** Submissions are merged by this exact string, so it must be consistent across re-submissions (a rename/typo creates a separate record). |
| `Player ID` | Short answer | The player's in-game numeric ID. Some players don't bother filling it in. Stored and displayed, but *not* used as the merge key. |
| `Alliance` | Short answer | Alliance tag (e.g. `PRO`, `BR4`). |

### Per day (repeated for Day 1, Day 2, Day 4)

Each event day asks the same five questions. The day labels are **Day 1: Construction**, **Day 2: Research**, and **Day 4: Troop Training**.

| Response column (Day 1 example) | Type | Accepted values |
|---|---|---|
| `Do you want to sign up for Day 1: Construction?` | Multiple choice | `Yes` or `No`. Only `Yes` days are scheduled. A **blank** day is left untouched on re-submission (partial update). |
| `Day 1 Speedups` | Short answer (number) | Contribution score. Higher = higher priority. Non-numeric is treated as `0`. |
| `Day 1 UTC Preferred Time` | Multiple choice | A time slot. Only the leading `HH:MM` is read (e.g. `01:45 - 02:15` -> `01:45`). Must be one of the valid slot start times. |
| `Day 1 UTC Additional Availability` | Checkboxes | Comma-separated list of slots. Each entry's leading `HH:MM` is parsed; entries that aren't valid slot starts are ignored. |
| `Day 1 Comments` | Paragraph | Free text. Shown on the Day sheet; not used by the optimizer. |

Day 2 and Day 4 use the identical pattern with `Day 2`/`Day 4` prefixes (`Day 2 Speedups`, `Day 4 UTC Preferred Time`, etc.).

## Value formats

- **Times** are 24-hour `HH:MM` (UTC). Slot options are presented as ranges (`HH:MM - HH:MM`) but only the **start** matters.
- **Slots** must be one of the 49 valid start times the script generates (`ALL_SLOTS`). Anything else is dropped during parsing.
- **Preferred + Additional** are merged into one availability set per day, de-duplicated, preferred first.

## Merge / re-submission behavior

- Records are keyed on `Player Name`. Re-submitting **replaces** the days included in the new submission.
- A day left **blank** in a re-submission keeps the previously stored answer (this is how partial updates work).
- `Player ID`, `Alliance`, and `Timestamp` always take the **latest** non-empty value.

## Day sheet headers (working sheets, not the form)

The optimizer writes to the Day sheets, which must have these table headers in columns **A-K**:

```
Player Name | Override | Assigned Start Time | End Time | Timestamp | Player ID | Alliance | Speedups | Preferred Time | Additional Availability | Comments
```

**Day 4** has a second, identical table in columns **M-W** for the Chief Minister overflow track.

The **Override** column (B) is read back on each run -- see the "Overrides" section of the main [README](../README.md) for accepted values (`SKIP`, `ASSIGN`, `CHIEF`/`NOBLE`, or a specific `HH:MM`).
