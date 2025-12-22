"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
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

interface RuleContribution {
  ruleId: string;
  ruleName: string;
  points: number;
  reason: string;
  currentValue: number | string;
  baselineValue: number | string;
}

interface BaselineComparison {
  typicalHours: string;
  currentHours: string;
  avgBytes: number;
  currentBytes: number;
  normalScope: number;
  currentScope: number;
  normalFailureRate: number;
  currentFailureRate: number;
}

interface TriggeringEvent {
  id: string;
  occurredAt: string;
  actionType: string;
  resourceType: string | null;
  outcome: string;
  ip: string | null;
  sourceName: string;
}

interface AlertDetail {
  id: string;
  actorId: string;
  actorDisplayName: string | null;
  score: number;
  severity: "low" | "medium" | "high" | "critical";
  status: "open" | "acknowledged" | "resolved" | "false_positive";
  ruleContributions: RuleContribution[];
  baselineComparison: BaselineComparison;
  triggeringEvents: TriggeringEvent[];
  createdAt: string;
  updatedAt: string;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
}

function getSeverityVariant(severity: string): "default" | "secondary" | "destructive" | "outline" {
  switch (severity) {
    case "critical":
      return "destructive";
    case "high":
      return "destructive";
    case "medium":
      return "secondary";
    default:
      return "default";
  }
}

function getStatusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "open":
      return "destructive";
    case "acknowledged":
      return "secondary";
    case "resolved":
      return "default";
    case "false_positive":
      return "outline";
    default:
      return "default";
  }
}

function formatStatus(status: string): string {
  return status.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function formatPercentage(value: number): string {
  return (value * 100).toFixed(1) + "%";
}

export default function AlertDetailPage() {
  const params = useParams();
  const router = useRouter();
  const alertId = params.id as string;

  const [alert, setAlert] = useState<AlertDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAlert = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/alerts/${alertId}`);
      if (response.ok) {
        const data = await response.json();
        setAlert(data);
      } else if (response.status === 404) {
        setError("Alert not found");
      } else {
        setError("Failed to load alert");
      }
    } catch (err) {
      console.error("Failed to fetch alert:", err);
      setError("Failed to load alert");
    } finally {
      setLoading(false);
    }
  }, [alertId]);

  useEffect(() => {
    fetchAlert();
  }, [fetchAlert]);

  const updateStatus = async (newStatus: string) => {
    setUpdating(true);
    try {
      const response = await fetch(`/api/alerts/${alertId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (response.ok) {
        await fetchAlert();
      } else {
        console.error("Failed to update status");
      }
    } catch (err) {
      console.error("Failed to update status:", err);
    } finally {
      setUpdating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-zinc-500">Loading alert...</p>
      </div>
    );
  }

  if (error || !alert) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-center py-16">
          <p className="text-zinc-500">{error || "Alert not found"}</p>
        </div>
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => router.push("/alerts")}>
            ← Back to Alerts
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link href="/alerts" className="text-sm text-zinc-500 hover:text-zinc-700">
              Alerts
            </Link>
            <span className="text-zinc-400">/</span>
            <span className="text-sm text-zinc-700 dark:text-zinc-300">
              {alert.id.slice(0, 8)}...
            </span>
          </div>
          <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            Alert Detail
          </h2>
        </div>
        <div className="flex gap-2">
          {alert.status === "open" && (
            <Button
              variant="secondary"
              onClick={() => updateStatus("acknowledged")}
              disabled={updating}
            >
              Acknowledge
            </Button>
          )}
          {(alert.status === "open" || alert.status === "acknowledged") && (
            <>
              <Button
                variant="default"
                onClick={() => updateStatus("resolved")}
                disabled={updating}
              >
                Resolve
              </Button>
              <Button
                variant="outline"
                onClick={() => updateStatus("false_positive")}
                disabled={updating}
              >
                Mark False Positive
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Alert Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-zinc-500">Actor</p>
              <Link
                href={`/actors/${alert.actorId}`}
                className="font-medium text-primary hover:underline"
              >
                {alert.actorDisplayName || alert.actorId}
              </Link>
            </div>
            <div>
              <p className="text-sm text-zinc-500">Risk Score</p>
              <p className="text-2xl font-bold">{alert.score}</p>
            </div>
            <div>
              <p className="text-sm text-zinc-500">Severity</p>
              <Badge variant={getSeverityVariant(alert.severity)} className="mt-1">
                {alert.severity.charAt(0).toUpperCase() + alert.severity.slice(1)}
              </Badge>
            </div>
            <div>
              <p className="text-sm text-zinc-500">Status</p>
              <Badge variant={getStatusVariant(alert.status)} className="mt-1">
                {formatStatus(alert.status)}
              </Badge>
            </div>
            <div>
              <p className="text-sm text-zinc-500">Created</p>
              <p className="font-medium">{new Date(alert.createdAt).toLocaleString()}</p>
            </div>
            <div>
              <p className="text-sm text-zinc-500">Last Updated</p>
              <p className="font-medium">{new Date(alert.updatedAt).toLocaleString()}</p>
            </div>
            {alert.acknowledgedBy && (
              <div>
                <p className="text-sm text-zinc-500">Acknowledged By</p>
                <p className="font-medium">{alert.acknowledgedBy}</p>
                {alert.acknowledgedAt && (
                  <p className="text-xs text-zinc-400">
                    {new Date(alert.acknowledgedAt).toLocaleString()}
                  </p>
                )}
              </div>
            )}
            {alert.resolvedBy && (
              <div>
                <p className="text-sm text-zinc-500">Resolved By</p>
                <p className="font-medium">{alert.resolvedBy}</p>
                {alert.resolvedAt && (
                  <p className="text-xs text-zinc-400">
                    {new Date(alert.resolvedAt).toLocaleString()}
                  </p>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Score Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Score Breakdown</CardTitle>
          <CardDescription>Rule contributions to the risk score</CardDescription>
        </CardHeader>
        <CardContent>
          {alert.ruleContributions.length === 0 ? (
            <p className="text-zinc-500">No rule contributions</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rule</TableHead>
                  <TableHead>Points</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Current Value</TableHead>
                  <TableHead>Baseline Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {alert.ruleContributions.map((contribution, index) => (
                  <TableRow key={index}>
                    <TableCell className="font-medium">{contribution.ruleName}</TableCell>
                    <TableCell>
                      <Badge variant={contribution.points > 0 ? "destructive" : "default"}>
                        +{contribution.points}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-zinc-600 dark:text-zinc-400">
                      {contribution.reason}
                    </TableCell>
                    <TableCell>{String(contribution.currentValue)}</TableCell>
                    <TableCell>{String(contribution.baselineValue)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-zinc-50 dark:bg-zinc-800/50">
                  <TableCell className="font-bold">Total</TableCell>
                  <TableCell>
                    <Badge variant="destructive">
                      {alert.ruleContributions.reduce((sum, c) => sum + c.points, 0)}
                    </Badge>
                  </TableCell>
                  <TableCell colSpan={3}></TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Baseline Comparison */}
      <Card>
        <CardHeader>
          <CardTitle>Baseline Comparison</CardTitle>
          <CardDescription>Current behavior vs. established baseline</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Metric</TableHead>
                <TableHead>Baseline</TableHead>
                <TableHead>Current</TableHead>
                <TableHead>Deviation</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium">Active Hours</TableCell>
                <TableCell>{alert.baselineComparison.typicalHours || "—"}</TableCell>
                <TableCell>{alert.baselineComparison.currentHours || "—"}</TableCell>
                <TableCell>
                  {alert.baselineComparison.typicalHours !== alert.baselineComparison.currentHours ? (
                    <Badge variant="secondary">Different</Badge>
                  ) : (
                    <Badge variant="outline">Normal</Badge>
                  )}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Bytes Transferred</TableCell>
                <TableCell>{formatBytes(alert.baselineComparison.avgBytes)}</TableCell>
                <TableCell>{formatBytes(alert.baselineComparison.currentBytes)}</TableCell>
                <TableCell>
                  {alert.baselineComparison.currentBytes > alert.baselineComparison.avgBytes * 2 ? (
                    <Badge variant="destructive">High</Badge>
                  ) : alert.baselineComparison.currentBytes > alert.baselineComparison.avgBytes * 1.5 ? (
                    <Badge variant="secondary">Elevated</Badge>
                  ) : (
                    <Badge variant="outline">Normal</Badge>
                  )}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Resource Scope</TableCell>
                <TableCell>{alert.baselineComparison.normalScope} resources</TableCell>
                <TableCell>{alert.baselineComparison.currentScope} resources</TableCell>
                <TableCell>
                  {alert.baselineComparison.currentScope > alert.baselineComparison.normalScope * 2 ? (
                    <Badge variant="destructive">Expanded</Badge>
                  ) : alert.baselineComparison.currentScope > alert.baselineComparison.normalScope * 1.5 ? (
                    <Badge variant="secondary">Elevated</Badge>
                  ) : (
                    <Badge variant="outline">Normal</Badge>
                  )}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Failure Rate</TableCell>
                <TableCell>{formatPercentage(alert.baselineComparison.normalFailureRate)}</TableCell>
                <TableCell>{formatPercentage(alert.baselineComparison.currentFailureRate)}</TableCell>
                <TableCell>
                  {alert.baselineComparison.currentFailureRate > alert.baselineComparison.normalFailureRate * 2 ? (
                    <Badge variant="destructive">High</Badge>
                  ) : alert.baselineComparison.currentFailureRate > alert.baselineComparison.normalFailureRate * 1.5 ? (
                    <Badge variant="secondary">Elevated</Badge>
                  ) : (
                    <Badge variant="outline">Normal</Badge>
                  )}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Triggering Events */}
      <Card>
        <CardHeader>
          <CardTitle>Triggering Events</CardTitle>
          <CardDescription>Events that contributed to this alert</CardDescription>
        </CardHeader>
        <CardContent>
          {alert.triggeringEvents.length === 0 ? (
            <p className="text-zinc-500">No triggering events found</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Resource Type</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead>IP Address</TableHead>
                  <TableHead>Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {alert.triggeringEvents.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell className="text-zinc-500">
                      {new Date(event.occurredAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="font-medium">{event.actionType}</TableCell>
                    <TableCell>{event.resourceType || "—"}</TableCell>
                    <TableCell>
                      <Badge variant={event.outcome === "success" ? "default" : "destructive"}>
                        {event.outcome}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-sm">{event.ip || "—"}</TableCell>
                    <TableCell>{event.sourceName}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
