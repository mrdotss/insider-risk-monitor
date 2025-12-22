import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";

export async function GET() {
  try {
    const rules = await prisma.scoringRule.findMany({
      orderBy: { name: "asc" },
    });

    return NextResponse.json({ rules });
  } catch (error) {
    console.error("Failed to fetch rules:", error);
    return NextResponse.json(
      { error: "Failed to fetch rules" },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { id, enabled, weight, threshold, windowMinutes } = body;

    if (!id) {
      return NextResponse.json(
        { error: "Rule ID is required" },
        { status: 400 }
      );
    }

    // Get the current rule for audit logging
    const currentRule = await prisma.scoringRule.findUnique({
      where: { id },
    });

    if (!currentRule) {
      return NextResponse.json(
        { error: "Rule not found" },
        { status: 404 }
      );
    }

    // Update the rule
    const updatedRule = await prisma.scoringRule.update({
      where: { id },
      data: {
        enabled: enabled !== undefined ? enabled : currentRule.enabled,
        weight: weight !== undefined ? weight : currentRule.weight,
        threshold: threshold !== undefined ? threshold : currentRule.threshold,
        windowMinutes: windowMinutes !== undefined ? windowMinutes : currentRule.windowMinutes,
      },
    });

    // Create audit log entry
    await prisma.auditLog.create({
      data: {
        userId: session.user.id,
        action: "rule_updated",
        entityType: "ScoringRule",
        entityId: id,
        beforeValue: {
          enabled: currentRule.enabled,
          weight: currentRule.weight,
          threshold: currentRule.threshold,
          windowMinutes: currentRule.windowMinutes,
        },
        afterValue: {
          enabled: updatedRule.enabled,
          weight: updatedRule.weight,
          threshold: updatedRule.threshold,
          windowMinutes: updatedRule.windowMinutes,
        },
      },
    });

    return NextResponse.json({ rule: updatedRule });
  } catch (error) {
    console.error("Failed to update rule:", error);
    return NextResponse.json(
      { error: "Failed to update rule" },
      { status: 500 }
    );
  }
}
