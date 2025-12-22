"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
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

interface ActorListItem {
  id: string;
  actorId: string;
  displayName: string | null;
  actorType: "employee" | "service";
  currentRiskScore: number;
  lastSeen: string;
  firstSeen: string;
}

interface ActorsResponse {
  actors: ActorListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
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

function formatActorType(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function ActorsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [actors, setActors] = useState<ActorListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  const page = parseInt(searchParams.get("page") || "1");
  const sortBy = searchParams.get("sortBy") || "currentRiskScore";
  const sortOrder = searchParams.get("sortOrder") || "desc";
  const search = searchParams.get("search") || "";

  const fetchActors = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", page.toString());
      params.set("pageSize", "20");
      params.set("sortBy", sortBy);
      params.set("sortOrder", sortOrder);
      if (search) params.set("search", search);

      const response = await fetch(`/api/actors?${params.toString()}`);
      if (response.ok) {
        const data: ActorsResponse = await response.json();
        setActors(data.actors);
        setTotal(data.total);
        setTotalPages(data.totalPages);
      }
    } catch (error) {
      console.error("Failed to fetch actors:", error);
    } finally {
      setLoading(false);
    }
  }, [page, sortBy, sortOrder, search]);

  useEffect(() => {
    fetchActors();
    setSearchQuery(search);
  }, [fetchActors, search]);

  const updateParams = (updates: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([key, value]) => {
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    });
    if (!("page" in updates)) {
      params.set("page", "1");
    }
    router.push(`/actors?${params.toString()}`);
  };

  const toggleSort = (column: string) => {
    if (sortBy === column) {
      updateParams({ sortOrder: sortOrder === "desc" ? "asc" : "desc" });
    } else {
      updateParams({ sortBy: column, sortOrder: "desc" });
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    updateParams({ search: searchQuery });
  };

  const clearSearch = () => {
    setSearchQuery("");
    updateParams({ search: "" });
  };

  const getSortIndicator = (column: string) => {
    if (sortBy !== column) return null;
    return sortOrder === "desc" ? " ↓" : " ↑";
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Actors</h2>
          <p className="text-zinc-600 dark:text-zinc-400">
            View all actors and their current risk levels
          </p>
        </div>
        <Button 
          variant="outline" 
          onClick={() => fetchActors()}
          disabled={loading}
        >
          {loading ? "Refreshing..." : "Refresh"}
        </Button>
      </div>

      {/* Search Bar */}
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSearch} className="flex gap-2">
            <Input
              placeholder="Search by actor ID or name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="max-w-md"
            />
            <Button type="submit" variant="secondary">Search</Button>
            {search && (
              <Button type="button" variant="ghost" onClick={clearSearch}>
                Clear
              </Button>
            )}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Actor List</CardTitle>
          <CardDescription>
            {total} actor{total !== 1 ? "s" : ""} found
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <p className="text-zinc-500">Loading actors...</p>
            </div>
          ) : actors.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <p className="text-zinc-500">No actors found</p>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead 
                      className="cursor-pointer hover:text-zinc-900 dark:hover:text-zinc-50"
                      onClick={() => toggleSort("actorId")}
                    >
                      Actor ID{getSortIndicator("actorId")}
                    </TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead 
                      className="cursor-pointer hover:text-zinc-900 dark:hover:text-zinc-50"
                      onClick={() => toggleSort("currentRiskScore")}
                    >
                      Risk Score{getSortIndicator("currentRiskScore")}
                    </TableHead>
                    <TableHead 
                      className="cursor-pointer hover:text-zinc-900 dark:hover:text-zinc-50"
                      onClick={() => toggleSort("lastSeen")}
                    >
                      Last Seen{getSortIndicator("lastSeen")}
                    </TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {actors.map((actor) => (
                    <TableRow key={actor.id}>
                      <TableCell className="font-medium">
                        {actor.displayName || actor.actorId}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {formatActorType(actor.actorType)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-bold">{actor.currentRiskScore}</span>
                          <Badge variant={getRiskVariant(actor.currentRiskScore)}>
                            {getRiskLabel(actor.currentRiskScore)}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell className="text-zinc-500">
                        {new Date(actor.lastSeen).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Link href={`/actors/${encodeURIComponent(actor.actorId)}`}>
                          <Button variant="outline" size="sm">
                            View →
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="flex items-center justify-between mt-4">
                <p className="text-sm text-zinc-500">
                  Page {page} of {totalPages}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => updateParams({ page: (page - 1).toString() })}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => updateParams({ page: (page + 1).toString() })}
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

export default function ActorsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-8"><p className="text-zinc-500">Loading...</p></div>}>
      <ActorsPageContent />
    </Suspense>
  );
}
