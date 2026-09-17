# email-design-system

Local CLI that pulls repeated blocks (footers, buttons, headers) out of a set
of HTML email templates into single component files, then rewrites each
template to reference them instead of repeating the markup. A `handover` step
expands those references back into plain HTML before delivery, so the
customer only ever receives ordinary email markup.

## Commands

- `npm test` — run the test suite (vitest)
- `npm run typecheck` — `tsc --noEmit`
- `npm run handover -- <job-dir> [--check]` — expand a job's templates and
  write its proof and plain export (see below). `--check` runs the same
  expansion and comparison without writing anything.

## Job directory layout

`npm run handover -- <job-dir>` reads:

    <job-dir>/
      components/     required — one .html file per component body
      templates/      required — templates containing <x-component/> references
      originals/      optional — untouched customer files, used to prove
                       before/after are byte-identical

and writes:

    <job-dir>/
      proof/          before/after HTML + REPORT.md
      plain-export/   templates with every reference expanded, nothing left

A template with no matching file in `originals/` is left unresolved in
`proof/REPORT.md`, not counted as proven.

## Component references

A template refers to a component with a self-closing tag:

    <x-component component-id="shoe-brand/footer" revision="1" />

Overrides on the tag customize one instance without touching the stored body:

- `ov-<attr>` — set an attribute on the component's root element
- `ov-slot-<name>` — replace the text of the element marked `data-slot="<name>"`
- `ov-at-<path>-<attr>` (with a matching `ov-tag-<path>`) — set an attribute on
  a specific descendant, by child index path (e.g. `ov-at-0.2-href`)
