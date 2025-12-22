import { prisma } from "@/lib/db";
import { Source } from "@/types";
import bcrypt from "bcryptjs";
import crypto from "crypto";

// ============================================
// Types
// ============================================

export interface CreateSourceInput {
  key: string;
  name: string;
  description?: string;
  enabled?: boolean;
  redactResourceId?: boolean;
  retentionDays?: number;
  rateLimit?: number;
}

export interface UpdateSourceInput {
  name?: string;
  description?: string;
  enabled?: boolean;
  redactResourceId?: boolean;
  retentionDays?: number;
  rateLimit?: number;
}

export interface SourceWithApiKey {
  source: Source;
  apiKey: string; // Only returned on create/rotate
}

// ============================================
// API Key Generation
// ============================================

const API_KEY_PREFIX = "irm_"; // insider-risk-monitor prefix
const API_KEY_LENGTH = 32;
const BCRYPT_ROUNDS = 10;

/**
 * Generate a secure random API key with prefix
 */
export function generateApiKey(): string {
  const randomBytes = crypto.randomBytes(API_KEY_LENGTH);
  const key = randomBytes.toString("base64url").slice(0, API_KEY_LENGTH);
  return `${API_KEY_PREFIX}${key}`;
}

/**
 * Hash an API key using bcrypt for secure storage
 */
export async function hashApiKey(apiKey: string): Promise<string> {
  return bcrypt.hash(apiKey, BCRYPT_ROUNDS);
}

/**
 * Verify an API key against a stored hash
 */
export async function verifyApiKey(
  apiKey: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(apiKey, hash);
}

// ============================================
// Source Service
// ============================================

export const sourceService = {
  /**
   * Create a new source with generated API key
   * Returns the source and the plaintext API key (only time it's available)
   */
  async create(input: CreateSourceInput): Promise<SourceWithApiKey> {
    const apiKey = generateApiKey();
    const apiKeyHash = await hashApiKey(apiKey);

    const source = await prisma.source.create({
      data: {
        key: input.key,
        name: input.name,
        description: input.description,
        apiKeyHash,
        enabled: input.enabled ?? true,
        redactResourceId: input.redactResourceId ?? false,
        retentionDays: input.retentionDays ?? 90,
        rateLimit: input.rateLimit ?? 1000,
      },
    });

    return { source, apiKey };
  },

  /**
   * Get a source by its unique key
   */
  async getByKey(key: string): Promise<Source | null> {
    return prisma.source.findUnique({
      where: { key },
    });
  },

  /**
   * Get a source by its ID
   */
  async getById(id: string): Promise<Source | null> {
    return prisma.source.findUnique({
      where: { id },
    });
  },

  /**
   * List all sources
   */
  async list(): Promise<Source[]> {
    return prisma.source.findMany({
      orderBy: { createdAt: "desc" },
    });
  },

  /**
   * Update a source by ID
   */
  async update(id: string, input: UpdateSourceInput): Promise<Source> {
    return prisma.source.update({
      where: { id },
      data: input,
    });
  },

  /**
   * Delete a source by ID
   */
  async delete(id: string): Promise<Source> {
    return prisma.source.delete({
      where: { id },
    });
  },

  /**
   * Rotate API key for a source
   * Returns the new plaintext API key (only time it's available)
   */
  async rotateApiKey(id: string): Promise<SourceWithApiKey> {
    const apiKey = generateApiKey();
    const apiKeyHash = await hashApiKey(apiKey);

    const source = await prisma.source.update({
      where: { id },
      data: { apiKeyHash },
    });

    return { source, apiKey };
  },

  /**
   * Validate API key for a source
   * Returns the source if valid, null otherwise
   */
  async validateApiKey(
    sourceKey: string,
    apiKey: string
  ): Promise<Source | null> {
    const source = await this.getByKey(sourceKey);
    if (!source) {
      return null;
    }

    const isValid = await verifyApiKey(apiKey, source.apiKeyHash);
    if (!isValid) {
      return null;
    }

    // Check if source is enabled
    if (!source.enabled) {
      return null;
    }

    return source;
  },
};
