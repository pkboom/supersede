# FLOW — shoe-brand, job 1

Live status of one migration job. Updated as each step completes.
The business behind it is in `BUSINESS.md`; this file is just where we are.

**Now:** ① and ② done — 3 templates in from Shoe Brand, and they say the
buttons are what's shared. Next is ③, scan the files.

---

## The flow

```
  ①  intake          customer emails .html files      →  originals/
  ②  ask             "which blocks are the same?"     →  their answer, verbatim
  ③  scan            find what actually repeats       →  a list of blocks
  ④  gap + quote     what they said vs what is there  →  a price
  ⑤  extract         each repeated block, once        →  components/
  ⑥  rewire          replace blocks with references   →  templates/
  ⑦  proof           render before and after          →  proof/
  ⑧  plain export    paste everything back in         →  plain-export/
  ⑨  handover        zip, HOW-TO, the 30-second demo  →  them
  ⑩  invoice
```

| # | step | state |
|---|---|---|
| ① | intake | **done** — 3 templates from Shoe Brand |
| ② | ask | **done** — they said "buttons" |
| ③ | scan | not started |
| ④ | gap + quote | not started |
| ⑤ | extract | not started |
| ⑥ | rewire | not started |
| ⑦ | proof | not started |
| ⑧ | plain export | not started |
| ⑨ | handover | not started |
| ⑩ | invoice | not started |

---

## ② Ask — done

> Which blocks are the same across all your emails?

**Answer:** "buttons"

---

## ① Intake — done

Shoe Brand sent 3 `.html` templates.

They go in `originals/` read-only, with a `MANIFEST.sha256`. That is not
bookkeeping: ⑦ proves "nothing changed" by re-rendering the original, and that
proof is worthless if the original could have been edited along the way.

---

## ③ Scan — next

Diff the three against each other and find what actually repeats.

They said "buttons". The scan decides whether that is true, whether it's all
three files or only two, and what else repeats that they never mentioned —
footer, preheader, spacer, social strip. Both answers feed ④.

`npm run scan -- <dir>` now exists. It groups every block three ways — shape,
canonical content, and raw bytes — and the gap between those three is the
report: what is byte-identical and free to extract, what only differs by
formatting and therefore gets rewritten, and what shares a shape but not its
content. That last one is §5's finding: "identical in all 40" turning out to be
37, with three still on the old address.

---

## Job directory

```
workspace/shoe-brand/
  originals/        ① their untouched files
  components/       ⑤ one file per shared block
  templates/        ⑥ the rewired emails
  proof/            ⑦ before/after renders + REPORT.md
  plain-export/     ⑧ expanded HTML, no references left
```

None of it exists yet. `npm run handover -- workspace/shoe-brand` builds the last
two from `components/` and `templates/` (required) plus `originals/` (optional,
used for the before/after comparison). A template with no matching original is
marked unresolved in `proof/REPORT.md`, not silently counted as proven.
