"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import type { ProjectDto, TaskDto } from "@morrowlist/contracts";
import { Alert, Button, Spinner } from "@morrowlist/ui";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type SVGProps,
} from "react";

import { useUnreadCount } from "@/features/notifications/hooks/use-notifications";
import { unreadBadge } from "@/features/notifications/lib/notification-view";
import {
  clearCacheScope,
  useSyncCacheScope,
  useWarmCurrentView,
} from "@/features/offline/hooks/use-cache-scope";
import { purgeOfflineCaches } from "@/features/offline/lib/service-worker";
import { useCreateProject, useProjects } from "@/features/projects/hooks/use-projects";
import { SearchBox } from "@/features/search/components/search-box";
import {
  useShortcutDialogs,
  useShortcutSurface,
} from "@/features/shortcuts/components/shortcuts-provider";
import { QuickAdd } from "@/features/tasks/components/quick-add";
import { UndoToast } from "@/features/tasks/components/undo-toast";
import { useBackgroundTaskSync } from "@/features/tasks/hooks/use-background-task-sync";
import { useMoveTaskToProject, useTaskList } from "@/features/tasks/hooks/use-tasks";
import {
  destinationDroppableId,
  readDestination,
  readDraggedTask,
  taskDropCollision,
  type DestinationDropData,
} from "@/features/tasks/lib/task-dnd";
import { useTodayView } from "@/features/today/hooks/use-today";
import { countTodayTasks } from "@/features/today/lib/today-view";
import { useUpcomingView } from "@/features/upcoming/hooks/use-upcoming";
import { countUpcomingTasks } from "@/features/upcoming/lib/upcoming-view";
import { SavedViewNav } from "@/features/views/components/saved-view-nav";
import { WipCounter } from "@/features/workspace/components/wip-counter";
import { authClient } from "@/lib/auth-client";

export interface WorkspaceUser {
  readonly email: string;
  readonly name: string | null;
}

/**
 * The authenticated product frame. Capture and live project work lead the hierarchy;
 * history, project setup, and account actions remain one deliberate step away.
 */
export function WorkspaceShell({
  children,
  user,
}: {
  readonly children: ReactNode;
  readonly user: WorkspaceUser;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const projects = useProjects();
  useSyncCacheScope();
  useWarmCurrentView();
  const stopBackgroundTaskSync = useBackgroundTaskSync();
  const inbox = useTaskList({
    inbox: true,
    isCompleted: false,
    deferred: false,
    sort: "rank",
    order: "asc",
    limit: 200,
  });
  const today = useTodayView();
  const upcoming = useUpcomingView("14");
  const unread = useUnreadCount();
  const [inboxOpen, setInboxOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const restoreFocusTo = useRef<HTMLElement | null>(null);
  const dnd = useWorkspaceDragAndDrop();

  const inboxCount = inbox.data?.data.length ?? 0;
  const inboxUnavailable = inbox.isError && !inbox.data;
  const projectsUnavailable = projects.isError && !projects.data;
  const inboxCountLabel = inboxUnavailable
    ? "!"
    : `${inboxCount}${inbox.data?.page.hasMore ? "+" : ""}`;

  function openInbox() {
    restoreFocusTo.current = document.activeElement as HTMLElement | null;
    setInboxOpen(true);
  }

  function closeInbox() {
    setInboxOpen(false);
    window.requestAnimationFrame(() => restoreFocusTo.current?.focus());
  }

  function openSearch() {
    restoreFocusTo.current = document.activeElement as HTMLElement | null;
    setSearchOpen(true);
  }

  function closeSearch() {
    setSearchOpen(false);
    window.requestAnimationFrame(() => restoreFocusTo.current?.focus());
  }

  // Capture and search are registry commands like every other shortcut (GAP-10); the
  // shell only lends the registry the two things only it can do. One listener owns the
  // keyboard, so "never while typing, never over a dialog" is decided in one place.
  useShortcutSurface({ openSearch, openCapture: openInbox });
  const shortcutDialogs = useShortcutDialogs();

  async function signOut() {
    // Nothing private may outlive the session on this device (spec 25.3): the worker's
    // partitioned caches, unsent drafts, and the in-memory query cache all go.
    stopBackgroundTaskSync();
    await queryClient.cancelQueries();
    await purgeOfflineCaches();
    clearCacheScope();
    await authClient.signOut();
    queryClient.clear();
    router.push("/sign-in");
    router.refresh();
  }

  const projectItems = projects.data?.data ?? [];
  const historyCurrent = pathname === "/completed" || pathname === "/trash";
  const planningLinks = [
    {
      href: "/today",
      label: "Today",
      icon: "sun" as const,
      count: today.data
        ? String(countTodayTasks(today.data))
        : today.isError
          ? "!"
          : "·",
    },
    {
      href: "/upcoming",
      label: "Upcoming",
      icon: "calendar" as const,
      count: upcoming.data
        ? String(countUpcomingTasks(upcoming.data))
        : upcoming.isError
          ? "!"
          : "·",
    },
  ];
  // The bell sits beside the brand on desktop and in the menu on a phone: a nav row of
  // its own would push the sidebar past a laptop viewport, and a squeezed project list
  // no longer takes drops. The badge shows only unread; an empty badge is quieter than
  // a zero.
  const notificationsLink = {
    href: "/notifications",
    label: "Notifications",
    icon: "bell" as const,
    count: unread.data !== undefined ? unreadBadge(unread.data) : "",
  };

  return (
    <DndContext
      sensors={dnd.sensors}
      collisionDetection={taskDropCollision}
      onDragStart={dnd.onDragStart}
      onDragCancel={dnd.onDragCancel}
      onDragEnd={dnd.onDragEnd}
    >
      <div className="app-shell">
        <aside className="workspace-sidebar" aria-label="Workspace">
          <div className="workspace-topline">
            <Brand />
            {/* Beside the brand rather than in the nav, so the sidebar's drop targets
                keep their positions for keyboard drags. */}
            <span className="workspace-topline__tools">
              {/* A keyboard-first product has to say so somewhere a mouse can reach
                  (spec 14). Beside the brand rather than in the nav: another nav row
                  would push the sidebar past a laptop viewport. */}
              {shortcutDialogs ? (
                <button
                  type="button"
                  className="workspace-bell"
                  // "Shortcuts", not "Keyboard shortcuts": an accessible name
                  // containing "board" collides with the board controls under a
                  // substring role query.
                  aria-label="Shortcuts"
                  title="Keyboard shortcuts (?)"
                  onClick={shortcutDialogs.openCheatSheet}
                >
                  <Icon name="keyboard" />
                </button>
              ) : null}
              <Link
                className="workspace-bell"
                href={notificationsLink.href}
                aria-label={notificationsLink.label}
                title={notificationsLink.label}
                aria-current={pathname === notificationsLink.href ? "page" : undefined}
              >
                <Icon name="bell" />
                {notificationsLink.count ? (
                  <span className="workspace-bell__count" aria-hidden="true">
                    {notificationsLink.count}
                  </span>
                ) : null}
              </Link>
            </span>
          </div>

          <button
            type="button"
            className="workspace-search"
            aria-label="Search tasks and projects"
            title="Search (/)"
            onClick={openSearch}
          >
            <Icon name="search" />
            <span>Find anything</span>
            <kbd aria-hidden="true">/</kbd>
          </button>

          <button
            type="button"
            className="workspace-capture"
            aria-label="Capture a new Inbox task"
            onClick={openInbox}
          >
            <Icon name="plus" />
            <span>Capture a thought</span>
            <kbd aria-hidden="true">N</kbd>
          </button>

          <nav className="workspace-nav" aria-label="Primary">
            <span className="workspace-nav__label studio-nav-label">Your space</span>
            {planningLinks.map((link) => (
              <Link
                key={link.href}
                className="workspace-nav__link"
                href={link.href}
                aria-current={pathname === link.href ? "page" : undefined}
              >
                <Icon name={link.icon} />
                <span>{link.label}</span>
                {link.count ? (
                  <span className="workspace-nav__count" aria-hidden="true">
                    {link.count}
                  </span>
                ) : null}
              </Link>
            ))}

            <div className="workspace-inbox-link">
              <DropDestination destination={{ projectId: null, name: "Inbox" }}>
                {(drop) => (
                  <button
                    type="button"
                    className="workspace-nav__link workspace-nav__link--button"
                    aria-label={
                      inboxUnavailable
                        ? "Open Inbox tray, Inbox unavailable"
                        : `Open Inbox tray, ${inboxCountLabel} task${inboxCount === 1 ? "" : "s"}`
                    }
                    data-current={pathname === "/inbox" || undefined}
                    onClick={openInbox}
                    {...drop}
                  >
                    <Icon name="inbox" />
                    <span>Inbox</span>
                    <span className="workspace-nav__count" aria-hidden="true">
                      {inbox.isPending ? "·" : inboxCountLabel}
                    </span>
                  </button>
                )}
              </DropDestination>
              <Link
                className="workspace-inbox-link__full"
                href="/inbox"
                aria-label="Open full Inbox"
                title="Open full Inbox"
              >
                <Icon name="arrow-up-right" />
              </Link>
            </div>

            <div className="workspace-nav__section">
              <ProjectSection
                projects={projectItems}
                pending={projects.isPending}
                error={projectsUnavailable}
                pathname={pathname}
                onRetry={() => void projects.refetch()}
                droppable
              />
              {dnd.error ? (
                <p className="workspace-drop-note" role="alert">
                  {dnd.error}
                </p>
              ) : null}
              <SavedViewNav pathname={pathname} reorderable />
            </div>

            <Link
              className="workspace-nav__link"
              href="/completed"
              aria-current={pathname === "/completed" ? "page" : undefined}
              data-current={historyCurrent || undefined}
            >
              <Icon name="history" />
              <span>History</span>
            </Link>

            <WipCounter current={pathname === "/settings/workspace"} />
          </nav>

          <div className="workspace-sidebar__utilities">
            <details
              className="workspace-settings"
              key={`settings-${pathname}`}
              open={pathname.startsWith("/settings") || pathname === "/projects"}
            >
              <summary>
                <Icon name="settings" />
                <span>Settings</span>
                <Icon name="chevron-up" />
              </summary>
              <div className="workspace-settings__links">
                <Link
                  className="workspace-nav__link workspace-nav__link--quiet"
                  href="/projects"
                  aria-current={pathname === "/projects" ? "page" : undefined}
                >
                  <Icon name="settings" />
                  <span>Manage projects</span>
                </Link>
                <Link
                  className="workspace-nav__link workspace-nav__link--quiet"
                  href="/settings/tags"
                  aria-current={pathname === "/settings/tags" ? "page" : undefined}
                >
                  <Icon name="tag" />
                  <span>Manage tags</span>
                </Link>
                <Link
                  className="workspace-nav__link workspace-nav__link--quiet"
                  href="/settings/data"
                  aria-current={pathname === "/settings/data" ? "page" : undefined}
                >
                  <Icon name="settings" />
                  <span>Export and import</span>
                </Link>
                <Link
                  className="workspace-nav__link workspace-nav__link--quiet"
                  href="/settings/workspace"
                  aria-current={pathname === "/settings/workspace" ? "page" : undefined}
                >
                  <Icon name="settings" />
                  <span>Workspace settings</span>
                </Link>
              </div>
            </details>

            <details className="workspace-account" key={`account-${pathname}`}>
              <summary>
                <UserMark user={user} />
                <span className="workspace-account__identity">
                  <strong>{user.name ?? "Your account"}</strong>
                  <span>{user.email}</span>
                </span>
                <Icon name="chevron-up" />
              </summary>
              <div className="workspace-account__menu">
                <button type="button" onClick={() => void signOut()}>
                  <Icon name="sign-out" />
                  Sign out
                </button>
              </div>
            </details>
          </div>
        </aside>

        <MobileHeader
          inboxCount={inboxCountLabel}
          inboxUnavailable={inboxUnavailable}
          planningLinks={[...planningLinks, notificationsLink]}
          pathname={pathname}
          projects={projectItems}
          projectsPending={projects.isPending}
          projectsError={projectsUnavailable}
          user={user}
          onCapture={openInbox}
          onSearch={openSearch}
          onProjectsRetry={() => void projects.refetch()}
          onSignOut={() => void signOut()}
        />

        <main id="main" className="app-shell__main">
          <div className="studio-workspace-meta">
            <span>Personal workspace</span>
            <span>A little progress, every day.</span>
          </div>
          {children}
        </main>

        <output className="ml-visually-hidden" aria-live="polite">
          {dnd.announcement}
        </output>

        <UndoToast />

        <DragOverlay>
          {dnd.active ? (
            <div className="board-card board-card--overlay">
              <span className="board-card__title">{dnd.active.title}</span>
              <span className="task-row__key">{dnd.active.key}</span>
            </div>
          ) : null}
        </DragOverlay>

        {searchOpen ? <SearchBox onDismiss={closeSearch} /> : null}

        {inboxOpen ? (
          <InboxTray
            tasks={inbox.data?.data ?? []}
            projects={projectItems}
            tasksPending={inbox.isPending}
            tasksError={inbox.isError ? inbox.error : null}
            projectsPending={projects.isPending}
            projectsError={projectsUnavailable}
            hasMore={inbox.data?.page.hasMore ?? false}
            onRetry={() => void inbox.refetch()}
            onDismiss={closeInbox}
          />
        ) : null}
      </div>
    </DndContext>
  );
}

function Brand() {
  return (
    <Link className="workspace-brand" href="/today" aria-label="MorrowList home">
      <span className="workspace-brand__mark" aria-hidden="true">
        <svg viewBox="0 0 32 32" fill="none">
          <path
            d="M16 25V15M16 19C7 19 5 13 7 7c7 0 10 5 9 12ZM16 16c0-7 4-11 10-11 2 7-1 13-10 14"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span>MorrowList</span>
    </Link>
  );
}

function ProjectLinks({
  projects,
  pending,
  error,
  pathname,
  onNavigate,
  onRetry,
  droppable,
}: {
  readonly projects: readonly ProjectDto[];
  readonly pending: boolean;
  readonly error: boolean;
  readonly pathname: string;
  readonly onNavigate?: (() => void) | undefined;
  readonly onRetry: () => void;
  /** Only the desktop sidebar accepts dropped tasks; the mobile menu never sees a drag. */
  readonly droppable?: boolean | undefined;
}) {
  if (pending) {
    return (
      <div className="workspace-projects__pending" aria-label="Loading projects">
        <span />
        <span />
      </div>
    );
  }

  if (error) {
    return (
      <div className="workspace-projects__error" role="status">
        <span>Projects unavailable</span>
        <button type="button" onClick={onRetry}>
          Retry
        </button>
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <Link
        className="workspace-projects__empty"
        href="/projects"
        {...(onNavigate ? { onClick: onNavigate } : {})}
      >
        Create your first project
      </Link>
    );
  }

  return (
    <ul className="workspace-projects">
      {projects.map((project) => {
        const href = `/projects/${project.id}/board`;
        const current = pathname === href;
        const link = (drop?: {
          readonly ref: (node: HTMLElement | null) => void;
          readonly "data-drop-target": true | undefined;
        }) => (
          <Link
            className="workspace-project-link"
            href={href}
            aria-current={current ? "page" : undefined}
            {...(onNavigate ? { onClick: onNavigate } : {})}
            {...drop}
          >
            <span className="workspace-project-link__mark" aria-hidden="true" />
            <span>{project.name}</span>
          </Link>
        );
        return (
          <li key={project.id}>
            {droppable ? (
              <DropDestination
                destination={{ projectId: project.id, name: project.name }}
              >
                {link}
              </DropDestination>
            ) : (
              link()
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ProjectSection({
  projects,
  pending,
  error,
  pathname,
  onNavigate,
  onRetry,
  droppable,
}: {
  readonly projects: readonly ProjectDto[];
  readonly pending: boolean;
  readonly error: boolean;
  readonly pathname: string;
  readonly onNavigate?: (() => void) | undefined;
  readonly onRetry: () => void;
  readonly droppable?: boolean | undefined;
}) {
  const router = useRouter();
  const createProject = useCreateProject();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const errorId = useId();

  useEffect(() => {
    if (!createOpen) return;
    const focusFrame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(focusFrame);
  }, [createOpen]);

  function openCreate() {
    createProject.reset();
    setCreateOpen(true);
  }

  function closeCreate() {
    if (createProject.isPending) return;
    createProject.reset();
    setCreateOpen(false);
    window.requestAnimationFrame(() => addButtonRef.current?.focus());
  }

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || createProject.isPending) return;

    try {
      const detail = await createProject.mutateAsync({ name: trimmed });
      setName("");
      setCreateOpen(false);
      onNavigate?.();
      router.push(`/projects/${detail.project.id}/board`);
    } catch {
      window.requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  return (
    <>
      <div className="workspace-projects__header">
        <span className="workspace-nav__label">Projects</span>
        <button
          ref={addButtonRef}
          type="button"
          className="workspace-projects__add"
          aria-label="Add project"
          aria-expanded={createOpen}
          aria-controls={`${inputId}-form`}
          disabled={createProject.isPending}
          onClick={() => (createOpen ? closeCreate() : openCreate())}
        >
          <Icon name={createOpen ? "close" : "plus"} />
        </button>
      </div>

      {createOpen ? (
        <form
          id={`${inputId}-form`}
          className="workspace-project-create"
          aria-label="Quick add project"
          aria-busy={createProject.isPending}
          onSubmit={(event) => void submitCreate(event)}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            closeCreate();
          }}
        >
          <label className="workspace-project-create__label" htmlFor={inputId}>
            Project name
          </label>
          <input
            ref={inputRef}
            id={inputId}
            className="workspace-project-create__input"
            value={name}
            maxLength={100}
            autoComplete="off"
            placeholder="Project name"
            aria-invalid={createProject.isError || undefined}
            aria-describedby={createProject.isError ? errorId : undefined}
            disabled={createProject.isPending}
            onChange={(event) => {
              setName(event.target.value);
              if (createProject.isError) createProject.reset();
            }}
          />
          <button
            type="submit"
            className="workspace-project-create__submit"
            aria-label="Create project"
            title="Create project"
            disabled={!name.trim() || createProject.isPending}
          >
            {createProject.isPending ? (
              <Spinner label="Creating project" />
            ) : (
              <Icon name="check" />
            )}
          </button>
          {createProject.isError ? (
            <span id={errorId} className="workspace-project-create__error" role="alert">
              {createProject.error instanceof Error
                ? createProject.error.message
                : "Project could not be created."}
            </span>
          ) : null}
        </form>
      ) : null}

      <ProjectLinks
        projects={projects}
        pending={pending}
        error={error}
        pathname={pathname}
        onNavigate={onNavigate}
        onRetry={onRetry}
        droppable={droppable}
      />
    </>
  );
}

interface Destination {
  /** Null is the Inbox. */
  readonly projectId: string | null;
  readonly name: string;
}

/** Registers one sidebar destination with the workspace DndContext. */
function DropDestination({
  destination,
  children,
}: {
  readonly destination: Destination;
  readonly children: (props: {
    readonly ref: (node: HTMLElement | null) => void;
    readonly "data-drop-target": true | undefined;
  }) => ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: destinationDroppableId(destination.projectId),
    data: { type: "destination", ...destination } satisfies DestinationDropData,
  });
  return <>{children({ ref: setNodeRef, "data-drop-target": isOver || undefined })}</>;
}

/**
 * The one drag-and-drop session for the workspace. Cards and rows are dragged the same
 * way wherever they are grabbed; the board decides what a drop on a column means, and
 * this decides what a drop on a sidebar destination means.
 */
function useWorkspaceDragAndDrop() {
  const move = useMoveTaskToProject();
  const [active, setActive] = useState<TaskDto | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const suppressClick = useRef(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // A pointer drag that starts on a title link and is released in place still ends with
  // a click on that link. dnd-kit keeps the click from React, which would leave the
  // browser's own navigation; the click after a drag is swallowed here instead.
  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (!suppressClick.current) return;
      suppressClick.current = false;
      event.preventDefault();
    }
    function onPointerDown() {
      suppressClick.current = false;
    }
    document.addEventListener("click", onClick, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, []);

  function onDragStart(event: DragStartEvent) {
    setActive(readDraggedTask(event.active));
  }

  function onDragCancel() {
    setActive(null);
    suppressClick.current = true;
  }

  function onDragEnd(event: DragEndEvent) {
    setActive(null);
    suppressClick.current = true;
    const task = readDraggedTask(event.active);
    const destination = readDestination(event.over);
    if (!task || !destination || task.projectId === destination.projectId) return;
    move.mutate(
      { task, projectId: destination.projectId },
      {
        onSuccess: () => setAnnouncement(`Moved ${task.title} to ${destination.name}.`),
        onError: () =>
          setAnnouncement(`Could not move ${task.title}. It stayed where it was.`),
      },
    );
  }

  return {
    sensors,
    active,
    onDragStart,
    onDragCancel,
    onDragEnd,
    announcement,
    error: move.isError ? "The task could not be moved. It stayed where it was." : null,
  };
}

interface PlanningLink {
  readonly href: string;
  readonly label: string;
  readonly icon: IconName;
  readonly count: string;
}

function MobileHeader({
  inboxCount,
  inboxUnavailable,
  planningLinks,
  pathname,
  projects,
  projectsPending,
  projectsError,
  user,
  onCapture,
  onSearch,
  onProjectsRetry,
  onSignOut,
}: {
  readonly inboxCount: string;
  readonly inboxUnavailable: boolean;
  readonly planningLinks: readonly PlanningLink[];
  readonly pathname: string;
  readonly projects: readonly ProjectDto[];
  readonly projectsPending: boolean;
  readonly projectsError: boolean;
  readonly user: WorkspaceUser;
  readonly onCapture: () => void;
  readonly onSearch: () => void;
  readonly onProjectsRetry: () => void;
  readonly onSignOut: () => void;
}) {
  const menuRef = useRef<HTMLDetailsElement>(null);

  function closeMenu() {
    menuRef.current?.removeAttribute("open");
  }

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      const menu = menuRef.current;
      if (menu?.open && !menu.contains(event.target as Node)) closeMenu();
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, []);

  return (
    <header className="workspace-mobile-header">
      <Brand />
      <button
        type="button"
        className="workspace-mobile-header__capture"
        aria-label="Search tasks and projects"
        onClick={onSearch}
      >
        <Icon name="search" />
      </button>
      <button
        type="button"
        className="workspace-mobile-header__capture"
        aria-label="Capture a new Inbox task"
        onClick={onCapture}
      >
        <Icon name="plus" />
      </button>
      <details
        ref={menuRef}
        className="workspace-mobile-menu"
        key={`mobile-${pathname}`}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          closeMenu();
          menuRef.current?.querySelector("summary")?.focus();
        }}
      >
        <summary aria-label="Open workspace navigation">
          <Icon name="menu" />
        </summary>
        <div className="workspace-mobile-menu__panel">
          <div className="workspace-mobile-menu__topline">
            <span>Workspace</span>
            <UserMark user={user} />
          </div>
          <button
            type="button"
            className="workspace-mobile-inbox"
            aria-label={
              inboxUnavailable
                ? "Open Inbox tray, Inbox unavailable"
                : `Open Inbox tray, ${inboxCount} open tasks`
            }
            onClick={() => {
              const menuTrigger =
                menuRef.current?.querySelector<HTMLElement>("summary");
              closeMenu();
              menuTrigger?.focus();
              onCapture();
            }}
          >
            <Icon name="inbox" />
            <span>Inbox</span>
            <span>{inboxCount}</span>
          </button>
          <Link
            className="workspace-mobile-full-inbox"
            href="/inbox"
            onClick={closeMenu}
          >
            Open full Inbox
          </Link>
          <nav aria-label="Mobile workspace">
            {planningLinks.map((link) => (
              <Link
                key={link.href}
                className="workspace-nav__link"
                href={link.href}
                aria-current={pathname === link.href ? "page" : undefined}
                onClick={closeMenu}
              >
                <Icon name={link.icon} />
                <span>{link.label}</span>
                {link.count ? (
                  <span className="workspace-nav__count" aria-hidden="true">
                    {link.count}
                  </span>
                ) : null}
              </Link>
            ))}
            <ProjectSection
              projects={projects}
              pending={projectsPending}
              error={projectsError}
              pathname={pathname}
              onNavigate={closeMenu}
              onRetry={onProjectsRetry}
            />
            <SavedViewNav pathname={pathname} onNavigate={closeMenu} />
            <Link
              className="workspace-nav__link"
              href="/completed"
              aria-current={pathname === "/completed" ? "page" : undefined}
              data-current={
                pathname === "/completed" || pathname === "/trash" || undefined
              }
              onClick={closeMenu}
            >
              <Icon name="history" />
              History
            </Link>
            <WipCounter
              current={pathname === "/settings/workspace"}
              onNavigate={closeMenu}
            />
            <Link
              className="workspace-nav__link workspace-nav__link--quiet"
              href="/projects"
              aria-current={pathname === "/projects" ? "page" : undefined}
              onClick={closeMenu}
            >
              <Icon name="settings" />
              Manage projects
            </Link>
            <Link
              className="workspace-nav__link workspace-nav__link--quiet"
              href="/settings/tags"
              aria-current={pathname === "/settings/tags" ? "page" : undefined}
              onClick={closeMenu}
            >
              <Icon name="tag" />
              Manage tags
            </Link>
            <Link
              className="workspace-nav__link workspace-nav__link--quiet"
              href="/settings/data"
              aria-current={pathname === "/settings/data" ? "page" : undefined}
              onClick={closeMenu}
            >
              <Icon name="settings" />
              Export and import
            </Link>
          </nav>
          <button
            type="button"
            className="workspace-mobile-signout"
            onClick={onSignOut}
          >
            <Icon name="sign-out" />
            Sign out
          </button>
        </div>
      </details>
    </header>
  );
}

function InboxTray({
  tasks,
  projects,
  tasksPending,
  tasksError,
  projectsPending,
  projectsError,
  hasMore,
  onRetry,
  onDismiss,
}: {
  readonly tasks: readonly TaskDto[];
  readonly projects: readonly ProjectDto[];
  readonly tasksPending: boolean;
  readonly tasksError: Error | null;
  readonly projectsPending: boolean;
  readonly projectsError: boolean;
  readonly hasMore: boolean;
  readonly onRetry: () => void;
  readonly onDismiss: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const assign = useMoveTaskToProject();
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog?.open) dialog?.showModal();
    const focusFrame = window.requestAnimationFrame(() => {
      dialog
        ?.querySelector<HTMLInputElement>('form[aria-label="Quick add"] input')
        ?.focus();
    });
    return () => {
      window.cancelAnimationFrame(focusFrame);
      if (dialog?.open) dialog.close();
    };
  }, []);

  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );

  function focusAfterAssignment(previousIndex: number) {
    window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const remaining = Array.from(
        dialog.querySelectorAll<HTMLSelectElement>(
          "select[data-inbox-assignment]:not(:disabled)",
        ),
      );
      const next = remaining[Math.min(previousIndex, remaining.length - 1)];
      const capture = dialog.querySelector<HTMLInputElement>(
        'form[aria-label="Quick add"] input',
      );
      (next ?? capture ?? dialog.querySelector<HTMLElement>("button"))?.focus();
    });
  }

  return (
    <dialog
      ref={dialogRef}
      className="inbox-tray"
      aria-labelledby="inbox-tray-title"
      onCancel={(event) => {
        event.preventDefault();
        onDismiss();
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onDismiss();
      }}
    >
      <div className="inbox-tray__surface">
        <header className="inbox-tray__header">
          <div>
            <p className="inbox-tray__eyebrow">Capture</p>
            <h2 id="inbox-tray-title">Inbox</h2>
            <p>Catch it now. Decide where it belongs when you are ready.</p>
          </div>
          <button
            type="button"
            className="inbox-tray__close"
            aria-label="Close Inbox"
            onClick={onDismiss}
          >
            <Icon name="close" />
          </button>
        </header>

        <div className="inbox-tray__capture">
          <QuickAdd autoFocus />
        </div>

        <div className="inbox-tray__section-header">
          <div>
            <h3>Ready to sort</h3>
            <span>
              {tasks.length}
              {hasMore ? "+" : ""} open
            </span>
          </div>
          <Link href="/inbox" onClick={onDismiss}>
            Open full Inbox
          </Link>
        </div>

        <div className="inbox-tray__content">
          {tasksPending ? (
            <div className="inbox-tray__state">
              <Spinner label="Loading Inbox" />
            </div>
          ) : tasksError ? (
            <Alert tone="error" title="Inbox could not be loaded">
              <p>{tasksError.message}</p>
              <Button onClick={onRetry}>Try again</Button>
            </Alert>
          ) : tasks.length === 0 ? (
            <div className="inbox-tray__empty">
              <span className="inbox-tray__empty-mark" aria-hidden="true">
                <Icon name="check" />
              </span>
              <h3>Nothing waiting</h3>
              <p>Your Inbox is clear. New thoughts will land right here.</p>
            </div>
          ) : (
            <ul className="inbox-tray__tasks" aria-label="Inbox tray tasks">
              {tasks.map((task, taskIndex) => {
                const assigning =
                  assign.isPending && assign.variables?.task.id === task.id;
                return (
                  <li
                    key={task.id}
                    className="inbox-tray-task"
                    data-busy={assigning || undefined}
                  >
                    <div className="inbox-tray-task__body">
                      <Link
                        href={`/inbox?task=${encodeURIComponent(task.key)}`}
                        onClick={onDismiss}
                      >
                        {task.title}
                      </Link>
                      <span>
                        <span>{task.key}</span>
                        {task.priority !== "none" ? (
                          <span>{sentenceCase(task.priority)}</span>
                        ) : null}
                        {task.dueDate ? <span>Due {task.dueDate}</span> : null}
                      </span>
                    </div>
                    <label>
                      <span className="ml-visually-hidden">
                        Send {task.title} to project
                      </span>
                      <select
                        className="inbox-tray-task__project"
                        data-inbox-assignment
                        value=""
                        disabled={assigning || projectsPending || projects.length === 0}
                        onChange={(event) => {
                          const projectId = event.target.value;
                          if (!projectId) return;
                          const projectName = projectById.get(projectId) ?? "project";
                          assign.mutate(
                            { task, projectId },
                            {
                              onSuccess: () => {
                                setAnnouncement(
                                  `Sent ${task.title} to ${projectName}.`,
                                );
                                focusAfterAssignment(taskIndex);
                              },
                            },
                          );
                        }}
                      >
                        <option value="">
                          {assigning ? "Sending…" : "Send to project…"}
                        </option>
                        {projects.map((project) => (
                          <option key={project.id} value={project.id}>
                            {project.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {projectsError ? (
          <p className="inbox-tray__project-note">
            Projects are unavailable right now. Capture still works; try sorting later.
          </p>
        ) : !projectsPending && projects.length === 0 && tasks.length > 0 ? (
          <p className="inbox-tray__project-note">
            <Link href="/projects" onClick={onDismiss}>
              Create a project
            </Link>{" "}
            before sorting these tasks into a flow.
          </p>
        ) : null}

        {assign.isError ? (
          <Alert tone="error">
            The task could not be sent. It is still in your Inbox.
          </Alert>
        ) : null}
        <output className="ml-visually-hidden" aria-live="polite">
          {announcement}
        </output>
      </div>
    </dialog>
  );
}

function UserMark({ user }: { readonly user: WorkspaceUser }) {
  const label = user.name ?? user.email;
  return (
    <span className="workspace-user-mark" aria-hidden="true">
      {label.trim().slice(0, 1).toUpperCase()}
    </span>
  );
}

function sentenceCase(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1).replaceAll("_", " ")}`;
}

type IconName =
  | "arrow-up-right"
  | "bell"
  | "calendar"
  | "check"
  | "chevron-up"
  | "close"
  | "history"
  | "inbox"
  | "keyboard"
  | "menu"
  | "plus"
  | "search"
  | "settings"
  | "sign-out"
  | "sun"
  | "tag";

function Icon({
  name,
  ...props
}: SVGProps<SVGSVGElement> & { readonly name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    "arrow-up-right": <path d="M7 17 17 7M8 7h9v9" />,
    bell: (
      <>
        <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16Z" />
        <path d="M10 20a2 2 0 0 0 4 0" />
      </>
    ),
    calendar: (
      <>
        <rect x="4" y="5" width="16" height="15" rx="2" />
        <path d="M4 10h16M8 3v4M16 3v4" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    "chevron-up": <path d="m6 15 6-6 6 6" />,
    close: <path d="M6 6l12 12M18 6 6 18" />,
    history: (
      <>
        <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
        <path d="M3 3v5h5M12 7v5l3 2" />
      </>
    ),
    inbox: (
      <>
        <path d="M4 5h16v14H4z" />
        <path d="M4 14h4l2 2h4l2-2h4" />
      </>
    ),
    keyboard: (
      <>
        <rect x="3" y="6" width="18" height="12" rx="2" />
        <path d="M7 10h.01M11 10h.01M15 10h.01M17 10h.01M8 14h8" />
      </>
    ),
    menu: <path d="M4 7h16M4 12h16M4 17h16" />,
    plus: <path d="M12 5v14M5 12h14" />,
    search: (
      <>
        <circle cx="11" cy="11" r="6" />
        <path d="m20 20-4.2-4.2" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
      </>
    ),
    "sign-out": <path d="M10 5H5v14h5M14 8l4 4-4 4M8 12h10" />,
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
      </>
    ),
    tag: (
      <>
        <path d="M3 12V4h8l9 9-8 8-9-9Z" />
        <circle cx="7.5" cy="8.5" r="1" />
      </>
    ),
  };

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
