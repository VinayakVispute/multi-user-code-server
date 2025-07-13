import {
  CreateTagsCommand,
  DescribeInstancesCommand,
  DescribeTagsCommand,
} from "@aws-sdk/client-ec2";
import { ASG_NAME, autoScalingClient, ec2Client } from "../config/awsConfig";
import {
  DescribeAutoScalingGroupsCommand,
  SetDesiredCapacityCommand,
  SetInstanceProtectionCommand,
  TerminateInstanceInAutoScalingGroupCommand,
} from "@aws-sdk/client-auto-scaling";
import { InstanceInfo } from "../types";
import logger from "./logger";

export async function getInstanceIP(
  instanceId: string,
  requestId: string
): Promise<string | null> {
  const functionName = "getInstanceIP";
  logger.debug(
    `[${requestId || "system"}] [${functionName}] Getting IP for instance`,
    { instanceId }
  );

  try {
    const input = {
      InstanceIds: [instanceId],
    };
    const command = new DescribeInstancesCommand(input);
    const response = await ec2Client.send(command);
    const instance = response.Reservations?.[0]?.Instances?.[0];

    if (!instance?.PublicIpAddress) {
      logger.error(
        `[${
          requestId || "system"
        }] [${functionName}] Instance has no public IP, terminating`,
        { instanceId }
      );
      await safelyTerminateInstance(instanceId, requestId);
      throw new Error("Instance has no public IP and was terminated");
    }

    logger.info(
      `[${
        requestId || "system"
      }] [${functionName}] Successfully retrieved instance IP`,
      { instanceId, publicIp: instance.PublicIpAddress }
    );
    return instance.PublicIpAddress;
  } catch (error) {
    logger.error(
      `[${requestId || "system"}] [${functionName}] Failed to get instance IP`,
      {
        instanceId,
        error: error instanceof Error ? error.message : "Unknown error",
      }
    );
    throw error;
  }
}

export async function tagInstance(
  instanceId: string,
  userId: string,
  requestId: string
): Promise<void> {
  const functionName = "tagInstance";
  logger.debug(
    `[${requestId || "system"}] [${functionName}] Tagging instance`,
    { instanceId, userId }
  );

  try {
    const input = {
      Resources: [instanceId],
      Tags: [
        { Key: "Owner", Value: userId },
        { Key: "WarmSpare", Value: userId === "UNASSIGNED" ? "true" : "false" },
        { Key: "ManagedBy", Value: "code-server-manager" },
      ],
    };
    const command = new CreateTagsCommand(input);
    await ec2Client.send(command);

    logger.info(
      `[${
        requestId || "system"
      }] [${functionName}] Successfully tagged instance`,
      { instanceId, userId, isWarmSpare: userId === "UNASSIGNED" }
    );
  } catch (error) {
    logger.error(
      `[${requestId || "system"}] [${functionName}] Failed to tag instance`,
      {
        instanceId,
        userId,
        error: error instanceof Error ? error.message : "Unknown error",
      }
    );
    throw error;
  }
}

export async function protectActiveInstances(
  activeInstanceIds: string[],
  requestId: string
): Promise<void> {
  const functionName = "protectActiveInstances";

  if (activeInstanceIds.length === 0) {
    logger.debug(
      `[${requestId || "system"}] [${functionName}] No instances to protect`
    );
    return;
  }

  logger.debug(
    `[${
      requestId || "system"
    }] [${functionName}] Protecting instances from scale-in`,
    { instanceCount: activeInstanceIds.length, instanceIds: activeInstanceIds }
  );

  try {
    const input = {
      InstanceIds: activeInstanceIds,
      AutoScalingGroupName: ASG_NAME,
      ProtectedFromScaleIn: true,
    };
    const command = new SetInstanceProtectionCommand(input);
    await autoScalingClient.send(command);

    logger.info(
      `[${
        requestId || "system"
      }] [${functionName}] Successfully protected instances`,
      { instanceCount: activeInstanceIds.length, asgName: ASG_NAME }
    );
  } catch (error) {
    logger.error(
      `[${
        requestId || "system"
      }] [${functionName}] Failed to protect instances`,
      {
        instanceCount: activeInstanceIds.length,
        asgName: ASG_NAME,
        error: error instanceof Error ? error.message : "Unknown error",
      }
    );
    throw error;
  }
}

export async function getCurrentASGCapacity(
  requestId: string
): Promise<number> {
  const functionName = "getCurrentASGCapacity";
  logger.debug(
    `[${requestId || "system"}] [${functionName}] Getting current ASG capacity`,
    { asgName: ASG_NAME }
  );

  try {
    const command = new DescribeAutoScalingGroupsCommand({
      AutoScalingGroupNames: [ASG_NAME],
    });
    const response = await autoScalingClient.send(command);
    const capacity = response.AutoScalingGroups?.[0]?.DesiredCapacity || 0;

    logger.info(
      `[${requestId || "system"}] [${functionName}] Retrieved ASG capacity`,
      { asgName: ASG_NAME, capacity }
    );
    return capacity;
  } catch (error) {
    logger.error(
      `[${requestId || "system"}] [${functionName}] Failed to get ASG capacity`,
      {
        asgName: ASG_NAME,
        error: error instanceof Error ? error.message : "Unknown error",
      }
    );
    throw error;
  }
}

export async function updateASGCapacity(
  desiredCapacity: number,
  requestId: string
): Promise<void> {
  const functionName = "updateASGCapacity";
  logger.debug(
    `[${requestId || "system"}] [${functionName}] Updating ASG capacity`,
    { asgName: ASG_NAME, desiredCapacity }
  );

  try {
    const input = {
      AutoScalingGroupName: ASG_NAME,
      DesiredCapacity: desiredCapacity,
      HonorCooldown: false,
    };
    const command = new SetDesiredCapacityCommand(input);
    await autoScalingClient.send(command);

    logger.info(
      `[${
        requestId || "system"
      }] [${functionName}] Successfully updated ASG capacity`,
      { asgName: ASG_NAME, desiredCapacity }
    );
  } catch (error) {
    logger.error(
      `[${
        requestId || "system"
      }] [${functionName}] Failed to update ASG capacity`,
      {
        asgName: ASG_NAME,
        desiredCapacity,
        error: error instanceof Error ? error.message : "Unknown error",
      }
    );
    throw error;
  }
}

export async function safelyTerminateInstance(
  instanceId: string,
  requestId: string
): Promise<void> {
  const functionName = "safelyTerminateInstance";
  logger.debug(
    `[${requestId || "system"}] [${functionName}] Terminating instance`,
    { instanceId, asgName: ASG_NAME }
  );

  try {
    await autoScalingClient.send(
      new TerminateInstanceInAutoScalingGroupCommand({
        InstanceId: instanceId,
        ShouldDecrementDesiredCapacity: true,
      })
    );

    logger.info(
      `[${
        requestId || "system"
      }] [${functionName}] Successfully terminated instance`,
      { instanceId, asgName: ASG_NAME }
    );
  } catch (error) {
    logger.error(
      `[${
        requestId || "system"
      }] [${functionName}] Failed to terminate instance`,
      {
        instanceId,
        asgName: ASG_NAME,
        error: error instanceof Error ? error.message : "Unknown error",
      }
    );
    throw error;
  }
}

export async function getASGInstancesInfo(
  requestId: string
): Promise<InstanceInfo[]> {
  const functionName = "getASGInstancesInfo";
  logger.debug(
    `[${requestId || "system"}] [${functionName}] Getting ASG instances info`,
    { asgName: ASG_NAME }
  );

  try {
    const asgResponse = await autoScalingClient.send(
      new DescribeAutoScalingGroupsCommand({
        AutoScalingGroupNames: [ASG_NAME],
      })
    );
    const instances = asgResponse.AutoScalingGroups?.[0]?.Instances || [];
    const instanceIds = instances.map((i) => i.InstanceId!).filter(Boolean);

    if (instanceIds.length === 0) {
      logger.info(
        `[${
          requestId || "system"
        }] [${functionName}] No instances found in ASG`,
        { asgName: ASG_NAME }
      );
      return [];
    }

    const instancesResponse = await ec2Client.send(
      new DescribeInstancesCommand({
        InstanceIds: instanceIds,
      })
    );
    const tagsResponse = await ec2Client.send(
      new DescribeTagsCommand({
        Filters: [
          { Name: "resource-id", Values: instanceIds },
          { Name: "key", Values: ["Owner"] },
        ],
      })
    );

    const instancesInfo: InstanceInfo[] = [];
    for (const reservation of instancesResponse.Reservations || []) {
      for (const instance of reservation.Instances || []) {
        const instanceId = instance.InstanceId!;
        const ownerTag = tagsResponse.Tags?.find(
          (tag) => tag.ResourceId === instanceId && tag.Key === "Owner"
        );
        const owner = ownerTag?.Value || "UNKNOWN";
        const isActive = owner !== "UNASSIGNED" && owner !== "UNKNOWN";
        instancesInfo.push({
          instanceId,
          owner,
          isActive,
          publicIp: instance.PublicIpAddress,
        });
      }
    }

    logger.info(
      `[${requestId || "system"}] [${functionName}] Retrieved instances info`,
      {
        asgName: ASG_NAME,
        totalInstances: instancesInfo.length,
        activeInstances: instancesInfo.filter((i) => i.isActive).length,
        warmSpares: instancesInfo.filter((i) => !i.isActive).length,
      }
    );

    return instancesInfo;
  } catch (error) {
    logger.error(
      `[${
        requestId || "system"
      }] [${functionName}] Failed to get ASG instances info`,
      {
        asgName: ASG_NAME,
        error: error instanceof Error ? error.message : "Unknown error",
      }
    );
    throw error;
  }
}

export async function removeInstanceProtection(
  instanceIds: string[],
  requestId: string
): Promise<void> {
  const functionName = "removeInstanceProtection";

  if (instanceIds.length === 0) {
    logger.debug(
      `[${requestId || "system"}] [${functionName}] No instances to unprotect`
    );
    return;
  }

  logger.debug(
    `[${
      requestId || "system"
    }] [${functionName}] Removing protection from instances`,
    { instanceCount: instanceIds.length, instanceIds }
  );

  try {
    await autoScalingClient.send(
      new SetInstanceProtectionCommand({
        InstanceIds: instanceIds,
        AutoScalingGroupName: ASG_NAME,
        ProtectedFromScaleIn: false,
      })
    );

    logger.info(
      `[${
        requestId || "system"
      }] [${functionName}] Successfully removed protection from instances`,
      { instanceCount: instanceIds.length, asgName: ASG_NAME }
    );
  } catch (error) {
    logger.error(
      `[${
        requestId || "system"
      }] [${functionName}] Failed to remove protection from instances`,
      {
        instanceCount: instanceIds.length,
        asgName: ASG_NAME,
        error: error instanceof Error ? error.message : "Unknown error",
      }
    );
    throw error;
  }
}
