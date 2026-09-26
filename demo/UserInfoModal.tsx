import { useState } from "react";
import { useOverlay } from "../src";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { User } from "./api";
import { Modal } from "./Modal";
import { overlays } from "./overlays";

type Draft = Omit<User, "id"> & { id?: string };

interface UserInfoModalProps {
  user?: User;
}

function UserInfoModal({ user }: UserInfoModalProps) {
  const { state, submit, dismiss, exited } = useOverlay(UserInfoOverlay);
  const [draft, setDraft] = useState<Draft>(user ?? { name: "", job: "" });
  const busy = state.phase === "pending";

  const save = () => {
    if (!draft.name.trim() || !draft.job.trim()) return;
    submit({ ...draft, id: draft.id ?? String(Date.now()) });
  };

  return (
    <Modal
      title={user ? "Edit user" : "New user"}
      state={state}
      canDismiss={!busy}
      onDismiss={dismiss}
      onExited={exited}
      footer={
        <>
          <Button variant="outline" onClick={dismiss} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? "Saving…" : user ? "Update" : "Create"}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <fieldset disabled={busy} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="user-name">Name</Label>
            <Input
              id="user-name"
              autoFocus
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="user-job">Job title</Label>
            <Input id="user-job" value={draft.job} onChange={(e) => setDraft({ ...draft, job: e.target.value })} />
          </div>
        </fieldset>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

export const UserInfoOverlay = overlays.createOverlay<UserInfoModalProps, User>("modal", UserInfoModal, {
  exitTransition: true,
});
