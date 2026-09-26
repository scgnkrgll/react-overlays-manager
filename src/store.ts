import type { LayerConfig, OverlayState } from "./types.ts";

/** `queued` is internal: queued overlays are not rendered. */
type RecordState = OverlayState | { readonly phase: "queued" };

export interface Callbacks {
  onSubmit?: ((value: never, context: { signal: AbortSignal }) => unknown) | undefined;
  onDismiss?: (() => void) | undefined;
  abortable?: boolean | undefined;
}

export interface OpenRequest<H, C> {
  layer: string;
  handle: H;
  component: C;
  exitTransition: boolean;
  props: unknown;
  callbacks: Callbacks;
}

export interface Control {
  readonly state: OverlayState;
  readonly submit: (value?: unknown) => void;
  readonly dismiss: () => void;
  readonly exited: () => void;
}

/** Position of an overlay in a stack layer. */
export interface StackData {
  readonly index: number;
  readonly count: number;
  readonly expanded: boolean;
  readonly paused: boolean;
  readonly offset: number;
}

export interface GroupData {
  readonly expanded: boolean;
  readonly count: number;
  readonly frontHeight: number;
}

/** Immutable view of a rendered overlay. Replaced only when that overlay changes. */
export interface Entry<H, C> {
  readonly id: number;
  readonly handle: H;
  readonly component: C;
  readonly props: unknown;
  readonly control: Control;
  /** Null outside stack layers. */
  readonly stack: StackData | null;
}

export type Snapshot<H, C> = ReadonlyArray<{
  readonly layer: string;
  readonly entries: ReadonlyArray<Entry<H, C>>;
  /** Null outside stack layers. */
  readonly group: GroupData | null;
}>;

interface OverlayRecord<H, C> {
  readonly id: number;
  readonly request: OpenRequest<H, C>;
  props: unknown;
  state: RecordState;
  /** Incremented per submit, so a late settle of an older attempt is ignored. */
  attempt: number;
  controller: AbortController | null;
  fns: Omit<Control, "state">;
  control: Control | null;
  entry: Entry<H, C> | null;
  /** Measured height, for stack offsets. */
  height: number;
  /** Last computed stack position. A closing overlay keeps its index and offset while it animates out. */
  stack: StackData | null;
}

const isActive = (state: RecordState) =>
  state.phase === "idle" || state.phase === "pending" || state.phase === "failed";

const sameStack = (a: StackData | null, b: StackData | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.index === b.index &&
    a.count === b.count &&
    a.expanded === b.expanded &&
    a.paused === b.paused &&
    a.offset === b.offset);

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  typeof value === "object" && value !== null && typeof (value as PromiseLike<unknown>).then === "function";

/**
 * Framework-agnostic overlay state. Every transition goes through a method below
 * and follows the state table in the README. Events that don't apply are no-ops.
 */
export class OverlayStore<H, C> {
  private readonly layers: ReadonlyMap<string, LayerConfig>;
  private readonly records = new Map<number, OverlayRecord<H, C>>();
  private readonly listeners = new Set<() => void>();
  private nextId = 1;
  private snapshot: Snapshot<H, C>;
  /** Callbacks run after the transition is applied and listeners are notified. */
  private effects: Array<() => void> = [];
  private batchDepth = 0;
  private changed = false;
  private readonly expanded = new Map<string, boolean>();
  private pageHidden = false;

  constructor(layers: Record<string, LayerConfig>) {
    for (const [name, config] of Object.entries(layers)) {
      const { limit } = config;
      if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
        throw new Error(`Layer "${name}": limit must be a positive integer, got ${limit}.`);
      }
    }
    this.layers = new Map(Object.entries(layers));
    this.snapshot = this.buildSnapshot();
  }

  hasLayer(layer: string): boolean {
    return this.layers.has(layer);
  }

  layerConfig(layer: string): LayerConfig | undefined {
    return this.layers.get(layer);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): Snapshot<H, C> => this.snapshot;

  open(request: OpenRequest<H, C>): number {
    return this.batch(() => {
      const id = this.nextId++;
      const record: OverlayRecord<H, C> = {
        id,
        request,
        props: request.props,
        state: { phase: "queued" },
        attempt: 0,
        controller: null,
        fns: {
          submit: (value) => this.submit(id, value),
          dismiss: () => this.dismiss(id),
          exited: () => this.exited(id),
        },
        control: null,
        entry: null,
        height: 0,
        stack: null,
      };
      this.records.set(id, record);

      const { limit, overflow = "queue" } = this.layers.get(request.layer) ?? {};
      if (limit !== undefined && overflow === "dismiss-oldest") {
        const active = this.activeIn(request.layer);
        const oldest = active.length >= limit ? active.find((r) => r.state.phase !== "pending") : undefined;
        if (oldest) this.dismiss(oldest.id);
      }
      this.promote(request.layer);
      return id;
    });
  }

  update(id: number, props: unknown): void {
    const record = this.records.get(id);
    if (!record) return;
    this.batch(() => {
      record.props = props;
      this.touch(record);
    });
  }

  submit(id: number, value: unknown): void {
    const record = this.records.get(id);
    if (!record || (record.state.phase !== "idle" && record.state.phase !== "failed")) return;

    this.batch(() => {
      const { onSubmit, abortable = false } = record.request.callbacks;
      if (!onSubmit) {
        this.close(record);
        return;
      }

      const attempt = ++record.attempt;
      const controller = new AbortController();
      record.controller = controller;
      const context = { signal: controller.signal };

      let result: unknown;
      try {
        result = (onSubmit as (value: unknown, context: { signal: AbortSignal }) => unknown)(value, context);
      } catch (error) {
        this.setState(record, { phase: "failed", error });
        return;
      }

      if (!isThenable(result)) {
        this.close(record);
        return;
      }

      this.setState(record, { phase: "pending", abortable });
      const isCurrent = () =>
        this.records.get(id) === record && record.attempt === attempt && record.state.phase === "pending";
      result.then(
        () => {
          if (isCurrent()) this.batch(() => this.close(record));
        },
        (error: unknown) => {
          if (isCurrent()) this.batch(() => this.setState(record, { phase: "failed", error }));
        },
      );
    });
  }

  dismiss(id: number): void {
    const record = this.records.get(id);
    if (!record) return;
    const { state } = record;
    if (state.phase === "closing" || (state.phase === "pending" && !state.abortable)) return;

    this.batch(() => {
      const { onDismiss } = record.request.callbacks;
      if (onDismiss) this.effects.push(onDismiss);
      if (state.phase === "pending") record.controller?.abort();

      if (state.phase === "queued") this.remove(record);
      else this.close(record);
    });
  }

  exited(id: number): void {
    const record = this.records.get(id);
    if (!record || record.state.phase !== "closing") return;
    this.batch(() => this.remove(record));
  }

  dismissAll(layer?: string): void {
    this.batch(() => {
      const targets = [...this.records.values()].filter((r) => layer === undefined || r.request.layer === layer);
      // Queued first, so dismissing an active overlay doesn't promote one we're about to dismiss.
      const queued = targets.filter((r) => r.state.phase === "queued");
      const rest = targets.filter((r) => r.state.phase !== "queued");
      for (const record of [...queued, ...rest]) this.dismiss(record.id);
    });
  }

  setHeight(id: number, height: number): void {
    this.setHeights([[id, height]]);
  }

  /** Applies several measurements (e.g. one ResizeObserver callback) with a single notification. */
  setHeights(heights: Iterable<readonly [id: number, height: number]>): void {
    this.batch(() => {
      for (const [id, height] of heights) {
        const record = this.records.get(id);
        if (!record || record.height === height) continue;
        record.height = height;
        this.changed = true;
      }
    });
  }

  setExpanded(layer: string, expanded: boolean): void {
    if (!this.layers.get(layer)?.stack || (this.expanded.get(layer) ?? false) === expanded) return;
    this.batch(() => {
      this.expanded.set(layer, expanded);
      this.changed = true;
    });
  }

  setPageHidden(hidden: boolean): void {
    if (this.pageHidden === hidden) return;
    this.batch(() => {
      this.pageHidden = hidden;
      this.changed = true;
    });
  }

  private close(record: OverlayRecord<H, C>): void {
    record.controller = null;
    if (record.request.exitTransition) {
      this.setState(record, { phase: "closing" });
      // Closing overlays don't count toward the limit, so a queued one can enter while this one animates out.
      this.promote(record.request.layer);
    } else {
      this.remove(record); // promotes the layer itself
    }
  }

  private remove(record: OverlayRecord<H, C>): void {
    const { layer } = record.request;
    this.records.delete(record.id);
    this.changed = true;
    this.promote(layer);
    // The pointer-leave that would collapse an emptied group never fires once its content unmounts.
    if (![...this.records.values()].some((r) => r.request.layer === layer)) this.expanded.delete(layer);
  }

  private promote(layer: string): void {
    const { limit } = this.layers.get(layer) ?? {};
    let free = limit === undefined ? Infinity : limit - this.activeIn(layer).length;
    for (const record of this.records.values()) {
      if (free <= 0) break;
      if (record.request.layer === layer && record.state.phase === "queued") {
        this.setState(record, { phase: "idle" });
        free--;
      }
    }
  }

  private activeIn(layer: string): OverlayRecord<H, C>[] {
    return [...this.records.values()].filter((r) => r.request.layer === layer && isActive(r.state));
  }

  private setState(record: OverlayRecord<H, C>, state: RecordState): void {
    record.state = state;
    this.touch(record);
  }

  private touch(record: OverlayRecord<H, C>): void {
    record.entry = null;
    this.changed = true;
  }

  /** Groups nested transitions so listeners are notified once, then runs queued callbacks. */
  private batch<T>(fn: () => T): T {
    this.batchDepth++;
    let result: T;
    try {
      result = fn();
    } finally {
      this.batchDepth--;
    }
    if (this.batchDepth === 0) this.flush();
    return result;
  }

  private flush(): void {
    if (this.changed) {
      this.changed = false;
      this.snapshot = this.buildSnapshot();
      for (const listener of this.listeners) listener();
    }
    const effects = this.effects;
    this.effects = [];
    for (const effect of effects) {
      try {
        effect();
      } catch (error) {
        // A throwing caller callback must not break the store or skip other callbacks.
        queueMicrotask(() => {
          throw error;
        });
      }
    }
  }

  private buildSnapshot(): Snapshot<H, C> {
    return [...this.layers.entries()].map(([layer, config]) => {
      const records = [...this.records.values()].filter(
        (r) => r.request.layer === layer && r.state.phase !== "queued",
      );
      if (!config.stack) return { layer, entries: records.map((r) => this.entryOf(r, null)), group: null };

      const expanded = this.expanded.get(layer) ?? false;
      const paused = expanded || this.pageHidden;
      // Newest first: index 0 is the front of the pile.
      const active = records.filter((r) => isActive(r.state)).reverse();
      const count = active.length;
      let offset = 0;
      active.forEach((record, index) => {
        record.stack = { index, count, expanded, paused, offset };
        offset += record.height;
      });
      const entries = records.map((record) => {
        const last = record.stack ?? { index: 0, offset: 0 };
        // Closing overlays keep their last index and offset so they animate out in place.
        const stack = isActive(record.state)
          ? record.stack
          : { index: last.index, offset: last.offset, count, expanded, paused };
        return this.entryOf(record, stack);
      });
      return { layer, entries, group: { expanded, count, frontHeight: active[0]?.height ?? 0 } };
    });
  }

  private entryOf(record: OverlayRecord<H, C>, stack: StackData | null): Entry<H, C> {
    if (record.entry && sameStack(record.entry.stack, stack)) return record.entry;
    // Queued records are filtered out before this is called.
    const state = record.state as OverlayState;
    // Keep the control object stable across prop-only and position-only updates.
    if (record.control?.state !== state) record.control = { state, ...record.fns };
    record.entry = {
      id: record.id,
      handle: record.request.handle,
      component: record.request.component,
      props: record.props,
      control: record.control,
      stack,
    };
    return record.entry;
  }
}
