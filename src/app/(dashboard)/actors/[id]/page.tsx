"use client";

import { useEffect, useState, useCallback, use } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface ActorDetail {
  id: string;
  actorId: string;
  displayName: string | null;
  actorType: "employee" | "service";
  currentRiskScore: number;
  firstSeen: string;
  lastSeen: string;
}

interface Baseline {
  id: string;
  computedAt: string;
  windowDays: number;
  typicalActiveHours: number[];
  knownIpAddresses: string[];
  knownUserAgents: string[];
  avgBytesPerDay: number;
  avgEventsPerDay: number;
  typicalResourceScope: number;
  normalFailureRate: number;
  eventCount: number;
}

interface RiskScoreHistory {
  id: string;
  totalScore: number;
  computedAt: string;
  ruleContributions: Array<{
    ruleId: string;
    ruleName: string;
    points: number;
    reason: string;
  }>;
}

interface RecentAlert {
  id: string;
  severity: "low" | "medium" | "high" | "critical";
  status: "open" | "acknowledged" | "resolved" | "false_positive";
  score: number;
  createdAt: string;
}

interface EventItem {
  id: string;
  occurredAt: string;
  actionType: string;
  resourceType: string | null;
  resourceId: string | null;
  outcome: "success" | "failure";
  ip: string | null;
  bytes: number | null;
  sourceName: string;
  sourceKey: string;
}

interface ActorResponse {
  actor: ActorDetail;
  baseline: Baseline | null;
  riskScoreHistory: RiskScoreHistory[];
  recentAlerts: RecentAlert[];
  events: EventItem[];
}

function getRiskVariant(score: number): "default" | "secondary" | "destructive" | "outline" {
  if (score >= 90) return "destructive";
  if (score >= 80) return "destructive";
  if (score >= 70) return "secondary";
  if (score >= 60) return "secondary";
  return "default";
}

function getRiskLabel(score: number): string {
  if (score >= 90) return "Critical";
  if (score >= 80) return "High";
  if (score >= 70) return "Medium";
  if (score >= 60) return "Low";
  return "Normal";
}

function getOutcomeVariant(outcome: string): "default" | "secondary" | "destructive" | "outline" {
  return outcome === "success" ? "default" : "destructive";
}

function getSeverityVariant(severity: string): "default" | "secondary" | "destructive" | "outline" {
  switch (severity) {
    case "critical":
    case "high":
      return "destructive";
    case "medium":
      return "secondary";
    default:
      return "default";
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function formatHours(hours: number[]): string {
  if (!hours || hours.length === 0) return "No data";
  const sorted = [...hours].sort((a, b) => a - b);
  return sorted.map((h) => `${h}:00`).join(", ");
}

export default function ActorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const actorId = decodeURIComponent(resolvedParams.id);
  
  const [data, setData] = useState<ActorResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchActor = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/actors/${encodeURIComponent(actorId)}`);
      if (response.ok) {
        const result: ActorResponse = await response.json();
        setData(result);
      } else if (response.status === 404) {
        setError("Actor not found");
      } else {
        setError("Failed to load actor data");
      }
    } catch (err) {
      console.error("Failed to fetch actor:", err);
      setError("Failed to load actor data");
    } finally {
      setLoading(false);
    }
  }, [actorId]);

  useEffect(() => {
    fetchActor();
  }, [fetchActor]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-zinc-500">Loading actor data...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        <Link href="/actors">
          <Button variant="outline" size="sm">← Back to Actors</Button>
        </Link>
        <Card>
          <CardContent className="py-8">
            <p className="text-center text-zinc-500">{error || "Actor not found"}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { actor, baseline, riskScoreHistory, recentAlerts, events } = data;
  const maxScore = Math.max(...riskScoreHistory.map((s) => s.totalScore), 100);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/actors">
            <Button variant="outline" size="sm" className="mb-2">← Back to Actors</Button>
          </Link>
          <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            {actor.displayName || actor.actorId}
          </h2>
          <p className="text-zinc-600 dark:text-zinc-400">
            {actor.actorType.charAt(0).toUpperCase() + actor.actorType.slice(1)} • 
            First seen: {new Date(actor.firstSeen).toLocaleDateString()}
          </p>
        </div>
        <div className="text-right">
          <div className="flex items-center gap-2 justify-end">
            <span className="text-3xl font-bold">{actor.currentRiskScore}</span>
            <Badge variant={getRiskVariant(actor.currentRiskScore)} className="text-sm">
              {getRiskLabel(actor.currentRiskScore)}
            </Badge>
          </div>
          <p className="text-sm text-zinc-500">
            Last seen: {new Date(actor.lastSeen).toLocaleString()}
          </p>
        </div>
      </div>

      <Tabs defaultValue="timeline" className="space-y-4">
        <TabsList>
          <TabsTrigger value="timeline">Event Timeline</TabsTrigger>
          <TabsTrigger value="risk">Risk History</TabsTrigger>
          <TabsTrigger value="baseline">Baseline</TabsTrigger>
          <TabsTrigger value="alerts">Alerts</TabsTrigger>
        </TabsList>

        <TabsContent value="timeline">
          <Card>
            <CardHeader>
              <CardTitle>Recent Events</CardTitle>
              <CardDescription>
                Last {events.length} events for this actor
              </CardDescription>
            </CardHeader>
            <CardContent>
              {events.length === 0 ? (
                <p className="text-zinc-500 text-center py-4">No events found</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Resource</TableHead>
                      <TableHead>Outcome</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>IP</TableHead>
                      <TableHead>Bytes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {events.map((event) => (
                      <TableRow key={event.id}>
                        <TableCell className="text-zinc-500 whitespace-nowrap">
                          {new Date(event.occurredAt).toLocaleString()}
                        </TableCell>
                        <TableCell className="font-medium">{event.actionType}</TableCell>
                        <TableCell className="text-zinc-500">
                          {event.resourceType && event.resourceId
                            ? `${event.resourceType}: ${event.resourceId.substring(0, 12)}...`
                            : event.resourceType || "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={getOutcomeVariant(event.outcome)}>
                            {event.outcome}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-zinc-500">{event.sourceName}</TableCell>
                        <TableCell className="text-zinc-500 font-mono text-xs">
                          {event.ip || "—"}
                        </TableCell>
                        <TableCell className="text-zinc-500">
                          {event.bytes ? formatBytes(event.bytes) : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="risk">
          <Card>
            <CardHeader>
              <CardTitle>Risk Score History</CardTitle>
              <CardDescription>
                Score trend over the last {riskScoreHistory.length} computations
              </CardDescription>
            </CardHeader>
            <CardContent>
              {riskScoreHistory.length === 0 ? (
                <p className="text-zinc-500 text-center py-4">No risk score history</p>
              ) : (
                <div className="space-y-4">
                  {/* Simple bar chart */}
                  <div className="space-y-2">
                    {riskScoreHistory.slice(0, 15).reverse().map((score) => (
                      <div key={score.id} className="flex items-center gap-3">
                        <span className="w-32 text-xs text-zinc-500 whitespace-nowrap">
                          {new Date(score.computedAt).toLocaleString()}
                        </span>
                        <div className="flex-1 h-6 bg-zinc-100 dark:bg-zinc-800 rounded overflow-hidden">
                          <div
                            className={`h-full rounded transition-all ${
                              score.totalScore >= 80
                                ? "bg-red-500"
                                : score.totalScore >= 60
                                ? "bg-yellow-500"
                                : "bg-green-500"
                            }`}
                            style={{ width: `${(score.totalScore / maxScore) * 100}%` }}
                          />
                        </div>
                        <span className="w-10 text-right text-sm font-bold">
                          {score.totalScore}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Latest score breakdown */}
                  {riskScoreHistory[0] && riskScoreHistory[0].ruleContributions && (
                    <div className="mt-6 pt-6 border-t">
                      <h4 className="font-medium mb-3">Latest Score Breakdown</h4>
                      <div className="space-y-2">
                        {(riskScoreHistory[0].ruleContributions as Array<{
                          ruleId: string;
                          ruleName: string;
                          points: number;
                          reason: string;
                        }>).map((contribution, idx) => (
                          <div
                            key={idx}
                            className="flex items-center justify-between p-2 rounded bg-zinc-50 dark:bg-zinc-800/50"
                          >
                            <div>
                              <span className="font-medium">{contribution.ruleName}</span>
                              <p className="text-xs text-zinc-500">{contribution.reason}</p>
                            </div>
                            <Badge variant={contribution.points > 0 ? "secondary" : "outline"}>
                              +{contribution.points}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="baseline">
          <Card>
            <CardHeader>
              <CardTitle>Current Baseline</CardTitle>
              <CardDescription>
                {baseline
                  ? `Computed on ${new Date(baseline.computedAt).toLocaleString()} (${baseline.windowDays}-day window)`
                  : "No baseline computed yet"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!baseline ? (
                <p className="text-zinc-500 text-center py-4">
                  No baseline data available. Baselines are computed after sufficient event history.
                </p>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-4">
                    <div className="p-4 rounded-lg border">
                      <h4 className="text-sm font-medium text-zinc-500 mb-1">Typical Active Hours</h4>
                      <p className="font-medium">
                        {formatHours(baseline.typicalActiveHours as number[])}
                      </p>
                    </div>
                    <div className="p-4 rounded-lg border">
                      <h4 className="text-sm font-medium text-zinc-500 mb-1">Average Events/Day</h4>
                      <p className="text-2xl font-bold">{baseline.avgEventsPerDay.toFixed(1)}</p>
                    </div>
                    <div className="p-4 rounded-lg border">
                      <h4 className="text-sm font-medium text-zinc-500 mb-1">Average Bytes/Day</h4>
                      <p className="text-2xl font-bold">{formatBytes(baseline.avgBytesPerDay)}</p>
                    </div>
                    <div className="p-4 rounded-lg border">
                      <h4 className="text-sm font-medium text-zinc-500 mb-1">Typical Resource Scope</h4>
                      <p className="text-2xl font-bold">{baseline.typicalResourceScope} resources</p>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div className="p-4 rounded-lg border">
                      <h4 className="text-sm font-medium text-zinc-500 mb-1">Normal Failure Rate</h4>
                      <p className="text-2xl font-bold">
                        {(baseline.normalFailureRate * 100).toFixed(1)}%
                      </p>
                    </div>
                    <div className="p-4 rounded-lg border">
                      <h4 className="text-sm font-medium text-zinc-500 mb-1">Events in Baseline</h4>
                      <p className="text-2xl font-bold">{baseline.eventCount}</p>
                    </div>
                    <div className="p-4 rounded-lg border">
                      <h4 className="text-sm font-medium text-zinc-500 mb-1">Known IP Addresses</h4>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {(baseline.knownIpAddresses as string[]).length === 0 ? (
                          <span className="text-zinc-400">None</span>
                        ) : (
                          (baseline.knownIpAddresses as string[]).slice(0, 5).map((ip, idx) => (
                            <Badge key={idx} variant="outline" className="font-mono text-xs">
                              {ip}
                            </Badge>
                          ))
                        )}
                        {(baseline.knownIpAddresses as string[]).length > 5 && (
                          <Badge variant="outline">
                            +{(baseline.knownIpAddresses as string[]).length - 5} more
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="p-4 rounded-lg border">
                      <h4 className="text-sm font-medium text-zinc-500 mb-1">Known User Agents</h4>
                      <p className="text-sm">
                        {(baseline.knownUserAgents as string[]).length} unique agent(s)
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="alerts">
          <Card>
            <CardHeader>
              <CardTitle>Recent Alerts</CardTitle>
              <CardDescription>
                Alerts generated for this actor
              </CardDescription>
            </CardHeader>
            <CardContent>
              {recentAlerts.length === 0 ? (
                <p className="text-zinc-500 text-center py-4">No alerts for this actor</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Created</TableHead>
                      <TableHead>Score</TableHead>
                      <TableHead>Severity</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentAlerts.map((alert) => (
                      <TableRow key={alert.id}>
                        <TableCell className="text-zinc-500">
                          {new Date(alert.createdAt).toLocaleString()}
                        </TableCell>
                        <TableCell className="font-bold">{alert.score}</TableCell>
                        <TableCell>
                          <Badge variant={getSeverityVariant(alert.severity)}>
                            {alert.severity.charAt(0).toUpperCase() + alert.severity.slice(1)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {alert.status.replace("_", " ")}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Link href={`/alerts/${alert.id}`}>
                            <Button variant="outline" size="sm">View →</Button>
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
