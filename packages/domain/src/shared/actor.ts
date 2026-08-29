/**
 * Actor kinds recorded on every mutation (spec 17.4). `agent` is reserved and unused in
 * the MVP; its presence keeps the audit schema stable when agent execution lands.
 */
export const ACTOR_KINDS = [
  "user",
  "api_key",
  "system",
  "integration",
  "agent",
] as const;

export type ActorKind = (typeof ACTOR_KINDS)[number];

/** The minimal actor snapshot persisted alongside a mutated row. */
export interface ActorRef {
  readonly kind: ActorKind;
  readonly id: string;
}

export function isActorKind(value: string): value is ActorKind {
  return (ACTOR_KINDS as readonly string[]).includes(value);
}
