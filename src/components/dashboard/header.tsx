"use client";

import { UserMenu } from "./user-menu";

export function Header() {
  return (
    <header className="flex h-16 items-center justify-between border-b bg-white px-6 dark:bg-zinc-950">
      <div className="flex items-center gap-4">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          Insider Risk Monitor
        </h1>
      </div>
      <UserMenu />
    </header>
  );
}
