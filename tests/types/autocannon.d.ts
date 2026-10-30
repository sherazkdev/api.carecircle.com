declare module 'autocannon' {
  import type { EventEmitter } from 'node:events';

  export type AutocannonResult = {
    requests: { total: number; average: number };
    latency: { average: number; p95: number; p99: number };
    non2xx: number;
    timeouts: number;
    errors: number;
  };

  export type AutocannonOptions = {
    url: string;
    connections?: number;
    duration?: number;
    headers?: Record<string, string>;
  };

  function autocannon(
    opts: AutocannonOptions,
    callback: (err: Error | null, result: AutocannonResult) => void,
  ): EventEmitter;

  namespace autocannon {
    function track(instance: EventEmitter, opts?: { renderProgressBar?: boolean }): void;
  }

  export default autocannon;
}
