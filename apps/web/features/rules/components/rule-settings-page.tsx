"use client";
import {
  createRuleRequestSchema,
  RULE_ONLY_WEBHOOK_EVENT,
  type CreateRuleRequest,
  type RuleDto,
} from "@morrowlist/contracts";
import {
  Alert,
  Button,
  EmptyState,
  Field,
  Select,
  Spinner,
  TextInput,
} from "@morrowlist/ui";
import Link from "next/link";
import { useId, useState, type FormEvent, type ReactNode } from "react";

import { useRuleMutations, useRuleRuns, useRules } from "../hooks/use-rules";

import { useProjects } from "@/features/projects/hooks/use-projects";
import { useTags } from "@/features/tags/hooks/use-tags";
import { useTaskList } from "@/features/tasks/hooks/use-tasks";
import { useWebhooks } from "@/features/webhooks/hooks/use-webhooks";

type Action = CreateRuleRequest["actions"][number];
type Condition = CreateRuleRequest["conditions"][number];
const triggers = {
  "task.created": "Task created",
  "task.updated": "Task updated",
  "task.moved": "Task moved",
  "task.completed": "Task completed",
  "task.tag_added": "Tag added",
  "due.today": "Task due today",
};
const actions = {
  add_to_day: "Add to My Day",
  move_to: "Move to project",
  set_priority: "Set priority",
  add_tag: "Add tag",
  complete: "Complete task",
  call_webhook: "Call webhook",
};
const conditions = {
  project_is: "Project is",
  priority_is: "Priority is",
  tag_has: "Has tag",
  due_within: "Due within days",
};
const priorities = ["none", "low", "medium", "high", "urgent"] as const;
const fieldNames = [
  "title",
  "descriptionMd",
  "priority",
  "dueDate",
  "dueTime",
  "dueTimezone",
  "deferUntil",
  "deadline",
  "deadlineTime",
  "fields",
  "recurrence",
  "reminderOffsetMinutes",
] as const;
const initial: CreateRuleRequest = {
  name: "",
  trigger: { type: "task.tag_added" },
  conditions: [],
  actions: [{ type: "set_priority", priority: "urgent" }],
  enabled: true,
};
const message = (error: unknown) =>
  error instanceof Error ? error.message : "Please try again.";

export function RuleSettingsPage() {
  const rules = useRules();
  const [editing, setEditing] = useState<RuleDto | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const mutation = useRuleMutations();
  return (
    <div className="stack">
      <header className="page-header">
        <h1>Automation rules</h1>
        <p className="page-header__subtitle">
          Small rules that run after a task changes. No run quota. Changes made by a
          rule do not trigger other rules.
        </p>
      </header>
      <RuleForm
        key={editing?.id ?? "create"}
        rule={editing}
        onSaved={() => setEditing(null)}
      />
      {editing && <Button onClick={() => setEditing(null)}>Cancel editing</Button>}
      {rules.isPending ? (
        <Spinner label="Loading automation rules" />
      ) : rules.isError ? (
        <Alert tone="error" title="Rules could not be loaded">
          <Button onClick={() => void rules.refetch()}>Try again</Button>
        </Alert>
      ) : !rules.data.data.length ? (
        <EmptyState
          title="No rules yet"
          description="Choose a trigger and action above to create your first rule."
        />
      ) : (
        <ul className="webhook-settings__list" aria-label="Automation rules">
          {rules.data.data.map((rule) => (
            <li className="webhook-settings__item stack" key={rule.id}>
              <div>
                <h2>{rule.name}</h2>
                <p>
                  {rule.enabled ? "Enabled" : "Disabled"} ·{" "}
                  {triggers[rule.trigger.type]} →{" "}
                  {rule.actions.map((action) => actions[action.type]).join(", ")}
                </p>
              </div>
              <div className="webhook-settings__actions">
                <Button onClick={() => setEditing(rule)}>Edit {rule.name}</Button>
                <Button
                  loading={mutation.update.isPending}
                  onClick={() =>
                    mutation.update.mutate({
                      id: rule.id,
                      body: { enabled: !rule.enabled },
                    })
                  }
                >
                  {rule.enabled ? "Disable" : "Enable"} {rule.name}
                </Button>
                <Button
                  onClick={() => setSelected(selected === rule.id ? null : rule.id)}
                >
                  Runs and test for {rule.name}
                </Button>
                <Button
                  disabled={mutation.remove.isPending}
                  onClick={() => {
                    if (window.confirm(`Delete ${rule.name} and its run log?`))
                      mutation.remove.mutate(rule.id);
                  }}
                >
                  Delete {rule.name}
                </Button>
              </div>
              {selected === rule.id && <RunLog rule={rule} />}
            </li>
          ))}
        </ul>
      )}
      {(mutation.update.isError || mutation.remove.isError) && (
        <Alert tone="error" title="Rule could not be changed">
          {message(mutation.update.error ?? mutation.remove.error)}
        </Alert>
      )}
      <p>
        Editing or re-enabling starts with new events. Due-today rules run once per task
        and day in the workspace timezone. Webhook actions use endpoints configured for
        “Only when called by a rule” and queue a signed delivery; view delivery results
        in <Link href="/settings/webhooks">Webhooks</Link>.
      </p>
    </div>
  );
}

function Labeled({
  label,
  children,
}: {
  label: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id}>
      {children(id)}
    </Field>
  );
}
function RuleForm({ rule, onSaved }: { rule: RuleDto | null; onSaved: () => void }) {
  const [value, setValue] = useState<CreateRuleRequest>(
    rule
      ? {
          name: rule.name,
          trigger: rule.trigger,
          actions: rule.actions,
          conditions: rule.conditions,
          enabled: rule.enabled,
        }
      : initial,
  );
  const [error, setError] = useState<string | null>(null);
  const mutation = useRuleMutations();
  const tags = useTags();
  const projects = useProjects();
  const webhooks = useWebhooks(200);
  const patch = (next: Partial<CreateRuleRequest>) =>
    setValue((current) => ({ ...current, ...next }));
  const action = (index: number, next: Action) =>
    patch({ actions: value.actions.map((item, i) => (i === index ? next : item)) });
  const condition = (index: number, next: Condition) =>
    patch({
      conditions: value.conditions.map((item, i) => (i === index ? next : item)),
    });
  const tagOptions = (
    <>
      <option value="">Choose a tag</option>
      {tags.data?.data.map((tag) => (
        <option key={tag.id} value={tag.id}>
          {tag.name}
        </option>
      ))}
    </>
  );
  const projectOptions = (
    <>
      <option value="">Inbox</option>
      {projects.data?.data.map((project) => (
        <option key={project.id} value={project.id}>
          {project.name}
        </option>
      ))}
    </>
  );
  const priorityOptions = priorities.map((priority) => (
    <option key={priority} value={priority}>
      {priority}
    </option>
  ));
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const parsed = createRuleRequestSchema.safeParse(value);
    if (!parsed.success) {
      setError(
        parsed.error.issues
          .map((issue) => `${issue.path.join(" ")}: ${issue.message}`)
          .join(". "),
      );
      return;
    }
    try {
      if (rule) await mutation.update.mutateAsync({ id: rule.id, body: parsed.data });
      else await mutation.create.mutateAsync(parsed.data);
      setValue(initial);
      onSaved();
    } catch (cause) {
      setError(message(cause));
    }
  }
  return (
    <form
      className="stack"
      aria-label={rule ? `Edit rule ${rule.name}` : "Create automation rule"}
      onSubmit={(event) => void submit(event)}
    >
      <h2>{rule ? "Edit rule" : "Create a rule"}</h2>
      <Labeled label="Rule name">
        {(id) => (
          <TextInput
            id={id}
            required
            maxLength={150}
            value={value.name}
            onChange={(event) => patch({ name: event.target.value })}
          />
        )}
      </Labeled>
      <Labeled label="When">
        {(id) => (
          <Select
            id={id}
            value={value.trigger.type}
            onChange={(event) =>
              patch({
                trigger: {
                  type: event.target.value as CreateRuleRequest["trigger"]["type"],
                },
              })
            }
          >
            {Object.entries(triggers).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </Select>
        )}
      </Labeled>
      {value.trigger.type === "task.tag_added" && (
        <Labeled label="Trigger tag">
          {(id) => (
            <Select
              id={id}
              value={
                value.trigger.type === "task.tag_added"
                  ? (value.trigger.tagId ?? "")
                  : ""
              }
              onChange={(event) =>
                patch({
                  trigger: {
                    type: "task.tag_added",
                    ...(event.target.value ? { tagId: event.target.value } : {}),
                  },
                })
              }
            >
              <option value="">Any tag</option>
              {tags.data?.data.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}
                </option>
              ))}
            </Select>
          )}
        </Labeled>
      )}
      {value.trigger.type === "task.updated" && (
        <Labeled label="Changed field">
          {(id) => (
            <Select
              id={id}
              value={
                value.trigger.type === "task.updated" ? (value.trigger.field ?? "") : ""
              }
              onChange={(event) =>
                patch({
                  trigger: {
                    type: "task.updated",
                    ...(event.target.value
                      ? { field: event.target.value as (typeof fieldNames)[number] }
                      : {}),
                  },
                })
              }
            >
              <option value="">Any field</option>
              {fieldNames.map((field) => (
                <option key={field} value={field}>
                  {
                    {
                      title: "Title",
                      descriptionMd: "Description",
                      priority: "Priority",
                      dueDate: "Due date",
                      dueTime: "Due time",
                      dueTimezone: "Due timezone",
                      deferUntil: "Defer date",
                      deadline: "Deadline",
                      deadlineTime: "Deadline time",
                      fields: "Custom fields",
                      recurrence: "Repeating schedule",
                      reminderOffsetMinutes: "Reminder",
                    }[field]
                  }
                </option>
              ))}
            </Select>
          )}
        </Labeled>
      )}
      <fieldset className="stack">
        <legend>Only if all conditions match</legend>
        {value.conditions.map((item, index) => (
          <div className="stack" key={index}>
            <Labeled label={`Condition ${index + 1}`}>
              {(id) => (
                <Select
                  id={id}
                  value={item.type}
                  onChange={(event) => {
                    const type = event.target.value as Condition["type"];
                    condition(
                      index,
                      type === "project_is"
                        ? { type, projectId: null }
                        : type === "priority_is"
                          ? { type, priority: "urgent" }
                          : type === "tag_has"
                            ? { type, tagId: "" }
                            : { type, days: 0 },
                    );
                  }}
                >
                  {Object.entries(conditions).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </Select>
              )}
            </Labeled>
            {item.type === "project_is" && (
              <Labeled label={`Condition project ${index + 1}`}>
                {(id) => (
                  <Select
                    id={id}
                    value={item.projectId ?? ""}
                    onChange={(event) =>
                      condition(index, {
                        ...item,
                        projectId: event.target.value || null,
                      })
                    }
                  >
                    {projectOptions}
                  </Select>
                )}
              </Labeled>
            )}
            {item.type === "priority_is" && (
              <Labeled label={`Condition priority ${index + 1}`}>
                {(id) => (
                  <Select
                    id={id}
                    value={item.priority}
                    onChange={(event) =>
                      condition(index, {
                        ...item,
                        priority: event.target.value as (typeof priorities)[number],
                      })
                    }
                  >
                    {priorityOptions}
                  </Select>
                )}
              </Labeled>
            )}
            {item.type === "tag_has" && (
              <Labeled label={`Condition tag ${index + 1}`}>
                {(id) => (
                  <Select
                    id={id}
                    required
                    value={item.tagId}
                    onChange={(event) =>
                      condition(index, { ...item, tagId: event.target.value })
                    }
                  >
                    {tagOptions}
                  </Select>
                )}
              </Labeled>
            )}
            {item.type === "due_within" && (
              <Labeled label={`Days from today ${index + 1}`}>
                {(id) => (
                  <TextInput
                    id={id}
                    type="number"
                    min={0}
                    max={365}
                    value={item.days}
                    onChange={(event) =>
                      condition(index, { ...item, days: Number(event.target.value) })
                    }
                  />
                )}
              </Labeled>
            )}
            <Button
              onClick={() =>
                patch({ conditions: value.conditions.filter((_, i) => i !== index) })
              }
            >
              Remove condition {index + 1}
            </Button>
          </div>
        ))}
        <Button
          disabled={value.conditions.length >= 10}
          onClick={() =>
            patch({
              conditions: [
                ...value.conditions,
                { type: "priority_is", priority: "urgent" },
              ],
            })
          }
        >
          Add condition
        </Button>
      </fieldset>
      <fieldset className="stack">
        <legend>Then</legend>
        {value.actions.map((item, index) => (
          <div className="stack" key={index}>
            <Labeled label={`Action ${index + 1}`}>
              {(id) => (
                <Select
                  id={id}
                  value={item.type}
                  onChange={(event) => {
                    const type = event.target.value as Action["type"];
                    action(
                      index,
                      type === "set_priority"
                        ? { type, priority: "urgent" }
                        : type === "move_to"
                          ? { type, projectId: null }
                          : type === "add_tag"
                            ? { type, tagId: "" }
                            : type === "call_webhook"
                              ? { type, subscriptionId: "" }
                              : { type },
                    );
                  }}
                >
                  {Object.entries(actions).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </Select>
              )}
            </Labeled>
            {item.type === "set_priority" && (
              <Labeled label={`Priority ${index + 1}`}>
                {(id) => (
                  <Select
                    id={id}
                    value={item.priority}
                    onChange={(event) =>
                      action(index, {
                        ...item,
                        priority: event.target.value as (typeof priorities)[number],
                      })
                    }
                  >
                    {priorityOptions}
                  </Select>
                )}
              </Labeled>
            )}
            {item.type === "move_to" && (
              <Labeled label={`Destination project ${index + 1}`}>
                {(id) => (
                  <Select
                    id={id}
                    value={item.projectId ?? ""}
                    onChange={(event) =>
                      action(index, {
                        type: "move_to",
                        projectId: event.target.value || null,
                      })
                    }
                  >
                    {projectOptions}
                  </Select>
                )}
              </Labeled>
            )}
            {item.type === "add_tag" && (
              <Labeled label={`Action tag ${index + 1}`}>
                {(id) => (
                  <Select
                    id={id}
                    required
                    value={item.tagId}
                    onChange={(event) =>
                      action(index, { ...item, tagId: event.target.value })
                    }
                  >
                    {tagOptions}
                  </Select>
                )}
              </Labeled>
            )}
            {item.type === "call_webhook" && (
              <Labeled label={`Webhook endpoint ${index + 1}`}>
                {(id) => (
                  <Select
                    id={id}
                    required
                    value={item.subscriptionId}
                    onChange={(event) =>
                      action(index, { ...item, subscriptionId: event.target.value })
                    }
                  >
                    <option value="">Choose an endpoint for rule calls</option>
                    {webhooks.data?.data
                      .filter(
                        (endpoint) =>
                          endpoint.active &&
                          endpoint.eventTypes.length === 1 &&
                          endpoint.eventTypes[0] === RULE_ONLY_WEBHOOK_EVENT,
                      )
                      .map((endpoint) => (
                        <option key={endpoint.id} value={endpoint.id}>
                          {endpoint.description ?? endpoint.url}
                        </option>
                      ))}
                  </Select>
                )}
              </Labeled>
            )}
            <Button
              disabled={value.actions.length === 1}
              onClick={() =>
                patch({ actions: value.actions.filter((_, i) => i !== index) })
              }
            >
              Remove action {index + 1}
            </Button>
          </div>
        ))}
        <Button
          disabled={value.actions.length >= 10}
          onClick={() => patch({ actions: [...value.actions, { type: "add_to_day" }] })}
        >
          Add action
        </Button>
      </fieldset>
      {error && (
        <Alert tone="error" title="Rule could not be saved">
          {error}
        </Alert>
      )}
      {(tags.isError || projects.isError || webhooks.isError) && (
        <Alert tone="error" title="Some choices could not be loaded">
          <Button
            onClick={() => {
              void tags.refetch();
              void projects.refetch();
              void webhooks.refetch();
            }}
          >
            Reload choices
          </Button>
        </Alert>
      )}
      <Button
        type="submit"
        variant="primary"
        loading={mutation.create.isPending || mutation.update.isPending}
      >
        {rule ? "Save rule" : "Create rule"}
      </Button>
    </form>
  );
}

function RunLog({ rule }: { rule: RuleDto }) {
  const runs = useRuleRuns(rule.id);
  const mutation = useRuleMutations();
  const [taskId, setTaskId] = useState("");
  const tasks = useTaskList({ limit: 200 });
  return (
    <section className="stack" aria-label={`Runs for ${rule.name}`}>
      <h3>Test on a task</h3>
      <p>
        Preview a simulated trigger using current task values. This makes no changes.
      </p>
      <Labeled label="Test task">
        {(id) => (
          <Select
            id={id}
            value={taskId}
            onChange={(event) => {
              setTaskId(event.target.value);
              mutation.test.reset();
            }}
          >
            <option value="">Choose a task</option>
            {tasks.data?.data.map((task) => (
              <option key={task.id} value={task.id}>
                {task.title}
              </option>
            ))}
          </Select>
        )}
      </Labeled>
      <Button
        disabled={!taskId}
        loading={mutation.test.isPending}
        onClick={() => mutation.test.mutate({ id: rule.id, taskId })}
      >
        Test on this task
      </Button>
      {mutation.test.data && (
        <p role="status">
          {mutation.test.data.matches
            ? `Would run: ${mutation.test.data.actions.map((action) => actions[action.type]).join(", ")}.`
            : "This rule would not run."}
        </p>
      )}
      {mutation.test.isError && (
        <Alert tone="error" title="Test could not run">
          {message(mutation.test.error)}
        </Alert>
      )}
      <h3>Latest runs</h3>
      {runs.isPending ? (
        <Spinner label="Loading runs" />
      ) : runs.isError ? (
        <Alert tone="error" title="Runs could not be loaded">
          <Button onClick={() => void runs.refetch()}>Try again</Button>
        </Alert>
      ) : !runs.data.data.length ? (
        <p>No runs yet.</p>
      ) : (
        <ul aria-label="Run log">
          {runs.data.data.map((run) => (
            <li key={run.id}>
              <time dateTime={run.ranAt}>{new Date(run.ranAt).toLocaleString()}</time> ·{" "}
              {run.status}
              {run.error ? ` · ${run.error}` : ""}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
