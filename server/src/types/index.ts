import { INSTANCE_STATE } from "../lib/enum";

export interface ApiResponse {
  message: string;
  status: "success" | "error" | "processing";
}
export interface SuccessResponse extends ApiResponse {
  success: true;
  data: Record<string, unknown>;
}
export interface ErrorResponse extends ApiResponse {
  success: false;
  error: string;
}

export interface WorkspaceInfo {
  instanceId: string;
  publicIp: string;
  customDomain: string;
  subdomain: string;
  lastSeen: string;
  state: INSTANCE_STATE;
  ts: string;
}

export interface CleanupResult {
  terminatedInstances: string[];
  cleanedUsers: string[];
  errors: string[];
}

export interface InstanceInfo {
  instanceId: string;
  owner: string;
  isActive: boolean;
  publicIp?: string;
}

export interface AWSConfig {
  region: string;
  credentials: {
    accessKeyId: string;
    secretAccessKey: string;
  };
}
