import { useState } from "react";

import LoginDialog from "@/components/auth/LoginDialog";
import SignupDialog from "@/components/auth/SignupDialog";
import { Button } from "@/components/ui/button";

/**
 * The canonical logged-out call to action: a single "Join" button that opens
 * the login dialog (with its sign-up escape hatch) — the same pattern as the
 * channel sidebar and welcome page. Render it anywhere a signed-out user
 * needs an account; never show a raw Log in / Sign up pair.
 */
export function JoinButton({
  className,
  size,
  children = "Join",
}: {
  className?: string;
  size?: "default" | "sm" | "lg";
  children?: React.ReactNode;
}) {
  const [joinOpen, setJoinOpen] = useState(false);
  const [signupOpen, setSignupOpen] = useState(false);

  return (
    <>
      <Button size={size} className={className} onClick={() => setJoinOpen(true)}>
        {children}
      </Button>
      <LoginDialog
        isOpen={joinOpen}
        onClose={() => setJoinOpen(false)}
        onLogin={() => setJoinOpen(false)}
        onSignupClick={() => {
          setJoinOpen(false);
          setSignupOpen(true);
        }}
      />
      <SignupDialog isOpen={signupOpen} onClose={() => setSignupOpen(false)} />
    </>
  );
}
