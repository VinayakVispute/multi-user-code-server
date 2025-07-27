import { EC2Client } from "@aws-sdk/client-ec2";
import { AutoScalingClient } from "@aws-sdk/client-auto-scaling";
import type { AWSConfig } from "../types";
import { SSMClient } from "@aws-sdk/client-ssm";

export const awsConfig: AWSConfig = {
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
};

// AWS Clients
export const ec2Client = new EC2Client(awsConfig);

export const autoScalingClient = new AutoScalingClient(awsConfig);

export const ssmClient = new SSMClient(awsConfig);

// Configuration constants
export const MAX_MACHINES = Number(process.env.ASG_MAX) || 5;
export const WARM_SPARE_COUNT = Number(process.env.WARM_SPARE_COUNT) || 1;
export const ASG_NAME = process.env.ASG_NAME || "code-server-asg";
export const IDLE_TIMEOUT_MS =
  Number(process.env.IDLE_TIMEOUT_MS) || 5 * 60 * 1000; // 5 minutes
export const CLEANUP_INTERVAL_MS =
  Number(process.env.CLEANUP_INTERVAL_MS) || 60 * 1000; // 1 minute
