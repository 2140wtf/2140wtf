import { Loader2, Plus, Shield } from "lucide-react";
import { useMemo, useState } from "react";

import { BaoMark as ArmadaCrest, BaoMarkKeyframes as ArmadaCrestKeyframes } from "@/components/brand/BaoMark";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRoles2 } from "@/concord-v2/hooks/useRoles2";
import { toast } from "@/hooks/useToast";
import { PERMISSION_LABELS, type Role } from "@/concord-v2/lib/roles";
import type { CommunityV2 } from "@/concord-v2/lib/types";
import { cn } from "@/lib/utils";

/**
 * Role management for a Concord V2 community: create roles, edit names and
 * permission bits. Each save publishes a version-chained Role (vsk 1) edition;
 * every member's fold re-checks MANAGE_ROLES + strict outrank (CORD-04).
 */
export function RolesDialog2({
  community,
  open,
  onOpenChange,
}: {
  community: CommunityV2 | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md border-0 rounded-none p-0 bg-transparent shadow-none">
        <DialogTitle className="sr-only">Roles</DialogTitle>
        <div className="clip-corner-lg bg-chrome p-6 sm:p-7">
          {community && <RolesBody community={community} />}
        </div>
        <ArmadaCrestKeyframes />
      </DialogContent>
    </Dialog>
  );
}

function RolesBody({ community }: { community: CommunityV2 }) {
  const { folded, saveRole, isSavingRole, newRoleId } = useRoles2(community);
  const [editing, setEditing] = useState<Role | null>(null);
  const [error, setError] = useState<string | null>(null);

  const roles = useMemo(
    () => [...(folded?.roster.roles ?? [])].sort((a, b) => a.position - b.position),
    [folded],
  );

  if (editing) {
    return (
      <RoleEditor
        role={editing}
        saving={isSavingRole}
        error={error}
        onCancel={() => {
          setEditing(null);
          setError(null);
        }}
        onSave={async (role) => {
          setError(null);
          try {
            await saveRole({ role });
            toast({ title: "Role saved" });
            setEditing(null);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Couldn't save the role.");
          }
        }}
      />
    );
  }

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <ArmadaCrest size={64} />
        <h2 className="font-mono text-2xl font-bold lowercase tracking-tight text-foreground">roles</h2>
        <p className="text-sm text-muted-foreground">
          Roles bundle permissions at a rank. Lower position = higher authority; the owner is position 0 and
          unmintable.
        </p>
      </div>

      <div className="w-full space-y-1 rounded-lg bg-secondary/40 p-1">
        {roles.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">No roles yet.</div>
        ) : (
          roles.map((r) => (
            <button
              key={r.roleId}
              type="button"
              onClick={() => setEditing(r)}
              className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-secondary/70"
            >
              <Shield className="size-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate text-sm font-medium">{r.name}</span>
              <span className="text-[11px] text-muted-foreground">pos {r.position}</span>
            </button>
          ))
        )}
      </div>

      <Button
        type="button"
        variant="secondary"
        className="w-full clip-corner-lg"
        onClick={() => {
          const lowest = roles.reduce((m, r) => Math.max(m, r.position), 1);
          setEditing({
            roleId: newRoleId(),
            name: "New role",
            position: lowest + 1,
            permissions: 0n,
            scope: { kind: "server" },
            color: 0,
          });
        }}
      >
        <Plus className="size-4 mr-2" /> Create role
      </Button>
    </div>
  );
}

function RoleEditor({
  role,
  saving,
  error,
  onSave,
  onCancel,
}: {
  role: Role;
  saving: boolean;
  error: string | null;
  onSave: (role: Role) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(role.name);
  const [perms, setPerms] = useState<bigint>(role.permissions);

  const toggle = (bit: bigint, on: boolean) => {
    setPerms((p) => (on ? p | bit : p & ~bit));
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ ...role, name: name.trim() || "Role", permissions: perms });
      }}
      className="flex flex-col gap-5"
    >
      <div className="space-y-1.5">
        <Label htmlFor="role2-name">Role name</Label>
        <Input id="role2-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus autoComplete="off" />
      </div>

      <div className="space-y-2">
        <Label>Permissions</Label>
        <div className="space-y-2 rounded-lg bg-secondary/40 p-3">
          {PERMISSION_LABELS.map(({ bit, label, hint }) => {
            const id = `perm2-${bit.toString()}`;
            const on = (perms & bit) === bit;
            return (
              <label key={id} htmlFor={id} className="flex items-start gap-3 cursor-pointer">
                <Checkbox id={id} checked={on} onCheckedChange={(c) => toggle(bit, c === true)} className="mt-0.5" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{label}</span>
                  <span className="block text-xs text-muted-foreground">{hint}</span>
                </span>
              </label>
            );
          })}
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex gap-2">
        <Button type="button" variant="ghost" className="flex-1" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" className={cn("flex-1 clip-corner-lg")} disabled={saving}>
          {saving ? <><Loader2 className="size-4 mr-2 animate-spin" /> Saving...</> : "Save role"}
        </Button>
      </div>
    </form>
  );
}
