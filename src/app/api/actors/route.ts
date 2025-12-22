import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get("page") || "1");
    const pageSize = parseInt(searchParams.get("pageSize") || "20");
    const sortBy = searchParams.get("sortBy") || "currentRiskScore";
    const sortOrder = searchParams.get("sortOrder") || "desc";
    const search = searchParams.get("search") || "";

    const skip = (page - 1) * pageSize;

    // Build orderBy clause
    const orderBy: Record<string, "asc" | "desc"> = {};
    if (sortBy === "currentRiskScore" || sortBy === "lastSeen" || sortBy === "actorId") {
      orderBy[sortBy] = sortOrder === "asc" ? "asc" : "desc";
    } else {
      orderBy.currentRiskScore = "desc";
    }

    // Build where clause for search
    const where = search
      ? {
          OR: [
            { actorId: { contains: search, mode: "insensitive" as const } },
            { displayName: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {};

    const [actors, total] = await Promise.all([
      prisma.actor.findMany({
        where,
        skip,
        take: pageSize,
        orderBy,
        select: {
          id: true,
          actorId: true,
          displayName: true,
          actorType: true,
          currentRiskScore: true,
          lastSeen: true,
          firstSeen: true,
        },
      }),
      prisma.actor.count({ where }),
    ]);

    return NextResponse.json({
      actors,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (error) {
    console.error("Failed to fetch actors:", error);
    return NextResponse.json(
      { error: "Failed to fetch actors" },
      { status: 500 }
    );
  }
}
