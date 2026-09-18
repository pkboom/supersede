# FLOW — shoe-brand, job 1

Live status of one migration job. Updated as each step completes.
The business behind it is in `BUSINESS.md`; this file is just where we are.

**Now:** ① and ② done — 3 templates in from Shoe Brand, and they say the
buttons are what's shared. Next is ③, gap + quote.

---

## The flow

```
  ①  intake          customer emails .html files      →  originals/
  ②  ask             "which blocks are the same?"     →  their answer, verbatim
  ③  gap + quote     what they said vs what is there  →  a price
  ④  extract         each repeated block, once        →  components/
  ⑤  rewire          replace blocks with references   →  templates/
  ⑥  proof           render before and after          →  proof/
  ⑦  plain export    paste everything back in         →  plain-export/
  ⑧  handover        zip, HOW-TO, the 30-second demo  →  them
  ⑨  invoice
```

| # | step | state |
|---|---|---|
| ① | intake | **done** — 3 templates from Shoe Brand |
| ② | ask | **done** — they said "buttons" |
| ③ | gap + quote | not started |
| ④ | extract | not started |
| ⑤ | rewire | not started |
| ⑥ | proof | not started |
| ⑦ | plain export | not started |
| ⑧ | handover | not started |
| ⑨ | invoice | not started |

---

## ② Ask — done

> Which blocks are the same across all your emails?

**Answer:** "buttons"

---

## ① Intake — done

Shoe Brand sent 3 `.html` templates.

They go in `originals/` read-only, with a `MANIFEST.sha256`. That is not
bookkeeping: ⑥ proves "nothing changed" by re-rendering the original, and that
proof is worthless if the original could have been edited along the way.

---

## Job directory

```
workspace/shoe-brand/
  originals/        ① their untouched files
  components/       ④ one file per shared block
  templates/        ⑤ the rewired emails
  proof/            ⑥ before/after renders + REPORT.md
  plain-export/     ⑦ expanded HTML, no references left
```

None of it exists yet. `npm run handover -- workspace/shoe-brand` builds the last
two from `components/` and `templates/` (required) plus `originals/` (optional,
used for the before/after comparison). A template with no matching original is
marked unresolved in `proof/REPORT.md`, not silently counted as proven.
