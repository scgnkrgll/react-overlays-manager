import { describe, expectTypeOf, test } from "vitest";
import {
  createOverlayManager,
  useOverlay,
  type OverlayControl,
  type OverlayHandle,
  type OverlayInstance,
  type OverlayState,
  type StackContainerProps,
  type StackInfo,
} from "../index.ts";

interface User {
  id: string;
  name: string;
}

const overlays = createOverlayManager({
  layers: {
    modal: {},
    menu: { limit: 1, overflow: "dismiss-oldest" },
    toast: { limit: 3 },
  },
});

// The component and its handle reference each other: the spike from the plan.
function UserInfoModal({ user }: { user?: User }) {
  const overlay = useOverlay(UserModal);
  expectTypeOf(overlay).toEqualTypeOf<OverlayControl<User>>();
  return <form onSubmit={() => overlay.submit({ id: "1", name: user?.name ?? "" })} />;
}
const UserModal = overlays.createOverlay<{ user?: User }, User>("modal", UserInfoModal);

function ConfirmDialog({ text }: { text: string }) {
  const { submit } = useOverlay(Confirm);
  return <button onClick={() => submit()}>{text}</button>;
}
const Confirm = overlays.createOverlay<{ text: string }>("modal", ConfirmDialog);

function Toast(_: { message?: string }) {
  return null;
}
const Notice = overlays.createOverlay("toast", Toast);

describe("createOverlay", () => {
  test("only accepts declared layers", () => {
    // @ts-expect-error "drawer" is not a declared layer
    overlays.createOverlay("drawer", Toast);
    overlays.dismissAll("toast");
    // @ts-expect-error not a declared layer
    overlays.dismissAll("drawer");
  });

  test("component props must match the declared props", () => {
    // @ts-expect-error UserInfoModal takes { user?: User }, not { count: number }
    overlays.createOverlay<{ count: number }, User>("modal", UserInfoModal);
  });

  test("props and value are inferred without generics", () => {
    const instance = Notice.open({ message: "hi" });
    expectTypeOf(instance).toEqualTypeOf<OverlayInstance<{ message?: string }>>();
  });
});

describe("open", () => {
  test("a non-void value requires onSubmit", () => {
    UserModal.open({}, { onSubmit: (user) => expectTypeOf(user).toEqualTypeOf<User>() });
    // @ts-expect-error callbacks are required
    UserModal.open({});
    // @ts-expect-error onSubmit is required
    UserModal.open({}, { onDismiss: () => {} });
  });

  test("void overlays make callbacks optional", () => {
    Confirm.open({ text: "Delete?" });
    Confirm.open({ text: "Delete?" }, { abortable: true, onSubmit: (_, { signal }) => fetch("/x", { signal }) });
    // @ts-expect-error text is required
    Confirm.open();
    // @ts-expect-error wrong prop type
    Confirm.open({ text: 1 });
  });

  test("props can be omitted only when all are optional", () => {
    Notice.open();
  });

  test("update replaces the full props", () => {
    const instance = Confirm.open({ text: "a" });
    instance.update({ text: "b" });
    // @ts-expect-error update takes full props, not a partial
    instance.update({});
  });
});

describe("useOverlay", () => {
  test("submit takes no argument for void overlays", () => {
    type ConfirmControl = OverlayControl<void>;
    expectTypeOf<ConfirmControl["submit"]>().toEqualTypeOf<() => void>();
    expectTypeOf<OverlayControl<User>["submit"]>().toEqualTypeOf<(value: User) => void>();
  });

  test("error is only readable once the phase is narrowed to failed", () => {
    const state = {} as OverlayState;
    // @ts-expect-error error doesn't exist on every phase
    void state.error;
    if (state.phase === "failed") expectTypeOf(state.error).toBeUnknown();
    if (state.phase === "pending") expectTypeOf(state.abortable).toBeBoolean();
  });
});

describe("stack layers", () => {
  function Group({ children, group }: StackContainerProps) {
    return <ol {...group.props}>{children}</ol>;
  }
  const stacked = createOverlayManager({
    layers: { modal: {}, toast: { stack: true, container: Group } },
  });

  function StackToast({ text }: { text: string }) {
    const { stack } = useOverlay(StackToastOverlay);
    expectTypeOf(stack).toEqualTypeOf<StackInfo>();
    return <li ref={stack.ref}>{text}</li>;
  }
  // Explicit <Props, Value> generics still pick the right overload from the layer name.
  const StackToastOverlay = stacked.createOverlay<{ text: string }, string>("toast", StackToast);

  function PlainModal() {
    const overlay = useOverlay(PlainModalOverlay);
    // @ts-expect-error only overlays in a stack layer have `stack`
    void overlay.stack;
    return null;
  }
  const PlainModalOverlay = stacked.createOverlay("modal", PlainModal);

  test("the handle carries the stack flag", () => {
    expectTypeOf(StackToastOverlay).toEqualTypeOf<OverlayHandle<{ text: string }, string, true>>();
    expectTypeOf<NonNullable<(typeof PlainModalOverlay)["~types"]>["stack"]>().toEqualTypeOf<false>();
  });

  test("a stack layer requires a stack container", () => {
    // @ts-expect-error container is required for stack layers
    createOverlayManager({ layers: { toast: { stack: true } } });
    const Plain = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
    // @ts-expect-error a stack container must accept `group`
    createOverlayManager({ layers: { toast: { stack: true, container: (_: { other: number }) => null } } });
    createOverlayManager({ layers: { modal: { container: Plain } } });
  });

  test("stack layer names are still checked", () => {
    // @ts-expect-error not a declared layer
    stacked.createOverlay("drawer", StackToast);
    stacked.dismissAll("toast");
  });
});
