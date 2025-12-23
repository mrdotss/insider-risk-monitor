import { prisma } from "@/lib/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";

// Force dynamic rendering to avoid database access during build
export const dynamic = 'force-dynamic';

async function getOverviewData() {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sevenDaysAgo = new Date(startOfToday);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  // Get alerts count today
  const alertsToday = await prisma.alert.count({
    where: {
      createdAt: {
        gte: startOfToday,
      },
    },
  });

  // Get high-risk actors (score > 60)
  const highRiskActors = await prisma.actor.findMany({
    where: {
      currentRiskScore: {
        gt: 60,
      },
    },
    orderBy: {
      currentRiskScore: "desc",
    },
    take: 10,
  });

  // Get events count today
  const eventsToday = await prisma.event.count({
    where: {
      ingestedAt: {
        gte: startOfToday,
      },
    },
  });

  // Get active sources count
  const activeSources = await prisma.source.count({
    where: {
      enabled: true,
    },
  });

  // Get open alerts count
  const openAlerts = await prisma.alert.count({
    where: {
      status: "open",
    },
  });

  // Get alerts per day for the last 7 days
  const alertTrend = await getAlertTrend(sevenDaysAgo);

  return {
    alertsToday,
    highRiskActors,
    eventsToday,
    activeSources,
    openAlerts,
    alertTrend,
  };
}

async function getAlertTrend(startDate: Date) {
  const alerts = await prisma.alert.findMany({
    where: {
      createdAt: {
        gte: startDate,
      },
    },
    select: {
      createdAt: true,
    },
  });

  // Group alerts by day
  const trend: { date: string; count: number }[] = [];
  const now = new Date();
  
  for (let i = 6; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split("T")[0];
    
    const count = alerts.filter((alert) => {
      const alertDate = alert.createdAt.toISOString().split("T")[0];
      return alertDate === dateStr;
    }).length;
    
    trend.push({ date: dateStr, count });
  }

  return trend;
}

function getSeverityColor(score: number): "default" | "secondary" | "destructive" | "outline" {
  if (score >= 90) return "destructive";
  if (score >= 80) return "destructive";
  if (score >= 70) return "secondary";
  return "default";
}

function getSeverityLabel(score: number): string {
  if (score >= 90) return "Critical";
  if (score >= 80) return "High";
  if (score >= 70) return "Medium";
  return "Low";
}

export default async function OverviewPage() {
  const data = await getOverviewData();
  const maxAlertCount = Math.max(...data.alertTrend.map((d) => d.count), 1);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            Overview
          </h2>
          <p className="text-zinc-600 dark:text-zinc-400">
            Security risk monitoring dashboard
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/alerts?status=open">
            <Button variant={data.openAlerts > 0 ? "destructive" : "outline"}>
              {data.openAlerts > 0 ? `${data.openAlerts} Open Alerts` : "No Open Alerts"}
            </Button>
          </Link>
          <Link href="/sources">
            <Button variant="outline">Manage Sources</Button>
          </Link>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Alerts Today</CardDescription>
            <CardTitle className="text-3xl">{data.alertsToday}</CardTitle>
          </CardHeader>
          <CardContent>
            <Link 
              href="/alerts" 
              className="text-xs text-primary hover:underline"
            >
              View all alerts →
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>High Risk Actors</CardDescription>
            <CardTitle className="text-3xl">{data.highRiskActors.length}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-zinc-500">Score &gt; 60</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Events Today</CardDescription>
            <CardTitle className="text-3xl">{data.eventsToday}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-zinc-500">Ingested events</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Active Sources</CardDescription>
            <CardTitle className="text-3xl">{data.activeSources}</CardTitle>
          </CardHeader>
          <CardContent>
            <Link 
              href="/sources" 
              className="text-xs text-primary hover:underline"
            >
              Manage sources →
            </Link>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div>
              <CardTitle>High Risk Actors</CardTitle>
              <CardDescription>
                Actors with risk scores above threshold
              </CardDescription>
            </div>
            <Link href="/actors?sortBy=currentRiskScore&sortOrder=desc">
              <Button variant="outline" size="sm">View All →</Button>
            </Link>
          </CardHeader>
          <CardContent>
            {data.highRiskActors.length === 0 ? (
              <p className="text-sm text-zinc-500">No high-risk actors detected</p>
            ) : (
              <div className="space-y-3">
                {data.highRiskActors.map((actor) => (
                  <Link
                    key={actor.id}
                    href={`/actors/${actor.actorId}`}
                    className="flex items-center justify-between rounded-lg border p-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
                  >
                    <div>
                      <p className="font-medium text-zinc-900 dark:text-zinc-50">
                        {actor.displayName || actor.actorId}
                      </p>
                      <p className="text-xs text-zinc-500">
                        Last seen: {actor.lastSeen.toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-bold text-zinc-900 dark:text-zinc-50">
                        {actor.currentRiskScore}
                      </span>
                      <Badge variant={getSeverityColor(actor.currentRiskScore)}>
                        {getSeverityLabel(actor.currentRiskScore)}
                      </Badge>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Alert Trend</CardTitle>
            <CardDescription>
              Alerts over the last 7 days
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.alertTrend.every((d) => d.count === 0) ? (
              <p className="text-sm text-zinc-500">No alert data available</p>
            ) : (
              <div className="space-y-2">
                {data.alertTrend.map((day) => (
                  <div key={day.date} className="flex items-center gap-3">
                    <span className="w-20 text-xs text-zinc-500">
                      {new Date(day.date).toLocaleDateString("en-US", {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                    <div className="flex-1 h-4 bg-zinc-100 dark:bg-zinc-800 rounded overflow-hidden">
                      <div
                        className="h-full bg-primary rounded transition-all"
                        style={{
                          width: `${(day.count / maxAlertCount) * 100}%`,
                        }}
                      />
                    </div>
                    <span className="w-8 text-right text-sm font-medium text-zinc-900 dark:text-zinc-50">
                      {day.count}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
