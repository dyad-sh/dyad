import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useNavigate } from '@tanstack/react-router';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAdminPermissions } from '@/hooks/useAdminPermissions';
import { serializeForCache } from '@/hooks/useDraftCache';
import { useCryptoPrice } from '@/hooks/useCryptoPrice';
import { useAccount, useSignMessage, useWalletClient, usePublicClient } from 'wagmi';
import { supabase } from '@/integrations/supabase/client';
import { MarketplaceListingService } from '@/services/marketplaceListingService';
import { getStoreContract } from '@/services/storeContractService';
import { CheckCircle, Loader2, Brain, Shield, Upload, FileText, DollarSign, Sparkles, Store, Zap, Download, PenLine, Bot, Cpu, AlertCircle } from 'lucide-react';
import { JoyAssetAssistantChat, AssetAssistantContext } from '@/components/onboarding/JoyAssetAssistantChat';
import { TrustlessEncryptionStep } from '@/components/asset-creation/steps/TrustlessEncryptionStep';
import { TrustlessEncryptionConfig } from '@/hooks/useTrustlessEncryption';
import { toast } from '@/hooks/use-toast';
import jsPDF from 'jspdf';
import { mintTo } from "thirdweb/extensions/erc1155";
import { getContract } from "thirdweb";
import { useSendTransaction } from "thirdweb/react";
import { nftCreationFlowService } from '@/services/nftCreationFlowService';
import { NFTDetailsCard } from '@/components/marketplace/NFTDetailsCard';
import { aiProviderService } from '@/services/aiProviderService';
import { useAssetManifestSigning } from '@/hooks/useAssetManifestSigning';
import { AssetManifestSignatureResult } from '@/services/walletSignatureService';
import { AgentConfigStep } from '@/components/agent-compute/AgentConfigStep';
import { useAgentDeployment } from '@/hooks/useAgentDeployment';
import { AgentConfig, DEFAULT_COMPUTE_CONFIG } from '@/types/agent-compute';
import { useCelestiaDA } from '@/hooks/useCelestiaDA';
import { CelestiaStatusBadge, CelestiaAnchoringCard, CelestiaAnchorSummary } from '@/components/celestia/CelestiaDAComponents';
import { getJoyFlowBridge } from '@/services/joyflow-bridge';
import { usePostMintWeb3Pipeline } from '@/hooks/usePostMintWeb3Pipeline';
import { Web3PipelineStatus } from '@/components/asset-creation/Web3PipelineStatus';
import { useThirdwebMarketplace } from '@/hooks/useThirdwebMarketplace';
import { THIRDWEB_CONTRACTS, thirdwebClient, getThirdwebChain } from '@/config/thirdweb';

// Constants
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';

// Helper functions
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function arrayBufferToBase64(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function hashString(str: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Edge function fallback helper to bypass supabase-js transport issues
const EDGE_BASE = 'https://jgsbmnzhvuwiujqbaieo.supabase.co/functions/v1';
const PUBLIC_SUPABASE_ANON = (typeof SUPABASE_ANON_KEY === 'string' && SUPABASE_ANON_KEY.length > 0)
  ? SUPABASE_ANON_KEY
  : 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impnc2JtbnpodnV3aXVqcWJhaWVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDA2MDAxNTEsImV4cCI6MjA1NjE3NjE1MX0.jGGW8mTgX7jXcWiylbxmjOwCIGdl226LRauVMXiWtc4';

async function callEdgeFunction<T = any>(name: string, body: any): Promise<{ data: T | null; error: any | null }> {
  try {
    const { data, error } = await (supabase as any).functions.invoke(name, { body });
    if (!error && data) return { data, error: null };
  } catch (e) {
    // fall through to direct fetch
  }
  try {
    const res = await fetch(`${EDGE_BASE}/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': PUBLIC_SUPABASE_ANON,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    const json = await res.json();
    return { data: json, error: null };
  } catch (err) {
    return { data: null, error: err };
  }
}

// Target chain — Polygon Amoy Testnet (matches thirdweb.ts)
const TARGET_CHAIN_ID = 80002;
const TARGET_CHAIN_NAME = 'Polygon Amoy Testnet';

// Display order for sidebar — Asset Details (12) moved before Mint NFT (10)
// Internal step IDs are preserved to avoid renumbering all logic
const WIZARD_STEPS = [
  { id: 1, title: 'Upload Asset', icon: Upload },
  { id: 2, title: 'Asset Metadata', icon: FileText },
  { id: 3, title: 'Security & Encryption', icon: Shield },
  { id: 4, title: 'AI Smart Chunking', icon: Brain },
  { id: 5, title: 'Proof-of-Inference', icon: CheckCircle },
  { id: 6, title: 'Royalties & Pricing', icon: DollarSign },
  { id: 7, title: 'License & Terms', icon: FileText },
  { id: 8, title: 'Generate Image', icon: Sparkles },
  { id: 9, title: 'Quality Score', icon: Sparkles },
  { id: 12, title: 'Asset Details', icon: FileText },
  { id: 10, title: 'Mint NFT', icon: Zap },
  { id: 11, title: 'Agent Compute', icon: Cpu },
  { id: 13, title: 'Final Review', icon: CheckCircle },
  { id: 14, title: '🏪 List on Marketplace', icon: Store },
];

// Navigation order: the actual step sequence the user follows
const STEP_ORDER = [1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 10, 11, 13, 14];

export const CreateAssetWizard: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { permissions: adminPermissions } = useAdminPermissions();
  const isAdmin = adminPermissions.isSuperAdmin || adminPermissions.canManageGlobalSettings;
  const { address } = useAccount();
  const { address: walletAddress, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const { prices: cryptoPrices } = useCryptoPrice();
  
  // Celestia DA integration
  const celestiaDA = useCelestiaDA();
  const web3Pipeline = usePostMintWeb3Pipeline();
  const { createDirectListing, isLoading: isListingOnChain } = useThirdwebMarketplace();
  const { mutateAsync: sendMintTx } = useSendTransaction();
  
  const [currentStep, setCurrentStep] = useState(1);
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  const [processing, setProcessing] = useState(false);
  const [logs, setLogs] = useState<{ [key: number]: string[] }>({});
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  
  // Form state
  const [modelData, setModelData] = useState<any>({ file: null });
  const [encryptionConfig, setEncryptionConfig] = useState<{
    encryptionLevel: string;
    keySource: string;
    enableChunkEncryption: boolean;
    enableMetadataEncryption: boolean;
    enableAccessControl: boolean;
    enableSHAPinning: boolean;
    hashStorageMethod: string;
    includeMerkleTree: boolean;
    enableWatermark: boolean;
    enableAntiTampering: boolean;
    enableTimelock: boolean;
    masterKey: CryptoKey | null;
    chunkKeys: CryptoKey[];
    // Trustless encryption config
    trustlessEnabled?: boolean;
    trustlessMode?: string;
    trustlessResult?: any;
  }>({
    encryptionLevel: 'basic',
    keySource: 'auto',
    enableChunkEncryption: true,
    enableMetadataEncryption: true,
    enableAccessControl: true,
    enableSHAPinning: true,
    hashStorageMethod: 'onchain',
    includeMerkleTree: true,
    enableWatermark: false,
    enableAntiTampering: true,
    enableTimelock: false,
    masterKey: null,
    chunkKeys: [],
    trustlessEnabled: false,
    trustlessMode: undefined,
    trustlessResult: undefined
  });
  const [chunkData, setChunkData] = useState<any>({ chunks: [], merkleRoot: '', ipldManifestCID: '' });
  const [contractData, setContractData] = useState<any>({
    contractType: 'ai-model', // 'ai-model' | 'inference' | 'standard'
    deploymentType: 'standard', // 'standard' | 'upgradable' | 'fractional' | 'ai-custom'
    contractName: '',
    contractSymbol: '',
    address: null,
    deployed: false,
    deploymentOption: 'existing',
    features: [],
  });
  const [licenseData, setLicenseData] = useState<any>({
    licenseType: 'commercial',
    allowCommercial: true,
    allowModification: true,
    allowRedistribution: false,
    requireAttribution: true,
    revenueShareModel: 'fixed',
    customTerms: '',
    cid: null,
  });
  const [pricingData, setPricingData] = useState({
    initialPrice: 1,
    royaltyPercent: 10,
    creatorWallet: '',
    pricingModel: 'fixed',
    currency: 'MATIC',
  });
  const [nftData, setNftData] = useState<any>({ 
    name: '',
    description: '',
    modelType: 'language',
    version: '1.0.0',
    metadata: {},
    qualityScore: 0,
    imageIPFS: null,
  });
  const [assetDetails, setAssetDetails] = useState({
    demoVideoUrl: '',
    whitepaperUrl: '',
    testResultsUrl: '',
    trainingDataInfo: '',
    useCases: '',
    limitations: '',
    additionalTags: '',
    githubUrl: '',
    huggingfaceUrl: '',
    websiteUrl: '',
  });
  const [storeSettings, setStoreSettings] = useState({
    listingType: 'sale',
    leaseDuration: 30,
    leasePrice: 1,
    showTechnicalDetails: true,
    showDocumentation: true,
    showPerformanceMetrics: true,
    highlightFeatured: false,
    addToHotDeals: false,
    addToTopPicks: false,
  });
  const [showStorePreview, setShowStorePreview] = useState(false);
  const [qualityConfig, setQualityConfig] = useState({
    assessmentType: 'automated',
    enableIPLDSchema: true,
  });
  const [proofConfig, setProofConfig] = useState({
    proofType: 'zk-snark',
    testInput: 'Sample AI inference test',
    enableIPLDProof: true,
  });
  const [imageConfig, setImageConfig] = useState({
    useCustomPrompt: false,
    customImagePrompt: '',
  });
  const [downloadUrl, setDownloadUrl] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [enhancingDescription, setEnhancingDescription] = useState(false);
  const [imageGenerated, setImageGenerated] = useState(false);
  const [mintWallet, setMintWallet] = useState('');
  const mintSupply = 1; // Fixed at 1 - canonical asset only, buyers get license tokens
  // selectedMintingContract removed — all minting uses shared Thirdweb ERC-1155 JoyLicenseToken
  const [generatingDetail, setGeneratingDetail] = useState<string | null>(null);
  const [showAssetAssistant, setShowAssetAssistant] = useState(false);
  const [assistantContext, setAssistantContext] = useState<AssetAssistantContext>('description');
  const [isDragging, setIsDragging] = useState(false);
  const [storeId, setStoreId] = useState<string | null>(null);
  const [storeHasContract, setStoreHasContract] = useState(false);
  const [checkingStoreContract, setCheckingStoreContract] = useState(true);
  const [showContractResetDialog, setShowContractResetDialog] = useState(false);
  const [resettingContract, setResettingContract] = useState(false);
  const [manifestSignature, setManifestSignature] = useState<AssetManifestSignatureResult | null>(null);
  const [agentConfig, setAgentConfig] = useState<AgentConfig | null>(null);

  // Hook for manifest signing (anti-spam)
  const { signManifest, storeSignature, isSigning: isSigningManifest } = useAssetManifestSigning();

  const overallProgress = (completedSteps.length / WIZARD_STEPS.length) * 100;

  // --- Draft caching (keeps progress if user closes modal/navigates away) ---
  const wizardDraftKey = useMemo(() => `asset-wizard-draft-v1-${user?.id ?? 'anon'}`, [user?.id]);
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Restore draft on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(wizardDraftKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 1) return;

      // Restore all serializable state
      if (parsed.currentStep) setCurrentStep(parsed.currentStep);
      if (parsed.completedSteps) setCompletedSteps(parsed.completedSteps);
      if (parsed.nftData) setNftData((prev: any) => ({ ...prev, ...parsed.nftData }));
      if (parsed.pricingData) setPricingData((prev) => ({ ...prev, ...parsed.pricingData }));
      if (parsed.licenseData) setLicenseData((prev: any) => ({ ...prev, ...parsed.licenseData }));
      if (parsed.assetDetails) setAssetDetails((prev) => ({ ...prev, ...parsed.assetDetails }));
      if (parsed.storeSettings) setStoreSettings((prev) => ({ ...prev, ...parsed.storeSettings }));
      if (parsed.qualityConfig) setQualityConfig((prev) => ({ ...prev, ...parsed.qualityConfig }));
      if (parsed.proofConfig) setProofConfig((prev) => ({ ...prev, ...parsed.proofConfig }));
      if (parsed.imageConfig) setImageConfig((prev) => ({ ...prev, ...parsed.imageConfig }));
      if (parsed.encryptionConfig) {
        // Don't restore cryptographic keys
        const { masterKey, chunkKeys, ...safeEncryption } = parsed.encryptionConfig;
        setEncryptionConfig((prev) => ({ ...prev, ...safeEncryption }));
      }
      if (parsed.chunkData) {
        // Don't restore actual chunk blobs
        const { chunks, ...safeChunk } = parsed.chunkData;
        setChunkData((prev: any) => ({ ...prev, ...safeChunk }));
      }
      if (parsed.contractData) setContractData((prev: any) => ({ ...prev, ...parsed.contractData }));
      if (parsed.mintWallet) setMintWallet(parsed.mintWallet);
      // mintSupply is now fixed at 1 - no longer restored from draft
      // selectedMintingContract draft restore removed — using shared ERC-1155

      toast({
        title: 'Draft restored',
        description: 'Your in-progress asset creation has been restored.',
      });
    } catch {
      // ignore bad drafts
    }
  }, [wizardDraftKey]);

  // Debounced autosave
  useEffect(() => {
    try {
      if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);

      // Don't save until user has started
      const hasMeaningfulDraft =
        Boolean(nftData.name || nftData.description) ||
        currentStep > 1 ||
        completedSteps.length > 0;

      if (!hasMeaningfulDraft) return;

      draftSaveTimerRef.current = setTimeout(() => {
        // Serialize state, excluding non-serializable values
        const payload = {
          version: 1,
          savedAt: new Date().toISOString(),
          currentStep,
          completedSteps,
          nftData: serializeForCache(nftData, ['file']),
          pricingData,
          licenseData,
          assetDetails,
          storeSettings,
          qualityConfig,
          proofConfig,
          imageConfig,
          encryptionConfig: serializeForCache(encryptionConfig, ['masterKey', 'chunkKeys'] as any),
          chunkData: serializeForCache(chunkData, ['chunks'] as any),
          contractData,
          mintWallet,
          mintSupply,
        };
        localStorage.setItem(wizardDraftKey, JSON.stringify(payload));
      }, 500);
    } catch {
      // ignore storage errors
    }

    return () => {
      if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    };
  }, [
    wizardDraftKey, currentStep, completedSteps, nftData, pricingData, licenseData,
    assetDetails, storeSettings, qualityConfig, proofConfig, imageConfig,
    encryptionConfig, chunkData, contractData, mintWallet, mintSupply
  ]);

  // Clear draft helper
  const clearWizardDraft = useCallback(() => {
    try {
      localStorage.removeItem(wizardDraftKey);
    } catch {
      // ignore
    }
  }, [wizardDraftKey]);

  // Auto-fill wallet address when user connects wallet
  useEffect(() => {
    if (isConnected && walletAddress && !pricingData.creatorWallet) {
      setPricingData(prev => ({ ...prev, creatorWallet: walletAddress }));
      toast({ 
        title: 'Wallet Connected', 
        description: `Address auto-filled: ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` 
      });
    }
    // Also auto-fill mint wallet
    if (isConnected && walletAddress && !mintWallet) {
      setMintWallet(walletAddress);
    }
  }, [isConnected, walletAddress]);

  // Fetch store and check for existing contract on mount
  useEffect(() => {
    const fetchStoreContract = async () => {
      if (!user?.id) {
        setCheckingStoreContract(false);
        return;
      }
      
      try {
        // Fetch user's store with collection contract info
        const { data: store, error } = await supabase
          .from('store_profiles')
          .select('id, collection_contract_address, collection_contract_name, collection_contract_symbol')
          .eq('user_id', user.id)
          .maybeSingle();
        
        if (error) {
          // If columns don't exist, migration hasn't been run yet
          if (error.message?.includes('does not exist')) {
            console.warn('⚠️ Store contract columns not yet added. Run migration: run-store-contract-migration.ps1');
            setCheckingStoreContract(false);
            return;
          }
          console.error('Error fetching store:', error);
          setCheckingStoreContract(false);
          return;
        }
        
        if (store) {
          setStoreId(store.id);
          
          // Check if store has a collection contract
          if (store.collection_contract_address) {
            console.log('✅ Store has existing collection contract:', store.collection_contract_address);
            setStoreHasContract(true);
            setContractData((prev: any) => ({
              ...prev,
              address: store.collection_contract_address,
              contractName: store.collection_contract_name || '',
              contractSymbol: store.collection_contract_symbol || '',
              deployed: true,
              deploymentType: 'standard',
            }));
          }
        }
      } catch (error) {
        console.error('Error checking store contract:', error);
      } finally {
        setCheckingStoreContract(false);
      }
    };
    
    fetchStoreContract();
  }, [user?.id]);

  // Contract name/symbol auto-fill removed (Step 9 contract deployment removed)

  const addLog = (step: number, type: 'info' | 'success' | 'error' | 'warning', message: string) => {
    setLogs(prev => ({
      ...prev,
      [step]: [...(prev[step] || []), `[${type.toUpperCase()}] ${message}`]
    }));
  };

  const markStepComplete = (step: number) => {
    if (!completedSteps.includes(step)) {
      setCompletedSteps(prev => [...prev, step]);
    }
  };

  // Step 1: File Upload & Drag-and-Drop handlers
  const processFiles = (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    if (fileArray.length > 0) {
      // If multiple files selected (folder), combine them
      if (fileArray.length > 1) {
        // Create a virtual file representing the folder
        const totalSize = fileArray.reduce((sum, f) => sum + f.size, 0);
        const folderName = `folder_${fileArray.length}_files`;
        
        // Store the first file for now (we can enhance this later to handle multiple files properly)
        const firstFile = fileArray[0];
        setModelData({ 
          file: firstFile, 
          name: folderName, 
          size: totalSize, 
          type: 'folder',
          allFiles: fileArray // Store all files for future processing
        });
        
        setLogs(prev => ({ ...prev, 1: [] }));
        addLog(1, 'success', `✅ Folder uploaded: ${fileArray.length} files (${(totalSize / 1024 / 1024).toFixed(2)} MB total)`);
        fileArray.slice(0, 5).forEach(file => {
          addLog(1, 'info', `📁 ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
        });
        if (fileArray.length > 5) {
          addLog(1, 'info', `📁 ... and ${fileArray.length - 5} more files`);
        }
        addLog(1, 'success', '✅ Files stored in memory - ready for processing!');
      } else {
        // Single file
        const file = fileArray[0];
        setModelData({ file, name: file.name, size: file.size, type: file.type });
        setLogs(prev => ({ ...prev, 1: [] }));
        addLog(1, 'success', `✅ File uploaded: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
        addLog(1, 'info', `📁 Type: ${file.type || 'application/octet-stream'}`);
        addLog(1, 'success', '✅ File stored in memory - ready for chunking!');
      }
      markStepComplete(1);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      processFiles(files);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      processFiles(files);
    }
  };

  const useTestModel = () => {
    const fakeContent = new Uint8Array(1024 * 1024 * 150); // 150MB
    for (let i = 0; i < fakeContent.length; i += 1024) {
      fakeContent[i] = Math.floor(Math.random() * 256);
    }
    const blob = new Blob([fakeContent], { type: 'application/octet-stream' });
    const file = new File([blob], 'test-model.bin', { type: 'application/octet-stream' });
    
    setModelData({ file, name: file.name, size: file.size, type: file.type });
    setLogs(prev => ({ ...prev, 1: [] }));
    addLog(1, 'success', '✅ Test model generated: test-model.bin');
    addLog(1, 'info', `📊 Size: ${(file.size / 1024 / 1024).toFixed(2)} MB`);
    addLog(1, 'success', '✅ File stored in memory - ready for chunking!');
    markStepComplete(1);
    
    // Auto-fill metadata
    setNftData(prev => ({
      ...prev,
      name: 'GPT-4 Customer Support Fine-tune',
      description: 'A fine-tuned GPT-4 model specialized for customer support conversations. Trained on 100k+ support tickets with high accuracy and empathetic responses.',
      modelType: 'language',
      version: '1.0.0'
    }));
  };

  const downloadFromUrl = async () => {
    if (!downloadUrl.trim()) {
      toast({ title: 'Error', description: 'Please enter a URL', variant: 'destructive' });
      return;
    }

    setDownloading(true);
    setLogs(prev => ({ ...prev, 1: [] }));
    addLog(1, 'info', `📥 Downloading from: ${downloadUrl}`);

    try {
      // Handle different repo formats
      let fetchUrl = downloadUrl;
      
      // GitHub raw URL conversion
      if (downloadUrl.includes('github.com') && !downloadUrl.includes('raw.githubusercontent.com')) {
        fetchUrl = downloadUrl
          .replace('github.com', 'raw.githubusercontent.com')
          .replace('/blob/', '/');
        addLog(1, 'info', `🔄 Converted to raw GitHub URL`);
      }
      
      // Hugging Face URL conversion
      if (downloadUrl.includes('huggingface.co') && !downloadUrl.includes('/resolve/')) {
        fetchUrl = downloadUrl.replace('/blob/', '/resolve/');
        addLog(1, 'info', `🔄 Converted to Hugging Face download URL`);
      }

      addLog(1, 'info', `🌐 Fetching file...`);
      const response = await fetch(fetchUrl);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentLength = response.headers.get('content-length');
      const totalSize = contentLength ? parseInt(contentLength, 10) : 0;
      addLog(1, 'info', `📊 File size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);

      const blob = await response.blob();
      
      // Extract filename from URL
      const urlParts = fetchUrl.split('/');
      const filename = urlParts[urlParts.length - 1] || 'downloaded-model.bin';
      
      const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
      
      setModelData({ file, name: file.name, size: file.size, type: file.type });
      addLog(1, 'success', `✅ Downloaded: ${file.name}`);
      addLog(1, 'info', `📁 Type: ${file.type || 'application/octet-stream'}`);
      addLog(1, 'success', '✅ File ready for chunking!');
      markStepComplete(1);
      
      toast({ title: 'Success', description: 'File downloaded successfully!' });
    } catch (error: any) {
      addLog(1, 'error', `❌ Download failed: ${error.message}`);
      toast({ 
        title: 'Download Failed', 
        description: error.message, 
        variant: 'destructive' 
      });
    } finally {
      setDownloading(false);
    }
  };

  // Step 2: Save Metadata
  const saveMetadata = () => {
    if (!nftData.name || !nftData.description) {
      toast({ title: 'Error', description: 'Name and description are required', variant: 'destructive' });
      return;
    }
    markStepComplete(2);
    toast({ title: 'Success', description: 'Metadata saved!' });
    setCurrentStep(3);
  };

  // Enhance Description with AI
  const enhanceDescription = async () => {
    if (!nftData.description || nftData.description.trim().length < 10) {
      toast({ 
        title: 'Error', 
        description: 'Please provide a basic description first (at least 10 characters)', 
        variant: 'destructive' 
      });
      return;
    }

    setEnhancingDescription(true);
    try {
      addLog(2, 'info', '🤖 Enhancing description with DeepSeek AI...');
      
      // Use unified AI Provider Service
      const response = await aiProviderService.chat({
        message: nftData.description,
        systemPrompt: `You are an expert AI marketing copywriter for a decentralized AI marketplace. 
        Your goal is to rewrite the user's product description to be professional, compelling, and SEO-friendly.
        
        Product Type: ${nftData.modelType}
        
        Guidelines:
        - Highlight key capabilities and use cases
        - Use professional technical language where appropriate
        - Keep it concise but persuasive (under 200 words)
        - Add 3-5 relevant keywords/tags at the end
        - Do NOT include any conversational filler ("Here is your description...")
        - Return ONLY the enhanced description text`,
        provider: 'local-deepseek' // Prefer local for cost/speed, service handles fallback
      });

      if (response.response) {
        setNftData((prev: any) => ({ ...prev, description: response.response }));
        addLog(2, 'success', '✅ Description enhanced successfully!');
        toast({ 
          title: 'Success', 
          description: 'Your description has been enhanced with AI!' 
        });
      } else {
        throw new Error('No enhanced description returned');
      }
    } catch (error: any) {
      addLog(2, 'error', `❌ Enhancement failed: ${error.message}`);
      toast({ 
        title: 'Enhancement Failed', 
        description: error.message || 'Failed to enhance description',
        variant: 'destructive' 
      });
    } finally {
      setEnhancingDescription(false);
    }
  };

  // Step 3: Security Configuration (using service)
  const configureEncryption = async () => {
    setProcessing(true);
    setLogs(prev => ({ ...prev, 3: [] }));

    try {
      const result = await nftCreationFlowService.setupEncryption(encryptionConfig);
      
      if (!result.success) {
        throw new Error(result.error);
      }
      
      // Update state with generated config
      setEncryptionConfig(result.data);
      
      // Display logs from service
      result.logs.forEach(log => {
        const match = log.match(/\[(.*?)\] (.*)/);
        if (match) {
          const type = match[1].toLowerCase() as 'info' | 'success' | 'warning' | 'error';
          addLog(3, type, match[2]);
        }
      });
      
      markStepComplete(3);
      toast({ title: 'Success', description: 'Security configured!' });
    } catch (error: any) {
      addLog(3, 'error', `❌ Error: ${error.message}`);
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setProcessing(false);
    }
  };

  // Step 4: AI Smart Chunking with REAL implementation
  const processChunking = async () => {
    if (!modelData.file) {
      toast({ title: 'Error', description: 'No file uploaded', variant: 'destructive' });
      return;
    }

    setProcessing(true);
    setLogs(prev => ({ ...prev, 4: [] }));

    try {
      const file = modelData.file;
      addLog(4, 'info', '📦 Starting REAL chunking process...');
      addLog(4, 'success', `✅ File loaded: ${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)`);

      const fileExtension = file.name.split('.').pop()?.toLowerCase() || '';
      const fileFormat = fileExtension;
      const isTensorFile = ['safetensors', 'pt', 'pth', 'ckpt', 'bin', 'gguf', 'ggml'].includes(fileFormat);
      addLog(4, 'success', `✅ File format: ${fileFormat}${isTensorFile ? ' (Tensor format detected)' : ''}`);

      // === STEP 1: ASK DEEPSEEK AI FOR OPTIMAL CHUNKING STRATEGY ===
      addLog(4, 'info', '🧠 Asking DeepSeek AI for optimal chunking strategy...');
      await sleep(300);

      let aiChunkingStrategy: any = null;
      
      const aiPrompt = `You are an expert in IPLD (InterPlanetary Linked Data) content-addressed storage and AI model distribution.

Analyze this AI model file and recommend the BEST chunking strategy:

File Information:
- Name: ${file.name}
- Size: ${(file.size / (1024 * 1024)).toFixed(2)} MB (${file.size} bytes)
- Format: ${fileFormat}
- Is Tensor File: ${isTensorFile ? 'Yes (SafeTensors/PyTorch/GGUF/etc.)' : 'No'}

Task: Recommend optimal IPLD content-addressed chunking strategy.

Consider:
1. For tensor files: Align chunks with tensor boundaries if possible (better for lazy loading)
2. For other files: Use fixed-size blocks optimized for IPFS/IPLD
3. Balance: Chunk size vs. number of chunks (affects retrieval efficiency)
4. Consider:
   - Lazy loading in browser (WebGPU/WebNN)
   - Efficient IPFS storage and retrieval
   - Block deduplication potential
   - Network transfer efficiency
5. Provide confidence score (0-100)

Return JSON format:
{
  "strategy": "tensor-aligned" | "fixed-size" | "layer-aligned" | "hybrid",
  "chunkSizeBytes": 1048576,
  "reasoning": "explanation",
  "tensorStrategy": "split-large-tensors" | "one-per-block" | "group-small",
  "estimatedBlocks": 100,
  "confidence": 95,
  "recommendations": ["rec1", "rec2"]
}`;

      try {
        const { data: deepseekData, error: deepseekError } = await supabase.functions.invoke('deepseek-analyze', {
          body: { 
            prompt: aiPrompt, 
            taskType: 'chunking_optimization',
            context: {
              fileSize: file.size,
              fileFormat: fileFormat,
              fileName: file.name
            }
          }
        });
        
        if (!deepseekError && deepseekData?.result) {
          aiChunkingStrategy = typeof deepseekData.result === 'string' ? JSON.parse(deepseekData.result) : deepseekData.result;
          
          if (!aiChunkingStrategy.chunkSizeBytes) {
            aiChunkingStrategy.chunkSizeBytes = 5 * 1024 * 1024; // Default 5MB
          }
          
          // Validate chunk size
          const minSize = 1024 * 1024; // 1MB
          const maxSize = 50 * 1024 * 1024; // 50MB
          aiChunkingStrategy.chunkSizeBytes = Math.max(minSize, Math.min(maxSize, aiChunkingStrategy.chunkSizeBytes));
          
          if (!aiChunkingStrategy.estimatedBlocks) {
            aiChunkingStrategy.estimatedBlocks = Math.ceil(file.size / aiChunkingStrategy.chunkSizeBytes);
          }
          
          addLog(4, 'success', '✅ DeepSeek AI Recommendation:');
          addLog(4, 'info', `   Strategy: ${aiChunkingStrategy.strategy || 'fixed-size'}`);
          addLog(4, 'info', `   Chunk Size: ${((aiChunkingStrategy.chunkSizeBytes || 1048576) / (1024 * 1024)).toFixed(2)} MB`);
          addLog(4, 'info', `   Estimated Blocks: ${aiChunkingStrategy.estimatedBlocks || 'calculating...'}`);
          addLog(4, 'info', `   Reasoning: ${aiChunkingStrategy.reasoning || 'Optimized for IPLD DAG'}`);
          addLog(4, 'info', `   Confidence: ${aiChunkingStrategy.confidence || 85}%`);
          
          if (aiChunkingStrategy.recommendations && aiChunkingStrategy.recommendations.length > 0) {
            addLog(4, 'info', '   Recommendations:');
            aiChunkingStrategy.recommendations.forEach((rec: string) => {
              addLog(4, 'info', `     • ${rec}`);
            });
          }
        } else {
          addLog(4, 'warning', '⚠️ AI analysis unavailable, using fallback strategy');
        }
      } catch (aiError) {
        console.warn('AI chunking analysis failed:', aiError);
        addLog(4, 'warning', '⚠️ AI analysis failed, using fallback strategy');
      }

      // === STEP 2: DETERMINE CHUNKING PARAMETERS (AI-DRIVEN) ===
      let chunkSize: number;
      let totalChunks: number;
      
      if (aiChunkingStrategy && aiChunkingStrategy.chunkSizeBytes) {
        chunkSize = aiChunkingStrategy.chunkSizeBytes;
        totalChunks = Math.ceil(file.size / chunkSize);
        
        addLog(4, 'success', '🎯 AI Smart Chunking Active:');
        addLog(4, 'info', `   • Chunk Size: ${(chunkSize / (1024 * 1024)).toFixed(2)} MB (AI-optimized)`);
        addLog(4, 'info', `   • Total Blocks: ${totalChunks} (calculated by AI)`);
        addLog(4, 'info', `   • Strategy: ${aiChunkingStrategy.strategy}`);
      } else {
        const defaultChunkSizeMB = 5;
        chunkSize = defaultChunkSizeMB * 1024 * 1024;
        totalChunks = Math.ceil(file.size / chunkSize);
        
        addLog(4, 'warning', '⚠️ AI unavailable - using conservative defaults:');
        addLog(4, 'info', `   • Chunk Size: ${defaultChunkSizeMB} MB (fallback)`);
        addLog(4, 'info', `   • Total Blocks: ${totalChunks} (calculated)`);
      }
      
      addLog(4, 'info', `File: ${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)`);
      addLog(4, 'info', `Total blocks: ${totalChunks} (${(chunkSize / (1024 * 1024)).toFixed(2)} MB each)`);
      addLog(4, 'info', `Strategy: ${aiChunkingStrategy?.strategy || 'fixed-size'}`);
      addLog(4, 'info', '🔗 Creating IPLD DAG with content-addressed blocks...');
      
      const chunks: any[] = [];
      const chunkHashes: string[] = [];
      const ipldBlocks: any[] = [];
      
      // Validate file is still accessible before reading
      if (!file || file.size === 0) {
        throw new Error('File is no longer accessible. Please re-select the file and try again.');
      }
      
      // Read file as ArrayBuffer with error handling
      let fileBuffer: ArrayBuffer;
      try {
        addLog(4, 'info', '📖 Reading file into memory...');
        fileBuffer = await file.arrayBuffer();
        addLog(4, 'success', `✅ File loaded: ${(fileBuffer.byteLength / (1024 * 1024)).toFixed(2)} MB`);
      } catch (fileReadError: any) {
        addLog(4, 'error', '❌ Failed to read file. The file may have been removed or access was denied.');
        addLog(4, 'info', '💡 Try: Re-uploading the file or selecting it again from your computer.');
        throw new Error('Unable to read file. Please re-select the file and try again. If the problem persists, try a different file or check browser permissions.');
      }
      
      // Process each chunk
      for (let i = 0; i < totalChunks; i++) {
        addLog(4, 'info', `📦 Block ${i + 1}/${totalChunks}: Creating content-addressed chunk...`);
        
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, fileBuffer.byteLength);
        let chunkBuffer = fileBuffer.slice(start, end);
        let chunkArray = new Uint8Array(chunkBuffer);
        
        // ENCRYPTION: Apply if configured (check both trustless AND legacy config)
        let encryptionMetadata: any = {};
        const shouldEncrypt = encryptionConfig.trustlessEnabled || 
          (encryptionConfig.enableChunkEncryption && encryptionConfig.masterKey);
        
        if (shouldEncrypt) {
          addLog(4, 'info', `🔐 Encrypting chunk ${i + 1}...`);
          
          const iv = crypto.getRandomValues(new Uint8Array(12));
          
          // Generate a key if we don't have one (for trustless mode)
          let encryptionKey = encryptionConfig.masterKey;
          if (!encryptionKey) {
            encryptionKey = await crypto.subtle.generateKey(
              { name: 'AES-GCM', length: 256 },
              true,
              ['encrypt', 'decrypt']
            );
            // Store the key for subsequent chunks
            setEncryptionConfig(prev => ({ ...prev, masterKey: encryptionKey }));
          }
          
          const encryptedData = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: iv },
            encryptionKey,
            chunkBuffer
          );
          
          chunkBuffer = encryptedData;
          chunkArray = new Uint8Array(chunkBuffer);
          
          encryptionMetadata = {
            encrypted: true,
            algorithm: 'AES-GCM-256',
            iv: await arrayBufferToBase64(iv.buffer),
            keyIndex: i,
            trustlessMode: encryptionConfig.trustlessMode || 'none'
          };
          
          addLog(4, 'success', `✅ Chunk ${i + 1} encrypted (${chunkArray.length} bytes)`);
        }
        
        // Create hash of chunk (SHA-256)
        const hashBuffer = await crypto.subtle.digest('SHA-256', chunkBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        
        addLog(4, 'info', `🔐 Chunk ${i + 1} SHA-256: ${hashHex.substring(0, 16)}...`);
        
        // Upload to BOTH Helia AND Pinata for redundancy
        addLog(4, 'info', `📤 Uploading chunk ${i + 1} to Pinata...`);
        
        const base64Chunk = await arrayBufferToBase64(chunkBuffer);
        let pinataCID = '';
        let heliaCID = '';
        
        try {
          // 1. Upload to Pinata (primary)
          const { data: ipfsData, error: ipfsError } = await supabase.functions.invoke('ipfs-upload', {
            body: {
              fileData: base64Chunk,
              encoding: 'base64',
              fileName: `${file.name}.chunk${i}`,
              contentType: 'application/octet-stream',
              metadata: {
                name: `${file.name} - Chunk ${i + 1}/${totalChunks}`,
                chunkIndex: i,
                totalChunks: totalChunks,
                hash: hashHex,
                encrypted: encryptionMetadata.encrypted || false,
                algorithm: encryptionMetadata.algorithm || 'none'
              }
            }
          });
          
          if (ipfsError) throw ipfsError;
          if (!ipfsData || !ipfsData.success) {
            throw new Error(ipfsData?.error || 'Pinata upload failed - no response');
          }
          if (!ipfsData.ipfsHash) {
            throw new Error('Pinata upload failed - no CID returned');
          }
          
          addLog(4, 'success', `✅ Pinata upload successful: ${ipfsData.ipfsHash}`);
          
          // Use original Pinata CID format (Qm...)
          pinataCID = ipfsData.ipfsHash;
          
          addLog(4, 'success', `✅ Block ${i + 1} uploaded - CID: ${pinataCID.substring(0, 20)}...`);
          addLog(4, 'info', `🔗 IPLD block ${i + 1} linked to DAG`);
          
          // 2. Upload to Helia (redundancy)
          addLog(4, 'info', `🌐 Also uploading block ${i + 1} to Helia...`);
          try {
            const heliaStorage = (await import('@/utils/heliaStorage')).heliaStorage;
            await heliaStorage.init();
            
            const chunkFile = new File([chunkArray], `${file.name}.chunk${i}`, {
              type: 'application/octet-stream'
            });
            
            const heliaCidString = await heliaStorage.addFile(chunkFile, {
              metadata: {
                name: `${file.name} - Chunk ${i + 1}/${totalChunks}`,
                chunkIndex: i,
                totalChunks: totalChunks,
                hash: hashHex
              }
            });
            
            // Convert to CIDv1 base32 (bafybei...) for consistency
            try {
              const { CID } = await import('multiformats/cid');
              const { base32 } = await import('multiformats/bases/base32');
              const cidObj = CID.parse(heliaCidString);
              heliaCID = cidObj.toV1().toString(base32);
            } catch (e) {
              // If conversion fails, use the original CID
              heliaCID = heliaCidString;
            }
            
            addLog(4, 'success', `✅ Block ${i + 1} also in Helia: ${heliaCID.substring(0, 20)}...`);
            
            // Deferred on-chain registration to Step 9/11 to prevent wallet popups during chunking
            addLog(4, 'info', '⏭️ Deferred on-chain registration until after deployment/minting');
          } catch (heliaError) {
            console.warn('Helia upload failed, using Pinata only:', heliaError);
            heliaCID = pinataCID; // Fallback to Pinata CID
          }
          
          const ipfsHash = pinataCID; // Primary CID
          
          // Create IPLD block metadata
          const ipldBlockMetadata = {
            blockIndex: i,
            cid: ipfsHash,
            offset: start,
            length: chunkArray.length,
            contentHash: hashHex,
            encrypted: encryptionMetadata.encrypted || false,
            algorithm: encryptionMetadata.algorithm || 'none',
            previous: i > 0 ? ipldBlocks[i - 1].cid : null,
            next: null
          };
          
          // Update previous block's next pointer
          if (i > 0 && ipldBlocks[i - 1]) {
            ipldBlocks[i - 1].next = ipfsHash;
          }
          
          ipldBlocks.push(ipldBlockMetadata);
          addLog(4, 'info', `🔗 IPLD block ${i + 1} linked to DAG`);
          
          chunks.push({
            index: i,
            hash: ipfsHash,
            localHash: hashHex,
            size: chunkArray.length,
            offset: start,
            length: chunkArray.length,
            gatewayUrl: ipfsData.gatewayUrl || `https://gateway.pinata.cloud/ipfs/${ipfsHash}`,
            heliaGatewayUrl: heliaCID ? `https://gateway.helia.io/ipfs/${heliaCID}` : null,
            heliaCID: heliaCID,
            pinataCID: pinataCID,
            encryption: encryptionMetadata,
            ipld: ipldBlockMetadata,
            redundancy: {
              primary: 'pinata',
              backup: heliaCID ? 'helia' : null,
              status: heliaCID ? 'dual-stored' : 'single-stored'
            }
          });
          
          chunkHashes.push(hashHex);
        } catch (uploadError: any) {
          addLog(4, 'error', `❌ Upload failed for chunk ${i + 1}: ${uploadError.message}`);
          throw uploadError;
        }
      }
      
      // Create REAL merkle root from chunk hashes
      addLog(4, 'info', `🌳 Generating Merkle tree from ${chunkHashes.length} chunk hashes...`);
      
      let currentLevel = chunkHashes;
      let levelNumber = 0;
      
      while (currentLevel.length > 1) {
        levelNumber++;
        const nextLevel: string[] = [];
        addLog(4, 'info', `   Level ${levelNumber}: Processing ${currentLevel.length} hashes...`);
        
        for (let i = 0; i < currentLevel.length; i += 2) {
          const left = currentLevel[i];
          const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : currentLevel[i];
          const combined = left + right;
          const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(combined));
          const hashArray = Array.from(new Uint8Array(hashBuffer));
          const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
          nextLevel.push(hashHex);
        }
        
        currentLevel = nextLevel;
      }
      
      const merkleRoot = currentLevel[0];
      addLog(4, 'success', `✅ Merkle root generated!`);
      addLog(4, 'info', `🌳 Full Merkle Root:`);
      addLog(4, 'info', `   ${merkleRoot}`);
      
      // Upload Merkle tree structure to both Helia and Pinata
      addLog(4, 'info', '🌳 Uploading Merkle tree proof to Helia + Pinata...');
      
      // Build comprehensive reassembly script
      const reassemblyScript = `/**
 * Reassembly Script for: ${file.name}
 * Generated: ${new Date().toISOString()}
 * Chunks: ${chunks.length}
 * Encrypted: ${encryptionConfig.enableChunkEncryption}
 * Storage: Dual (Pinata IPFS + Helia P2P)
 * 
 * Usage:
 * const reassembler = new ChunkReassembler(metadata);
 * const file = await reassembler.downloadAndReassemble();
 */

class ChunkReassembler {
  constructor(metadata) {
    this.metadata = metadata;
    this.chunks = metadata.merkleTree.reassembly.chunkCIDs || [];
    this.heliaBackup = metadata.merkleTree.reassembly.heliaCIDs || [];
    this.encrypted = metadata.merkleTree.encryption.enabled;
    this.merkleRoot = metadata.merkleTree.root;
    this.totalChunks = metadata.merkleTree.totalChunks;
    this.chunkHashes = metadata.merkleTree.reassembly.chunkHashes || [];
  }
  
  getGateways() {
    return [
      'https://gateway.pinata.cloud/ipfs/',
      'https://ipfs.io/ipfs/',
      'https://cloudflare-ipfs.com/ipfs/',
      'https://dweb.link/ipfs/'
    ];
  }
  
  async downloadChunk(cid, index) {
    const gateways = this.getGateways();
    for (const gateway of gateways) {
      try {
        const response = await fetch(\`\${gateway}\${cid}\`);
        if (response.ok) {
          return new Uint8Array(await response.arrayBuffer());
        }
      } catch (error) {
        continue;
      }
    }
    if (this.heliaBackup[index]) {
      for (const gateway of gateways) {
        try {
          const response = await fetch(\`\${gateway}\${this.heliaBackup[index]}\`);
          if (response.ok) {
            return new Uint8Array(await response.arrayBuffer());
          }
        } catch (error) {
          continue;
        }
      }
    }
    throw new Error(\`Failed to download chunk \${index}\`);
  }
  
  async verifyChunk(chunkData, index) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', chunkData);
    const hashHex = Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    if (this.chunkHashes[index] && hashHex !== this.chunkHashes[index]) {
      throw new Error(\`Chunk \${index} integrity check failed\`);
    }
    return true;
  }
  
  async downloadAndReassemble(onProgress) {
    const chunks = [];
    for (let i = 0; i < this.chunks.length; i++) {
      onProgress?.({ current: i + 1, total: this.totalChunks, percent: Math.floor((i / this.totalChunks) * 100) });
      const chunkData = await this.downloadChunk(this.chunks[i], i);
      await this.verifyChunk(chunkData, i);
      chunks.push(chunkData);
    }
    const totalSize = chunks.reduce((sum, c) => sum + c.byteLength, 0);
    const reassembled = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of chunks) {
      reassembled.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new Blob([reassembled], { type: 'application/octet-stream' });
  }
}`;
      
      // Generate AI-powered custom reassembly script
      addLog(4, 'info', '🤖 Generating AI-powered reassembly script...');
      
      const { generateReassemblyScript } = await import('@/services/reassemblyScriptGenerator');
      
      const reassemblyData = await generateReassemblyScript({
        assetName: file.name,
        assetType: nftData.modelType || 'Unknown',
        fileType: file.name.split('.').pop() || 'bin',
        totalChunks: chunks.length,
        chunkSize: chunks[0]?.size || 0,
        chunkCIDs: chunks.map(c => c.pinataCID),
        heliaCIDs: chunks.map(c => c.heliaCID || ''),
        chunkHashes: chunks.map(c => c.localHash),
        merkleRoot: merkleRoot,
        encrypted: encryptionConfig.enableChunkEncryption,
        encryptionMethod: encryptionConfig.enableChunkEncryption ? 'AES-256-GCM' : undefined,
      });
      
      addLog(4, 'success', '✅ AI reassembly script generated');
      addLog(4, 'info', `📋 Instructions: ${reassemblyData.instructions.length} steps`);
      addLog(4, 'info', `⏱️ Estimated time: ${reassemblyData.estimatedTime}`);

      const merkleTreeProof = {
        version: '1.0',
        fileName: file.name,
        fileSize: file.size,
        chunkSize: chunks[0]?.size || 0,
        totalChunks: chunks.length,
        merkleRoot: merkleRoot,
        encryption: {
          enabled: encryptionConfig.enableChunkEncryption,
          algorithm: encryptionConfig.enableChunkEncryption ? 'AES-GCM-256' : 'none',
          keyDerivation: encryptionConfig.keySource
        },
        reassembly: {
          script: reassemblyData.script,
          chunkCIDs: chunks.map(c => c.pinataCID),
          heliaCIDs: chunks.map(c => c.heliaCID),
          chunkHashes: chunks.map(c => c.localHash),
          instructions: reassemblyData.instructions,
          requirements: reassemblyData.requirements,
          estimatedTime: reassemblyData.estimatedTime,
          gateways: [
            'https://gateway.pinata.cloud/ipfs/',
            'https://ipfs.io/ipfs/',
            'https://cloudflare-ipfs.com/ipfs/',
            'https://dweb.link/ipfs/'
          ]
        },
        blocks: chunks.map((chunk, idx) => ({
          blockIndex: idx,
          cid: chunk.hash,
          heliaCID: chunk.heliaCID,
          pinataCID: chunk.pinataCID,
          offset: chunk.offset,
          length: chunk.size,
          contentHash: chunk.localHash,
          encrypted: encryptionConfig.enableChunkEncryption,
          algorithm: encryptionConfig.enableChunkEncryption ? 'AES-GCM-256' : 'none',
          gatewayUrl: chunk.gatewayUrl,
          heliaGatewayUrl: chunk.heliaGatewayUrl,
          previous: idx > 0 ? chunks[idx - 1].hash : null,
          next: idx < chunks.length - 1 ? chunks[idx + 1].hash : null
        })),
        created: new Date().toISOString(),
        createdBy: walletAddress || 'unknown'
      };
      
      let merkleTreeCID: string | null = null;
      let merkleHeliaRCID: string | null = null;
      
      try {
        // Upload to Pinata
        const { data: merkleData, error: merkleError } = await supabase.functions.invoke('ipfs-upload', {
          body: {
            fileData: JSON.stringify(merkleTreeProof, null, 2),
            fileName: `${file.name}.merkle-tree.json`,
            contentType: 'application/json',
            metadata: {
              name: `Merkle Tree - ${file.name}`,
              type: 'merkle-tree-proof',
              root: merkleRoot,
              leaves: chunkHashes.length
            }
          }
        });
        
        if (merkleError) throw merkleError;
        if (!merkleData || !merkleData.success) {
          throw new Error(merkleData?.error || 'Merkle tree upload to Pinata failed - no response');
        }
        if (!merkleData.ipfsHash) {
          throw new Error('Merkle tree upload to Pinata failed - no CID returned');
        }
        
        addLog(4, 'success', `✅ Merkle tree uploaded to Pinata: ${merkleData.ipfsHash}`);
        
        // Use original Pinata CID format (Qm...)
        merkleTreeCID = merkleData.ipfsHash;
        
        addLog(4, 'success', `✅ Merkle tree on Pinata: ${merkleTreeCID}`);
        
        // Upload to Helia
        try {
          const heliaStorage = (await import('@/utils/heliaStorage')).heliaStorage;
          await heliaStorage.init();
          const heliaMerkleCID = await heliaStorage.addJSON(merkleTreeProof, {
            name: `${file.name}.merkle-tree.json`
          });
          
          // Normalize to CIDv1 base32
          try {
            const { CID } = await import('multiformats/cid');
            const { base32 } = await import('multiformats/bases/base32');
            const heliaMerkleCidObj = CID.parse(heliaMerkleCID);
            merkleHeliaRCID = heliaMerkleCidObj.toV1().toString(base32);
          } catch (e) {
            merkleHeliaRCID = heliaMerkleCID;
          }
          
          addLog(4, 'success', `✅ Merkle tree on Helia: ${merkleHeliaRCID}`);
        } catch (heliaError) {
          console.warn('Helia merkle upload failed:', heliaError);
        }
        
        addLog(4, 'info', `🔗 Pinata Gateway: ${merkleData.gatewayUrl}`);
        if (merkleHeliaRCID) {
          addLog(4, 'info', `🌐 Helia Gateway: https://ipfs.io/ipfs/${merkleHeliaRCID}`);
        }
      } catch (merkleUploadError: any) {
        addLog(4, 'warning', `⚠️ Merkle tree upload failed: ${merkleUploadError.message}`);
      }
      
      // Create IPLD manifest
      const ipldManifest = {
        version: '1.0',
        fileName: file.name,
        fileSize: file.size,
        chunkSize: chunkSize,
        totalChunks: chunks.length,
        merkleRoot: merkleRoot,
        blocks: ipldBlocks,
        encryption: {
          enabled: encryptionConfig.enableChunkEncryption,
          algorithm: 'AES-GCM-256',
          keyDerivation: encryptionConfig.keySource
        },
        created: new Date().toISOString()
      };
      
      addLog(4, 'info', '📝 Uploading IPLD manifest to Helia + Pinata...');
      
      let manifestCID = '';
      let manifestHeliaCID = '';
      
      try {
        // Upload to Pinata
        const { data: manifestData, error: manifestError } = await supabase.functions.invoke('ipfs-upload', {
          body: {
            fileData: JSON.stringify(ipldManifest, null, 2),
            fileName: `${file.name}.manifest.json`,
            contentType: 'application/json',
            metadata: {
              name: `IPLD Manifest - ${file.name}`,
              type: 'ipld-manifest'
            }
          }
        });
        
        if (manifestError) throw manifestError;
        if (!manifestData || !manifestData.success) {
          throw new Error(manifestData?.error || 'Manifest upload to Pinata failed - no response');
        }
        if (!manifestData.ipfsHash) {
          throw new Error('Manifest upload to Pinata failed - no CID returned');
        }
        
        addLog(4, 'success', `✅ Manifest uploaded to Pinata: ${manifestData.ipfsHash}`);
        
        // Use original Pinata CID format (Qm...)
        manifestCID = manifestData.ipfsHash;
        
        addLog(4, 'success', `✅ IPLD manifest on Pinata: ${manifestCID}`);
        
        // Upload to Helia
        try {
          const heliaStorage = (await import('@/utils/heliaStorage')).heliaStorage;
          await heliaStorage.init();
          const heliaManifestCID = await heliaStorage.addJSON(ipldManifest, {
            name: `${file.name}.manifest.json`
          });
          
          // Normalize to CIDv1 base32
          try {
            const { CID } = await import('multiformats/cid');
            const { base32 } = await import('multiformats/bases/base32');
            const heliaManifestCidObj = CID.parse(heliaManifestCID);
            manifestHeliaCID = heliaManifestCidObj.toV1().toString(base32);
          } catch (e) {
            manifestHeliaCID = heliaManifestCID;
          }
          
          addLog(4, 'success', `✅ IPLD manifest on Helia: ${manifestHeliaCID}`);
            
            // Deferred pinning to finalization to prevent wallet prompts during chunking
            addLog(4, 'info', '⏭️ Deferred Helia pinning until final minting');
            addLog(4, 'info', `🔗 Pinata Manifest: ${manifestCID}`);
            addLog(4, 'info', `🌐 Helia Manifest: ${manifestHeliaCID || 'N/A'}`);
        } catch (heliaError) {
          console.warn('Helia manifest upload failed:', heliaError);
        }
        
        setChunkData({
          chunks,
          merkleRoot,
          merkleTreeCID,
          merkleHeliaRCID,
          totalChunks: chunks.length,
          chunkHashes: chunks.map(c => c.localHash),
          reassemblyScript: reassemblyScript,
          ipldManifestCID: manifestCID,
          ipldManifestHeliaCID: manifestHeliaCID,
          ipldBlocks,
          redundancy: {
            enabled: true,
            pinataCIDs: chunks.length,
            heliaCIDs: chunks.filter(c => c.heliaCID && c.heliaCID !== c.pinataCID).length
          }
        });
        
        addLog(4, 'success', '✅ AI Smart Chunking Complete!');
        addLog(4, 'info', `📊 Summary:`);
        addLog(4, 'info', `   • ${chunks.length} IPLD blocks created`);
        addLog(4, 'info', `   • Merkle root: ${merkleRoot.substring(0, 20)}...`);
        if (merkleTreeCID) {
          addLog(4, 'info', `   • Merkle tree CID: ${merkleTreeCID}`);
        }
        addLog(4, 'info', `   • Manifest CID: ${manifestCID}`);
        addLog(4, 'info', `   • Encryption: ${encryptionConfig.enableChunkEncryption ? 'Enabled' : 'Disabled'}`);
        
        // ============================================================
        // ANTI-SPAM: Require wallet signature on manifest
        // ============================================================
        addLog(4, 'info', '🔏 Requesting wallet signature for asset manifest (anti-spam)...');
        
        const signatureResult = await signManifest({
          manifestCID: manifestCID,
          merkleRoot: merkleRoot,
          fileName: file.name,
          fileSize: file.size,
          chunkCount: chunks.length,
          modelName: nftData.name || file.name,
          modelType: nftData.modelType || 'unknown',
          encryptionEnabled: encryptionConfig.enableChunkEncryption
        }, {
          showToast: true,
          onProgress: (msg) => addLog(4, 'info', msg)
        });

        if (!signatureResult) {
          addLog(4, 'error', '❌ Manifest signature required - asset creation cancelled');
          toast({ 
            title: 'Signature Required', 
            description: 'You must sign the manifest to continue. This prevents spam on the marketplace.', 
            variant: 'destructive' 
          });
          setProcessing(false);
          return;
        }

        // Store signature for later use
        setManifestSignature(signatureResult);
        addLog(4, 'success', `✅ Manifest signed! Signature: ${signatureResult.signatureHash.substring(0, 18)}...`);
        
        markStepComplete(4);
        toast({ title: 'Success', description: 'Chunking completed and manifest signed!' });
      } catch (manifestError: any) {
        addLog(4, 'error', `❌ Manifest upload failed: ${manifestError.message}`);
        throw manifestError;
      }
      
    } catch (error: any) {
      console.error('Chunking error:', error);
      addLog(4, 'error', `❌ Error: ${error.message}`);
      toast({ title: 'Error', description: 'Chunking failed', variant: 'destructive' });
    } finally {
      setProcessing(false);
    }
  };

  // Step 8: Quality Score (checks full build quality after all config steps)
  const generateQualityScore = async () => {
    setProcessing(true);
    setLogs(prev => ({ ...prev, 8: [] }));

    try {
      addLog(8, 'info', `🔍 Running ${qualityConfig.assessmentType} analysis with DeepSeek AI...`);
      
      // Prepare asset information for DeepSeek analysis
      const assetInfo = `
Asset Information:
- Name: ${nftData.name || modelData.file?.name || 'Unknown'}
- Type: ${nftData.modelType || 'AI Model'}
- Description: ${nftData.description || 'No description provided'}
- File Size: ${modelData.file ? (modelData.file.size / (1024 * 1024)).toFixed(2) + ' MB' : 'Unknown'}
- Encryption: ${encryptionConfig.encryptionLevel !== 'none' ? 'Enabled (' + encryptionConfig.encryptionLevel + ')' : 'Disabled'}
- Chunks: ${chunkData.totalChunks || 'Not chunked yet'}
- Assessment Type: ${qualityConfig.assessmentType}

Please analyze this AI asset and provide a comprehensive quality assessment including:
1. Overall quality score (0-100)
2. Individual dimension scores (accuracy, performance, reliability, usability, documentation)
3. Key strengths and weaknesses
4. Recommendations for improvement
      `.trim();

      // Call DeepSeek API for quality assessment
      const { data: deepseekData, error: deepseekError } = await supabase.functions.invoke('deepseek-analyze', {
        body: { 
          prompt: assetInfo, 
          taskType: 'quality_score',
          context: {
            assetName: nftData.name || modelData.file?.name,
            assetType: nftData.modelType,
            fileSize: modelData.file?.size,
            encryptionEnabled: encryptionConfig.encryptionLevel !== 'none'
          }
        }
      });

      if (deepseekError || !deepseekData?.result) {
        throw new Error(deepseekError?.message || 'Failed to get quality assessment from DeepSeek');
      }

      const aiAssessment = typeof deepseekData.result === 'string' ? JSON.parse(deepseekData.result) : deepseekData.result;
      
      // Map DeepSeek response to our quality metrics format
      const qualityMetrics = {
        overall: aiAssessment.overallScore || 85,
        accuracy: aiAssessment.dimensions?.accuracy || 85,
        efficiency: aiAssessment.dimensions?.performance || 80,
        reliability: aiAssessment.dimensions?.reliability || 90,
        security: encryptionConfig.encryptionLevel !== 'none' ? 95 : 70,
        usability: aiAssessment.dimensions?.usability || 80,
        documentation: aiAssessment.dimensions?.documentation || 75
      };

      addLog(8, 'success', `✅ Quality Score: ${qualityMetrics.overall}/100`);
      addLog(8, 'info', `• Accuracy: ${qualityMetrics.accuracy}%`);
      addLog(8, 'info', `• Performance: ${qualityMetrics.efficiency}%`);
      addLog(8, 'info', `• Reliability: ${qualityMetrics.reliability}%`);
      addLog(8, 'info', `• Security: ${qualityMetrics.security}%`);
      addLog(8, 'info', `• Usability: ${qualityMetrics.usability}%`);
      
      if (aiAssessment.strengths?.length > 0) {
        addLog(8, 'success', `💪 Strengths: ${aiAssessment.strengths.join(', ')}`);
      }
      
      if (aiAssessment.recommendations?.length > 0) {
        addLog(8, 'info', `💡 Recommendations: ${aiAssessment.recommendations.slice(0, 2).join(', ')}`);
      }

      // Create IPLD schema for quality data
      if (qualityConfig.enableIPLDSchema) {
        addLog(8, 'info', '🌐 Generating IPLD schema for quality metadata...');
        await sleep(300);
        
        const ipldQualitySchema = {
          $schema: "https://ipld.io/schemas/",
          type: "struct",
          name: "AIQualityScore",
          fields: {
            version: { type: "string" },
            modelCID: { type: "link" },
            qualityMetrics: {
              type: "struct",
              fields: {
                overall: { type: "int" },
                accuracy: { type: "int" },
                efficiency: { type: "int" },
                reliability: { type: "int" },
                security: { type: "int" }
              }
            },
            assessmentType: { type: "string" },
            timestamp: { type: "int" },
            validator: { type: "string" }
          }
        };
        
        const qualityData = {
          version: "1.0",
          modelCID: chunkData.merkleRoot,
          qualityMetrics: qualityMetrics,
          assessmentType: qualityConfig.assessmentType,
          timestamp: Math.floor(Date.now() / 1000),
          validator: pricingData.creatorWallet
        };
        
        try {
          const { data: qualityUpload, error: qualityError } = await supabase.functions.invoke('ipfs-upload', {
            body: {
              fileData: JSON.stringify({ schema: ipldQualitySchema, data: qualityData }, null, 2),
              fileName: `${modelData.file.name}.quality.json`,
              contentType: 'application/json',
              metadata: {
                name: `Quality Score - ${modelData.file.name}`,
                type: 'ipld-quality'
              }
            }
          });
          
          if (!qualityError && qualityUpload?.ipfsHash) {
            setNftData((prev: any) => ({ ...prev, qualityScoreCID: qualityUpload.ipfsHash }));
            addLog(9, 'success', `✅ Quality data uploaded: ${qualityUpload.ipfsHash}`);
          }
        } catch (err) {
          console.warn('Quality upload error:', err);
        }
      }

      // Store comprehensive quality data
      setNftData((prev: any) => ({ 
        ...prev, 
        qualityScore: qualityMetrics.overall, 
        qualityMetrics,
        qualityAssessment: {
          strengths: aiAssessment.strengths || [],
          weaknesses: aiAssessment.weaknesses || [],
          recommendations: aiAssessment.recommendations || []
        }
      }));
      markStepComplete(9);
      toast({ title: 'Success', description: `Quality Score: ${qualityMetrics.overall}/100 - AI Assessment Complete` });
    } catch (error: any) {
      addLog(9, 'error', `❌ Error: ${error.message}`);
    } finally {
      setProcessing(false);
    }
  };

  // Export Quality Assessment Report
  const exportQualityReportAsJSON = () => {
    if (!nftData.qualityScore) {
      toast({ title: 'Error', description: 'No quality assessment to export', variant: 'destructive' });
      return;
    }

    const report = {
      assetName: nftData.name || modelData.file?.name || 'Unknown Asset',
      assetType: nftData.modelType || 'AI Model',
      exportDate: new Date().toISOString(),
      assessmentType: qualityConfig.assessmentType,
      overallScore: nftData.qualityScore,
      metrics: nftData.qualityMetrics,
      assessment: {
        strengths: nftData.qualityAssessment?.strengths || [],
        weaknesses: nftData.qualityAssessment?.weaknesses || [],
        recommendations: nftData.qualityAssessment?.recommendations || []
      },
      metadata: {
        fileSize: modelData.file ? (modelData.file.size / (1024 * 1024)).toFixed(2) + ' MB' : 'Unknown',
        encryption: encryptionConfig.encryptionLevel,
        chunks: chunkData.totalChunks || 0
      }
    };

    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `quality-assessment-${nftData.name || 'asset'}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast({ title: 'Success', description: 'Quality report exported as JSON' });
  };

  const exportQualityReportAsPDF = () => {
    if (!nftData.qualityScore) {
      toast({ title: 'Error', description: 'No quality assessment to export', variant: 'destructive' });
      return;
    }

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    let y = 20;

    // Title
    doc.setFontSize(20);
    doc.setTextColor(0, 0, 0);
    doc.text('Quality Assessment Report', pageWidth / 2, y, { align: 'center' });
    y += 15;

    // Asset Info
    doc.setFontSize(12);
    doc.setTextColor(100, 100, 100);
    doc.text(`Asset: ${nftData.name || modelData.file?.name || 'Unknown'}`, 20, y);
    y += 7;
    doc.text(`Type: ${nftData.modelType || 'AI Model'}`, 20, y);
    y += 7;
    doc.text(`Date: ${new Date().toLocaleDateString()}`, 20, y);
    y += 15;

    // Overall Score
    doc.setFontSize(16);
    doc.setTextColor(0, 0, 0);
    doc.text('Overall Quality Score', 20, y);
    y += 10;
    doc.setFontSize(32);
    doc.setTextColor(63, 131, 248); // primary color
    doc.text(`${nftData.qualityScore}/100`, 20, y);
    y += 15;

    // Metrics
    if (nftData.qualityMetrics) {
      doc.setFontSize(14);
      doc.setTextColor(0, 0, 0);
      doc.text('Quality Dimensions', 20, y);
      y += 10;

      doc.setFontSize(11);
      Object.entries(nftData.qualityMetrics).forEach(([key, value]: [string, any]) => {
        if (key !== 'overall') {
          const capitalizedKey = key.charAt(0).toUpperCase() + key.slice(1);
          doc.text(`${capitalizedKey}: ${value}%`, 25, y);
          y += 6;
        }
      });
      y += 10;
    }

    // Strengths
    if (nftData.qualityAssessment?.strengths?.length > 0) {
      doc.setFontSize(14);
      doc.setTextColor(0, 150, 0);
      doc.text('Strengths', 20, y);
      y += 8;
      doc.setFontSize(10);
      doc.setTextColor(0, 0, 0);
      nftData.qualityAssessment.strengths.forEach((strength: string, i: number) => {
        const lines = doc.splitTextToSize(`• ${strength}`, pageWidth - 40);
        lines.forEach((line: string) => {
          if (y > 270) {
            doc.addPage();
            y = 20;
          }
          doc.text(line, 25, y);
          y += 5;
        });
      });
      y += 5;
    }

    // Weaknesses
    if (nftData.qualityAssessment?.weaknesses?.length > 0) {
      if (y > 250) {
        doc.addPage();
        y = 20;
      }
      doc.setFontSize(14);
      doc.setTextColor(200, 150, 0);
      doc.text('Areas for Improvement', 20, y);
      y += 8;
      doc.setFontSize(10);
      doc.setTextColor(0, 0, 0);
      nftData.qualityAssessment.weaknesses.forEach((weakness: string) => {
        const lines = doc.splitTextToSize(`• ${weakness}`, pageWidth - 40);
        lines.forEach((line: string) => {
          if (y > 270) {
            doc.addPage();
            y = 20;
          }
          doc.text(line, 25, y);
          y += 5;
        });
      });
      y += 5;
    }

    // Recommendations
    if (nftData.qualityAssessment?.recommendations?.length > 0) {
      if (y > 250) {
        doc.addPage();
        y = 20;
      }
      doc.setFontSize(14);
      doc.setTextColor(0, 100, 200);
      doc.text('AI Recommendations', 20, y);
      y += 8;
      doc.setFontSize(10);
      doc.setTextColor(0, 0, 0);
      nftData.qualityAssessment.recommendations.forEach((rec: string, i: number) => {
        const lines = doc.splitTextToSize(`${i + 1}. ${rec}`, pageWidth - 40);
        lines.forEach((line: string) => {
          if (y > 270) {
            doc.addPage();
            y = 20;
          }
          doc.text(line, 25, y);
          y += 5;
        });
      });
    }

    // Footer
    const totalPages = doc.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.text(
        `Generated by Joy AI Marketplace - Page ${i} of ${totalPages}`,
        pageWidth / 2,
        doc.internal.pageSize.getHeight() - 10,
        { align: 'center' }
      );
    }

    doc.save(`quality-assessment-${nftData.name || 'asset'}-${Date.now()}.pdf`);
    toast({ title: 'Success', description: 'Quality report exported as PDF' });
  };

  // Step 5: Proof-of-Inference with REAL ZK proofs
  const generateProofOfInference = async () => {
    setProcessing(true);
    setLogs(prev => ({ ...prev, 5: [] }));

    try {
      addLog(5, 'info', '🔐 Generating ZK Proof-of-Inference...');
      addLog(5, 'info', '📊 Creating cryptographic proof...');
      await sleep(500);

      const modelHash = nftData.assetCID || 'model-hash-placeholder';
      // Reduce payload size by only sending essential data
      const testInput = JSON.stringify({
        name: nftData.name,
        category: nftData.category,
        modelType: nftData.modelType,
        hash: modelHash
      });

      // Step 1: Generate ZK Proof with retry logic
      addLog(5, 'info', '📡 Calling generate-zk-proof function...');
      console.log('Invoking generate-zk-proof with:', { modelHash, testInputLength: testInput.length });
      
      let proofResult, proofGenError;
      let retries = 3;
      
      while (retries > 0) {
        try {
          const response = await Promise.race([
            callEdgeFunction('generate-zk-proof', {
              modelHash,
              testInput,
              proofType: 'zk-snark'
            }),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Function call timeout after 30s')), 30000)
            )
          ]) as any;
          
          proofResult = response.data;
          proofGenError = response.error;
          break;
        } catch (err: any) {
          retries--;
          if (retries === 0) {
            proofGenError = err;
          } else {
            addLog(5, 'info', `⚠️ Retry attempt ${4 - retries}/3...`);
            await sleep(1000);
          }
        }
      }

      console.log('ZK proof response:', { proofResult, proofGenError });

      if (proofGenError) {
        console.error('ZK proof generation error:', proofGenError);
        throw new Error(`Failed to generate ZK proof: ${proofGenError.message || JSON.stringify(proofGenError)}`);
      }
      
      if (!proofResult?.success) {
        console.error('ZK proof result error:', proofResult);
        throw new Error(proofResult?.error || 'Proof generation failed');
      }

      const { proof, proofHash, inputHash, outputHash } = proofResult;
      
      addLog(5, 'success', '✅ ZK proof generated successfully');
      addLog(5, 'info', `🔑 Proof Hash: ${proofHash.substring(0, 20)}...`);
      addLog(5, 'info', `📥 Input Hash: ${inputHash.substring(0, 20)}...`);
      addLog(5, 'info', `📤 Output Hash: ${outputHash.substring(0, 20)}...`);

      // Step 2: Verify and Pin to IPFS via Pinata
      addLog(5, 'info', '🔍 Verifying proof and pinning to IPFS...');
      await sleep(500);

      const { data: verifyResult, error: verifyError } = await callEdgeFunction('verify-zk-proof', {
        proof,
        metadata: {
          assetName: nftData.name,
          modelType: nftData.modelType,
          createdAt: new Date().toISOString()
        }
      });

      if (verifyError) throw new Error(verifyError.message || 'Failed to verify proof');
      if (!verifyResult?.success) throw new Error(verifyResult?.error || 'Proof verification failed');

      const { verification } = verifyResult;
      
      addLog(5, 'success', '✅ Proof verified successfully');
      addLog(5, 'success', `✅ Pinned to IPFS: ${verification.ipfsCid}`);
      addLog(5, 'info', `🌐 IPFS URL: ${verification.ipfsUrl}`);
      addLog(5, 'info', `🔗 Pinata Gateway: ${verification.pinataUrl}`);

      // Update NFT data with proof and verification info
      setNftData((prev: any) => ({ 
        ...prev, 
        proofHash,
        zkProof: proof,
        proofVerification: {
          verified: true,
          verifiedAt: verification.verifiedAt,
          ipfsCid: verification.ipfsCid,
          ipfsUrl: verification.ipfsUrl,
          pinataUrl: verification.pinataUrl
        }
      }));

      markStepComplete(5);
      toast({ title: 'Success', description: 'ZK Proof-of-Inference verified and stored on IPFS!' });
    } catch (error: any) {
      addLog(5, 'error', `❌ Error: ${error.message}`);
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setProcessing(false);
    }
  };

  // Step 7: License Generation (now includes pricing data from Step 6)
  const generateLicense = async () => {
    setProcessing(true);
    setLogs(prev => ({ ...prev, 7: [] }));

    try {
      addLog(7, 'info', '🤖 Generating AI-powered license terms...');
      addLog(7, 'info', `📋 License Type: ${licenseData.licenseType}`);
      await sleep(500);

      // Call the dedicated license generation edge function
      const { data: licenseResult, error: licenseError } = await supabase.functions.invoke('generate-license-terms', {
        body: {
          licenseType: licenseData.licenseType,
          assetType: nftData.modelType || 'model',
          assetName: nftData.name,
          publisher: pricingData.creatorWallet || 'Creator',
          allowCommercial: licenseData.allowCommercial,
          allowModification: licenseData.allowModification,
          allowRedistribution: licenseData.allowRedistribution,
          requireAttribution: licenseData.requireAttribution,
          royaltyPercentage: pricingData.royaltyPercent,
          revenueShareModel: licenseData.revenueShareModel,
          customTerms: licenseData.customTerms
        }
      });

      if (licenseError) {
        console.error('License error:', licenseError);
        addLog(7, 'error', `❌ Edge function error: ${licenseError.message}`);
        throw new Error(licenseError.message || 'License generation failed');
      }

      if (!licenseResult?.success) {
        console.error('License result:', licenseResult);
        addLog(7, 'error', `❌ Generation failed: ${licenseResult?.error || 'Unknown error'}`);
        throw new Error(licenseResult?.error || 'License generation returned unsuccessful result');
      }

      const { licenseCid, licenseTerms, gatewayUrl } = licenseResult;
      
      addLog(7, 'success', '✅ License terms generated by DeepSeek AI');
      addLog(7, 'info', `📝 Summary: ${licenseTerms.summary}`);
      addLog(7, 'info', `🎯 TL;DR: ${licenseTerms.human.tldr}`);
      addLog(7, 'success', `✅ License uploaded to IPFS: ${licenseCid}`);
      addLog(7, 'info', `🌐 Gateway: ${gatewayUrl}`);
      
      // Display permissions
      addLog(7, 'info', '✨ Permissions:');
      addLog(7, 'info', `   • Commercial Use: ${licenseTerms.permissions.commercial ? '✓' : '✗'}`);
      addLog(7, 'info', `   • Modifications: ${licenseTerms.permissions.modification ? '✓' : '✗'}`);
      addLog(7, 'info', `   • Distribution: ${licenseTerms.permissions.distribution ? '✓' : '✗'}`);
      
      if (licenseTerms.royalty) {
        addLog(7, 'info', `💰 Royalty: ${licenseTerms.royalty.percentage}% (${licenseTerms.royalty.model})`);
      }

      setLicenseData((prev: any) => ({ 
        ...prev, 
        cid: licenseCid,
        terms: licenseTerms,
        gatewayUrl
      }));

      markStepComplete(7);
      toast({ title: 'Success', description: 'License generated with AI!' });
    } catch (error: any) {
      addLog(7, 'error', `❌ Error: ${error.message}`);
      toast({ title: 'Error', description: 'License generation failed', variant: 'destructive' });
    } finally {
      setProcessing(false);
    }
  };

  // Step 6: Save Pricing
  const savePricing = () => {
    if (!pricingData.creatorWallet) {
      toast({ title: 'Error', description: 'Creator wallet address is required', variant: 'destructive' });
      return;
    }
    
    setLogs(prev => ({ ...prev, 6: [] }));
    addLog(6, 'success', '✅ Pricing configured');
    addLog(6, 'info', `💰 Initial Price: ${pricingData.initialPrice} MATIC`);
    addLog(6, 'info', `📊 Royalty: ${pricingData.royaltyPercent}%`);
    addLog(6, 'info', `👛 Creator Wallet: ${pricingData.creatorWallet.slice(0, 6)}...${pricingData.creatorWallet.slice(-4)}`);
    addLog(6, 'success', '✅ Ready for license generation');
    
    markStepComplete(6);
    toast({ title: 'Success', description: 'Pricing configured!' });
  };

  // Step 9: Generate Contract Based on Type Selection
  const generateAssetContract = async () => {
    setProcessing(true);
    setLogs(prev => ({ ...prev, 9: [] }));
    
    try {
      const contractType = contractData.deploymentType;
      
      if (contractType === 'ai-custom') {
        // AI-Generated Custom Contract
        addLog(9, 'info', '🤖 Generating AI-powered custom smart contract...');
        addLog(9, 'info', '📋 Contract will include all asset data and requirements');
        await sleep(500);

        const contractRequirements = {
          userRequest: `ERC-721 NFT contract named "${contractData.contractName}" (${contractData.contractSymbol}) for AI asset: ${nftData.name}.
Include: Merkle root verification (${chunkData.merkleRoot}), IPLD manifest (${chunkData.ipldManifestCID}), License CID (${licenseData.cid}), ${chunkData.totalChunks} chunks.
Royalty: ${pricingData.royaltyPercent}%, Creator: ${pricingData.creatorWallet}.
License type: ${licenseData.licenseType}, Commercial: ${licenseData.allowCommercial}, Modifications: ${licenseData.allowModification}.`,
          contractType: 'ERC721',
          assetName: nftData.name,
          features: ['minting', 'royalties', 'access-control', 'merkle-verification', 'metadata']
        };

        addLog(9, 'info', '⚡ Calling AI contract generator...');
        const { data: contractResult, error: contractError } = await supabase.functions.invoke('generate-smart-contract', {
          body: contractRequirements
        });

        if (contractError || !contractResult?.success) {
          throw new Error(contractResult?.error || contractError?.message || 'AI generation failed');
        }

        let contractCode = contractResult.contractCode.trim();
        contractCode = contractCode.replace(/```solidity\n?/g, '').replace(/```\n?/g, '').trim();

        addLog(9, 'success', '✅ AI contract generated successfully');
        addLog(9, 'info', `📝 Contract size: ${contractCode.length} characters`);
        
        setContractData((prev: any) => ({
          ...prev,
          code: contractCode
        }));
      } else {
        // Standard, Upgradable, or Fractional Contract Templates
        addLog(9, 'info', `🔧 Generating ${contractType} contract template...`);
        await sleep(300);

        let contractTemplate = '';
        
        if (contractType === 'standard') {
          contractTemplate = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

/**
 * @title ${contractData.contractName}
 * @notice ERC-721 NFT with ERC-2981 royalty standard for AI assets
 * @dev Includes Merkle verification, IPLD manifest, and automated royalty distribution
 */
contract ${contractData.contractName} is ERC721, ERC721URIStorage, ERC2981, Ownable {
    using Counters for Counters.Counter;
    Counters.Counter private _tokenIds;
    
    // Asset verification data
    string public merkleRoot = "${chunkData.merkleRoot}";
    string public ipldManifest = "${chunkData.ipldManifestCID}";
    string public licenseCID = "${licenseData.cid}";
    
    // Royalty configuration (ERC-2981)
    uint96 public constant MAX_ROYALTY_FEE = 1000; // 10%
    address public royaltyReceiver;
    uint96 public royaltyFeeBps; // Basis points (e.g., 500 = 5%)
    
    constructor() ERC721("${contractData.contractName}", "${contractData.contractSymbol}") {
        royaltyReceiver = msg.sender;
        royaltyFeeBps = ${Math.min(pricingData.royaltyPercent * 100, 1000)}; // Convert % to basis points, max 10%
        _setDefaultRoyalty(royaltyReceiver, royaltyFeeBps);
    }
    
    /**
     * @notice Mint new NFT with metadata URI
     * @param to Recipient address
     * @param tokenURI Metadata URI for the token
     * @return tokenId The minted token ID
     */
    function mint(address to, string memory tokenURI) public onlyOwner returns (uint256) {
        _tokenIds.increment();
        uint256 tokenId = _tokenIds.current();
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, tokenURI);
        return tokenId;
    }
    
    /**
     * @notice Update default royalty configuration (ERC-2981)
     * @param receiver New royalty receiver address
     * @param feeBps New royalty fee in basis points (max 1000 = 10%)
     */
    function setDefaultRoyalty(address receiver, uint96 feeBps) external onlyOwner {
        require(feeBps <= MAX_ROYALTY_FEE, "Royalty fee exceeds maximum");
        royaltyReceiver = receiver;
        royaltyFeeBps = feeBps;
        _setDefaultRoyalty(receiver, feeBps);
    }
    
    /**
     * @notice Set token-specific royalty (ERC-2981)
     * @param tokenId Token ID to set royalty for
     * @param receiver Royalty receiver for this token
     * @param feeBps Royalty fee in basis points
     */
    function setTokenRoyalty(uint256 tokenId, address receiver, uint96 feeBps) external onlyOwner {
        require(feeBps <= MAX_ROYALTY_FEE, "Royalty fee exceeds maximum");
        _setTokenRoyalty(tokenId, receiver, feeBps);
    }
    
    /**
     * @notice Get token URI with override support
     */
    function tokenURI(uint256 tokenId) public view override(ERC721, ERC721URIStorage) returns (string memory) {
        return super.tokenURI(tokenId);
    }
    
    /**
     * @notice Burn token and reset royalty
     */
    function _burn(uint256 tokenId) internal override(ERC721, ERC721URIStorage) {
        super._burn(tokenId);
        _resetTokenRoyalty(tokenId);
    }
    
    /**
     * @notice Support for ERC-721, ERC-2981 interfaces
     */
    function supportsInterface(bytes4 interfaceId) 
        public 
        view 
        override(ERC721, ERC721URIStorage, ERC2981) 
        returns (bool) 
    {
        return super.supportsInterface(interfaceId);
    }
}`;
        } else if (contractType === 'upgradable') {
          contractTemplate = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

contract ${contractData.contractName} is Initializable, ERC721Upgradeable, OwnableUpgradeable {
    string public merkleRoot;
    string public ipldManifest;
    uint256 public royaltyPercent;
    uint256 private _tokenIdCounter;
    
    function initialize() initializer public {
        __ERC721_init("${contractData.contractName}", "${contractData.contractSymbol}");
        __Ownable_init();
        merkleRoot = "${chunkData.merkleRoot}";
        ipldManifest = "${chunkData.ipldManifestCID}";
        royaltyPercent = ${pricingData.royaltyPercent};
    }
    
    function mint(address to) public onlyOwner returns (uint256) {
        uint256 tokenId = _tokenIdCounter;
        _tokenIdCounter++;
        _safeMint(to, tokenId);
        return tokenId;
    }
}`;
        } else if (contractType === 'fractional') {
          contractTemplate = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract ${contractData.contractName} is ERC1155, Ownable {
    string public merkleRoot = "${chunkData.merkleRoot}";
    string public ipldManifest = "${chunkData.ipldManifestCID}";
    uint256 public royaltyPercent = ${pricingData.royaltyPercent};
    
    constructor() ERC1155("https://gateway.pinata.cloud/ipfs/${chunkData.ipldManifestCID}") {}
    
    function mint(address to, uint256 id, uint256 amount) public onlyOwner {
        _mint(to, id, amount, "");
    }
    
    function mintBatch(address to, uint256[] memory ids, uint256[] memory amounts) public onlyOwner {
        _mintBatch(to, ids, amounts, "");
    }
}`;
        }

        addLog(9, 'success', `✅ ${contractType} contract template created`);
        addLog(9, 'info', `📝 Contract size: ${contractTemplate.length} characters`);
        
        setContractData((prev: any) => ({
          ...prev,
          code: contractTemplate
        }));
      }

      toast({ title: 'Success', description: 'Contract ready to deploy!' });
    } catch (error: any) {
      addLog(9, 'error', `❌ Error: ${error.message}`);
      toast({ title: 'Error', description: 'Contract generation failed', variant: 'destructive' });
    } finally {
      setProcessing(false);
    }
  };
  // Step 11: Select Deployed Contract based on asset type
  const selectDeployedContract = async () => {
    setProcessing(true);
    setLogs(prev => ({ ...prev, 11: [] }));

    try {
      addLog(11, 'info', '🔍 Selecting optimal NFT contract for minting...');
      await sleep(300);
      
      let selectedContract: any;
      let contractFeatures: string[] = [];
      
      // Use canonical Thirdweb JoyLicenseToken (ERC-1155) for all asset types
      selectedContract = {
        address: THIRDWEB_CONTRACTS.nftCollection.address,
        network: 'Polygon Amoy',
        chainId: TARGET_CHAIN_ID,
      };
      contractFeatures = ['ERC-1155', 'Shared License Token', 'Royalties', 'Batch minting', 'Audited'];
      addLog(11, 'success', '✅ Selected: JoyLicenseToken (ERC-1155 Audited)');
      
      addLog(11, 'info', `📍 Contract: ${selectedContract.address}`);
      addLog(11, 'info', `🌐 Network: ${selectedContract.network} (Chain ID: ${selectedContract.chainId})`);
      addLog(11, 'info', '✨ Features:');
      contractFeatures.forEach(feature => addLog(11, 'info', `   • ${feature}`));
      addLog(11, 'success', `🔗 View on Polygonscan: https://amoy.polygonscan.com/address/${selectedContract.address}`);
      
      setContractData((prev: any) => ({ 
        ...prev, 
        address: selectedContract.address,
        mintContractName: selectedContract.name,
        deployed: true,
        isExisting: true,
        features: contractFeatures,
        network: selectedContract.network,
        chainId: selectedContract.chainId
      }));
      
      toast({ title: 'Success', description: `Ready to mint with ${selectedContract.name}!` });
      setProcessing(false);
      return;
    } catch (error: any) {
      addLog(11, 'error', `❌ Error: ${error.message}`);
      toast({ title: 'Error', description: 'Contract selection failed', variant: 'destructive' });
      setProcessing(false);
    }
  };
  
  // Reset contract to start a new collection
  const resetStoreContract = async () => {
    setResettingContract(true);
    try {
      if (!storeId) {
        throw new Error('No store found');
      }

      const { error: updateError } = await supabase
        .from('stores')
        .update({ 
          preferred_contract_address: null,
          contract_address: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', storeId);
      
      if (updateError) {
        throw updateError;
      }

      // Reset local state
      setStoreHasContract(false);
      setContractData((prev: any) => ({
        ...prev,
        address: null,
        deployed: false,
        transactionHash: null
      }));

      toast({ 
        title: 'Contract Reset', 
        description: 'You can now deploy a new contract for a fresh collection' 
      });
      setShowContractResetDialog(false);
    } catch (error: any) {
      toast({ 
        title: 'Error', 
        description: `Failed to reset contract: ${error.message}`, 
        variant: 'destructive' 
      });
    } finally {
      setResettingContract(false);
    }
  };

  // Step 9: Contract Ready (auto-detect shared ERC-1155)
  // No custom deployment — uses the audited Thirdweb JoyLicenseToken (ERC-1155)
  const prepareContract = async () => {
    setProcessing(true);
    setLogs(prev => ({ ...prev, 9: [] }));

    try {
      addLog(9, 'info', '🔍 Detecting store license contract...');
      await sleep(300);

      // Use store contract or canonical shared ERC-1155
      const targetAddress = contractData.address || THIRDWEB_CONTRACTS.nftCollection.address;

      addLog(9, 'success', `✅ Using audited JoyLicenseToken (ERC-1155)`);
      addLog(9, 'info', `📋 Contract: ${targetAddress}`);
      addLog(9, 'info', `🌐 Network: ${TARGET_CHAIN_NAME} (${TARGET_CHAIN_ID})`);
      addLog(9, 'info', '🔒 Audited Thirdweb contract — no custom deployment needed');

      setContractData((prev: any) => ({
        ...prev,
        address: targetAddress,
        deployed: true,
        contractName: 'JoyLicenseToken',
        contractSymbol: 'JLICENSE',
      }));

      markStepComplete(9);
      toast({ title: 'Contract Ready', description: 'Using audited ERC-1155 license contract' });
    } catch (error: any) {
      addLog(9, 'error', `❌ Error: ${error.message}`);
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setProcessing(false);
    }
  };

  // Step 10: NFT Image Generation (Runware)
  const generateNFTImage = async () => {
    setProcessing(true);
    setLogs(prev => ({ ...prev, 10: [] }));

    try {
      addLog(10, 'info', '🎨 Generating NFT artwork with Gemini AI...');
      
      let imagePrompt = `Professional NFT artwork for AI Model: ${nftData.name}. ${nftData.description}. Style: Futuristic, tech-focused, vibrant colors, neural network visuals, high quality digital art.`;
      
      if (imageConfig.useCustomPrompt && imageConfig.customImagePrompt) {
        imagePrompt = imageConfig.customImagePrompt;
      }
      
      addLog(10, 'info', `🖼️ Gemini AI creating artwork...`);
      addLog(10, 'info', `📝 Prompt: "${imagePrompt.substring(0, 80)}..."`);
      
      // Call Gemini API for image generation
      const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';
      if (!GEMINI_API_KEY) {
        // Fallback to Supabase edge function (runware-generate) if no Gemini key
        addLog(10, 'info', '🔄 No Gemini API key, falling back to edge function...');
        const { data: fallbackData, error: fallbackError } = await supabase.functions.invoke('runware-generate', {
          body: { prompt: imagePrompt, width: 1024, height: 1024 }
        });
        if (fallbackError || !fallbackData?.success) {
          throw new Error(fallbackData?.error || 'Image generation failed');
        }
        const imageResponse = await fetch(fallbackData.imageUrl);
        const imageBlob = await imageResponse.blob();
        const imageBuffer = await imageBlob.arrayBuffer();
        const imageBase64 = await arrayBufferToBase64(imageBuffer);
        addLog(10, 'success', '✅ NFT artwork generated via fallback!');
        addLog(10, 'info', `📦 Image size: ${(imageBlob.size / 1024).toFixed(2)} KB`);
        addLog(10, 'info', '📤 Uploading artwork to IPFS...');
        const { data: imageUpload, error: imageError } = await supabase.functions.invoke('ipfs-upload', {
          body: {
            fileData: imageBase64, encoding: 'base64',
            fileName: `${nftData.name.replace(/[^a-z0-9]/gi, '-')}.nft.webp`,
            contentType: 'image/webp', pinToHelia: true,
            metadata: { name: `NFT Artwork - ${nftData.name}`, type: 'nft-image', assetName: nftData.name, description: nftData.description?.substring(0, 200) || '', generatedBy: 'fallback' }
          }
        });
        if (imageError || !imageUpload?.ipfsHash) throw new Error('Failed to upload image to IPFS');
        setNftData((prev: any) => ({ ...prev, imageIPFS: imageUpload.ipfsHash, imageGatewayUrl: imageUpload.gatewayUrl || `https://gateway.pinata.cloud/ipfs/${imageUpload.ipfsHash}` }));
        setImageGenerated(true);
        addLog(10, 'success', `✅ Artwork uploaded to IPFS: ${imageUpload.ipfsHash}`);
        markStepComplete(10); // Mark image step done
        toast({ title: 'Success', description: 'NFT image generated!' });
        setProcessing(false);
        return;
      }
      
      // Gemini Imagen API call
      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `Generate an image: ${imagePrompt}` }] }],
            generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
          }),
        }
      );

      if (!geminiRes.ok) {
        const errText = await geminiRes.text();
        throw new Error(`Gemini API error ${geminiRes.status}: ${errText}`);
      }

      const geminiJson = await geminiRes.json();
      
      // Extract inline image data from Gemini response
      let imageBase64 = '';
      let imageMimeType = 'image/png';
      for (const part of geminiJson.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          imageBase64 = part.inlineData.data;
          imageMimeType = part.inlineData.mimeType || 'image/png';
          break;
        }
      }
      
      if (!imageBase64) {
        throw new Error('Gemini did not return image data. Try a different prompt.');
      }
      
      const imageBytes = Uint8Array.from(atob(imageBase64), c => c.charCodeAt(0));
      addLog(10, 'success', '✅ NFT artwork generated by Gemini!');
      addLog(10, 'info', `📦 Image size: ${(imageBytes.length / 1024).toFixed(2)} KB`);
      addLog(10, 'info', '📤 Uploading artwork to IPFS with dual-pinning (Pinata + Helia)...');
      
      // Upload image to IPFS with dual-pinning for Polygonscan display
      const { data: imageUpload, error: imageError } = await supabase.functions.invoke('ipfs-upload', {
        body: {
          fileData: imageBase64,
          encoding: 'base64',
          fileName: `${nftData.name.replace(/[^a-z0-9]/gi, '-')}.nft.png`,
          contentType: imageMimeType,
          pinToHelia: true, // Enable dual-pinning for Polygonscan display
          metadata: {
            name: `NFT Artwork - ${nftData.name}`,
            type: 'nft-image',
            assetName: nftData.name,
            description: nftData.description?.substring(0, 200) || '',
            generatedBy: 'gemini-ai',
          }
        }
      });
      
      if (imageError || !imageUpload?.ipfsHash) {
        throw new Error('Failed to upload image to IPFS');
      }
      
      setNftData((prev: any) => ({ 
        ...prev, 
        imageIPFS: imageUpload.ipfsHash,
        imageGatewayUrl: imageUpload.gatewayUrl || `https://gateway.pinata.cloud/ipfs/${imageUpload.ipfsHash}`,
      }));
      setImageGenerated(true);
      addLog(10, 'success', `✅ Artwork uploaded to IPFS: ${imageUpload.ipfsHash}`);
      addLog(10, 'info', `🌐 Gateway URL: ${imageUpload.gatewayUrl || `https://gateway.pinata.cloud/ipfs/${imageUpload.ipfsHash}`}`);
      addLog(10, 'success', `🎨 NFT Image ready for metadata generation!`);

      toast({ title: 'Success', description: 'NFT image generated with Gemini AI!' });
    } catch (error: any) {
      addLog(10, 'error', `❌ Error: ${error.message}`);
      toast({ title: 'Error', description: 'Image generation failed', variant: 'destructive' });
    } finally {
      setProcessing(false);
    }
  };

  // Step 10 (Part 2): NFT Metadata Generation
  const generateNFTMetadata = async () => {
    setProcessing(true);
    setLogs(prev => ({ ...prev, 10: [] }));

    try {
      if (!nftData.imageIPFS) {
        throw new Error('NFT image must be generated first');
      }

      addLog(10, 'info', '📝 Creating comprehensive NFT metadata...');
      
      // CRITICAL: Use HTTPS gateway URLs for image and metadata so Polygonscan can display them
      // Block explorers cannot resolve ipfs:// protocol - they need direct HTTP access
      const GATEWAY_URL = 'https://rose-magnificent-spoonbill-466.mypinata.cloud/ipfs/';
      
      const metadata = {
        name: nftData.name,
        description: nftData.description,
        // Use HTTPS gateway URL for image so Polygonscan can display it
        image: `${GATEWAY_URL}${nftData.imageIPFS}`,
        external_url: "https://joymarketplace.ai",
        
        // Standard NFT Attributes (10 properties for Polygonscan rarity)
        attributes: [
          { trait_type: "Model Type", value: nftData.modelType },
          { trait_type: "Version", value: nftData.version || "1.0.0" },
          { trait_type: "Category", value: modelData.category || nftData.modelType || "AI Model" },
          { trait_type: "License", value: licenseData.licenseType },
          { trait_type: "Chunks", value: chunkData.totalChunks },
          { trait_type: "Storage Redundancy", value: `${chunkData.redundancyPercent || 0}%` },
          { trait_type: "Royalty", value: `${pricingData.royaltyPercent}%` },
          { trait_type: "Encryption", value: encryptionConfig.encryptionLevel },
          { trait_type: "Quality Score", value: nftData.qualityScore || 85 },
          { trait_type: "Quality Score IPFS", value: nftData.qualityScoreCID ? "Pinned" : "Pending" }
        ],
        
        // License Information
        license: {
          type: licenseData.licenseType,
          cid: licenseData.cid,
          commercial: licenseData.allowCommercial,
          modification: licenseData.allowModification,
          redistribution: licenseData.allowRedistribution,
          attribution: licenseData.requireAttribution,
          revenueShareModel: licenseData.revenueShareModel,
          customTerms: licenseData.customTerms
        },
        
        // Royalty & Pricing
        royalty: {
          percentage: pricingData.royaltyPercent,
          recipient: pricingData.creatorWallet,
          initialPrice: pricingData.initialPrice,
          pricingModel: pricingData.pricingModel
        },
        
        // File & Upload Details
        source: {
          fileName: modelData.file?.name,
          fileSize: modelData.file?.size,
          fileType: modelData.file?.type,
          uploadDate: new Date().toISOString(),
          repoUrl: modelData.repoUrl,
          repoType: modelData.repoType
        },
        
        // Chunk Information with Full Details for Buyer Reassembly
        chunks: chunkData.chunks?.map((chunk: any) => ({
          index: chunk.index,
          hash: chunk.hash,
          cid: chunk.pinataCID || chunk.hash, // Primary CID for download
          heliaCID: chunk.heliaCID,
          localHash: chunk.localHash,
          size: chunk.size,
          offset: chunk.offset,
          length: chunk.length,
          gatewayUrl: chunk.gatewayUrl || `https://gateway.pinata.cloud/ipfs/${chunk.pinataCID || chunk.hash}`,
          hasRedundancy: chunk.hasRedundancy,
          encryption: chunk.encryption,
          ipld: chunk.ipld
        })) || [],
        
        // IPLD & Storage - CRITICAL for asset reassembly
        storage: {
          ipldManifestCID: chunkData.ipldManifestCID,
          merkleRoot: chunkData.merkleRoot,
          merkleTreeCID: chunkData.merkleTreeCID,
          qualityScoreCID: nftData.qualityScoreCID,
          totalChunks: chunkData.totalChunks,
          chunkSize: chunkData.chunkSize || 10485760, // Default 10MB chunks
          // IPFS storage with primary and fallback CIDs
          ipfs: {
            chunkCIDs: chunkData.chunks?.map((c: any) => c.pinataCID || c.hash) || [],
            heliaCIDs: chunkData.chunks?.map((c: any) => c.heliaCID) || []
          }
        },
        
        // Complete Chunking Metadata for Buyer Assistant Reassembly
        chunking: {
          totalChunks: chunkData.totalChunks || 0,
          chunkSize: chunkData.chunkSize || 10485760, // 10MB default
          merkleRoot: chunkData.merkleRoot,
          ipldManifestCID: chunkData.ipldManifestCID,
          // Reassembly script that buyer assistant can execute
          reassemblyScript: chunkData.reassemblyScript || `
// Buyer Asset Reassembly Script
// Execute this in the buyer assistant to reconstruct your purchased asset

async function reassembleAsset(metadata) {
  const chunks = [];
  const gateways = ${JSON.stringify([
    'https://gateway.pinata.cloud/ipfs/',
    'https://ipfs.io/ipfs/',
    'https://cloudflare-ipfs.com/ipfs/',
    'https://dweb.link/ipfs/'
  ])};
  
  for (const chunk of metadata.storage.ipfs.chunkCIDs) {
    let downloaded = false;
    for (const gateway of gateways) {
      try {
        const response = await fetch(gateway + chunk);
        if (response.ok) {
          chunks.push(await response.arrayBuffer());
          downloaded = true;
          break;
        }
      } catch (e) { continue; }
    }
    if (!downloaded && metadata.storage.ipfs.heliaCIDs) {
      // Fallback to Helia CIDs
      const heliaIndex = metadata.storage.ipfs.chunkCIDs.indexOf(chunk);
      if (heliaIndex >= 0 && metadata.storage.ipfs.heliaCIDs[heliaIndex]) {
        for (const gateway of gateways) {
          try {
            const response = await fetch(gateway + metadata.storage.ipfs.heliaCIDs[heliaIndex]);
            if (response.ok) {
              chunks.push(await response.arrayBuffer());
              downloaded = true;
              break;
            }
          } catch (e) { continue; }
        }
      }
    }
    if (!downloaded) throw new Error('Failed to download chunk: ' + chunk);
  }
  
  // Concatenate all chunks
  const totalSize = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const result = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }
  
  return result;
}
`,
          // Direct chunk download information
          chunkCIDs: chunkData.chunks?.map((c: any) => c.pinataCID || c.hash) || [],
          heliaCIDs: chunkData.chunks?.map((c: any) => c.heliaCID) || [],
          chunkHashes: chunkData.chunkHashes || chunkData.chunks?.map((c: any) => c.localHash) || [],
          // Preferred gateways in order of reliability
          gateways: [
            'https://gateway.pinata.cloud/ipfs/',
            'https://ipfs.io/ipfs/',
            'https://cloudflare-ipfs.com/ipfs/',
            'https://dweb.link/ipfs/'
          ]
        },
        
        // Merkle Tree with Complete Reassembly Data
        merkleTree: {
          root: chunkData.merkleRoot,
          treeCID: chunkData.merkleTreeCID,
          totalChunks: chunkData.totalChunks,
          encryption: {
            enabled: encryptionConfig.enableChunkEncryption,
            algorithm: encryptionConfig.enableChunkEncryption ? 'AES-GCM-256' : 'none'
          },
          reassembly: {
            script: chunkData.reassemblyScript,
            chunkCIDs: chunkData.chunks?.map((c: any) => c.pinataCID || c.hash) || [],
            heliaCIDs: chunkData.chunks?.map((c: any) => c.heliaCID) || [],
            chunkHashes: chunkData.chunkHashes || [],
            gateways: [
              'https://gateway.pinata.cloud/ipfs/',
              'https://ipfs.io/ipfs/',
              'https://cloudflare-ipfs.com/ipfs/',
              'https://dweb.link/ipfs/'
            ],
            instructions: {
              step1: 'Download all chunks using the chunkCIDs array from the chunking object',
              step2: 'Verify each chunk integrity using chunkHashes (SHA-256)',
              step3: 'If encrypted, decrypt using the provided decryption key',
              step4: 'Concatenate chunks in index order to reassemble original file',
              step5: 'Verify final file integrity against merkleRoot'
            }
          }
        },
        
        // Encryption Configuration
        encryption: {
          level: encryptionConfig.encryptionLevel,
          chunkEncryption: encryptionConfig.enableChunkEncryption,
          metadataEncryption: encryptionConfig.enableMetadataEncryption,
          accessControl: encryptionConfig.enableAccessControl,
          shaPinning: encryptionConfig.enableSHAPinning,
          hashStorageMethod: encryptionConfig.hashStorageMethod,
          includeMerkleTree: encryptionConfig.includeMerkleTree,
          watermark: encryptionConfig.enableWatermark,
          antiTampering: encryptionConfig.enableAntiTampering,
          timelock: encryptionConfig.enableTimelock
        },
        
        // Proof of Inference
        proofOfInference: {
          proofType: proofConfig.proofType,
          proofCID: nftData.proofCID,
          testInput: proofConfig.testInput,
          enableIPLDProof: proofConfig.enableIPLDProof,
          qualityScore: nftData.qualityScore,
          verified: true,
          timestamp: new Date().toISOString()
        },
        
        // Quality Assessment
        quality: {
          score: nftData.qualityScore,
          assessmentType: qualityConfig.assessmentType,
          enableIPLDSchema: qualityConfig.enableIPLDSchema,
          scoreCID: nftData.qualityScoreCID
        },
        
        // Asset Details & Documentation
        assetDetails: {
          demoVideoUrl: assetDetails.demoVideoUrl,
          whitepaperUrl: assetDetails.whitepaperUrl,
          testResultsUrl: assetDetails.testResultsUrl,
          trainingDataInfo: assetDetails.trainingDataInfo,
          useCases: assetDetails.useCases,
          limitations: assetDetails.limitations,
          additionalTags: assetDetails.additionalTags,
          githubUrl: assetDetails.githubUrl,
          huggingfaceUrl: assetDetails.huggingfaceUrl,
          websiteUrl: assetDetails.websiteUrl
        },
        
        // Store & Marketplace Settings
        storeSettings: {
          listingType: storeSettings.listingType,
          leaseDuration: storeSettings.leaseDuration,
          leasePrice: storeSettings.leasePrice,
          showTechnicalDetails: storeSettings.showTechnicalDetails,
          showDocumentation: storeSettings.showDocumentation,
          showPerformanceMetrics: storeSettings.showPerformanceMetrics,
          highlightFeatured: storeSettings.highlightFeatured
        },
        
        // Contract & Blockchain
        contract: {
          address: contractData.address,
          network: contractData.network || 'Polygon',
          chainId: contractData.chainId || 137,
          contractType: contractData.contractType,
          deployed: contractData.deployed,
          features: contractData.features || []
        },
        
        // Creator Information
        creator: {
          wallet: pricingData.creatorWallet || walletAddress,
          mintWallet: mintWallet,
          createdAt: new Date().toISOString()
        },
        
        // Image Generation
        imageGeneration: {
          runwareSeed: nftData.runwareSeed,
          imageIPFS: nftData.imageIPFS,
          imageGatewayUrl: nftData.imageGatewayUrl,
          customPrompt: imageConfig.useCustomPrompt,
          prompt: imageConfig.customImagePrompt
        }
      };

      addLog(10, 'info', '📤 Uploading metadata JSON to IPFS with dual-pinning (Pinata + Helia)...');
      
      const { data: metadataUpload, error: metadataError } = await supabase.functions.invoke('ipfs-upload', {
        body: {
          fileData: JSON.stringify(metadata, null, 2),
          fileName: `${nftData.name.replace(/[^a-z0-9]/gi, '-')}.metadata.json`,
          contentType: 'application/json',
          pinToHelia: true, // Enable dual-pinning for Polygonscan display
          metadata: {
            name: `NFT Metadata - ${nftData.name}`,
            type: 'nft-metadata',
            assetName: nftData.name,
            description: nftData.description?.substring(0, 200) || '',
            imageCID: nftData.imageIPFS || ''
          }
        }
      });
      
      if (metadataError || !metadataUpload?.ipfsHash) {
        throw new Error('Failed to upload metadata to IPFS');
      }
      
      setNftData((prev: any) => ({ 
        ...prev, 
        metadata, 
        metadataCID: metadataUpload.ipfsHash,
        metadataGatewayUrl: metadataUpload.gatewayUrl || `https://gateway.pinata.cloud/ipfs/${metadataUpload.ipfsHash}`
      }));
      
      addLog(10, 'success', `✅ Metadata uploaded to IPFS: ${metadataUpload.ipfsHash}`);
      addLog(10, 'success', `✅ Gateway URL: ${metadataUpload.gatewayUrl || `https://gateway.pinata.cloud/ipfs/${metadataUpload.ipfsHash}`}`);
      addLog(10, 'info', '📊 Metadata includes:');
      addLog(10, 'info', `   • ${metadata.attributes.length} attributes`);
      addLog(10, 'info', `   • License: ${licenseData.licenseType}`);
      addLog(10, 'info', `   • Royalty: ${pricingData.royaltyPercent}%`);
      addLog(10, 'info', `   • Chunks: ${chunkData.totalChunks}`);
      addLog(10, 'info', `   • Quality: ${nftData.qualityScore}/100`);
      addLog(10, 'success', `🎨 NFT Image IPFS: ${nftData.imageIPFS}`);
      addLog(10, 'success', '✅ NFT is ready to mint!');

      markStepComplete(10);
      toast({ title: 'Success', description: 'NFT metadata generated and uploaded!' });
    } catch (error: any) {
      addLog(10, 'error', `❌ Error: ${error.message}`);
      toast({ title: 'Error', description: 'Metadata generation failed', variant: 'destructive' });
    } finally {
      setProcessing(false);
    }
  };

  // Step 11: Mint NFT via Thirdweb ERC-1155
  const mintNFT = async () => {
    setProcessing(true);
    setLogs(prev => ({ ...prev, 11: [] }));

    try {
      addLog(11, 'info', '⏳ Preparing NFT minting via Thirdweb ERC-1155...');
      addLog(11, 'info', '🔐 Minting 1 canonical license token on JoyLicenseToken');
      await sleep(500);

      if (!walletAddress || !walletClient) {
        addLog(11, 'error', '❌ Wallet not connected or not ready');
        toast({ title: 'Wallet Not Connected', description: 'Please connect your wallet', variant: 'destructive' });
        throw new Error('Please connect your wallet to mint NFTs');
      }

      if (!mintWallet || !mintWallet.match(/^0x[a-fA-F0-9]{40}$/)) {
        throw new Error('Please enter a valid wallet address to mint');
      }

      if (!nftData.metadataCID) {
        throw new Error('Missing metadata. Complete the previous step before minting');
      }

      // Use store contract or shared platform ERC-1155
      const CONTRACT_ADDRESS = contractData.address || THIRDWEB_CONTRACTS.nftCollection.address;

      addLog(11, 'success', '✅ Wallet connected');
      addLog(11, 'info', `📝 Minting to: ${mintWallet.slice(0, 6)}...${mintWallet.slice(-4)}`);
      addLog(11, 'info', `📝 Contract: JoyLicenseToken (ERC-1155)`);
      addLog(11, 'info', `📝 Address: ${CONTRACT_ADDRESS}`);
      addLog(11, 'info', `🌐 Network: ${TARGET_CHAIN_NAME} (${TARGET_CHAIN_ID})`);

      const tokenURI = `https://rose-magnificent-spoonbill-466.mypinata.cloud/ipfs/${nftData.metadataCID}`;

      addLog(11, 'info', '📦 Asset Metadata:');
      addLog(11, 'info', `   • IPLD Manifest: ${chunkData.ipldManifestCID}`);
      addLog(11, 'info', `   • Merkle Root: ${chunkData.merkleRoot?.slice(0, 20)}...`);
      addLog(11, 'info', `   • Total Chunks: ${chunkData.totalChunks}`);
      addLog(11, 'info', `   • License CID: ${licenseData.cid}`);
      addLog(11, 'info', `   • Quality Score: ${nftData.qualityScore}/100`);

      // Build Thirdweb ERC-1155 contract instance
      addLog(11, 'info', '🚀 Minting via Thirdweb SDK (ERC-1155 mintTo)...');
      const nftContract = getContract({
        client: thirdwebClient,
        chain: getThirdwebChain(TARGET_CHAIN_ID),
        address: CONTRACT_ADDRESS,
      });

      const tx = mintTo({
        contract: nftContract,
        to: mintWallet,
        supply: 1n,
        nft: {
          name: nftData.name || 'Untitled Asset',
          description: nftData.description || '',
          image: tokenURI,
          properties: {
            merkleRoot: chunkData.merkleRoot || '',
            ipldManifestCID: chunkData.ipldManifestCID || '',
            licenseCID: licenseData.cid || '',
            qualityScore: nftData.qualityScore || 0,
            totalChunks: chunkData.totalChunks || 0,
            encrypted: encryptionConfig.enableChunkEncryption,
            version: nftData.version || '1.0.0',
            assetType: nftData.modelType || 'ai-model',
          },
        },
      });

      addLog(11, 'info', '✍️ Please confirm the transaction in your wallet...');
      const receipt = await sendMintTx(tx);
      const txHash = receipt.transactionHash;

      // Extract tokenId from TransferSingle event
      let mintedTokenId = 1;
      try {
        const receiptLogs = (receipt as any).logs || [];
        // TransferSingle event signature: TransferSingle(address,address,address,uint256,uint256)
        // topics[0] = event sig, data contains id and value
        for (const log of receiptLogs) {
          if (log.topics && log.topics.length >= 1 && log.data && log.data.length >= 130) {
            // ERC-1155 TransferSingle: id is first 32 bytes of data
            const idHex = '0x' + log.data.slice(2, 66);
            const possibleId = parseInt(idHex, 16);
            if (possibleId > 0 && possibleId < 1e12) {
              mintedTokenId = possibleId;
              break;
            }
          }
        }
      } catch {
        // fallback to 1
      }

      addLog(11, 'success', '🎉 MINTING COMPLETE!');
      addLog(11, 'success', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      addLog(11, 'success', `✅ Minted to: ${mintWallet}`);
      addLog(11, 'success', `✅ Token ID: ${mintedTokenId}`);
      addLog(11, 'success', `✅ View TX: https://amoy.polygonscan.com/tx/${txHash}`);
      addLog(11, 'success', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      addLog(11, 'info', '');
      addLog(11, 'info', '📋 Buyers can now:');
      addLog(11, 'info', '   • Purchase license tokens via MarketplaceV3');
      addLog(11, 'info', '   • Access all asset chunks via IPLD manifest');
      addLog(11, 'info', '   • Verify integrity with Merkle proofs');

      setNftData((prev: any) => ({
        ...prev,
        tokenId: mintedTokenId,
        mintedTokens: [mintedTokenId],
        txHash,
        totalMinted: 1,
      }));

      setContractData((prev: any) => ({
        ...prev,
        address: CONTRACT_ADDRESS,
        deployed: true,
      }));

      markStepComplete(11);
      toast({ title: 'NFT Minted! 🎉', description: 'ERC-1155 license token minted successfully' });

      // ═══ CELESTIA DA: Record asset provenance (fire-and-forget) ═══
      if (celestiaDA.isNodeAvailable) {
        addLog(11, 'info', '⛓️ Anchoring asset provenance to Celestia DA...');
        celestiaDA.recordAssetProvenance({
          asset_id: nftData.name?.replace(/\s+/g, '-').toLowerCase() || 'unknown',
          creator_id: user?.id || address || 'unknown',
          asset_name: nftData.name || 'Untitled',
          asset_type: nftData.modelType || 'ai-model',
          ipfs_metadata_cid: nftData.metadataCID || undefined,
          ipfs_image_cid: nftData.imageIPFS || undefined,
          ipfs_chunk_cids: chunkData.chunks?.map((c: any) => c.cid).filter(Boolean) || undefined,
          contract_address: CONTRACT_ADDRESS,
          token_id: String(mintedTokenId),
          chain_id: TARGET_CHAIN_ID,
          tx_hash: txHash,
          merkle_root: chunkData.merkleRoot || undefined,
          content_hash: nftData.contentHash || undefined,
          quality_score: nftData.qualityScore || undefined,
          license_type: licenseData.licenseType || undefined,
          price: pricingData.initialPrice || undefined,
          currency: 'MATIC',
          royalty_bps: (pricingData.royaltyPercent || 0) * 100,
          description: nftData.description || undefined,
          tags: assetDetails.additionalTags ? assetDetails.additionalTags.split(',').map((t: string) => t.trim()) : undefined,
        });
        addLog(11, 'info', '📦 Provenance blob submitted to Celestia (non-blocking)');
      }

      // ═══ WEB3 PIPELINE: Run Lit, IPLD, Celestia, Graph, Fluid enrichment (fire-and-forget) ═══
      addLog(11, 'info', '🌐 Starting Web3 enrichment pipeline (Lit → IPLD → Celestia → Graph → Fluid)...');
      web3Pipeline.executePostMint({
        tokenId: mintedTokenId,
        contractAddress: CONTRACT_ADDRESS,
        txHash: txHash,
        name: nftData.name || 'Untitled',
        description: nftData.description || '',
        assetType: nftData.modelType || 'ai-model',
        category: nftData.category || '',
        manifestCID: chunkData.manifestCID || nftData.metadataCID || '',
        metadataCID: nftData.metadataCID || '',
        imageCID: nftData.imageIPFS || '',
        merkleRoot: chunkData.merkleRoot || '',
        contentCID: chunkData.chunks?.[0]?.cid || '',
        chunkCIDs: chunkData.chunks?.map((c: any) => c.cid).filter(Boolean) || [],
        price: pricingData.initialPrice,
        royaltyBps: (pricingData.royaltyPercent || 0) * 100,
        enableLitEncryption: encryptionConfig.trustlessEnabled || false,
        enableFluidLiquidity: true,
        creatorId: user?.id || address || '',
        licenseTiers: [
          {
            tier: 'personal' as const,
            name: 'Personal License',
            description: 'Personal, non-commercial use',
            priceWei: String(Math.round((pricingData.initialPrice || 0) * 1e18)),
            maxSupply: 0,
            transferable: true,
            permissions: ['download', 'use'],
          },
        ],
      }).then(r => {
        if (r.success) {
          addLog(11, 'success', '✅ Web3 enrichment complete — Lit, IPLD, Celestia, Graph, Fluid all processed');
        } else {
          addLog(11, 'info', '⚠️ Web3 enrichment partially complete — some stages skipped');
        }
      }).catch(e => {
        addLog(11, 'info', `⚠️ Web3 enrichment failed (non-blocking): ${e.message}`);
      });
    } catch (error: any) {
      addLog(11, 'error', `❌ Minting failed: ${error.shortMessage || error.message}`);
      toast({
        title: 'Minting Failed',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setProcessing(false);
    }
  };

  // listOnMarketplace removed — replaced by finalizeCreation which uses Thirdweb MarketplaceV3

  // Generate Asset Detail with AI
  const generateAssetDetail = async (fieldType: 'trainingData' | 'useCases' | 'limitations') => {
    setGeneratingDetail(fieldType);

    try {
      const { data: result, error } = await supabase.functions.invoke('generate-asset-details', {
        body: {
          assetName: nftData.name,
          description: nftData.description,
          modelType: nftData.modelType,
          fieldType
        }
      });

      if (error) throw error;

      if (!result?.success) {
        throw new Error(result?.error || 'Failed to generate content');
      }

      // Update the appropriate field
      if (fieldType === 'trainingData') {
        setAssetDetails(prev => ({ ...prev, trainingDataInfo: result.content }));
        toast({ title: 'Generated!', description: 'Training data information added' });
      } else if (fieldType === 'useCases') {
        setAssetDetails(prev => ({ ...prev, useCases: result.content }));
        toast({ title: 'Generated!', description: 'Use cases added' });
      } else if (fieldType === 'limitations') {
        setAssetDetails(prev => ({ ...prev, limitations: result.content }));
        toast({ title: 'Generated!', description: 'Limitations added' });
      }
    } catch (error: any) {
      console.error('AI generation error:', error);
      toast({ 
        title: 'Generation Failed', 
        description: error.message || 'Failed to generate content with AI', 
        variant: 'destructive' 
      });
    } finally {
      setGeneratingDetail(null);
    }
  };

  // Open Joy Assistant for a specific field
  const openJoyAssistant = (context: AssetAssistantContext) => {
    setAssistantContext(context);
    setShowAssetAssistant(true);
  };

  // Handle Joy Assistant response
  const handleAssistantResponse = (response: string) => {
    if (assistantContext === 'description') {
      // Only use the generated content, not the full conversation
      setNftData((prev: any) => ({ ...prev, description: response }));
      toast({ title: 'Applied!', description: 'Description updated' });
    } else if (assistantContext === 'trainingData') {
      setAssetDetails(prev => ({ ...prev, trainingDataInfo: response }));
      toast({ title: 'Applied!', description: 'Training data information added' });
    } else if (assistantContext === 'useCases') {
      setAssetDetails(prev => ({ ...prev, useCases: response }));
      toast({ title: 'Applied!', description: 'Use cases added' });
    } else if (assistantContext === 'limitations') {
      setAssetDetails(prev => ({ ...prev, limitations: response }));
      toast({ title: 'Applied!', description: 'Limitations added' });
    } else if (assistantContext === 'ethicalConsiderations') {
      // Handle ethical considerations if needed
      toast({ title: 'Applied!', description: 'Ethical considerations noted' });
    } else if (assistantContext === 'license') {
      setLicenseData((prev: any) => ({ ...prev, customTerms: response }));
      toast({ title: 'Applied!', description: 'License terms added' });
    }
  };

  // Step 12: Save Asset Details
  const saveAssetDetails = () => {
    markStepComplete(12);
    toast({ title: 'Success', description: 'Asset details saved!' });
  };

  // Step 13: Review Complete
  const confirmReview = () => {
    markStepComplete(13);
    toast({ title: 'Success', description: 'Review complete - ready to list!' });
    nextStep();
  };

  // Step 14: Finalize and List on Marketplace (On-Chain First via Thirdweb MarketplaceV3)
  const finalizeCreation = async () => {
    setProcessing(true);
    setLogs(prev => ({ ...prev, 14: [] }));

    try {
      addLog(14, 'info', '🏪 Finalizing asset and listing on-chain via MarketplaceV3...');
      
      if (!user?.id) {
        addLog(14, 'error', '❌ User not authenticated');
        toast({ title: 'Authentication Required', description: 'Please sign in to list assets', variant: 'destructive' });
        throw new Error('User must be authenticated');
      }
      
      if (!nftData.name) {
        addLog(14, 'error', '❌ Asset name is required');
        throw new Error('Asset name is required');
      }

      if (!isConnected || !walletAddress) {
        addLog(14, 'error', '❌ Wallet not connected — required for on-chain listing');
        toast({ title: 'Wallet Required', description: 'Connect your wallet to list on MarketplaceV3', variant: 'destructive' });
        throw new Error('Wallet must be connected for on-chain listing');
      }

      // ═══ PRIMARY: On-chain listing via Thirdweb MarketplaceV3 ═══
      addLog(14, 'info', '⛓️ Creating on-chain listing on MarketplaceV3...');
      addLog(14, 'info', `📋 Seller: ${walletAddress}`);
      addLog(14, 'info', `🪙 Token ID: ${nftData.tokenId || '0'}`);
      addLog(14, 'info', `💰 Price: ${pricingData.initialPrice} MATIC`);

      const assetContract = contractData.address || THIRDWEB_CONTRACTS.edition.address;
      
      const listingResult = await createDirectListing({
        assetContractAddress: assetContract,
        tokenId: BigInt(nftData.tokenId || '0'),
        pricePerToken: String(pricingData.initialPrice),
        isERC1155: true,
        quantity: 1n,
      });

      if (!listingResult.success) {
        throw new Error(listingResult.error || 'On-chain listing failed');
      }

      addLog(14, 'success', `✅ On-chain listing created!`);
      addLog(14, 'success', `✅ Tx: ${listingResult.transactionHash}`);
      addLog(14, 'info', '=== FINAL ASSET DATA ===');
      addLog(14, 'info', `📦 Name: ${nftData.name}`);
      addLog(14, 'info', `💰 Price: ${pricingData.initialPrice} MATIC`);
      addLog(14, 'info', `🪙 Token ID: ${nftData.tokenId || 'N/A'}`);
      addLog(14, 'info', `⭐ Quality Score: ${nftData.qualityScore}/100`);
      addLog(14, 'info', `📄 Contract: ${assetContract}`);
      addLog(14, 'info', '======================');

      markStepComplete(14);
      toast({ title: '🎉 Listed On-Chain!', description: `${nftData.name} is now live on MarketplaceV3`, duration: 5000 });

      // ═══ CELESTIA DA: Anchor listing manifest (non-blocking) ═══
      if (celestiaDA.isNodeAvailable) {
        addLog(14, 'info', '⛓️ Anchoring listing manifest to Celestia DA...');
        celestiaDA.recordListingManifest({
          asset_id: nftData.name?.replace(/\s+/g, '-').toLowerCase() || 'unknown',
          seller_id: user?.id || 'unknown',
          contract_address: assetContract,
          token_id: String(nftData.tokenId || '0'),
          chain_id: TARGET_CHAIN_ID,
          asset_name: nftData.name,
          asset_type: nftData.modelType || 'ai-model',
          description: nftData.description || undefined,
          tags: assetDetails.additionalTags ? assetDetails.additionalTags.split(',').map((t: string) => t.trim()) : undefined,
          metadata_cid: nftData.metadataCID || undefined,
          image_cid: nftData.imageIPFS || undefined,
          merkle_root: chunkData.merkleRoot || undefined,
          quality_score: nftData.qualityScore || undefined,
        });
        addLog(14, 'info', '📦 Listing manifest submitted to Celestia (non-blocking)');
      }

      // ═══ CACHE-WRITE: Fire-and-forget DB cache update ═══
      try {
        addLog(14, 'info', '💾 Caching listing to database (non-blocking)...');
        MarketplaceListingService.listAsset({
          userId: user.id,
          name: nftData.name,
          description: nftData.description || 'No description provided',
          assetType: (nftData.modelType || 'ai-model') as any,
          contractAddress: assetContract,
          tokenId: nftData.tokenId || '0',
          metadataCID: nftData.metadataCID || '',
          chainId: TARGET_CHAIN_ID,
          merkleRoot: chunkData.merkleRoot || '',
          ipldManifest: chunkData.ipldManifestCID || '',
          price: pricingData.initialPrice,
          royaltyPercentage: pricingData.royaltyPercent,
          listingType: storeSettings.listingType as 'sale' | 'lease' | 'both',
          leaseDuration: storeSettings.leaseDuration,
          leasePrice: storeSettings.leasePrice,
          qualityScore: nftData.qualityScore || 0,
          totalChunks: chunkData.totalChunks || 0,
          encrypted: encryptionConfig.enableChunkEncryption,
          version: nftData.version || 'v1.0',
          imageUrl: nftData.imageIPFS ? `https://gateway.pinata.cloud/ipfs/${nftData.imageIPFS}` : '',
          demoVideoUrl: assetDetails.demoVideoUrl,
          whitepaperUrl: assetDetails.whitepaperUrl,
          testResultsUrl: assetDetails.testResultsUrl,
          githubUrl: assetDetails.githubUrl,
          huggingfaceUrl: assetDetails.huggingfaceUrl,
          websiteUrl: assetDetails.websiteUrl,
          trainingDataInfo: assetDetails.trainingDataInfo,
          useCases: assetDetails.useCases,
          limitations: assetDetails.limitations,
          additionalTags: assetDetails.additionalTags,
          licenseType: licenseData.licenseType,
          highlightFeatured: storeSettings.highlightFeatured,
          addToHotDeals: storeSettings.addToHotDeals,
          addToTopPicks: storeSettings.addToTopPicks,
          showTechnicalDetails: storeSettings.showTechnicalDetails,
          showDocumentation: storeSettings.showDocumentation,
          showPerformanceMetrics: storeSettings.showPerformanceMetrics
        }).then(cacheResult => {
          if (cacheResult.success) {
            console.log('[Wizard] DB cache write succeeded:', cacheResult.assetId);
          }
        }).catch(cacheErr => {
          console.warn('[Wizard] DB cache write failed (non-blocking):', cacheErr.message);
        });
      } catch (cacheErr: any) {
        console.warn('[Wizard] DB cache fire-and-forget error:', cacheErr.message);
      }

      // ═══ JOYFLOW BRIDGE: Publish to decentralized stack (non-blocking) ═══
      try {
        addLog(14, 'info', '🌐 Publishing to decentralized stack (IPFS + ERC-1155)...');
        const joyflowBridge = getJoyFlowBridge();
        const bridgeResult = await joyflowBridge.publishToDecentralized({
          name: nftData.name,
          description: nftData.description || 'No description provided',
          assetType: nftData.modelType || 'ai-model',
          creatorWallet: walletAddress || address || '0x0',
          price: pricingData.initialPrice,
          royaltyPercent: pricingData.royaltyPercent,
          licenseType: licenseData.licenseType,
          encryptedCID: chunkData.ipldManifestCID || '',
          merkleRoot: chunkData.merkleRoot || '',
          totalChunks: chunkData.totalChunks || 0,
          qualityScore: nftData.qualityScore || 0,
          contractAddress: assetContract,
          nftTokenId: String(nftData.tokenId || '0'),
          metadataCID: nftData.metadataCID || '',
          imageIPFS: nftData.imageIPFS || '',
          tags: assetDetails.additionalTags ? assetDetails.additionalTags.split(',').map((t: string) => t.trim()) : [],
          category: nftData.modelType || 'ai-model',
          version: nftData.version || '1.0',
        });

        if (bridgeResult.success) {
          addLog(14, 'success', `✅ IPFS manifest: ${bridgeResult.manifestCID.slice(0, 20)}...`);
          addLog(14, 'info', '🌐 Asset is now discoverable via IPFS + The Graph');
        } else {
          addLog(14, 'info', `⚠️ Decentralized publish skipped: ${bridgeResult.error || 'non-critical'}`);
        }
      } catch (bridgeErr: any) {
        addLog(14, 'info', `⚠️ Decentralized stack (non-blocking): ${bridgeErr.message}`);
        console.warn('[Wizard] JoyFlow bridge failed (non-blocking):', bridgeErr.message);
      }
      
      setTimeout(() => {
        clearWizardDraft();
        navigate({ to: '/on-chain-marketplace' });
      }, 2000);
      
    } catch (error: any) {
      console.error('On-chain listing error:', error);
      
      let errorTitle = 'On-Chain Listing Failed';
      let errorDescription = error.message || 'Failed to create on-chain listing';
      
      if (error.message?.includes('wallet') || error.message?.includes('Wallet')) {
        errorTitle = 'Wallet Error';
        errorDescription = 'Please ensure your wallet is connected and on Polygon Amoy (80002).';
      } else if (error.message?.includes('rejected') || error.message?.includes('denied')) {
        errorTitle = 'Transaction Rejected';
        errorDescription = 'You rejected the transaction in your wallet. Please try again.';
      } else if (error.message?.includes('insufficient')) {
        errorTitle = 'Insufficient Funds';
        errorDescription = 'Not enough MATIC to cover gas fees. Please fund your wallet.';
      }
      
      addLog(14, 'error', `❌ ${errorTitle}: ${errorDescription}`);
      toast({ title: errorTitle, description: errorDescription, variant: 'destructive', duration: 7000 });
    } finally {
      setProcessing(false);
    }
  };

  // Helper: Check if asset type requires compute platform (only agents need compute)
  const AGENT_ASSET_TYPES = ['agent', 'autonomous_agent', 'ai-agent'];
  const requiresCompute = AGENT_ASSET_TYPES.includes(nftData.modelType);

  // Navigation — follows STEP_ORDER sequence
  const nextStep = () => {
    const currentIndex = STEP_ORDER.indexOf(currentStep);
    if (currentIndex === -1 || currentIndex >= STEP_ORDER.length - 1) return;
    
    let nextIndex = currentIndex + 1;
    let nextStepNum = STEP_ORDER[nextIndex];
    
    // Skip Step 11 (Agent Compute) if asset type doesn't require compute
    if (nextStepNum === 11 && !requiresCompute) {
      console.log('⏭️ Skipping Step 11 - Asset type does not require compute');
      if (!completedSteps.includes(11)) {
        setCompletedSteps(prev => [...prev, 11]);
      }
      nextIndex++;
      if (nextIndex >= STEP_ORDER.length) return;
      nextStepNum = STEP_ORDER[nextIndex];
    }
    
    setCurrentStep(nextStepNum);
  };

  const prevStep = () => {
    const currentIndex = STEP_ORDER.indexOf(currentStep);
    if (currentIndex <= 0) return;
    
    let prevIndex = currentIndex - 1;
    let prevStepNum = STEP_ORDER[prevIndex];
    
    // Skip Step 11 (Agent Compute) when going backwards if asset doesn't require compute
    if (prevStepNum === 11 && !requiresCompute) {
      console.log('⏭️ Skipping Step 11 (backwards) - Asset type does not require compute');
      prevIndex--;
      if (prevIndex < 0) return;
      prevStepNum = STEP_ORDER[prevIndex];
    }
    
    setCurrentStep(prevStepNum);
  };

  // Agent compute skip detection for sidebar
  const isAgentComputeAutoSkipped = !requiresCompute;

  const StepIcon = WIZARD_STEPS.find(s => s.id === currentStep)?.icon || Upload;

  // Helper to render logs - shows detailed logs for admins, user-friendly progress for others
  const renderLogDisplay = (stepLogs: string[] | undefined, estimatedTime?: string) => {
    if (!stepLogs || stepLogs.length === 0) return null;
    
    const hasSuccess = stepLogs.some(log => log.includes('[SUCCESS]') || log.includes('✅'));
    const hasError = stepLogs.some(log => log.includes('[ERROR]') || log.includes('❌'));
    const isProcessing = !hasSuccess && !hasError;
    
    if (isAdmin) {
      return (
        <div className="bg-muted p-4 rounded-lg max-h-64 overflow-y-auto font-mono text-xs space-y-1">
          {stepLogs.map((log, i) => (
            <div key={i} className={
              log.includes('[SUCCESS]') || log.includes('✅') ? 'text-green-600' :
              log.includes('[ERROR]') || log.includes('❌') ? 'text-red-600' :
              log.includes('[WARNING]') || log.includes('⚠️') ? 'text-yellow-600' : ''
            }>{log}</div>
          ))}
        </div>
      );
    }
    
    return (
      <div className="bg-muted p-4 rounded-lg flex items-center gap-3">
        {hasSuccess ? (
          <>
            <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0" />
            <span className="text-sm text-muted-foreground">Step completed successfully!</span>
          </>
        ) : hasError ? (
          <>
            <span className="text-sm text-destructive">An error occurred. Please try again.</span>
          </>
        ) : (
          <>
            <Loader2 className="h-5 w-5 animate-spin text-primary flex-shrink-0" />
            <div className="flex flex-col">
              <span className="text-sm text-muted-foreground">Processing your asset...</span>
              {estimatedTime && (
                <span className="text-xs text-muted-foreground/70">Please be patient. Estimated time: {estimatedTime}</span>
              )}
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold mb-2">
          🚀 Complete NFT Creation Flow <span className="text-sm bg-primary text-primary-foreground px-3 py-1 rounded-full ml-2">AI-POWERED</span>
        </h1>
        <p className="text-muted-foreground">
          Asset Upload → AI Smart Chunking → IPFS Upload → Smart Contract → License → Royalties → NFT Minting → Marketplace
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
        {/* Sidebar */}
        <Card className="h-fit sticky top-6">
          <CardHeader>
            <CardTitle className="text-sm font-semibold uppercase tracking-wide opacity-60">Process Steps</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {WIZARD_STEPS.map((step, displayIndex) => {
              const Icon = step.icon;
              const isActive = currentStep === step.id;
              const isCompleted = completedSteps.includes(step.id);
              
              // Special handling for Step 11 - show as auto-skipped if asset doesn't require compute
              const isStep11AutoSkipped = step.id === 11 && !requiresCompute;
              
              const isAutoSkipped = isStep11AutoSkipped;
              const displayCompleted = isCompleted || isAutoSkipped;
              const isDisabled = isAutoSkipped;
              
              // Get skip reason text
              const getSkipReason = () => {
                if (isStep11AutoSkipped) return 'Not required for this asset type';
                return '';
              };
              
              return (
                <button
                  key={step.id}
                  onClick={() => {
                    // Skip Step 11 if asset doesn't require compute
                    if (step.id === 11 && !requiresCompute) {
                      toast({
                        title: 'Step Skipped',
                        description: 'Agent compute is only required for AI Agents',
                      });
                      return;
                    }
                    setCurrentStep(step.id);
                  }}
                  disabled={isDisabled}
                  className={`w-full flex items-center gap-3 p-3 rounded-lg transition-all ${
                    isActive 
                      ? 'bg-primary text-primary-foreground shadow-lg scale-105' 
                      : displayCompleted
                        ? isDisabled 
                          ? 'bg-muted/50 text-muted-foreground cursor-not-allowed opacity-60'
                          : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                        : 'hover:bg-accent'
                  }`}
                >
                  <div className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-semibold ${
                    isActive 
                      ? 'bg-primary-foreground text-primary' 
                      : displayCompleted 
                        ? isDisabled
                          ? 'bg-muted text-muted-foreground'
                          : 'bg-green-600 text-white' 
                        : 'bg-muted'
                  }`}>
                    {displayCompleted ? (isAutoSkipped ? '—' : '✓') : displayIndex + 1}
                  </div>
                  <div className="flex-1 text-left">
                    <span className="text-sm">{step.title}</span>
                    {isAutoSkipped && (
                      <p className="text-xs opacity-70">{getSkipReason()}</p>
                    )}
                  </div>
                  {step.id === 4 && <Brain className="w-4 h-4" />}
                </button>
              );
            })}
            
            <div className="pt-4 mt-4 border-t">
              <div className="space-y-2">
                <Progress value={overallProgress} className="h-2" />
                <div className="text-center text-sm text-muted-foreground">
                  Overall Progress: <span className="font-semibold">{Math.round(overallProgress)}%</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Main Content */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <StepIcon className="w-6 h-6" />
              <CardTitle>{WIZARD_STEPS.find(s => s.id === currentStep)?.title}</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Step 1: Upload Asset */}
            {currentStep === 1 && (
              <div className="space-y-4">
                <p className="text-muted-foreground">Upload your AI asset file, download from URL, or use test data</p>
                
                {/* Drag-and-Drop Zone */}
                <div 
                  className={`border-2 border-dashed rounded-lg p-6 transition-colors ${
                    isDragging 
                      ? 'border-primary bg-primary/5 border-solid' 
                      : 'border-border hover:border-primary/50'
                  }`}
                  onDragOver={handleDragOver}
                  onDragEnter={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                >
                  <div className="space-y-4">
                    <div className="text-center">
                      <Upload className={`mx-auto h-12 w-12 ${isDragging ? 'text-primary' : 'text-muted-foreground'} mb-4`} />
                      <p className="text-sm font-medium mb-2">
                        {isDragging ? 'Drop files here' : 'Drag and drop files, folders, or zip files here'}
                      </p>
                      <p className="text-xs text-muted-foreground mb-4">or click below to browse</p>
                    </div>
                    
                    <div className="space-y-3">
                      <div>
                        <Label>Option 1a: Upload Asset File or Zip</Label>
                        <Input 
                          type="file" 
                          accept=".bin,.safetensors,.onnx,.pt,.pth,.h5,.pkl,.gguf,.ggml,.zip" 
                          onChange={handleFileUpload} 
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          Supported: .bin, .safetensors, .onnx, .pt, .pth, .h5, .pkl, .gguf, .ggml, .zip
                        </p>
                      </div>
                      
                      <div>
                        <Label>Option 1b: Upload Folder</Label>
                        <Input 
                          type="file" 
                          // @ts-ignore - webkitdirectory is not in the standard types but is widely supported
                          webkitdirectory="true"
                          directory="true"
                          multiple
                          onChange={handleFileUpload} 
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          Select a folder containing your asset files
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className="text-center text-muted-foreground text-sm">or</div>
                
                <div className="space-y-2">
                  <Label>Option 2: Download from URL</Label>
                  <div className="flex gap-2">
                    <Input 
                      value={downloadUrl}
                      onChange={(e) => setDownloadUrl(e.target.value)}
                      placeholder="https://github.com/user/repo/model.bin or https://huggingface.co/..."
                      className="flex-1"
                    />
                    <Button 
                      onClick={downloadFromUrl} 
                      disabled={downloading || !downloadUrl.trim()}
                      variant="outline"
                    >
                      {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : '📥 Download'}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Supports: GitHub, Hugging Face, direct URLs, etc.
                  </p>
                </div>
                
                {logs[1] && logs[1].length > 0 && (
                  isAdmin ? (
                    <div className="bg-muted p-4 rounded-lg max-h-64 overflow-y-auto font-mono text-xs space-y-1">
                      {logs[1].map((log, i) => (
                        <div key={i} className={
                          log.includes('[SUCCESS]') ? 'text-green-600' :
                          log.includes('[ERROR]') ? 'text-red-600' :
                          log.includes('[WARNING]') ? 'text-yellow-600' : ''
                        }>{log}</div>
                      ))}
                    </div>
                  ) : (
                    <div className="bg-muted p-4 rounded-lg flex items-center gap-3">
                      {logs[1].some(log => log.includes('[SUCCESS]')) ? (
                        <>
                          <CheckCircle className="h-5 w-5 text-green-600" />
                          <span className="text-sm text-muted-foreground">File uploaded successfully!</span>
                        </>
                      ) : logs[1].some(log => log.includes('[ERROR]')) ? (
                        <>
                          <span className="text-sm text-destructive">Upload failed. Please try again.</span>
                        </>
                      ) : (
                        <>
                          <Loader2 className="h-5 w-5 animate-spin text-primary" />
                          <span className="text-sm text-muted-foreground">Processing file...</span>
                        </>
                      )}
                    </div>
                  )
                )}
                
                <div className="flex gap-2">
                  <Button onClick={nextStep} disabled={!modelData.file}>Next →</Button>
                </div>
              </div>
            )}

            {/* Step 2: Asset Metadata */}
            {currentStep === 2 && (
              <div className="space-y-4">
                <p className="text-muted-foreground">Provide information about your AI asset</p>
                
                <div className="space-y-4">
                  <div>
                    <Label>Asset Name *</Label>
                    <Input 
                      value={nftData.name} 
                      onChange={(e) => setNftData((prev: any) => ({ ...prev, name: e.target.value }))}
                      placeholder="e.g., GPT-4 Fine-tuned Customer Support"
                    />
                  </div>
                  
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label>Description *</Label>
                      <Button 
                        type="button"
                        variant="outline" 
                        size="sm"
                        onClick={enhanceDescription}
                        disabled={enhancingDescription || !nftData.description || nftData.description.trim().length < 10}
                        className="gap-2"
                      >
                        {enhancingDescription ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Enhancing...
                          </>
                        ) : (
                          <>
                            <Sparkles className="h-4 w-4" />
                            Enhance with AI
                          </>
                        )}
                      </Button>
                    </div>
                    <Textarea 
                      value={nftData.description} 
                      onChange={(e) => setNftData((prev: any) => ({ ...prev, description: e.target.value }))}
                      placeholder="Describe your asset's capabilities, training data, and use cases..."
                      rows={4}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Write a basic description, then click "Enhance with AI" to make it more compelling and professional
                    </p>
                  </div>
                  
                  <div>
                    <Label>Asset Type</Label>
                    <Select value={nftData.modelType} onValueChange={(val) => setNftData((prev: any) => ({ ...prev, modelType: val }))}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="language">Language Model</SelectItem>
                        <SelectItem value="vision">Vision Model</SelectItem>
                        <SelectItem value="audio">Audio Model</SelectItem>
                        <SelectItem value="multimodal">Multimodal Model</SelectItem>
                        <SelectItem value="embedding">Embedding Model</SelectItem>
                        <SelectItem value="dataset">Dataset</SelectItem>
                        <SelectItem value="agent">AI Agent</SelectItem>
                        <SelectItem value="workflow">Workflow</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div>
                    <Label>Version</Label>
                    <Input 
                      value={nftData.version} 
                      onChange={(e) => setNftData((prev: any) => ({ ...prev, version: e.target.value }))}
                      placeholder="e.g., 1.0.0"
                    />
                  </div>
                </div>
                
                <div className="flex gap-2">
                  <Button variant="outline" onClick={prevStep}>← Back</Button>
                  <Button onClick={saveMetadata}>Next →</Button>
                </div>
              </div>
            )}

            {/* Step 3: Security & Encryption - Trustless (Lit Protocol + Filecoin) */}
            {currentStep === 3 && (
              <div className="space-y-4">
                {/* Trustless Encryption Component */}
                <TrustlessEncryptionStep
                  onComplete={(trustlessConfig) => {
                    console.log('[Wizard] Trustless encryption config:', trustlessConfig);
                    // Store trustless config in encryption config
                    setEncryptionConfig(prev => ({
                      ...prev,
                      trustlessEnabled: trustlessConfig.enabled,
                      trustlessMode: trustlessConfig.mode,
                      trustlessResult: trustlessConfig.result
                    }));
                    markStepComplete(3);
                    nextStep();
                  }}
                  nftContract={contractData.address || undefined}
                  tokenId={chunkData.tokenId || undefined}
                  file={modelData.file}
                  isProcessing={processing}
                />
                
                {/* Legacy options (collapsed) */}
                <Collapsible>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="w-full text-muted-foreground">
                      Advanced Legacy Options ▾
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-4 pt-4">
                    <div>
                      <Label>Legacy Encryption Level</Label>
                      <Select value={encryptionConfig.encryptionLevel} onValueChange={(val) => setEncryptionConfig(prev => ({ ...prev, encryptionLevel: val }))}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None (Public Asset)</SelectItem>
                          <SelectItem value="basic">Standard Encryption</SelectItem>
                          <SelectItem value="advanced">Advanced Encryption</SelectItem>
                          <SelectItem value="quantum">Quantum-Resistant</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <div className="space-y-2 pt-4 border-t">
                      {[
                        { key: 'enableChunkEncryption', label: 'Encrypt individual chunks' },
                        { key: 'enableSHAPinning', label: 'Enable SHA-256 hash pinning' },
                        { key: 'includeMerkleTree', label: 'Generate Merkle tree' },
                      ].map(({ key, label }) => (
                        <div key={key} className="flex items-center gap-2">
                          <Checkbox 
                            checked={encryptionConfig[key as keyof typeof encryptionConfig] as boolean}
                            onCheckedChange={(checked) => setEncryptionConfig(prev => ({ ...prev, [key]: checked }))}
                          />
                          <Label className="font-normal cursor-pointer">{label}</Label>
                        </div>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
                
                <div className="flex gap-2">
                  <Button variant="outline" onClick={prevStep}>← Back</Button>
                  <Button onClick={nextStep}>Skip to Next →</Button>
                </div>
              </div>
            )}

            {/* Step 4: AI Smart Chunking */}
            {currentStep === 4 && (
              <div className="space-y-4">
                {/* Debug: Log state on mount */}
                {(() => { console.log('[Step 4] File state:', modelData.file?.name, 'Size:', modelData.file?.size, 'Processing:', processing, 'Encryption:', encryptionConfig.trustlessEnabled); return null; })()}
                <p className="text-muted-foreground">AI-powered intelligent chunking with IPLD content-addressed blocks</p>
                
                {/* Progress Panel - shown during processing */}
                {processing && !chunkData.merkleRoot && (
                  <div className="bg-primary/5 border border-primary/20 rounded-lg p-6 space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        <Brain className="h-4 w-4 absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-primary" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-lg">AI Smart Chunking in Progress</h3>
                        <p className="text-sm text-muted-foreground">Please be patient while we optimize your asset</p>
                      </div>
                    </div>
                    
                    <div className="bg-background/50 rounded-lg p-4 space-y-3">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">File Size:</span>
                        <span className="font-medium">{modelData.file ? `${(modelData.file.size / (1024 * 1024)).toFixed(2)} MB` : 'Unknown'}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Estimated Time:</span>
                        <span className="font-medium text-primary">
                          {modelData.file ? (
                            modelData.file.size < 1024 * 1024 ? '1-2 minutes' :
                            modelData.file.size < 10 * 1024 * 1024 ? '2-5 minutes' :
                            modelData.file.size < 50 * 1024 * 1024 ? '5-10 minutes' :
                            modelData.file.size < 100 * 1024 * 1024 ? '10-15 minutes' :
                            modelData.file.size < 500 * 1024 * 1024 ? '15-25 minutes' :
                            '25-45 minutes'
                          ) : '~15 minutes'}
                        </span>
                      </div>
                      <div className="pt-2 border-t">
                        <p className="text-xs text-muted-foreground">
                          ⏳ AI is analyzing your file structure, determining optimal chunk boundaries, and creating content-addressed blocks for decentralized storage.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
                
                {/* Admin logs */}
                {isAdmin && renderLogDisplay(logs[4], '15-25 minutes')}
                
                {/* User-friendly success message for non-admins */}
                {!isAdmin && !processing && chunkData.merkleRoot && (
                  <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 flex items-center gap-3">
                    <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-green-700 dark:text-green-400">AI Chunking Complete!</p>
                      <p className="text-xs text-muted-foreground">Your asset has been securely split into {chunkData.totalChunks || 'multiple'} encrypted blocks</p>
                    </div>
                  </div>
                )}
                
                {chunkData.merkleRoot && (
                  <div className="p-6 bg-primary/10 rounded-lg border border-primary/30">
                    <h3 className="text-xl font-semibold mb-2">🌳 Merkle Tree Root Generated</h3>
                    <div className="font-mono text-sm break-all bg-background/50 p-3 rounded border my-4">
                      {chunkData.merkleRoot}
                    </div>
                    {chunkData.merkleTreeCID && (
                      <div className="mt-4 space-y-2">
                        <div className="text-sm font-semibold">📦 Merkle Tree Proof:</div>
                        
                        {/* Pinata CID */}
                        <div className="space-y-1">
                          <div className="text-xs text-muted-foreground">Pinata CID:</div>
                          <div className="font-mono text-xs break-all bg-background/50 p-3 rounded border">
                            {chunkData.merkleTreeCID}
                          </div>
                          <a 
                            href={`https://gateway.pinata.cloud/ipfs/${chunkData.merkleTreeCID}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-primary hover:underline inline-flex items-center gap-1"
                          >
                            🔗 View on Pinata Gateway →
                          </a>
                        </div>
                        
                        {/* Helia CID */}
                        {chunkData.merkleHeliaRCID && (
                          <div className="space-y-1 pt-2 border-t">
                            <div className="text-xs text-muted-foreground">Helia CID:</div>
                            <div className="font-mono text-xs break-all bg-background/50 p-3 rounded border">
                              {chunkData.merkleHeliaRCID}
                            </div>
                            <a 
                              href={`https://ipfs.io/ipfs/${chunkData.merkleHeliaRCID}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm text-primary hover:underline inline-flex items-center gap-1"
                            >
                              🌐 Verify on IPFS.io (Helia) →
                            </a>
                          </div>
                        )}
                      </div>
                    )}
                    <div className="text-sm text-muted-foreground mt-4">
                      This cryptographic root hash proves the integrity of all {chunkData.totalChunks} chunks
                    </div>
                  </div>
                )}
                
                {/* Debug info for button state */}
                {!modelData.file && (
                  <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3 flex items-center gap-2 text-sm text-destructive">
                    <AlertCircle className="h-4 w-4" />
                    <span>No file detected. Please go back to Step 1 and re-upload your file.</span>
                  </div>
                )}
                
                <div className="flex gap-2">
                  <Button variant="outline" onClick={prevStep}>← Back</Button>
                  <Button 
                    onClick={() => {
                      console.log('[AI Chunking] Button clicked, file:', modelData.file);
                      console.log('[AI Chunking] Processing state:', processing);
                      console.log('[AI Chunking] Encryption config:', encryptionConfig);
                      processChunking();
                    }} 
                    disabled={processing || !modelData.file}
                  >
                    {processing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Brain className="w-4 h-4 mr-2" />}
                    {!modelData.file ? 'No File Uploaded' : 'Start AI Chunking'}
                  </Button>
                  <Button onClick={nextStep} disabled={!completedSteps.includes(4)}>Next →</Button>
                </div>
              </div>
            )}

            {/* Step 9: Quality Score (checks full build quality including generated image) */}
            {currentStep === 9 && (
              <div className="space-y-6">
                <div>
                  <p className="text-muted-foreground mb-4">AI-powered comprehensive quality assessment using DeepSeek</p>
                  
                  <div className="space-y-4 bg-card border rounded-lg p-4">
                    <div>
                      <Label>Assessment Type</Label>
                      <Select value={qualityConfig.assessmentType} onValueChange={(val) => setQualityConfig(prev => ({ ...prev, assessmentType: val }))}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="automated">Automated Analysis</SelectItem>
                          <SelectItem value="manual">Manual Review</SelectItem>
                          <SelectItem value="hybrid">Hybrid Approach</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <Checkbox 
                        checked={qualityConfig.enableIPLDSchema}
                        onCheckedChange={(checked) => setQualityConfig(prev => ({ ...prev, enableIPLDSchema: !!checked }))}
                      />
                      <Label className="font-normal cursor-pointer">Generate IPLD schema for quality data</Label>
                    </div>
                  </div>
                </div>
                
                {renderLogDisplay(logs[9], '3-5 minutes')}
                
                {nftData.qualityScore > 0 && (
                  <div className="space-y-4">
                    {/* Overall Score Card */}
                    <div className="p-6 bg-gradient-to-br from-primary/20 via-primary/10 to-background rounded-xl border border-primary/30 shadow-lg">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-xl font-semibold">📊 Quality Assessment</h3>
                        <div className={`px-3 py-1 rounded-full text-sm font-medium ${
                          nftData.qualityScore >= 90 ? 'bg-green-500/20 text-green-700 dark:text-green-300' :
                          nftData.qualityScore >= 75 ? 'bg-blue-500/20 text-blue-700 dark:text-blue-300' :
                          nftData.qualityScore >= 60 ? 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-300' :
                          'bg-red-500/20 text-red-700 dark:text-red-300'
                        }`}>
                          {nftData.qualityScore >= 90 ? 'Excellent' :
                           nftData.qualityScore >= 75 ? 'Good' :
                           nftData.qualityScore >= 60 ? 'Fair' : 'Needs Improvement'}
                        </div>
                      </div>
                      <div className="flex items-baseline gap-2 mb-2">
                        <div className="text-5xl font-bold text-primary">{nftData.qualityScore}</div>
                        <div className="text-2xl text-muted-foreground">/100</div>
                      </div>
                      <div className="text-sm text-muted-foreground">Overall Quality Score</div>
                    </div>

                    {/* Quality Dimensions Grid */}
                    {nftData.qualityMetrics && (
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        {Object.entries(nftData.qualityMetrics).filter(([key]) => key !== 'overall').map(([key, value]: [string, any]) => (
                          <div key={key} className="bg-card border rounded-lg p-4 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium capitalize">{key}</span>
                              <span className="text-lg font-bold text-primary">{value}%</span>
                            </div>
                            <Progress value={value} className="h-2" />
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Strengths & Weaknesses */}
                    {nftData.qualityAssessment && (nftData.qualityAssessment.strengths?.length > 0 || nftData.qualityAssessment.weaknesses?.length > 0) && (
                      <div className="grid md:grid-cols-2 gap-4">
                        {/* Strengths */}
                        {nftData.qualityAssessment.strengths?.length > 0 && (
                          <div className="bg-card border border-green-500/30 rounded-lg p-4">
                            <h4 className="font-semibold text-green-600 dark:text-green-400 mb-3 flex items-center gap-2">
                              <CheckCircle className="w-4 h-4" />
                              Strengths
                            </h4>
                            <ul className="space-y-2">
                              {nftData.qualityAssessment.strengths.map((strength: string, i: number) => (
                                <li key={i} className="text-sm flex items-start gap-2">
                                  <span className="text-green-500 mt-0.5">•</span>
                                  <span>{strength}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Weaknesses */}
                        {nftData.qualityAssessment.weaknesses?.length > 0 && (
                          <div className="bg-card border border-yellow-500/30 rounded-lg p-4">
                            <h4 className="font-semibold text-yellow-600 dark:text-yellow-400 mb-3 flex items-center gap-2">
                              <Sparkles className="w-4 h-4" />
                              Areas for Improvement
                            </h4>
                            <ul className="space-y-2">
                              {nftData.qualityAssessment.weaknesses.map((weakness: string, i: number) => (
                                <li key={i} className="text-sm flex items-start gap-2">
                                  <span className="text-yellow-500 mt-0.5">•</span>
                                  <span>{weakness}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Recommendations */}
                    {nftData.qualityAssessment?.recommendations?.length > 0 && (
                      <div className="bg-card border border-blue-500/30 rounded-lg p-4">
                        <h4 className="font-semibold text-blue-600 dark:text-blue-400 mb-3 flex items-center gap-2">
                          <Brain className="w-4 h-4" />
                          AI Recommendations
                        </h4>
                        <ul className="space-y-2">
                          {nftData.qualityAssessment.recommendations.map((rec: string, i: number) => (
                            <li key={i} className="text-sm flex items-start gap-2 p-2 rounded bg-blue-500/5 hover:bg-blue-500/10 transition-colors">
                              <span className="text-blue-500 mt-0.5 font-bold">{i + 1}.</span>
                              <span>{rec}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
                
                {/* Export Buttons */}
                {nftData.qualityScore > 0 && (
                  <div className="flex gap-2 items-center justify-end border-t pt-4">
                    <span className="text-sm text-muted-foreground mr-auto">Export Quality Report:</span>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={exportQualityReportAsJSON}
                      className="flex items-center gap-2"
                    >
                      <Download className="w-4 h-4" />
                      Export JSON
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={exportQualityReportAsPDF}
                      className="flex items-center gap-2"
                    >
                      <Download className="w-4 h-4" />
                      Export PDF
                    </Button>
                  </div>
                )}
                
                <div className="flex gap-2">
                  <Button variant="outline" onClick={prevStep}>← Back</Button>
                  <Button onClick={generateQualityScore} disabled={processing}>
                    {processing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Brain className="w-4 h-4 mr-2" />}
                    Generate Quality Score
                  </Button>
                  <Button onClick={nextStep} disabled={!completedSteps.includes(9)}>Next →</Button>
                </div>
              </div>
            )}

            {/* Step 5: Proof-of-Inference */}
            {currentStep === 5 && (
              <div className="space-y-4">
                <p className="text-muted-foreground">Generate cryptographic proof-of-inference</p>
                
                <div className="space-y-4">
                  <div>
                    <Label>Proof Type</Label>
                    <Select value={proofConfig.proofType} onValueChange={(val) => setProofConfig(prev => ({ ...prev, proofType: val }))}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="zk-snark">ZK-SNARK</SelectItem>
                        <SelectItem value="zk-stark">ZK-STARK</SelectItem>
                        <SelectItem value="optimistic">Optimistic Proof</SelectItem>
                        <SelectItem value="signature">Digital Signature</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div>
                    <Label>Test Input (Optional)</Label>
                    <Textarea 
                      value={proofConfig.testInput} 
                      onChange={(e) => setProofConfig(prev => ({ ...prev, testInput: e.target.value }))}
                      placeholder="Sample input for inference test..."
                      rows={3}
                    />
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <Checkbox 
                      checked={proofConfig.enableIPLDProof}
                      onCheckedChange={(checked) => setProofConfig(prev => ({ ...prev, enableIPLDProof: !!checked }))}
                    />
                    <Label className="font-normal cursor-pointer">Create IPLD DAG proof structure</Label>
                  </div>
                </div>
                
                {renderLogDisplay(logs[6], '5-10 minutes')}
                
                <div className="flex gap-2">
                  <Button variant="outline" onClick={prevStep}>← Back</Button>
                  <Button onClick={generateProofOfInference} disabled={processing}>
                    {processing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    Generate Proof
                  </Button>
                  <Button onClick={nextStep} disabled={!completedSteps.includes(6)}>Next →</Button>
                </div>
              </div>
            )}

            {/* Step 6: Royalties & Pricing */}
            {currentStep === 6 && (
              <div className="space-y-4">
                <p className="text-muted-foreground">Set pricing and royalty configuration</p>
                
                <div className="space-y-4">
                  <div>
                    <Label>Initial Price (MATIC)</Label>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => setPricingData(prev => ({ ...prev, initialPrice: Math.max(0.1, prev.initialPrice - 1) }))}
                        className="h-10 w-10"
                      >
                        -
                      </Button>
                      <Input 
                        type="number" 
                        value={pricingData.initialPrice} 
                        onChange={(e) => setPricingData(prev => ({ ...prev, initialPrice: Math.max(0.1, parseFloat(e.target.value) || 0.1) }))}
                        placeholder="1"
                        min="0.1"
                        step="0.5"
                        className="text-center"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => setPricingData(prev => ({ ...prev, initialPrice: prev.initialPrice + 1 }))}
                        className="h-10 w-10"
                      >
                        +
                      </Button>
                      <span className="text-muted-foreground font-medium">MATIC</span>
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <p className="text-xs text-muted-foreground">
                        Min: 0.1 MATIC • Quick adjust: ±1 MATIC
                      </p>
                      <p className="text-xs font-medium text-primary">
                        ≈ ${(pricingData.initialPrice * (cryptoPrices?.matic || 0.40)).toFixed(2)} USD
                      </p>
                    </div>
                  </div>
                  
                  <div>
                    <Label>Royalty</Label>
                    <div className="flex items-center gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={() => setPricingData(prev => ({ ...prev, royaltyPercent: Math.max(0, prev.royaltyPercent - 1) }))}
                            className="h-10 w-10"
                          >
                            -
                          </Button>
                          <Input 
                            type="number" 
                            value={pricingData.royaltyPercent} 
                            onChange={(e) => setPricingData(prev => ({ ...prev, royaltyPercent: Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)) }))}
                            placeholder="10"
                            max="100"
                            min="0"
                            step="1"
                            className="text-center"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={() => setPricingData(prev => ({ ...prev, royaltyPercent: Math.min(100, prev.royaltyPercent + 1) }))}
                            className="h-10 w-10"
                          >
                            +
                          </Button>
                          <span className="text-muted-foreground font-medium">%</span>
                        </div>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Percentage of secondary sales you receive (0-100%)
                    </p>
                  </div>
                  
                  <div className="space-y-2">
                    <Label>Creator Wallet Address</Label>
                    {isConnected && walletAddress ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-md">
                          <CheckCircle className="w-5 h-5 text-green-600" />
                          <span className="text-sm font-mono text-green-700 dark:text-green-300">
                            {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
                          </span>
                        </div>
                        <Input 
                          value={pricingData.creatorWallet} 
                          onChange={(e) => setPricingData(prev => ({ ...prev, creatorWallet: e.target.value }))}
                          placeholder="0x..."
                          className="font-mono"
                        />
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <Input 
                          value={pricingData.creatorWallet} 
                          onChange={(e) => setPricingData(prev => ({ ...prev, creatorWallet: e.target.value }))}
                          placeholder="0x... or connect wallet"
                          className="font-mono"
                        />
                        <p className="text-xs text-muted-foreground">
                          💡 Connect your wallet to auto-fill this address, or enter manually
                        </p>
                      </div>
                    )}
                  </div>
                  
                  <div>
                    <Label>Pricing Model</Label>
                    <Select value={pricingData.pricingModel} onValueChange={(val) => setPricingData(prev => ({ ...prev, pricingModel: val }))}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fixed">Fixed Price</SelectItem>
                        <SelectItem value="auction">Auction</SelectItem>
                        <SelectItem value="offer">Accept Offers</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                
                {renderLogDisplay(logs[7], '2-3 minutes')}
                
                <div className="flex gap-2">
                  <Button variant="outline" onClick={prevStep}>← Back</Button>
                  <Button onClick={savePricing} disabled={processing || !pricingData.creatorWallet}>
                    {processing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <DollarSign className="w-4 h-4 mr-2" />}
                    Save Pricing
                  </Button>
                  <Button onClick={nextStep} disabled={!completedSteps.includes(7)}>Next →</Button>
                </div>
              </div>
            )}


            {/* Step 7: License & Terms */}
            {currentStep === 7 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-muted-foreground">AI-generated licensing terms</p>
                  <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded-full">
                    Step 8 of 14 • Includes pricing from Step 7
                  </span>
                </div>
                
                <div className="space-y-4">
                  <div>
                    <Label>License Type</Label>
                    <Select value={licenseData.licenseType} onValueChange={(val) => setLicenseData((prev: any) => ({ ...prev, licenseType: val }))}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="commercial">Commercial</SelectItem>
                        <SelectItem value="non-commercial">Non-Commercial</SelectItem>
                        <SelectItem value="research">Research Only</SelectItem>
                        <SelectItem value="custom">Custom License</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="space-y-2">
                    {[
                      { key: 'allowCommercial', label: 'Allow commercial use' },
                      { key: 'allowModification', label: 'Allow modifications' },
                      { key: 'allowRedistribution', label: 'Allow redistribution' },
                      { key: 'requireAttribution', label: 'Require attribution' },
                    ].map(({ key, label }) => (
                      <div key={key} className="flex items-center gap-2">
                        <Checkbox 
                          checked={licenseData[key as keyof typeof licenseData] as boolean}
                          onCheckedChange={(checked) => setLicenseData((prev: any) => ({ ...prev, [key]: checked }))}
                        />
                        <Label className="font-normal cursor-pointer">{label}</Label>
                      </div>
                    ))}
                  </div>
                  
                  <div>
                    <Label>Revenue Share Model</Label>
                    <Select value={licenseData.revenueShareModel} onValueChange={(val) => setLicenseData((prev: any) => ({ ...prev, revenueShareModel: val }))}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fixed">Fixed Price</SelectItem>
                        <SelectItem value="revenue-share">Revenue Share</SelectItem>
                        <SelectItem value="usage-based">Usage-Based</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div>
                    <Label>Custom Terms (Optional)</Label>
                    <Textarea 
                      value={licenseData.customTerms} 
                      onChange={(e) => setLicenseData((prev: any) => ({ ...prev, customTerms: e.target.value }))}
                      placeholder="Additional terms and conditions..."
                      rows={4}
                    />
                  </div>
                </div>
                
                {renderLogDisplay(logs[8], '2-3 minutes')}
                
                {licenseData.terms && (
                  <div className="border rounded-lg p-4 space-y-3">
                    <h4 className="font-semibold">📄 Generated License Terms</h4>
                    <div className="space-y-2 text-sm">
                      <p className="text-muted-foreground"><strong>Summary:</strong> {licenseData.terms.summary}</p>
                      <p className="text-muted-foreground"><strong>TL;DR:</strong> {licenseData.terms.human.tldr}</p>
                      {licenseData.terms.royalty && (
                        <p className="text-muted-foreground">
                          <strong>Royalty:</strong> {licenseData.terms.royalty.percentage}% ({licenseData.terms.royalty.model})
                        </p>
                      )}
                      <a 
                        href={licenseData.gatewayUrl} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-primary hover:underline text-xs"
                      >
                        View Full License on IPFS →
                      </a>
                    </div>
                  </div>
                )}
                
                <div className="flex gap-2">
                  <Button variant="outline" onClick={prevStep}>← Back</Button>
                  <Button onClick={generateLicense} disabled={processing}>
                    {processing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Sparkles className="w-4 h-4 mr-2" />}
                    Generate with AI
                  </Button>
                  <Button onClick={nextStep} disabled={!completedSteps.includes(8)}>Next →</Button>
                </div>
              </div>
            )}

            {/* Step 9 (Contract Deployment) REMOVED — using existing platform contracts */}
            {false && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-muted-foreground">Select contract type and deploy to Polygon</p>
                  <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded-full">
                    Step 9 of 14 • Smart Contract
                  </span>
                </div>
                
                <div className="space-y-4">
                  {/* Contract Type Selection - Always visible */}
                  <div className="space-y-4">
                    <div>
                      <Label>Contract Type</Label>
                      <Select 
                        value={contractData.deploymentType} 
                        onValueChange={(val) => setContractData((prev: any) => ({ ...prev, deploymentType: val }))}
                      >
                        <SelectTrigger className="bg-background">
                          <SelectValue placeholder="Select contract type..." />
                        </SelectTrigger>
                        <SelectContent className="bg-background border shadow-lg z-50">
                          <SelectItem value="standard">📦 Standard NFT (ERC-721 + ERC-2981)</SelectItem>
                          <SelectItem value="fractional">🧩 Fractional NFT</SelectItem>
                          <SelectItem value="upgradable">🔄 Upgradable Contract</SelectItem>
                          <SelectItem value="ai-custom">🤖 Custom (AI Generated)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {contractData.deploymentType && (
                      <div className="p-4 border rounded-lg space-y-3 bg-muted/50">
                        <h4 className="font-semibold">
                          {contractData.deploymentType === 'standard' && '📦 Standard NFT Contract (ERC-721 + ERC-2981)'}
                          {contractData.deploymentType === 'upgradable' && '🔄 Upgradable Contract'}
                          {contractData.deploymentType === 'fractional' && '🧩 Fractional NFT Contract'}
                          {contractData.deploymentType === 'ai-custom' && '🤖 AI-Generated Custom Contract'}
                        </h4>
                        <p className="text-sm text-muted-foreground">
                          {contractData.deploymentType === 'standard' && 'ERC-721 compliant NFT with ERC-2981 royalty standard for automated marketplace royalties'}
                          {contractData.deploymentType === 'upgradable' && 'Proxy-based upgradable contract with future improvements'}
                          {contractData.deploymentType === 'fractional' && 'ERC-1155 multi-token with fractional ownership'}
                          {contractData.deploymentType === 'ai-custom' && 'AI-generated contract tailored to your asset requirements'}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Contract Details Form - Show after type selection and not deployed */}
                  {contractData.deploymentType && !contractData.deployed && (
                    <div className="space-y-4">
                      <div>
                        <Label>Contract Name</Label>
                        <Input 
                          value={contractData.contractName} 
                          onChange={(e) => setContractData((prev: any) => ({ ...prev, contractName: e.target.value }))}
                          placeholder="e.g., MyAIModelNFT"
                        />
                      </div>

                      <div>
                        <Label>Contract Symbol</Label>
                        <Input 
                          value={contractData.contractSymbol} 
                          onChange={(e) => setContractData((prev: any) => ({ ...prev, contractSymbol: e.target.value }))}
                          placeholder="e.g., AIMDL"
                          maxLength={10}
                        />
                      </div>

                      <div className="p-4 border rounded-lg space-y-2">
                        <h4 className="font-semibold text-sm">Contract Features</h4>
                        <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                          <li>NFT minting with metadata</li>
                          <li>Royalties: {pricingData.royaltyPercent}%</li>
                          <li>License: {licenseData.licenseType}</li>
                          <li>Merkle root: {chunkData.merkleRoot?.slice(0, 20)}...</li>
                          <li>IPLD manifest: {chunkData.ipldManifestCID?.slice(0, 20)}...</li>
                        </ul>
                      </div>
                      
                      {/* Single action button - matches test-full-nft-flow.html Step 7 */}
                      {contractData.contractName && contractData.contractSymbol && (
                        <>
                          <Button
                            id="contractBtn"
                            onClick={prepareContract}
                            disabled={processing || !isConnected || !walletClient}
                            variant="default"
                            className="w-full"
                          >
                            {processing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Zap className="w-4 h-4 mr-2" />}
                            ⚡ Generate & Deploy Contract
                          </Button>
                          
                          {isConnected && !walletClient && (
                            <p className="text-xs text-yellow-600">⚠️ Wallet client loading... If this persists, try disconnecting and reconnecting your wallet.</p>
                          )}
                        </>
                      )}
                      
                      {contractData.contractName && !contractData.contractSymbol && (
                        <p className="text-xs text-muted-foreground">⚠️ Please enter a contract symbol to continue</p>
                      )}
                      
                      {!isConnected && (
                        <p className="text-xs text-yellow-600">⚠️ Please connect your wallet to deploy the contract</p>
                      )}
                    </div>
                  )}
                  
                  {contractData.deployed && contractData.address && (
                    <div className="p-4 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg">
                      <div className="flex items-start gap-3">
                        <CheckCircle className="w-5 h-5 text-green-600 mt-0.5" />
                        <div className="space-y-2">
                          <p className="font-semibold text-green-700 dark:text-green-300">Contract Deployed! 🎉</p>
                          <div className="text-sm space-y-1">
                            <p className="font-mono text-xs">{contractData.address}</p>
                            <a 
                              href={`https://polygonscan.com/address/${contractData.address}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline text-xs flex items-center gap-1"
                            >
                              View on PolygonScan →
                            </a>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                
                {renderLogDisplay(logs[9], '3-5 minutes')}
                
                <div className="flex gap-2 flex-wrap">
                  <Button variant="outline" onClick={prevStep}>← Back</Button>
                  
                  {/* Next button - disabled until contract is deployed (matches test-full-nft-flow.html) */}
                  <Button onClick={nextStep} disabled={!contractData.deployed}>Next →</Button>
                </div>
              </div>
            )}

            {/* Step 8: Generate Image & Metadata */}
            {currentStep === 8 && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <h3 className="text-lg font-semibold">Generate NFT Image</h3>
                  <p className="text-muted-foreground">Generate NFT artwork and metadata with AI</p>
                </div>
                
                {/* Image Generation Section */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Step 1: Generate NFT Image</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground">Generate professional NFT artwork using Runware AI</p>
                    
                    <div className="flex items-center gap-2">
                      <Checkbox 
                        id="custom-prompt"
                        checked={imageConfig.useCustomPrompt}
                        onCheckedChange={(checked) => setImageConfig(prev => ({ ...prev, useCustomPrompt: !!checked }))}
                      />
                      <Label htmlFor="custom-prompt" className="font-normal cursor-pointer">Use Custom Image Prompt</Label>
                    </div>
                    
                    {imageConfig.useCustomPrompt && (
                      <div>
                        <Label>Custom Image Prompt</Label>
                        <Textarea 
                          value={imageConfig.customImagePrompt} 
                          onChange={(e) => setImageConfig(prev => ({ ...prev, customImagePrompt: e.target.value }))}
                          placeholder="Describe the NFT artwork you want to generate with Runware AI..."
                          rows={4}
                        />
                      </div>
                    )}
                    
                    <div className="flex gap-2">
                      <Button 
                        onClick={generateNFTImage}
                        disabled={processing}
                      >
                        {processing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Sparkles className="w-4 h-4 mr-2" />}
                        {nftData.imageIPFS ? '🔄 Regenerate Image' : '✨ Generate NFT Image'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
                
                {/* NFT Image Display */}
                {nftData.imageIPFS && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <CheckCircle className="w-5 h-5 text-green-600" />
                        ✅ NFT Image Generated!
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div>
                        <Label className="text-base">NFT Artwork</Label>
                        <p className="text-sm text-muted-foreground mb-2">🎨 Generated with Runware AI</p>
                        <img 
                          src={nftData.imageGatewayUrl || `https://gateway.pinata.cloud/ipfs/${nftData.imageIPFS}`}
                          alt="Generated NFT Artwork"
                          className="w-full max-w-lg rounded-lg border shadow-md"
                        />
                      </div>
                      
                      <div className="grid gap-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Image IPFS (Pinata):</span>
                          <code className="text-xs bg-muted px-2 py-1 rounded">{nftData.imageIPFS}</code>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Pinata Gateway:</span>
                          <a 
                            href={nftData.imageGatewayUrl || `https://gateway.pinata.cloud/ipfs/${nftData.imageIPFS}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline text-xs"
                          >
                            🔗 View on Pinata
                          </a>
                        </div>
                        {nftData.imageIPFS && (
                          <div className="flex justify-between pt-2 border-t">
                            <span className="text-muted-foreground">Verify on Helia:</span>
                            <a 
                              href={`https://ipfs.io/ipfs/${nftData.imageIPFS}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline text-xs"
                            >
                              🌐 View on IPFS.io
                            </a>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )}
                
                {/* Metadata Generation Section */}
                {imageGenerated && nftData.imageIPFS && (
                  <Card className="border-t-2 border-primary/20">
                    <CardHeader>
                      <CardTitle className="text-base">Step 2: Generate Metadata</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <p className="text-sm text-muted-foreground">Generate complete NFT metadata JSON with asset information</p>
                      
                      {!nftData.metadataCID ? (
                        <Button 
                          onClick={generateNFTMetadata}
                          disabled={processing}
                          className="w-full"
                        >
                          {processing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <FileText className="w-4 h-4 mr-2" />}
                          Generate Metadata
                        </Button>
                      ) : (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <CheckCircle className="w-5 h-5 text-green-600" />
                            <span className="font-semibold">✅ Metadata Generated!</span>
                          </div>
                          <div className="grid gap-2 text-sm">
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Metadata IPFS (Pinata):</span>
                              <code className="text-xs bg-muted px-2 py-1 rounded">{nftData.metadataCID}</code>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Pinata Gateway:</span>
                              <a 
                                href={nftData.metadataGatewayUrl || `https://gateway.pinata.cloud/ipfs/${nftData.metadataCID}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:underline text-xs"
                              >
                                🔗 View Metadata
                              </a>
                            </div>
                            {nftData.metadataCID && (
                              <div className="flex justify-between pt-2 border-t">
                                <span className="text-muted-foreground">Verify on Helia:</span>
                                <a 
                                  href={`https://ipfs.io/ipfs/${nftData.metadataCID}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-primary hover:underline text-xs"
                                >
                                  🌐 View on IPFS.io
                                </a>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}
                
                {renderLogDisplay(logs[10], '2-5 minutes')}
                
                <div className="flex gap-2">
                  <Button variant="outline" onClick={prevStep}>← Back</Button>
                  <Button onClick={nextStep} disabled={!completedSteps.includes(10)}>Next →</Button>
                </div>
              </div>
            )}

            {/* Step 10: Mint NFT via Thirdweb ERC-1155 */}
            {currentStep === 10 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-muted-foreground">Mint your NFT on the audited ERC-1155 license contract</p>
                  <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded-full">
                    Mint NFT
                  </span>
                </div>

                {/* Contract Info */}
                <div className="p-4 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg">
                  <div className="space-y-2">
                    <p className="font-semibold text-green-700 dark:text-green-300">
                      🔒 Audited Thirdweb JoyLicenseToken (ERC-1155)
                    </p>
                    <p className="text-sm font-mono text-green-600 dark:text-green-400">
                      {contractData.address || THIRDWEB_CONTRACTS.nftCollection.address}
                    </p>
                    <p className="text-xs text-green-600 dark:text-green-400">
                      Shared license contract on {TARGET_CHAIN_NAME} — buyers purchase license tokens via MarketplaceV3
                    </p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Mint to Wallet Address</Label>
                    {isConnected && walletAddress ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-md">
                          <CheckCircle className="w-5 h-5 text-green-600" />
                          <span className="text-sm font-mono text-green-700 dark:text-green-300">
                            {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
                          </span>
                        </div>
                        <Input 
                          value={mintWallet} 
                          onChange={(e) => setMintWallet(e.target.value)}
                          placeholder="0x..."
                          className="font-mono"
                        />
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <Input 
                          value={mintWallet} 
                          onChange={(e) => setMintWallet(e.target.value)}
                          placeholder="0x... or connect wallet"
                          className="font-mono"
                        />
                        <p className="text-xs text-muted-foreground">
                          💡 Connect your wallet to auto-fill this address, or enter manually
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Supply is fixed at 1 - buyers purchase license tokens instead */}
                  <div className="space-y-2">
                    <Label>Total Supply</Label>
                    <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-md border">
                      <span className="font-semibold">1</span>
                      <span className="text-xs text-muted-foreground">(Canonical asset - buyers purchase license tokens)</span>
                    </div>
                  </div>
                  
                  <div className="p-4 border rounded-lg space-y-2">
                    <h4 className="font-semibold text-sm">📦 NFT Metadata Includes:</h4>
                    <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
                      <li>Asset Name: {nftData.name}</li>
                      <li>IPLD Manifest CID: {chunkData.ipldManifestCID}</li>
                      <li>Total Chunks: {chunkData.totalChunks}</li>
                      <li>Merkle Root: {chunkData.merkleRoot?.slice(0, 20)}...</li>
                      <li>License CID: {licenseData.cid}</li>
                      <li>Quality Score: {nftData.qualityScore}/100</li>
                    </ul>
                    <p className="text-xs text-muted-foreground mt-2">
                      ℹ️ Buyers/lessees will get access to all chunks via this metadata
                    </p>
                  </div>
                </div>
                
                {renderLogDisplay(logs[11], '2-3 minutes')}
                
                {/* Web3 Pipeline Status */}
                <Web3PipelineStatus progress={web3Pipeline.progress} isRunning={web3Pipeline.isRunning} />
                
                <div className="flex gap-2">
                  <Button variant="outline" onClick={prevStep}>← Back</Button>
                  <Button 
                    onClick={mintNFT} 
                    disabled={processing || !mintWallet}
                  >
                    {processing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Zap className="w-4 h-4 mr-2" />}
                    ⚡ Mint ERC-1155 License Token
                  </Button>
                  <Button onClick={nextStep} disabled={!completedSteps.includes(10)}>Next →</Button>
                </div>
              </div>
            )}

            {/* Step 11: Agent Compute */}
            {currentStep === 11 && (
              <div className="space-y-4">
                <AgentConfigStep
                  assetName={nftData.name || 'Untitled Asset'}
                  assetDescription={nftData.description || ''}
                  assetType={nftData.modelType || 'language'}
                  onConfigComplete={(config) => {
                    setAgentConfig(config);
                    markStepComplete(11);
                    toast({ title: 'Agent Configured', description: `Agent "${config.name}" configured on ${config.computeConfig.platform}` });
                    nextStep();
                  }}
                  onSkip={() => {
                    markStepComplete(11);
                    toast({ title: 'Skipped', description: 'Agent compute skipped' });
                    nextStep();
                  }}
                  initialConfig={agentConfig ? agentConfig : undefined}
                />
              </div>
            )}

            {/* Step 12 "Marketplace Listing" duplicate removed — marketplace listing is in Step 14 */}

            {/* Step 12: Asset Details */}
            {currentStep === 12 && (
              <div className="space-y-4">
                <p className="text-muted-foreground">Add supporting materials and documentation</p>
                
                <div className="space-y-4">
                  <div>
                    <Label>Demo Video URL (Optional)</Label>
                    <Input 
                      value={assetDetails.demoVideoUrl} 
                      onChange={(e) => setAssetDetails(prev => ({ ...prev, demoVideoUrl: e.target.value }))}
                      placeholder="https://youtube.com/..."
                    />
                  </div>
                  
                  <div>
                    <Label>Whitepaper URL (Optional)</Label>
                    <Input 
                      value={assetDetails.whitepaperUrl} 
                      onChange={(e) => setAssetDetails(prev => ({ ...prev, whitepaperUrl: e.target.value }))}
                      placeholder="https://..."
                    />
                  </div>
                  
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label>Training Data Information</Label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => openJoyAssistant('trainingData')}
                        disabled={!nftData.name}
                      >
                        <Bot className="w-3 h-3 mr-2" />
                        Joy Assistant
                      </Button>
                    </div>
                    <Textarea 
                      value={assetDetails.trainingDataInfo} 
                      onChange={(e) => setAssetDetails(prev => ({ ...prev, trainingDataInfo: e.target.value }))}
                      placeholder="Describe the training data used..."
                      rows={5}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Use Joy Assistant for AI-written training data documentation
                    </p>
                  </div>
                  
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label>Use Cases</Label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => openJoyAssistant('useCases')}
                        disabled={!nftData.name}
                      >
                        <Bot className="w-3 h-3 mr-2" />
                        Joy Assistant
                      </Button>
                    </div>
                    <Textarea 
                      value={assetDetails.useCases} 
                      onChange={(e) => setAssetDetails(prev => ({ ...prev, useCases: e.target.value }))}
                      placeholder="List potential use cases..."
                      rows={5}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Use Joy Assistant for AI-suggested use cases
                    </p>
                  </div>
                  
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label>Limitations</Label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => openJoyAssistant('limitations')}
                        disabled={!nftData.name}
                      >
                        <Bot className="w-3 h-3 mr-2" />
                        Joy Assistant
                      </Button>
                    </div>
                    <Textarea 
                      value={assetDetails.limitations} 
                      onChange={(e) => setAssetDetails(prev => ({ ...prev, limitations: e.target.value }))}
                      placeholder="Known limitations..."
                      rows={5}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Use Joy Assistant for an honest assessment of limitations
                    </p>
                  </div>
                  
                  <div>
                    <Label>Additional Tags (comma-separated)</Label>
                    <Input 
                      value={assetDetails.additionalTags} 
                      onChange={(e) => setAssetDetails(prev => ({ ...prev, additionalTags: e.target.value }))}
                      placeholder="nlp, gpt, fine-tuned, support"
                    />
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <Label>GitHub URL (Optional)</Label>
                      <Input 
                        value={assetDetails.githubUrl} 
                        onChange={(e) => setAssetDetails(prev => ({ ...prev, githubUrl: e.target.value }))}
                        placeholder="https://github.com/..."
                      />
                    </div>
                    <div>
                      <Label>HuggingFace URL (Optional)</Label>
                      <Input 
                        value={assetDetails.huggingfaceUrl} 
                        onChange={(e) => setAssetDetails(prev => ({ ...prev, huggingfaceUrl: e.target.value }))}
                        placeholder="https://huggingface.co/..."
                      />
                    </div>
                    <div>
                      <Label>Website URL (Optional)</Label>
                      <Input 
                        value={assetDetails.websiteUrl} 
                        onChange={(e) => setAssetDetails(prev => ({ ...prev, websiteUrl: e.target.value }))}
                        placeholder="https://..."
                      />
                    </div>
                  </div>
                </div>
                
                <div className="flex gap-2">
                  <Button variant="outline" onClick={prevStep}>← Back</Button>
                  <Button onClick={() => { 
                    markStepComplete(12);
                    toast({ title: 'Success', description: 'Asset details saved!' });
                    nextStep(); 
                  }}>
                    Next → Mint NFT
                  </Button>
                </div>
              </div>
            )}

            {/* Step 13: Final Review */}
            {currentStep === 13 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-muted-foreground">Review your asset before listing on marketplace</p>
                  <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded-full">
                    Final Review
                  </span>
                </div>
                
                {/* Store Card Preview */}
                <Card className="border-2 border-primary/20">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Store className="w-5 h-5" />
                      Store Card Preview
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Asset Image - show generated image or IPFS image */}
                    {(nftData.imageGatewayUrl || nftData.imageIPFS) && (
                      <div className="aspect-square max-w-xs mx-auto rounded-lg overflow-hidden bg-muted">
                        <img 
                          src={nftData.imageGatewayUrl || `https://gateway.pinata.cloud/ipfs/${nftData.imageIPFS}`}
                          alt={nftData.name}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )}
                    
                    {/* Asset Info */}
                    <div className="space-y-3">
                      <div>
                        <h3 className="text-2xl font-bold">{nftData.name}</h3>
                        <Collapsible>
                          <CollapsibleTrigger className="text-sm text-left w-full mt-1">
                            <p className="text-muted-foreground">
                              {nftData.description && nftData.description.length > 600 
                                ? `${nftData.description.slice(0, 600)}...` 
                                : nftData.description}
                            </p>
                            {nftData.description && nftData.description.length > 600 && (
                              <span className="text-primary hover:underline text-xs mt-1 block">Click to expand</span>
                            )}
                          </CollapsibleTrigger>
                          {nftData.description && nftData.description.length > 600 && (
                            <CollapsibleContent className="text-sm text-muted-foreground mt-2">
                              {nftData.description.slice(600)}
                            </CollapsibleContent>
                          )}
                        </Collapsible>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                        <div>
                          <p className="text-xs text-muted-foreground">Type</p>
                          <p className="font-semibold capitalize">{nftData.modelType}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Version</p>
                          <p className="font-semibold">{nftData.version}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Price</p>
                          <p className="font-semibold">{pricingData.initialPrice} MATIC</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Royalty</p>
                          <p className="font-semibold">{pricingData.royaltyPercent}%</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">License</p>
                          <p className="font-semibold capitalize">{licenseData.licenseType}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Quality Score</p>
                          <p className="font-semibold">{nftData.qualityScore}/100</p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                
                {/* Asset Details Summary */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <CheckCircle className="w-5 h-5" />
                      Complete Asset Details
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4 text-sm">
                    {/* Basic Info Grid */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-muted-foreground">Token ID</p>
                        <p className="font-mono font-semibold">{nftData.tokenId || 'Pending'}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Contract</p>
                        <p className="font-mono text-xs">{contractData.address?.slice(0, 10)}...</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Total Chunks</p>
                        <p className="font-semibold">{chunkData.totalChunks}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Encryption</p>
                        <p className="font-semibold capitalize">{encryptionConfig.encryptionLevel}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Metadata CID</p>
                        <p className="font-mono text-xs">{nftData.metadataCID?.slice(0, 10)}...</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">License CID</p>
                        <p className="font-mono text-xs">{licenseData.cid?.slice(0, 10)}...</p>
                      </div>
                    </div>
                    
                    {/* URLs Section */}
                    {(assetDetails.demoVideoUrl || assetDetails.whitepaperUrl || assetDetails.githubUrl || assetDetails.huggingfaceUrl || assetDetails.websiteUrl) && (
                      <div className="pt-4 border-t">
                        <p className="font-semibold mb-2">Links & Documentation</p>
                        <div className="space-y-2">
                          {assetDetails.demoVideoUrl && (
                            <div>
                              <span className="text-muted-foreground text-xs">Demo Video:</span>
                              <a href={assetDetails.demoVideoUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline block text-xs truncate">
                                {assetDetails.demoVideoUrl}
                              </a>
                            </div>
                          )}
                          {assetDetails.whitepaperUrl && (
                            <div>
                              <span className="text-muted-foreground text-xs">Whitepaper:</span>
                              <a href={assetDetails.whitepaperUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline block text-xs truncate">
                                {assetDetails.whitepaperUrl}
                              </a>
                            </div>
                          )}
                          {assetDetails.githubUrl && (
                            <div>
                              <span className="text-muted-foreground text-xs">GitHub:</span>
                              <a href={assetDetails.githubUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline block text-xs truncate">
                                {assetDetails.githubUrl}
                              </a>
                            </div>
                          )}
                          {assetDetails.huggingfaceUrl && (
                            <div>
                              <span className="text-muted-foreground text-xs">HuggingFace:</span>
                              <a href={assetDetails.huggingfaceUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline block text-xs truncate">
                                {assetDetails.huggingfaceUrl}
                              </a>
                            </div>
                          )}
                          {assetDetails.websiteUrl && (
                            <div>
                              <span className="text-muted-foreground text-xs">Website:</span>
                              <a href={assetDetails.websiteUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline block text-xs truncate">
                                {assetDetails.websiteUrl}
                              </a>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    
                    {/* Training Data */}
                    {assetDetails.trainingDataInfo && (
                      <div className="pt-4 border-t">
                        <p className="font-semibold mb-2">Training Data Information</p>
                        <Collapsible>
                          <CollapsibleTrigger className="text-xs text-left w-full">
                            <p className="text-muted-foreground">
                              {assetDetails.trainingDataInfo.length > 800 
                                ? `${assetDetails.trainingDataInfo.slice(0, 800)}...` 
                                : assetDetails.trainingDataInfo}
                            </p>
                            {assetDetails.trainingDataInfo.length > 800 && (
                              <span className="text-primary hover:underline mt-1 block">Click to expand</span>
                            )}
                          </CollapsibleTrigger>
                          {assetDetails.trainingDataInfo.length > 800 && (
                            <CollapsibleContent className="text-xs text-muted-foreground mt-2">
                              {assetDetails.trainingDataInfo.slice(800)}
                            </CollapsibleContent>
                          )}
                        </Collapsible>
                      </div>
                    )}
                    
                    {/* Use Cases */}
                    {assetDetails.useCases && (
                      <div className="pt-4 border-t">
                        <p className="font-semibold mb-2">Use Cases</p>
                        <Collapsible>
                          <CollapsibleTrigger className="text-xs text-left w-full">
                            <p className="text-muted-foreground">
                              {assetDetails.useCases.length > 800 
                                ? `${assetDetails.useCases.slice(0, 800)}...` 
                                : assetDetails.useCases}
                            </p>
                            {assetDetails.useCases.length > 800 && (
                              <span className="text-primary hover:underline mt-1 block">Click to expand</span>
                            )}
                          </CollapsibleTrigger>
                          {assetDetails.useCases.length > 800 && (
                            <CollapsibleContent className="text-xs text-muted-foreground mt-2">
                              {assetDetails.useCases.slice(800)}
                            </CollapsibleContent>
                          )}
                        </Collapsible>
                      </div>
                    )}
                    
                    {/* Limitations */}
                    {assetDetails.limitations && (
                      <div className="pt-4 border-t">
                        <p className="font-semibold mb-2">Limitations</p>
                        <Collapsible>
                          <CollapsibleTrigger className="text-xs text-left w-full">
                            <p className="text-muted-foreground">
                              {assetDetails.limitations.length > 800 
                                ? `${assetDetails.limitations.slice(0, 800)}...` 
                                : assetDetails.limitations}
                            </p>
                            {assetDetails.limitations.length > 800 && (
                              <span className="text-primary hover:underline mt-1 block">Click to expand</span>
                            )}
                          </CollapsibleTrigger>
                          {assetDetails.limitations.length > 800 && (
                            <CollapsibleContent className="text-xs text-muted-foreground mt-2">
                              {assetDetails.limitations.slice(800)}
                            </CollapsibleContent>
                          )}
                        </Collapsible>
                      </div>
                    )}
                    
                    {/* Additional Tags */}
                    {assetDetails.additionalTags && (
                      <div className="pt-4 border-t">
                        <p className="font-semibold mb-2">Additional Tags</p>
                        <div className="flex flex-wrap gap-2">
                          {assetDetails.additionalTags.split(',').map((tag, i) => (
                            <span key={i} className="bg-primary/10 text-primary px-2 py-1 rounded-full text-xs">
                              {tag.trim()}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
                
                <div className="p-4 bg-blue-500/10 rounded-lg border border-blue-500/30">
                  <p className="text-sm">
                    <strong>Review complete?</strong> Click Next to configure marketplace settings and list your asset.
                  </p>
                </div>
                
                <div className="flex gap-2">
                  <Button variant="outline" onClick={prevStep}>← Back</Button>
                  <Button onClick={confirmReview} className="flex-1">
                    Next →
                  </Button>
                </div>
              </div>
            )}

            {/* Step 14: List on Marketplace */}
            {currentStep === 14 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-muted-foreground">Configure marketplace listing settings</p>
                  <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded-full">
                    Final Step • 🏪 List on Marketplace
                  </span>
                </div>
                
                <div className="space-y-4">
                  <div>
                    <Label>Listing Type</Label>
                    <Select value={storeSettings.listingType} onValueChange={(val) => setStoreSettings(prev => ({ ...prev, listingType: val }))}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sale">🛒 For Sale</SelectItem>
                        <SelectItem value="lease">📅 For Lease</SelectItem>
                        <SelectItem value="both">💼 Sale & Lease</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  {(storeSettings.listingType === 'lease' || storeSettings.listingType === 'both') && (
                    <>
                      <div>
                        <Label>Listing Duration</Label>
                        <Select 
                          value={String(storeSettings.leaseDuration)} 
                          onValueChange={(val) => setStoreSettings(prev => ({ ...prev, leaseDuration: parseInt(val) }))}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="7">📅 7 Days</SelectItem>
                            <SelectItem value="30">📅 30 Days</SelectItem>
                            <SelectItem value="60">📅 60 Days</SelectItem>
                            <SelectItem value="90">📅 90 Days</SelectItem>
                            <SelectItem value="180">📅 6 Months</SelectItem>
                            <SelectItem value="365">📅 1 Year</SelectItem>
                            <SelectItem value="0">♾️ Forever (No Expiry)</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground mt-1">
                          {storeSettings.leaseDuration === 0 
                            ? 'Listing will remain active indefinitely until manually cancelled' 
                            : `Listing expires after ${storeSettings.leaseDuration} days`}
                        </p>
                      </div>
                      <div>
                        <Label>Lease Price (MATIC/day)</Label>
                        <Input 
                          type="number" 
                          value={storeSettings.leasePrice} 
                          onChange={(e) => setStoreSettings(prev => ({ ...prev, leasePrice: parseFloat(e.target.value) }))}
                        />
                      </div>
                    </>
                  )}
                  
                  <div className="space-y-3 pt-4 border-t">
                    <Label className="text-sm font-semibold">Display Options</Label>
                    {[
                      { key: 'showTechnicalDetails', label: 'Show technical details', description: 'Display technical specifications' },
                      { key: 'showDocumentation', label: 'Show documentation links', description: 'Include links to documentation' },
                      { key: 'showPerformanceMetrics', label: 'Show performance metrics', description: 'Display performance benchmarks' },
                    ].map(({ key, label, description }) => (
                      <div key={key} className="flex items-start gap-2">
                        <Checkbox 
                          checked={storeSettings[key as keyof typeof storeSettings] as boolean}
                          onCheckedChange={(checked) => setStoreSettings(prev => ({ ...prev, [key]: checked }))}
                          className="mt-1"
                        />
                        <div className="flex-1">
                          <Label className="font-normal cursor-pointer">{label}</Label>
                          <p className="text-xs text-muted-foreground">{description}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  
                  <div className="space-y-3 pt-4 border-t">
                    <Label className="text-sm font-semibold">Featured Placement</Label>
                    <p className="text-xs text-muted-foreground">Add your asset to special collections on the marketplace</p>
                    
                    <div className="flex items-start gap-2">
                      <Checkbox 
                        checked={storeSettings.highlightFeatured}
                        onCheckedChange={(checked) => setStoreSettings(prev => ({ ...prev, highlightFeatured: !!checked }))}
                        className="mt-1"
                      />
                      <div className="flex-1">
                        <Label className="font-normal cursor-pointer flex items-center gap-1">
                          ⭐ Highlight as Featured (Premium)
                        </Label>
                        <p className="text-xs text-muted-foreground">Show prominent featured badge on listing card</p>
                      </div>
                    </div>
                    
                    <div className="flex items-start gap-2">
                      <Checkbox 
                        checked={storeSettings.addToHotDeals}
                        onCheckedChange={(checked) => setStoreSettings(prev => ({ ...prev, addToHotDeals: !!checked }))}
                        className="mt-1"
                      />
                      <div className="flex-1">
                        <Label className="font-normal cursor-pointer flex items-center gap-1">
                          🔥 Add to Hot Deals
                        </Label>
                        <p className="text-xs text-muted-foreground">Feature in the Hot Deals section for limited-time offers</p>
                      </div>
                    </div>
                    
                    <div className="flex items-start gap-2">
                      <Checkbox 
                        checked={storeSettings.addToTopPicks}
                        onCheckedChange={(checked) => setStoreSettings(prev => ({ ...prev, addToTopPicks: !!checked }))}
                        className="mt-1"
                      />
                      <div className="flex-1">
                        <Label className="font-normal cursor-pointer flex items-center gap-1">
                          ⭐ Add to Top Picks
                        </Label>
                        <p className="text-xs text-muted-foreground">Feature in the Top Picks section for quality assets</p>
                      </div>
                    </div>
                  </div>
                  
                  {/* Store Card Preview Generator */}
                  <div className="pt-4 border-t">
                    <Button 
                      onClick={() => setShowStorePreview(!showStorePreview)} 
                      variant="outline"
                      className="w-full"
                    >
                      <Sparkles className="w-4 h-4 mr-2" />
                      🎨 {showStorePreview ? 'Hide' : 'Generate'} Complete Store Card Preview
                    </Button>
                  </div>
                </div>
                
                {/* Store Card Preview */}
                {showStorePreview && (
                  <Card className="border-2 border-primary/30 bg-gradient-to-br from-primary/5 to-primary/10">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Store className="w-5 h-5" />
                        Store Listing Preview
                      </CardTitle>
                      <p className="text-sm text-muted-foreground">This is how your asset will appear on the marketplace</p>
                    </CardHeader>
                    <CardContent>
                      {/* Marketplace Card */}
                      <div className="bg-background rounded-lg border shadow-lg overflow-hidden max-w-sm mx-auto">
                        {/* Featured Badge */}
                        {storeSettings.highlightFeatured && (
                          <div className="bg-gradient-to-r from-yellow-500 to-orange-500 text-white px-3 py-1 text-xs font-semibold">
                            ⭐ FEATURED
                          </div>
                        )}
                        
                        {/* Asset Image */}
                        <div className="relative aspect-video bg-muted">
                          {nftData.imageIPFS ? (
                            <img 
                              src={`https://gateway.pinata.cloud/ipfs/${nftData.imageIPFS}`}
                              alt={nftData.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="flex items-center justify-center h-full">
                              <div className="text-6xl">🤖</div>
                            </div>
                          )}
                        </div>
                        
                        {/* Card Content */}
                        <div className="p-4 space-y-3">
                          <div>
                            <h3 className="font-bold text-lg truncate">{nftData.name}</h3>
                            <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                              {nftData.description}
                            </p>
                          </div>
                          
                          {/* Price & Stats Grid */}
                          <div className="grid grid-cols-2 gap-2 text-sm">
                            <div className="p-2 bg-muted rounded">
                              <p className="text-xs text-muted-foreground">Price</p>
                              <p className="font-bold">{pricingData.initialPrice} MATIC</p>
                            </div>
                            <div className="p-2 bg-muted rounded">
                              <p className="text-xs text-muted-foreground">Supply</p>
                              <p className="font-bold">{mintSupply}</p>
                            </div>
                            <div className="p-2 bg-muted rounded">
                              <p className="text-xs text-muted-foreground">Royalty</p>
                              <p className="font-bold">{pricingData.royaltyPercent}%</p>
                            </div>
                            <div className="p-2 bg-muted rounded">
                              <p className="text-xs text-muted-foreground">Type</p>
                              <p className="font-bold capitalize">{storeSettings.listingType}</p>
                            </div>
                          </div>
                          
                          {/* Technical Details */}
                          {storeSettings.showTechnicalDetails && (
                            <div className="pt-2 border-t">
                              <p className="text-xs font-semibold mb-1">🔧 Technical Details:</p>
                              <div className="space-y-0.5 text-xs text-muted-foreground">
                                <p>Model Type: {nftData.modelType}</p>
                                <p>Size: {(modelData.file?.size / (1024 * 1024)).toFixed(2)} MB</p>
                                <p>Network: Polygon</p>
                                <p>Quality: {nftData.qualityScore}/100</p>
                              </div>
                            </div>
                          )}
                          
                          {/* Action Buttons */}
                          <div className="flex gap-2 pt-2">
                            <Button className="flex-1" size="sm">
                              🛒 Buy Now
                            </Button>
                            <Button 
                              variant="outline" 
                              size="sm" 
                              className="flex-1"
                              onClick={() => setShowDetailsModal(true)}
                            >
                              👁️ View Details
                            </Button>
                          </div>
                        </div>
                      </div>
                      
                      {/* Details Page Preview */}
                      <div className="mt-6 p-4 bg-muted/50 rounded-lg">
                        <h4 className="font-semibold mb-3 flex items-center gap-2">
                          <FileText className="w-4 h-4" />
                          Full Details Page Preview
                        </h4>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Contract:</span>
                            <span className="font-mono text-xs">{contractData.address?.slice(0, 10)}...</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Token ID:</span>
                            <span className="font-semibold">{nftData.tokenId || 'Pending'}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Total Chunks:</span>
                            <span className="font-semibold">{chunkData.totalChunks}</span>
                          </div>
                          {storeSettings.showDocumentation && assetDetails.githubUrl && (
                            <div className="pt-2 border-t">
                              <p className="text-xs text-muted-foreground mb-1">📚 Documentation:</p>
                              <a href={assetDetails.githubUrl} className="text-primary hover:underline text-xs">
                                GitHub Repository →
                              </a>
                            </div>
                          )}
                          {storeSettings.showPerformanceMetrics && (
                            <div className="pt-2 border-t">
                              <p className="text-xs text-muted-foreground mb-1">⚡ Performance:</p>
                              <p className="text-xs">Quality Score: {nftData.qualityScore}/100</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}
                
                <div className="p-6 bg-green-500/10 rounded-lg border border-green-500/30">
                  <h3 className="text-xl font-semibold mb-2 text-green-600">🎉 Asset Creation Complete!</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Your asset has been successfully created and is ready to be listed on the marketplace.
                  </p>
                  <div className="space-y-2 text-sm">
                    <div><strong>Asset Name:</strong> {nftData.name}</div>
                    <div><strong>Token ID:</strong> {nftData.tokenId || 'Pending'}</div>
                    <div><strong>Contract:</strong> {contractData.address || 'Pending'}</div>
                    <div><strong>Quality Score:</strong> {nftData.qualityScore}/100</div>
                  </div>
                  {/* Celestia DA Receipt Badges */}
                  {celestiaDA.receipts.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-green-500/20">
                      <p className="text-xs font-medium text-muted-foreground mb-2">Data Availability Anchors:</p>
                      <CelestiaAnchorSummary receipts={celestiaDA.receipts} />
                    </div>
                  )}
                </div>

                {/* Celestia DA Anchoring Status Card */}
                <CelestiaAnchoringCard
                  isAvailable={celestiaDA.isNodeAvailable}
                  isSubmitting={celestiaDA.isSubmitting}
                  receipts={celestiaDA.receipts}
                  lastReceipt={celestiaDA.lastReceipt}
                  error={celestiaDA.error}
                  nodeInfo={celestiaDA.nodeInfo}
                />
                
                {renderLogDisplay(logs[14], '3-5 minutes')}
                
                <div className="flex gap-2">
                  <Button variant="outline" onClick={prevStep}>← Back</Button>
                  <Button onClick={finalizeCreation} disabled={processing || !nftData.tokenId} className="flex-1 bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-600 hover:to-rose-600">
                    {processing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Store className="w-4 h-4 mr-2" />}
                    🏪 List on Marketplace & Complete
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Detailed NFT Preview Modal - Matches Step 13 */}
      <Dialog open={showDetailsModal} onOpenChange={setShowDetailsModal}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Full NFT Details Preview
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-6">
            {/* NFT Details Card */}
            <NFTDetailsCard
              nftData={nftData}
              contractData={contractData}
              pricingData={{ ...pricingData, currency: pricingData?.currency || 'MATIC' }}
              licenseData={licenseData}
              chunkData={chunkData}
              encryptionConfig={encryptionConfig}
            />

            {/* Additional Details from Step 13 */}
            <div className="p-4 bg-muted/50 rounded-lg">
              <h4 className="font-semibold mb-3 flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Additional Information
              </h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Contract:</span>
                  <span className="font-mono text-xs">{contractData.address?.slice(0, 10)}...</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Token ID:</span>
                  <span className="font-semibold">{nftData.tokenId || 'Pending'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Chunks:</span>
                  <span className="font-semibold">{chunkData.totalChunks}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">File Size:</span>
                  <span className="font-semibold">{(modelData.file?.size / (1024 * 1024)).toFixed(2)} MB</span>
                </div>
                {storeSettings.showDocumentation && assetDetails.githubUrl && (
                  <div className="pt-2 border-t">
                    <p className="text-xs text-muted-foreground mb-1">📚 Documentation:</p>
                    <a href={assetDetails.githubUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline text-xs">
                      GitHub Repository →
                    </a>
                  </div>
                )}
                {assetDetails.demoVideoUrl && (
                  <div className="pt-2 border-t">
                    <p className="text-xs text-muted-foreground mb-1">🎥 Demo:</p>
                    <a href={assetDetails.demoVideoUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline text-xs">
                      View Demo Video →
                    </a>
                  </div>
                )}
                {storeSettings.showPerformanceMetrics && (
                  <div className="pt-2 border-t">
                    <p className="text-xs text-muted-foreground mb-1">⚡ Performance:</p>
                    <p className="text-xs">Quality Score: {nftData.qualityScore}/100</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Joy Asset Assistant Chat */}
      <JoyAssetAssistantChat
        isOpen={showAssetAssistant}
        onClose={() => setShowAssetAssistant(false)}
        onUseResponse={handleAssistantResponse}
        context={assistantContext}
        assetName={nftData.name}
        assetType={nftData.modelType}
        assetDescription={nftData.description}
      />
    </div>
  );
};