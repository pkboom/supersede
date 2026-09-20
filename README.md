# supersede

Local HTML email change-and-prove toolkit. Put a folder of emails in
`asset/<job>`, describe one change, and the tool narrows it to the smallest
span that is unique across the files, writes a standalone script that applies
it, and records what it covered. `TODO.md` has the build state and the open
decisions.

The flow `src/cli.js` drives, one change per pass:

```mermaid
flowchart TD
    run(["node src/cli.js"]) --> read["read the job, the HTML files in asset/JOB"]
    read --> resume{"files left from an unfinished sweep?"}
    resume -->|yes| choose{"tackle the variation, or move on?"}
    resume -->|no| ask["ask for one change request"]

    ask --> split["split into two phases, what to find and what it becomes"]
    split --> extract["extract the element phase 1 names, seeded from a file still to check"]
    extract --> looks{"does this element look right?"}
    looks -->|no| stopped(["stop, nothing written"])
    looks -->|yes| narrow["narrow with both phases to the smallest span"]

    narrow --> unique{"span unique in every file still to check?"}
    unique -->|twice in one of them| refused["nothing written"]
    unique -->|yes, or absent from some| write["write a standalone script for the files it matched"]
    write --> apply["run it, record the change and the files it covered"]

    apply --> anyleft{"files still to check?"}
    anyleft -->|yes| warn["name any the span missed, a variation this change did not match"]
    anyleft -->|no| complete["sweep complete"]

    split -.->|cannot split| refused
    extract -.->|cannot find it| refused
    narrow -.->|cannot narrow it| refused
    refused --> mid{"files left in this sweep?"}
    mid -->|yes| choose
    mid -->|no| again{"another change?"}

    warn --> choose
    choose -->|describe the change for those files| ask
    choose -->|leave them, next sweep| opened["open the next sweep, every file pending again"]
    choose -->|stop| done(["stop"])

    complete --> again
    again -->|yes| opened
    again -->|no| done
    opened --> ask
```

