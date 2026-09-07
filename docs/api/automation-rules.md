# Automation rules

Manage rules at **Workspace settings → Automation rules**, or `/api/v1/rules`.
Creating or changing rules requires `workspace:write` and `tasks:write`; listing and runs
require `workspace:write`, and testing also requires `tasks:read`.

The fixed triggers are task.created, task.updated (optional changed field), task.moved,
task.completed, task.tag_added (optional tag), and due.today. Conditions are ANDed:
project_is, priority_is, tag_has, due_within (0–365 days starting today). Actions are
add_to_day, move_to, set_priority, add_tag, complete, call_webhook. Each rule has 1–10
actions and at most 10 conditions. There is no daily run quota.

The shared worker evaluates committed events in batches of 100 plus up to 100 daily
candidates. Rule actions use the normal task policies, with activity attributed to
`Rule: <name>`. A run's claim and all actions commit together, or all roll back. Failures
appear in the run log and are terminal. Fix the task/rule and generate a new trigger to
try again. Rule-created changes never trigger other rules, so mutually triggering rules
cannot loop. Multiple workers deduplicate each rule/event transactionally.

Creating, editing, or re-enabling a rule starts its event eligibility at that instant;
old events do not replay. Disabling pauses it. Due-today uses the workspace's calendar
date, includes open tasks due on that date, and records one rule/task/date receipt. An
edit or disable/re-enable does not cause a second daily run on the same day. Conditions
are evaluated against the task's current values when the worker claims the event.

`POST /rules/{id}/test` with `{ "taskId": "…" }` simulates the configured trigger and
checks current task conditions, without changing tasks or sending webhooks. It is a
preview, not a replay of a historical event. `GET /rules/{id}/runs?limit=50` returns the
latest 1–200 receipts; succeeded webhook actions mean queued, not delivered.

## Calling a URL

First add a webhook endpoint and choose **Only when called by a rule**. Its API event
filter is the reserved singleton `["rule.only"]`. Normal webhook fanout explicitly
ignores it; mixing that filter with automatic event types is rejected. A call_webhook
action must reference an active endpoint in that mode and the same workspace.

The action queues the triggering event for the existing signed dispatcher. Multiple
calls to the same endpoint for the same event deduplicate, including across rules.
Delivery failures use the existing retry/backoff and delivery log. A failed rule transaction
queues nothing. Ordinary webhook subscriptions continue receiving the activity events
they selected, independently of rules; those cannot be selected as rule action targets.

## CLI

```sh
morrow rule create '{"name":"Plan due tasks","trigger":{"type":"due.today"},"actions":[{"type":"add_to_day"}]}'
morrow rule list --json
morrow rule update RULE_ID '{"name":"Plan today"}'
morrow rule disable RULE_ID
morrow rule enable RULE_ID
morrow rule test RULE_ID TASK_ID --json
morrow rule runs RULE_ID --json
morrow rule delete RULE_ID
morrow webhook add https://example.com/hook --events rule.only
```
