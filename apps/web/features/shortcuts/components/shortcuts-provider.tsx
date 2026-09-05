"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  useShortcutCommands,
  type ShortcutSurfaceActions,
} from "../hooks/use-shortcut-commands";
import { currentTaskKey } from "../lib/current-task";
import {
  CHORD_TIMEOUT_MS,
  isModalOpen,
  isTypingTarget,
  strokeChord,
} from "../lib/keys";
import {
  browserStorage,
  readSingleKeyEnabled,
  writeSingleKeyEnabled,
} from "../lib/preferences";
import {
  isPendingPrefix,
  resolveCommand,
  surfaceOf,
  type Command,
  type ShortcutContext,
} from "../lib/registry";

import { CheatSheet } from "./cheat-sheet";
import { CommandPalette } from "./command-palette";

/**
 * The one keyboard listener in the app (GAP-10, spec 14).
 *
 * It lives above the authenticated shell so the palette and the cheat sheet exist on
 * every route, and it is inert until a surface registers itself — the sign-in pages have
 * no shortcuts and must not acquire any. The registry decides what a key does; this
 * component only reads keystrokes, keeps the pending half of a `g` chord, and owns the
 * live region that says what happened.
 */

interface ShortcutsApi {
  readonly register: (actions: ShortcutSurfaceActions) => () => void;
  readonly openPalette: () => void;
  readonly openCheatSheet: () => void;
}

const ShortcutsContext = createContext<ShortcutsApi | null>(null);

const IDLE_CONTEXT: ShortcutContext = { surface: "other", hasTask: false };

/** Invisible, but enough of a change for a live region to read the same words twice. */
const ZERO_WIDTH_SPACE = "\u200B";
const REPEAT_MARKER = new RegExp(`${ZERO_WIDTH_SPACE}$`);

/**
 * Lets the workspace shell lend the registry the two things only it can do: open the
 * search dialog and open the Inbox capture tray.
 */
export function useShortcutSurface(actions: ShortcutSurfaceActions): void {
  const api = useContext(ShortcutsContext);
  const latest = useRef(actions);
  latest.current = actions;

  useEffect(() => {
    if (!api) return undefined;
    return api.register({
      openSearch: () => latest.current.openSearch(),
      openCapture: () => latest.current.openCapture(),
    });
  }, [api]);
}

/** The palette and the cheat sheet, for the controls in the shell that open them. */
export function useShortcutDialogs(): Pick<
  ShortcutsApi,
  "openPalette" | "openCheatSheet"
> | null {
  const api = useContext(ShortcutsContext);
  return api
    ? { openPalette: api.openPalette, openCheatSheet: api.openCheatSheet }
    : null;
}

export function ShortcutsProvider({ children }: { readonly children: ReactNode }) {
  const [surface, setSurface] = useState<ShortcutSurfaceActions | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [cheatSheetOpen, setCheatSheetOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [singleKeyEnabled, setSingleKeyEnabled] = useState(true);
  const [dialogContext, setDialogContext] = useState<ShortcutContext>(IDLE_CONTEXT);
  const restoreFocusTo = useRef<HTMLElement | null>(null);
  // The task that was current when a dialog opened. Focus moves into the dialog, so
  // without this the palette would forget the row the user was standing on.
  const pinnedTask = useRef<string | null>(null);
  const dialogOpenRef = useRef(false);
  const pendingChord = useRef<string | null>(null);
  const pendingTimer = useRef<number | null>(null);

  useEffect(() => {
    setSingleKeyEnabled(readSingleKeyEnabled(browserStorage()));
  }, []);

  /**
   * The same words twice running would not be re-read, so a repeat carries an invisible
   * marker. A polite live region announces the change and nothing else (spec 14).
   */
  const announce = useCallback((message: string) => {
    setAnnouncement((previous) =>
      previous.replace(REPEAT_MARKER, "") === message
        ? `${message}${ZERO_WIDTH_SPACE}`
        : message,
    );
  }, []);

  const openDialog = useCallback((show: (open: boolean) => void) => {
    restoreFocusTo.current = document.activeElement as HTMLElement | null;
    const key = currentTaskKey(document, window.location);
    pinnedTask.current = key;
    setDialogContext({
      surface: surfaceOf(window.location.pathname),
      hasTask: key !== null,
    });
    show(true);
  }, []);

  const openPalette = useCallback(() => openDialog(setPaletteOpen), [openDialog]);
  const openCheatSheet = useCallback(() => openDialog(setCheatSheetOpen), [openDialog]);

  const closeDialog = useCallback((show: (open: boolean) => void) => {
    show(false);
    setDialogContext(IDLE_CONTEXT);
    window.requestAnimationFrame(() => restoreFocusTo.current?.focus());
  }, []);

  // The pin is only the answer while a dialog is on screen. It is never cleared on
  // close: a command chosen in the palette runs from the click handler, before the
  // close has re-rendered, and reading a ref set during render is what makes that
  // ordering safe rather than a race.
  const pinnedTaskKey = useCallback(
    () => (dialogOpenRef.current ? pinnedTask.current : null),
    [],
  );

  const commands = useShortcutCommands({
    surface,
    announce,
    openPalette,
    openCheatSheet,
    pinnedTaskKey,
  });

  const api = useMemo<ShortcutsApi>(
    () => ({
      register: (actions) => {
        setSurface(actions);
        return () => setSurface((current) => (current === actions ? null : current));
      },
      openPalette,
      openCheatSheet,
    }),
    [openCheatSheet, openPalette],
  );

  // The listener is installed once; everything it needs that changes is read from a ref.
  const commandsRef = useRef<readonly Command[]>(commands);
  commandsRef.current = commands;
  const enabledRef = useRef(singleKeyEnabled);
  enabledRef.current = singleKeyEnabled;
  const activeRef = useRef(surface !== null);
  activeRef.current = surface !== null;
  dialogOpenRef.current = paletteOpen || cheatSheetOpen;

  useEffect(() => {
    function clearPending() {
      pendingChord.current = null;
      if (pendingTimer.current !== null) {
        window.clearTimeout(pendingTimer.current);
        pendingTimer.current = null;
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      // Nothing until the authenticated shell is mounted. A key going into a field, into
      // a modal, or already handled by the view is never a shortcut.
      if (!activeRef.current) return;
      if (event.defaultPrevented) return;
      if (isTypingTarget(event.target)) return;
      if (isModalOpen(document)) return;

      const stroke = strokeChord(event);
      if (stroke === null) return;

      const key = currentTaskKey(document, window.location);
      const context: ShortcutContext = {
        surface: surfaceOf(window.location.pathname),
        hasTask: key !== null,
      };
      const options = { singleKeyEnabled: enabledRef.current };
      const chord = pendingChord.current ? `${pendingChord.current} ${stroke}` : stroke;
      clearPending();

      const command = resolveCommand(commandsRef.current, chord, context, options);
      if (command) {
        event.preventDefault();
        void command.run();
        return;
      }

      if (isPendingPrefix(commandsRef.current, chord, context, options)) {
        event.preventDefault();
        pendingChord.current = chord;
        pendingTimer.current = window.setTimeout(clearPending, CHORD_TIMEOUT_MS);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      clearPending();
    };
  }, []);

  function changeSingleKey(enabled: boolean) {
    setSingleKeyEnabled(enabled);
    writeSingleKeyEnabled(browserStorage(), enabled);
    announce(
      enabled
        ? "Single-key shortcuts are on."
        : "Single-key shortcuts are off. Ctrl or Command K and ? still work.",
    );
  }

  return (
    <ShortcutsContext.Provider value={api}>
      {children}

      {/* One live region for every shortcut, so a keyboard user hears the result of a
          key whose effect may be off screen (spec 14). */}
      <output
        className="ml-visually-hidden"
        aria-live="polite"
        aria-label="Keyboard shortcut result"
      >
        {announcement}
      </output>

      {paletteOpen ? (
        <CommandPalette
          commands={commands}
          context={dialogContext}
          singleKeyEnabled={singleKeyEnabled}
          onDismiss={() => closeDialog(setPaletteOpen)}
        />
      ) : null}

      {cheatSheetOpen ? (
        <CheatSheet
          commands={commands}
          context={dialogContext}
          singleKeyEnabled={singleKeyEnabled}
          onSingleKeyChange={changeSingleKey}
          onDismiss={() => closeDialog(setCheatSheetOpen)}
        />
      ) : null}
    </ShortcutsContext.Provider>
  );
}
