"use client";

import { useEffect, useState } from "react";
import { UserMenu } from "./user-menu";
import { Badge } from "@/components/ui/badge";

export function Header() {
  const [status, setStatus] = useState<{ alertsToday: number; eventsToday: number } | null>(null);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        // Get today's date range
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        
        const [alertsRes, eventsRes] = await Promise.all([
          fetch(`/api/alerts?dateFrom=${startOfToday.split('T')[0]}&pageSize=1`),
          fetch(`/api/actors?pageSize=1`), // Just to check connectivity
        ]);
        
        if (alertsRes.ok) {
          const alertsData = await alertsRes.json();
          setStatus({
            alertsToday: alertsData.total || 0,
            eventsToday: 0,
          });
        }
      } catch (error) {
        console.error("Failed to fetch status:", error);
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="flex h-16 items-center justify-between border-b bg-white px-6 dark:bg-zinc-950">
      <div className="flex items-center gap-4">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          Insider Risk Monitor
        </h1>
        {status && (
          <div className="flex items-center gap-2">
            <Badge variant={status.alertsToday > 0 ? "destructive" : "secondary"}>
              {status.alertsToday} alert{status.alertsToday !== 1 ? "s" : ""} today
            </Badge>
          </div>
        )}
      </div>
      <UserMenu />
    </header>
  );
}
