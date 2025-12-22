import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: actorId } = await params;
    const decodedActorId = decodeURIComponent(actorId);

    // Fetch actor with related data
    const actor = await prisma.actor.findUnique({
      where: { actorId: decodedActorId },
      include: {
        baselines: {
          orderBy: { computedAt: "desc" },
          take: 1,
        },
        riskScores: {
          orderBy: { computedAt: "desc" },
          take: 30,
        },
        alerts: {
          orderBy: { createdAt: "desc" },
          take: 10,
        },
      },
    });

    if (!actor) {
      return NextResponse.json(
        { error: "Actor not found" },
        { status: 404 }
      );
    }

    // Fetch recent events for this actor
    const events = await prisma.event.findMany({
      where: { actorId: decodedActorId },
      orderBy: { occurredAt: "desc" },
      take: 50,
      include: {
        source: {
          select: {
            name: true,
            key: true,
          },
        },
      },
    });

    // Format the response
    const currentBaseline = actor.baselines[0] || null;

    return NextResponse.json({
      actor: {
        id: actor.id,
        actorId: actor.actorId,
        displayName: actor.displayName,
        actorType: actor.actorType,
        currentRiskScore: actor.currentRiskScore,
        firstSeen: actor.firstSeen,
        lastSeen: actor.lastSeen,
      },
      baseline: currentBaseline
        ? {
            id: currentBaseline.id,
            computedAt: currentBaseline.computedAt,
            windowDays: currentBaseline.windowDays,
            typicalActiveHours: currentBaseline.typicalActiveHours,
            knownIpAddresses: currentBaseline.knownIpAddresses,
            knownUserAgents: currentBaseline.knownUserAgents,
            avgBytesPerDay: currentBaseline.avgBytesPerDay,
            avgEventsPerDay: currentBaseline.avgEventsPerDay,
            typicalResourceScope: currentBaseline.typicalResourceScope,
            normalFailureRate: currentBaseline.normalFailureRate,
            eventCount: currentBaseline.eventCount,
          }
        : null,
      riskScoreHistory: actor.riskScores.map((score) => ({
        id: score.id,
        totalScore: score.totalScore,
        computedAt: score.computedAt,
        ruleContributions: score.ruleContributions,
      })),
      recentAlerts: actor.alerts.map((alert) => ({
        id: alert.id,
        severity: alert.severity,
        status: alert.status,
        score: alert.score,
        createdAt: alert.createdAt,
      })),
      events: events.map((event) => ({
        id: event.id,
        occurredAt: event.occurredAt,
        actionType: event.actionType,
        resourceType: event.resourceType,
        resourceId: event.resourceId,
        outcome: event.outcome,
        ip: event.ip,
        bytes: event.bytes,
        sourceName: event.source.name,
        sourceKey: event.source.key,
      })),
    });
  } catch (error) {
    console.error("Failed to fetch actor:", error);
    return NextResponse.json(
      { error: "Failed to fetch actor" },
      { status: 500 }
    );
  }
}
