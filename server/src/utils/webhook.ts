import { Request, Response } from "express";

import { DescribeInstancesCommand } from "@aws-sdk/client-ec2";
import { ec2Client } from "../config/awsConfig";
import { tagInstance } from "./awsUtils";
import {
  addToWarmPool,
  removeFromWarmPool,
  getUserFromInstance,
  cleanupUserData,
} from "./redisUtils";
import logger from "./logger";

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

function verifySNSSignature(message: SNSMessage): boolean {
  return true;
}

async function checkInstanceReadiness(
  instanceId: string,
  requestId: string
): Promise<InstanceReadinessCheck> {
  const functionName = "checkInstanceReadiness";
  logger.debug(
    `[${requestId || "system"}] [${functionName}] Checking instance readiness`,
    { instanceId }
  );

  try {
    const response = await ec2Client.send(
      new DescribeInstancesCommand({ InstanceIds: [instanceId] })
    );
    const instance = response.Reservations?.[0]?.Instances?.[0];

    if (!instance) {
      logger.warn(
        `[${requestId || "system"}] [${functionName}] Instance not found`,
        { instanceId }
      );
      return {
        hasPublicIp: false,
        isRunning: false,
      };
    }

    const hasPublicIp = !!instance.PublicIpAddress;
    const isRunning = instance.State?.Name === "running";

    logger.debug(
      `[${
        requestId || "system"
      }] [${functionName}] Instance readiness check completed`,
      {
        instanceId,
        hasPublicIp,
        isRunning,
        state: instance.State?.Name,
        publicIp: instance.PublicIpAddress,
      }
    );

    return { hasPublicIp, isRunning };
  } catch (error) {
    logger.error(
      `[${
        requestId || "system"
      }] [${functionName}] Failed to check instance readiness`,
      {
        instanceId,
        error: error instanceof Error ? error.message : "Unknown error",
      }
    );
    return {
      hasPublicIp: false,
      isRunning: false,
    };
  }
}

async function processNewInstanceWithRetries(
  instanceId: string,
  maxAttempts: number = 3,
  requestId: string
): Promise<boolean> {
  const functionName = "processNewInstanceWithRetries";
  logger.info(
    `[${requestId || "system"}] [${functionName}] Processing new instance`,
    { instanceId, maxAttempts }
  );

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      logger.debug(
        `[${
          requestId || "system"
        }] [${functionName}] Attempt ${attempt} of ${maxAttempts}`,
        { instanceId, attempt }
      );

      const readiness = await checkInstanceReadiness(instanceId, requestId);

      if (readiness.isRunning && readiness.hasPublicIp) {
        await tagInstance(instanceId, "UNASSIGNED", requestId);
        await addToWarmPool(instanceId, requestId);

        logger.info(
          `[${
            requestId || "system"
          }] [${functionName}] Successfully processed new instance`,
          { instanceId, attempt }
        );
        return true;
      }

      if (attempt < maxAttempts) {
        const waitTime = 60000;
        logger.debug(
          `[${
            requestId || "system"
          }] [${functionName}] Instance not ready, waiting before retry`,
          {
            instanceId,
            attempt,
            waitTime,
            hasPublicIp: readiness.hasPublicIp,
            isRunning: readiness.isRunning,
          }
        );
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    } catch (error) {
      logger.error(
        `[${
          requestId || "system"
        }] [${functionName}] Error processing instance on attempt ${attempt}`,
        {
          instanceId,
          attempt,
          error: error instanceof Error ? error.message : "Unknown error",
        }
      );

      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 30000));
      }
    }
  }

  logger.error(
    `[${
      requestId || "system"
    }] [${functionName}] Failed to process new instance after all attempts`,
    { instanceId, maxAttempts }
  );
  return false;
}

async function processTerminatedInstance(
  instanceId: string,
  requestId: string
): Promise<void> {
  const functionName = "processTerminatedInstance";
  logger.info(
    `[${
      requestId || "system"
    }] [${functionName}] Processing terminated instance`,
    { instanceId }
  );

  try {
    // Remove from warm pool if it was in there
    await removeFromWarmPool(instanceId, requestId);
    logger.debug(
      `[${
        requestId || "system"
      }] [${functionName}] Removed instance from warm pool`,
      { instanceId }
    );

    // Check if instance was assigned to a user
    const userId = await getUserFromInstance(instanceId, requestId);

    if (userId) {
      logger.info(
        `[${
          requestId || "system"
        }] [${functionName}] Instance was assigned to user, cleaning up user data`,
        { instanceId, userId }
      );
      await cleanupUserData(userId, instanceId, requestId);
    } else {
      logger.debug(
        `[${
          requestId || "system"
        }] [${functionName}] Instance was not assigned to any user`,
        { instanceId }
      );
    }

    logger.info(
      `[${
        requestId || "system"
      }] [${functionName}] Successfully processed terminated instance`,
      { instanceId, hadUser: !!userId }
    );
  } catch (error) {
    logger.error(
      `[${
        requestId || "system"
      }] [${functionName}] Failed to process terminated instance`,
      {
        instanceId,
        error: error instanceof Error ? error.message : "Unknown error",
      }
    );
  }
}

async function handleASGLifecycleEvent(
  event: ASGLifecycleEvent,
  requestId: string
): Promise<void> {
  const functionName = "handleASGLifecycleEvent";
  logger.debug(
    `[${requestId || "system"}] [${functionName}] Handling ASG lifecycle event`,
    {
      event: event.Event,
      instanceId: event.EC2InstanceId,
      asgName: event.AutoScalingGroupName,
    }
  );

  const instanceId = event.EC2InstanceId;

  if (event.Event === "autoscaling:EC2_INSTANCE_LAUNCH") {
    logger.info(
      `[${
        requestId || "system"
      }] [${functionName}] Processing instance launch event`,
      { instanceId, asgName: event.AutoScalingGroupName }
    );
    await processNewInstanceWithRetries(instanceId, 3, requestId);
  } else if (event.Event === "autoscaling:EC2_INSTANCE_TERMINATE") {
    logger.info(
      `[${
        requestId || "system"
      }] [${functionName}] Processing instance terminate event`,
      { instanceId, asgName: event.AutoScalingGroupName }
    );
    await processTerminatedInstance(instanceId, requestId);
  } else {
    logger.debug(
      `[${
        requestId || "system"
      }] [${functionName}] Ignoring unsupported event type`,
      {
        event: event.Event,
        instanceId: event.EC2InstanceId,
      }
    );
  }
}

export async function webhookHandler(
  req: Request,
  res: Response
): Promise<void> {
  const functionName = "webhookHandler";
  const requestId = logger.getRequestId(req);

  logger.debug(`[${requestId}] [${functionName}] Received webhook request`, {
    messageType: req.body.Type,
    messageId: req.body.MessageId,
  });

  try {
    if (req.body.Type === "SubscriptionConfirmation") {
      const data = req.body;
      const subscribeUrl = data.SubscribeURL;

      if (!subscribeUrl) {
        logger.error(
          `[${requestId}] [${functionName}] No SubscribeURL found in confirmation`,
          { messageId: data.MessageId }
        );
        res.status(400).json({ error: "No SubscribeURL found" });
        return;
      }

      logger.info(
        `[${requestId}] [${functionName}] Subscription confirmation received`,
        {
          subscribeUrl,
          messageId: data.MessageId,
        }
      );
      res.status(200).json({ message: "Subscription confirmation received" });
      return;
    }

    if (req.body.Type === "Notification") {
      const snsMessage: SNSMessage = req.body;

      if (!verifySNSSignature(snsMessage)) {
        logger.error(`[${requestId}] [${functionName}] Invalid SNS signature`, {
          messageId: snsMessage.MessageId,
        });
        res.status(401).json({ error: "Invalid signature" });
        return;
      }

      let lifecycleEvent: ASGLifecycleEvent;
      try {
        lifecycleEvent = JSON.parse(snsMessage.Message);
      } catch (error) {
        logger.error(
          `[${requestId}] [${functionName}] Invalid message format`,
          {
            messageId: snsMessage.MessageId,
            error: error instanceof Error ? error.message : "Unknown error",
          }
        );
        res.status(400).json({ error: "Invalid message format" });
        return;
      }

      logger.info(
        `[${requestId}] [${functionName}] Processing SNS notification`,
        {
          messageId: snsMessage.MessageId,
          event: lifecycleEvent.Event,
          instanceId: lifecycleEvent.EC2InstanceId,
        }
      );

      setImmediate(() => handleASGLifecycleEvent(lifecycleEvent, requestId));
      res.status(200).json({ message: "Event received and processing" });
      return;
    }

    logger.warn(`[${requestId}] [${functionName}] Unknown message type`, {
      messageType: req.body.Type,
    });
    res.status(400).json({ error: "Unknown message type" });
  } catch (error) {
    logger.error(`[${requestId}] [${functionName}] Webhook handler error`, {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    res.status(500).json({ error: "Internal server error" });
  }
}

export async function manualAddToWarmPool(
  req: Request,
  res: Response
): Promise<void> {
  const functionName = "manualAddToWarmPool";
  const requestId = logger.getRequestId(req);

  logger.debug(
    `[${requestId}] [${functionName}] Manual warm pool addition requested`,
    { body: req.body }
  );

  try {
    const { instanceId } = req.body;

    if (!instanceId) {
      logger.error(
        `[${requestId}] [${functionName}] Missing instanceId in request`
      );
      res.status(400).json({ error: "instanceId required" });
      return;
    }

    logger.info(
      `[${requestId}] [${functionName}] Processing manual warm pool addition`,
      { instanceId }
    );

    const success = await processNewInstanceWithRetries(
      instanceId,
      3,
      requestId
    );

    if (success) {
      logger.info(
        `[${requestId}] [${functionName}] Successfully added instance to warm pool manually`,
        { instanceId }
      );
      res.status(200).json({
        message: `Instance ${instanceId} successfully added to warm pool`,
        success: true,
      });
    } else {
      logger.error(
        `[${requestId}] [${functionName}] Failed to add instance to warm pool manually`,
        { instanceId }
      );
      res.status(500).json({
        message: `Failed to add instance ${instanceId} to warm pool`,
        success: false,
      });
    }
  } catch (error) {
    logger.error(
      `[${requestId}] [${functionName}] Manual warm pool addition error`,
      {
        error: error instanceof Error ? error.message : "Unknown error",
      }
    );
    res.status(500).json({ error: "Internal server error" });
  }
}
