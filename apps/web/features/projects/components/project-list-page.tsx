"use client";

import { Alert, Button, EmptyState, Spinner, TextInput } from "@morrowlist/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { useCreateProject, useProjects } from "../hooks/use-projects";

export function ProjectListPage() {
  const router = useRouter();
  const projects = useProjects();
  const createProject = useCreateProject();
  const [name, setName] = useState("");

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
      ) : projects.data.data.length === 0 ? (
        <EmptyState
          title="Start with one meaningful project"
          description="Name it above. MorrowList will give it a calm six-stage workflow that you can use immediately."
        />
      ) : (
        <ul className="project-list" aria-label="Projects">
          {projects.data.data.map((project) => (
            <li key={project.id}>
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
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
