import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AlertStatus } from "@/generated/prisma";
import { auth } from "@/lib/auth";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { status } = body;

    // Validate status
    if (!status || !Object.values(AlertStatus).includes(status as AlertStatus)) {
      return NextResponse.json(
        { error: "Invalid status" },
        { status: 400 }
      );
    }

    // Get current user from session
    const session = await auth();
    const userId = session?.user?.email || "system";

    // Check if alert exists
    const existingAlert = await prisma.alert.findUnique({
      where: { id },
    });

    if (!existingAlert) {
      return NextResponse.json({ error: "Alert not found" }, { status: 404 });
    }

    // Build update data based on new status
    const updateData: {
      status: AlertStatus;
      acknowledgedBy?: string;
      acknowledgedAt?: Date;
      resolvedBy?: string;
      resolvedAt?: Date;
    } = {
      status: status as AlertStatus,
    };

    if (status === "acknowledged" && !existingAlert.acknowledgedBy) {
      updateData.acknowledgedBy = userId;
      updateData.acknowledgedAt = new Date();
    }

    if (status === "resolved" || status === "false_positive") {
      updateData.resolvedBy = userId;
      updateData.resolvedAt = new Date();
      // Also set acknowledged if not already
      if (!existingAlert.acknowledgedBy) {
        updateData.acknowledgedBy = userId;
        updateData.acknowledgedAt = new Date();
      }
    }

    // Update the alert
    const updatedAlert = await prisma.alert.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({
      id: updatedAlert.id,
      status: updatedAlert.status,
      acknowledgedBy: updatedAlert.acknowledgedBy,
      acknowledgedAt: updatedAlert.acknowledgedAt?.toISOString() || null,
      resolvedBy: updatedAlert.resolvedBy,
      resolvedAt: updatedAlert.resolvedAt?.toISOString() || null,
    });
  } catch (error) {
    console.error("Failed to update alert status:", error);
    return NextResponse.json(
      { error: "Failed to update alert status" },
      { status: 500 }
    );
  }
}
