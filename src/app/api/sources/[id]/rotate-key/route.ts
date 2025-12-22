import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { sourceService } from "@/lib/ingestion/source-service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    // Check if source exists
    const currentSource = await prisma.source.findUnique({ where: { id } });
    if (!currentSource) {
      return NextResponse.json({ error: "Source not found" }, { status: 404 });
    }

    // Rotate API key
    const { source, apiKey } = await sourceService.rotateApiKey(id);

    // Create audit log entry
    await prisma.auditLog.create({
      data: {
        userId: session.user.id,
        action: "source_api_key_rotated",
        entityType: "Source",
        entityId: id,
        beforeValue: { apiKeyRotated: true },
        afterValue: { apiKeyRotated: true, rotatedAt: new Date().toISOString() },
      },
    });

    return NextResponse.json({
      source: {
        id: source.id,
        key: source.key,
        name: source.name,
      },
      apiKey, // Only returned on rotation
    });
  } catch (error) {
    console.error("Failed to rotate API key:", error);
    return NextResponse.json(
      { error: "Failed to rotate API key" },
      { status: 500 }
    );
  }
}
