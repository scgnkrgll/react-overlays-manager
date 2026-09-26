import { useOverlay } from "../src";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { SubmitError } from "./Modal";
import { overlays } from "./overlays";

interface ConfirmDialogProps {
  title: string;
  message: string;
}

/** A shadcn AlertDialog, wired to the manager the same way as `Modal`. */
function ConfirmDialog({ title, message }: ConfirmDialogProps) {
  const { state, submit, dismiss, exited } = useOverlay(ConfirmOverlay);
  const pending = state.phase === "pending";
  const canCancel = !pending || state.abortable;

  return (
    <AlertDialog
      open={state.phase !== "closing"}
      onOpenChange={(open) => !open && canCancel && dismiss()}
      onOpenChangeComplete={(open) => !open && exited()}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{message}</AlertDialogDescription>
        </AlertDialogHeader>
        <SubmitError state={state} />
        <AlertDialogFooter>
          <Button variant="outline" onClick={dismiss} disabled={!canCancel}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => submit()} disabled={pending}>
            {pending ? "Working…" : "Confirm"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export const ConfirmOverlay = overlays.createOverlay<ConfirmDialogProps>("modal", ConfirmDialog, {
  exitTransition: true,
});
