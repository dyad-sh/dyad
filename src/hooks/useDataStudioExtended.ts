/**
 * Data Studio Extended Hooks
 * TanStack Query hooks for all expanded Data Studio operations
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getDataStudioExtendedClient } from "@/ipc/data_studio_extended_client";
import type {
  SearchQuery,
  ContentPolicy,
  PrivacyRule,
} from "@/ipc/data_studio_extended_client";

const client = getDataStudioExtendedClient();

// ============================================================================
// Query Keys
// ============================================================================

export const dataStudioKeys = {
  all: ["dataStudio"] as const,
  
  // Core
  statistics: (datasetId: string) => [...dataStudioKeys.all, "statistics", datasetId] as const,
  backups: () => [...dataStudioKeys.all, "backups"] as const,
  duplicates: (datasetId: string) => [...dataStudioKeys.all, "duplicates", datasetId] as const,
  
  // Vault
  vault: () => [...dataStudioKeys.all, "vault"] as const,
  vaultIdentity: () => [...dataStudioKeys.vault(), "identity"] as const,
  vaultPeers: () => [...dataStudioKeys.vault(), "peers"] as const,
  
  // Media
  media: () => [...dataStudioKeys.all, "media"] as const,
  mediaInfo: (filePath: string) => [...dataStudioKeys.media(), "info", filePath] as const,
  mediaTools: () => [...dataStudioKeys.media(), "tools"] as const,
  
  // Quality
  quality: () => [...dataStudioKeys.all, "quality"] as const,
  qualityStats: (datasetId: string) => [...dataStudioKeys.quality(), "stats", datasetId] as const,
  exactDuplicates: (datasetId: string) => [...dataStudioKeys.quality(), "exactDuplicates", datasetId] as const,
  similarImages: (datasetId: string) => [...dataStudioKeys.quality(), "similarImages", datasetId] as const,
  
  // Policy
  policies: () => [...dataStudioKeys.all, "policies"] as const,
  policy: (policyId: string) => [...dataStudioKeys.policies(), policyId] as const,
  licenses: () => [...dataStudioKeys.all, "licenses"] as const,
  license: (licenseId: string) => [...dataStudioKeys.licenses(), licenseId] as const,
  privacyRules: () => [...dataStudioKeys.all, "privacyRules"] as const,
  violations: (args?: { datasetId?: string; policyId?: string }) => 
    [...dataStudioKeys.all, "violations", args] as const,
  
  // Search
  search: () => [...dataStudioKeys.all, "search"] as const,
  searchResults: (query: SearchQuery) => [...dataStudioKeys.search(), "results", query] as const,
  searchSuggestions: (prefix: string) => [...dataStudioKeys.search(), "suggestions", prefix] as const,
  searchFacets: (query?: string) => [...dataStudioKeys.search(), "facets", query] as const,
  searchIndexStats: () => [...dataStudioKeys.search(), "indexStats"] as const,
  searchAnalytics: () => [...dataStudioKeys.search(), "analytics"] as const,
  savedSearches: () => [...dataStudioKeys.search(), "saved"] as const,
};

// ============================================================================
// Core Data Hooks
// ============================================================================

export function useDatasetStatistics(datasetId: string) {
  return useQuery({
    queryKey: dataStudioKeys.statistics(datasetId),
    queryFn: () => client.getStatistics(datasetId),
    enabled: !!datasetId,
  });
}

export function useBackups() {
  return useQuery({
    queryKey: dataStudioKeys.backups(),
    queryFn: () => client.listBackups(),
  });
}

export function useDatasetDuplicates(datasetId: string) {
  return useQuery({
    queryKey: dataStudioKeys.duplicates(datasetId),
    queryFn: () => client.findDuplicates(datasetId),
    enabled: !!datasetId,
  });
}

export function useBatchImport() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (args: Parameters<typeof client.batchImportDirectory>[0]) =>
      client.batchImportDirectory(args),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: dataStudioKeys.statistics(variables.datasetId) });
    },
  });
}

export function useImportJsonl() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (args: Parameters<typeof client.importJsonl>[0]) =>
      client.importJsonl(args),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: dataStudioKeys.statistics(variables.datasetId) });
    },
  });
}

export function useImportCsv() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (args: Parameters<typeof client.importCsv>[0]) =>
      client.importCsv(args),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: dataStudioKeys.statistics(variables.datasetId) });
    },
  });
}

export function useExportDataset() {
  return useMutation({
    mutationFn: (args: Parameters<typeof client.exportToFormat>[0]) =>
      client.exportToFormat(args),
  });
}

export function useValidateDataset() {
  return useMutation({
    mutationFn: (datasetId: string) => client.validateDataset(datasetId),
  });
}

export function useRemoveDuplicates() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (args: Parameters<typeof client.removeDuplicates>[0]) =>
      client.removeDuplicates(args),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: dataStudioKeys.duplicates(variables.datasetId) });
      queryClient.invalidateQueries({ queryKey: dataStudioKeys.statistics(variables.datasetId) });
    },
  });
}

export function useCreateBackup() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (args?: Parameters<typeof client.createBackup>[0]) =>
      client.createBackup(args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: dataStudioKeys.backups() });
    },
  });
}

export function useRestoreBackup() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (backupPath: string) => client.restoreBackup(backupPath),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: dataStudioKeys.all });
    },
  });
}

// ============================================================================
// Vault Hooks
// ============================================================================

export function useVaultIdentity() {
  return useQuery({
    queryKey: dataStudioKeys.vaultIdentity(),
    queryFn: () => client.vaultGetIdentity(),
    retry: false, // Don't retry if vault is locked
  });
}

export function useVaultPeers() {
  return useQuery({
    queryKey: dataStudioKeys.vaultPeers(),
    queryFn: () => client.vaultListPeers(),
  });
}

export function useVaultInitialize() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (passphrase: string) => client.vaultInitialize(passphrase),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: dataStudioKeys.vault() });
    },
  });
}

export function useVaultUnlock() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (passphrase: string) => client.vaultUnlock(passphrase),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: dataStudioKeys.vault() });
    },
  });
}

export function useVaultLock() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: () => client.vaultLock(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: dataStudioKeys.vault() });
    },
  });
}

export function useVaultSign() {
  return useMutation({
    mutationFn: (data: string) => client.vaultSign(data),
  });
}

export function useVaultAddPeer() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (args: Parameters<typeof client.vaultAddPeer>[0]) =>
      client.vaultAddPeer(args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: dataStudioKeys.vaultPeers() });
    },
  });
}

export function useVaultStoreSecret() {
  return useMutation({
    mutationFn: (args: Parameters<typeof client.vaultStoreSecret>[0]) =>
      client.vaultStoreSecret(args),
  });
}

export function useVaultGetSecret() {
  return useMutation({
    mutationFn: (key: string) => client.vaultGetSecret(key),
  });
}

// ============================================================================
// Media Pipeline Hooks
// ============================================================================

export function useMediaTools() {
  return useQuery({
    queryKey: dataStudioKeys.mediaTools(),
    queryFn: () => client.mediaCheckTools(),
    staleTime: Infinity, // Tools don't change during session
  });
}

export function useMediaInfo(filePath: string) {
  return useQuery({
    queryKey: dataStudioKeys.mediaInfo(filePath),
    queryFn: () => client.mediaGetInfo(filePath),
    enabled: !!filePath,
  });
}

export function useProcessImage() {
  return useMutation({
    mutationFn: (args: Parameters<typeof client.mediaProcessImage>[0]) =>
      client.mediaProcessImage(args),
  });
}

export function useGenerateThumbnail() {
  return useMutation({
    mutationFn: (args: Parameters<typeof client.mediaGenerateThumbnail>[0]) =>
      client.mediaGenerateThumbnail(args),
  });
}

export function useProcessAudio() {
  return useMutation({
    mutationFn: (args: Parameters<typeof client.mediaProcessAudio>[0]) =>
      client.mediaProcessAudio(args),
  });
}

export function useProcessVideo() {
  return useMutation({
    mutationFn: (args: Parameters<typeof client.mediaProcessVideo>[0]) =>
      client.mediaProcessVideo(args),
  });
}

export function useExtractFrames() {
  return useMutation({
    mutationFn: (args: Parameters<typeof client.mediaExtractFrames>[0]) =>
      client.mediaExtractFrames(args),
  });
}

export function useExtractWaveform() {
  return useMutation({
    mutationFn: (args: Parameters<typeof client.mediaExtractWaveform>[0]) =>
      client.mediaExtractWaveform(args),
  });
}

// ============================================================================
// Quality Analysis Hooks
// ============================================================================

export function useQualityStatistics(datasetId: string) {
  return useQuery({
    queryKey: dataStudioKeys.qualityStats(datasetId),
    queryFn: () => client.qualityGetStatistics(datasetId),
    enabled: !!datasetId,
  });
}

export function useExactDuplicates(datasetId: string) {
  return useQuery({
    queryKey: dataStudioKeys.exactDuplicates(datasetId),
    queryFn: () => client.qualityFindExactDuplicates(datasetId),
    enabled: !!datasetId,
  });
}

export function useSimilarImages(datasetId: string, threshold?: number) {
  return useQuery({
    queryKey: dataStudioKeys.similarImages(datasetId),
    queryFn: () => client.qualityFindSimilarImages({ datasetId, threshold }),
    enabled: !!datasetId,
  });
}

export function useAnalyzeImage() {
  return useMutation({
    mutationFn: (args: Parameters<typeof client.qualityAnalyzeImage>[0]) =>
      client.qualityAnalyzeImage(args),
  });
}

export function useAnalyzeText() {
  return useMutation({
    mutationFn: (args: Parameters<typeof client.qualityAnalyzeText>[0]) =>
      client.qualityAnalyzeText(args),
  });
}

export function useBatchQualityAnalysis() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (args: Parameters<typeof client.qualityBatchAnalyze>[0]) =>
      client.qualityBatchAnalyze(args),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: dataStudioKeys.qualityStats(variables.datasetId) });
    },
  });
}

export function useQualityFilter() {
  return useMutation({
    mutationFn: (args: Parameters<typeof client.qualityFilterItems>[0]) =>
      client.qualityFilterItems(args),
  });
}

// ============================================================================
// Policy Engine Hooks
// ============================================================================

export function usePolicies() {
  return useQuery({
    queryKey: dataStudioKeys.policies(),
    queryFn: () => client.policyList(),
  });
}

export function usePolicy(policyId: string) {
  return useQuery({
    queryKey: dataStudioKeys.policy(policyId),
    queryFn: () => client.policyGet(policyId),
    enabled: !!policyId,
  });
}

export function useCreatePolicy() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (policy: Omit<ContentPolicy, "id" | "createdAt" | "updatedAt">) =>
      client.policyCreate(policy),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: dataStudioKeys.policies() });
    },
  });
}

export function useUpdatePolicy() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ policyId, updates }: { policyId: string; updates: Partial<ContentPolicy> }) =>
      client.policyUpdate(policyId, updates),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: dataStudioKeys.policy(variables.policyId) });
      queryClient.invalidateQueries({ queryKey: dataStudioKeys.policies() });
    },
  });
}

export function useDeletePolicy() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (policyId: string) => client.policyDelete(policyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: dataStudioKeys.policies() });
    },
  });
}

export function useScanDatasetPolicy() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (datasetId: string) => client.policyScanDataset(datasetId),
    onSuccess: (_, datasetId) => {
      queryClient.invalidateQueries({ queryKey: dataStudioKeys.violations({ datasetId }) });
    },
  });
}

export function useLicenses() {
  return useQuery({
    queryKey: dataStudioKeys.licenses(),
    queryFn: () => client.policyListLicenses(),
    staleTime: Infinity, // Licenses don't change often
  });
}

export function useLicense(licenseId: string) {
  return useQuery({
    queryKey: dataStudioKeys.license(licenseId),
    queryFn: () => client.policyGetLicense(licenseId),
    enabled: !!licenseId,
  });
}

export function useValidateLicenseCompatibility() {
  return useMutation({
    mutationFn: (args: Parameters<typeof client.policyValidateLicenseCompatibility>[0]) =>
      client.policyValidateLicenseCompatibility(args),
  });
}

export function usePrivacyRules() {
  return useQuery({
    queryKey: dataStudioKeys.privacyRules(),
    queryFn: () => client.policyListPrivacyRules(),
  });
}

export function useScanPii() {
  return useMutation({
    mutationFn: (text: string) => client.policyScanPii(text),
  });
}

export function useRedactPii() {
  return useMutation({
    mutationFn: (text: string) => client.policyRedactPii(text),
  });
}

export function useScanDatasetPii() {
  return useMutation({
    mutationFn: (datasetId: string) => client.policyScanDatasetPii(datasetId),
  });
}

export function useViolations(args?: { datasetId?: string; policyId?: string; resolved?: boolean }) {
  return useQuery({
    queryKey: dataStudioKeys.violations(args),
    queryFn: () => client.policyListViolations(args),
  });
}

export function useResolveViolation() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ violationId, resolution }: { violationId: string; resolution: string }) =>
      client.policyResolveViolation(violationId, resolution),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: dataStudioKeys.violations() });
    },
  });
}

// ============================================================================
// Full-Text Search Hooks
// ============================================================================

export function useSearch(query: SearchQuery | null) {
  return useQuery({
    queryKey: dataStudioKeys.searchResults(query!),
    queryFn: () => client.searchQuery(query!),
    enabled: !!query?.query,
  });
}

export function useSearchMutation() {
  return useMutation({
    mutationFn: (query: SearchQuery) => client.searchQuery(query),
  });
}

export function useSearchSuggestions(prefix: string) {
  return useQuery({
    queryKey: dataStudioKeys.searchSuggestions(prefix),
    queryFn: () => client.searchSuggestions(prefix),
    enabled: prefix.length >= 2,
  });
}

export function useFuzzySearch() {
  return useMutation({
    mutationFn: (args: Parameters<typeof client.searchFuzzy>[0]) =>
      client.searchFuzzy(args),
  });
}

export function useSearchFacets(query?: string) {
  return useQuery({
    queryKey: dataStudioKeys.searchFacets(query),
    queryFn: () => client.searchGetFacets(query),
  });
}

export function useSearchIndexStats() {
  return useQuery({
    queryKey: dataStudioKeys.searchIndexStats(),
    queryFn: () => client.searchGetIndexStats(),
  });
}

export function useSearchAnalytics() {
  return useQuery({
    queryKey: dataStudioKeys.searchAnalytics(),
    queryFn: () => client.searchGetAnalytics(),
  });
}

export function useSavedSearches() {
  return useQuery({
    queryKey: dataStudioKeys.savedSearches(),
    queryFn: () => client.searchListSaved(),
  });
}

export function useSaveSearch() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (args: { name: string; query: SearchQuery }) =>
      client.searchSave(args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: dataStudioKeys.savedSearches() });
    },
  });
}

export function useDeleteSavedSearch() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (searchId: string) => client.searchDeleteSaved(searchId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: dataStudioKeys.savedSearches() });
    },
  });
}

export function useIndexDataset() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (datasetId: string) => client.searchIndexDataset(datasetId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: dataStudioKeys.searchIndexStats() });
    },
  });
}

export function useRebuildSearchIndex() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: () => client.searchRebuildIndex(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: dataStudioKeys.search() });
    },
  });
}

export function useRecordSearchClick() {
  return useMutation({
    mutationFn: (args: { queryId: string; itemId: string }) =>
      client.searchRecordClick(args),
  });
}

// ============================================================================
// Data Generation Hooks
// ============================================================================

export const generationKeys = {
  all: ["generation"] as const,
  templates: () => [...generationKeys.all, "templates"] as const,
  template: (templateId: string) => [...generationKeys.templates(), templateId] as const,
  jobs: (args?: { status?: string; datasetId?: string }) => 
    [...generationKeys.all, "jobs", args] as const,
  job: (jobId: string) => [...generationKeys.all, "job", jobId] as const,
};

export function useGenerationTemplates() {
  return useQuery({
    queryKey: generationKeys.templates(),
    queryFn: () => client.generationListTemplates(),
  });
}

export function useGenerationTemplate(templateId: string) {
  return useQuery({
    queryKey: generationKeys.template(templateId),
    queryFn: () => client.generationGetTemplate(templateId),
    enabled: !!templateId,
  });
}

export function useSaveGenerationTemplate() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (template: Parameters<typeof client.generationSaveTemplate>[0]) =>
      client.generationSaveTemplate(template),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: generationKeys.templates() });
    },
  });
}

export function useDeleteGenerationTemplate() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (templateId: string) => client.generationDeleteTemplate(templateId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: generationKeys.templates() });
    },
  });
}

export function useGenerateSingle() {
  return useMutation({
    mutationFn: (args: Parameters<typeof client.generationGenerateSingle>[0]) =>
      client.generationGenerateSingle(args),
  });
}

export function useStartGenerationBatch() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (args: Parameters<typeof client.generationStartBatch>[0]) =>
      client.generationStartBatch(args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: generationKeys.jobs() });
    },
  });
}

export function useGenerationJobs(args?: { status?: string; datasetId?: string }) {
  return useQuery({
    queryKey: generationKeys.jobs(args),
    queryFn: () => client.generationListJobs(args),
  });
}

export function useGenerationJob(jobId: string) {
  return useQuery({
    queryKey: generationKeys.job(jobId),
    queryFn: () => client.generationGetJobStatus(jobId),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const status = query.state.data?.job?.status;
      return status === "running" ? 2000 : false;
    },
  });
}

export function useCancelGenerationJob() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (jobId: string) => client.generationCancelJob(jobId),
    onSuccess: (_, jobId) => {
      queryClient.invalidateQueries({ queryKey: generationKeys.job(jobId) });
      queryClient.invalidateQueries({ queryKey: generationKeys.jobs() });
    },
  });
}

export function useAugmentItem() {
  return useMutation({
    mutationFn: (args: Parameters<typeof client.generationAugmentItem>[0]) =>
      client.generationAugmentItem(args),
  });
}

export function useAugmentDataset() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (args: Parameters<typeof client.generationAugmentDataset>[0]) =>
      client.generationAugmentDataset(args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: generationKeys.jobs() });
    },
  });
}

export function useCreateHybridDataset() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (args: Parameters<typeof client.generationCreateHybrid>[0]) =>
      client.generationCreateHybrid(args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: dataStudioKeys.all });
    },
  });
}

export function useGenerateVariables() {
  return useMutation({
    mutationFn: (args: Parameters<typeof client.generationGenerateVariables>[0]) =>
      client.generationGenerateVariables(args),
  });
}

// ============================================================================
// Data Scraping Hooks
// ============================================================================

export const scrapingKeys = {
  all: ["scraping"] as const,
  jobs: (args?: { datasetId?: string; status?: string }) => 
    [...scrapingKeys.all, "jobs", args] as const,
  job: (jobId: string) => [...scrapingKeys.all, "job", jobId] as const,
  sitemap: (url: string) => [...scrapingKeys.all, "sitemap", url] as const,
  feed: (url: string) => [...scrapingKeys.all, "feed", url] as const,
  robots: (url: string) => [...scrapingKeys.all, "robots", url] as const,
};

export function useScrapeUrl() {
  return useMutation({
    mutationFn: (args: Parameters<typeof client.scrapingScrapeUrl>[0]) =>
      client.scrapingScrapeUrl(args),
  });
}

export function useScrapeToDataset() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (args: Parameters<typeof client.scrapingScrapeToDataset>[0]) =>
      client.scrapingScrapeToDataset(args),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ 
        queryKey: dataStudioKeys.statistics(variables.datasetId) 
      });
    },
  });
}

export function useCreateScrapingJob() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (args: Parameters<typeof client.scrapingCreateJob>[0]) =>
      client.scrapingCreateJob(args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: scrapingKeys.jobs() });
    },
  });
}

export function useStartScrapingJob() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (jobId: string) => client.scrapingStartJob(jobId),
    onSuccess: (_, jobId) => {
      queryClient.invalidateQueries({ queryKey: scrapingKeys.job(jobId) });
    },
  });
}

export function usePauseScrapingJob() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (jobId: string) => client.scrapingPauseJob(jobId),
    onSuccess: (_, jobId) => {
      queryClient.invalidateQueries({ queryKey: scrapingKeys.job(jobId) });
    },
  });
}

export function useCancelScrapingJob() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (jobId: string) => client.scrapingCancelJob(jobId),
    onSuccess: (_, jobId) => {
      queryClient.invalidateQueries({ queryKey: scrapingKeys.job(jobId) });
      queryClient.invalidateQueries({ queryKey: scrapingKeys.jobs() });
    },
  });
}

export function useScrapingJobs(args?: { datasetId?: string; status?: string }) {
  return useQuery({
    queryKey: scrapingKeys.jobs(args),
    queryFn: () => client.scrapingListJobs(args),
  });
}

export function useScrapingJob(jobId: string) {
  return useQuery({
    queryKey: scrapingKeys.job(jobId),
    queryFn: () => client.scrapingGetJob(jobId),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const status = query.state.data?.job?.status;
      return status === "running" ? 2000 : false;
    },
  });
}

export function useParseSitemap(sitemapUrl: string) {
  return useQuery({
    queryKey: scrapingKeys.sitemap(sitemapUrl),
    queryFn: () => client.scrapingParseSitemap(sitemapUrl),
    enabled: !!sitemapUrl,
  });
}

export function useParseFeed(feedUrl: string) {
  return useQuery({
    queryKey: scrapingKeys.feed(feedUrl),
    queryFn: () => client.scrapingParseFeed(feedUrl),
    enabled: !!feedUrl,
  });
}

export function useScrapeFeedToDataset() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (args: Parameters<typeof client.scrapingScrapeFeedToDataset>[0]) =>
      client.scrapingScrapeFeedToDataset(args),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ 
        queryKey: dataStudioKeys.statistics(variables.datasetId) 
      });
    },
  });
}

export function useScrapeApi() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (args: Parameters<typeof client.scrapingScrapeApi>[0]) =>
      client.scrapingScrapeApi(args),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ 
        queryKey: dataStudioKeys.statistics(variables.datasetId) 
      });
    },
  });
}

export function useCheckRobots(url: string) {
  return useQuery({
    queryKey: scrapingKeys.robots(url),
    queryFn: () => client.scrapingCheckRobots(url),
    enabled: !!url,
  });
}

export function useExtractUrls() {
  return useMutation({
    mutationFn: (args: Parameters<typeof client.scrapingExtractUrls>[0]) =>
      client.scrapingExtractUrls(args),
  });
}

// ============================================================================
// Data Transformation Hooks
// ============================================================================

export const transformKeys = {
  all: ["transform"] as const,
  templates: () => [...transformKeys.all, "templates"] as const,
  stats: (datasetId: string) => [...transformKeys.all, "stats", datasetId] as const,
};

export function useTransformTemplates() {
  return useQuery({
    queryKey: transformKeys.templates(),
    queryFn: () => client.transformListTemplates(),
  });
}

export function useDatasetTransformStats(datasetId: string) {
  return useQuery({
    queryKey: transformKeys.stats(datasetId),
    queryFn: () => client.transformGetStats(datasetId),
    enabled: !!datasetId,
  });
}

export function useTransformExportDataset() {
  return useMutation({
    mutationFn: (args: Parameters<typeof client.transformExportDataset>[0]) =>
      client.transformExportDataset(args),
  });
}

export function useCreateFolderStructure() {
  return useMutation({
    mutationFn: (args: Parameters<typeof client.transformCreateStructure>[0]) =>
      client.transformCreateStructure(args),
  });
}

export function useConvertFormat() {
  return useMutation({
    mutationFn: (args: Parameters<typeof client.transformConvertFormat>[0]) =>
      client.transformConvertFormat(args),
  });
}

export function useTokenize() {
  return useMutation({
    mutationFn: (args: Parameters<typeof client.transformTokenize>[0]) =>
      client.transformTokenize(args),
  });
}

export function useBuildVocab() {
  return useMutation({
    mutationFn: (args: Parameters<typeof client.transformBuildVocab>[0]) =>
      client.transformBuildVocab(args),
  });
}

export function usePrepareTraining() {
  return useMutation({
    mutationFn: (args: Parameters<typeof client.transformPrepareTraining>[0]) =>
      client.transformPrepareTraining(args),
  });
}

// ============================================================================
// Annotation System Hooks (Phase 3)
// ============================================================================

export const annotationKeys = {
  all: ["annotation"] as const,
  taxonomies: (args?: { datasetId?: string; type?: string }) => [...annotationKeys.all, "taxonomies", args] as const,
  taxonomy: (id: string) => [...annotationKeys.all, "taxonomy", id] as const,
  tasks: (args?: { datasetId?: string; status?: string }) => [...annotationKeys.all, "tasks", args] as const,
  task: (id: string) => [...annotationKeys.all, "task", id] as const,
  itemAnnotations: (taskId: string, itemId: string) => [...annotationKeys.all, "itemAnnotations", taskId, itemId] as const,
  taskAgreement: (taskId: string) => [...annotationKeys.all, "agreement", taskId] as const,
  templates: () => [...annotationKeys.all, "templates"] as const,
};

export function useTaxonomies(args?: { datasetId?: string; type?: string }) {
  return useQuery({
    queryKey: annotationKeys.taxonomies(args),
    queryFn: () => client.listTaxonomies(args),
  });
}

export function useTaxonomy(taxonomyId: string) {
  return useQuery({
    queryKey: annotationKeys.taxonomy(taxonomyId),
    queryFn: () => client.getTaxonomy(taxonomyId),
    enabled: !!taxonomyId,
  });
}

export function useCreateTaxonomy() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (args: Parameters<typeof client.createTaxonomy>[0]) =>
      client.createTaxonomy(args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: annotationKeys.taxonomies() });
    },
  });
}

export function useAnnotationTask(taskId: string) {
  return useQuery({
    queryKey: annotationKeys.task(taskId),
    queryFn: () => client.getAnnotationTask(taskId),
    enabled: !!taskId,
  });
}

export function useCreateAnnotationTask() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (args: Parameters<typeof client.createAnnotationTask>[0]) =>
      client.createAnnotationTask(args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: annotationKeys.tasks() });
    },
  });
}

export function useSubmitAnnotation() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (args: Parameters<typeof client.submitAnnotation>[0]) =>
      client.submitAnnotation(args),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ 
        queryKey: annotationKeys.itemAnnotations(variables.taskId, variables.itemId) 
      });
      queryClient.invalidateQueries({ queryKey: annotationKeys.task(variables.taskId) });
    },
  });
}

export function useItemAnnotations(taskId: string, itemId: string) {
  return useQuery({
    queryKey: annotationKeys.itemAnnotations(taskId, itemId),
    queryFn: () => client.getItemAnnotations({ taskId, itemId }),
    enabled: !!taskId && !!itemId,
  });
}

export function useTaskAgreement(taskId: string) {
  return useQuery({
    queryKey: annotationKeys.taskAgreement(taskId),
    queryFn: () => client.calculateTaskAgreement(taskId),
    enabled: !!taskId,
  });
}

export function useExportAnnotations() {
  return useMutation({
    mutationFn: (args: Parameters<typeof client.exportAnnotations>[0]) =>
      client.exportAnnotations(args),
  });
}

export function useImportAnnotations() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (args: Parameters<typeof client.importAnnotations>[0]) =>
      client.importAnnotations(args),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: annotationKeys.task(variables.taskId) });
    },
  });
}

// ============================================================================
// Version Control Hooks (Phase 3)
// ============================================================================

export const versionControlKeys = {
  all: ["versionControl"] as const,
  history: (datasetId: string, branch?: string) => [...versionControlKeys.all, "history", datasetId, branch] as const,
  branches: (datasetId: string) => [...versionControlKeys.all, "branches", datasetId] as const,
  tags: (datasetId: string) => [...versionControlKeys.all, "tags", datasetId] as const,
  diff: (datasetId: string, from?: string, to?: string) => [...versionControlKeys.all, "diff", datasetId, from, to] as const,
  timeline: (datasetId: string) => [...versionControlKeys.all, "timeline", datasetId] as const,
};

export function useVersionHistory(datasetId: string, branch?: string, limit?: number) {
  return useQuery({
    queryKey: versionControlKeys.history(datasetId, branch),
    queryFn: () => client.vcGetHistory({ datasetId, branch, limit }),
    enabled: !!datasetId,
  });
}

export function useVersionTimeline(datasetId: string) {
  return useQuery({
    queryKey: versionControlKeys.timeline(datasetId),
    queryFn: () => client.vcGetTimeline({ datasetId }),
    enabled: !!datasetId,
  });
}

export function useInitializeVersionControl() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (datasetId: string) => client.vcInitialize(datasetId),
    onSuccess: (_, datasetId) => {
      queryClient.invalidateQueries({ queryKey: versionControlKeys.history(datasetId) });
    },
  });
}

export function useCreateCommit() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (args: Parameters<typeof client.vcCommit>[0]) =>
      client.vcCommit(args),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: versionControlKeys.history(variables.datasetId) });
      queryClient.invalidateQueries({ queryKey: versionControlKeys.timeline(variables.datasetId) });
    },
  });
}

export function useCreateBranch() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (args: Parameters<typeof client.vcCreateBranch>[0]) =>
      client.vcCreateBranch(args),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: versionControlKeys.branches(variables.datasetId) });
    },
  });
}

export function useSwitchBranch() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (args: Parameters<typeof client.vcSwitchBranch>[0]) =>
      client.vcSwitchBranch(args),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: versionControlKeys.all });
    },
  });
}

export function useMergeBranch() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (args: Parameters<typeof client.vcMerge>[0]) =>
      client.vcMerge(args),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: versionControlKeys.history(variables.datasetId) });
      queryClient.invalidateQueries({ queryKey: versionControlKeys.branches(variables.datasetId) });
    },
  });
}

export function useVersionDiff(datasetId: string, fromCommit?: string, toCommit?: string) {
  return useQuery({
    queryKey: versionControlKeys.diff(datasetId, fromCommit, toCommit),
    queryFn: () => client.vcGetDiff({ datasetId, fromCommit, toCommit }),
    enabled: !!datasetId,
  });
}

export function useRollback() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (args: Parameters<typeof client.vcRollback>[0]) =>
      client.vcRollback(args),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: versionControlKeys.all });
    },
  });
}

export function useCreateTag() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (args: Parameters<typeof client.vcCreateTag>[0]) =>
      client.vcCreateTag(args),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: versionControlKeys.tags(variables.datasetId) });
    },
  });
}

// ============================================================================
// Data Lineage Hooks (Phase 3)
// ============================================================================

export const lineageKeys = {
  all: ["lineage"] as const,
  upstream: (nodeId: string) => [...lineageKeys.all, "upstream", nodeId] as const,
  downstream: (nodeId: string) => [...lineageKeys.all, "downstream", nodeId] as const,
  impact: (nodeId: string) => [...lineageKeys.all, "impact", nodeId] as const,
  auditTrail: (nodeId: string) => [...lineageKeys.all, "audit", nodeId] as const,
};

export function useUpstreamLineage(nodeId: string, depth?: number) {
  return useQuery({
    queryKey: lineageKeys.upstream(nodeId),
    queryFn: () => client.lineageGetUpstream({ nodeId, depth }),
    enabled: !!nodeId,
  });
}

export function useDownstreamLineage(nodeId: string, depth?: number) {
  return useQuery({
    queryKey: lineageKeys.downstream(nodeId),
    queryFn: () => client.lineageGetDownstream({ nodeId, depth }),
    enabled: !!nodeId,
  });
}

export function useImpactAnalysis(nodeId: string) {
  return useQuery({
    queryKey: lineageKeys.impact(nodeId),
    queryFn: () => client.lineageAnalyzeImpact(nodeId),
    enabled: !!nodeId,
  });
}

export function useAuditTrail(nodeId: string) {
  return useQuery({
    queryKey: lineageKeys.auditTrail(nodeId),
    queryFn: () => client.lineageGetAuditTrail(nodeId),
    enabled: !!nodeId,
  });
}

export function useAddLineageNode() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (args: Parameters<typeof client.lineageAddNode>[0]) =>
      client.lineageAddNode(args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: lineageKeys.all });
    },
  });
}

export function useRecordTransformation() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (args: Parameters<typeof client.lineageRecordTransformation>[0]) =>
      client.lineageRecordTransformation(args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: lineageKeys.all });
    },
  });
}

export function useExportLineage() {
  return useMutation({
    mutationFn: (args: Parameters<typeof client.lineageExport>[0]) =>
      client.lineageExport(args),
  });
}

// ============================================================================
// Pipeline Automation Hooks (Phase 4)
// ============================================================================

export const pipelineKeys = {
  all: ["pipeline"] as const,
  list: (args?: { datasetId?: string; status?: string }) => [...pipelineKeys.all, "list", args] as const,
  pipeline: (id: string) => [...pipelineKeys.all, "detail", id] as const,
  runStatus: (runId: string) => [...pipelineKeys.all, "runStatus", runId] as const,
  runHistory: (pipelineId: string) => [...pipelineKeys.all, "history", pipelineId] as const,
  templates: () => [...pipelineKeys.all, "templates"] as const,
};

export function usePipelines(args?: { datasetId?: string; status?: string }) {
  return useQuery({
    queryKey: pipelineKeys.list(args),
    queryFn: () => client.pipelineList(args),
  });
}

export function usePipelineTemplates() {
  return useQuery({
    queryKey: pipelineKeys.templates(),
    queryFn: () => client.pipelineListTemplates(),
  });
}

export function usePipelineRunStatus(runId: string) {
  return useQuery({
    queryKey: pipelineKeys.runStatus(runId),
    queryFn: () => client.pipelineGetRunStatus(runId),
    enabled: !!runId,
    refetchInterval: (data) => {
      // Auto-refresh while running
      if (data?.status === "running" || data?.status === "pending") {
        return 2000;
      }
      return false;
    },
  });
}

export function usePipelineRunHistory(pipelineId: string, limit?: number) {
  return useQuery({
    queryKey: pipelineKeys.runHistory(pipelineId),
    queryFn: () => client.pipelineGetRunHistory({ pipelineId, limit }),
    enabled: !!pipelineId,
  });
}

export function useCreatePipeline() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (args: Parameters<typeof client.pipelineCreate>[0]) =>
      client.pipelineCreate(args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pipelineKeys.list() });
    },
  });
}

export function useCreatePipelineFromTemplate() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (args: Parameters<typeof client.pipelineCreateFromTemplate>[0]) =>
      client.pipelineCreateFromTemplate(args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pipelineKeys.list() });
    },
  });
}

export function useUpdatePipeline() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (args: Parameters<typeof client.pipelineUpdate>[0]) =>
      client.pipelineUpdate(args),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: pipelineKeys.pipeline(variables.pipelineId) });
      queryClient.invalidateQueries({ queryKey: pipelineKeys.list() });
    },
  });
}

export function useDeletePipeline() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (pipelineId: string) => client.pipelineDelete(pipelineId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pipelineKeys.list() });
    },
  });
}

export function useRunPipeline() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (args: Parameters<typeof client.pipelineRun>[0]) =>
      client.pipelineRun(args),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: pipelineKeys.runHistory(variables.pipelineId) });
    },
  });
}

export function useCancelPipelineRun() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (runId: string) => client.pipelineCancelRun(runId),
    onSuccess: (_, runId) => {
      queryClient.invalidateQueries({ queryKey: pipelineKeys.runStatus(runId) });
    },
  });
}

// ============================================================================
// Analytics & Reporting Hooks (Phase 4)
// ============================================================================

export const analyticsKeys = {
  all: ["analytics"] as const,
  datasetStats: (datasetId: string, categories?: string[]) => [...analyticsKeys.all, "dataset", datasetId, categories] as const,
  globalStats: (categories?: string[]) => [...analyticsKeys.all, "global", categories] as const,
  timeSeries: (args: { datasetId?: string; metric: string }) => [...analyticsKeys.all, "timeSeries", args] as const,
  comparison: (datasetIds: string[]) => [...analyticsKeys.all, "comparison", datasetIds] as const,
  reports: (args?: { datasetId?: string; type?: string }) => [...analyticsKeys.all, "reports", args] as const,
  dashboards: () => [...analyticsKeys.all, "dashboards"] as const,
  dashboard: (id: string) => [...analyticsKeys.all, "dashboard", id] as const,
};

export function useDatasetAnalytics(datasetId: string, categories?: string[]) {
  return useQuery({
    queryKey: analyticsKeys.datasetStats(datasetId, categories),
    queryFn: () => client.analyticsGetDatasetStats({ datasetId, categories }),
    enabled: !!datasetId,
  });
}

export function useGlobalAnalytics(categories?: string[]) {
  return useQuery({
    queryKey: analyticsKeys.globalStats(categories),
    queryFn: () => client.analyticsGetGlobalStats(categories),
  });
}

export function useAnalyticsTimeSeries(args: {
  datasetId?: string;
  metric: string;
  startDate?: string;
  endDate?: string;
  interval?: string;
}) {
  return useQuery({
    queryKey: analyticsKeys.timeSeries({ datasetId: args.datasetId, metric: args.metric }),
    queryFn: () => client.analyticsGetTimeSeries(args),
    enabled: !!args.metric,
  });
}

export function useDatasetComparison(datasetIds: string[], metrics: string[]) {
  return useQuery({
    queryKey: analyticsKeys.comparison(datasetIds),
    queryFn: () => client.analyticsCompareDatasets({ datasetIds, metrics }),
    enabled: datasetIds.length > 0 && metrics.length > 0,
  });
}

export function useReportHistory(args?: { datasetId?: string; type?: string; limit?: number }) {
  return useQuery({
    queryKey: analyticsKeys.reports(args),
    queryFn: () => client.reportGetHistory(args),
  });
}

export function useDashboards() {
  return useQuery({
    queryKey: analyticsKeys.dashboards(),
    queryFn: () => client.dashboardList(),
  });
}

export function useDashboardData(dashboardId: string) {
  return useQuery({
    queryKey: analyticsKeys.dashboard(dashboardId),
    queryFn: () => client.dashboardGetData(dashboardId),
    enabled: !!dashboardId,
    refetchInterval: 30000, // Refresh every 30 seconds
  });
}

export function useGenerateReport() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (args: Parameters<typeof client.reportGenerate>[0]) =>
      client.reportGenerate(args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: analyticsKeys.reports() });
    },
  });
}

export function useExportReport() {
  return useMutation({
    mutationFn: (args: Parameters<typeof client.reportExport>[0]) =>
      client.reportExport(args),
  });
}

export function useCreateDashboard() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (args: Parameters<typeof client.dashboardCreate>[0]) =>
      client.dashboardCreate(args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: analyticsKeys.dashboards() });
    },
  });
}

export function useUpdateDashboard() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (args: Parameters<typeof client.dashboardUpdate>[0]) =>
      client.dashboardUpdate(args),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: analyticsKeys.dashboard(variables.dashboardId) });
      queryClient.invalidateQueries({ queryKey: analyticsKeys.dashboards() });
    },
  });
}

// ============================================================================
// Schema Validation Hooks (Phase 4)
// ============================================================================

export const schemaKeys = {
  all: ["schema"] as const,
  list: (args?: { datasetId?: string }) => [...schemaKeys.all, "list", args] as const,
  schema: (id: string) => [...schemaKeys.all, "detail", id] as const,
  templates: (category?: string) => [...schemaKeys.all, "templates", category] as const,
  categories: () => [...schemaKeys.all, "categories"] as const,
  reports: (args?: { datasetId?: string; schemaId?: string }) => [...schemaKeys.all, "reports", args] as const,
  report: (id: string) => [...schemaKeys.all, "report", id] as const,
};

export function useSchemas(args?: { datasetId?: string }) {
  return useQuery({
    queryKey: schemaKeys.list(args),
    queryFn: () => client.schemaList(args),
  });
}

export function useSchema(schemaId: string) {
  return useQuery({
    queryKey: schemaKeys.schema(schemaId),
    queryFn: () => client.schemaGet(schemaId),
    enabled: !!schemaId,
  });
}

export function useSchemaTemplates(category?: string) {
  return useQuery({
    queryKey: schemaKeys.templates(category),
    queryFn: () => client.schemaListTemplates(category),
  });
}

export function useSchemaCategories() {
  return useQuery({
    queryKey: schemaKeys.categories(),
    queryFn: () => client.schemaGetCategories(),
  });
}

export function useValidationReports(args?: { datasetId?: string; schemaId?: string; limit?: number }) {
  return useQuery({
    queryKey: schemaKeys.reports(args),
    queryFn: () => client.schemaListReports(args),
  });
}

export function useValidationReport(reportId: string) {
  return useQuery({
    queryKey: schemaKeys.report(reportId),
    queryFn: () => client.schemaGetReport(reportId),
    enabled: !!reportId,
  });
}

export function useCreateSchema() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (args: Parameters<typeof client.schemaCreate>[0]) =>
      client.schemaCreate(args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: schemaKeys.list() });
    },
  });
}

export function useCreateSchemaFromTemplate() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (args: Parameters<typeof client.schemaCreateFromTemplate>[0]) =>
      client.schemaCreateFromTemplate(args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: schemaKeys.list() });
    },
  });
}

export function useUpdateSchema() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (args: Parameters<typeof client.schemaUpdate>[0]) =>
      client.schemaUpdate(args),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: schemaKeys.schema(variables.schemaId) });
      queryClient.invalidateQueries({ queryKey: schemaKeys.list() });
    },
  });
}

export function useDeleteSchema() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (schemaId: string) => client.schemaDelete(schemaId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: schemaKeys.list() });
    },
  });
}

export function useValidateItem() {
  return useMutation({
    mutationFn: (args: Parameters<typeof client.schemaValidateItem>[0]) =>
      client.schemaValidateItem(args),
  });
}

export function useValidateDatasetSchema() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (args: Parameters<typeof client.schemaValidateDataset>[0]) =>
      client.schemaValidateDataset(args),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: schemaKeys.reports({ datasetId: variables.datasetId }) });
    },
  });
}

export function useInferSchema() {
  return useMutation({
    mutationFn: (args: Parameters<typeof client.schemaInfer>[0]) =>
      client.schemaInfer(args),
  });
}

export function useAddSchemaRule() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (args: Parameters<typeof client.schemaAddRule>[0]) =>
      client.schemaAddRule(args),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: schemaKeys.schema(variables.schemaId) });
    },
  });
}

export function useRemoveSchemaRule() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (args: Parameters<typeof client.schemaRemoveRule>[0]) =>
      client.schemaRemoveRule(args),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: schemaKeys.schema(variables.schemaId) });
    },
  });
}

export function useExportSchema() {
  return useMutation({
    mutationFn: (args: Parameters<typeof client.schemaExport>[0]) =>
      client.schemaExport(args),
  });
}

export function useImportSchema() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (args: Parameters<typeof client.schemaImport>[0]) =>
      client.schemaImport(args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: schemaKeys.list() });
    },
  });
}
