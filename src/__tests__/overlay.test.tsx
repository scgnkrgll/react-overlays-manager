import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createOverlayManager, useOverlay, type StackContainerProps } from "../index.ts";

function setup() {
  const overlays = createOverlayManager({ layers: { modal: {}, toast: { limit: 1 } } });

  function NameModal({ title }: { title: string }) {
    const { state, submit, dismiss, exited } = useOverlay(NameOverlay);
    const [name, setName] = useState("");
    const busy = state.phase === "pending";
    return (
      <div role="dialog" aria-label={title} data-phase={state.phase}>
        <input aria-label="name" value={name} disabled={busy} onChange={(e) => setName(e.target.value)} />
        {state.phase === "failed" && <p role="alert">{String(state.error)}</p>}
        <button disabled={busy} onClick={() => submit(name)}>
          Save
        </button>
        <button onClick={dismiss}>Cancel</button>
        <button onClick={exited}>Animation done</button>
      </div>
    );
  }
  const NameOverlay = overlays.createOverlay<{ title: string }, string>("modal", NameModal);

  function AnimatedModal() {
    const { state, dismiss, exited } = useOverlay(AnimatedOverlay);
    return (
      <div role="dialog" data-phase={state.phase}>
        <button onClick={dismiss}>Cancel</button>
        <button onClick={exited}>Animation done</button>
      </div>
    );
  }
  const AnimatedOverlay = overlays.createOverlay("modal", AnimatedModal, { exitTransition: true });

  render(<overlays.Outlet />);
  return { overlays, NameOverlay, AnimatedOverlay };
}

describe("form overlay", () => {
  test("stays open and keeps input on failure, then retries", async () => {
    const user = userEvent.setup();
    const { NameOverlay } = setup();
    const onSubmit = vi
      .fn<(name: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("Server down"))
      .mockResolvedValueOnce(undefined);
    act(() => void NameOverlay.open({ title: "Rename" }, { onSubmit }));

    await user.type(screen.getByLabelText("name"), "Ada");
    await user.click(screen.getByText("Save"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Server down");
    expect(screen.getByRole("dialog")).toHaveAttribute("data-phase", "failed");
    expect(screen.getByLabelText("name")).toHaveValue("Ada");
    expect(screen.getByLabelText("name")).toBeEnabled();

    await user.type(screen.getByLabelText("name"), "!");
    await user.click(screen.getByText("Save"));
    expect(onSubmit).toHaveBeenLastCalledWith("Ada!", expect.anything());
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  test("is disabled while pending", async () => {
    const user = userEvent.setup();
    const { NameOverlay } = setup();
    act(() => void NameOverlay.open({ title: "Rename" }, { onSubmit: () => new Promise(() => {}) }));

    await user.click(screen.getByText("Save"));
    expect(screen.getByRole("dialog")).toHaveAttribute("data-phase", "pending");
    expect(screen.getByLabelText("name")).toBeDisabled();
    await user.click(screen.getByText("Cancel")); // not abortable: ignored
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  test("update() changes props without remounting", async () => {
    const user = userEvent.setup();
    const { NameOverlay } = setup();
    let instance!: ReturnType<typeof NameOverlay.open>;
    act(() => void (instance = NameOverlay.open({ title: "One" }, { onSubmit: () => {} })));
    await user.type(screen.getByLabelText("name"), "kept");

    act(() => instance.update({ title: "Two" }));
    expect(screen.getByRole("dialog", { name: "Two" })).toBeInTheDocument();
    expect(screen.getByLabelText("name")).toHaveValue("kept");
  });

  test("exitTransition keeps the overlay mounted until exited()", async () => {
    const user = userEvent.setup();
    const { AnimatedOverlay } = setup();
    const onDismiss = vi.fn();
    act(() => void AnimatedOverlay.open({}, { onDismiss }));

    await user.click(screen.getByText("Cancel"));
    expect(screen.getByRole("dialog")).toHaveAttribute("data-phase", "closing");
    expect(onDismiss).toHaveBeenCalledOnce();
    await user.click(screen.getByText("Animation done"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("openAsync", () => {
  test("resolves with the value after onSubmit succeeds, keeping the overlay open through a failure", async () => {
    const user = userEvent.setup();
    const { NameOverlay } = setup();
    const onSubmit = vi
      .fn<(name: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("Server down"))
      .mockResolvedValueOnce(undefined);
    let result!: Promise<unknown>;
    act(() => void (result = NameOverlay.openAsync({ title: "Rename" }, { onSubmit })));
    const settled = vi.fn();
    void result.then(settled);

    await user.type(screen.getByLabelText("name"), "Ada");
    await user.click(screen.getByText("Save"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Server down");
    expect(settled).not.toHaveBeenCalled();

    await user.click(screen.getByText("Save"));
    await expect(result).resolves.toEqual({ submitted: true, value: "Ada" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("resolves without onSubmit as soon as the overlay submits", async () => {
    const user = userEvent.setup();
    const { NameOverlay } = setup();
    let result!: Promise<unknown>;
    act(() => void (result = NameOverlay.openAsync({ title: "Rename" })));

    await user.type(screen.getByLabelText("name"), "Ada");
    await user.click(screen.getByText("Save"));
    await expect(result).resolves.toEqual({ submitted: true, value: "Ada" });
  });

  test("resolves with submitted: false on dismiss, including an aborted submit", async () => {
    const user = userEvent.setup();
    const { NameOverlay, overlays } = setup();
    let first!: Promise<unknown>;
    act(() => void (first = NameOverlay.openAsync({ title: "First" })));
    act(() => overlays.dismissAll());
    await expect(first).resolves.toEqual({ submitted: false });

    let signal!: AbortSignal;
    let second!: Promise<unknown>;
    act(
      () =>
        void (second = NameOverlay.openAsync(
          { title: "Second" },
          { abortable: true, onSubmit: (_, context) => ((signal = context.signal), new Promise(() => {})) },
        )),
    );
    await user.click(screen.getByText("Save"));
    await user.click(screen.getByText("Cancel"));
    await expect(second).resolves.toEqual({ submitted: false });
    expect(signal.aborted).toBe(true);
  });

  test("resolves after the overlay has closed", async () => {
    const user = userEvent.setup();
    const { NameOverlay } = setup();
    let result!: Promise<unknown>;
    act(() => void (result = NameOverlay.openAsync({ title: "Rename" })));
    const dialogAtResolve = result.then(() => screen.queryByRole("dialog"));

    await user.click(screen.getByText("Save"));
    expect(await dialogAtResolve).toBeNull();
  });
});

describe("rendering", () => {
  test("renders layers in declaration order inside their container", () => {
    const Viewport = ({ children }: { children?: React.ReactNode }) => <section aria-label="toasts">{children}</section>;
    const overlays = createOverlayManager({ layers: { modal: {}, toast: { container: Viewport } } });
    const Toast = overlays.createOverlay("toast", ({ text }: { text: string }) => <p>{text}</p>);
    const Modal = overlays.createOverlay("modal", ({ text }: { text: string }) => <p>{text}</p>);
    const { container } = render(<overlays.Outlet />);

    act(() => {
      Toast.open({ text: "toast" });
      Modal.open({ text: "modal" });
    });
    expect([...container.querySelectorAll("p")].map((p) => p.textContent)).toEqual(["modal", "toast"]);
    expect(screen.getByLabelText("toasts")).toHaveTextContent("toast");
  });

  test("only the changed overlay re-renders", () => {
    const overlays = createOverlayManager({ layers: { modal: {} } });
    const renders: string[] = [];
    function Item({ name }: { name: string }) {
      renders.push(name);
      return null;
    }
    const Overlay = overlays.createOverlay("modal", Item);
    render(<overlays.Outlet />);
    let b!: ReturnType<typeof Overlay.open>;
    act(() => {
      Overlay.open({ name: "a" });
      b = Overlay.open({ name: "b" });
    });
    renders.length = 0;
    act(() => b.update({ name: "b2" }));
    expect(renders).toEqual(["b2"]);
  });
});

describe("useOverlay guard", () => {
  test("throws outside any overlay", () => {
    const overlays = createOverlayManager({ layers: { modal: {} } });
    const Handle = overlays.createOverlay("modal", function Named() {
      return null;
    });
    function Outside() {
      useOverlay(Handle);
      return null;
    }
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Outside />)).toThrow("useOverlay(Named) must be called inside the Named overlay component");
  });

  test("throws inside a different overlay", () => {
    const overlays = createOverlayManager({ layers: { modal: {} } });
    const Other = overlays.createOverlay("modal", function OtherOverlay() {
      return null;
    });
    function Wrong() {
      useOverlay(Other);
      return null;
    }
    const WrongHandle = overlays.createOverlay("modal", Wrong);
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<overlays.Outlet />);
    expect(() => act(() => void WrongHandle.open())).toThrow(/called inside a different overlay \(Wrong\)/);
  });
});

describe("stack layers", () => {
  function setupStack() {
    // jsdom has no layout: report heights from a data attribute, and let tests trigger resizes.
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
      return Number(this.dataset.height ?? 0);
    });
    const observed = new Set<Element>();
    let notify!: (entries: ResizeObserverEntry[]) => void;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: (entries: ResizeObserverEntry[]) => void) {
          notify = callback;
        }
        observe(el: Element) {
          observed.add(el);
        }
        unobserve(el: Element) {
          observed.delete(el);
        }
        disconnect() {}
      },
    );
    const resize = (el: HTMLElement, height: number) =>
      act(() => notify([{ target: el, borderBoxSize: [{ blockSize: height, inlineSize: 0 }] } as never]));

    function Group({ children, group }: StackContainerProps) {
      return (
        <ol aria-label="toasts" data-expanded={group.expanded} data-count={group.count} data-front={group.frontHeight} {...group.props}>
          {children}
        </ol>
      );
    }
    const overlays = createOverlayManager({ layers: { toast: { stack: true, container: Group } } });
    function Toast({ text, height }: { text: string; height: number }) {
      const { stack } = useOverlay(ToastOverlay);
      return (
        <li
          ref={stack.ref}
          data-height={height}
          data-index={stack.index}
          data-offset={stack.offset}
          data-paused={stack.paused}
          aria-label={text}
        />
      );
    }
    const ToastOverlay = overlays.createOverlay("toast", Toast);
    render(<overlays.Outlet />);
    return { ToastOverlay, observed, resize };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test("toasts get their index and measured offsets, the container gets the group", () => {
    const { ToastOverlay, observed } = setupStack();
    act(() => {
      ToastOverlay.open({ text: "first", height: 40 });
      ToastOverlay.open({ text: "second", height: 60 });
    });
    const first = screen.getByLabelText("first");
    const second = screen.getByLabelText("second");
    expect(second).toHaveAttribute("data-index", "0");
    expect(first).toHaveAttribute("data-index", "1");
    expect(first).toHaveAttribute("data-offset", "60");
    expect(screen.getByLabelText("toasts")).toHaveAttribute("data-count", "2");
    expect(screen.getByLabelText("toasts")).toHaveAttribute("data-front", "60");
    expect(observed).toEqual(new Set([first, second]));
  });

  test("a resize updates the offsets behind it", () => {
    const { ToastOverlay, resize } = setupStack();
    act(() => {
      ToastOverlay.open({ text: "first", height: 40 });
      ToastOverlay.open({ text: "second", height: 60 });
    });
    resize(screen.getByLabelText("second"), 90);
    expect(screen.getByLabelText("first")).toHaveAttribute("data-offset", "90");
  });

  test("hovering the group expands and pauses the toasts", async () => {
    const user = userEvent.setup();
    const { ToastOverlay } = setupStack();
    act(() => void ToastOverlay.open({ text: "only", height: 40 }));
    const group = screen.getByLabelText("toasts");

    await user.hover(group);
    expect(group).toHaveAttribute("data-expanded", "true");
    expect(screen.getByLabelText("only")).toHaveAttribute("data-paused", "true");

    await user.unhover(group);
    expect(group).toHaveAttribute("data-expanded", "false");
    expect(screen.getByLabelText("only")).toHaveAttribute("data-paused", "false");
  });

  test("removing a toast unobserves it", () => {
    const { ToastOverlay, observed } = setupStack();
    let instance!: ReturnType<typeof ToastOverlay.open>;
    act(() => void (instance = ToastOverlay.open({ text: "gone", height: 40 })));
    expect(observed.size).toBe(1);
    act(() => instance.dismiss());
    expect(observed.size).toBe(0);
  });
});
