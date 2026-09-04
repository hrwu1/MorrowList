"use client";

import type { FlowRange, FlowSummaryDto } from "@morrowlist/contracts";
import { Alert, Button, Select, Spinner } from "@morrowlist/ui";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { useProjectFlow } from "../hooks/use-flow";
import {
  AGING_CATEGORIES,
  CATEGORY_LABELS,
  CFD_ORDER,
  FLOW_RANGE_LABELS,
  agingChart,
  cumulativeFlowAreas,
  formatDays,
  readFlowRange,
  throughputBars,
} from "../lib/flow-view";

import { useProjects } from "@/features/projects/hooks/use-projects";

/**
 * The project Flow view (GAP-17): the four mandatory Kanban measures and the two charts
 * that explain them, all from the status intervals the board records. Charts are inline
 * SVG on one scale each, coloured by the same status tokens as the board columns, and
 * every chart has a text equivalent so nothing depends on colour or sight alone.
 */

const CHART = { width: 640, height: 180 } as const;

export function FlowPage({ projectId }: { readonly projectId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const range = readFlowRange(new URLSearchParams(searchParams.toString()));
  const flow = useProjectFlow(projectId, range);
  const projects = useProjects();
  const project = projects.data?.data.find((candidate) => candidate.id === projectId);

  function changeRange(next: FlowRange) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "90") params.delete("range");
    else params.set("range", next);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  if (flow.isPending) {
    return (
      <div className="flow-page flow-page__status">
        <Spinner label="Loading flow metrics" />
      </div>
    );
  }

  if (flow.isError) {
    return (
      <div className="flow-page">
        <Alert tone="error" title="Flow metrics could not be loaded">
          <p>
            {flow.error instanceof Error ? flow.error.message : "Something went wrong."}
          </p>
          <Button onClick={() => void flow.refetch()}>Try again</Button>
        </Alert>
      </div>
    );
  }

  const summary = flow.data;

  return (
    <div className="flow-page stack">
      <header className="board-page__header">
        <div>
          <p className="board-page__eyebrow">
            <Link href={`/projects/${projectId}/board`}>
              {project?.name ?? "Project"} board
            </Link>
          </p>
          <h1>Flow</h1>
          <p className="board-page__summary">
            {summary.from} to {summary.to}, {summary.timezone}. Cycle time counts from
            the first started column to Done; lead time from the first column.
          </p>
        </div>
        <label className="filters__control">
          <span className="ml-field__label">Range</span>
          <Select
            value={range}
            aria-label="Range"
            onChange={(event) => changeRange(event.target.value as FlowRange)}
          >
            {(Object.keys(FLOW_RANGE_LABELS) as FlowRange[]).map((value) => (
              <option key={value} value={value}>
                {FLOW_RANGE_LABELS[value]}
              </option>
            ))}
          </Select>
        </label>
      </header>

      <section aria-label="Flow summary">
        <dl className="flow-stats">
          <Stat
            label="Work in progress"
            value={String(summary.wip)}
            hint="started, not done"
          />
          <Stat
            label="Completed"
            value={String(summary.completed)}
            hint={FLOW_RANGE_LABELS[range].toLowerCase()}
          />
          <Stat
            label="Cycle time, 85th percentile"
            value={formatDays(summary.cycleTimeDays.p85)}
            hint={`50th ${formatDays(summary.cycleTimeDays.p50)} · 95th ${formatDays(summary.cycleTimeDays.p95)} · ${summary.cycleTimeDays.samples} started ${summary.cycleTimeDays.samples === 1 ? "task" : "tasks"}`}
          />
          <Stat
            label="Lead time, 85th percentile"
            value={formatDays(summary.leadTimeDays.p85)}
            hint={`50th ${formatDays(summary.leadTimeDays.p50)} · 95th ${formatDays(summary.leadTimeDays.p95)} · ${summary.leadTimeDays.samples} ${summary.leadTimeDays.samples === 1 ? "task" : "tasks"}`}
          />
        </dl>
      </section>

      <ThroughputChart summary={summary} />
      <CumulativeFlowChart summary={summary} />
      <AgingChart summary={summary} />
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  readonly label: string;
  readonly value: string;
  readonly hint: string;
}) {
  return (
    <div className="flow-stat">
      <dt>{label}</dt>
      <dd>
        <strong>{value}</strong>
        <span>{hint}</span>
      </dd>
    </div>
  );
}

function ThroughputChart({ summary }: { readonly summary: FlowSummaryDto }) {
  const bars = throughputBars(summary.throughput, CHART);
  const total = summary.throughput.reduce((sum, week) => sum + week.count, 0);
  return (
    <section className="flow-chart" aria-labelledby="flow-throughput">
      <h2 id="flow-throughput">Throughput</h2>
      <p className="task-detail__hint">
        Tasks completed per week, Monday to Sunday. {total} in total.
      </p>
      {total === 0 ? (
        <p className="flow-chart__empty">Nothing completed in this range yet.</p>
      ) : (
        <svg
          className="flow-chart__svg"
          viewBox={`0 0 ${CHART.width} ${CHART.height + 24}`}
          role="img"
          aria-label={`Throughput by week: ${summary.throughput.map((week) => `${week.weekStart}: ${week.count}`).join(", ")}`}
        >
          {bars.map((bar) => (
            <g key={bar.weekStart}>
              <rect
                className="flow-bar"
                x={bar.x}
                y={bar.y}
                width={bar.width}
                height={bar.height}
              >
                <title>{`Week of ${bar.weekStart}: ${bar.count} completed`}</title>
              </rect>
              {bar.count > 0 ? (
                <text
                  className="flow-chart__value"
                  x={bar.x + bar.width / 2}
                  y={bar.y - 4}
                  textAnchor="middle"
                >
                  {bar.count}
                </text>
              ) : null}
            </g>
          ))}
          <text className="flow-chart__axis" x={0} y={CHART.height + 16}>
            {summary.throughput[0]?.weekStart}
          </text>
          <text
            className="flow-chart__axis"
            x={CHART.width}
            y={CHART.height + 16}
            textAnchor="end"
          >
            {summary.throughput.at(-1)?.weekStart}
          </text>
        </svg>
      )}
    </section>
  );
}

function CumulativeFlowChart({ summary }: { readonly summary: FlowSummaryDto }) {
  const areas = cumulativeFlowAreas(summary.cumulativeFlow, CHART);
  const last = summary.cumulativeFlow.at(-1);
  const present = CFD_ORDER.filter((category) =>
    summary.cumulativeFlow.some((day) => (day.counts[category] ?? 0) > 0),
  );
  return (
    <section className="flow-chart" aria-labelledby="flow-cfd">
      <h2 id="flow-cfd">Cumulative flow</h2>
      <p className="task-detail__hint">
        How many tasks ended each day in each column. A band that keeps widening is
        where work is piling up.
      </p>
      {present.length === 0 ? (
        <p className="flow-chart__empty">No tasks were on the board in this range.</p>
      ) : (
        <>
          <svg
            className="flow-chart__svg"
            viewBox={`0 0 ${CHART.width} ${CHART.height + 24}`}
            role="img"
            aria-label={`Cumulative flow ending ${last?.date ?? ""}: ${present.map((category) => `${CATEGORY_LABELS[category]} ${last?.counts[category] ?? 0}`).join(", ")}`}
          >
            {areas.map((area) => (
              <path
                key={area.category}
                className="flow-area"
                data-category={area.category}
                d={area.path}
              >
                <title>{CATEGORY_LABELS[area.category]}</title>
              </path>
            ))}
            <text className="flow-chart__axis" x={0} y={CHART.height + 16}>
              {summary.cumulativeFlow[0]?.date}
            </text>
            <text
              className="flow-chart__axis"
              x={CHART.width}
              y={CHART.height + 16}
              textAnchor="end"
            >
              {last?.date}
            </text>
          </svg>
          <ul className="flow-legend" aria-label="Columns on the last day">
            {[...present].reverse().map((category) => (
              <li key={category} data-category={category}>
                <span className="flow-legend__swatch" aria-hidden="true" />
                {CATEGORY_LABELS[category]}: {last?.counts[category] ?? 0}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function AgingChart({ summary }: { readonly summary: FlowSummaryDto }) {
  const chart = agingChart(summary.aging, summary.cycleTimeDays, CHART);
  return (
    <section className="flow-chart" aria-labelledby="flow-aging">
      <h2 id="flow-aging">Aging work in progress</h2>
      <p className="task-detail__hint">
        Every started task by how long ago it started, against the cycle time
        percentiles of finished work. Anything above the 85th line is later than usual.
      </p>
      {summary.aging.length === 0 ? (
        <p className="flow-chart__empty">Nothing is in progress right now.</p>
      ) : (
        <>
          <svg
            className="flow-chart__svg"
            viewBox={`0 0 ${CHART.width} ${CHART.height + 24}`}
            role="img"
            aria-label={`Aging work in progress: ${summary.aging.map((item) => `${item.key} ${formatDays(item.ageDays)}`).join(", ")}`}
          >
            {chart.lines.map((line) => (
              <g key={line.label}>
                <line
                  className="flow-reference"
                  x1={0}
                  x2={CHART.width}
                  y1={line.y}
                  y2={line.y}
                />
                <text
                  className="flow-chart__axis"
                  x={CHART.width}
                  y={line.y - 3}
                  textAnchor="end"
                >
                  {line.label} · {formatDays(line.days)}
                </text>
              </g>
            ))}
            {chart.columns.map((column) => (
              <text
                key={column.category}
                className="flow-chart__axis"
                x={column.x}
                y={CHART.height + 16}
                textAnchor="middle"
              >
                {CATEGORY_LABELS[column.category]}
              </text>
            ))}
            {chart.dots.map((dot) => (
              <circle
                key={dot.item.taskId}
                className="flow-dot"
                data-band={dot.item.band ?? undefined}
                cx={dot.cx}
                cy={dot.cy}
                r={6}
              >
                <title>{`${dot.item.key} ${dot.item.title}: ${formatDays(dot.item.ageDays)} in ${dot.item.statusName}`}</title>
              </circle>
            ))}
          </svg>
          <ol className="flow-aging" aria-label="Aging tasks, oldest first">
            {summary.aging.map((item) => (
              <li key={item.taskId} data-band={item.band ?? undefined}>
                <Link href={`/tasks/${item.key}`}>{item.key}</Link>
                <span className="flow-aging__title">{item.title}</span>
                <span className="flow-aging__age">
                  {formatDays(item.ageDays)} · {item.statusName}
                  {item.band === "over_p85" || item.band === "over_p95"
                    ? ` · past the ${item.band === "over_p95" ? "95th" : "85th"} percentile`
                    : ""}
                </span>
              </li>
            ))}
          </ol>
          <p className="ml-visually-hidden">
            Lanes:{" "}
            {AGING_CATEGORIES.map((category) => CATEGORY_LABELS[category]).join(", ")}.
          </p>
        </>
      )}
    </section>
  );
}
