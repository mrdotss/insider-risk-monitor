import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { sourceService } from "@/lib/ingestion/source-service";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    const source = await prisma.source.findUnique({
      where: { id },
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
    });

    if (!source) {
      return NextResponse.json({ error: "Source not found" }, { status: 404 });
    }

    return NextResponse.json({ source });
  } catch (error) {
    console.error("Failed to fetch source:", error);
    return NextResponse.json(
      { error: "Failed to fetch source" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const { name, description, enabled, redactResourceId, retentionDays, rateLimit } = body;

    // Get current source for audit logging
    const currentSource = await prisma.source.findUnique({ where: { id } });
    if (!currentSource) {
      return NextResponse.json({ error: "Source not found" }, { status: 404 });
    }

    // Update source
    const updatedSource = await sourceService.update(id, {
      name: name !== undefined ? name : currentSource.name,
      description: description !== undefined ? description : currentSource.description,
      enabled: enabled !== undefined ? enabled : currentSource.enabled,
      redactResourceId: redactResourceId !== undefined ? redactResourceId : currentSource.redactResourceId,
      retentionDays: retentionDays !== undefined ? retentionDays : currentSource.retentionDays,
      rateLimit: rateLimit !== undefined ? rateLimit : currentSource.rateLimit,
    });

    // Create audit log entry
    await prisma.auditLog.create({
      data: {
        userId: session.user.id,
        action: "source_updated",
        entityType: "Source",
        entityId: id,
        beforeValue: {
          name: currentSource.name,
          description: currentSource.description,
          enabled: currentSource.enabled,
          redactResourceId: currentSource.redactResourceId,
          retentionDays: currentSource.retentionDays,
          rateLimit: currentSource.rateLimit,
        },
        afterValue: {
          name: updatedSource.name,
          description: updatedSource.description,
          enabled: updatedSource.enabled,
          redactResourceId: updatedSource.redactResourceId,
          retentionDays: updatedSource.retentionDays,
          rateLimit: updatedSource.rateLimit,
        },
      },
    });

    return NextResponse.json({
      source: {
        id: updatedSource.id,
        key: updatedSource.key,
        name: updatedSource.name,
        description: updatedSource.description,
        enabled: updatedSource.enabled,
        redactResourceId: updatedSource.redactResourceId,
        retentionDays: updatedSource.retentionDays,
        rateLimit: updatedSource.rateLimit,
        createdAt: updatedSource.createdAt,
        updatedAt: updatedSource.updatedAt,
      },
    });
  } catch (error) {
    console.error("Failed to update source:", error);
    return NextResponse.json(
      { error: "Failed to update source" },
      { status: 500 }
    );
  }
}
