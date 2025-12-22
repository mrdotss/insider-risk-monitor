/**
 * Ingestion API Endpoint
 * POST /api/ingest/{sourceKey}
 * 
 * Requirements:
 * - 1.1: Accept valid requests with x-api-key header, return 202 Accepted
 * - 1.2: Return 401 Unauthorized for invalid/missing API key
 * - 1.3: Return 429 Too Many Requests when rate limit exceeded
 * - 1.4: Normalize and persist valid events
 * - 1.5: Return 400 Bad Request for invalid payloads
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sourceService, checkRateLimit } from "@/lib/ingestion";
import { normalizeEvent } from "@/lib/normalization";
import { prisma } from "@/lib/db";

// ============================================
// Validation Schema
// ============================================

/**
 * Zod schema for raw event payload validation
 * Flexible to accommodate various source formats
 */
const rawEventSchema = z.object({
  // Timestamp - at least one of these
  timestamp: z.string().datetime().optional(),
  occurredAt: z.string().datetime().optional(),
  
  // Actor - at least one of these required
  user: z.string().min(1).optional(),
  userId: z.string().min(1).optional(),
  actor: z.string().min(1).optional(),
  actorId: z.string().min(1).optional(),
  
  // Actor type
  actorType: z.enum(["employee", "service"]).optional(),
  
  // Action - at least one of these required
  action: z.string().min(1).optional(),
  actionType: z.string().min(1).optional(),
  type: z.string().min(1).optional(),
  
  // Resource
  resource: z.string().optional(),
  resourceType: z.string().optional(),
  resourceId: z.string().optional(),
  
  // Network info
  ip: z.string().optional(),
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
  
  // Data transfer
  bytes: z.number().int().min(0).optional(),
  bytesTransferred: z.number().int().min(0).optional(),
  
  // Outcome
  success: z.boolean().optional(),
  outcome: z.enum(["success", "failure", "failed", "error"]).optional(),
}).passthrough(); // Allow additional fields for metadata

/**
 * Custom validation to ensure required fields are present
 */
function validateRequiredFields(data: z.infer<typeof rawEventSchema>): string[] {
  const errors: string[] = [];
  
  // Check for at least one actor identifier
  if (!data.user && !data.userId && !data.actor && !data.actorId) {
    errors.push("At least one actor identifier required (user, userId, actor, or actorId)");
  }
  
  // Check for at least one action type
  if (!data.action && !data.actionType && !data.type) {
    errors.push("At least one action type required (action, actionType, or type)");
  }
  
  return errors;
}

// ============================================
// API Route Handler
// ============================================

interface RouteParams {
  params: Promise<{ sourceKey: string }>;
}

export async function POST(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  const { sourceKey } = await params;
  
  // ----------------------------------------
  // 1. Validate API Key (Requirement 1.2)
  // ----------------------------------------
  const apiKey = request.headers.get("x-api-key");
  
  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing API key" },
      { status: 401 }
    );
  }
  
  const source = await sourceService.validateApiKey(sourceKey, apiKey);
  
  if (!source) {
    return NextResponse.json(
      { error: "Invalid API key" },
      { status: 401 }
    );
  }
  
  // ----------------------------------------
  // 2. Check Rate Limit (Requirement 1.3)
  // ----------------------------------------
  const rateLimitResult = checkRateLimit(sourceKey, source.rateLimit);
  
  if (!rateLimitResult.allowed) {
    const retryAfter = Math.ceil(
      (rateLimitResult.resetAt.getTime() - Date.now()) / 1000
    );
    
    return NextResponse.json(
      { 
        error: "Rate limit exceeded",
        retryAfter 
      },
      { 
        status: 429,
        headers: {
          "Retry-After": retryAfter.toString(),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": rateLimitResult.resetAt.toISOString(),
        }
      }
    );
  }
  
  // ----------------------------------------
  // 3. Parse and Validate Payload (Requirement 1.5)
  // ----------------------------------------
  let body: unknown;
  
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { 
        error: "Invalid JSON payload",
        details: [{ message: "Request body must be valid JSON" }]
      },
      { status: 400 }
    );
  }
  
  // Validate against schema
  const parseResult = rawEventSchema.safeParse(body);
  
  if (!parseResult.success) {
    return NextResponse.json(
      {
        error: "Validation failed",
        details: parseResult.error.issues.map((e) => ({
          path: e.path.map(String).join("."),
          message: e.message,
        })),
      },
      { status: 400 }
    );
  }
  
  // Check required fields
  const requiredFieldErrors = validateRequiredFields(parseResult.data);
  
  if (requiredFieldErrors.length > 0) {
    return NextResponse.json(
      {
        error: "Validation failed",
        details: requiredFieldErrors.map(message => ({ message })),
      },
      { status: 400 }
    );
  }
  
  // ----------------------------------------
  // 4. Normalize Event (Requirement 1.4)
  // ----------------------------------------
  const normalizationResult = normalizeEvent(parseResult.data, source);
  
  if (!normalizationResult.success || !normalizationResult.event) {
    return NextResponse.json(
      {
        error: "Normalization failed",
        details: [{ message: normalizationResult.error || "Unknown error" }],
      },
      { status: 400 }
    );
  }
  
  const normalizedEvent = normalizationResult.event;
  
  // ----------------------------------------
  // 5. Persist Event (Requirement 1.4)
  // ----------------------------------------
  try {
    await prisma.event.create({
      data: {
        id: normalizedEvent.id,
        occurredAt: normalizedEvent.occurredAt,
        ingestedAt: normalizedEvent.ingestedAt,
        actorId: normalizedEvent.actorId,
        actorType: normalizedEvent.actorType,
        sourceId: normalizedEvent.sourceId,
        actionType: normalizedEvent.actionType,
        resourceType: normalizedEvent.resourceType,
        resourceId: normalizedEvent.resourceId,
        outcome: normalizedEvent.outcome,
        ip: normalizedEvent.ip,
        userAgent: normalizedEvent.userAgent,
        bytes: normalizedEvent.bytes,
        metadata: normalizedEvent.metadata as object,
      },
    });
    
    // Update or create Actor record
    await prisma.actor.upsert({
      where: { actorId: normalizedEvent.actorId },
      create: {
        actorId: normalizedEvent.actorId,
        actorType: normalizedEvent.actorType,
        firstSeen: normalizedEvent.occurredAt,
        lastSeen: normalizedEvent.occurredAt,
      },
      update: {
        lastSeen: normalizedEvent.occurredAt,
      },
    });
  } catch (error) {
    console.error("Failed to persist event:", error);
    return NextResponse.json(
      { error: "Failed to store event" },
      { status: 500 }
    );
  }
  
  // ----------------------------------------
  // 6. Return Success (Requirement 1.1)
  // ----------------------------------------
  return NextResponse.json(
    { eventId: normalizedEvent.id },
    { 
      status: 202,
      headers: {
        "X-RateLimit-Remaining": rateLimitResult.remaining.toString(),
        "X-RateLimit-Reset": rateLimitResult.resetAt.toISOString(),
      }
    }
  );
}
