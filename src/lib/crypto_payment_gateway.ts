/**
 * Crypto Payment Gateway
 * Accept and process cryptocurrency payments without third-party services.
 * Supports multiple chains, subscriptions, and payment streaming.
 */

import * as crypto from "crypto";
import * as path from "path";
import * as fs from "fs/promises";
import { existsSync } from "fs";
import { app } from "electron";
import log from "electron-log";
import { EventEmitter } from "events";
import { ethers } from "ethers";

import type {
  PaymentId,
  PaymentGatewayConfig,
  Payment,
  PaymentStatus,
  Subscription,
  PaymentStream,
  Webhook,
  PaymentMethod,
} from "@/types/sovereign_stack_types";

const logger = log.scope("crypto_payment_gateway");

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_PAYMENTS_DIR = path.join(app.getPath("userData"), "payments");

// Supported chains and their configurations
const CHAIN_CONFIGS: Record<number, {
  name: string;
  rpcUrl: string;
  explorerUrl: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  stablecoins: Record<string, string>; // symbol -> contract address
}> = {
  1: {
    name: "Ethereum",
    rpcUrl: "https://eth.llamarpc.com",
    explorerUrl: "https://etherscan.io",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    stablecoins: {
      USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
      DAI: "0x6B175474E89094C44Da98b954EescdeCB5b3d5D4C4B",
    },
  },
  137: {
    name: "Polygon",
    rpcUrl: "https://polygon.llamarpc.com",
    explorerUrl: "https://polygonscan.com",
    nativeCurrency: { name: "MATIC", symbol: "MATIC", decimals: 18 },
    stablecoins: {
      USDC: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
      USDT: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
      DAI: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063",
    },
  },
  56: {
    name: "BNB Chain",
    rpcUrl: "https://bsc-dataseed.binance.org",
    explorerUrl: "https://bscscan.com",
    nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
    stablecoins: {
      USDC: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
      USDT: "0x55d398326f99059fF775485246999027B3197955",
      BUSD: "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56",
    },
  },
  42161: {
    name: "Arbitrum",
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    explorerUrl: "https://arbiscan.io",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    stablecoins: {
      USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      USDT: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
    },
  },
  10: {
    name: "Optimism",
    rpcUrl: "https://mainnet.optimism.io",
    explorerUrl: "https://optimistic.etherscan.io",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    stablecoins: {
      USDC: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
      USDT: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58",
    },
  },
  8453: {
    name: "Base",
    rpcUrl: "https://mainnet.base.org",
    explorerUrl: "https://basescan.org",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    stablecoins: {
      USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    },
  },
};

// ERC20 ABI for token transfers
const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function transferFrom(address from, address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
];

// =============================================================================
// CRYPTO PAYMENT GATEWAY SERVICE
// =============================================================================

export class CryptoPaymentGateway extends EventEmitter {
  private paymentsDir: string;
  private config: PaymentGatewayConfig | null = null;
  private payments: Map<PaymentId, Payment> = new Map();
  private subscriptions: Map<string, Subscription> = new Map();
  private streams: Map<string, PaymentStream> = new Map();
  private webhooks: Map<string, Webhook> = new Map();
  private providers: Map<number, ethers.JsonRpcProvider> = new Map();
  private watchedAddresses: Map<string, { chainId: number; callback: (payment: Payment) => void }> = new Map();
  private blockWatchers: Map<number, NodeJS.Timer> = new Map();
  
  constructor(paymentsDir?: string) {
    super();
    this.paymentsDir = paymentsDir || DEFAULT_PAYMENTS_DIR;
  }
  
  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================
  
  async initialize(): Promise<void> {
    logger.info("Initializing crypto payment gateway", { paymentsDir: this.paymentsDir });
    
    await fs.mkdir(this.paymentsDir, { recursive: true });
    await this.loadConfig();
    await this.loadPayments();
    await this.loadSubscriptions();
    
    logger.info("Payment gateway initialized", { paymentCount: this.payments.size });
  }
  
  private async loadConfig(): Promise<void> {
    const configPath = path.join(this.paymentsDir, "config.json");
    if (existsSync(configPath)) {
      this.config = JSON.parse(await fs.readFile(configPath, "utf-8"));
    }
  }
  
  private async loadPayments(): Promise<void> {
    const paymentsPath = path.join(this.paymentsDir, "payments");
    if (!existsSync(paymentsPath)) return;
    
    const files = await fs.readdir(paymentsPath);
    for (const file of files) {
      if (file.endsWith(".json")) {
        try {
          const payment = JSON.parse(await fs.readFile(path.join(paymentsPath, file), "utf-8"));
          this.payments.set(payment.id as PaymentId, payment);
        } catch {}
      }
    }
  }
  
  private async loadSubscriptions(): Promise<void> {
    const subsPath = path.join(this.paymentsDir, "subscriptions");
    if (!existsSync(subsPath)) return;
    
    const files = await fs.readdir(subsPath);
    for (const file of files) {
      if (file.endsWith(".json")) {
        try {
          const sub = JSON.parse(await fs.readFile(path.join(subsPath, file), "utf-8"));
          this.subscriptions.set(sub.id, sub);
        } catch {}
      }
    }
  }
  
  // ===========================================================================
  // CONFIGURATION
  // ===========================================================================
  
  async configure(config: PaymentGatewayConfig): Promise<void> {
    this.config = config;
    await this.saveConfig();
    
    // Initialize providers for enabled chains
    for (const chainId of config.supportedChains) {
      await this.getProvider(chainId);
    }
    
    this.emit("gateway:configured", config);
  }
  
  private async saveConfig(): Promise<void> {
    await fs.writeFile(
      path.join(this.paymentsDir, "config.json"),
      JSON.stringify(this.config, null, 2)
    );
  }
  
  getConfig(): PaymentGatewayConfig | null {
    return this.config;
  }
  
  getSupportedChains(): Array<{ chainId: number; name: string; stablecoins: string[] }> {
    return Object.entries(CHAIN_CONFIGS).map(([chainId, config]) => ({
      chainId: parseInt(chainId),
      name: config.name,
      stablecoins: Object.keys(config.stablecoins),
    }));
  }
  
  // ===========================================================================
  // PROVIDER MANAGEMENT
  // ===========================================================================
  
  private async getProvider(chainId: number): Promise<ethers.JsonRpcProvider> {
    let provider = this.providers.get(chainId);
    if (provider) return provider;
    
    const chainConfig = CHAIN_CONFIGS[chainId];
    if (!chainConfig) {
      throw new Error(`Unsupported chain: ${chainId}`);
    }
    
    // Use custom RPC if configured
    const rpcUrl = this.config?.customRpcUrls?.[chainId] || chainConfig.rpcUrl;
    provider = new ethers.JsonRpcProvider(rpcUrl);
    this.providers.set(chainId, provider);
    
    return provider;
  }
  
  // ===========================================================================
  // PAYMENT CREATION
  // ===========================================================================
  
  async createPayment(params: {
    amount: string;
    currency: string;
    chainId: number;
    merchantOrderId?: string;
    description?: string;
    metadata?: Record<string, unknown>;
    expiresIn?: number; // seconds
    callbackUrl?: string;
  }): Promise<Payment> {
    if (!this.config) {
      throw new Error("Payment gateway not configured");
    }
    
    if (!this.config.supportedChains.includes(params.chainId)) {
      throw new Error(`Chain not supported: ${params.chainId}`);
    }
    
    const chainConfig = CHAIN_CONFIGS[params.chainId];
    const isNative = params.currency === chainConfig.nativeCurrency.symbol;
    
    // Validate currency
    if (!isNative && !chainConfig.stablecoins[params.currency]) {
      throw new Error(`Currency not supported on chain ${params.chainId}: ${params.currency}`);
    }
    
    const paymentId = crypto.randomUUID() as PaymentId;
    
    // Generate unique payment address (derived from merchant wallet)
    const paymentAddress = await this.generatePaymentAddress(paymentId);
    
    const payment: Payment = {
      id: paymentId,
      merchantId: this.config.merchantId,
      merchantOrderId: params.merchantOrderId,
      amount: params.amount,
      currency: params.currency,
      chainId: params.chainId,
      status: "pending",
      paymentAddress,
      tokenAddress: isNative ? undefined : chainConfig.stablecoins[params.currency],
      description: params.description,
      metadata: params.metadata,
      expiresAt: params.expiresIn ? Date.now() + params.expiresIn * 1000 : undefined,
      callbackUrl: params.callbackUrl,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    
    await this.savePayment(payment);
    this.payments.set(paymentId, payment);
    
    // Start watching for payment
    this.watchForPayment(payment);
    
    this.emit("payment:created", payment);
    
    return payment;
  }
  
  private async generatePaymentAddress(paymentId: PaymentId): Promise<string> {
    if (!this.config?.merchantWallet) {
      throw new Error("Merchant wallet not configured");
    }
    
    // In production, you'd use HD wallet derivation or create unique addresses
    // For simplicity, we're using the merchant wallet directly
    // A real implementation would derive unique addresses for each payment
    
    return this.config.merchantWallet;
  }
  
  private async savePayment(payment: Payment): Promise<void> {
    const paymentsDir = path.join(this.paymentsDir, "payments");
    await fs.mkdir(paymentsDir, { recursive: true });
    await fs.writeFile(
      path.join(paymentsDir, `${payment.id}.json`),
      JSON.stringify(payment, null, 2)
    );
  }
  
  // ===========================================================================
  // PAYMENT WATCHING
  // ===========================================================================
  
  private watchForPayment(payment: Payment): void {
    if (payment.status !== "pending") return;
    
    const key = `${payment.chainId}:${payment.paymentAddress}:${payment.id}`;
    this.watchedAddresses.set(key, {
      chainId: payment.chainId,
      callback: (confirmedPayment) => {
        this.handlePaymentReceived(confirmedPayment);
      },
    });
    
    // Ensure we're watching this chain's blocks
    this.startBlockWatcher(payment.chainId);
  }
  
  private startBlockWatcher(chainId: number): void {
    if (this.blockWatchers.has(chainId)) return;
    
    const interval = setInterval(async () => {
      try {
        await this.checkPendingPayments(chainId);
      } catch (error) {
        logger.error("Block watcher error", { chainId, error });
      }
    }, 15000); // Check every 15 seconds
    
    this.blockWatchers.set(chainId, interval);
  }
  
  private async checkPendingPayments(chainId: number): Promise<void> {
    const provider = await this.getProvider(chainId);
    const chainConfig = CHAIN_CONFIGS[chainId];
    
    // Get pending payments for this chain
    const pendingPayments = Array.from(this.payments.values())
      .filter((p) => p.chainId === chainId && p.status === "pending");
    
    for (const payment of pendingPayments) {
      // Check if expired
      if (payment.expiresAt && Date.now() > payment.expiresAt) {
        payment.status = "expired";
        payment.updatedAt = Date.now();
        await this.savePayment(payment);
        this.emit("payment:expired", payment);
        continue;
      }
      
      try {
        // Check for native currency payment
        if (!payment.tokenAddress) {
          const balance = await provider.getBalance(payment.paymentAddress);
          const requiredAmount = ethers.parseUnits(
            payment.amount,
            chainConfig.nativeCurrency.decimals
          );
          
          if (balance >= requiredAmount) {
            await this.confirmPayment(payment, balance.toString());
          }
        } else {
          // Check for token payment
          const tokenContract = new ethers.Contract(
            payment.tokenAddress,
            ERC20_ABI,
            provider
          );
          
          const [balance, decimals] = await Promise.all([
            tokenContract.balanceOf(payment.paymentAddress),
            tokenContract.decimals(),
          ]);
          
          const requiredAmount = ethers.parseUnits(payment.amount, decimals);
          
          if (balance >= requiredAmount) {
            await this.confirmPayment(payment, balance.toString());
          }
        }
      } catch (error) {
        logger.warn("Error checking payment", { paymentId: payment.id, error });
      }
    }
  }
  
  private async confirmPayment(payment: Payment, amountReceived: string): Promise<void> {
    payment.status = "confirming";
    payment.amountReceived = amountReceived;
    payment.updatedAt = Date.now();
    await this.savePayment(payment);
    this.emit("payment:confirming", payment);
    
    // Wait for confirmations
    const confirmations = this.config?.confirmationsRequired || 3;
    
    // In a real implementation, we'd track block confirmations
    // For simplicity, we'll just wait a bit
    setTimeout(async () => {
      payment.status = "confirmed";
      payment.confirmedAt = Date.now();
      payment.confirmations = confirmations;
      payment.updatedAt = Date.now();
      await this.savePayment(payment);
      
      this.handlePaymentReceived(payment);
    }, confirmations * 15000); // ~15 seconds per confirmation
  }
  
  private async handlePaymentReceived(payment: Payment): Promise<void> {
    logger.info("Payment confirmed", { paymentId: payment.id, amount: payment.amountReceived });
    
    this.emit("payment:confirmed", payment);
    
    // Call webhook if configured
    if (payment.callbackUrl) {
      await this.callWebhook(payment.callbackUrl, {
        event: "payment.confirmed",
        payment,
      });
    }
    
    // Remove from watched
    const key = `${payment.chainId}:${payment.paymentAddress}:${payment.id}`;
    this.watchedAddresses.delete(key);
  }
  
  // ===========================================================================
  // PAYMENT MANAGEMENT
  // ===========================================================================
  
  getPayment(paymentId: PaymentId): Payment | null {
    return this.payments.get(paymentId) || null;
  }
  
  listPayments(filters?: {
    status?: PaymentStatus;
    chainId?: number;
    merchantOrderId?: string;
    limit?: number;
    offset?: number;
  }): Payment[] {
    let payments = Array.from(this.payments.values());
    
    if (filters?.status) {
      payments = payments.filter((p) => p.status === filters.status);
    }
    if (filters?.chainId) {
      payments = payments.filter((p) => p.chainId === filters.chainId);
    }
    if (filters?.merchantOrderId) {
      payments = payments.filter((p) => p.merchantOrderId === filters.merchantOrderId);
    }
    
    payments.sort((a, b) => b.createdAt - a.createdAt);
    
    if (filters?.offset) {
      payments = payments.slice(filters.offset);
    }
    if (filters?.limit) {
      payments = payments.slice(0, filters.limit);
    }
    
    return payments;
  }
  
  async cancelPayment(paymentId: PaymentId): Promise<Payment> {
    const payment = this.payments.get(paymentId);
    if (!payment) {
      throw new Error(`Payment not found: ${paymentId}`);
    }
    
    if (payment.status !== "pending") {
      throw new Error(`Cannot cancel payment with status: ${payment.status}`);
    }
    
    payment.status = "cancelled";
    payment.updatedAt = Date.now();
    await this.savePayment(payment);
    
    // Remove from watched
    const key = `${payment.chainId}:${payment.paymentAddress}:${payment.id}`;
    this.watchedAddresses.delete(key);
    
    this.emit("payment:cancelled", payment);
    
    return payment;
  }
  
  // ===========================================================================
  // SUBSCRIPTIONS
  // ===========================================================================
  
  async createSubscription(params: {
    planId: string;
    planName: string;
    amount: string;
    currency: string;
    chainId: number;
    interval: "daily" | "weekly" | "monthly" | "yearly";
    subscriberAddress: string;
    metadata?: Record<string, unknown>;
  }): Promise<Subscription> {
    const subscriptionId = crypto.randomUUID();
    
    const subscription: Subscription = {
      id: subscriptionId,
      merchantId: this.config?.merchantId || "",
      planId: params.planId,
      planName: params.planName,
      amount: params.amount,
      currency: params.currency,
      chainId: params.chainId,
      interval: params.interval,
      subscriberAddress: params.subscriberAddress,
      status: "active",
      currentPeriodStart: Date.now(),
      currentPeriodEnd: this.calculatePeriodEnd(Date.now(), params.interval),
      nextPaymentDate: this.calculatePeriodEnd(Date.now(), params.interval),
      payments: [],
      metadata: params.metadata,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    
    await this.saveSubscription(subscription);
    this.subscriptions.set(subscriptionId, subscription);
    
    this.emit("subscription:created", subscription);
    
    return subscription;
  }
  
  private calculatePeriodEnd(start: number, interval: string): number {
    const date = new Date(start);
    switch (interval) {
      case "daily":
        date.setDate(date.getDate() + 1);
        break;
      case "weekly":
        date.setDate(date.getDate() + 7);
        break;
      case "monthly":
        date.setMonth(date.getMonth() + 1);
        break;
      case "yearly":
        date.setFullYear(date.getFullYear() + 1);
        break;
    }
    return date.getTime();
  }
  
  private async saveSubscription(subscription: Subscription): Promise<void> {
    const subsDir = path.join(this.paymentsDir, "subscriptions");
    await fs.mkdir(subsDir, { recursive: true });
    await fs.writeFile(
      path.join(subsDir, `${subscription.id}.json`),
      JSON.stringify(subscription, null, 2)
    );
  }
  
  getSubscription(subscriptionId: string): Subscription | null {
    return this.subscriptions.get(subscriptionId) || null;
  }
  
  listSubscriptions(filters?: {
    status?: string;
    subscriberAddress?: string;
  }): Subscription[] {
    let subs = Array.from(this.subscriptions.values());
    
    if (filters?.status) {
      subs = subs.filter((s) => s.status === filters.status);
    }
    if (filters?.subscriberAddress) {
      subs = subs.filter((s) => s.subscriberAddress.toLowerCase() === filters.subscriberAddress!.toLowerCase());
    }
    
    return subs.sort((a, b) => b.createdAt - a.createdAt);
  }
  
  async cancelSubscription(subscriptionId: string): Promise<Subscription> {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) {
      throw new Error(`Subscription not found: ${subscriptionId}`);
    }
    
    subscription.status = "cancelled";
    subscription.cancelledAt = Date.now();
    subscription.updatedAt = Date.now();
    await this.saveSubscription(subscription);
    
    this.emit("subscription:cancelled", subscription);
    
    return subscription;
  }
  
  // ===========================================================================
  // PAYMENT LINKS
  // ===========================================================================
  
  generatePaymentLink(payment: Payment): string {
    // Generate a payment link that can be shared
    const params = new URLSearchParams({
      paymentId: payment.id,
      amount: payment.amount,
      currency: payment.currency,
      chainId: String(payment.chainId),
      address: payment.paymentAddress,
    });
    
    if (payment.tokenAddress) {
      params.set("token", payment.tokenAddress);
    }
    
    // In a real app, this would be your hosted payment page
    return `joycreate://pay?${params.toString()}`;
  }
  
  generateQRCodeData(payment: Payment): string {
    const chainConfig = CHAIN_CONFIGS[payment.chainId];
    
    if (payment.tokenAddress) {
      // ERC-681 token transfer URI
      return `ethereum:${payment.tokenAddress}@${payment.chainId}/transfer?address=${payment.paymentAddress}&uint256=${ethers.parseUnits(payment.amount, 18)}`;
    } else {
      // ERC-681 native transfer URI
      return `ethereum:${payment.paymentAddress}@${payment.chainId}?value=${ethers.parseUnits(payment.amount, chainConfig.nativeCurrency.decimals)}`;
    }
  }
  
  // ===========================================================================
  // WEBHOOKS
  // ===========================================================================
  
  async registerWebhook(params: {
    url: string;
    events: string[];
    metadata?: Record<string, unknown>;
  }): Promise<Webhook> {
    const webhook: Webhook = {
      id: crypto.randomUUID(),
      url: params.url,
      events: params.events,
      secret: crypto.randomBytes(32).toString("hex"),
      enabled: true,
      metadata: params.metadata,
      createdAt: Date.now(),
    };
    
    this.webhooks.set(webhook.id, webhook);
    
    // Save webhooks
    await fs.writeFile(
      path.join(this.paymentsDir, "webhooks.json"),
      JSON.stringify(Array.from(this.webhooks.values()), null, 2)
    );
    
    return webhook;
  }
  
  private async callWebhook(url: string, payload: Record<string, unknown>): Promise<void> {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      
      if (!response.ok) {
        logger.warn("Webhook call failed", { url, status: response.status });
      }
    } catch (error) {
      logger.error("Webhook call error", { url, error });
    }
  }
  
  // ===========================================================================
  // ANALYTICS
  // ===========================================================================
  
  async getAnalytics(params?: {
    startDate?: number;
    endDate?: number;
    chainId?: number;
    currency?: string;
  }): Promise<{
    totalPayments: number;
    totalVolume: Record<string, string>;
    paymentsByStatus: Record<string, number>;
    paymentsByChain: Record<number, number>;
    averageConfirmationTime: number;
    recentPayments: Payment[];
  }> {
    let payments = Array.from(this.payments.values());
    
    if (params?.startDate) {
      payments = payments.filter((p) => p.createdAt >= params.startDate!);
    }
    if (params?.endDate) {
      payments = payments.filter((p) => p.createdAt <= params.endDate!);
    }
    if (params?.chainId) {
      payments = payments.filter((p) => p.chainId === params.chainId);
    }
    if (params?.currency) {
      payments = payments.filter((p) => p.currency === params.currency);
    }
    
    const totalVolume: Record<string, string> = {};
    const paymentsByStatus: Record<string, number> = {};
    const paymentsByChain: Record<number, number> = {};
    let totalConfirmationTime = 0;
    let confirmedCount = 0;
    
    for (const payment of payments) {
      // Volume by currency
      const currentVolume = parseFloat(totalVolume[payment.currency] || "0");
      totalVolume[payment.currency] = (currentVolume + parseFloat(payment.amountReceived || payment.amount)).toString();
      
      // By status
      paymentsByStatus[payment.status] = (paymentsByStatus[payment.status] || 0) + 1;
      
      // By chain
      paymentsByChain[payment.chainId] = (paymentsByChain[payment.chainId] || 0) + 1;
      
      // Confirmation time
      if (payment.confirmedAt) {
        totalConfirmationTime += payment.confirmedAt - payment.createdAt;
        confirmedCount++;
      }
    }
    
    return {
      totalPayments: payments.length,
      totalVolume,
      paymentsByStatus,
      paymentsByChain,
      averageConfirmationTime: confirmedCount > 0 ? totalConfirmationTime / confirmedCount : 0,
      recentPayments: payments.sort((a, b) => b.createdAt - a.createdAt).slice(0, 10),
    };
  }
  
  // ===========================================================================
  // REFUNDS
  // ===========================================================================
  
  async initiateRefund(
    paymentId: PaymentId,
    params: {
      amount?: string; // Partial refund
      reason?: string;
      privateKey: string;
    }
  ): Promise<{ transactionHash: string }> {
    const payment = this.payments.get(paymentId);
    if (!payment) {
      throw new Error(`Payment not found: ${paymentId}`);
    }
    
    if (payment.status !== "confirmed") {
      throw new Error(`Cannot refund payment with status: ${payment.status}`);
    }
    
    const refundAmount = params.amount || payment.amountReceived || payment.amount;
    const chainConfig = CHAIN_CONFIGS[payment.chainId];
    const provider = await this.getProvider(payment.chainId);
    const wallet = new ethers.Wallet(params.privateKey, provider);
    
    let tx: ethers.TransactionResponse;
    
    if (payment.tokenAddress) {
      // Token refund
      const tokenContract = new ethers.Contract(payment.tokenAddress, ERC20_ABI, wallet);
      const decimals = await tokenContract.decimals();
      const amount = ethers.parseUnits(refundAmount, decimals);
      
      tx = await tokenContract.transfer(payment.metadata?.senderAddress || payment.paymentAddress, amount);
    } else {
      // Native refund
      tx = await wallet.sendTransaction({
        to: payment.metadata?.senderAddress || payment.paymentAddress,
        value: ethers.parseUnits(refundAmount, chainConfig.nativeCurrency.decimals),
      });
    }
    
    await tx.wait();
    
    // Update payment
    payment.status = "refunded";
    payment.refundedAmount = refundAmount;
    payment.refundTransactionHash = tx.hash;
    payment.refundReason = params.reason;
    payment.updatedAt = Date.now();
    await this.savePayment(payment);
    
    this.emit("payment:refunded", payment);
    
    return { transactionHash: tx.hash };
  }
  
  // ===========================================================================
  // UTILITIES
  // ===========================================================================
  
  async getExchangeRate(
    fromCurrency: string,
    toCurrency: string
  ): Promise<number> {
    // In production, integrate with price feeds (Chainlink, CoinGecko, etc.)
    // For now, return mock rates
    const mockRates: Record<string, Record<string, number>> = {
      ETH: { USD: 3500, USDC: 3500, USDT: 3500 },
      MATIC: { USD: 0.85, USDC: 0.85, USDT: 0.85 },
      BNB: { USD: 600, USDC: 600, USDT: 600 },
      USDC: { USD: 1, USDT: 1, DAI: 1 },
      USDT: { USD: 1, USDC: 1, DAI: 1 },
    };
    
    return mockRates[fromCurrency]?.[toCurrency] || 1;
  }
  
  async estimateGasFee(chainId: number): Promise<{ gasPrice: string; estimatedFee: string }> {
    const provider = await this.getProvider(chainId);
    const feeData = await provider.getFeeData();
    
    const gasPrice = ethers.formatUnits(feeData.gasPrice || 0, "gwei");
    const estimatedGas = 21000n; // Basic transfer
    const estimatedFee = ethers.formatEther((feeData.gasPrice || 0n) * estimatedGas);
    
    return { gasPrice, estimatedFee };
  }
  
  /**
   * Shutdown service
   */
  async shutdown(): Promise<void> {
    // Stop block watchers
    for (const interval of this.blockWatchers.values()) {
      clearInterval(interval);
    }
    this.blockWatchers.clear();
    this.watchedAddresses.clear();
  }
}

// Export singleton
export const cryptoPaymentGateway = new CryptoPaymentGateway();
