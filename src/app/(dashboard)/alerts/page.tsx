"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface AlertListItem {
  id: string;
  actorId: string;
  actorDisplayName: string | null;
  score: number;
  severity: "low" | "medium" | "high" | "critical";
  status: "open" | "acknowledged" | "resolved" | "false_positive";
  createdAt: string;
  sourceName: string | null;
}

interface AlertsResponse {
  alerts: AlertListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface Source {
  id: string;
  key: string;
  name: string;
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

function AlertsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [alerts, setAlerts] = useState<AlertListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [sources, setSources] = useState<Source[]>([]);

  // Filter state from URL params
  const page = parseInt(searchParams.get("page") || "1");
  const severity = searchParams.get("severity") || "all";
  const status = searchParams.get("status") || "all";
  const sourceId = searchParams.get("source") || "all";
  const dateFrom = searchParams.get("dateFrom") || "";
  const dateTo = searchParams.get("dateTo") || "";

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", page.toString());
      params.set("pageSize", "10");
      if (severity !== "all") params.set("severity", severity);
      if (status !== "all") params.set("status", status);
      if (sourceId !== "all") params.set("source", sourceId);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);

      const response = await fetch(`/api/alerts?${params.toString()}`);
      if (response.ok) {
        const data: AlertsResponse = await response.json();
        setAlerts(data.alerts);
        setTotal(data.total);
        setTotalPages(data.totalPages);
      }
    } catch (error) {
      console.error("Failed to fetch alerts:", error);
    } finally {
      setLoading(false);
    }
  }, [page, severity, status, sourceId, dateFrom, dateTo]);

  const fetchSources = useCallback(async () => {
    try {
      const response = await fetch("/api/sources");
      if (response.ok) {
        const data = await response.json();
        setSources(data.sources || []);
      }
    } catch (error) {
      console.error("Failed to fetch sources:", error);
    }
  }, []);

  useEffect(() => {
    fetchAlerts();
    fetchSources();
  }, [fetchAlerts, fetchSources]);

  const updateFilters = (updates: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([key, value]) => {
      if (value && value !== "all") {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    });
    // Reset to page 1 when filters change (except for page changes)
    if (!("page" in updates)) {
      params.set("page", "1");
    }
    router.push(`/alerts?${params.toString()}`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Alerts</h2>
          <p className="text-zinc-600 dark:text-zinc-400">
            Browse and filter security alerts
          </p>
        </div>
        <Button 
          variant="outline" 
          onClick={() => fetchAlerts()}
          disabled={loading}
        >
          {loading ? "Refreshing..." : "Refresh"}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>Filter alerts by severity, status, source, or date range</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Severity
              </label>
              <Select value={severity} onValueChange={(v) => updateFilters({ severity: v })}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Status
              </label>
              <Select value={status} onValueChange={(v) => updateFilters({ status: v })}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="acknowledged">Acknowledged</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="false_positive">False Positive</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Source
              </label>
              <Select value={sourceId} onValueChange={(v) => updateFilters({ source: v })}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sources</SelectItem>
                  {sources.map((source) => (
                    <SelectItem key={source.id} value={source.id}>
                      {source.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                From Date
              </label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => updateFilters({ dateFrom: e.target.value })}
                className="w-[160px]"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                To Date
              </label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => updateFilters({ dateTo: e.target.value })}
                className="w-[160px]"
              />
            </div>

            <div className="flex items-end">
              <Button
                variant="outline"
                onClick={() => router.push("/alerts")}
              >
                Clear Filters
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Alert List</CardTitle>
          <CardDescription>
            {total} alert{total !== 1 ? "s" : ""} found
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <p className="text-zinc-500">Loading alerts...</p>
            </div>
          ) : alerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <div className="rounded-full bg-zinc-100 p-4 dark:bg-zinc-800">
                <svg className="h-8 w-8 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="text-center">
                <p className="text-zinc-900 dark:text-zinc-50 font-medium">No alerts found</p>
                <p className="text-sm text-zinc-500 mt-1">
                  {severity !== "all" || status !== "all" || sourceId !== "all" || dateFrom || dateTo
                    ? "Try adjusting your filters to see more results"
                    : "Great news! There are no security alerts at this time"}
                </p>
              </div>
              {(severity !== "all" || status !== "all" || sourceId !== "all" || dateFrom || dateTo) && (
                <Button variant="outline" onClick={() => router.push("/alerts")}>
                  Clear All Filters
                </Button>
              )}
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Actor</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {alerts.map((alert) => (
                    <TableRow key={alert.id}>
                      <TableCell className="font-medium">
                        {alert.actorDisplayName || alert.actorId}
                      </TableCell>
                      <TableCell>
                        <span className="font-bold">{alert.score}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={getSeverityVariant(alert.severity)}>
                          {alert.severity.charAt(0).toUpperCase() + alert.severity.slice(1)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={getStatusVariant(alert.status)}>
                          {formatStatus(alert.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-zinc-500">
                        {alert.sourceName || "—"}
                      </TableCell>
                      <TableCell className="text-zinc-500">
                        {new Date(alert.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Link href={`/alerts/${alert.id}`}>
                          <Button variant="outline" size="sm">
                            View →
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Pagination */}
              <div className="flex items-center justify-between mt-4">
                <p className="text-sm text-zinc-500">
                  Page {page} of {totalPages}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => updateFilters({ page: (page - 1).toString() })}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => updateFilters({ page: (page + 1).toString() })}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function AlertsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-8"><p className="text-zinc-500">Loading...</p></div>}>
      <AlertsPageContent />
    </Suspense>
  );
}
