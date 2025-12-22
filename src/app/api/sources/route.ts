import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { sourceService } from "@/lib/ingestion/source-service";

export async function GET() {
  try {
    const sources = await prisma.source.findMany({
      select: {
        id: true,
        key: true,
        name: true,
        description: true,
        enabled: true,
        redactResourceId: true,
        retentionDays: true,
        rateLimit: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { name: "asc" },
    });

    return NextResponse.json({ sources });
  } catch (error) {
    console.error("Failed to fetch sources:", error);
    return NextResponse.json(
      { error: "Failed to fetch sources" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { key, name, description, redactResourceId, retentionDays, rateLimit } = body;

    if (!key || !name) {
      return NextResponse.json(
        { error: "Key and name are required" },
        { status: 400 }
      );
    }

    // Check if key already exists
    const existing = await prisma.source.findUnique({ where: { key } });
    if (existing) {
      return NextResponse.json(
        { error: "Source key already exists" },
        { status: 400 }
      );
    }

    // Create source with generated API key
    const { source, apiKey } = await sourceService.create({
      key,
      name,
      description,
      redactResourceId: redactResourceId ?? false,
      retentionDays: retentionDays ?? 90,
      rateLimit: rateLimit ?? 1000,
    });

    // Create audit log entry
    await prisma.auditLog.create({
      data: {
        userId: session.user.id,
        action: "source_created",
        entityType: "Source",
        entityId: source.id,
        beforeValue: undefined,
        afterValue: {
          key: source.key,
          name: source.name,
          description: source.description,
          redactResourceId: source.redactResourceId,
          retentionDays: source.retentionDays,
          rateLimit: source.rateLimit,
        },
      },
    });

    return NextResponse.json({ 
      source: {
        id: source.id,
        key: source.key,
        name: source.name,
        description: source.description,
        enabled: source.enabled,
        redactResourceId: source.redactResourceId,
        retentionDays: source.retentionDays,
        rateLimit: source.rateLimit,
        createdAt: source.createdAt,
        updatedAt: source.updatedAt,
      },
      apiKey, // Only returned on creation
    });
  } catch (error) {
    console.error("Failed to create source:", error);
    return NextResponse.json(
      { error: "Failed to create source" },
      { status: 500 }
    );
  }
}
