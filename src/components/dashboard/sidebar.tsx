"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  AlertTriangle,
  Users,
  Settings,
  Database,
  FileText,
} from "lucide-react";

const navigation = [
  { name: "Overview", href: "/", icon: LayoutDashboard },
  { name: "Alerts", href: "/alerts", icon: AlertTriangle, showBadge: true },
  { name: "Actors", href: "/actors", icon: Users },
  { name: "Rules", href: "/rules", icon: Settings },
  { name: "Sources", href: "/sources", icon: Database },
  { name: "Audit", href: "/audit", icon: FileText },
];

export function Sidebar() {
  const pathname = usePathname();
  const [openAlertCount, setOpenAlertCount] = useState(0);

  useEffect(() => {
    // Fetch open alert count
    const fetchAlertCount = async () => {
      try {
        const response = await fetch("/api/alerts?status=open&pageSize=1");
        if (response.ok) {
          const data = await response.json();
          setOpenAlertCount(data.total || 0);
        }
      } catch (error) {
        console.error("Failed to fetch alert count:", error);
      }
    };

    fetchAlertCount();
    // Refresh every 30 seconds
    const interval = setInterval(fetchAlertCount, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <aside className="flex h-full w-64 flex-col border-r bg-white dark:bg-zinc-950">
      <div className="flex h-16 items-center border-b px-6">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <span className="font-semibold text-zinc-900 dark:text-zinc-50">
            Risk Monitor
          </span>
        </Link>
      </div>
      <nav className="flex-1 space-y-1 p-4">
        {navigation.map((item) => {
          const isActive = pathname === item.href || 
            (item.href !== "/" && pathname.startsWith(item.href));
          
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
                  : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/50 dark:hover:text-zinc-50"
              )}
            >
              <div className="flex items-center gap-3">
                <item.icon className="h-5 w-5" />
                {item.name}
              </div>
              {item.showBadge && openAlertCount > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-xs font-medium text-white">
                  {openAlertCount > 99 ? "99+" : openAlertCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
