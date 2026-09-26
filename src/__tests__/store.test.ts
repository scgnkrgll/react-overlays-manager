import { describe, expect, test, vi } from "vitest";
import { OverlayStore, type Callbacks, type OpenRequest } from "../store.ts";
import type { LayerConfig } from "../types.ts";

function setup(layers: Record<string, LayerConfig> = { modal: {} }) {
  const store = new OverlayStore<string, string>(layers);
  const open = (overrides: Partial<OpenRequest<string, string>> & { callbacks?: Callbacks } = {}) =>
    store.open({
      layer: "modal",
      handle: "H",
      component: "C",
      exitTransition: false,
      props: {},
      callbacks: {},
      ...overrides,
    });
  const entry = (id: number) =>
    store
      .getSnapshot()
      .flatMap((l) => l.entries)
      .find((e) => e.id === id);
  const phase = (id: number) => entry(id)?.control.state.phase ?? "not rendered";
  const visible = (layer: string) =>
    store
      .getSnapshot()
      .find((l) => l.layer === layer)!
      .entries.map((e) => e.id);
  return { store, open, entry, phase, visible };
}

function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("open", () => {
  test("renders idle", () => {
    const { open, phase } = setup();
    expect(phase(open())).toBe("idle");
  });

  test("rejects invalid limits", () => {
    expect(() => new OverlayStore({ toast: { limit: 0 } })).toThrow(/positive integer/);
  });
});

describe("submit", () => {
  test("without onSubmit closes immediately", () => {
    const { store, open, phase } = setup();
    const id = open();
    store.submit(id, undefined);
    expect(phase(id)).toBe("not rendered");
  });

  test("sync return closes, sync throw fails", () => {
    const { store, open, phase } = setup();
    const ok = open({ callbacks: { onSubmit: () => 1 } });
    store.submit(ok, undefined);
    expect(phase(ok)).toBe("not rendered");

    const bad = open({
      callbacks: {
        onSubmit: () => {
          throw new Error("nope");
        },
      },
    });
    store.submit(bad, undefined);
    expect(phase(bad)).toBe("failed");
  });

  test("passes the value and a signal", () => {
    const { store, open } = setup();
    const onSubmit = vi.fn();
    const id = open({ callbacks: { onSubmit } });
    store.submit(id, "value");
    expect(onSubmit).toHaveBeenCalledWith("value", { signal: expect.any(AbortSignal) });
  });

  test("pending → closed on resolve", async () => {
    const { store, open, phase } = setup();
    const d = deferred();
    const id = open({ callbacks: { onSubmit: () => d.promise } });
    store.submit(id, undefined);
    expect(phase(id)).toBe("pending");
    d.resolve();
    await flush();
    expect(phase(id)).toBe("not rendered");
  });

  test("pending → failed on reject, then retry succeeds", async () => {
    const { store, open, entry, phase } = setup();
    let attempt = 0;
    const id = open({
      callbacks: { onSubmit: () => (++attempt === 1 ? Promise.reject(new Error("boom")) : Promise.resolve()) },
    });
    store.submit(id, undefined);
    await flush();
    const state = entry(id)!.control.state;
    expect(state).toEqual({ phase: "failed", error: new Error("boom") });

    store.submit(id, undefined);
    expect(phase(id)).toBe("pending"); // the retry clears the error
    await flush();
    expect(phase(id)).toBe("not rendered");
  });

  test("submit and dismiss are ignored while pending", async () => {
    const { store, open, phase } = setup();
    const onSubmit = vi.fn(() => new Promise(() => {}));
    const onDismiss = vi.fn();
    const id = open({ callbacks: { onSubmit, onDismiss } });
    store.submit(id, undefined);
    store.submit(id, undefined);
    store.dismiss(id);
    store.dismissAll();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(phase(id)).toBe("pending");
  });
});

describe("abortable", () => {
  test("dismiss while pending aborts, closes and ignores the late settle", async () => {
    const { store, open, phase } = setup();
    let signal!: AbortSignal;
    const d = deferred();
    const onDismiss = vi.fn();
    const id = open({
      callbacks: {
        abortable: true,
        onDismiss,
        onSubmit: (_: never, ctx: { signal: AbortSignal }) => {
          signal = ctx.signal;
          return d.promise;
        },
      },
    });
    store.submit(id, undefined);
    expect(store.getSnapshot()[0]!.entries[0]!.control.state).toEqual({ phase: "pending", abortable: true });

    store.dismiss(id);
    expect(signal.aborted).toBe(true);
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(phase(id)).toBe("not rendered");

    d.reject(new DOMException("aborted", "AbortError"));
    await flush();
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});

describe("dismiss", () => {
  test("fires onDismiss exactly once", () => {
    const { store, open } = setup();
    const onDismiss = vi.fn();
    const id = open({ callbacks: { onDismiss } });
    store.dismiss(id);
    store.dismiss(id);
    store.dismissAll();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  test("a successful submit never fires onDismiss", async () => {
    const { store, open } = setup();
    const onDismiss = vi.fn();
    const id = open({ exitTransition: true, callbacks: { onDismiss, onSubmit: () => Promise.resolve() } });
    store.submit(id, undefined);
    await flush();
    store.dismiss(id); // closing: ignored
    expect(onDismiss).not.toHaveBeenCalled();
  });

  test("callbacks run after the state is consistent and may reopen", () => {
    const { store, open, visible } = setup({ menu: { limit: 1 } });
    let reopened = -1;
    const id = open({
      layer: "menu",
      callbacks: {
        onDismiss: () => {
          expect(visible("menu")).toEqual([]);
          reopened = open({ layer: "menu" });
        },
      },
    });
    store.dismiss(id);
    expect(visible("menu")).toEqual([reopened]);
  });
});

describe("exitTransition", () => {
  test("stays closing until exited()", () => {
    const { store, open, phase } = setup();
    const id = open({ exitTransition: true });
    store.exited(id); // not closing yet: ignored
    expect(phase(id)).toBe("idle");
    store.dismiss(id);
    expect(phase(id)).toBe("closing");
    store.submit(id, undefined);
    expect(phase(id)).toBe("closing");
    store.exited(id);
    expect(phase(id)).toBe("not rendered");
  });
});

describe("layers", () => {
  test("queue: extra overlays wait and enter in order", () => {
    const { store, open, visible } = setup({ toast: { limit: 2 } });
    const [a, b, c, d] = [1, 2, 3, 4].map(() => open({ layer: "toast" }));
    expect(visible("toast")).toEqual([a, b]);
    store.dismiss(a!);
    expect(visible("toast")).toEqual([b, c]);
    store.dismiss(d!); // queued: removed without ever rendering
    store.dismiss(b!);
    expect(visible("toast")).toEqual([c]);
  });

  test("closing overlays free their slot", () => {
    const { store, open, visible, phase } = setup({ toast: { limit: 1 } });
    const a = open({ layer: "toast", exitTransition: true });
    const b = open({ layer: "toast" });
    store.dismiss(a);
    expect(phase(a)).toBe("closing");
    expect(visible("toast")).toEqual([a, b]);
  });

  test("dismiss-oldest evicts the oldest non-pending overlay", () => {
    const { store, open, visible } = setup({ menu: { limit: 2, overflow: "dismiss-oldest" } });
    const onDismiss = vi.fn();
    const a = open({ layer: "menu", callbacks: { onSubmit: () => new Promise(() => {}) } });
    const b = open({ layer: "menu", callbacks: { onDismiss } });
    store.submit(a, undefined); // a is pending, so it's skipped
    const c = open({ layer: "menu" });
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(visible("menu")).toEqual([a, c]);
  });

  test("dismiss-oldest queues when every active overlay is pending", () => {
    const { store, open, visible } = setup({ menu: { limit: 1, overflow: "dismiss-oldest" } });
    const d = deferred();
    const a = open({ layer: "menu", callbacks: { onSubmit: () => d.promise } });
    store.submit(a, undefined);
    const b = open({ layer: "menu" });
    expect(visible("menu")).toEqual([a]);
    store.dismiss(b);
    expect(visible("menu")).toEqual([a]);
  });

  test("dismissAll(layer) only touches that layer and never promotes the queue", () => {
    const { store, open, visible } = setup({ modal: {}, toast: { limit: 1 } });
    const onDismiss = vi.fn();
    const m = open();
    open({ layer: "toast", callbacks: { onDismiss } });
    open({ layer: "toast", callbacks: { onDismiss } });
    store.dismissAll("toast");
    expect(onDismiss).toHaveBeenCalledTimes(2);
    expect(visible("toast")).toEqual([]);
    expect(visible("modal")).toEqual([m]);
  });
});

describe("snapshot", () => {
  test("notifies once per transition and keeps untouched entries stable", () => {
    const { store, open, entry } = setup();
    const a = open();
    const b = open();
    const before = entry(a);
    const listener = vi.fn();
    store.subscribe(listener);
    store.update(b, { x: 1 });
    expect(listener).toHaveBeenCalledOnce();
    expect(entry(a)).toBe(before);
    expect(entry(b)!.props).toEqual({ x: 1 });
  });

  test("control is stable across prop-only updates", () => {
    const { store, open, entry } = setup();
    const a = open();
    const control = entry(a)!.control;
    store.update(a, { x: 1 });
    expect(entry(a)!.control).toBe(control);
  });
});

describe("stack layers", () => {
  const Container = () => null;
  const stackSetup = () => setup({ toast: { stack: true, container: Container } });
  const stackOf = (s: ReturnType<typeof stackSetup>, id: number) => s.entry(id)!.stack!;
  const groupOf = (s: ReturnType<typeof stackSetup>) => s.store.getSnapshot()[0]!.group!;

  test("newest is index 0 and offsets sum the heights of newer overlays", () => {
    const s = stackSetup();
    const [a, b, c] = [1, 2, 3].map(() => s.open({ layer: "toast" })) as [number, number, number];
    s.store.setHeight(a, 10);
    s.store.setHeight(b, 20);
    s.store.setHeight(c, 30);
    expect([a, b, c].map((id) => stackOf(s, id).index)).toEqual([2, 1, 0]);
    expect([a, b, c].map((id) => stackOf(s, id).offset)).toEqual([50, 30, 0]);
    expect(stackOf(s, a).count).toBe(3);
    expect(groupOf(s)).toEqual({ expanded: false, count: 3, frontHeight: 30 });
  });

  test("plain layers have no stack info", () => {
    const { open, entry, store } = setup();
    expect(entry(open())!.stack).toBeNull();
    expect(store.getSnapshot()[0]!.group).toBeNull();
  });

  test("a closing overlay keeps its position but no longer counts for the others", () => {
    const s = stackSetup();
    const a = s.open({ layer: "toast" });
    const b = s.open({ layer: "toast", exitTransition: true });
    s.store.setHeight(a, 10);
    s.store.setHeight(b, 20);
    expect(stackOf(s, a)).toMatchObject({ index: 1, offset: 20 });

    s.store.dismiss(b);
    expect(s.phase(b)).toBe("closing");
    expect(stackOf(s, b)).toMatchObject({ index: 0, offset: 0, count: 1 });
    expect(stackOf(s, a)).toMatchObject({ index: 0, offset: 0, count: 1 });
  });

  test("expanded and paused", () => {
    const s = stackSetup();
    const a = s.open({ layer: "toast" });
    s.store.setExpanded("toast", true);
    expect(stackOf(s, a)).toMatchObject({ expanded: true, paused: true });
    s.store.setExpanded("toast", false);
    expect(stackOf(s, a)).toMatchObject({ expanded: false, paused: false });
    s.store.setPageHidden(true);
    expect(stackOf(s, a)).toMatchObject({ expanded: false, paused: true });
  });

  test("setExpanded is ignored for plain layers", () => {
    const { store } = setup();
    const listener = vi.fn();
    store.subscribe(listener);
    store.setExpanded("modal", true);
    expect(listener).not.toHaveBeenCalled();
  });

  test("expanded resets when the layer becomes empty", () => {
    const s = stackSetup();
    const a = s.open({ layer: "toast" });
    s.store.setExpanded("toast", true);
    s.store.dismiss(a);
    expect(groupOf(s).expanded).toBe(false);
    const b = s.open({ layer: "toast" });
    expect(stackOf(s, b).expanded).toBe(false);
  });

  test("a height change only replaces entries whose offset changed", () => {
    const s = stackSetup();
    const a = s.open({ layer: "toast" });
    const b = s.open({ layer: "toast" });
    const front = s.entry(b);
    const listener = vi.fn();
    s.store.subscribe(listener);

    s.store.setHeight(a, 40); // a is behind b: nobody's offset depends on a's height
    expect(listener).toHaveBeenCalledOnce();
    expect(s.entry(b)).toBe(front);

    s.store.setHeight(a, 40); // unchanged: no notification
    expect(listener).toHaveBeenCalledOnce();

    const control = s.entry(a)!.control;
    s.store.setHeight(b, 25);
    expect(s.entry(a)!.stack!.offset).toBe(25);
    expect(s.entry(a)!.control).toBe(control); // position-only change keeps the control stable
  });

  test("setHeights applies several measurements with one notification", () => {
    const s = stackSetup();
    const a = s.open({ layer: "toast" });
    const b = s.open({ layer: "toast" });
    const listener = vi.fn();
    s.store.subscribe(listener);

    s.store.setHeights([
      [a, 30],
      [b, 20],
    ]);
    expect(listener).toHaveBeenCalledOnce();
    expect(s.entry(a)!.stack!.offset).toBe(20);

    s.store.setHeights([[a, 30]]); // unchanged: no notification
    expect(listener).toHaveBeenCalledOnce();
  });
});
