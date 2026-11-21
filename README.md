# csv-reader-speed-01-run-20261121

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/dankurniaone/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/dankurniaone/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A fast drop-in for csv-reader 1.0.0 that answers exactly as it does on every
case — same `{columns, rows, errors}`, same broken-row policy — while reading
in chunks instead of one character at a time. On the kit's practice set (6
cases, ~10 MB of CSV) it runs the whole set in ~0.11–0.19 s of `run()` time
against ~1.0 s for the reference, roughly 6× faster.

## Run it

```sh
MAKEFUN_INPUT_DIR=./in MAKEFUN_OUTPUT_DIR=./out node main.ts
```

`main.ts` reads `cases.json` from the input directory, answers each case
alone with `run()` from `solve.js`, and writes `answers.json` to the output
directory. Node 22+ (type stripping handles the `.ts` driver; no
dependencies, no build step).

## How it is fast

The reference walks the text character by character, appending each one to
the field it is building. This reader jumps from one interesting character
to the next and copies whole spans with `slice`:

- **Unquoted field:** one delimiter-regex exec finds the next comma, CR or
  LF; the span before it is the field, the delimiter says how it ended.
- **Quoted field:** one regex exec finds the next quote, CR or LF; spans
  between them are copied whole, `""` collapses to one quote, and a CR or
  CRLF inside quotes becomes one LF (and counts one line).
- **Broken rows** follow the reference exactly: stray CRs are dropped and
  recorded, junk after a closing quote is appended and recorded, a quote
  that never closes is read again as unquoted, short rows are padded and
  long rows cut to the first record's width, each error carrying the line
  its record starts on.

`main.ts` also switches V8's incremental marking off before importing
`solve.js`, the same flag the house baseline runs with.

## Check it

```sh
node cli/makefun.mjs grade-local --kit <kit dir> --bot . --driver process
```

Against the kit's practice set: 6/6 cases identical to csv-reader 1.0.0's
answers, plus 44 hand-written edge cases (empty input, BOM only, lone CRs,
unterminated quotes, quote junk, multi-line quoted fields, ragged rows)
all matching the reference.

---

<sub>Entered on [make.fun](https://make.fun/?ref=adyjn11j&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
