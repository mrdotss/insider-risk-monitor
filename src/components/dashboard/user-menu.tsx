"use client";

import { signOut, useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { LogOut, User } from "lucide-react";

export function UserMenu() {
  const { data: session } = useSession();

  const handleSignOut = async () => {
    await signOut({ callbackUrl: "/login" });
  };

  return (
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-2 text-sm">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800">
          <User className="h-4 w-4 text-zinc-600 dark:text-zinc-400" />
        </div>
        <div className="hidden sm:block">
          <p className="font-medium text-zinc-900 dark:text-zinc-50">
            {session?.user?.name || session?.user?.email || "User"}
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {session?.user?.role || "admin"}
          </p>
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleSignOut}
        className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
      >
        <LogOut className="h-4 w-4" />
        <span className="hidden sm:inline ml-2">Logout</span>
      </Button>
    </div>
  );
}
