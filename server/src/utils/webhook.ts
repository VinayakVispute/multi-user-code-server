import { Request, Response } from "express";

import { DescribeInstancesCommand } from "@aws-sdk/client-ec2";
import { ec2Client } from "../config/awsConfig";
import { tagInstance } from "./aws";
import { addToWarmPool } from "./redis";

interface SNSMessage {
  Type: string;
  MessageId: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: string;
  Signature: string;
  SigningCertURL: string;
  UnsubscribeURL?: string;
  TopicArn: string;
  Subject?: string;
}

interface ASGLifecycleEvent {
  Origin: string;
  Destination: string;
  Progress: number;
  AccountId: string;
  Description: string;
  RequestId: string;
  EndTime: string;
  AutoScalingGroupARN: string;
  ActivityId: string;
  StartTime: string;
  Service: string;
  Time: string;
  Event: string;
  EC2InstanceId: string;
  StatusCode: string;
  StatusMessage: string;
  Details: {
    "Subnet ID": string;
    "Availability Zone": string;
  };
  AutoScalingGroupName: string;
  Cause: string;
}

interface InstanceReadinessCheck {
  hasPublicIp: boolean;
  isRunning: boolean;
}

/**
 * Verify SNS message signature (optional but recommended for production)
 */
function verifySNSSignature(message: SNSMessage): boolean {
  // Implementation depends on your security requirements
  // For now, return true (implement proper verification in production)
  return true;
}

/**
 * Check if instance is ready for use
 */
async function checkInstanceReadiness(
  instanceId: string
): Promise<InstanceReadinessCheck> {
  try {
    const response = await ec2Client.send(
      new DescribeInstancesCommand({ InstanceIds: [instanceId] })
    );

    const instance = response.Reservations?.[0]?.Instances?.[0];

    if (!instance) {
      return {
        hasPublicIp: false,
        isRunning: false,
      };
    }

    const hasPublicIp = !!instance.PublicIpAddress;
    const isRunning = instance.State?.Name === "running";

    return { hasPublicIp, isRunning };
  } catch (error) {
    console.error(`Failed to check instance ${instanceId} readiness:`, error);
    return {
      hasPublicIp: false,
      isRunning: false,
    };
  }
}

/**
 * Process new instance with retry logic
 */
async function processNewInstanceWithRetries(
  instanceId: string,
  maxAttempts: number = 3
): Promise<boolean> {
  console.log(
    `Processing new instance ${instanceId} with ${maxAttempts} attempts...`
  );

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`Attempt ${attempt}/${maxAttempts} for instance ${instanceId}`);

    try {
      const readiness = await checkInstanceReadiness(instanceId);

      console.log(`Instance ${instanceId} readiness check:`, readiness);

      // Minimum requirements: running and has public IP
      if (readiness.isRunning && readiness.hasPublicIp) {
        console.log(
          `Instance ${instanceId} meets minimum requirements, adding to warm pool`
        );

        // Tag as unassigned warm spare
        await tagInstance(instanceId, "UNASSIGNED");

        // Add to warm pool
        await addToWarmPool(instanceId);

        console.log(`Successfully added instance ${instanceId} to warm pool`);
        return true;
      }

      // Log what's missing
      const missing = [];
      if (!readiness.isRunning) missing.push("not running");
      if (!readiness.hasPublicIp) missing.push("no public IP");

      console.log(`Instance ${instanceId} not ready: ${missing.join(", ")}`);

      // Wait before retry (except on last attempt)
      if (attempt < maxAttempts) {
        const waitTime = 60000; // 1 minute
        console.log(`Waiting ${waitTime / 1000} seconds before retry...`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    } catch (error) {
      console.error(
        `Error checking instance ${instanceId} on attempt ${attempt}:`,
        error
      );

      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 30000)); // Wait 30s on error
      }
    }
  }

  console.error(
    `Failed to process instance ${instanceId} after ${maxAttempts} attempts`
  );
  return false;
}

/**
 * Handle ASG lifecycle events
 */
async function handleASGLifecycleEvent(
  event: ASGLifecycleEvent
): Promise<void> {
  console.log("Received ASG lifecycle event:", event);

  // Only process instance launch events
  if (event.Event !== "autoscaling:EC2_INSTANCE_LAUNCH") {
    console.log(`Ignoring lifecycle transition: ${event.Event}`);
    return;
  }

  const instanceId = event.EC2InstanceId;
  console.log(`Processing instance launch: ${instanceId}`);

  // Process with retry logic (3 attempts over 3 minutes)
  const success = await processNewInstanceWithRetries(instanceId, 3);

  if (!success) {
    console.error(
      `Failed to add instance ${instanceId} to warm pool after all retries`
    );
    // Optionally: send alert, terminate instance, etc.
  }
}

/**
 * Main webhook endpoint
 */
export async function webhookHandler(
  req: Request,
  res: Response
): Promise<void> {
  try {
    console.log("Webhook received:", {
      headers: req.headers,
      body: req.body,
    });

    // Handle SNS subscription confirmation
    if (req.body.Type === "SubscriptionConfirmation") {
      console.log("SNS subscription confirmation received");

      const data = req.body;
      const subscribeUrl = data.SubscribeURL;

      if (!subscribeUrl) {
        console.error("❌ No SubscribeURL found in confirmation message");
        res.status(400).json({ error: "No SubscribeURL found" });
        return;
      }

      console.log(
        "Please visit this URL to confirm subscription:",
        req.body.SubscribeURL
      );

      res.status(200).json({ message: "Subscription confirmation received" });
      return;
    }
    if (req.body.Type === "Notification") {
      const snsMessage: SNSMessage = req.body;

      // Optional: Verify SNS signature in production
      if (!verifySNSSignature(snsMessage)) {
        console.error("Invalid SNS signature");
        res.status(401).json({ error: "Invalid signature" });
        return;
      }

      // Parse the actual message
      let lifecycleEvent: ASGLifecycleEvent;
      try {
        lifecycleEvent = JSON.parse(snsMessage.Message);
      } catch (error) {
        console.error("Failed to parse SNS message:", error);
        res.status(400).json({ error: "Invalid message format" });
        return;
      }

      // Process the lifecycle event asynchronously
      // Don't wait for completion to avoid timeouts
      setImmediate(() => handleASGLifecycleEvent(lifecycleEvent));

      res.status(200).json({ message: "Event received and processing" });
      return;
    }

    // Unknown message type
    console.error("Unknown message type:", req.body.Type);
    res.status(400).json({ error: "Unknown message type" });
  } catch (error) {
    console.error("Webhook handler error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

/**
 * Manual endpoint to add instance to warm pool (for testing)
 */
export async function manualAddToWarmPool(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { instanceId } = req.body;

    if (!instanceId) {
      res.status(400).json({ error: "instanceId required" });
      return;
    }

    console.log(`Manual request to add instance ${instanceId} to warm pool`);

    const success = await processNewInstanceWithRetries(instanceId, 3);

    if (success) {
      res.status(200).json({
        message: `Instance ${instanceId} successfully added to warm pool`,
        success: true,
      });
    } else {
      res.status(500).json({
        message: `Failed to add instance ${instanceId} to warm pool`,
        success: false,
      });
    }
  } catch (error) {
    console.error("Manual add to warm pool error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}
