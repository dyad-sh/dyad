/**
 * Enhanced App Builder Types — Everything Lovable + More
 * 
 * Feature-complete app builder that matches and surpasses Lovable.dev:
 * 
 * FROM LOVABLE:
 * - Agent Mode (auto-implement + verify)
 * - Plan Mode (brainstorm before building)
 * - Visual Editing (drag-drop, inline style changes)
 * - Browser Testing (automated UI tests)
 * - Cross-project Referencing (reuse components)
 * - Design Systems (shared component libraries)
 * - Environments (Test + Live separation)
 * - Project Analytics (visitors, pageviews, bounce rate)
 * - Security Center (API key detection, vulnerability scanning)
 * - Knowledge Base (persistent project context)
 * - MCP Server Integration
 * - Custom Domains + SSL
 * - Collaboration (workspaces, roles, real-time)
 * - File Generation + Data Analysis
 * - Payment Integration (Stripe, Paddle)
 * - Custom Email Domains
 * - Audit Logs
 * - SSO / SCIM provisioning
 * - Project Comments (inline annotations)
 * - GitHub / GitLab sync
 * - Design Templates (reusable project templates)
 * 
 * BEYOND LOVABLE (JoyCreate Sovereign Advantages):
 * - AI Agent Integration (agents as first-class app components)
 * - On-Chain Deployment (IPFS, Celestia anchoring)
 * - Web3 Authentication (wallet-based login)
 * - P2P Real-Time Collaboration (libp2p, not centralized)
 * - Marketplace Publishing (sell your apps)
 * - Universal Identity Integration
 * - Multi-Model AI (choose your model, local or cloud)
 * - n8n Workflow Integration (automation built in)
 * - Native Mobile Export (Capacitor, React Native)
 * - Self-Hosted (no vendor lock-in)
 * - Community Templates (user-contributed)
 * - AI-Powered SEO
 * - Smart Form Builder
 * - Database Visual Editor
 * - API Route Builder
 * - Real-Time Data Sync
 */

// ============================================================================
// BUILD MODES
// ============================================================================

/**
 * Build Mode — how the AI processes your request
 */
export type BuildMode =
  | "chat"       // Default: describe what you want, AI builds it
  | "agent"      // Agent Mode: AI implements + verifies autonomously (Lovable-style)
  | "plan"       // Plan Mode: brainstorm/explore before any code (Lovable-style)
  | "visual"     // Visual Mode: drag-drop editing
  | "code"       // Code Mode: direct code editing with AI assist
  | "debug"      // Debug Mode: AI diagnoses + fixes issues
  | "refactor"   // Refactor Mode: improve existing code quality
  | "test"       // Test Mode: generate and run tests
  ;

/**
 * Agent Mode Configuration — autonomous implementation
 */
export interface AgentModeConfig {
  enabled: boolean;
  /** Max autonomous iterations before asking user */
  maxIterations: number;
  /** Auto-run browser tests after changes */
  autoTest: boolean;
  /** Auto-fix lint/type errors */
  autoFix: boolean;
  /** Auto-verify visual changes with screenshots */
  autoVerify: boolean;
  /** Confidence threshold to proceed without asking (0-1) */
  confidenceThreshold: number;
  /** Allow agent to install dependencies */
  allowDependencyInstall: boolean;
  /** Allow agent to modify database schema */
  allowSchemaChanges: boolean;
  /** Rollback on test failure */
  autoRollback: boolean;
}

/**
 * Plan Mode State
 */
export interface PlanModeState {
  active: boolean;
  plan: BuildPlan | null;
  explorations: PlanExploration[];
  decisions: PlanDecision[];
}

export interface BuildPlan {
  id: string;
  title: string;
  description: string;
  steps: BuildPlanStep[];
  estimatedTokens: number;
  estimatedTime: string;
  alternatives: BuildPlanAlternative[];
  createdAt: string;
  approvedAt?: string;
}

export interface BuildPlanStep {
  id: string;
  order: number;
  title: string;
  description: string;
  type: "create" | "modify" | "delete" | "install" | "configure" | "test";
  files: string[];
  dependencies?: string[];
  estimated: {
    tokens: number;
    time: string;
  };
  status: "pending" | "in-progress" | "complete" | "skipped" | "failed";
}

export interface BuildPlanAlternative {
  id: string;
  title: string;
  description: string;
  tradeoffs: string;
}

export interface PlanExploration {
  id: string;
  question: string;
  answer: string;
  timestamp: string;
}

export interface PlanDecision {
  id: string;
  topic: string;
  decision: string;
  reasoning: string;
  timestamp: string;
}

// ============================================================================
// VISUAL EDITING
// ============================================================================

/**
 * Visual Editing — modify UI elements without writing code
 */
export interface VisualEditingState {
  active: boolean;
  selectedElement: SelectedElement | null;
  changes: VisualChange[];
  undoStack: VisualChange[][];
  redoStack: VisualChange[][];
}

export interface SelectedElement {
  /** CSS selector path */
  selector: string;
  /** Element tag name */
  tagName: string;
  /** React component name if identifiable */
  componentName?: string;
  /** Source file path */
  sourceFile: string;
  /** Line number in source */
  sourceLine: number;
  /** Current computed styles */
  computedStyles: Record<string, string>;
  /** Current text content */
  textContent?: string;
  /** Bounding box */
  bounds: { x: number; y: number; width: number; height: number };
  /** Parent element info */
  parent?: { selector: string; tagName: string };
  /** Children count */
  childCount: number;
}

export interface VisualChange {
  id: string;
  elementSelector: string;
  type: "style" | "text" | "layout" | "add" | "remove" | "move" | "resize";
  property?: string;
  oldValue?: string;
  newValue?: string;
  /** Maps to actual code changes */
  codeChanges: CodeChange[];
  timestamp: string;
}

export interface CodeChange {
  file: string;
  line: number;
  oldCode: string;
  newCode: string;
}

/**
 * Visual Editing Toolbar Tools
 */
export type VisualTool =
  | "select"
  | "text"
  | "move"
  | "resize"
  | "padding"
  | "margin"
  | "color"
  | "font"
  | "border"
  | "shadow"
  | "opacity"
  | "layout"
  | "spacing"
  | "responsive"
  | "animation"
  ;

// ============================================================================
// BROWSER TESTING
// ============================================================================

/**
 * Browser Testing — automated UI verification
 */
export interface BrowserTestConfig {
  /** Auto-run after every build */
  autoRun: boolean;
  /** Viewports to test */
  viewports: TestViewport[];
  /** Test scenarios */
  scenarios: TestScenario[];
  /** Visual regression threshold */
  regressionThreshold: number;
  /** Screenshot comparison */
  enableScreenshots: boolean;
  /** Accessibility testing */
  enableA11y: boolean;
  /** Performance testing */
  enablePerformance: boolean;
}

export interface TestViewport {
  name: string;
  width: number;
  height: number;
  deviceScaleFactor?: number;
  isMobile?: boolean;
  hasTouch?: boolean;
}

export interface TestScenario {
  id: string;
  name: string;
  description: string;
  steps: TestStep[];
  assertions: TestAssertion[];
  tags: string[];
}

export interface TestStep {
  id: string;
  order: number;
  action: "navigate" | "click" | "type" | "scroll" | "wait" | "hover" | "select" | "upload" | "screenshot" | "assert";
  target?: string;
  value?: string;
  waitMs?: number;
  description: string;
}

export interface TestAssertion {
  id: string;
  type: "visible" | "hidden" | "text" | "value" | "attribute" | "screenshot" | "a11y" | "performance";
  target: string;
  expected: string;
  tolerance?: number;
}

export interface TestResult {
  id: string;
  scenarioId: string;
  status: "pass" | "fail" | "error" | "skip";
  viewport: TestViewport;
  duration: number;
  screenshots: TestScreenshot[];
  assertions: AssertionResult[];
  errors: TestError[];
  a11yIssues?: A11yIssue[];
  performance?: PerformanceMetrics;
  timestamp: string;
}

export interface TestScreenshot {
  step: string;
  path: string;
  baseline?: string;
  diff?: string;
  matchPercentage?: number;
}

export interface AssertionResult {
  assertionId: string;
  passed: boolean;
  actual: string;
  expected: string;
  message?: string;
}

export interface TestError {
  step: string;
  message: string;
  stack?: string;
}

export interface A11yIssue {
  severity: "critical" | "serious" | "moderate" | "minor";
  message: string;
  element: string;
  rule: string;
  helpUrl: string;
}

export interface PerformanceMetrics {
  firstContentfulPaint: number;
  largestContentfulPaint: number;
  timeToInteractive: number;
  cumulativeLayoutShift: number;
  firstInputDelay: number;
  totalBlockingTime: number;
  bundleSize: number;
}

// ============================================================================
// DESIGN SYSTEMS
// ============================================================================

/**
 * Design System — shared component libraries and styling standards
 */
export interface DesignSystem {
  id: string;
  name: string;
  description: string;
  version: string;
  
  /** Color palette */
  colors: DesignTokenColors;
  /** Typography scale */
  typography: DesignTokenTypography;
  /** Spacing scale */
  spacing: DesignTokenSpacing;
  /** Border radius tokens */
  radii: Record<string, string>;
  /** Shadow tokens */
  shadows: Record<string, string>;
  /** Breakpoints */
  breakpoints: Record<string, string>;
  /** Animation tokens */
  animations: DesignTokenAnimations;
  /** Component library */
  components: DesignComponent[];
  /** Layout patterns */
  layouts: DesignLayout[];
  /** Icon set */
  iconSet: string;
  /** Font families */
  fonts: string[];
  
  createdAt: string;
  updatedAt: string;
}

export interface DesignTokenColors {
  primary: Record<string, string>;
  secondary: Record<string, string>;
  accent: Record<string, string>;
  neutral: Record<string, string>;
  success: Record<string, string>;
  warning: Record<string, string>;
  error: Record<string, string>;
  info: Record<string, string>;
  background: Record<string, string>;
  foreground: Record<string, string>;
  custom: Record<string, Record<string, string>>;
}

export interface DesignTokenTypography {
  fontFamilies: Record<string, string>;
  fontSizes: Record<string, string>;
  fontWeights: Record<string, string | number>;
  lineHeights: Record<string, string>;
  letterSpacings: Record<string, string>;
  textStyles: Record<string, {
    fontFamily: string;
    fontSize: string;
    fontWeight: string | number;
    lineHeight: string;
    letterSpacing: string;
  }>;
}

export interface DesignTokenSpacing {
  scale: Record<string, string>;
  semantic: Record<string, string>;
}

export interface DesignTokenAnimations {
  durations: Record<string, string>;
  easings: Record<string, string>;
  keyframes: Record<string, Record<string, Record<string, string>>>;
}

export interface DesignComponent {
  id: string;
  name: string;
  description: string;
  category: string;
  variants: ComponentVariant[];
  props: ComponentProp[];
  sourceFile: string;
  previewImage?: string;
  usage: string;
}

export interface ComponentVariant {
  name: string;
  props: Record<string, any>;
  preview?: string;
}

export interface ComponentProp {
  name: string;
  type: string;
  required: boolean;
  default?: any;
  description: string;
  options?: string[];
}

export interface DesignLayout {
  id: string;
  name: string;
  description: string;
  type: "page" | "section" | "grid" | "flex" | "sidebar" | "header" | "footer" | "card";
  preview?: string;
  code: string;
}

// ============================================================================
// PROJECT ANALYTICS
// ============================================================================

/**
 * Built-in analytics for published apps
 */
export interface ProjectAnalytics {
  projectId: string;
  period: AnalyticsPeriod;
  
  /** Visitor metrics */
  visitors: {
    total: number;
    unique: number;
    returning: number;
    trend: number; // percentage change
    timeSeries: TimeSeriesPoint[];
  };
  
  /** Page metrics */
  pageviews: {
    total: number;
    perVisit: number;
    topPages: PageMetric[];
    trend: number;
    timeSeries: TimeSeriesPoint[];
  };
  
  /** Engagement metrics */
  engagement: {
    bounceRate: number;
    avgDuration: number;
    avgDepth: number;
    exitPages: PageMetric[];
    entryPages: PageMetric[];
  };
  
  /** Traffic sources */
  sources: {
    direct: number;
    organic: number;
    referral: number;
    social: number;
    paid: number;
    topReferrers: SourceMetric[];
  };
  
  /** Device & browser */
  devices: {
    desktop: number;
    mobile: number;
    tablet: number;
    browsers: DeviceMetric[];
    operatingSystems: DeviceMetric[];
    screenResolutions: DeviceMetric[];
  };
  
  /** Geographic */
  geography: {
    countries: GeoMetric[];
    cities: GeoMetric[];
  };
  
  /** Performance */
  performance: {
    avgLoadTime: number;
    avgFCP: number;
    avgLCP: number;
    avgCLS: number;
    avgFID: number;
    webVitals: WebVitalMetric[];
  };
  
  /** Errors */
  errors: {
    total: number;
    unique: number;
    topErrors: ErrorMetric[];
  };
}

export type AnalyticsPeriod = "1h" | "24h" | "7d" | "30d" | "90d" | "1y" | "all" | "custom";

export interface TimeSeriesPoint {
  timestamp: string;
  value: number;
}

export interface PageMetric {
  path: string;
  views: number;
  uniqueViews: number;
  avgDuration: number;
  bounceRate: number;
}

export interface SourceMetric {
  source: string;
  visits: number;
  percentage: number;
}

export interface DeviceMetric {
  name: string;
  count: number;
  percentage: number;
}

export interface GeoMetric {
  name: string;
  code: string;
  visits: number;
  percentage: number;
}

export interface WebVitalMetric {
  name: string;
  value: number;
  rating: "good" | "needs-improvement" | "poor";
}

export interface ErrorMetric {
  message: string;
  count: number;
  lastSeen: string;
  stack?: string;
}

// ============================================================================
// SECURITY CENTER
// ============================================================================

/**
 * Security scanning and vulnerability management
 */
export interface SecurityCenter {
  projectId: string;
  lastScan: string;
  overallScore: number; // 0-100
  
  /** API key / secret detection */
  secrets: SecurityFinding[];
  /** Dependency vulnerabilities */
  dependencies: DependencyVulnerability[];
  /** Code security issues */
  codeIssues: CodeSecurityIssue[];
  /** Access control issues */
  accessControl: AccessControlIssue[];
  /** Security headers */
  headers: SecurityHeader[];
  /** Content Security Policy */
  csp: CSPConfig;
  
  /** Summary */
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
    fixed: number;
  };
}

export interface SecurityFinding {
  id: string;
  type: "api-key" | "secret" | "token" | "password" | "private-key" | "env-var";
  severity: "critical" | "high" | "medium" | "low";
  file: string;
  line: number;
  description: string;
  recommendation: string;
  autoFixAvailable: boolean;
  status: "open" | "fixed" | "ignored" | "false-positive";
}

export interface DependencyVulnerability {
  id: string;
  package: string;
  currentVersion: string;
  fixedVersion?: string;
  severity: "critical" | "high" | "medium" | "low";
  cve?: string;
  description: string;
  autoFixAvailable: boolean;
}

export interface CodeSecurityIssue {
  id: string;
  type: "xss" | "injection" | "csrf" | "auth-bypass" | "insecure-random" | "info-disclosure" | "prototype-pollution" | "regex-dos" | "path-traversal" | "open-redirect";
  severity: "critical" | "high" | "medium" | "low";
  file: string;
  line: number;
  description: string;
  recommendation: string;
  cwe?: string;
}

export interface AccessControlIssue {
  id: string;
  type: "rls-missing" | "public-table" | "anon-access" | "admin-exposed" | "cors-wide";
  severity: "critical" | "high" | "medium" | "low";
  resource: string;
  description: string;
  recommendation: string;
}

export interface SecurityHeader {
  name: string;
  present: boolean;
  value?: string;
  recommended: string;
  severity: "high" | "medium" | "low";
}

export interface CSPConfig {
  enabled: boolean;
  directives: Record<string, string[]>;
  violations: CSPViolation[];
}

export interface CSPViolation {
  directive: string;
  blockedUri: string;
  count: number;
  lastSeen: string;
}

// ============================================================================
// PROJECT KNOWLEDGE
// ============================================================================

/**
 * Persistent context for AI — what it should always know about this project
 */
export interface ProjectKnowledge {
  projectId: string;
  
  /** Workspace-level knowledge (applies to all projects) */
  workspaceKnowledge: KnowledgeEntry[];
  /** Project-specific knowledge */
  projectKnowledge: KnowledgeEntry[];
  /** Auto-discovered context */
  autoContext: AutoContext;
}

export interface KnowledgeEntry {
  id: string;
  title: string;
  content: string;
  type: "instruction" | "convention" | "architecture" | "business-rule" | "style-guide" | "api-spec" | "data-model" | "constraint";
  priority: "always" | "high" | "medium" | "low";
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AutoContext {
  /** Package.json dependencies */
  dependencies: Record<string, string>;
  /** Detected frameworks */
  frameworks: string[];
  /** File structure summary */
  fileTree: string;
  /** Database schema */
  dbSchema?: DatabaseSchema;
  /** API routes */
  apiRoutes?: ApiRoute[];
  /** Environment variables */
  envVars: string[];
  /** Build configuration */
  buildConfig?: Record<string, any>;
}

// ============================================================================
// COLLABORATION
// ============================================================================

/**
 * Real-time collaboration features
 */
export interface CollaborationState {
  /** Active collaborators in this project */
  collaborators: Collaborator[];
  /** Cursors and selections */
  cursors: CollaboratorCursor[];
  /** Active file locks */
  fileLocks: FileLock[];
  /** Pending comments */
  comments: ProjectComment[];
  /** Change proposals */
  proposals: ChangeProposal[];
}

export interface Collaborator {
  id: string;
  name: string;
  avatar?: string;
  role: WorkspaceRole;
  status: "active" | "idle" | "away" | "offline";
  currentFile?: string;
  lastActivity: string;
  color: string;
}

export type WorkspaceRole = "owner" | "admin" | "editor" | "viewer" | "guest";

export interface CollaboratorCursor {
  collaboratorId: string;
  file: string;
  line: number;
  column: number;
  selection?: {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  };
}

export interface FileLock {
  file: string;
  lockedBy: string;
  lockedAt: string;
  expiresAt: string;
}

export interface ProjectComment {
  id: string;
  authorId: string;
  authorName: string;
  authorAvatar?: string;
  /** Comment on a file/line */
  file?: string;
  line?: number;
  /** Comment on a visual element */
  elementSelector?: string;
  /** Comment on a screenshot */
  screenshot?: string;
  screenshotCoords?: { x: number; y: number };
  /** Content */
  content: string;
  resolved: boolean;
  replies: CommentReply[];
  createdAt: string;
}

export interface CommentReply {
  id: string;
  authorId: string;
  authorName: string;
  content: string;
  createdAt: string;
}

export interface ChangeProposal {
  id: string;
  authorId: string;
  title: string;
  description: string;
  changes: CodeChange[];
  status: "pending" | "approved" | "rejected" | "merged";
  reviews: ProposalReview[];
  createdAt: string;
}

export interface ProposalReview {
  reviewerId: string;
  status: "approved" | "changes-requested" | "commented";
  comment?: string;
  timestamp: string;
}

// ============================================================================
// ENVIRONMENTS
// ============================================================================

/**
 * Test + Live environment separation
 */
export interface ProjectEnvironment {
  name: "test" | "live" | "preview" | "staging" | string;
  url: string;
  status: "running" | "stopped" | "deploying" | "error";
  
  /** Environment variables */
  envVars: EnvironmentVariable[];
  /** Database connection */
  database?: EnvironmentDatabase;
  /** Last deployment */
  lastDeploy?: DeploymentInfo;
  /** Protection rules */
  protection: EnvironmentProtection;
}

export interface EnvironmentVariable {
  key: string;
  value: string;
  sensitive: boolean;
  overridePerEnv: boolean;
}

export interface EnvironmentDatabase {
  provider: "supabase" | "postgres" | "mysql" | "sqlite" | "planetscale" | "neon" | "turso";
  connectionString?: string;
  schema?: DatabaseSchema;
  migrations: DatabaseMigration[];
}

export interface DatabaseSchema {
  tables: DatabaseTable[];
  enums: DatabaseEnum[];
  functions: DatabaseFunction[];
  triggers: DatabaseTrigger[];
  policies: DatabasePolicy[];
}

export interface DatabaseTable {
  name: string;
  columns: DatabaseColumn[];
  indexes: DatabaseIndex[];
  foreignKeys: DatabaseForeignKey[];
  rlsEnabled: boolean;
}

export interface DatabaseColumn {
  name: string;
  type: string;
  nullable: boolean;
  default?: string;
  isPrimary: boolean;
  isUnique: boolean;
  references?: { table: string; column: string };
}

export interface DatabaseIndex {
  name: string;
  columns: string[];
  unique: boolean;
  type: "btree" | "hash" | "gin" | "gist";
}

export interface DatabaseForeignKey {
  name: string;
  column: string;
  referencesTable: string;
  referencesColumn: string;
  onDelete: "cascade" | "restrict" | "set-null" | "no-action";
  onUpdate: "cascade" | "restrict" | "set-null" | "no-action";
}

export interface DatabaseEnum {
  name: string;
  values: string[];
}

export interface DatabaseFunction {
  name: string;
  args: string;
  returns: string;
  language: string;
  body: string;
}

export interface DatabaseTrigger {
  name: string;
  table: string;
  event: "INSERT" | "UPDATE" | "DELETE";
  timing: "BEFORE" | "AFTER";
  functionName: string;
}

export interface DatabasePolicy {
  name: string;
  table: string;
  command: "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "ALL";
  roles: string[];
  using?: string;
  check?: string;
}

export interface DatabaseMigration {
  id: string;
  name: string;
  sql: string;
  appliedAt?: string;
  status: "pending" | "applied" | "failed" | "rolled-back";
}

export interface DeploymentInfo {
  id: string;
  environment: string;
  commitHash?: string;
  commitMessage?: string;
  deployedBy: string;
  deployedAt: string;
  duration: number;
  status: "success" | "failed" | "cancelled";
  url: string;
  logs?: string;
}

export interface EnvironmentProtection {
  /** Require approval before deploying */
  requireApproval: boolean;
  /** Require passing tests */
  requireTests: boolean;
  /** Require security scan */
  requireSecurityScan: boolean;
  /** Required approvers */
  approvers: string[];
  /** Branch restrictions */
  allowedBranches?: string[];
}

// ============================================================================
// CROSS-PROJECT REFERENCING
// ============================================================================

/**
 * Reuse implementations across projects
 */
export interface CrossProjectReference {
  id: string;
  sourceProjectId: string;
  sourceProjectName: string;
  targetProjectId: string;
  type: "component" | "file" | "chat" | "asset" | "design-system" | "knowledge";
  sourcePath: string;
  description: string;
  linkedAt: string;
}

// ============================================================================
// CUSTOM DOMAINS + SSL
// ============================================================================

export interface CustomDomain {
  id: string;
  domain: string;
  projectId: string;
  environment: string;
  status: "pending" | "active" | "error" | "expired";
  ssl: {
    status: "provisioning" | "active" | "expired" | "error";
    expiresAt?: string;
    autoRenew: boolean;
  };
  dns: DnsRecord[];
  verifiedAt?: string;
}

export interface DnsRecord {
  type: "A" | "AAAA" | "CNAME" | "TXT" | "MX" | "NS";
  name: string;
  value: string;
  verified: boolean;
}

// ============================================================================
// PAYMENT INTEGRATION
// ============================================================================

export interface PaymentIntegration {
  provider: "stripe" | "paddle" | "crypto" | "paypal";
  status: "connected" | "disconnected" | "pending";
  accountId?: string;
  
  /** Products / prices configured */
  products: PaymentProduct[];
  /** Subscription plans */
  plans: SubscriptionPlan[];
  /** Revenue metrics */
  revenue?: RevenueMetrics;
}

export interface PaymentProduct {
  id: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  type: "one-time" | "subscription";
  active: boolean;
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  price: number;
  currency: string;
  interval: "month" | "year" | "week";
  features: string[];
  active: boolean;
  subscriberCount: number;
}

export interface RevenueMetrics {
  mrr: number;
  arr: number;
  totalRevenue: number;
  activeSubscribers: number;
  churnRate: number;
  ltv: number;
  timeSeries: TimeSeriesPoint[];
}

// ============================================================================
// API ROUTE BUILDER
// ============================================================================

export interface ApiRoute {
  id: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  description: string;
  handler: string;
  middleware: string[];
  auth: "none" | "api-key" | "jwt" | "session" | "oauth";
  rateLimit?: { requests: number; window: string };
  request?: ApiSchema;
  response?: ApiSchema;
  tags: string[];
}

export interface ApiSchema {
  contentType: string;
  schema: Record<string, any>;
  example?: any;
}

// ============================================================================
// SMART FORM BUILDER
// ============================================================================

export interface SmartForm {
  id: string;
  name: string;
  description: string;
  fields: FormField[];
  validation: FormValidation[];
  submission: FormSubmission;
  styling: FormStyling;
  multiStep?: FormMultiStep;
}

export interface FormField {
  id: string;
  name: string;
  label: string;
  type: "text" | "email" | "password" | "number" | "tel" | "url" | "textarea" | "select" | "multi-select" | "radio" | "checkbox" | "date" | "time" | "datetime" | "file" | "image" | "rich-text" | "color" | "range" | "rating" | "toggle" | "address" | "phone" | "currency" | "signature" | "code" | "markdown" | "json";
  placeholder?: string;
  helpText?: string;
  required: boolean;
  validation?: FieldValidation[];
  options?: FieldOption[];
  conditional?: FieldConditional;
  width: "full" | "half" | "third" | "quarter";
  defaultValue?: any;
}

export interface FieldValidation {
  type: "required" | "min" | "max" | "minLength" | "maxLength" | "pattern" | "email" | "url" | "phone" | "custom";
  value?: any;
  message: string;
}

export interface FieldOption {
  label: string;
  value: string;
  disabled?: boolean;
  group?: string;
}

export interface FieldConditional {
  field: string;
  operator: "equals" | "not-equals" | "contains" | "greater" | "less" | "in" | "not-in" | "exists" | "empty";
  value: any;
}

export interface FormValidation {
  type: "cross-field" | "async" | "custom";
  fields: string[];
  rule: string;
  message: string;
}

export interface FormSubmission {
  action: "api" | "email" | "database" | "webhook" | "n8n-workflow" | "custom";
  endpoint?: string;
  method?: string;
  successMessage: string;
  errorMessage: string;
  redirect?: string;
  notifications?: FormNotification[];
}

export interface FormNotification {
  type: "email" | "slack" | "discord" | "webhook";
  target: string;
  template?: string;
}

export interface FormStyling {
  theme: "default" | "minimal" | "bordered" | "glass" | "custom";
  layout: "vertical" | "horizontal" | "inline" | "floating-label";
  animation: boolean;
  darkMode: boolean;
  customCSS?: string;
}

export interface FormMultiStep {
  steps: FormStep[];
  showProgress: boolean;
  allowBack: boolean;
  saveProgress: boolean;
}

export interface FormStep {
  id: string;
  title: string;
  description?: string;
  fields: string[];
  validation?: string;
}

// ============================================================================
// AI-POWERED SEO
// ============================================================================

export interface SeoConfig {
  projectId: string;
  
  /** Page-level SEO */
  pages: PageSeo[];
  /** Global meta tags */
  globalMeta: MetaTag[];
  /** Sitemap */
  sitemap: SitemapConfig;
  /** Robots.txt */
  robots: RobotsConfig;
  /** Open Graph defaults */
  openGraph: OpenGraphConfig;
  /** Schema.org structured data */
  structuredData: StructuredDataEntry[];
  /** AI suggestions */
  suggestions: SeoSuggestion[];
  /** Performance score */
  score: number;
}

export interface PageSeo {
  path: string;
  title: string;
  description: string;
  keywords: string[];
  canonical?: string;
  noIndex: boolean;
  noFollow: boolean;
  openGraph?: Partial<OpenGraphConfig>;
  structuredData?: StructuredDataEntry[];
}

export interface MetaTag {
  name?: string;
  property?: string;
  content: string;
}

export interface SitemapConfig {
  enabled: boolean;
  changeFreq: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority: number;
  excludePatterns: string[];
}

export interface RobotsConfig {
  enabled: boolean;
  rules: { userAgent: string; allow: string[]; disallow: string[] }[];
}

export interface OpenGraphConfig {
  title: string;
  description: string;
  image?: string;
  type: "website" | "article" | "product" | "profile";
  siteName?: string;
  locale?: string;
}

export interface StructuredDataEntry {
  type: string;
  data: Record<string, any>;
}

export interface SeoSuggestion {
  id: string;
  page: string;
  type: "title" | "description" | "heading" | "alt-text" | "performance" | "mobile" | "structured-data" | "internal-link" | "keyword";
  severity: "critical" | "warning" | "suggestion";
  message: string;
  recommendation: string;
  autoFixAvailable: boolean;
}

// ============================================================================
// MARKETPLACE + TEMPLATES
// ============================================================================

/**
 * Publish apps and templates to the JoyCreate marketplace
 */
export interface MarketplaceListing {
  id: string;
  projectId: string;
  name: string;
  description: string;
  shortDescription: string;
  category: AppCategory;
  tags: string[];
  screenshots: string[];
  demoUrl?: string;
  
  /** Pricing */
  pricing: {
    model: "free" | "one-time" | "subscription" | "freemium";
    price?: number;
    currency?: string;
    interval?: string;
    freeTier?: string;
  };
  
  /** Stats */
  stats: {
    downloads: number;
    activeInstalls: number;
    rating: number;
    reviews: number;
    forks: number;
  };
  
  /** What's included */
  includes: {
    pages: number;
    components: number;
    apiRoutes: number;
    hasDatabase: boolean;
    hasAuth: boolean;
    hasPayments: boolean;
    hasAiFeatures: boolean;
  };
  
  publishedAt: string;
  updatedAt: string;
}

export type AppCategory =
  | "saas"
  | "ecommerce"
  | "marketplace"
  | "dashboard"
  | "landing-page"
  | "portfolio"
  | "blog"
  | "cms"
  | "social"
  | "education"
  | "healthcare"
  | "finance"
  | "real-estate"
  | "travel"
  | "food"
  | "fitness"
  | "gaming"
  | "productivity"
  | "crm"
  | "hr"
  | "project-management"
  | "analytics"
  | "ai-tool"
  | "web3"
  | "community"
  | "other"
  ;

export interface AppTemplate {
  id: string;
  name: string;
  description: string;
  category: AppCategory;
  preview: string;
  tags: string[];
  
  /** Template source */
  source: "official" | "community" | "marketplace";
  /** Framework */
  framework: "react" | "next" | "vite" | "remix" | "astro";
  /** UI library */
  uiLibrary: "shadcn" | "material" | "chakra" | "tailwind" | "custom";
  
  /** What the template includes */
  includes: string[];
  /** Customization options */
  variables: TemplateVariable[];
  
  /** Stats */
  uses: number;
  rating: number;
}

export interface TemplateVariable {
  name: string;
  label: string;
  type: "text" | "color" | "select" | "boolean" | "image";
  default: any;
  options?: string[];
  description: string;
}

// ============================================================================
// SOVEREIGN WEB3 FEATURES (Beyond Lovable)
// ============================================================================

/**
 * On-chain deployment and Web3 features unique to JoyCreate
 */
export interface Web3AppConfig {
  /** Wallet-based authentication */
  walletAuth: {
    enabled: boolean;
    chains: string[];
    providers: ("metamask" | "walletconnect" | "coinbase" | "rainbow" | "phantom")[];
    signMessage: string;
  };
  
  /** IPFS/Arweave deployment */
  decentralizedHosting: {
    enabled: boolean;
    provider: "ipfs" | "arweave" | "filecoin";
    gateway: string;
    pinned: boolean;
    cid?: string;
  };
  
  /** Celestia data availability */
  celestiaAnchoring: {
    enabled: boolean;
    namespace: string;
    anchors: CelestiaAppAnchor[];
  };
  
  /** Smart contract integration */
  contracts: SmartContractBinding[];
  
  /** Token gating */
  tokenGating: TokenGatingRule[];
  
  /** On-chain payments */
  cryptoPayments: {
    enabled: boolean;
    chains: string[];
    tokens: string[];
    receiver: string;
  };
}

export interface CelestiaAppAnchor {
  deploymentId: string;
  height: number;
  hash: string;
  timestamp: string;
}

export interface SmartContractBinding {
  name: string;
  chain: string;
  address: string;
  abi: any[];
  methods: string[];
}

export interface TokenGatingRule {
  id: string;
  name: string;
  type: "nft" | "token" | "poap" | "credential";
  chain: string;
  contractAddress: string;
  minBalance?: string;
  tokenId?: string;
  grantAccess: string[];
}

// ============================================================================
// AI AGENT INTEGRATION (Beyond Lovable)
// ============================================================================

/**
 * Embed AI agents directly into apps
 */
export interface AppAgentBinding {
  agentId: number;
  agentName: string;
  placement: "chat-widget" | "sidebar" | "modal" | "inline" | "floating" | "fullscreen";
  triggerType: "button" | "keyboard" | "auto" | "scroll" | "idle" | "error";
  config: {
    systemPrompt?: string;
    welcomeMessage: string;
    suggestedQuestions: string[];
    maxTokens: number;
    model?: string;
    tools: string[];
    theme: "light" | "dark" | "auto" | "custom";
    position?: "bottom-right" | "bottom-left" | "top-right" | "top-left";
    width?: number;
    height?: number;
  };
}

// ============================================================================
// NATIVE MOBILE EXPORT (Beyond Lovable)
// ============================================================================

export interface MobileExportConfig {
  platform: "ios" | "android" | "both";
  framework: "capacitor" | "react-native" | "pwa";
  appName: string;
  bundleId: string;
  version: string;
  icon?: string;
  splashScreen?: string;
  permissions: MobilePermission[];
  plugins: MobilePlugin[];
  buildConfig: {
    minSdk?: number;
    targetSdk?: number;
    signingConfig?: any;
  };
}

export type MobilePermission =
  | "camera"
  | "microphone"
  | "location"
  | "notifications"
  | "contacts"
  | "calendar"
  | "photos"
  | "storage"
  | "biometrics"
  | "bluetooth"
  | "nfc"
  ;

export interface MobilePlugin {
  name: string;
  version: string;
  config?: Record<string, any>;
}

// ============================================================================
// AUDIT LOGS
// ============================================================================

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actor: {
    id: string;
    name: string;
    type: "user" | "system" | "agent" | "api";
  };
  action: AuditAction;
  resource: {
    type: "project" | "file" | "environment" | "member" | "domain" | "deployment" | "setting";
    id: string;
    name: string;
  };
  details: Record<string, any>;
  ip?: string;
  userAgent?: string;
}

export type AuditAction =
  | "project:created"
  | "project:deleted"
  | "project:renamed"
  | "project:settings-changed"
  | "file:created"
  | "file:modified"
  | "file:deleted"
  | "deployment:started"
  | "deployment:completed"
  | "deployment:failed"
  | "deployment:rolled-back"
  | "member:invited"
  | "member:removed"
  | "member:role-changed"
  | "domain:added"
  | "domain:removed"
  | "domain:verified"
  | "env:created"
  | "env:deleted"
  | "env:var-changed"
  | "security:scan-run"
  | "security:finding-fixed"
  | "auth:login"
  | "auth:logout"
  | "auth:2fa-enabled"
  | "auth:sso-configured"
  ;

// ============================================================================
// ENHANCED PROJECT CONFIG
// ============================================================================

/**
 * The complete enhanced project — everything above, unified
 */
export interface EnhancedProject {
  id: string;
  name: string;
  description: string;
  
  /** Build configuration */
  buildMode: BuildMode;
  agentMode: AgentModeConfig;
  planMode: PlanModeState;
  
  /** Visual editing */
  visualEditing: VisualEditingState;
  
  /** Testing */
  browserTesting: BrowserTestConfig;
  testResults: TestResult[];
  
  /** Design */
  designSystem?: DesignSystem;
  
  /** Analytics */
  analytics?: ProjectAnalytics;
  
  /** Security */
  security: SecurityCenter;
  
  /** Knowledge */
  knowledge: ProjectKnowledge;
  
  /** Collaboration */
  collaboration: CollaborationState;
  
  /** Environments */
  environments: ProjectEnvironment[];
  
  /** Cross-references */
  references: CrossProjectReference[];
  
  /** Domains */
  domains: CustomDomain[];
  
  /** Payments */
  payments?: PaymentIntegration;
  
  /** API Routes */
  apiRoutes: ApiRoute[];
  
  /** Forms */
  forms: SmartForm[];
  
  /** SEO */
  seo: SeoConfig;
  
  /** Marketplace */
  marketplace?: MarketplaceListing;
  
  /** Templates */
  template?: AppTemplate;
  
  /** Web3 */
  web3?: Web3AppConfig;
  
  /** AI Agents */
  agents: AppAgentBinding[];
  
  /** Mobile */
  mobile?: MobileExportConfig;
  
  /** Audit */
  auditLog: AuditLogEntry[];
  
  /** Git */
  git: {
    provider: "github" | "gitlab" | "bitbucket" | "local";
    repoUrl?: string;
    branch: string;
    lastSync?: string;
    autoSync: boolean;
  };
  
  /** Metadata */
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  version: string;
}
