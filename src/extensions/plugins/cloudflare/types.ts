/**
 * Cloudflare Pages extension types
 */

export interface CloudflareProject {
  id: string;
  name: string;
  production_branch?: string;
  domains?: string[];
  created_on?: string;
}

export interface CloudflareDeployment {
  id: string;
  short_id: string;
  project_id: string;
  project_name: string;
  environment: string;
  url: string;
  created_on: string;
  modified_on: string;
  latest_stage?: {
    name: string;
    started_on: string | null;
    ended_on: string | null;
    status: string;
  };
  deployment_trigger?: {
    type: string;
    metadata?: {
      branch?: string;
      commit_hash?: string;
      commit_message?: string;
    };
  };
  stages?: Array<{
    name: string;
    started_on: string | null;
    ended_on: string | null;
    status: string;
  }>;
}

export interface CreateCloudflareProjectParams {
  name: string;
  production_branch?: string;
  build_command?: string;
  build_output_dir?: string;
}

export interface ConnectToExistingCloudflareProjectParams {
  projectId: string;
  appId: number;
}

export interface CreateCloudflareProjectParamsWithAppId
  extends CreateCloudflareProjectParams {
  appId: number;
}

export interface SaveCloudflareTokenParams {
  token: string;
}

export interface GetCloudflareDeploymentsParams {
  appId: number;
}

export interface DisconnectCloudflareProjectParams {
  appId: number;
}
