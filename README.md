# react-overlord

[![npm](https://img.shields.io/npm/v/react-overlord)](https://www.npmjs.com/package/react-overlord)
[![JSR](https://jsr.io/badges/@scgnkrgll/react-overlord)](https://jsr.io/@scgnkrgll/react-overlord)

A type-safe, headless manager for modals, drawers, context menus, toasts and anything else that floats above your app.

- **Fully typed.** `open()` knows the overlay's props and what it submits. `useOverlay()` knows the same types.
- **Async work without losing input.** While the caller's `onSubmit` runs, the overlay stays open and can disable itself. If it fails, the overlay stays open with the user's input intact and shows the error, so the user can retry.
- **One way to do each thing.** Open with `Handle.open()`. Finish with `submit()` or `dismiss()`. There are no aliases or alternative forms.
- **Headless.** Bring your own UI (antd, MUI, plain HTML). The library only manages state and rendering.

## Install

```sh
npm i react-overlord                    # npm / pnpm / yarn / bun
npx jsr add @scgnkrgll/react-overlord   # JSR
deno add jsr:@scgnkrgll/react-overlord  # Deno
```

Requires React 18 or later. The package ships with a `"use client"` directive, so it works in Next.js App Router.

## Setup

```tsx
// overlays.ts
import { createOverlayManager } from "react-overlord";

export const overlays = createOverlayManager({
  layers: {                                              // declaration order = render order (later draws on top)
    modal: {},                                           // unlimited
    menu:  { limit: 1, overflow: "dismiss-oldest" },     // a new menu replaces the old one
    toast: { stack: true, limit: 24, container: ToastGroup },  // Ark-style pile, see "Stacked layers"
  },
});
```

```tsx
// App.tsx: mount once, inside your theme/router/query providers so overlays can use them
<ThemeProvider>
  <Routes />
  <overlays.Outlet />
</ThemeProvider>
```

A layer's rules apply across every overlay in it. For example, two different menu components can never be open at the same time.

| Layer option | Meaning |
|---|---|
| `limit` | Maximum number of active overlays. Closing overlays don't count. |
| `overflow` | When the limit is reached: `"queue"` (default) waits for a free slot. `"dismiss-oldest"` dismisses the oldest overlay that isn't pending, and queues the new one if every active overlay is pending. |
| `container` | A component that wraps the layer. It is always rendered, so it works as an `aria-live` region. Required for stack layers, where it also receives `group`. |
| `stack` | `true` makes the layer a pile that expands on hover or focus. See below. |

## Defining an overlay

```tsx
type UserModalProps = { user?: User };

export const UserModal = overlays.createOverlay<UserModalProps, User>("modal", UserInfoModal, {
  exitTransition: true,
});

function UserInfoModal({ user }: UserModalProps) {
  const { state, submit, dismiss, exited } = useOverlay(UserModal);
  const [form] = Form.useForm();

  return (
    <Modal
      open={state.phase !== "closing"}
      afterClose={exited}
      confirmLoading={state.phase === "pending"}
      onCancel={dismiss}
      onOk={() => form.validateFields().then(submit)}
    >
      {state.phase === "failed" && <Alert type="error" message={String(state.error)} />}
      <Form form={form} disabled={state.phase === "pending"} initialValues={user}>…</Form>
    </Modal>
  );
}
```

- `createOverlay<Props, Value = void>(layer, Component, options?)`. `Value` is what the overlay submits. `layer` must be a declared layer name, and `Component`'s props must match `Props`.
- `useOverlay(Handle)` only works inside that handle's component. It throws a clear error anywhere else, including inside a different overlay. A component belongs to exactly one handle.
- `exitTransition: true` keeps the overlay mounted in `closing` until it calls `exited()`. Without it, closing unmounts immediately.

## Opening

```tsx
const instance = UserModal.open({ user }, {
  onSubmit: (user, { signal }) => api.saveUser(user),  // return a promise to stay pending until it settles
  onDismiss: () => {},
});

instance.update({ user: other });  // replaces all props, no remount
instance.dismiss();

overlays.dismissAll();             // or overlays.dismissAll("toast")
```

`open` works anywhere: in components, event handlers, or an API interceptor outside React.

| Value | `useOverlay().submit` | `open()` callbacks |
|---|---|---|
| a type, e.g. `User` | `submit(user)` | `onSubmit` is **required**, so a submitted value can't be silently dropped |
| `void` (default) | `submit()` | all optional. A void overlay without `onSubmit` just closes on submit. |

Callbacks are read once, when `open` is called. For values that change while the overlay is open, read them from a ref or a store inside the callback.

### Aborting a pending submit

By default an overlay can't be dismissed while `onSubmit` is pending. The caller can opt in:

```tsx
Confirm.open({ text: "Delete?" }, {
  abortable: true,
  onSubmit: (_, { signal }) => api.delete(id, { signal }),
});
```

The pending state then has `abortable: true`, so the overlay can keep its Cancel button enabled. Dismissing aborts the signal, closes the overlay and calls `onDismiss`. The rejection from the aborted request is ignored.

## Stacked layers

`stack: true` turns a layer into an Ark UI–style pile:
- Overlays overlap, with the newest in front.
- Hovering or focusing the group spreads them into a list.
- Auto-dismiss timers can pause while the pile is expanded.

The library tracks positions and measures heights. Your components and CSS do the rendering.

```tsx
function ToastGroup({ children, group }: StackContainerProps) {
  // group = { expanded, count, frontHeight, props }
  return (
    <ol {...group.props} data-expanded={group.expanded} style={{ "--front-height": `${group.frontHeight}px` }}>
      {children}
    </ol>
  );
}

function Toast({ message }: { message: string }) {
  const { stack, dismiss } = useOverlay(ToastOverlay);
  // stack = { index, count, expanded, paused, offset, ref }
  useCountdown(4000, stack.paused, dismiss);
  return (
    <li data-expanded={stack.expanded} style={{ "--index": stack.index, "--offset": `${stack.offset}px` }}>
      <div ref={stack.ref}>{message}</div>
    </li>
  );
}
```

| Field | Meaning |
|---|---|
| `index` | 0 is the newest overlay, at the front of the pile |
| `count` | Number of active overlays in the layer. Queued and closing overlays don't count. |
| `offset` | Sum of the measured heights of the newer overlays, in px. Add your gap in CSS: `calc(var(--offset) + var(--index) * var(--gap))`. |
| `ref` | Attach to the element to measure. Heights come from layout (`offsetHeight` / `ResizeObserver`), so transforms like `scale` don't affect them. |
| `expanded` | True while the group is hovered or focused. `group.props` sets it. Moving focus within the group keeps it expanded. |
| `paused` | `expanded`, or the page is hidden. Pause timers on this. |
| `group.frontHeight` | Height of the front overlay, for sizing the collapsed pile |

A closing overlay keeps its last `index` and `offset` while it animates out. The others close the gap right away. `stack` exists only for overlays in a stack layer: `useOverlay(UserModal).stack` is a type error.

See `demo/Toast.tsx`, `demo/ToastGroup.tsx` and `demo/styles.css` for a complete pile.

## State machine

The state an overlay sees:

```ts
type OverlayState =
  | { phase: "idle" }
  | { phase: "pending"; abortable: boolean }
  | { phase: "failed"; error: unknown }
  | { phase: "closing" };
```

| from | event | to |
|---|---|---|
| — | `open()` | `idle`, or queued (not rendered) when the layer is full |
| queued | a slot frees | `idle` |
| queued | dismiss | removed, `onDismiss` |
| idle / failed | `submit(v)` | calls `onSubmit(v, { signal })`: a promise → `pending`, a sync return → `closing`, a sync throw → `failed`. With no `onSubmit` → `closing`. |
| pending | promise resolves | `closing` |
| pending | promise rejects | `failed` (still mounted, so local state and form input are kept) |
| pending | submit | ignored |
| pending | dismiss | ignored, unless `abortable`: abort → `closing`, `onDismiss` |
| idle / failed | dismiss / dismissAll / evicted | `closing`, `onDismiss` |
| closing | `exited()` (or immediately without `exitTransition`) | removed |

Guarantees:
- Every `open()` ends in exactly one of: `onSubmit` succeeded, or `onDismiss` was called.
- Events not listed in the table are no-ops.
- Only the next `submit` clears the error.
- An overlay is never remounted while open.
- Callbacks run after the state has been updated, so they can safely open other overlays.

## Development

```sh
pnpm test        # store, integration and type tests
pnpm typecheck
pnpm build       # esm + cjs + .d.ts
pnpm demo        # Vite demo: forms, confirm, context menu, stacked toasts
pnpm lint:pkg    # publint + are-the-types-wrong on the packed tarball
```

### Releasing

```sh
npm version patch        # bumps package.json and jsr.json, commits, tags vX.Y.Z
git push --follow-tags   # the Release workflow publishes to npm and JSR
```
