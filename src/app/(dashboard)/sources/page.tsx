"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Source {
  id: string;
  key: string;
  name: string;
  description: string | null;
  enabled: boolean;
  redactResourceId: boolean;
  retentionDays: number;
  rateLimit: number;
  createdAt: string;
  updatedAt: string;
}

interface NewSource {
  key: string;
  name: string;
  description: string;
  redactResourceId: boolean;
  retentionDays: number;
  rateLimit: number;
}

interface EditingSource {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  redactResourceId: boolean;
  retentionDays: number;
  rateLimit: number;
}

const defaultNewSource: NewSource = {
  key: "",
  name: "",
  description: "",
  redactResourceId: false,
  retentionDays: 90,
  rateLimit: 1000,
};

export default function SourcesPage() {
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  // Create dialog state
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newSource, setNewSource] = useState<NewSource>(defaultNewSource);
  const [createdApiKey, setCreatedApiKey] = useState<string | null>(null);
  
  // Edit dialog state
  const [editingSource, setEditingSource] = useState<EditingSource | null>(null);
  
  // Rotate key dialog state
  const [rotatingSourceId, setRotatingSourceId] = useState<string | null>(null);
  const [rotatedApiKey, setRotatedApiKey] = useState<string | null>(null);

  const fetchSources = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/sources");
      if (response.ok) {
        const data = await response.json();
        setSources(data.sources || []);
      }
    } catch (err) {
      console.error("Failed to fetch sources:", err);
      setError("Failed to load sources");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSources();
  }, [fetchSources]);


  const handleCreateSource = async () => {
    if (!newSource.key || !newSource.name) {
      setError("Key and name are required");
      return;
    }

    setSaving("create");
    setError(null);

    try {
      const response = await fetch("/api/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newSource),
      });

      if (response.ok) {
        const data = await response.json();
        setSources([...sources, data.source]);
        setCreatedApiKey(data.apiKey);
        setNewSource(defaultNewSource);
        setSuccess(`Source "${data.source.name}" created successfully`);
      } else {
        const data = await response.json();
        setError(data.error || "Failed to create source");
      }
    } catch (err) {
      console.error("Failed to create source:", err);
      setError("Failed to create source");
    } finally {
      setSaving(null);
    }
  };

  const handleCloseCreateDialog = () => {
    setShowCreateDialog(false);
    setCreatedApiKey(null);
    setNewSource(defaultNewSource);
  };

  const handleStartEdit = (source: Source) => {
    setEditingSource({
      id: source.id,
      name: source.name,
      description: source.description || "",
      enabled: source.enabled,
      redactResourceId: source.redactResourceId,
      retentionDays: source.retentionDays,
      rateLimit: source.rateLimit,
    });
    setError(null);
    setSuccess(null);
  };

  const handleSaveEdit = async () => {
    if (!editingSource) return;

    setSaving(editingSource.id);
    setError(null);

    try {
      const response = await fetch(`/api/sources/${editingSource.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingSource),
      });

      if (response.ok) {
        const data = await response.json();
        setSources(sources.map(s => 
          s.id === editingSource.id ? data.source : s
        ));
        setEditingSource(null);
        setSuccess("Source updated successfully");
      } else {
        const data = await response.json();
        setError(data.error || "Failed to update source");
      }
    } catch (err) {
      console.error("Failed to update source:", err);
      setError("Failed to update source");
    } finally {
      setSaving(null);
    }
  };

  const handleToggleEnabled = async (source: Source) => {
    setSaving(source.id);
    setError(null);

    try {
      const response = await fetch(`/api/sources/${source.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !source.enabled }),
      });

      if (response.ok) {
        setSources(sources.map(s => 
          s.id === source.id ? { ...s, enabled: !s.enabled } : s
        ));
        setSuccess(`Source "${source.name}" ${!source.enabled ? "enabled" : "disabled"}`);
      } else {
        const data = await response.json();
        setError(data.error || "Failed to update source");
      }
    } catch (err) {
      console.error("Failed to toggle source:", err);
      setError("Failed to update source");
    } finally {
      setSaving(null);
    }
  };

  const handleRotateKey = async (sourceId: string) => {
    setSaving(sourceId);
    setError(null);

    try {
      const response = await fetch(`/api/sources/${sourceId}/rotate-key`, {
        method: "POST",
      });

      if (response.ok) {
        const data = await response.json();
        setRotatedApiKey(data.apiKey);
        setSuccess(`API key rotated for "${data.source.name}"`);
      } else {
        const data = await response.json();
        setError(data.error || "Failed to rotate API key");
      }
    } catch (err) {
      console.error("Failed to rotate API key:", err);
      setError("Failed to rotate API key");
    } finally {
      setSaving(null);
    }
  };

  const handleCloseRotateDialog = () => {
    setRotatingSourceId(null);
    setRotatedApiKey(null);
  };


  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Sources</h2>
          <p className="text-zinc-600 dark:text-zinc-400">
            Manage event sources and API keys
          </p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)}>
          Create Source
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
          <CardTitle>Event Sources</CardTitle>
          <CardDescription>
            Configure sources that send security events to the system
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <p className="text-zinc-500">Loading sources...</p>
            </div>
          ) : sources.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 gap-4">
              <p className="text-zinc-500">No sources configured yet.</p>
              <Button onClick={() => setShowCreateDialog(true)}>
                Create Your First Source
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Redaction</TableHead>
                  <TableHead>Retention</TableHead>
                  <TableHead>Rate Limit</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sources.map((source) => (
                  <TableRow key={source.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{source.name}</p>
                        {source.description && (
                          <p className="text-sm text-zinc-500">{source.description}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <code className="rounded bg-zinc-100 px-2 py-1 text-sm dark:bg-zinc-800">
                        {source.key}
                      </code>
                    </TableCell>
                    <TableCell>
                      <Badge variant={source.enabled ? "default" : "secondary"}>
                        {source.enabled ? "Enabled" : "Disabled"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={source.redactResourceId ? "default" : "outline"}>
                        {source.redactResourceId ? "On" : "Off"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-zinc-600 dark:text-zinc-400">
                        {source.retentionDays} days
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-zinc-600 dark:text-zinc-400">
                        {source.rateLimit}/min
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleStartEdit(source)}
                          disabled={saving === source.id}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleToggleEnabled(source)}
                          disabled={saving === source.id}
                        >
                          {source.enabled ? "Disable" : "Enable"}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setRotatingSourceId(source.id)}
                          disabled={saving === source.id}
                        >
                          Rotate Key
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>


      {/* Create Source Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={handleCloseCreateDialog}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>
              {createdApiKey ? "Source Created" : "Create New Source"}
            </DialogTitle>
            <DialogDescription>
              {createdApiKey 
                ? "Save the API key below. It will only be shown once."
                : "Configure a new event source for ingestion."
              }
            </DialogDescription>
          </DialogHeader>
          
          {createdApiKey ? (
            <div className="space-y-4">
              <div className="rounded-lg bg-yellow-50 p-4 dark:bg-yellow-900/20">
                <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200 mb-2">
                  API Key (save this now - it won&apos;t be shown again):
                </p>
                <code className="block rounded bg-zinc-100 p-3 text-sm break-all dark:bg-zinc-800">
                  {createdApiKey}
                </code>
              </div>
              <DialogFooter>
                <Button onClick={handleCloseCreateDialog}>Done</Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <label className="text-sm font-medium">Key (unique identifier)</label>
                  <Input
                    placeholder="e.g., vpn, iam, app"
                    value={newSource.key}
                    onChange={(e) => setNewSource({ ...newSource, key: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "") })}
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium">Name</label>
                  <Input
                    placeholder="e.g., VPN Logs"
                    value={newSource.name}
                    onChange={(e) => setNewSource({ ...newSource, name: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium">Description (optional)</label>
                  <Input
                    placeholder="e.g., Corporate VPN connection logs"
                    value={newSource.description}
                    onChange={(e) => setNewSource({ ...newSource, description: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <label className="text-sm font-medium">Retention (days)</label>
                    <Select
                      value={newSource.retentionDays.toString()}
                      onValueChange={(v) => setNewSource({ ...newSource, retentionDays: parseInt(v) })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="30">30 days</SelectItem>
                        <SelectItem value="90">90 days</SelectItem>
                        <SelectItem value="180">180 days</SelectItem>
                        <SelectItem value="365">365 days</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <label className="text-sm font-medium">Rate Limit (/min)</label>
                    <Input
                      type="number"
                      min={100}
                      max={10000}
                      value={newSource.rateLimit}
                      onChange={(e) => setNewSource({ ...newSource, rateLimit: parseInt(e.target.value) || 1000 })}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="redact"
                    checked={newSource.redactResourceId}
                    onChange={(e) => setNewSource({ ...newSource, redactResourceId: e.target.checked })}
                    className="h-4 w-4 rounded border-zinc-300"
                  />
                  <label htmlFor="redact" className="text-sm">
                    Redact resource IDs (hash before storage)
                  </label>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={handleCloseCreateDialog}>
                  Cancel
                </Button>
                <Button onClick={handleCreateSource} disabled={saving === "create"}>
                  {saving === "create" ? "Creating..." : "Create Source"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>


      {/* Edit Source Dialog */}
      <Dialog open={!!editingSource} onOpenChange={() => setEditingSource(null)}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Edit Source</DialogTitle>
            <DialogDescription>
              Update source configuration. Changes are logged to the audit trail.
            </DialogDescription>
          </DialogHeader>
          
          {editingSource && (
            <div className="space-y-4">
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <label className="text-sm font-medium">Name</label>
                  <Input
                    value={editingSource.name}
                    onChange={(e) => setEditingSource({ ...editingSource, name: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium">Description</label>
                  <Input
                    value={editingSource.description}
                    onChange={(e) => setEditingSource({ ...editingSource, description: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <label className="text-sm font-medium">Retention (days)</label>
                    <Select
                      value={editingSource.retentionDays.toString()}
                      onValueChange={(v) => setEditingSource({ ...editingSource, retentionDays: parseInt(v) })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="30">30 days</SelectItem>
                        <SelectItem value="90">90 days</SelectItem>
                        <SelectItem value="180">180 days</SelectItem>
                        <SelectItem value="365">365 days</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <label className="text-sm font-medium">Rate Limit (/min)</label>
                    <Input
                      type="number"
                      min={100}
                      max={10000}
                      value={editingSource.rateLimit}
                      onChange={(e) => setEditingSource({ ...editingSource, rateLimit: parseInt(e.target.value) || 1000 })}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="edit-redact"
                    checked={editingSource.redactResourceId}
                    onChange={(e) => setEditingSource({ ...editingSource, redactResourceId: e.target.checked })}
                    className="h-4 w-4 rounded border-zinc-300"
                  />
                  <label htmlFor="edit-redact" className="text-sm">
                    Redact resource IDs (hash before storage)
                  </label>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditingSource(null)}>
                  Cancel
                </Button>
                <Button onClick={handleSaveEdit} disabled={saving === editingSource.id}>
                  {saving === editingSource.id ? "Saving..." : "Save Changes"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Rotate Key Confirmation Dialog */}
      <Dialog open={!!rotatingSourceId} onOpenChange={handleCloseRotateDialog}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>
              {rotatedApiKey ? "API Key Rotated" : "Rotate API Key"}
            </DialogTitle>
            <DialogDescription>
              {rotatedApiKey 
                ? "Save the new API key below. The old key is now invalid."
                : "This will invalidate the current API key. The source will need to be updated with the new key."
              }
            </DialogDescription>
          </DialogHeader>
          
          {rotatedApiKey ? (
            <div className="space-y-4">
              <div className="rounded-lg bg-yellow-50 p-4 dark:bg-yellow-900/20">
                <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200 mb-2">
                  New API Key (save this now - it won&apos;t be shown again):
                </p>
                <code className="block rounded bg-zinc-100 p-3 text-sm break-all dark:bg-zinc-800">
                  {rotatedApiKey}
                </code>
              </div>
              <DialogFooter>
                <Button onClick={handleCloseRotateDialog}>Done</Button>
              </DialogFooter>
            </div>
          ) : (
            <DialogFooter>
              <Button variant="outline" onClick={handleCloseRotateDialog}>
                Cancel
              </Button>
              <Button 
                variant="destructive"
                onClick={() => rotatingSourceId && handleRotateKey(rotatingSourceId)}
                disabled={saving === rotatingSourceId}
              >
                {saving === rotatingSourceId ? "Rotating..." : "Rotate Key"}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
