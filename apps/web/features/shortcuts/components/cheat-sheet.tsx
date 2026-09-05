"use client";

import { useEffect, useId, useMemo, useRef } from "react";

import { chordLabel } from "../lib/keys";
import {
  COMMAND_GROUPS,
  chordIsEnabled,
  isAvailable,
  type Command,
  type ShortcutContext,
} from "../lib/registry";

/**
 * The cheat sheet (`?`), generated from the registry (GAP-10).
 *
 * It reads the same command list the key handler reads, so it cannot describe a shortcut
 * that does not exist or miss one that does. Commands that do not apply where the user
 * pressed `?` are still listed, greyed, with the reason — hiding them would make the
 * sheet look different on every page.
 *
 * The one setting lives here rather than under Settings because this is where somebody
 * who wants to switch single-key shortcuts off is already looking. `?` and Ctrl/⌘ K keep
 * working when they are off, so the way back is never locked away.
 */
export function CheatSheet({
  commands,
  context,
  singleKeyEnabled,
  onSingleKeyChange,
  onDismiss,
}: {
  readonly commands: readonly Command[];
  readonly context: ShortcutContext;
  readonly singleKeyEnabled: boolean;
  readonly onSingleKeyChange: (enabled: boolean) => void;
  readonly onDismiss: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const toggleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog?.open) dialog?.showModal();
    const focusFrame = window.requestAnimationFrame(() => closeRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(focusFrame);
      if (dialog?.open) dialog.close();
    };
  }, []);

  const groups = useMemo(
    () =>
      COMMAND_GROUPS.map((group) => ({
        group,
        commands: commands.filter((command) => command.group === group),
      })).filter((entry) => entry.commands.length > 0),
    [commands],
  );

  return (
    <dialog
      ref={dialogRef}
      className="cheat-sheet"
      aria-labelledby="cheat-sheet-title"
      onCancel={(event) => {
        event.preventDefault();
        onDismiss();
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onDismiss();
      }}
    >
      <div className="cheat-sheet__surface">
        <header className="cheat-sheet__header">
          <h2 id="cheat-sheet-title">Keyboard shortcuts</h2>
          <button
            ref={closeRef}
            type="button"
            className="cheat-sheet__close"
            aria-label="Close keyboard shortcuts"
            onClick={onDismiss}
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>

        <div className="cheat-sheet__body">
          {groups.map(({ group, commands: entries }) => (
            <section
              key={group}
              className="cheat-sheet__group"
              aria-labelledby={`${group}-heading`}
            >
              <h3 id={`${group}-heading`}>{group}</h3>
              <dl className="cheat-sheet__list">
                {entries.map((command) => {
                  const live = isAvailable(command, context);
                  const keys = command.keys.filter((chord) =>
                    chordIsEnabled(command, chord, { singleKeyEnabled }),
                  );
                  return (
                    <div
                      key={command.id}
                      className="cheat-sheet__row"
                      data-unavailable={!live || keys.length === 0 || undefined}
                    >
                      <dt>{command.title}</dt>
                      <dd>
                        {keys.length > 0 ? (
                          keys.map((chord) => (
                            <kbd key={chord}>{chordLabel(chord)}</kbd>
                          ))
                        ) : (
                          <span className="cheat-sheet__off">off</span>
                        )}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </section>
          ))}
        </div>

        <footer className="cheat-sheet__footer">
          <div className="cheat-sheet__setting">
            <input
              id={toggleId}
              type="checkbox"
              checked={singleKeyEnabled}
              onChange={(event) => onSingleKeyChange(event.target.checked)}
            />
            <label htmlFor={toggleId}>
              Single-key shortcuts
              <span className="cheat-sheet__hint">
                Off leaves only Ctrl/⌘ K and ?, for anyone who triggers keys by
                accident. Saved on this device.
              </span>
            </label>
          </div>
          <p className="cheat-sheet__note">
            Task shortcuts act on the row or card that has focus, or on the task whose
            detail is open. They never fire while you are typing.
          </p>
        </footer>
      </div>
    </dialog>
  );
}
