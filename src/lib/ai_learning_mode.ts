/**
 * AI Learning Mode
 * Learn user preferences, coding style, and behavior patterns
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { app } from "electron";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import Database from "better-sqlite3";

// =============================================================================
// TYPES
// =============================================================================

export type ProfileId = string & { __brand: "ProfileId" };
export type PatternId = string & { __brand: "PatternId" };
export type FeedbackId = string & { __brand: "FeedbackId" };

export type LearningDomain =
  | "coding_style"
  | "communication"
  | "preferences"
  | "workflow"
  | "terminology"
  | "tools"
  | "architecture";

export type PatternType =
  | "code_format"
  | "naming_convention"
  | "comment_style"
  | "error_handling"
  | "import_order"
  | "response_length"
  | "formality"
  | "explanation_depth"
  | "tool_preference"
  | "framework_preference"
  | "language_preference"
  | "shortcut"
  | "custom";

export type FeedbackType = "positive" | "negative" | "correction" | "preference";

export interface LearningProfile {
  id: ProfileId;
  name: string;
  description?: string;
  isActive: boolean;
  domains: LearningDomain[];
  patternCount: number;
  feedbackCount: number;
  confidence: number; // 0-1 overall learning confidence
  createdAt: number;
  updatedAt: number;
  lastLearnedAt?: number;
}

export interface LearnedPattern {
  id: PatternId;
  profileId: ProfileId;
  domain: LearningDomain;
  type: PatternType;
  name: string;
  description?: string;
  pattern: string; // The actual pattern/rule
  examples: PatternExample[];
  confidence: number; // 0-1 confidence in this pattern
  frequency: number; // How often seen
  weight: number; // Importance weight
  isEnabled: boolean;
  createdAt: number;
  updatedAt: number;
  lastMatchedAt?: number;
}

export interface PatternExample {
  input: string;
  output: string;
  context?: string;
  timestamp: number;
}

export interface UserFeedback {
  id: FeedbackId;
  profileId: ProfileId;
  patternId?: PatternId;
  type: FeedbackType;
  domain: LearningDomain;
  originalResponse: string;
  correctedResponse?: string;
  feedbackText?: string;
  context: FeedbackContext;
  appliedToPattern: boolean;
  createdAt: number;
}

export interface FeedbackContext {
  conversationId?: string;
  messageId?: string;
  appId?: string;
  language?: string;
  task?: string;
}

export interface StyleGuide {
  indentation: "spaces" | "tabs";
  indentSize: number;
  semicolons: boolean;
  quotes: "single" | "double";
  trailingComma: "none" | "es5" | "all";
  bracketSpacing: boolean;
  arrowParens: "always" | "avoid";
  lineWidth: number;
  endOfLine: "lf" | "crlf" | "auto";
  importOrder: string[];
  namingConventions: {
    variables: "camelCase" | "snake_case" | "PascalCase";
    functions: "camelCase" | "snake_case" | "PascalCase";
    classes: "PascalCase";
    constants: "UPPER_SNAKE_CASE" | "camelCase";
    files: "kebab-case" | "camelCase" | "snake_case" | "PascalCase";
  };
  commentStyle: {
    preferJSDoc: boolean;
    inlineComments: boolean;
    blockComments: boolean;
  };
}

export interface CommunicationPreferences {
  responseLength: "concise" | "moderate" | "detailed";
  formality: "casual" | "neutral" | "formal";
  codeComments: "minimal" | "moderate" | "verbose";
  explanationDepth: "brief" | "moderate" | "comprehensive";
  includeExamples: boolean;
  includeAlternatives: boolean;
  showStepByStep: boolean;
  preferredLanguage: string;
}

export interface LearningStats {
  totalProfiles: number;
  activeProfile?: ProfileId;
  totalPatterns: number;
  patternsByDomain: Record<LearningDomain, number>;
  patternsByType: Record<PatternType, number>;
  totalFeedback: number;
  feedbackByType: Record<FeedbackType, number>;
  averageConfidence: number;
  lastLearned?: number;
}

export type LearningEventType =
  | "profile:created"
  | "profile:updated"
  | "profile:activated"
  | "pattern:learned"
  | "pattern:updated"
  | "pattern:disabled"
  | "feedback:received"
  | "feedback:applied"
  | "style:updated"
  | "preferences:updated"
  | "error";

export interface LearningEvent {
  type: LearningEventType;
  profileId?: ProfileId;
  patternId?: PatternId;
  feedbackId?: FeedbackId;
  data?: any;
}

// =============================================================================
// DEFAULT VALUES
// =============================================================================

export const DEFAULT_STYLE_GUIDE: StyleGuide = {
  indentation: "spaces",
  indentSize: 2,
  semicolons: true,
  quotes: "double",
  trailingComma: "es5",
  bracketSpacing: true,
  arrowParens: "always",
  lineWidth: 100,
  endOfLine: "lf",
  importOrder: ["builtin", "external", "internal", "parent", "sibling", "index"],
  namingConventions: {
    variables: "camelCase",
    functions: "camelCase",
    classes: "PascalCase",
    constants: "UPPER_SNAKE_CASE",
    files: "kebab-case",
  },
  commentStyle: {
    preferJSDoc: true,
    inlineComments: true,
    blockComments: true,
  },
};

export const DEFAULT_COMMUNICATION_PREFS: CommunicationPreferences = {
  responseLength: "moderate",
  formality: "neutral",
  codeComments: "moderate",
  explanationDepth: "moderate",
  includeExamples: true,
  includeAlternatives: false,
  showStepByStep: true,
  preferredLanguage: "en",
};

// =============================================================================
// AI LEARNING MODE
// =============================================================================

export class AILearningMode extends EventEmitter {
  private db: Database.Database | null = null;
  private storageDir: string;
  private activeProfileId: ProfileId | null = null;
  private styleGuide: StyleGuide = { ...DEFAULT_STYLE_GUIDE };
  private communicationPrefs: CommunicationPreferences = { ...DEFAULT_COMMUNICATION_PREFS };

  constructor(storageDir?: string) {
    super();
    this.storageDir = storageDir || path.join(app.getPath("userData"), "ai-learning");
  }

  // ---------------------------------------------------------------------------
  // INITIALIZATION
  // ---------------------------------------------------------------------------

  async initialize(): Promise<void> {
    await fs.mkdir(this.storageDir, { recursive: true });

    const dbPath = path.join(this.storageDir, "learning.db");
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        is_active INTEGER DEFAULT 0,
        domains TEXT DEFAULT '[]',
        pattern_count INTEGER DEFAULT 0,
        feedback_count INTEGER DEFAULT 0,
        confidence REAL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_learned_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS patterns (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        domain TEXT NOT NULL,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        pattern TEXT NOT NULL,
        examples TEXT DEFAULT '[]',
        confidence REAL DEFAULT 0.5,
        frequency INTEGER DEFAULT 1,
        weight REAL DEFAULT 1.0,
        is_enabled INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_matched_at INTEGER,
        FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS feedback (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        pattern_id TEXT,
        type TEXT NOT NULL,
        domain TEXT NOT NULL,
        original_response TEXT NOT NULL,
        corrected_response TEXT,
        feedback_text TEXT,
        context TEXT DEFAULT '{}',
        applied_to_pattern INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
        FOREIGN KEY (pattern_id) REFERENCES patterns(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_patterns_profile ON patterns(profile_id);
      CREATE INDEX IF NOT EXISTS idx_patterns_domain ON patterns(domain);
      CREATE INDEX IF NOT EXISTS idx_patterns_type ON patterns(type);
      CREATE INDEX IF NOT EXISTS idx_feedback_profile ON feedback(profile_id);
      CREATE INDEX IF NOT EXISTS idx_feedback_pattern ON feedback(pattern_id);

      -- FTS for pattern search
      CREATE VIRTUAL TABLE IF NOT EXISTS patterns_fts USING fts5(
        name,
        description,
        pattern,
        content='patterns',
        content_rowid='rowid'
      );
    `);

    // Load active profile and settings
    await this.loadSettings();
  }

  async shutdown(): Promise<void> {
    await this.saveSettings();
    this.db?.close();
    this.db = null;
  }

  // ---------------------------------------------------------------------------
  // PROFILE MANAGEMENT
  // ---------------------------------------------------------------------------

  async createProfile(params: {
    name: string;
    description?: string;
    domains?: LearningDomain[];
  }): Promise<LearningProfile> {
    if (!this.db) throw new Error("Database not initialized");

    const id = randomUUID() as ProfileId;
    const now = Date.now();
    const domains = params.domains || Object.keys(DOMAIN_DEFAULTS) as LearningDomain[];

    this.db.prepare(`
      INSERT INTO profiles (id, name, description, domains, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, params.name, params.description || null, JSON.stringify(domains), now, now);

    const profile = this.getProfile(id);
    this.emitEvent("profile:created", id);
    return profile!;
  }

  getProfile(id: ProfileId): LearningProfile | null {
    if (!this.db) return null;

    const row = this.db.prepare("SELECT * FROM profiles WHERE id = ?").get(id) as any;
    return row ? this.rowToProfile(row) : null;
  }

  listProfiles(): LearningProfile[] {
    if (!this.db) return [];

    return this.db
      .prepare("SELECT * FROM profiles ORDER BY updated_at DESC")
      .all()
      .map((row: any) => this.rowToProfile(row));
  }

  async updateProfile(
    id: ProfileId,
    updates: Partial<{
      name: string;
      description: string;
      domains: LearningDomain[];
    }>
  ): Promise<LearningProfile | null> {
    if (!this.db) return null;

    const sets: string[] = [];
    const params: any[] = [];

    if (updates.name !== undefined) {
      sets.push("name = ?");
      params.push(updates.name);
    }
    if (updates.description !== undefined) {
      sets.push("description = ?");
      params.push(updates.description);
    }
    if (updates.domains !== undefined) {
      sets.push("domains = ?");
      params.push(JSON.stringify(updates.domains));
    }

    if (sets.length === 0) return this.getProfile(id);

    sets.push("updated_at = ?");
    params.push(Date.now());
    params.push(id);

    this.db.prepare(`UPDATE profiles SET ${sets.join(", ")} WHERE id = ?`).run(...params);
    this.emitEvent("profile:updated", id);

    return this.getProfile(id);
  }

  async deleteProfile(id: ProfileId): Promise<boolean> {
    if (!this.db) return false;

    if (this.activeProfileId === id) {
      this.activeProfileId = null;
    }

    const result = this.db.prepare("DELETE FROM profiles WHERE id = ?").run(id);
    return result.changes > 0;
  }

  async activateProfile(id: ProfileId): Promise<boolean> {
    if (!this.db) return false;

    // Deactivate all profiles
    this.db.prepare("UPDATE profiles SET is_active = 0").run();

    // Activate selected profile
    this.db.prepare("UPDATE profiles SET is_active = 1 WHERE id = ?").run(id);

    this.activeProfileId = id;
    await this.saveSettings();
    this.emitEvent("profile:activated", id);

    return true;
  }

  getActiveProfile(): LearningProfile | null {
    if (!this.db || !this.activeProfileId) return null;
    return this.getProfile(this.activeProfileId);
  }

  // ---------------------------------------------------------------------------
  // PATTERN LEARNING
  // ---------------------------------------------------------------------------

  async learnPattern(params: {
    profileId: ProfileId;
    domain: LearningDomain;
    type: PatternType;
    name: string;
    description?: string;
    pattern: string;
    examples?: PatternExample[];
    confidence?: number;
    weight?: number;
  }): Promise<LearnedPattern> {
    if (!this.db) throw new Error("Database not initialized");

    const id = randomUUID() as PatternId;
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO patterns (id, profile_id, domain, type, name, description, pattern, examples, confidence, weight, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      params.profileId,
      params.domain,
      params.type,
      params.name,
      params.description || null,
      params.pattern,
      JSON.stringify(params.examples || []),
      params.confidence || 0.5,
      params.weight || 1.0,
      now,
      now
    );

    // Update profile stats
    this.updateProfileStats(params.profileId);

    const pattern = this.getPattern(id);
    this.emitEvent("pattern:learned", params.profileId, id);
    return pattern!;
  }

  getPattern(id: PatternId): LearnedPattern | null {
    if (!this.db) return null;

    const row = this.db.prepare("SELECT * FROM patterns WHERE id = ?").get(id) as any;
    return row ? this.rowToPattern(row) : null;
  }

  listPatterns(filters?: {
    profileId?: ProfileId;
    domain?: LearningDomain;
    type?: PatternType;
    enabled?: boolean;
  }): LearnedPattern[] {
    if (!this.db) return [];

    let sql = "SELECT * FROM patterns WHERE 1=1";
    const params: any[] = [];

    if (filters?.profileId) {
      sql += " AND profile_id = ?";
      params.push(filters.profileId);
    }
    if (filters?.domain) {
      sql += " AND domain = ?";
      params.push(filters.domain);
    }
    if (filters?.type) {
      sql += " AND type = ?";
      params.push(filters.type);
    }
    if (filters?.enabled !== undefined) {
      sql += " AND is_enabled = ?";
      params.push(filters.enabled ? 1 : 0);
    }

    sql += " ORDER BY confidence DESC, frequency DESC";

    return this.db.prepare(sql).all(...params).map((row: any) => this.rowToPattern(row));
  }

  async updatePattern(
    id: PatternId,
    updates: Partial<{
      name: string;
      description: string;
      pattern: string;
      confidence: number;
      weight: number;
      isEnabled: boolean;
    }>
  ): Promise<LearnedPattern | null> {
    if (!this.db) return null;

    const sets: string[] = [];
    const params: any[] = [];

    if (updates.name !== undefined) {
      sets.push("name = ?");
      params.push(updates.name);
    }
    if (updates.description !== undefined) {
      sets.push("description = ?");
      params.push(updates.description);
    }
    if (updates.pattern !== undefined) {
      sets.push("pattern = ?");
      params.push(updates.pattern);
    }
    if (updates.confidence !== undefined) {
      sets.push("confidence = ?");
      params.push(updates.confidence);
    }
    if (updates.weight !== undefined) {
      sets.push("weight = ?");
      params.push(updates.weight);
    }
    if (updates.isEnabled !== undefined) {
      sets.push("is_enabled = ?");
      params.push(updates.isEnabled ? 1 : 0);
    }

    if (sets.length === 0) return this.getPattern(id);

    sets.push("updated_at = ?");
    params.push(Date.now());
    params.push(id);

    this.db.prepare(`UPDATE patterns SET ${sets.join(", ")} WHERE id = ?`).run(...params);
    this.emitEvent("pattern:updated", undefined, id);

    return this.getPattern(id);
  }

  async addPatternExample(id: PatternId, example: PatternExample): Promise<LearnedPattern | null> {
    if (!this.db) return null;

    const pattern = this.getPattern(id);
    if (!pattern) return null;

    const examples = [...pattern.examples, example];
    const newConfidence = Math.min(1, pattern.confidence + 0.05);

    this.db.prepare(`
      UPDATE patterns 
      SET examples = ?, confidence = ?, frequency = frequency + 1, updated_at = ?, last_matched_at = ?
      WHERE id = ?
    `).run(JSON.stringify(examples), newConfidence, Date.now(), Date.now(), id);

    return this.getPattern(id);
  }

  async deletePattern(id: PatternId): Promise<boolean> {
    if (!this.db) return false;

    const pattern = this.getPattern(id);
    if (!pattern) return false;

    this.db.prepare("DELETE FROM patterns WHERE id = ?").run(id);
    this.updateProfileStats(pattern.profileId);

    return true;
  }

  searchPatterns(query: string, profileId?: ProfileId): LearnedPattern[] {
    if (!this.db) return [];

    try {
      let sql = `
        SELECT p.* FROM patterns p
        JOIN patterns_fts fts ON p.rowid = fts.rowid
        WHERE patterns_fts MATCH ?
      `;
      const params: any[] = [this.formatFtsQuery(query)];

      if (profileId) {
        sql += " AND p.profile_id = ?";
        params.push(profileId);
      }

      sql += " ORDER BY rank LIMIT 20";

      return this.db.prepare(sql).all(...params).map((row: any) => this.rowToPattern(row));
    } catch {
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // FEEDBACK PROCESSING
  // ---------------------------------------------------------------------------

  async recordFeedback(params: {
    profileId: ProfileId;
    patternId?: PatternId;
    type: FeedbackType;
    domain: LearningDomain;
    originalResponse: string;
    correctedResponse?: string;
    feedbackText?: string;
    context?: FeedbackContext;
  }): Promise<UserFeedback> {
    if (!this.db) throw new Error("Database not initialized");

    const id = randomUUID() as FeedbackId;
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO feedback (id, profile_id, pattern_id, type, domain, original_response, corrected_response, feedback_text, context, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      params.profileId,
      params.patternId || null,
      params.type,
      params.domain,
      params.originalResponse,
      params.correctedResponse || null,
      params.feedbackText || null,
      JSON.stringify(params.context || {}),
      now
    );

    // Update profile feedback count
    this.db.prepare(`
      UPDATE profiles 
      SET feedback_count = feedback_count + 1, updated_at = ? 
      WHERE id = ?
    `).run(now, params.profileId);

    // Update pattern confidence based on feedback type
    if (params.patternId) {
      const delta = params.type === "positive" ? 0.1 : params.type === "negative" ? -0.1 : 0;
      if (delta !== 0) {
        this.db.prepare(`
          UPDATE patterns 
          SET confidence = MAX(0, MIN(1, confidence + ?)), updated_at = ?
          WHERE id = ?
        `).run(delta, now, params.patternId);
      }
    }

    const feedback = this.getFeedback(id);
    this.emitEvent("feedback:received", params.profileId, params.patternId, id);
    return feedback!;
  }

  getFeedback(id: FeedbackId): UserFeedback | null {
    if (!this.db) return null;

    const row = this.db.prepare("SELECT * FROM feedback WHERE id = ?").get(id) as any;
    return row ? this.rowToFeedback(row) : null;
  }

  listFeedback(filters?: {
    profileId?: ProfileId;
    patternId?: PatternId;
    type?: FeedbackType;
    domain?: LearningDomain;
    limit?: number;
  }): UserFeedback[] {
    if (!this.db) return [];

    let sql = "SELECT * FROM feedback WHERE 1=1";
    const params: any[] = [];

    if (filters?.profileId) {
      sql += " AND profile_id = ?";
      params.push(filters.profileId);
    }
    if (filters?.patternId) {
      sql += " AND pattern_id = ?";
      params.push(filters.patternId);
    }
    if (filters?.type) {
      sql += " AND type = ?";
      params.push(filters.type);
    }
    if (filters?.domain) {
      sql += " AND domain = ?";
      params.push(filters.domain);
    }

    sql += " ORDER BY created_at DESC";

    if (filters?.limit) {
      sql += " LIMIT ?";
      params.push(filters.limit);
    }

    return this.db.prepare(sql).all(...params).map((row: any) => this.rowToFeedback(row));
  }

  // ---------------------------------------------------------------------------
  // STYLE GUIDE & PREFERENCES
  // ---------------------------------------------------------------------------

  getStyleGuide(): StyleGuide {
    return { ...this.styleGuide };
  }

  async updateStyleGuide(updates: Partial<StyleGuide>): Promise<StyleGuide> {
    this.styleGuide = { ...this.styleGuide, ...updates };
    await this.saveSettings();
    this.emitEvent("style:updated");
    return this.styleGuide;
  }

  getCommunicationPreferences(): CommunicationPreferences {
    return { ...this.communicationPrefs };
  }

  async updateCommunicationPreferences(
    updates: Partial<CommunicationPreferences>
  ): Promise<CommunicationPreferences> {
    this.communicationPrefs = { ...this.communicationPrefs, ...updates };
    await this.saveSettings();
    this.emitEvent("preferences:updated");
    return this.communicationPrefs;
  }

  // ---------------------------------------------------------------------------
  // CONTEXT GENERATION
  // ---------------------------------------------------------------------------

  generatePromptContext(options?: {
    includeStyle?: boolean;
    includePreferences?: boolean;
    includePatterns?: boolean;
    domains?: LearningDomain[];
  }): string {
    const parts: string[] = [];
    const profile = this.getActiveProfile();

    if (!profile) return "";

    if (options?.includeStyle !== false) {
      parts.push(this.generateStyleContext());
    }

    if (options?.includePreferences !== false) {
      parts.push(this.generatePreferencesContext());
    }

    if (options?.includePatterns !== false) {
      const patterns = this.listPatterns({
        profileId: profile.id,
        enabled: true,
      }).filter(
        (p) => !options?.domains || options.domains.includes(p.domain)
      );

      if (patterns.length > 0) {
        parts.push(this.generatePatternsContext(patterns));
      }
    }

    return parts.filter(Boolean).join("\n\n");
  }

  private generateStyleContext(): string {
    const s = this.styleGuide;
    return `## User's Coding Style Preferences
- Indentation: ${s.indentSize} ${s.indentation}
- Semicolons: ${s.semicolons ? "always" : "never"}
- Quotes: ${s.quotes}
- Line width: ${s.lineWidth} characters
- Naming: variables=${s.namingConventions.variables}, functions=${s.namingConventions.functions}, classes=${s.namingConventions.classes}
- Comments: ${s.commentStyle.preferJSDoc ? "JSDoc preferred" : "inline"}`;
  }

  private generatePreferencesContext(): string {
    const p = this.communicationPrefs;
    return `## User's Communication Preferences
- Response length: ${p.responseLength}
- Formality: ${p.formality}
- Explanation depth: ${p.explanationDepth}
- Include examples: ${p.includeExamples ? "yes" : "no"}
- Show step-by-step: ${p.showStepByStep ? "yes" : "no"}`;
  }

  private generatePatternsContext(patterns: LearnedPattern[]): string {
    const grouped = patterns.reduce((acc, p) => {
      if (!acc[p.domain]) acc[p.domain] = [];
      acc[p.domain].push(p);
      return acc;
    }, {} as Record<string, LearnedPattern[]>);

    const parts = ["## Learned User Patterns"];

    for (const [domain, domainPatterns] of Object.entries(grouped)) {
      parts.push(`\n### ${domain}`);
      for (const p of domainPatterns.slice(0, 5)) {
        parts.push(`- ${p.name}: ${p.pattern}`);
      }
    }

    return parts.join("\n");
  }

  // ---------------------------------------------------------------------------
  // STATISTICS
  // ---------------------------------------------------------------------------

  getStats(): LearningStats {
    if (!this.db) {
      return {
        totalProfiles: 0,
        totalPatterns: 0,
        patternsByDomain: {} as Record<LearningDomain, number>,
        patternsByType: {} as Record<PatternType, number>,
        totalFeedback: 0,
        feedbackByType: {} as Record<FeedbackType, number>,
        averageConfidence: 0,
      };
    }

    const profileCount = this.db.prepare("SELECT COUNT(*) as count FROM profiles").get() as any;
    const patternCount = this.db.prepare("SELECT COUNT(*) as count FROM patterns").get() as any;
    const feedbackCount = this.db.prepare("SELECT COUNT(*) as count FROM feedback").get() as any;
    const avgConfidence = this.db.prepare("SELECT AVG(confidence) as avg FROM patterns").get() as any;

    const patternsByDomain: Record<LearningDomain, number> = {
      coding_style: 0,
      communication: 0,
      preferences: 0,
      workflow: 0,
      terminology: 0,
      tools: 0,
      architecture: 0,
    };

    const domainRows = this.db.prepare("SELECT domain, COUNT(*) as count FROM patterns GROUP BY domain").all() as any[];
    for (const row of domainRows) {
      patternsByDomain[row.domain as LearningDomain] = row.count;
    }

    const patternsByType: Record<PatternType, number> = {
      code_format: 0,
      naming_convention: 0,
      comment_style: 0,
      error_handling: 0,
      import_order: 0,
      response_length: 0,
      formality: 0,
      explanation_depth: 0,
      tool_preference: 0,
      framework_preference: 0,
      language_preference: 0,
      shortcut: 0,
      custom: 0,
    };

    const typeRows = this.db.prepare("SELECT type, COUNT(*) as count FROM patterns GROUP BY type").all() as any[];
    for (const row of typeRows) {
      patternsByType[row.type as PatternType] = row.count;
    }

    const feedbackByType: Record<FeedbackType, number> = {
      positive: 0,
      negative: 0,
      correction: 0,
      preference: 0,
    };

    const fbRows = this.db.prepare("SELECT type, COUNT(*) as count FROM feedback GROUP BY type").all() as any[];
    for (const row of fbRows) {
      feedbackByType[row.type as FeedbackType] = row.count;
    }

    return {
      totalProfiles: profileCount.count,
      activeProfile: this.activeProfileId || undefined,
      totalPatterns: patternCount.count,
      patternsByDomain,
      patternsByType,
      totalFeedback: feedbackCount.count,
      feedbackByType,
      averageConfidence: avgConfidence.avg || 0,
    };
  }

  // ---------------------------------------------------------------------------
  // PRIVATE HELPERS
  // ---------------------------------------------------------------------------

  private rowToProfile(row: any): LearningProfile {
    return {
      id: row.id as ProfileId,
      name: row.name,
      description: row.description,
      isActive: row.is_active === 1,
      domains: JSON.parse(row.domains || "[]"),
      patternCount: row.pattern_count,
      feedbackCount: row.feedback_count,
      confidence: row.confidence,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastLearnedAt: row.last_learned_at,
    };
  }

  private rowToPattern(row: any): LearnedPattern {
    return {
      id: row.id as PatternId,
      profileId: row.profile_id as ProfileId,
      domain: row.domain as LearningDomain,
      type: row.type as PatternType,
      name: row.name,
      description: row.description,
      pattern: row.pattern,
      examples: JSON.parse(row.examples || "[]"),
      confidence: row.confidence,
      frequency: row.frequency,
      weight: row.weight,
      isEnabled: row.is_enabled === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastMatchedAt: row.last_matched_at,
    };
  }

  private rowToFeedback(row: any): UserFeedback {
    return {
      id: row.id as FeedbackId,
      profileId: row.profile_id as ProfileId,
      patternId: row.pattern_id as PatternId,
      type: row.type as FeedbackType,
      domain: row.domain as LearningDomain,
      originalResponse: row.original_response,
      correctedResponse: row.corrected_response,
      feedbackText: row.feedback_text,
      context: JSON.parse(row.context || "{}"),
      appliedToPattern: row.applied_to_pattern === 1,
      createdAt: row.created_at,
    };
  }

  private updateProfileStats(profileId: ProfileId): void {
    if (!this.db) return;

    const patternStats = this.db.prepare(`
      SELECT COUNT(*) as count, AVG(confidence) as avg_confidence 
      FROM patterns WHERE profile_id = ?
    `).get(profileId) as any;

    this.db.prepare(`
      UPDATE profiles 
      SET pattern_count = ?, confidence = ?, updated_at = ?, last_learned_at = ?
      WHERE id = ?
    `).run(
      patternStats.count,
      patternStats.avg_confidence || 0,
      Date.now(),
      Date.now(),
      profileId
    );
  }

  private formatFtsQuery(query: string): string {
    const terms = query.trim().split(/\s+/).filter(Boolean);
    return terms.map((t) => `"${t}"*`).join(" OR ");
  }

  private async loadSettings(): Promise<void> {
    if (!this.db) return;

    try {
      const settings = this.db.prepare("SELECT key, value FROM settings").all() as any[];
      for (const { key, value } of settings) {
        if (key === "activeProfile") {
          this.activeProfileId = value as ProfileId;
        } else if (key === "styleGuide") {
          this.styleGuide = JSON.parse(value);
        } else if (key === "communicationPrefs") {
          this.communicationPrefs = JSON.parse(value);
        }
      }
    } catch {
      // Settings don't exist yet
    }
  }

  private async saveSettings(): Promise<void> {
    if (!this.db) return;

    const upsert = this.db.prepare(`
      INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)
    `);

    upsert.run("activeProfile", this.activeProfileId || "");
    upsert.run("styleGuide", JSON.stringify(this.styleGuide));
    upsert.run("communicationPrefs", JSON.stringify(this.communicationPrefs));
  }

  private emitEvent(
    type: LearningEventType,
    profileId?: ProfileId,
    patternId?: PatternId,
    feedbackId?: FeedbackId,
    data?: any
  ): void {
    const event: LearningEvent = { type, profileId, patternId, feedbackId, data };
    this.emit("learning:event", event);
  }

  subscribe(callback: (event: LearningEvent) => void): () => void {
    this.on("learning:event", callback);
    return () => this.off("learning:event", callback);
  }
}

// Domain defaults for pattern initialization
const DOMAIN_DEFAULTS = {
  coding_style: true,
  communication: true,
  preferences: true,
  workflow: true,
  terminology: true,
  tools: true,
  architecture: true,
};

// Global instance
let aiLearningMode: AILearningMode | null = null;

export function getAILearningMode(): AILearningMode {
  if (!aiLearningMode) {
    aiLearningMode = new AILearningMode();
  }
  return aiLearningMode;
}
