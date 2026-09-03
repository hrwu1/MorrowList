"use client";

import { Alert, Button, EmptyState, Spinner, TextInput } from "@morrowlist/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import {
  useCreateProject,
  useProjects,
  useRestoreProject,
} from "../hooks/use-projects";

export function ProjectListPage() {
  const router = useRouter();
  const projects = useProjects({ includeArchived: true });
  const createProject = useCreateProject();
  const restoreProject = useRestoreProject();
  const [name, setName] = useState("");
  const active =
    projects.data?.data.filter((project) => project.archivedAt === null) ?? [];
  const archived =
    projects.data?.data.filter((project) => project.archivedAt !== null) ?? [];

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    try {
      const detail = await createProject.mutateAsync({ name: trimmed });
      router.push(`/projects/${detail.project.id}/board`);
    } catch {
      // The mutation error stays visible below and the name remains available to retry.
    }
  }

  return (
    <div className="projects-page stack">
      <header className="page-header">
        <h1>Projects</h1>
        <p className="page-header__subtitle">
          Give work a shared finish line, then move it forward one clear step at a time.
        </p>
      </header>

      <form
        className="project-create"
        aria-label="Create a project"
        onSubmit={onSubmit}
      >
        <label className="ml-field__label" htmlFor="project-name">
          Project name
        </label>
        <div className="project-create__row">
          <TextInput
            id="project-name"
            value={name}
            maxLength={100}
            autoComplete="off"
            placeholder="For example, Research launch"
            onChange={(event) => setName(event.target.value)}
          />
          <Button
            type="submit"
            variant="primary"
            loading={createProject.isPending}
            disabled={!name.trim()}
          >
            Create project
          </Button>
        </div>
      </form>

      {createProject.isError ? (
        <Alert tone="error" title="The project could not be created">
          {createProject.error instanceof Error
            ? createProject.error.message
            : "Something went wrong."}
        </Alert>
      ) : null}

      {projects.isPending ? (
        <div className="task-list__status">
          <Spinner label="Loading projects" />
        </div>
      ) : projects.isError ? (
        <Alert tone="error" title="Projects could not be loaded">
          <p>
            {projects.error instanceof Error
              ? projects.error.message
              : "Something went wrong."}
          </p>
          <Button onClick={() => void projects.refetch()}>Try again</Button>
        </Alert>
      ) : active.length === 0 ? (
        <EmptyState
          title="Start with one meaningful project"
          description="Name it above. MorrowList will give it a calm six-stage workflow that you can use immediately."
        />
      ) : (
        <ul className="project-list" aria-label="Projects">
          {active.map((project) => (
            <li key={project.id} className="project-list__item">
              <Link
                className="project-list__link"
                href={`/projects/${project.id}/board`}
              >
                <span className="project-list__mark" aria-hidden="true" />
                <span>
                  <strong>{project.name}</strong>
                  <span className="project-list__hint">Open board</span>
                </span>
                <span aria-hidden="true">→</span>
              </Link>
              <Link
                className="ml-button ml-button--ghost"
                href={`/projects/${project.id}/settings`}
                aria-label={`Settings for ${project.name}`}
              >
                Settings
              </Link>
            </li>
          ))}
        </ul>
      )}

      {archived.length > 0 ? (
        <section aria-labelledby="archived-projects-heading" className="stack-tight">
          <h2 id="archived-projects-heading" className="section-heading">
            Archived projects
          </h2>
          {restoreProject.isError ? (
            <Alert tone="error" title="The project could not be restored">
              {restoreProject.error instanceof Error
                ? restoreProject.error.message
                : "Something went wrong."}
            </Alert>
          ) : null}
          <ul className="project-list" aria-label="Archived projects">
            {archived.map((project) => (
              <li key={project.id} className="project-list__item">
                <span className="project-list__link project-list__link--archived">
                  <span className="project-list__mark" aria-hidden="true" />
                  <span>
                    <strong>{project.name}</strong>
                    <span className="project-list__hint">Archived, tasks kept</span>
                  </span>
                </span>
                <Button
                  aria-label={`Restore ${project.name}`}
                  loading={
                    restoreProject.isPending && restoreProject.variables === project.id
                  }
                  onClick={() => restoreProject.mutate(project.id)}
                >
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
