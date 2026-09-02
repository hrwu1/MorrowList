# Competitor gap analysis: what other boards have that MorrowList does not

Date: 2026-09-02. Research only; no product decisions are made here.

This document merges nine segment reports (in [`competitors/`](competitors/)) into one ranked
list of features that widely used Kanban and task tools ship and MorrowList does not. Each
segment report carries its own feature-by-feature table with source URLs; this file cites the
segment report and the strongest evidence, and ranks.

## 1. Summary

MorrowList's board mechanics are already competitive: server-authoritative fractional ranking,
optimistic concurrency with conflict feedback, keyboard drag plus a non-drag Move menu, WIP
warnings, Trash with restore, human task keys, an OpenAPI REST API and a maintained CLI. Several
of those are things Trello, Jira, monday.com and every open-source board either lack or do badly
(see §7).

What is missing is almost entirely **around** the board, not in it. Across all nine segments the
same gaps recur:

| Rank | Gap                                                  | Flagged as table-stakes or strong demand by | Status in MorrowList                         |
| ---- | ---------------------------------------------------- | ------------------------------------------- | -------------------------------------------- |
| 1    | Subtasks / checklists UI, with progress on cards     | 9 of 9 segments                             | Schema only (`parent_task_id`)               |
| 2    | Search, filter UI and saved personal views           | 9 of 9                                      | URL filters only, no text search             |
| 3    | Export (JSON, CSV) and import (Trello, CSV)          | 9 of 9                                      | Export planned, import not                   |
| 4    | Tags / labels                                        | 8 of 9                                      | Planned                                      |
| 5    | Recurring tasks                                      | 8 of 9                                      | Long-term idea only                          |
| 6    | Offline PWA and a usable mobile experience           | 8 of 9                                      | Planned (PWA shell)                          |
| 7    | Webhooks and an agent/MCP surface                    | 8 of 9 (as differentiator)                  | Outbox exists, nothing delivers it           |
| 8    | Board group-by, swimlanes, column hide/collapse      | 8 of 9                                      | Not built                                    |
| 9    | Calendar view and an ICS/CalDAV feed                 | 7 of 9                                      | Long-term idea only                          |
| 10   | Dependencies as relations (blocked-by with a reason) | 7 of 9                                      | Planned                                      |
| 11   | Today / Upcoming daily loop                          | Every personal-tool segment                 | Planned; `task_day_plans` table exists       |
| 12   | Column / workflow editing and column policies        | 6 of 9                                      | Planned                                      |
| 13   | Undo, bulk edit, activity history UI                 | 6 of 9                                      | Planned                                      |
| 14   | Global keyboard shortcuts and command palette        | 6 of 9                                      | Keyboard drag only                           |
| 15   | Due-date reminders / notifications                   | 5 of 9                                      | Not planned for MVP                          |
| 16   | Flow metrics (card age, cycle time, throughput, CFD) | Kanban-method segment: mandatory; 3 others  | Not built; computable from `activity_events` |

Two findings matter beyond the list itself:

- **Five table-stakes features are outside the MVP spec** (§2.4 non-goals): recurring tasks,
  reminders, calendar view, natural-language quick add, and start/defer dates. Every personal
  task manager ships all five, and users cite the first two as their top upgrade reasons. The
  spec's sequencing should be revisited before the "first update after MVP" is planned.
- **MorrowList's real openings are not feature parity.** The evidence points to four things
  nobody self-hostable does well together: a keyboard-first board that feels like Linear, offline
  with a real sync engine, an agent-friendly API/CLI/webhook/MCP surface, and method-grade flow
  metrics computed from the activity log MorrowList already writes.

## 2. Method and trust

- Nine agents researched one segment each: Trello; Jira; Asana + monday.com; Notion + ClickUp;
  Linear + GitHub Projects + Plane; open-source self-hosted tools (Planka, WeKan, Kanboard,
  Focalboard, Vikunja, Taiga, OpenProject, Leantime, Huly, Nextcloud Deck); personal task apps
  (Todoist, TickTick, Microsoft To Do/Planner, Things, OmniFocus, Sunsama, Akiflow, and others);
  Kanban-method tools (Businessmap, Planview AgilePlace, Kanban Tool, KanbanFlow, SwiftKanban,
  Kanban Zone) plus the Kanban Guide 2025.5 and Open Guide; and demand-side evidence (review
  aggregators, GitHub issue reaction counts pulled live, Hacker News threads, migration stories).
- Every segment report has a feature table with a source URL per row and a full source list.
  Rows the agents could not open are marked "unverified" in those files.
- Importance here is the number of independent segments that rated a gap table-stakes or cited
  strong user demand for it, adjusted for MorrowList's persona (individual knowledge worker,
  self-hosted, API/CLI first).
- Known coverage gaps: Reddit was mostly unreachable from this environment, G2 product pages
  returned 403, and several help centers (ClickUp, Businessmap, Kanban Zone) blocked fetching.
  Those segments lean on Capterra, GetApp, GitHub issues, Hacker News, and vendor summary pages.
  The web-search budget ran out near the end of most agents' runs, so a handful of late claims
  rest on search snippets and are flagged as such in the segment files.

## 3. Landscape at a glance

| Segment         | Products                                           | What they do well                                          | Where they are weak (opportunity)                                                        |
| --------------- | -------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Archetype       | Trello                                             | Labels, checklists, Butler rules, capture Inbox, MCP       | 2025 redesign backlash, free-tier caps, no dependencies, lossy export, permanent deletes |
| Enterprise      | Jira                                               | Workflow editor, JQL, swimlanes, reports, automation       | Complexity, speed, field sprawl, no native recurrence, no trash                          |
| Work management | Asana, monday.com                                  | My Tasks rules, recurring, rules, calendar, dashboards     | Seat minimums, gated basics, subitems not on Kanban, naive offline                       |
| All-in-one      | Notion, ClickUp                                    | Group-by anything, relations, saved views, recurring       | Slow at scale, bloat, weak offline, metered AI                                           |
| Developer       | Linear, GitHub Projects, Plane                     | Speed, Cmd+K, relations, cycles, agent delegates, webhooks | Cloud-only or paywalled self-host, rigid model, thin API (GitHub)                        |
| Open source     | Planka, WeKan, Kanboard, Vikunja, Focalboard, Huly | Free, self-hosted, Trello parity                           | License flips, abandonment, no export, no CLI, Postgres-only or heavy stacks             |
| Personal        | Todoist, TickTick, Things, Planner, Sunsama        | Today loop, NLP capture, reminders, recurrence, calendar   | Subscription creep, walled gardens, weak boards, weak APIs                               |
| Kanban method   | Businessmap, AgilePlace, Kanban Tool, KanbanFlow   | Flow metrics, card aging, blockers, policies               | No individual tier, complexity, poor analytics UX, no mobile                             |

Details and sources: [`competitors/`](competitors/).

## 4. Ranked gap list

Rating key. **Table-stakes**: users expect it from any Kanban or task tool and its absence
disqualifies MorrowList for the target persona. **Differentiator**: rarely done well, and
MorrowList's architecture makes it cheap or unusually good. **Nice-to-have**: valued but not
decisive. **Avoid**: competitors ship it and users complain about it.

### Tier 1: table-stakes already in the spec but not built

These are in the MVP spec (§5.1) and absent from the product. Finish them first.

1. **Subtasks and checklists with progress on cards.** Every segment. ClickUp's two
   top-voted requests overall are about subtasks (961 and 584 votes); Super Productivity's
   subtask issues carry 62 and 43 reactions; monday's inability to show subitems on Kanban is a
   five-year, 91-reply thread; Todoist's board hides subtasks. MorrowList has the parent column
   already. Two levels are enough; render a "2/5" progress line on the card.
   Sources: [user-demand](competitors/user-demand.md) rows 2 and 26, [asana-monday](competitors/asana-monday.md) gap 1.
2. **Full-text search, a filter panel, and saved personal views.** Every segment. Trello's
   operator search (`due:overdue`, `-has:`) and Todoist filters are the most-used power features;
   monday users waited years for personal saved views; Vikunja turns saved filters into their own
   board. MorrowList's URL-encoded filters are the right foundation: add text search, a UI to
   compose filters, and name-and-save, rendered as list or board.
   Sources: [trello](competitors/trello.md) gap 4, [personal-task-apps](competitors/personal-task-apps.md) gap "Saved views", [user-demand](competitors/user-demand.md) row 9.
3. **Tags / labels with colors.** 8 of 9 segments. Trello's primary categorisation and the
   baseline card value Capterra reviewers cite. Include a colorblind-safe palette. The `tagId`
   filter is already in the contract.
   Sources: [trello](competitors/trello.md) gap 1, [linear-github-plane](competitors/linear-github-plane.md) gap 1.
4. **Today and Upcoming with a deliberate "add to today".** Every personal-tool segment. Things'
   Today, To Do's My Day, Asana's My Tasks auto-move rules, and Todoist's Upcoming are the daily
   loop; Zapier's abandonment finding is that people stop looking at the list. The
   `task_day_plans` table and `addToDay` field already exist.
   Sources: [personal-task-apps](competitors/personal-task-apps.md) gap 1, [asana-monday](competitors/asana-monday.md) gap 2.
5. **Column and workflow editing** (add, rename, reorder, recolor, archive, hide or collapse).
   6 of 9. Trello charges for list colors and collapse; Kanboard leads its homepage with it;
   Kaneo's top issues are custom columns. Keep Linear's model: fixed categories, free-form
   named statuses. Add a Markdown **policy** field per column (see Tier 3, item 19).
   Sources: [jira](competitors/jira.md) gap 1, [notion-clickup](competitors/notion-clickup.md) gap "Hide/collapse".
6. **Dependencies as relations, not only a Blocked column.** 7 of 9. Linear and Plane model
   blocks / blocked-by / related / duplicate with flags that auto-convert on resolution; the Open
   Guide says the workflow must define and signal blockers; Trello's lack of dependencies is
   called its "glaring gap". A relation preserves the task's real column and records _why_.
   Sources: [linear-github-plane](competitors/linear-github-plane.md) gap 3, [kanban-method-tools](competitors/kanban-method-tools.md) gap 6.
7. **Export and import.** Every segment. "Planka has no export, which matters if you ever want
   to leave"; Hacker News: "Must have an API, or at least export as csv AND json"; Trello cannot
   re-import its own export and its JSON keeps only 1,000 actions. Ship JSON and CSV export, then
   a Trello-JSON importer and a generic CSV importer as the migration wedge.
   Sources: [open-source](competitors/open-source.md) gap "Export", [trello](competitors/trello.md) gap 9, [user-demand](competitors/user-demand.md) row 10.
8. **Undo and bulk edit.** 5 of 9. Trello users rely on `z` and Shift-select; Jira caps bulk at
   1,000 with no rollback; Vikunja and Kanboard both have open bulk-edit issues. Undo for bulk
   operations would beat Jira and Trello.
   Sources: [jira](competitors/jira.md) gaps 12 and 13, [user-demand](competitors/user-demand.md) row 17.
9. **Activity history on the task.** 6 of 9. Kan.bn was criticised on Hacker News for "empty
   activity panes"; Capterra rates commenting and notes at 89% importance. MorrowList already
   writes every event; this is a read model and a panel.
   Sources: [user-demand](competitors/user-demand.md) row 32, [trello](competitors/trello.md) gap 10.
10. **Global keyboard shortcuts and a command palette.** 6 of 9. Linear's `C`, `X`, `G I`, `/`
    and Cmd+K are the visible half of "Linear feels fast"; Trello's `j/k/n/t/c/d/l/f/x/z`
    vocabulary is muscle memory; keyboard-first is called out whenever absent (Kan.bn, Zenkit).
    A palette that reuses the same command layer as the CLI is cheap and on-brand.
    Sources: [linear-github-plane](competitors/linear-github-plane.md) gap 4, [user-demand](competitors/user-demand.md) row 14.
11. **PWA, offline read cache, and mobile polish.** 8 of 9. Offline was Notion's single most
    requested feature; Planka's mobile issue has been open since 2020 and full phone support is
    now Pro-only; ClickUp cannot edit tasks offline. Responsive is acceptable at MVP; a real
    offline cache with MorrowList's existing versioning would beat every hosted competitor.
    Sources: [notion-clickup](competitors/notion-clickup.md) differentiator "Offline-first", [open-source](competitors/open-source.md) gap "PWA".

### Tier 2: table-stakes for the persona that the MVP spec excludes

These are §2.4 non-goals or long-term ideas. Competitors in the personal segment treat them as
core, and users name them as top upgrade reasons. Recommend moving them ahead of the graph view.

12. **Recurring tasks.** 8 of 9. Notion's "Achilles heel" for years; Planka's request open
    since 2020 and now Pro-only; 41, 36 and 18 reactions on Plane, Super Productivity and
    Planka; Jira and monday force users into quota-capped automation hacks. Keep Notion's simple
    daily/weekly/monthly/yearly plus interval and "after completion" mode; Todoist's "every 3rd
    Tuesday" parsing is the ceiling.
    Sources: [user-demand](competitors/user-demand.md) row 3, [jira](competitors/jira.md) gap 11.
13. **Due-date reminders and notifications** (in-app, push via PWA, email). 5 of 9. Named the
    "#1 upgrade reason" for Todoist Pro; Planka's due-date notification issue has 16 reactions;
    Trello's opt-in reminder model confuses users. Default to a sensible reminder when a due time
    is set.
    Sources: [personal-task-apps](competitors/personal-task-apps.md) gap "Reminders", [open-source](competitors/open-source.md) gap "notifications".
14. **Calendar view, then an ICS feed, then CalDAV.** 7 of 9. Free in Asana, monday, Notion,
    ClickUp; Jira's personal template leads with Board/List/Calendar; Planka's top calendar issues
    carry 27 and 19 reactions; Vikunja's CalDAV is self-described "early alpha". An ICS feed is an
    80% win at low cost; two-way Google/Outlook sync is a later, high-effort differentiator.
    Sources: [open-source](competitors/open-source.md) gap "Calendar", [personal-task-apps](competitors/personal-task-apps.md) gap "Calendar sync".
15. **Natural-language quick add** ("tomorrow 5pm p1 #project"). 3 of 9 but unanimous within the
    personal segment: Todoist's "signature strength", one of TickTick's most-loved features.
    Cheap to add to the existing quick-add and CLI.
    Sources: [personal-task-apps](competitors/personal-task-apps.md) gap 2.
16. **Start / defer dates and deadline versus scheduled date.** Todoist users waited years for
    deadlines (January 2025) and still lack start dates; Things and OmniFocus treat defer and
    when dates as core; Trello and Jira need start dates for calendar and timeline. One task
    model can carry scheduled, deadline and defer.
    Sources: [personal-task-apps](competitors/personal-task-apps.md) gap "Deadline vs scheduled", [trello](competitors/trello.md) gap 7.

### Tier 3: differentiators MorrowList is unusually placed to win

17. **Flow metrics from the activity log.** The Kanban Guide 2025.5 makes WIP, throughput,
    work item age and cycle time mandatory; Kanban Tool ships them free, KanbanFlow paywalls
    them, and reviewers of Businessmap and SwiftKanban call their analytics poor. Every status
    transition is already an immutable event in MorrowList, so this needs a read model only:
    an **age badge and fade on cards**, cycle-time percentiles per project ("you usually finish
    these in 4 days"), weekly throughput, and later a cumulative flow and aging-WIP chart. No
    personal tool offers this.
    Sources: [kanban-method-tools](competitors/kanban-method-tools.md) gaps 1 to 4, [jira](competitors/jira.md) gap 17.
18. **Webhooks, an MCP server, and a compact agent CLI.** Trello, Todoist, TickTick, Asana,
    monday, Linear and Sunsama all shipped MCP surfaces in 2025 or 2026; Notion gates webhooks to
    Plus and ClickUp to Business; Vikunja's webhooks have no retry. Linear's shape (HMAC
    signature, timestamp guard, retries, `updatedFrom` diffs) is the bar, and Linear's community
    built a bash CLI because the official MCP burned 13k tokens on 20+ tools. MorrowList's outbox
    plus a `morrow usage` command for agents is the direct answer, and 2026 Hacker News threads
    on agent-driven Kanban show the audience.
    Sources: [linear-github-plane](competitors/linear-github-plane.md) gaps 6 and 7, [user-demand](competitors/user-demand.md) rows 11 and 45.
19. **Board group-by, swimlanes, and a cross-project board.** Notion and ClickUp group by any
    property free; Asana only shipped swimlanes in July 2025 and gated them; WeKan's swimlane
    issue has 40 reactions; Planner's My Tasks board grouped by plan is the closest "Kanban of my
    day". Because the board already projects one task model, group-by project or priority and a
    Today-as-board view need no schema change.
    Sources: [notion-clickup](competitors/notion-clickup.md) table-stakes 1, [personal-task-apps](competitors/personal-task-apps.md) gap "Cross-project board".
20. **Explicit column policies and a cross-project WIP limit.** "Make policies explicit" is a
    core Kanban practice (Kanban Tool, AgilePlace, Kanban Zone show it on the column). Personal
    Kanban's central rule is two or three items in Doing, which is a cross-project constraint
    that no competitor's per-board limit enforces.
    Sources: [kanban-method-tools](competitors/kanban-method-tools.md) gaps 7 and 9.
21. **Small, uncapped automation rules.** Trello's Butler is praised but capped at 250 or 1,000
    runs a month and users hit it "in week 2"; Asana caps rules per project on Starter; monday
    caps actions; Kanboard is the only open-source tool with rules and it is in maintenance mode.
    Five personal rules (due today to Today, moved to Done completes, checklist done moves card,
    HTTP call) with no quota would differentiate.
    Sources: [trello](competitors/trello.md) gap 13, [asana-monday](competitors/asana-monday.md) gap 9.
22. **Capture channels into the Inbox.** Trello Inbox with email-in was "about the only thing
    they changed that was good" in the 2025 redesign; Things' widget is "the fastest way to add
    ideas"; web-only tools lose capture moments. Email-to-inbox, a PWA share target, a global
    quick-add hotkey, and a browser extension, in that order.
    Sources: [trello](competitors/trello.md) gap 11, [personal-task-apps](competitors/personal-task-apps.md) gap "Offline/PWA + mobile capture".
23. **One-command deployment and published performance numbers.** Self-hosters rank tools by
    RAM footprint and database choice first; Planka's SQLite request has 15 reactions, Focalboard's
    top issue (110 reactions) is downloadable binaries, Huly needs 8 to 16 GB RAM; "sluggish with
    large data" is Capterra's top con for the whole category. A single container plus Postgres,
    an optional SQLite mode, and a published 10k-task benchmark are adoption features.
    Sources: [open-source](competitors/open-source.md) gap "SQLite", [user-demand](competitors/user-demand.md) rows 5 and 29.
24. **A few typed custom fields, not a property system.** Vikunja's top open request (16
    reactions), Planka's (13, Pro-only), Plane's (62); Linear's refusal is a recurring complaint.
    Counter-evidence: Jira's "87 fields to file a bug" and Notion's slowdown past 5,000 rows.
    Cap at select, number, date, text.
    Sources: [open-source](competitors/open-source.md) gap "Custom fields", [notion-clickup](competitors/notion-clickup.md) differentiator "Lightweight tags".

### Tier 4: nice-to-have

25. Task and board templates, duplicate task (Planka 15 reactions, Plane 16).
26. Card colors, covers, per-view card field visibility (Trello parity cosmetics).
27. Attachments and inline images (every competitor; spec non-goal; storage adds ops burden).
28. Sub-projects or project folders (Super Productivity 52 reactions, Vikunja 11).
29. Time estimates and time tracking (Plane 57 reactions; Vikunja moved it to paid).
30. Weekly review or shutdown ritual (OmniFocus Review, Sunsama shutdown) built on the activity log.
31. Public read-only board links (Planka's top request, 32 reactions; spec non-goal).
32. Monte Carlo "when will these N tasks finish" once throughput history exists.
33. Optional AI summarise or date-from-title with a user-supplied key; never metered or gated.
34. Real-time multi-user sync, comments and mentions (table-stakes once teams arrive, not before).

### Avoid: features users complain about

Dashboards, portfolios, goals, workload and capacity planning; sprints, velocity and burndown;
a full query language like JQL; heavy automation builders; notification floods (ClickUp's top
con); AI as a metered per-seat add-on; twenty property types; built-in chat or email; per-seat
pricing and gated basics; opt-out telemetry; and a sign-up wall before the first board.
Sources: [user-demand](competitors/user-demand.md) §5, [jira](competitors/jira.md) gap 24, [notion-clickup](competitors/notion-clickup.md) "What not to copy".

## 5. Suggested delivery order

Ordered by importance, then by how much each step reuses what exists.

| Phase                    | Items                                                                                             | Rationale                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| A. Finish the spec       | 1 subtasks, 3 tags, 2 search + saved views, 4 Today/Upcoming, 5 column editing                    | Table-stakes, all in spec, schema mostly present                               |
| B. Trust and portability | 7 export + Trello import, 8 undo + bulk, 9 activity UI, 10 shortcuts + palette                    | Cheap, reuse events and commands, answer the lock-in objection                 |
| C. Daily loop            | 12 recurring, 13 reminders, 15 NLP quick add, 16 start/defer dates, 14 calendar + ICS             | Spec change; the personal persona's top upgrade reasons                        |
| D. Stand out             | 17 flow metrics, 6 relations with blocker reason, 20 policies + global WIP, 19 group-by/swimlanes | Method-grade board no personal tool has; mostly read models over existing data |
| E. Reach                 | 11 PWA offline, 22 capture channels, 18 webhooks + MCP + agent CLI, 23 deploy + benchmark         | Turns API-first and self-hosted from claims into demonstrated advantages       |
| F. Later                 | 21 rules, 24 typed fields, Tier 4                                                                 | After A to E show usage                                                        |

## 6. Spec implications worth deciding

- §2.4 lists recurring tasks, reminders and calendar view as MVP non-goals and §5.3 sequences
  them after the relationship graph and the motivation framework. The evidence in Tier 2 argues
  for swapping that order: those three are table-stakes for the persona, and the graph is a
  differentiator with little direct demand evidence in any segment.
- §9.5 models blocking as a Blocked status. Tier 1 item 6 and Tier 3 item 20 argue for a
  blocker relation or flag with a reason, keeping the task in its real column; the Blocked
  column can remain as a view.
- Attachments and public sharing stay non-goals; evidence supports deferring both.

## 7. Advantages MorrowList already has and should keep visible

- Optimistic concurrency with a 409 and Refresh/Retry: Trello silently overwrites concurrent
  description edits, monday says "yours will override theirs".
- Trash with restore: Trello and Jira delete permanently; Jira cannot restore a work item at all.
- Keyboard drag plus a Move menu: Trello's drag-and-drop is a documented accessibility barrier.
- Human task keys (`ML-12`): a Hacker News reviewer called their absence "the number one thing
  missing" in a lightweight board; GitHub Projects has none.
- A maintained first-party CLI: no open-source competitor has one (Kanboard's is unmaintained,
  Vikunja's is admin-only, Planka's are third-party).
- One canonical task model with Inbox, Today and board as views: the "no silos" ask in the
  Zenkit and Super Productivity threads.
- Self-hosted, no seats, no quotas, no telemetry: the top three abandonment triggers in the
  demand evidence are bloat, slowness, and vendor moves (price hikes, gating, license flips).

## 8. Segment reports

- [Trello](competitors/trello.md)
- [Jira](competitors/jira.md)
- [Asana and monday.com](competitors/asana-monday.md)
- [Notion and ClickUp](competitors/notion-clickup.md)
- [Linear, GitHub Projects, Plane](competitors/linear-github-plane.md)
- [Open-source self-hosted tools](competitors/open-source.md)
- [Personal task apps](competitors/personal-task-apps.md)
- [Kanban-method tools and guides](competitors/kanban-method-tools.md)
- [User demand evidence](competitors/user-demand.md)
