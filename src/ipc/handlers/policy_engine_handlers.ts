/**
 * Policy Engine Handlers
 * Content policies, license validation, privacy rules, and compliance
 * 
 * Features:
 * - Content policies: Define and enforce rules on dataset content
 * - License management: Track and validate licenses for datasets
 * - Privacy rules: PII detection, redaction, anonymization
 * - Retention policies: Auto-archive or delete old data
 * - Access control: Fine-grained permissions
 */

import { ipcMain, app } from "electron";
import * as fs from "fs-extra";
import * as path from "path";
import * as crypto from "crypto";
import log from "electron-log";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/db";
import { eq, and, lt, gt, sql, inArray } from "drizzle-orm";
import {
  datasetItems,
  studioDatasets,
} from "@/db/schema";

const logger = log.scope("policy_engine");

// ============================================================================
// Types
// ============================================================================

interface ContentPolicy {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  rules: PolicyRule[];
  actions: PolicyAction[];
  createdAt: Date;
  updatedAt: Date;
}

interface PolicyRule {
  id: string;
  type: "content" | "metadata" | "quality" | "size" | "age";
  field?: string;
  operator: "contains" | "not_contains" | "equals" | "not_equals" | "gt" | "lt" | "gte" | "lte" | "regex" | "exists" | "not_exists";
  value: any;
  caseSensitive?: boolean;
}

interface PolicyAction {
  type: "flag" | "quarantine" | "delete" | "redact" | "notify" | "tag";
  parameters?: Record<string, any>;
}

interface License {
  id: string;
  spdxId: string;
  name: string;
  url?: string;
  permissions: string[];
  conditions: string[];
  limitations: string[];
  commercial: boolean;
  attribution: boolean;
  shareAlike: boolean;
  createdAt: Date;
}

interface PrivacyRule {
  id: string;
  name: string;
  type: "pii" | "regex" | "keyword" | "pattern";
  pattern?: string;
  replacement?: string;
  enabled: boolean;
  categories: string[];  // email, phone, ssn, credit_card, etc.
}

interface RetentionPolicy {
  id: string;
  name: string;
  datasetId?: string;
  maxAgeDays: number;
  action: "archive" | "delete" | "notify";
  enabled: boolean;
  lastRun?: Date;
}

interface PolicyViolation {
  id: string;
  policyId: string;
  policyName: string;
  itemId: string;
  datasetId: string;
  ruleId: string;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  detectedAt: Date;
  resolved: boolean;
  resolvedAt?: Date;
  resolution?: string;
}

// ============================================================================
// Storage
// ============================================================================

let policiesDir: string;
let policies: Map<string, ContentPolicy> = new Map();
let licenses: Map<string, License> = new Map();
let privacyRules: Map<string, PrivacyRule> = new Map();
let retentionPolicies: Map<string, RetentionPolicy> = new Map();
let violations: Map<string, PolicyViolation> = new Map();

async function initializePolicyStorage() {
  policiesDir = path.join(app.getPath("userData"), "policy-engine");
  await fs.ensureDir(policiesDir);
  
  // Load policies
  const policiesFile = path.join(policiesDir, "policies.json");
  if (await fs.pathExists(policiesFile)) {
    const data = await fs.readJson(policiesFile);
    policies = new Map(Object.entries(data));
  }
  
  // Load licenses
  const licensesFile = path.join(policiesDir, "licenses.json");
  if (await fs.pathExists(licensesFile)) {
    const data = await fs.readJson(licensesFile);
    licenses = new Map(Object.entries(data));
  } else {
    // Initialize with common licenses
    initializeDefaultLicenses();
  }
  
  // Load privacy rules
  const privacyFile = path.join(policiesDir, "privacy-rules.json");
  if (await fs.pathExists(privacyFile)) {
    const data = await fs.readJson(privacyFile);
    privacyRules = new Map(Object.entries(data));
  } else {
    // Initialize with default PII rules
    initializeDefaultPrivacyRules();
  }
  
  // Load retention policies
  const retentionFile = path.join(policiesDir, "retention.json");
  if (await fs.pathExists(retentionFile)) {
    const data = await fs.readJson(retentionFile);
    retentionPolicies = new Map(Object.entries(data));
  }
  
  // Load violations
  const violationsFile = path.join(policiesDir, "violations.json");
  if (await fs.pathExists(violationsFile)) {
    const data = await fs.readJson(violationsFile);
    violations = new Map(Object.entries(data));
  }
}

async function savePolicies() {
  const policiesFile = path.join(policiesDir, "policies.json");
  await fs.writeJson(policiesFile, Object.fromEntries(policies), { spaces: 2 });
}

async function saveLicenses() {
  const licensesFile = path.join(policiesDir, "licenses.json");
  await fs.writeJson(licensesFile, Object.fromEntries(licenses), { spaces: 2 });
}

async function savePrivacyRules() {
  const privacyFile = path.join(policiesDir, "privacy-rules.json");
  await fs.writeJson(privacyFile, Object.fromEntries(privacyRules), { spaces: 2 });
}

async function saveRetentionPolicies() {
  const retentionFile = path.join(policiesDir, "retention.json");
  await fs.writeJson(retentionFile, Object.fromEntries(retentionPolicies), { spaces: 2 });
}

async function saveViolations() {
  const violationsFile = path.join(policiesDir, "violations.json");
  await fs.writeJson(violationsFile, Object.fromEntries(violations), { spaces: 2 });
}

// ============================================================================
// Default Data
// ============================================================================

function initializeDefaultLicenses() {
  const defaultLicenses: License[] = [
    {
      id: "mit",
      spdxId: "MIT",
      name: "MIT License",
      url: "https://opensource.org/licenses/MIT",
      permissions: ["commercial", "distribution", "modification", "private-use"],
      conditions: ["include-copyright"],
      limitations: ["liability", "warranty"],
      commercial: true,
      attribution: true,
      shareAlike: false,
      createdAt: new Date(),
    },
    {
      id: "apache-2.0",
      spdxId: "Apache-2.0",
      name: "Apache License 2.0",
      url: "https://opensource.org/licenses/Apache-2.0",
      permissions: ["commercial", "distribution", "modification", "patent-use", "private-use"],
      conditions: ["include-copyright", "document-changes"],
      limitations: ["liability", "trademark-use", "warranty"],
      commercial: true,
      attribution: true,
      shareAlike: false,
      createdAt: new Date(),
    },
    {
      id: "cc-by-4.0",
      spdxId: "CC-BY-4.0",
      name: "Creative Commons Attribution 4.0",
      url: "https://creativecommons.org/licenses/by/4.0/",
      permissions: ["commercial", "distribution", "modification"],
      conditions: ["attribution", "include-copyright"],
      limitations: ["liability", "warranty"],
      commercial: true,
      attribution: true,
      shareAlike: false,
      createdAt: new Date(),
    },
    {
      id: "cc-by-sa-4.0",
      spdxId: "CC-BY-SA-4.0",
      name: "Creative Commons Attribution-ShareAlike 4.0",
      url: "https://creativecommons.org/licenses/by-sa/4.0/",
      permissions: ["commercial", "distribution", "modification"],
      conditions: ["attribution", "include-copyright", "same-license"],
      limitations: ["liability", "warranty"],
      commercial: true,
      attribution: true,
      shareAlike: true,
      createdAt: new Date(),
    },
    {
      id: "cc-by-nc-4.0",
      spdxId: "CC-BY-NC-4.0",
      name: "Creative Commons Attribution-NonCommercial 4.0",
      url: "https://creativecommons.org/licenses/by-nc/4.0/",
      permissions: ["distribution", "modification"],
      conditions: ["attribution", "include-copyright", "non-commercial"],
      limitations: ["commercial-use", "liability", "warranty"],
      commercial: false,
      attribution: true,
      shareAlike: false,
      createdAt: new Date(),
    },
    {
      id: "cc0-1.0",
      spdxId: "CC0-1.0",
      name: "Creative Commons Zero 1.0",
      url: "https://creativecommons.org/publicdomain/zero/1.0/",
      permissions: ["commercial", "distribution", "modification", "private-use"],
      conditions: [],
      limitations: ["liability", "warranty"],
      commercial: true,
      attribution: false,
      shareAlike: false,
      createdAt: new Date(),
    },
    {
      id: "gpl-3.0",
      spdxId: "GPL-3.0",
      name: "GNU General Public License v3.0",
      url: "https://www.gnu.org/licenses/gpl-3.0.html",
      permissions: ["commercial", "distribution", "modification", "patent-use", "private-use"],
      conditions: ["disclose-source", "include-copyright", "same-license", "document-changes"],
      limitations: ["liability", "warranty"],
      commercial: true,
      attribution: true,
      shareAlike: true,
      createdAt: new Date(),
    },
    {
      id: "proprietary",
      spdxId: "PROPRIETARY",
      name: "Proprietary / All Rights Reserved",
      permissions: [],
      conditions: ["explicit-permission"],
      limitations: ["distribution", "modification", "commercial-use"],
      commercial: false,
      attribution: true,
      shareAlike: false,
      createdAt: new Date(),
    },
  ];
  
  for (const license of defaultLicenses) {
    licenses.set(license.id, license);
  }
}

function initializeDefaultPrivacyRules() {
  const defaultRules: PrivacyRule[] = [
    {
      id: "email",
      name: "Email Addresses",
      type: "regex",
      pattern: "\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Z|a-z]{2,}\\b",
      replacement: "[EMAIL]",
      enabled: true,
      categories: ["email", "contact"],
    },
    {
      id: "phone-us",
      name: "US Phone Numbers",
      type: "regex",
      pattern: "\\b(?:\\+?1[-.]?)?\\(?[0-9]{3}\\)?[-.]?[0-9]{3}[-.]?[0-9]{4}\\b",
      replacement: "[PHONE]",
      enabled: true,
      categories: ["phone", "contact"],
    },
    {
      id: "ssn",
      name: "Social Security Numbers",
      type: "regex",
      pattern: "\\b\\d{3}[-]?\\d{2}[-]?\\d{4}\\b",
      replacement: "[SSN]",
      enabled: true,
      categories: ["ssn", "government-id"],
    },
    {
      id: "credit-card",
      name: "Credit Card Numbers",
      type: "regex",
      pattern: "\\b(?:\\d{4}[-\\s]?){3}\\d{4}\\b",
      replacement: "[CREDIT_CARD]",
      enabled: true,
      categories: ["financial", "credit-card"],
    },
    {
      id: "ip-address",
      name: "IP Addresses",
      type: "regex",
      pattern: "\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b",
      replacement: "[IP_ADDRESS]",
      enabled: true,
      categories: ["network", "ip"],
    },
    {
      id: "date-of-birth",
      name: "Dates of Birth",
      type: "regex",
      pattern: "\\b(?:DOB|date of birth|born)\\s*:?\\s*\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4}\\b",
      replacement: "[DOB]",
      enabled: true,
      categories: ["personal", "dob"],
    },
  ];
  
  for (const rule of defaultRules) {
    privacyRules.set(rule.id, rule);
  }
}

// ============================================================================
// Policy Evaluation
// ============================================================================

function evaluateRule(rule: PolicyRule, item: any, content?: string): boolean {
  let fieldValue: any;
  
  switch (rule.type) {
    case "content":
      fieldValue = content || "";
      break;
    case "metadata":
      fieldValue = item.metadata?.[rule.field!];
      break;
    case "quality":
      fieldValue = item.qualitySignals?.[rule.field!];
      break;
    case "size":
      fieldValue = item.sizeBytes;
      break;
    case "age":
      fieldValue = (Date.now() - new Date(item.createdAt).getTime()) / (1000 * 60 * 60 * 24);
      break;
    default:
      return false;
  }
  
  const compareValue = rule.caseSensitive === false 
    ? String(fieldValue).toLowerCase() 
    : fieldValue;
  const ruleValue = rule.caseSensitive === false && typeof rule.value === "string"
    ? rule.value.toLowerCase()
    : rule.value;
  
  switch (rule.operator) {
    case "contains":
      return String(compareValue).includes(String(ruleValue));
    case "not_contains":
      return !String(compareValue).includes(String(ruleValue));
    case "equals":
      return compareValue == ruleValue;
    case "not_equals":
      return compareValue != ruleValue;
    case "gt":
      return Number(compareValue) > Number(ruleValue);
    case "lt":
      return Number(compareValue) < Number(ruleValue);
    case "gte":
      return Number(compareValue) >= Number(ruleValue);
    case "lte":
      return Number(compareValue) <= Number(ruleValue);
    case "regex":
      return new RegExp(String(ruleValue)).test(String(compareValue));
    case "exists":
      return fieldValue !== undefined && fieldValue !== null;
    case "not_exists":
      return fieldValue === undefined || fieldValue === null;
    default:
      return false;
  }
}

// ============================================================================
// IPC Handler Registration
// ============================================================================

export function registerPolicyEngineHandlers() {
  logger.info("Registering Policy Engine handlers");

  // Initialize storage on app ready
  app.whenReady().then(() => {
    initializePolicyStorage().catch(err => {
      logger.error("Failed to initialize policy storage:", err);
    });
  });

  // ========== Content Policies ==========

  /**
   * Create a content policy
   */
  ipcMain.handle("policy:create", async (_event, policy: Omit<ContentPolicy, "id" | "createdAt" | "updatedAt">) => {
    try {
      const newPolicy: ContentPolicy = {
        ...policy,
        id: uuidv4(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      policies.set(newPolicy.id, newPolicy);
      await savePolicies();
      
      return { success: true, policy: newPolicy };
    } catch (error) {
      logger.error("Create policy failed:", error);
      throw error;
    }
  });

  /**
   * List all policies
   */
  ipcMain.handle("policy:list", async () => {
    try {
      return { success: true, policies: Array.from(policies.values()) };
    } catch (error) {
      logger.error("List policies failed:", error);
      throw error;
    }
  });

  /**
   * Get a policy by ID
   */
  ipcMain.handle("policy:get", async (_event, policyId: string) => {
    try {
      const policy = policies.get(policyId);
      if (!policy) throw new Error("Policy not found");
      return { success: true, policy };
    } catch (error) {
      logger.error("Get policy failed:", error);
      throw error;
    }
  });

  /**
   * Update a policy
   */
  ipcMain.handle("policy:update", async (_event, policyId: string, updates: Partial<ContentPolicy>) => {
    try {
      const policy = policies.get(policyId);
      if (!policy) throw new Error("Policy not found");
      
      const updatedPolicy = {
        ...policy,
        ...updates,
        id: policy.id, // Can't change ID
        createdAt: policy.createdAt,
        updatedAt: new Date(),
      };
      
      policies.set(policyId, updatedPolicy);
      await savePolicies();
      
      return { success: true, policy: updatedPolicy };
    } catch (error) {
      logger.error("Update policy failed:", error);
      throw error;
    }
  });

  /**
   * Delete a policy
   */
  ipcMain.handle("policy:delete", async (_event, policyId: string) => {
    try {
      if (!policies.has(policyId)) throw new Error("Policy not found");
      
      policies.delete(policyId);
      await savePolicies();
      
      return { success: true };
    } catch (error) {
      logger.error("Delete policy failed:", error);
      throw error;
    }
  });

  /**
   * Evaluate policy against an item
   */
  ipcMain.handle("policy:evaluate-item", async (_event, args: {
    policyId: string;
    itemId: string;
  }) => {
    try {
      const { policyId, itemId } = args;
      
      const policy = policies.get(policyId);
      if (!policy) throw new Error("Policy not found");
      if (!policy.enabled) return { success: true, violations: [] };
      
      const [item] = await db.select().from(datasetItems).where(eq(datasetItems.id, itemId));
      if (!item) throw new Error("Item not found");
      
      // Load content if needed
      let content: string | undefined;
      if (policy.rules.some(r => r.type === "content")) {
        const storeDir = path.join(app.getPath("userData"), "content-store");
        const prefix = item.contentHash.substring(0, 2);
        const contentPath = path.join(storeDir, prefix, item.contentHash);
        try {
          content = await fs.readFile(contentPath, "utf-8");
        } catch {
          // File might be binary
        }
      }
      
      const itemViolations: PolicyViolation[] = [];
      
      for (const rule of policy.rules) {
        if (evaluateRule(rule, item, content)) {
          const violation: PolicyViolation = {
            id: uuidv4(),
            policyId: policy.id,
            policyName: policy.name,
            itemId: item.id,
            datasetId: item.datasetId,
            ruleId: rule.id,
            severity: "medium",
            description: `Rule "${rule.id}" matched: ${rule.type} ${rule.operator} "${rule.value}"`,
            detectedAt: new Date(),
            resolved: false,
          };
          
          itemViolations.push(violation);
          violations.set(violation.id, violation);
        }
      }
      
      if (itemViolations.length > 0) {
        await saveViolations();
      }
      
      return { success: true, violations: itemViolations };
    } catch (error) {
      logger.error("Evaluate item failed:", error);
      throw error;
    }
  });

  /**
   * Scan dataset with all enabled policies
   */
  ipcMain.handle("policy:scan-dataset", async (event, datasetId: string) => {
    try {
      const enabledPolicies = Array.from(policies.values()).filter(p => p.enabled);
      if (enabledPolicies.length === 0) {
        return { success: true, totalViolations: 0, violations: [] };
      }
      
      const items = await db.select().from(datasetItems).where(eq(datasetItems.datasetId, datasetId));
      const allViolations: PolicyViolation[] = [];
      
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        
        // Load content
        let content: string | undefined;
        const storeDir = path.join(app.getPath("userData"), "content-store");
        const prefix = item.contentHash.substring(0, 2);
        const contentPath = path.join(storeDir, prefix, item.contentHash);
        try {
          content = await fs.readFile(contentPath, "utf-8");
        } catch {
          // Binary file
        }
        
        for (const policy of enabledPolicies) {
          for (const rule of policy.rules) {
            if (evaluateRule(rule, item, content)) {
              const violation: PolicyViolation = {
                id: uuidv4(),
                policyId: policy.id,
                policyName: policy.name,
                itemId: item.id,
                datasetId: item.datasetId,
                ruleId: rule.id,
                severity: "medium",
                description: `Rule "${rule.id}" matched`,
                detectedAt: new Date(),
                resolved: false,
              };
              
              allViolations.push(violation);
              violations.set(violation.id, violation);
            }
          }
        }
        
        // Progress
        if ((i + 1) % 50 === 0 || i === items.length - 1) {
          event.sender.send("policy:scan-progress", {
            current: i + 1,
            total: items.length,
            violations: allViolations.length,
          });
        }
      }
      
      await saveViolations();
      
      return {
        success: true,
        totalItems: items.length,
        totalViolations: allViolations.length,
        violations: allViolations,
      };
    } catch (error) {
      logger.error("Scan dataset failed:", error);
      throw error;
    }
  });

  // ========== License Management ==========

  /**
   * List all licenses
   */
  ipcMain.handle("policy:list-licenses", async () => {
    try {
      return { success: true, licenses: Array.from(licenses.values()) };
    } catch (error) {
      logger.error("List licenses failed:", error);
      throw error;
    }
  });

  /**
   * Get license by ID
   */
  ipcMain.handle("policy:get-license", async (_event, licenseId: string) => {
    try {
      const license = licenses.get(licenseId);
      if (!license) throw new Error("License not found");
      return { success: true, license };
    } catch (error) {
      logger.error("Get license failed:", error);
      throw error;
    }
  });

  /**
   * Add custom license
   */
  ipcMain.handle("policy:add-license", async (_event, license: Omit<License, "id" | "createdAt">) => {
    try {
      const newLicense: License = {
        ...license,
        id: license.spdxId.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
        createdAt: new Date(),
      };
      
      licenses.set(newLicense.id, newLicense);
      await saveLicenses();
      
      return { success: true, license: newLicense };
    } catch (error) {
      logger.error("Add license failed:", error);
      throw error;
    }
  });

  /**
   * Validate license compatibility
   */
  ipcMain.handle("policy:validate-license-compatibility", async (_event, args: {
    sourceLicenses: string[];
    targetLicense: string;
    useCase: "commercial" | "academic" | "personal";
  }) => {
    try {
      const { sourceLicenses, targetLicense, useCase } = args;
      
      const target = licenses.get(targetLicense);
      if (!target) throw new Error("Target license not found");
      
      const issues: string[] = [];
      const warnings: string[] = [];
      
      for (const licenseId of sourceLicenses) {
        const source = licenses.get(licenseId);
        if (!source) {
          warnings.push(`Unknown license: ${licenseId}`);
          continue;
        }
        
        // Check commercial use
        if (useCase === "commercial" && !source.commercial) {
          issues.push(`${source.name} does not allow commercial use`);
        }
        
        // Check share-alike requirements
        if (source.shareAlike && !target.shareAlike) {
          issues.push(`${source.name} requires share-alike, but target license (${target.name}) is not share-alike`);
        }
        
        // Check attribution
        if (source.attribution && !target.attribution) {
          warnings.push(`${source.name} requires attribution - ensure proper credit is given`);
        }
      }
      
      return {
        success: true,
        compatible: issues.length === 0,
        issues,
        warnings,
      };
    } catch (error) {
      logger.error("Validate license compatibility failed:", error);
      throw error;
    }
  });

  /**
   * Set license for dataset
   */
  ipcMain.handle("policy:set-dataset-license", async (_event, args: {
    datasetId: string;
    licenseId: string;
  }) => {
    try {
      const { datasetId, licenseId } = args;
      
      const license = licenses.get(licenseId);
      if (!license) throw new Error("License not found");
      
      await db.update(studioDatasets)
        .set({ 
          license: license.spdxId,
          updatedAt: new Date(),
        })
        .where(eq(studioDatasets.id, datasetId));
      
      return { success: true, license };
    } catch (error) {
      logger.error("Set dataset license failed:", error);
      throw error;
    }
  });

  // ========== Privacy Rules ==========

  /**
   * List privacy rules
   */
  ipcMain.handle("policy:list-privacy-rules", async () => {
    try {
      return { success: true, rules: Array.from(privacyRules.values()) };
    } catch (error) {
      logger.error("List privacy rules failed:", error);
      throw error;
    }
  });

  /**
   * Add privacy rule
   */
  ipcMain.handle("policy:add-privacy-rule", async (_event, rule: Omit<PrivacyRule, "id">) => {
    try {
      const newRule: PrivacyRule = {
        ...rule,
        id: uuidv4(),
      };
      
      privacyRules.set(newRule.id, newRule);
      await savePrivacyRules();
      
      return { success: true, rule: newRule };
    } catch (error) {
      logger.error("Add privacy rule failed:", error);
      throw error;
    }
  });

  /**
   * Update privacy rule
   */
  ipcMain.handle("policy:update-privacy-rule", async (_event, ruleId: string, updates: Partial<PrivacyRule>) => {
    try {
      const rule = privacyRules.get(ruleId);
      if (!rule) throw new Error("Privacy rule not found");
      
      const updatedRule = { ...rule, ...updates, id: rule.id };
      privacyRules.set(ruleId, updatedRule);
      await savePrivacyRules();
      
      return { success: true, rule: updatedRule };
    } catch (error) {
      logger.error("Update privacy rule failed:", error);
      throw error;
    }
  });

  /**
   * Delete privacy rule
   */
  ipcMain.handle("policy:delete-privacy-rule", async (_event, ruleId: string) => {
    try {
      if (!privacyRules.has(ruleId)) throw new Error("Privacy rule not found");
      
      privacyRules.delete(ruleId);
      await savePrivacyRules();
      
      return { success: true };
    } catch (error) {
      logger.error("Delete privacy rule failed:", error);
      throw error;
    }
  });

  /**
   * Scan text for PII
   */
  ipcMain.handle("policy:scan-pii", async (_event, text: string) => {
    try {
      const enabledRules = Array.from(privacyRules.values()).filter(r => r.enabled);
      const findings: Array<{
        ruleId: string;
        ruleName: string;
        match: string;
        startIndex: number;
        endIndex: number;
        categories: string[];
      }> = [];
      
      for (const rule of enabledRules) {
        if (rule.type === "regex" && rule.pattern) {
          const regex = new RegExp(rule.pattern, "gi");
          let match;
          
          while ((match = regex.exec(text)) !== null) {
            findings.push({
              ruleId: rule.id,
              ruleName: rule.name,
              match: match[0],
              startIndex: match.index,
              endIndex: match.index + match[0].length,
              categories: rule.categories,
            });
          }
        }
      }
      
      return {
        success: true,
        hasPII: findings.length > 0,
        findings,
      };
    } catch (error) {
      logger.error("Scan PII failed:", error);
      throw error;
    }
  });

  /**
   * Redact PII from text
   */
  ipcMain.handle("policy:redact-pii", async (_event, text: string) => {
    try {
      const enabledRules = Array.from(privacyRules.values()).filter(r => r.enabled);
      let redactedText = text;
      const redactions: Array<{
        ruleId: string;
        original: string;
        replacement: string;
      }> = [];
      
      for (const rule of enabledRules) {
        if (rule.type === "regex" && rule.pattern) {
          const regex = new RegExp(rule.pattern, "gi");
          const replacement = rule.replacement || `[${rule.name.toUpperCase().replace(/\s+/g, "_")}]`;
          
          redactedText = redactedText.replace(regex, (match) => {
            redactions.push({
              ruleId: rule.id,
              original: match,
              replacement,
            });
            return replacement;
          });
        }
      }
      
      return {
        success: true,
        originalText: text,
        redactedText,
        redactionCount: redactions.length,
        redactions,
      };
    } catch (error) {
      logger.error("Redact PII failed:", error);
      throw error;
    }
  });

  /**
   * Scan dataset for PII
   */
  ipcMain.handle("policy:scan-dataset-pii", async (event, datasetId: string) => {
    try {
      const items = await db.select()
        .from(datasetItems)
        .where(and(
          eq(datasetItems.datasetId, datasetId),
          eq(datasetItems.modality, "text")
        ));
      
      const enabledRules = Array.from(privacyRules.values()).filter(r => r.enabled);
      const itemsWithPII: Array<{
        itemId: string;
        findingsCount: number;
        categories: string[];
      }> = [];
      
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        
        // Load content
        const storeDir = path.join(app.getPath("userData"), "content-store");
        const prefix = item.contentHash.substring(0, 2);
        const contentPath = path.join(storeDir, prefix, item.contentHash);
        
        let text: string;
        try {
          text = await fs.readFile(contentPath, "utf-8");
        } catch {
          continue;
        }
        
        let findingsCount = 0;
        const categories = new Set<string>();
        
        for (const rule of enabledRules) {
          if (rule.type === "regex" && rule.pattern) {
            const regex = new RegExp(rule.pattern, "gi");
            const matches = text.match(regex);
            if (matches) {
              findingsCount += matches.length;
              rule.categories.forEach(c => categories.add(c));
            }
          }
        }
        
        if (findingsCount > 0) {
          itemsWithPII.push({
            itemId: item.id,
            findingsCount,
            categories: Array.from(categories),
          });
        }
        
        // Progress
        if ((i + 1) % 50 === 0 || i === items.length - 1) {
          event.sender.send("policy:pii-scan-progress", {
            current: i + 1,
            total: items.length,
            itemsWithPII: itemsWithPII.length,
          });
        }
      }
      
      return {
        success: true,
        totalItems: items.length,
        itemsWithPII: itemsWithPII.length,
        items: itemsWithPII,
      };
    } catch (error) {
      logger.error("Scan dataset PII failed:", error);
      throw error;
    }
  });

  // ========== Retention Policies ==========

  /**
   * Create retention policy
   */
  ipcMain.handle("policy:create-retention", async (_event, policy: Omit<RetentionPolicy, "id">) => {
    try {
      const newPolicy: RetentionPolicy = {
        ...policy,
        id: uuidv4(),
      };
      
      retentionPolicies.set(newPolicy.id, newPolicy);
      await saveRetentionPolicies();
      
      return { success: true, policy: newPolicy };
    } catch (error) {
      logger.error("Create retention policy failed:", error);
      throw error;
    }
  });

  /**
   * List retention policies
   */
  ipcMain.handle("policy:list-retention", async () => {
    try {
      return { success: true, policies: Array.from(retentionPolicies.values()) };
    } catch (error) {
      logger.error("List retention policies failed:", error);
      throw error;
    }
  });

  /**
   * Execute retention policy
   */
  ipcMain.handle("policy:execute-retention", async (_event, policyId: string) => {
    try {
      const policy = retentionPolicies.get(policyId);
      if (!policy) throw new Error("Retention policy not found");
      if (!policy.enabled) throw new Error("Policy is disabled");
      
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - policy.maxAgeDays);
      
      let query = db.select({ id: datasetItems.id }).from(datasetItems);
      
      if (policy.datasetId) {
        query = query.where(and(
          eq(datasetItems.datasetId, policy.datasetId),
          lt(datasetItems.createdAt, cutoffDate)
        )) as any;
      } else {
        query = query.where(lt(datasetItems.createdAt, cutoffDate)) as any;
      }
      
      const affectedItems = await query;
      const itemIds = affectedItems.map(i => i.id);
      
      let actionTaken = "none";
      
      if (policy.action === "delete" && itemIds.length > 0) {
        await db.delete(datasetItems).where(inArray(datasetItems.id, itemIds));
        actionTaken = "deleted";
      } else if (policy.action === "archive" && itemIds.length > 0) {
        await db.update(datasetItems)
          .set({ split: "archive" as any })
          .where(inArray(datasetItems.id, itemIds));
        actionTaken = "archived";
      } else if (policy.action === "notify") {
        actionTaken = "notified";
      }
      
      // Update last run
      policy.lastRun = new Date();
      retentionPolicies.set(policyId, policy);
      await saveRetentionPolicies();
      
      return {
        success: true,
        affectedItems: itemIds.length,
        action: actionTaken,
      };
    } catch (error) {
      logger.error("Execute retention policy failed:", error);
      throw error;
    }
  });

  // ========== Violations ==========

  /**
   * List violations
   */
  ipcMain.handle("policy:list-violations", async (_event, args?: {
    datasetId?: string;
    policyId?: string;
    resolved?: boolean;
  }) => {
    try {
      let result = Array.from(violations.values());
      
      if (args?.datasetId) {
        result = result.filter(v => v.datasetId === args.datasetId);
      }
      if (args?.policyId) {
        result = result.filter(v => v.policyId === args.policyId);
      }
      if (args?.resolved !== undefined) {
        result = result.filter(v => v.resolved === args.resolved);
      }
      
      return { success: true, violations: result };
    } catch (error) {
      logger.error("List violations failed:", error);
      throw error;
    }
  });

  /**
   * Resolve violation
   */
  ipcMain.handle("policy:resolve-violation", async (_event, violationId: string, resolution: string) => {
    try {
      const violation = violations.get(violationId);
      if (!violation) throw new Error("Violation not found");
      
      violation.resolved = true;
      violation.resolvedAt = new Date();
      violation.resolution = resolution;
      
      violations.set(violationId, violation);
      await saveViolations();
      
      return { success: true, violation };
    } catch (error) {
      logger.error("Resolve violation failed:", error);
      throw error;
    }
  });

  /**
   * Clear resolved violations
   */
  ipcMain.handle("policy:clear-resolved-violations", async () => {
    try {
      const toRemove: string[] = [];
      
      for (const [id, violation] of violations) {
        if (violation.resolved) {
          toRemove.push(id);
        }
      }
      
      for (const id of toRemove) {
        violations.delete(id);
      }
      
      await saveViolations();
      
      return { success: true, removed: toRemove.length };
    } catch (error) {
      logger.error("Clear resolved violations failed:", error);
      throw error;
    }
  });

  logger.info("Policy Engine handlers registered");
}
