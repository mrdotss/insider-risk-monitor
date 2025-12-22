import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { Prisma, Severity, AlertStatus } from "@/generated/prisma";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    
    // Pagination
    const page = parseInt(searchParams.get("page") || "1");
    const pageSize = parseInt(searchParams.get("pageSize") || "10");
    const skip = (page - 1) * pageSize;

    // Filters
    const severity = searchParams.get("severity");
    const status = searchParams.get("status");
    const sourceId = searchParams.get("source");
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");

    // Build where clause
    const where: Prisma.AlertWhereInput = {};

    if (severity && Object.values(Severity).includes(severity as Severity)) {
      where.severity = severity as Severity;
    }

    if (status && Object.values(AlertStatus).includes(status as AlertStatus)) {
      where.status = status as AlertStatus;
    }

    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) {
        where.createdAt.gte = new Date(dateFrom);
      }
      if (dateTo) {
        // Add one day to include the entire end date
        const endDate = new Date(dateTo);
        endDate.setDate(endDate.getDate() + 1);
        where.createdAt.lte = endDate;
      }
    }

    // If source filter is provided, we need to filter by events from that source
    // Since alerts don't directly reference sources, we need to get actors that have events from that source
    if (sourceId) {
      const actorsWithSource = await prisma.event.findMany({
        where: { sourceId },
        select: { actorId: true },
        distinct: ["actorId"],
      });
      const actorIds = actorsWithSource.map((e) => e.actorId);
      where.actorId = { in: actorIds };
    }

    // Get total count
    const total = await prisma.alert.count({ where });

    // Get alerts with actor info
    const alerts = await prisma.alert.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      include: {
        actor: {
          select: {
            displayName: true,
          },
        },
      },
    });

    // Get source names for each alert (based on triggering events)
    const alertsWithSource = await Promise.all(
      alerts.map(async (alert) => {
        let sourceName: string | null = null;
        
        // Get source from first triggering event
        const triggeringEventIds = alert.triggeringEventIds as string[];
        if (triggeringEventIds && triggeringEventIds.length > 0) {
          const event = await prisma.event.findFirst({
            where: { id: triggeringEventIds[0] },
            include: { source: { select: { name: true } } },
          });
          sourceName = event?.source?.name || null;
        }

        return {
          id: alert.id,
          actorId: alert.actorId,
          actorDisplayName: alert.actor.displayName,
          score: alert.score,
          severity: alert.severity,
          status: alert.status,
          createdAt: alert.createdAt.toISOString(),
          sourceName,
        };
      })
    );

    return NextResponse.json({
      alerts: alertsWithSource,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (error) {
    console.error("Failed to fetch alerts:", error);
    return NextResponse.json(
      { error: "Failed to fetch alerts" },
      { status: 500 }
    );
  }
}
