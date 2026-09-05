"use client";

import type {
  CreatedWebhookSubscriptionDto,
  WebhookSubscriptionDto,
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
import { useId, useState, type FormEvent } from "react";

import {
  useCreateWebhook,
  useDeleteWebhook,
  useRetryDelivery,
  useTestWebhook,
  useUpdateWebhook,
  useWebhookDeliveries,
  useWebhooks,
} from "../hooks/use-webhooks";
import {
  EVENT_PRESETS,
  deliveryDetail,
  deliveryTone,
  describeDelivery,
  describeEndpoint,
  parseEventTypes,
} from "../lib/webhook-view";

/**
 * Webhook endpoints and their delivery log (GAP-18).
 *
 * The signing secret is shown exactly once, immediately after creation, because the
 * server keeps only its digest and genuinely cannot show it again.
 */
export function WebhookSettingsPage() {
  const webhooks = useWebhooks();
  const [created, setCreated] = useState<CreatedWebhookSubscriptionDto | null>(null);

  return (
    <div className="webhook-settings stack">
      <header className="page-header">
        <h1>Webhooks</h1>
        <p className="page-header__subtitle">
          Every change in this workspace can be POSTed to an endpoint you control,
          signed so you can prove it came from MorrowList. Failed deliveries retry after
          a minute, an hour and six hours before they are set aside.
        </p>
      </header>

      <CreateForm onCreated={setCreated} />

      {created ? (
        <Alert tone="success" title="Endpoint added — copy the signing secret now">
          <p>
            This is the only time it is shown. MorrowList stores a one-way digest of it
            and cannot display it again.
          </p>
          <p>
            <code className="webhook-settings__secret">{created.secret}</code>
          </p>
          <Button onClick={() => setCreated(null)}>I have stored it</Button>
        </Alert>
      ) : null}

      {webhooks.isPending ? (
        <div className="task-list__status">
          <Spinner label="Loading webhook endpoints" />
        </div>
      ) : webhooks.isError ? (
        <Alert tone="error" title="Endpoints could not be loaded">
          <Button onClick={() => void webhooks.refetch()}>Try again</Button>
        </Alert>
      ) : webhooks.data.data.length === 0 ? (
        <EmptyState
          title="No endpoints yet"
          description="Add one above to start receiving events."
        />
      ) : (
        <ul className="webhook-settings__list" aria-label="Webhook endpoints">
          {webhooks.data.data.map((webhook) => (
            <EndpointRow key={webhook.id} webhook={webhook} />
          ))}
        </ul>
      )}
    </div>
  );
}

function CreateForm({
  onCreated,
}: {
  readonly onCreated: (created: CreatedWebhookSubscriptionDto) => void;
}) {
  const create = useCreateWebhook();
  const id = useId();
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string>(EVENT_PRESETS[0].value);
  const [description, setDescription] = useState("");

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    try {
      onCreated(
        await create.mutateAsync({
          url: trimmed,
          eventTypes: parseEventTypes(events),
          ...(description.trim() ? { description: description.trim() } : {}),
        }),
      );
      setUrl("");
      setDescription("");
    } catch {
      // Reported below; the values stay so the URL can be corrected and retried.
    }
  }

  return (
    <form
      className="webhook-settings__create"
      aria-label="Add a webhook endpoint"
      onSubmit={(event) => void onSubmit(event)}
    >
      <div className="webhook-settings__field webhook-settings__field--wide">
        <Field label="Endpoint URL" htmlFor={`${id}-url`}>
          <TextInput
            id={`${id}-url`}
            value={url}
            placeholder="https://example.com/morrow-webhook"
            autoComplete="off"
            onChange={(event) => setUrl(event.target.value)}
          />
        </Field>
      </div>
      <div className="webhook-settings__field">
        <Field label="Events" htmlFor={`${id}-events`}>
          <Select
            id={`${id}-events`}
            value={events}
            onChange={(event) => setEvents(event.target.value)}
          >
            {EVENT_PRESETS.map((preset) => (
              <option key={preset.value} value={preset.value}>
                {preset.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="webhook-settings__field">
        <Field label="Description" htmlFor={`${id}-description`}>
          <TextInput
            id={`${id}-description`}
            value={description}
            placeholder="Optional"
            autoComplete="off"
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
      </div>
      <div className="webhook-settings__actions">
        <Button type="submit" variant="primary" loading={create.isPending}>
          Add endpoint
        </Button>
      </div>
      {create.isError ? (
        <div className="webhook-settings__error">
          <Alert tone="error" title="Not added">
            {create.error instanceof Error
              ? create.error.message
              : "Something went wrong."}
          </Alert>
        </div>
      ) : null}
    </form>
  );
}

function EndpointRow({ webhook }: { readonly webhook: WebhookSubscriptionDto }) {
  const update = useUpdateWebhook();
  const remove = useDeleteWebhook();
  const test = useTestWebhook();
  const [open, setOpen] = useState(false);

  return (
    <li className="webhook-settings__item">
      <div className="webhook-settings__summary">
        <div className="webhook-settings__identity">
          <strong>{webhook.url}</strong>
          <span className="task-detail__hint">{describeEndpoint(webhook)}</span>
          {webhook.description ? <span>{webhook.description}</span> : null}
          <span className="task-detail__hint">
            Signing secret {webhook.secretPrefix}…
          </span>
        </div>
        <div className="webhook-settings__actions">
          <Button
            loading={test.isPending}
            onClick={() => {
              setOpen(true);
              test.mutate(webhook.id);
            }}
          >
            Send test
          </Button>
          <Button
            onClick={() =>
              update.mutate({
                id: webhook.id,
                request: { active: !webhook.active },
              })
            }
            loading={update.isPending}
          >
            {webhook.active ? "Pause" : "Resume"}
          </Button>
          <Button
            variant="danger"
            loading={remove.isPending}
            onClick={() => remove.mutate(webhook.id)}
          >
            Remove
          </Button>
          <Button
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls={`deliveries-${webhook.id}`}
          >
            {open ? "Hide deliveries" : "Deliveries"}
          </Button>
        </div>
      </div>

      {test.isSuccess && test.variables === webhook.id ? (
        <p className="task-detail__hint" role="status">
          Test delivery: {describeDelivery(test.data)}
        </p>
      ) : null}

      {open ? <DeliveryLog webhookId={webhook.id} /> : null}
    </li>
  );
}

function DeliveryLog({ webhookId }: { readonly webhookId: string }) {
  const deliveries = useWebhookDeliveries(webhookId);
  const retry = useRetryDelivery();

  if (deliveries.isPending) {
    return (
      <div className="task-list__status">
        <Spinner label="Loading deliveries" />
      </div>
    );
  }
  if (deliveries.isError) {
    return (
      <Alert tone="error" title="Deliveries could not be loaded">
        <Button onClick={() => void deliveries.refetch()}>Try again</Button>
      </Alert>
    );
  }
  if (deliveries.data.data.length === 0) {
    return (
      <p className="task-detail__hint" id={`deliveries-${webhookId}`}>
        Nothing has been sent to this endpoint yet.
      </p>
    );
  }

  return (
    <table className="webhook-settings__deliveries" id={`deliveries-${webhookId}`}>
      <caption className="ml-visually-hidden">Recent deliveries</caption>
      <thead>
        <tr>
          <th scope="col">Event</th>
          <th scope="col">Result</th>
          <th scope="col">Detail</th>
          <th scope="col">When</th>
          <th scope="col">
            <span className="ml-visually-hidden">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {deliveries.data.data.map((delivery) => (
          <tr key={delivery.id} data-tone={deliveryTone(delivery)}>
            <td>{delivery.eventType}</td>
            <td>{describeDelivery(delivery)}</td>
            <td>{deliveryDetail(delivery)}</td>
            <td>{delivery.createdAt.slice(0, 16).replace("T", " ")}</td>
            <td>
              {delivery.status === "failed" && delivery.eventId ? (
                <Button
                  loading={retry.isPending}
                  onClick={() =>
                    retry.mutate({ id: webhookId, deliveryId: delivery.id })
                  }
                >
                  Retry
                </Button>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
