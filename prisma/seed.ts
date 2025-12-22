import { neonConfig } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma";
import bcrypt from "bcryptjs";
import ws from "ws";
import "dotenv/config";

// Configure Neon for serverless environments
neonConfig.webSocketConstructor = ws;

const connectionString = process.env.DATABASE_URL!;
const adapter = new PrismaNeon({ connectionString });
const prisma = new PrismaClient({ adapter });

// ============================================
// Source Configuration
// ============================================

interface SourceConfig {
  key: string;
  name: string;
  description: string;
  apiKey: string; // Plaintext key for testing - will be hashed
  redactResourceId: boolean;
  retentionDays: number;
  rateLimit: number;
}

// Test sources with known API keys for development/testing
const TEST_SOURCES: SourceConfig[] = [
  {
    key: "vpn",
    name: "VPN Logs",
    description: "VPN connection and authentication events",
    apiKey: "irm_vpn_test_key_12345678901234567890",
    redactResourceId: false,
    retentionDays: 90,
    rateLimit: 1000,
  },
  {
    key: "iam",
    name: "IAM Events",
    description: "Identity and access management events",
    apiKey: "irm_iam_test_key_12345678901234567890",
    redactResourceId: false,
    retentionDays: 90,
    rateLimit: 1000,
  },
  {
    key: "app",
    name: "Application Logs",
    description: "Application-level security events",
    apiKey: "irm_app_test_key_12345678901234567890",
    redactResourceId: true, // Redact resource IDs for app logs
    retentionDays: 90,
    rateLimit: 1000,
  },
];

async function main() {
  console.log("🌱 Seeding database...");

  // ----------------------------------------
  // Seed Admin User
  // ----------------------------------------
  const adminEmail = process.env.ADMIN_EMAIL || "admin@example.com";
  const adminPassword = process.env.ADMIN_PASSWORD || "admin123";
  const adminName = process.env.ADMIN_NAME || "Admin User";

  const passwordHash = await bcrypt.hash(adminPassword, 10);

  const adminUser = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      passwordHash,
      name: adminName,
    },
    create: {
      email: adminEmail,
      passwordHash,
      name: adminName,
      role: "admin",
    },
  });

  console.log(`✅ Admin user created/updated: ${adminUser.email}`);

  // ----------------------------------------
  // Seed Test Sources
  // ----------------------------------------
  console.log("\n📡 Creating test sources...");

  for (const sourceConfig of TEST_SOURCES) {
    const apiKeyHash = await bcrypt.hash(sourceConfig.apiKey, 10);

    const source = await prisma.source.upsert({
      where: { key: sourceConfig.key },
      update: {
        name: sourceConfig.name,
        description: sourceConfig.description,
        apiKeyHash,
        redactResourceId: sourceConfig.redactResourceId,
        retentionDays: sourceConfig.retentionDays,
        rateLimit: sourceConfig.rateLimit,
        enabled: true,
      },
      create: {
        key: sourceConfig.key,
        name: sourceConfig.name,
        description: sourceConfig.description,
        apiKeyHash,
        redactResourceId: sourceConfig.redactResourceId,
        retentionDays: sourceConfig.retentionDays,
        rateLimit: sourceConfig.rateLimit,
        enabled: true,
      },
    });

    console.log(`  ✅ Source "${source.key}" created/updated`);
    console.log(`     API Key: ${sourceConfig.apiKey}`);
  }

  // ----------------------------------------
  // Seed Default Scoring Rules
  // ----------------------------------------
  console.log("\n📊 Creating default scoring rules...");

  const defaultRules = [
    {
      ruleKey: "off_hours",
      name: "Off-Hours Activity",
      description: "Activity outside typical working hours (before 6am or after 10pm)",
      weight: 15,
      threshold: 2,
      windowMinutes: 60,
    },
    {
      ruleKey: "new_ip",
      name: "New IP Address",
      description: "First-seen IP address in the last 14 days",
      weight: 15,
      threshold: 1,
      windowMinutes: 60,
    },
    {
      ruleKey: "volume_spike",
      name: "Volume Spike",
      description: "Data transfer exceeds 3x baseline average",
      weight: 25,
      threshold: 3,
      windowMinutes: 60,
    },
    {
      ruleKey: "scope_expansion",
      name: "Resource Scope Expansion",
      description: "Accessing 2x more resources than normal",
      weight: 20,
      threshold: 2,
      windowMinutes: 60,
    },
    {
      ruleKey: "failure_burst",
      name: "Failure Burst",
      description: "Multiple failures in a short time window",
      weight: 25,
      threshold: 5,
      windowMinutes: 10,
    },
  ];

  for (const rule of defaultRules) {
    await prisma.scoringRule.upsert({
      where: { ruleKey: rule.ruleKey },
      update: {
        name: rule.name,
        description: rule.description,
        weight: rule.weight,
        threshold: rule.threshold,
        windowMinutes: rule.windowMinutes,
        enabled: true,
      },
      create: {
        ruleKey: rule.ruleKey,
        name: rule.name,
        description: rule.description,
        weight: rule.weight,
        threshold: rule.threshold,
        windowMinutes: rule.windowMinutes,
        enabled: true,
      },
    });

    console.log(`  ✅ Rule "${rule.ruleKey}" created/updated`);
  }

  // ----------------------------------------
  // Seed Default System Settings
  // ----------------------------------------
  console.log("\n⚙️ Creating default system settings...");

  const defaultSettings = [
    { key: "alert_threshold", value: { threshold: 60 } },
    { key: "baseline_window_days", value: { days: 14 } },
    { key: "deduplication_window_minutes", value: { minutes: 60 } },
    { key: "retention_days", value: { days: 90 } },
  ];

  for (const setting of defaultSettings) {
    await prisma.systemSetting.upsert({
      where: { key: setting.key },
      update: { value: setting.value },
      create: { key: setting.key, value: setting.value },
    });

    console.log(`  ✅ Setting "${setting.key}" created/updated`);
  }

  console.log("\n🌱 Seeding complete!");
  console.log("\n📋 Test API Keys for curl commands:");
  console.log("─".repeat(60));
  for (const source of TEST_SOURCES) {
    console.log(`  ${source.key}: ${source.apiKey}`);
  }
  console.log("─".repeat(60));
}

main()
  .catch((e) => {
    console.error("❌ Seeding failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
