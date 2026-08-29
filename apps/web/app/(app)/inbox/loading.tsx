import { Spinner } from "@morrowlist/ui";

/** Route-level loading boundary (FND-007). */
export default function Loading() {
  return (
    <div className="task-list__status">
      <Spinner label="Loading your Inbox" />
    </div>
  );
}
