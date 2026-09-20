# supersede

Local HTML email change-and-prove toolkit. Put a folder of emails in
`asset/<job>`, describe one change, and the tool narrows it to the smallest
span that is unique across the files, writes a standalone script that applies
it, and records what it covered. `TODO.md` has what is still open.

The flow `src/cli.js` drives, one change per pass:

```mermaid
flowchart TD
    run(["node src/cli.js"]) --> read["read the job, the HTML files in asset/JOB"]
    read --> resume{"some files covered, some left from an earlier run?"}
    resume -->|yes| next
    resume -->|no| ask["ask for one change request"]

    ask --> split["split into two phases, what to find and what it becomes"]
    split --> extract["extract the element phase 1 names, trying each file still to check until one holds it"]
    extract --> looks{"does this element look right?"}
    looks -->|no| stopped(["stop, nothing written"])
    looks -->|yes| narrow["narrow with both phases to the smallest span"]

    narrow --> unique{"span unique in every file still to check?"}
    unique -->|twice in one of them| refused["nothing written"]
    unique -->|yes, or absent from some| write["write a standalone script for the files it matched"]
    write --> apply["run it, record the change and the files it covered"]

    apply --> anyleft{"files still to check?"}
    anyleft -->|yes, the span missed them| warn["name any the span missed, a variation this change did not match"]
    anyleft -->|yes, the script refused them| next
    anyleft -->|no| complete["sweep complete"]

    split -.->|cannot split| refused
    extract -.->|no file holds it, or two equal matches| refused
    narrow -.->|cannot narrow it| refused
    refused --> next
    warn --> next
    complete --> next

    next{"some files covered, some still to check?"}
    next -->|yes, describe the change for those files| ask
    next -->|yes, leave them, next sweep| opened["open the next sweep, every file pending again"]
    next -->|yes, stop| done(["stop"])
    next -->|no| again{"another change?"}

    again -->|yes, the sweep is complete| opened
    again -->|yes, nothing covered yet| ask
    again -->|no| done
    opened --> ask
```

One element seeds each change. The files still to check are tried in order and
the first one holding the element supplies it, so a variation at the front of
the job no longer sinks the pass; the refusal comes only after the last file.
Only a file that plainly lacks the element is passed over. Anything else — two
equally plausible elements, a malformed answer, a failed call — stops the walk
where it stands, and says which file it stopped at.

