"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface AuditLogEntry {
  id: string;
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  beforeValue: Record<string, unknown> | null;
  afterValue: Record<string, unknown> | null;
  createdAt: string;
  user: {
    email: string;
    name: string | null;
  };
}

interface AuditLogsResponse {
  auditLogs: AuditLogEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const ACTION_LABELS: Record<string, string> = {
  rule_updated: "Rule Updated",
  source_created: "Source Created",
  source_updated: "Source Updated",
  source_api_key_rotated: "API Key Rotated",
};

const ENTITY_TYPE_LABELS: Record<string, string> = {
  ScoringRule: "Scoring Rule",
  Source: "Source",
};

function getActionVariant(action: string): "default" | "secondary" | "destructive" | "outline" {
  if (action.includes("created")) return "default";
  if (action.includes("updated")) return "secondary";
  if (action.includes("rotated")) return "destructive";
  return "outline";
}

function AuditPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [selectedLog, setSelectedLog] = useState<AuditLogEntry | null>(null);

  // Filter state from URL params
  const page = parseInt(searchParams.get("page") || "1");
  const action = searchParams.get("action") || "all";
  const entityType = searchParams.get("entityType") || "all";
  const dateFrom = searchParams.get("dateFrom") || "";
  const dateTo = searchParams.get("dateTo") || "";

  const fetchAuditLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", page.toString());
      params.set("pageSize", "20");
      if (action !== "all") params.set("action", action);
      if (entityType !== "all") params.set("entityType", entityType);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);

      const response = await fetch(`/api/audit?${params.toString()}`);
      if (response.ok) {
        const data: AuditLogsResponse = await response.json();
        setAuditLogs(data.auditLogs);
        setTotal(data.total);
        setTotalPages(data.totalPages);
      }
    } catch (error) {
      console.error("Failed to fetch audit logs:", error);
    } finally {
      setLoading(false);
    }
  }, [page, action, entityType, dateFrom, dateTo]);

  useEffect(() => {
    fetchAuditLogs();
  }, [fetchAuditLogs]);

  const updateFilters = (updates: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([key, value]) => {
      if (value && value !== "all") {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    });
    if (!("page" in updates)) {
      params.set("page", "1");
    }
    router.push(`/audit?${params.toString()}`);
  };


  const formatChanges = (before: Record<string, unknown> | null, after: Record<string, unknown> | null): string => {
    if (!before && !after) return "No changes recorded";
    
    const changes: string[] = [];
    const allKeys = new Set([
      ...Object.keys(before || {}),
      ...Object.keys(after || {}),
    ]);

    for (const key of allKeys) {
      const beforeVal = before?.[key];
      const afterVal = after?.[key];
      
      if (JSON.stringify(beforeVal) !== JSON.stringify(afterVal)) {
        if (beforeVal === undefined) {
          changes.push(`${key}: → ${JSON.stringify(afterVal)}`);
        } else if (afterVal === undefined) {
          changes.push(`${key}: ${JSON.stringify(beforeVal)} → (removed)`);
        } else {
          changes.push(`${key}: ${JSON.stringify(beforeVal)} → ${JSON.stringify(afterVal)}`);
        }
      }
    }

    return changes.length > 0 ? changes.join(", ") : "No changes";
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Audit Log</h2>
        <p className="text-zinc-600 dark:text-zinc-400">
          Track configuration changes made by administrators
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>Filter audit log entries</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Action
              </label>
              <Select value={action} onValueChange={(v) => updateFilters({ action: v })}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="All Actions" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Actions</SelectItem>
                  <SelectItem value="rule_updated">Rule Updated</SelectItem>
                  <SelectItem value="source_created">Source Created</SelectItem>
                  <SelectItem value="source_updated">Source Updated</SelectItem>
                  <SelectItem value="source_api_key_rotated">API Key Rotated</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Entity Type
              </label>
              <Select value={entityType} onValueChange={(v) => updateFilters({ entityType: v })}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="All Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="ScoringRule">Scoring Rule</SelectItem>
                  <SelectItem value="Source">Source</SelectItem>
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
                onClick={() => router.push("/audit")}
              >
                Clear Filters
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>


      <Card>
        <CardHeader>
          <CardTitle>Audit Entries</CardTitle>
          <CardDescription>
            {total} entr{total !== 1 ? "ies" : "y"} found
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <p className="text-zinc-500">Loading audit logs...</p>
            </div>
          ) : auditLogs.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <p className="text-zinc-500">No audit log entries found</p>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead>Changes</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {auditLogs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="text-zinc-500 whitespace-nowrap">
                        {new Date(log.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium">{log.user.name || log.user.email}</p>
                          {log.user.name && (
                            <p className="text-sm text-zinc-500">{log.user.email}</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={getActionVariant(log.action)}>
                          {ACTION_LABELS[log.action] || log.action}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium">
                            {ENTITY_TYPE_LABELS[log.entityType] || log.entityType}
                          </p>
                          <p className="text-sm text-zinc-500 font-mono">
                            {log.entityId.slice(0, 8)}...
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[300px]">
                        <p className="text-sm text-zinc-600 dark:text-zinc-400 truncate">
                          {formatChanges(log.beforeValue, log.afterValue)}
                        </p>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedLog(log)}
                        >
                          Details
                        </Button>
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


      {/* Detail Dialog */}
      <Dialog open={!!selectedLog} onOpenChange={() => setSelectedLog(null)}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Audit Log Details</DialogTitle>
            <DialogDescription>
              Full details of the configuration change
            </DialogDescription>
          </DialogHeader>
          
          {selectedLog && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm font-medium text-zinc-500">Timestamp</p>
                  <p>{new Date(selectedLog.createdAt).toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-zinc-500">User</p>
                  <p>{selectedLog.user.name || selectedLog.user.email}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-zinc-500">Action</p>
                  <Badge variant={getActionVariant(selectedLog.action)}>
                    {ACTION_LABELS[selectedLog.action] || selectedLog.action}
                  </Badge>
                </div>
                <div>
                  <p className="text-sm font-medium text-zinc-500">Entity</p>
                  <p>{ENTITY_TYPE_LABELS[selectedLog.entityType] || selectedLog.entityType}</p>
                </div>
              </div>

              <div>
                <p className="text-sm font-medium text-zinc-500 mb-1">Entity ID</p>
                <code className="block rounded bg-zinc-100 p-2 text-sm dark:bg-zinc-800">
                  {selectedLog.entityId}
                </code>
              </div>

              {selectedLog.beforeValue && (
                <div>
                  <p className="text-sm font-medium text-zinc-500 mb-1">Before</p>
                  <pre className="rounded bg-zinc-100 p-3 text-sm overflow-auto max-h-40 dark:bg-zinc-800">
                    {JSON.stringify(selectedLog.beforeValue, null, 2)}
                  </pre>
                </div>
              )}

              {selectedLog.afterValue && (
                <div>
                  <p className="text-sm font-medium text-zinc-500 mb-1">After</p>
                  <pre className="rounded bg-zinc-100 p-3 text-sm overflow-auto max-h-40 dark:bg-zinc-800">
                    {JSON.stringify(selectedLog.afterValue, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function AuditPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-8"><p className="text-zinc-500">Loading...</p></div>}>
      <AuditPageContent />
    </Suspense>
  );
}
