/**
 * Metrics port (spec 27.2). The MVP ships a no-op recorder plus an in-memory one for
 * tests; a real exporter is an adapter and is not required to run the product.
 */

export interface MetricLabels {
  readonly [label: string]: string | number;
}

export interface Metrics {
  increment(name: string, labels?: MetricLabels, value?: number): void;
  observe(name: string, milliseconds: number, labels?: MetricLabels): void;
}

export const noopMetrics: Metrics = {
  increment: () => {},
  observe: () => {},
};

export interface RecordedMetric {
  readonly name: string;
  readonly value: number;
  readonly labels: MetricLabels;
}

export interface InMemoryMetrics extends Metrics {
  readonly counters: RecordedMetric[];
  readonly observations: RecordedMetric[];
  reset(): void;
}

export function createInMemoryMetrics(): InMemoryMetrics {
  const counters: RecordedMetric[] = [];
  const observations: RecordedMetric[] = [];

  return {
    counters,
    observations,
    increment: (name, labels = {}, value = 1) => {
      counters.push({ name, value, labels });
    },
    observe: (name, milliseconds, labels = {}) => {
      observations.push({ name, value: milliseconds, labels });
    },
    reset: () => {
      counters.length = 0;
      observations.length = 0;
    },
  };
}
