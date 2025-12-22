import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { RuleContribution, BaselineComparison } from "@/types";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const alert = await prisma.alert.findUnique({
      where: { id },
      include: {
        actor: {
          select: {
            displayName: true,
          },
        },
      },
    });

    if (!alert) {
      return NextResponse.json({ error: "Alert not found" }, { status: 404 });
    }

    // Fetch triggering events
    const triggeringEventIds = alert.triggeringEventIds as string[];
    const triggeringEvents = await prisma.event.findMany({
      where: {
        id: { in: triggeringEventIds },
      },
      include: {
        source: {
          select: { name: true },
        },
      },
      orderBy: { occurredAt: "desc" },
    });

    const ruleContributions = alert.ruleContributions as unknown as RuleContribution[];
    const baselineComparison = alert.baselineComparison as unknown as BaselineComparison;

    return NextResponse.json({
      id: alert.id,
      actorId: alert.actorId,
      actorDisplayName: alert.actor.displayName,
      score: alert.score,
      severity: alert.severity,
      status: alert.status,
      ruleContributions,
      baselineComparison,
      triggeringEvents: triggeringEvents.map((event) => ({
        id: event.id,
        occurredAt: event.occurredAt.toISOString(),
        actionType: event.actionType,
        resourceType: event.resourceType,
        outcome: event.outcome,
        ip: event.ip,
        sourceName: event.source.name,
      })),
      createdAt: alert.createdAt.toISOString(),
      updatedAt: alert.updatedAt.toISOString(),
      acknowledgedBy: alert.acknowledgedBy,
      acknowledgedAt: alert.acknowledgedAt?.toISOString() || null,
      resolvedBy: alert.resolvedBy,
      resolvedAt: alert.resolvedAt?.toISOString() || null,
    });
  } catch (error) {
    console.error("Failed to fetch alert:", error);
    return NextResponse.json(
      { error: "Failed to fetch alert" },
      { status: 500 }
    );
  }
}
