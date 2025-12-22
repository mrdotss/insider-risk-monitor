import { neonConfig } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma";
import ws from "ws";
import "dotenv/config";

// Configure Neon for serverless environments
neonConfig.webSocketConstructor = ws;

const connectionString = process.env.DATABASE_URL!;
const adapter = new PrismaNeon({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("📊 Checking stored events...\n");

  // Count events
  const eventCount = await prisma.event.count();
  console.log(`Total events: ${eventCount}`);

  // Get recent events
  const events = await prisma.event.findMany({
    take: 10,
    orderBy: { ingestedAt: "desc" },
    include: { source: true },
  });

  console.log("\n📋 Recent events:");
  console.log("─".repeat(80));

  for (const event of events) {
    console.log(`  ID: ${event.id}`);
    console.log(`  Actor: ${event.actorId} (${event.actorType})`);
    console.log(`  Action: ${event.actionType}`);
    console.log(`  Source: ${event.source.key}`);
    console.log(`  Outcome: ${event.outcome}`);
    console.log(`  Occurred: ${event.occurredAt.toISOString()}`);
    console.log(`  IP: ${event.ip || "N/A"}`);
    console.log(`  Bytes: ${event.bytes || "N/A"}`);
    console.log("─".repeat(80));
  }

  // Count actors
  const actorCount = await prisma.actor.count();
  console.log(`\nTotal actors: ${actorCount}`);

  // List actors
  const actors = await prisma.actor.findMany({
    take: 10,
    orderBy: { lastSeen: "desc" },
  });

  console.log("\n👤 Actors:");
  for (const actor of actors) {
    console.log(`  - ${actor.actorId} (${actor.actorType}) - Last seen: ${actor.lastSeen.toISOString()}`);
  }
}

main()
  .catch((e) => {
    console.error("❌ Error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
