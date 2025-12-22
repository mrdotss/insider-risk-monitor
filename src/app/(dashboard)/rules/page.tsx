"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface ScoringRule {
  id: string;
  ruleKey: string;
  name: string;
  description: string;
  enabled: boolean;
  weight: number;
  threshold: number;
  windowMinutes: number;
  createdAt: string;
  updatedAt: string;
}

interface EditingRule {
  id: string;
  enabled: boolean;
  weight: number;
  threshold: number;
  windowMinutes: number;
}

export default function RulesPage() {
  const [rules, setRules] = useState<ScoringRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [editingRule, setEditingRule] = useState<EditingRule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fetchRules = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/rules");
      if (response.ok) {
        const data = await response.json();
        setRules(data.rules || []);
      }
    } catch (err) {
      console.error("Failed to fetch rules:", err);
      setError("Failed to load rules");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  const handleToggleEnabled = async (rule: ScoringRule) => {
    setSaving(rule.id);
    setError(null);
    setSuccess(null);
    
    try {
      const response = await fetch("/api/rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: rule.id,
          enabled: !rule.enabled,
        }),
      });

      if (response.ok) {
        setRules(rules.map(r => 
          r.id === rule.id ? { ...r, enabled: !r.enabled } : r
        ));
        setSuccess(`Rule "${rule.name}" ${!rule.enabled ? "enabled" : "disabled"}`);
      } else {
        const data = await response.json();
        setError(data.error || "Failed to update rule");
      }
    } catch (err) {
      console.error("Failed to toggle rule:", err);
      setError("Failed to update rule");
    } finally {
      setSaving(null);
    }
  };

  const handleStartEdit = (rule: ScoringRule) => {
    setEditingRule({
      id: rule.id,
      enabled: rule.enabled,
      weight: rule.weight,
      threshold: rule.threshold,
      windowMinutes: rule.windowMinutes,
    });
    setError(null);
    setSuccess(null);
  };

  const handleCancelEdit = () => {
    setEditingRule(null);
  };

  const handleSaveEdit = async () => {
    if (!editingRule) return;

    setSaving(editingRule.id);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingRule),
      });

      if (response.ok) {
        const data = await response.json();
        setRules(rules.map(r => 
          r.id === editingRule.id ? { ...r, ...data.rule } : r
        ));
        setEditingRule(null);
        setSuccess("Rule updated successfully");
      } else {
        const data = await response.json();
        setError(data.error || "Failed to update rule");
      }
    } catch (err) {
      console.error("Failed to save rule:", err);
      setError("Failed to save rule");
    } finally {
      setSaving(null);
    }
  };


  const formatWindowMinutes = (minutes: number): string => {
    if (minutes >= 1440) {
      const days = minutes / 1440;
      return `${days} day${days !== 1 ? "s" : ""}`;
    }
    if (minutes >= 60) {
      const hours = minutes / 60;
      return `${hours} hour${hours !== 1 ? "s" : ""}`;
    }
    return `${minutes} min`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Rules Configuration</h2>
          <p className="text-zinc-600 dark:text-zinc-400">
            Configure scoring rules, thresholds, and weights
          </p>
        </div>
        <Button 
          variant="outline" 
          onClick={() => fetchRules()}
          disabled={loading}
        >
          {loading ? "Refreshing..." : "Refresh"}
        </Button>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 p-4 text-red-700 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </div>
      )}

      {success && (
        <div className="rounded-lg bg-green-50 p-4 text-green-700 dark:bg-green-900/20 dark:text-green-400">
          {success}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Scoring Rules</CardTitle>
          <CardDescription>
            Enable or disable rules and adjust their thresholds and weights.
            Changes are logged to the audit trail.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <p className="text-zinc-500">Loading rules...</p>
            </div>
          ) : rules.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <p className="text-zinc-500">No rules configured. Run seed to create default rules.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rule</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Weight</TableHead>
                  <TableHead>Threshold</TableHead>
                  <TableHead>Window</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((rule) => {
                  const isEditing = editingRule?.id === rule.id;
                  const isSaving = saving === rule.id;

                  return (
                    <TableRow key={rule.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{rule.name}</p>
                          <p className="text-sm text-zinc-500">{rule.description}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant={rule.enabled ? "default" : "outline"}
                          size="sm"
                          onClick={() => handleToggleEnabled(rule)}
                          disabled={isSaving || isEditing}
                        >
                          {rule.enabled ? "Enabled" : "Disabled"}
                        </Button>
                      </TableCell>
                      <TableCell>
                        {isEditing ? (
                          <Input
                            type="number"
                            min={1}
                            max={100}
                            value={editingRule.weight}
                            onChange={(e) => setEditingRule({
                              ...editingRule,
                              weight: parseInt(e.target.value) || 0,
                            })}
                            className="w-20"
                          />
                        ) : (
                          <span className="font-mono">{rule.weight}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {isEditing ? (
                          <Input
                            type="number"
                            min={0}
                            step={0.1}
                            value={editingRule.threshold}
                            onChange={(e) => setEditingRule({
                              ...editingRule,
                              threshold: parseFloat(e.target.value) || 0,
                            })}
                            className="w-20"
                          />
                        ) : (
                          <span className="font-mono">{rule.threshold}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {isEditing ? (
                          <Input
                            type="number"
                            min={1}
                            value={editingRule.windowMinutes}
                            onChange={(e) => setEditingRule({
                              ...editingRule,
                              windowMinutes: parseInt(e.target.value) || 1,
                            })}
                            className="w-24"
                          />
                        ) : (
                          <span className="text-zinc-600 dark:text-zinc-400">
                            {formatWindowMinutes(rule.windowMinutes)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {isEditing ? (
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={handleSaveEdit}
                              disabled={isSaving}
                            >
                              {isSaving ? "Saving..." : "Save"}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={handleCancelEdit}
                              disabled={isSaving}
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleStartEdit(rule)}
                            disabled={isSaving}
                          >
                            Edit
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rule Descriptions</CardTitle>
          <CardDescription>
            Understanding how each rule contributes to risk scoring
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border p-4">
              <h4 className="font-medium">Off-Hours Activity</h4>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Detects activity outside the actor&apos;s typical active hours.
                Threshold: minimum events outside normal hours.
              </p>
            </div>
            <div className="rounded-lg border p-4">
              <h4 className="font-medium">New IP Address</h4>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Flags when an actor uses IP addresses not seen in their baseline period.
                Threshold: minimum new IPs to trigger.
              </p>
            </div>
            <div className="rounded-lg border p-4">
              <h4 className="font-medium">Volume Spike</h4>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Triggers when bytes transferred exceeds baseline by the threshold multiplier.
                Threshold: multiplier (e.g., 3 = 3x baseline).
              </p>
            </div>
            <div className="rounded-lg border p-4">
              <h4 className="font-medium">Resource Scope Expansion</h4>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Detects when an actor accesses more distinct resources than normal.
                Threshold: multiplier of baseline scope.
              </p>
            </div>
            <div className="rounded-lg border p-4">
              <h4 className="font-medium">Failure Burst</h4>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Flags many failures in a short time window.
                Threshold: minimum failures within the window.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
