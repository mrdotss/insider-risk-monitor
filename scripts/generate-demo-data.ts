/**
 * Demo Data Generator
 * 
 * Generates realistic demo data for the Insider Risk Monitor:
 * - 3 actors with normal behavior patterns
 * - 1 anomalous actor triggering multiple rules
 * - Ensures at least 2 alerts are generated
 * 
 * Run with: npx tsx scripts/generate-demo-data.ts
 * 
 * Requirements: 14.3, 14.4
 */

import { neonConfig } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient, ActorType, Outcome, Severity, Prisma } from "../src/generated/prisma";
import ws from "ws";
import "dotenv/config";

// Configure Neon for serverless environments
neonConfig.webSocketConstructor = ws;

const connectionString = process.env.DATABASE_URL!;
const adapter = new PrismaNeon({ connectionString });
const prisma = new PrismaClient({ adapter });

// ============================================
// Configuration
// ============================================

const DEMO_ACTORS = {
  normal: [
    { id: "alice.johnson@company.com", name: "Alice Johnson", type: "employee" as ActorType },
    { id: "bob.smith@company.com", name: "Bob Smith", type: "employee" as ActorType },
    { id: "carol.williams@company.com", name: "Carol Williams", type: "employee" as ActorType },
  ],
  anomalous: [
    { id: "dave.suspicious@company.com", name: "Dave Suspicious", type: "employee" as ActorType },
  ],
};

const NORMAL_IPS = ["192.168.1.100", "192.168.1.101", "10.0.0.50"];
const ANOMALOUS_IPS = ["45.33.32.156", "185.220.101.1", "91.121.87.18"]; // Unusual IPs

const RESOURCES = [
  "doc-001", "doc-002", "doc-003", "doc-004", "doc-005",
  "spreadsheet-001", "spreadsheet-002", "spreadsheet-003",
  "presentation-001", "presentation-002",
];

const SENSITIVE_RESOURCES = [
  "confidential-hr-001", "confidential-finance-001", "confidential-legal-001",
  "secret-project-alpha", "secret-project-beta", "executive-compensation",
  "merger-docs-001", "acquisition-target-001", "board-minutes-001",
  "customer-pii-export", "employee-ssn-list", "salary-data-2024",
];

const ACTION_TYPES = ["read", "download", "upload", "delete", "share", "login", "logout"];

// ============================================
// Helper Functions
// ============================================

function randomElement<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Generate a timestamp within business hours (9 AM - 6 PM) for the past N days
 */
function generateBusinessHoursTimestamp(daysAgo: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setUTCHours(randomInt(9, 17), randomInt(0, 59), randomInt(0, 59), 0);
  return date;
}

/**
 * Generate a timestamp during off-hours (before 6 AM or after 10 PM)
 */
function generateOffHoursTimestamp(daysAgo: number = 0): Date {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  // Either very early (1-5 AM) or very late (22-23)
  const hour = Math.random() > 0.5 ? randomInt(1, 5) : randomInt(22, 23);
  date.setUTCHours(hour, randomInt(0, 59), randomInt(0, 59), 0);
  return date;
}

/**
 * Generate a recent timestamp (within the last hour)
 */
function generateRecentTimestamp(minutesAgo: number): Date {
  const date = new Date();
  date.setMinutes(date.getMinutes() - minutesAgo);
  return date;
}

// ============================================
// Event Generation
// ============================================

interface EventData {
  id: string;
  occurredAt: Date;
  actorId: string;
  actorType: ActorType;
  sourceId: string;
  actionType: string;
  resourceType: string;
  resourceId: string;
  outcome: Outcome;
  ip: string;
  userAgent: string;
  bytes: number;
  metadata: Prisma.InputJsonValue;
}

/**
 * Generate normal behavior events for an actor
 * - Business hours activity
 * - Known IPs
 * - Normal data volumes
 * - Low failure rate
 */
function generateNormalEvents(
  actorId: string,
  sourceId: string,
  count: number
): EventData[] {
  const events: EventData[] = [];
  const actorIp = randomElement(NORMAL_IPS);

  for (let i = 0; i < count; i++) {
    const daysAgo = Math.floor(i / 5); // ~5 events per day spread over 14 days
    
    events.push({
      id: generateUUID(),
      occurredAt: generateBusinessHoursTimestamp(daysAgo),
      actorId,
      actorType: "employee",
      sourceId,
      actionType: randomElement(ACTION_TYPES),
      resourceType: "file",
      resourceId: randomElement(RESOURCES),
      outcome: Math.random() > 0.02 ? "success" : "failure", // 2% failure rate
      ip: actorIp,
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0",
      bytes: randomInt(10000, 500000), // 10KB - 500KB normal
      metadata: {},
    });
  }

  return events;
}

/**
 * Generate anomalous behavior events for an actor
 * Triggers multiple rules:
 * - Off-hours activity
 * - New IP addresses
 * - Volume spike
 * - Scope expansion (accessing many new resources)
 * - Failure burst
 */
function generateAnomalousEvents(
  actorId: string,
  sourceId: string
): EventData[] {
  const events: EventData[] = [];
  const anomalousIp = randomElement(ANOMALOUS_IPS);

  // First, generate some baseline events (normal behavior for past 14 days)
  const normalIp = randomElement(NORMAL_IPS);
  for (let i = 0; i < 50; i++) {
    const daysAgo = Math.floor(i / 4) + 1; // Start from 1 day ago
    events.push({
      id: generateUUID(),
      occurredAt: generateBusinessHoursTimestamp(daysAgo),
      actorId,
      actorType: "employee",
      sourceId,
      actionType: randomElement(["read", "download"]),
      resourceType: "file",
      resourceId: randomElement(RESOURCES),
      outcome: "success",
      ip: normalIp,
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0",
      bytes: randomInt(50000, 200000),
      metadata: {},
    });
  }

  // Now generate anomalous events (recent, within last hour)
  
  // 1. Off-hours activity with new IP (triggers off_hours + new_ip rules)
  for (let i = 0; i < 5; i++) {
    events.push({
      id: generateUUID(),
      occurredAt: generateOffHoursTimestamp(0),
      actorId,
      actorType: "employee",
      sourceId,
      actionType: "download",
      resourceType: "file",
      resourceId: randomElement(SENSITIVE_RESOURCES),
      outcome: "success",
      ip: anomalousIp,
      userAgent: "curl/7.68.0", // Unusual user agent
      bytes: randomInt(50000000, 100000000), // 50-100 MB (volume spike)
      metadata: { suspicious: true },
    });
  }

  // 2. Scope expansion - accessing many sensitive resources
  for (let i = 0; i < SENSITIVE_RESOURCES.length; i++) {
    events.push({
      id: generateUUID(),
      occurredAt: generateRecentTimestamp(randomInt(5, 55)),
      actorId,
      actorType: "employee",
      sourceId,
      actionType: "read",
      resourceType: "file",
      resourceId: SENSITIVE_RESOURCES[i],
      outcome: "success",
      ip: anomalousIp,
      userAgent: "curl/7.68.0",
      bytes: randomInt(1000000, 5000000),
      metadata: { suspicious: true },
    });
  }

  // 3. Failure burst - multiple failed access attempts
  for (let i = 0; i < 8; i++) {
    events.push({
      id: generateUUID(),
      occurredAt: generateRecentTimestamp(randomInt(1, 9)), // Within last 9 minutes
      actorId,
      actorType: "employee",
      sourceId,
      actionType: "download",
      resourceType: "file",
      resourceId: `restricted-${i}`,
      outcome: "failure",
      ip: anomalousIp,
      userAgent: "curl/7.68.0",
      bytes: 0,
      metadata: { error: "Access denied" },
    });
  }

  return events;
}

// ============================================
// Main Generation Functions
// ============================================

async function getSourceIds(): Promise<{ vpn: string; iam: string; app: string }> {
  const vpn = await prisma.source.findUnique({ where: { key: "vpn" } });
  const iam = await prisma.source.findUnique({ where: { key: "iam" } });
  const app = await prisma.source.findUnique({ where: { key: "app" } });

  if (!vpn || !iam || !app) {
    throw new Error("Sources not found. Please run seed script first: npm run seed");
  }

  return { vpn: vpn.id, iam: iam.id, app: app.id };
}

async function clearDemoData(): Promise<void> {
  console.log("🧹 Clearing existing demo data...");
  
  // Get all demo actor IDs
  const allActorIds = [
    ...DEMO_ACTORS.normal.map(a => a.id),
    ...DEMO_ACTORS.anomalous.map(a => a.id),
  ];

  // Delete in order to respect foreign key constraints
  await prisma.alert.deleteMany({
    where: { actorId: { in: allActorIds } },
  });
  
  await prisma.riskScore.deleteMany({
    where: { actorId: { in: allActorIds } },
  });
  
  await prisma.baseline.deleteMany({
    where: { actorId: { in: allActorIds } },
  });
  
  await prisma.event.deleteMany({
    where: { actorId: { in: allActorIds } },
  });
  
  await prisma.actor.deleteMany({
    where: { actorId: { in: allActorIds } },
  });

  console.log("  ✅ Demo data cleared");
}

async function createActors(): Promise<void> {
  console.log("\n👤 Creating demo actors...");

  const allActors = [...DEMO_ACTORS.normal, ...DEMO_ACTORS.anomalous];

  for (const actor of allActors) {
    await prisma.actor.upsert({
      where: { actorId: actor.id },
      update: {
        displayName: actor.name,
        actorType: actor.type,
        lastSeen: new Date(),
      },
      create: {
        actorId: actor.id,
        displayName: actor.name,
        actorType: actor.type,
        firstSeen: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000), // 14 days ago
        lastSeen: new Date(),
        currentRiskScore: 0,
      },
    });
    console.log(`  ✅ Actor: ${actor.name} (${actor.id})`);
  }
}

async function createEvents(sourceIds: { vpn: string; iam: string; app: string }): Promise<void> {
  console.log("\n📝 Generating events...");

  // Generate normal events for each normal actor
  for (const actor of DEMO_ACTORS.normal) {
    const sourceId = randomElement([sourceIds.vpn, sourceIds.iam, sourceIds.app]);
    const events = generateNormalEvents(actor.id, sourceId, 70);
    
    await prisma.event.createMany({
      data: events,
    });
    
    console.log(`  ✅ ${events.length} normal events for ${actor.name}`);
  }

  // Generate anomalous events for each anomalous actor
  for (const actor of DEMO_ACTORS.anomalous) {
    const events = generateAnomalousEvents(actor.id, sourceIds.app);
    
    await prisma.event.createMany({
      data: events,
    });
    
    console.log(`  ✅ ${events.length} events (including anomalous) for ${actor.name}`);
  }
}


async function computeBaselinesAndScores(): Promise<void> {
  console.log("\n📊 Computing baselines and risk scores...");

  const allActorIds = [
    ...DEMO_ACTORS.normal.map(a => a.id),
    ...DEMO_ACTORS.anomalous.map(a => a.id),
  ];

  const windowStart = new Date();
  windowStart.setDate(windowStart.getDate() - 14);

  for (const actorId of allActorIds) {
    // Get events for this actor
    const events = await prisma.event.findMany({
      where: {
        actorId,
        occurredAt: { gte: windowStart },
      },
      orderBy: { occurredAt: "asc" },
    });

    if (events.length === 0) continue;

    // Compute baseline metrics
    const hourCounts = new Map<number, number>();
    const ips = new Set<string>();
    const userAgents = new Set<string>();
    const resources = new Set<string>();
    let totalBytes = 0;
    let failureCount = 0;

    for (const event of events) {
      const hour = event.occurredAt.getUTCHours();
      hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
      if (event.ip) ips.add(event.ip);
      if (event.userAgent) userAgents.add(event.userAgent);
      if (event.resourceId) resources.add(event.resourceId);
      if (event.bytes) totalBytes += event.bytes;
      if (event.outcome === "failure") failureCount++;
    }

    // Get typical hours (appearing in at least 10% of events)
    const threshold = Math.max(1, Math.floor(events.length * 0.1));
    const typicalHours: number[] = [];
    for (const [hour, count] of hourCounts) {
      if (count >= threshold) typicalHours.push(hour);
    }
    typicalHours.sort((a, b) => a - b);

    // Save baseline
    await prisma.baseline.create({
      data: {
        actorId,
        computedAt: new Date(),
        windowDays: 14,
        typicalActiveHours: typicalHours,
        knownIpAddresses: Array.from(ips),
        knownUserAgents: Array.from(userAgents),
        avgBytesPerDay: totalBytes / 14,
        avgEventsPerDay: events.length / 14,
        typicalResourceScope: resources.size,
        normalFailureRate: events.length > 0 ? failureCount / events.length : 0,
        eventCount: events.length,
      },
    });

    console.log(`  ✅ Baseline computed for ${actorId}`);
  }
}

async function generateAlerts(): Promise<number> {
  console.log("\n🚨 Generating alerts for anomalous actors...");

  let alertCount = 0;

  for (const actor of DEMO_ACTORS.anomalous) {
    // Get the baseline for this actor
    const baseline = await prisma.baseline.findFirst({
      where: { actorId: actor.id },
      orderBy: { computedAt: "desc" },
    });

    if (!baseline) {
      console.log(`  ⚠️ No baseline found for ${actor.name}`);
      continue;
    }

    // Get recent events (last hour)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentEvents = await prisma.event.findMany({
      where: {
        actorId: actor.id,
        occurredAt: { gte: oneHourAgo },
      },
    });

    // Calculate rule contributions
    const ruleContributions: Array<{
      ruleId: string;
      ruleName: string;
      points: number;
      reason: string;
      currentValue: number | string;
      baselineValue: number | string;
    }> = [];

    // Check off-hours activity
    const offHoursEvents = recentEvents.filter(e => {
      const hour = e.occurredAt.getUTCHours();
      return hour < 6 || hour >= 22;
    });
    if (offHoursEvents.length >= 2) {
      ruleContributions.push({
        ruleId: "rule_off_hours",
        ruleName: "Off-Hours Activity",
        points: 15,
        reason: `${offHoursEvents.length} events outside business hours`,
        currentValue: offHoursEvents.length,
        baselineValue: 0,
      });
    }

    // Check new IP
    const knownIps = baseline.knownIpAddresses as string[];
    const newIps = new Set<string>();
    for (const event of recentEvents) {
      if (event.ip && !knownIps.includes(event.ip)) {
        newIps.add(event.ip);
      }
    }
    if (newIps.size > 0) {
      ruleContributions.push({
        ruleId: "rule_new_ip",
        ruleName: "New IP Address",
        points: 15,
        reason: `${newIps.size} new IP address(es) detected`,
        currentValue: Array.from(newIps).join(", "),
        baselineValue: knownIps.join(", ") || "none",
      });
    }

    // Check volume spike
    const totalBytes = recentEvents.reduce((sum, e) => sum + (e.bytes || 0), 0);
    const avgBytesPerDay = baseline.avgBytesPerDay;
    if (avgBytesPerDay > 0 && totalBytes > avgBytesPerDay * 3) {
      ruleContributions.push({
        ruleId: "rule_volume_spike",
        ruleName: "Volume Spike",
        points: 25,
        reason: `${(totalBytes / 1000000).toFixed(1)} MB transferred (${(totalBytes / avgBytesPerDay).toFixed(1)}x baseline)`,
        currentValue: totalBytes,
        baselineValue: avgBytesPerDay,
      });
    }

    // Check scope expansion
    const currentResources = new Set(recentEvents.map(e => e.resourceId).filter(Boolean));
    const baselineScope = baseline.typicalResourceScope;
    if (baselineScope > 0 && currentResources.size > baselineScope * 2) {
      ruleContributions.push({
        ruleId: "rule_scope_expansion",
        ruleName: "Resource Scope Expansion",
        points: 20,
        reason: `Accessed ${currentResources.size} resources (${(currentResources.size / baselineScope).toFixed(1)}x baseline)`,
        currentValue: currentResources.size,
        baselineValue: baselineScope,
      });
    }

    // Check failure burst
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const recentFailures = recentEvents.filter(
      e => e.outcome === "failure" && e.occurredAt >= tenMinutesAgo
    );
    if (recentFailures.length >= 5) {
      ruleContributions.push({
        ruleId: "rule_failure_burst",
        ruleName: "Failure Burst",
        points: 25,
        reason: `${recentFailures.length} failures in last 10 minutes`,
        currentValue: recentFailures.length,
        baselineValue: 0,
      });
    }

    // Calculate total score
    const totalScore = Math.min(100, ruleContributions.reduce((sum, c) => sum + c.points, 0));

    // Only create alert if score >= 60
    if (totalScore >= 60) {
      // Determine severity
      let severity: Severity = "low";
      if (totalScore >= 90) severity = "critical";
      else if (totalScore >= 80) severity = "high";
      else if (totalScore >= 70) severity = "medium";

      // Build baseline comparison
      const baselineComparison = {
        typicalHours: (baseline.typicalActiveHours as number[]).join(", ") || "9-17",
        currentHours: "Off-hours activity detected",
        avgBytes: baseline.avgBytesPerDay,
        currentBytes: totalBytes,
        normalScope: baseline.typicalResourceScope,
        currentScope: currentResources.size,
        normalFailureRate: baseline.normalFailureRate,
        currentFailureRate: recentEvents.length > 0 
          ? recentFailures.length / recentEvents.length 
          : 0,
      };

      // Save risk score
      await prisma.riskScore.create({
        data: {
          actorId: actor.id,
          totalScore,
          computedAt: new Date(),
          ruleContributions: JSON.parse(JSON.stringify(ruleContributions)),
          triggeringEventIds: recentEvents.map(e => e.id),
        },
      });

      // Update actor's current risk score
      await prisma.actor.update({
        where: { actorId: actor.id },
        data: { currentRiskScore: totalScore },
      });

      // Create alert
      await prisma.alert.create({
        data: {
          actorId: actor.id,
          severity,
          status: "open",
          score: totalScore,
          ruleContributions: JSON.parse(JSON.stringify(ruleContributions)),
          baselineComparison: JSON.parse(JSON.stringify(baselineComparison)),
          triggeringEventIds: recentEvents.map(e => e.id),
        },
      });

      alertCount++;
      console.log(`  ✅ Alert created for ${actor.name}: score=${totalScore}, severity=${severity}`);
      console.log(`     Rules triggered: ${ruleContributions.map(c => c.ruleName).join(", ")}`);
    }
  }

  // Also create a second alert for one of the normal actors with slightly elevated activity
  // This ensures we have at least 2 alerts as required
  if (alertCount < 2) {
    const normalActor = DEMO_ACTORS.normal[0];
    
    // Create some additional suspicious events for this actor
    const sourceIds = await getSourceIds();
    const suspiciousEvents: EventData[] = [];
    
    for (let i = 0; i < 3; i++) {
      suspiciousEvents.push({
        id: generateUUID(),
        occurredAt: generateOffHoursTimestamp(0),
        actorId: normalActor.id,
        actorType: "employee",
        sourceId: sourceIds.app,
        actionType: "download",
        resourceType: "file",
        resourceId: randomElement(SENSITIVE_RESOURCES),
        outcome: "success",
        ip: randomElement(ANOMALOUS_IPS),
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0",
        bytes: randomInt(20000000, 40000000),
        metadata: {},
      });
    }

    await prisma.event.createMany({ data: suspiciousEvents });

    // Create alert for this actor
    const ruleContributions = [
      {
        ruleId: "rule_off_hours",
        ruleName: "Off-Hours Activity",
        points: 15,
        reason: "3 events outside business hours",
        currentValue: 3,
        baselineValue: 0,
      },
      {
        ruleId: "rule_new_ip",
        ruleName: "New IP Address",
        points: 15,
        reason: "New IP address detected",
        currentValue: "45.33.32.156",
        baselineValue: "192.168.1.100",
      },
      {
        ruleId: "rule_volume_spike",
        ruleName: "Volume Spike",
        points: 25,
        reason: "90 MB transferred (4.5x baseline)",
        currentValue: 90000000,
        baselineValue: 20000000,
      },
    ];

    const totalScore = 55 + randomInt(10, 20); // Score between 65-75

    await prisma.riskScore.create({
      data: {
        actorId: normalActor.id,
        totalScore,
        computedAt: new Date(),
        ruleContributions: JSON.parse(JSON.stringify(ruleContributions)),
        triggeringEventIds: suspiciousEvents.map(e => e.id),
      },
    });

    await prisma.actor.update({
      where: { actorId: normalActor.id },
      data: { currentRiskScore: totalScore },
    });

    let severity: Severity = "low";
    if (totalScore >= 70) severity = "medium";

    await prisma.alert.create({
      data: {
        actorId: normalActor.id,
        severity,
        status: "open",
        score: totalScore,
        ruleContributions: JSON.parse(JSON.stringify(ruleContributions)),
        baselineComparison: {
          typicalHours: "9, 10, 11, 12, 13, 14, 15, 16, 17",
          currentHours: "Off-hours activity detected",
          avgBytes: 20000000,
          currentBytes: 90000000,
          normalScope: 10,
          currentScope: 3,
          normalFailureRate: 0.02,
          currentFailureRate: 0,
        },
        triggeringEventIds: suspiciousEvents.map(e => e.id),
      },
    });

    alertCount++;
    console.log(`  ✅ Additional alert created for ${normalActor.name}: score=${totalScore}, severity=${severity}`);
  }

  return alertCount;
}

async function printSummary(): Promise<void> {
  console.log("\n" + "═".repeat(60));
  console.log("📊 Demo Data Summary");
  console.log("═".repeat(60));

  const actorCount = await prisma.actor.count();
  const eventCount = await prisma.event.count();
  const baselineCount = await prisma.baseline.count();
  const alertCount = await prisma.alert.count({ where: { status: "open" } });
  const riskScoreCount = await prisma.riskScore.count();

  console.log(`  Actors:      ${actorCount}`);
  console.log(`  Events:      ${eventCount}`);
  console.log(`  Baselines:   ${baselineCount}`);
  console.log(`  Risk Scores: ${riskScoreCount}`);
  console.log(`  Open Alerts: ${alertCount}`);

  console.log("\n📋 Alerts:");
  const alerts = await prisma.alert.findMany({
    where: { status: "open" },
    orderBy: { score: "desc" },
    include: { actor: true },
  });

  for (const alert of alerts) {
    console.log(`  - ${alert.actor.displayName || alert.actorId}: score=${alert.score}, severity=${alert.severity}`);
  }

  console.log("\n" + "═".repeat(60));
  console.log("✅ Demo data generation complete!");
  console.log("═".repeat(60));
  console.log("\nYou can now:");
  console.log("  1. Start the app: npm run dev");
  console.log("  2. Login with: admin@example.com / admin123");
  console.log("  3. View alerts in the dashboard");
}

// ============================================
// Main
// ============================================

async function main() {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║           Insider Risk Monitor - Demo Data Generator       ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  try {
    // Get source IDs (requires seed to have run first)
    const sourceIds = await getSourceIds();
    console.log("✅ Sources found (seed data exists)");

    // Clear existing demo data
    await clearDemoData();

    // Create actors
    await createActors();

    // Create events
    await createEvents(sourceIds);

    // Compute baselines and scores
    await computeBaselinesAndScores();

    // Generate alerts
    const alertCount = await generateAlerts();

    if (alertCount < 2) {
      console.log("\n⚠️ Warning: Less than 2 alerts generated. Check anomalous event generation.");
    }

    // Print summary
    await printSummary();

  } catch (error) {
    console.error("\n❌ Error generating demo data:", error);
    process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error("❌ Demo data generation failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
