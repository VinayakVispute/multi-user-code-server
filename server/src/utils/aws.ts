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

export async function getInstanceIP(
  instanceId: string
): Promise<string | null> {
  console.log(`🔍 [AWS] Getting IP for instance: ${instanceId}`);
  try {
    const input = {
      InstanceIds: [instanceId],
    };

    const command = new DescribeInstancesCommand(input);
    console.log(`📡 [AWS] Calling DescribeInstances for: ${instanceId}`);

    const response = await ec2Client.send(command);

    const instance = response.Reservations?.[0]?.Instances?.[0];

    if (!instance?.PublicIpAddress) {
      console.warn(
        `⚠️  [AWS] Instance ${instanceId} has no public IP, terminating...`
      );
      await safelyTerminateInstance(instanceId);
      throw new Error("Instance has no public IP and was terminated");
    }

    console.log(
      `✅ [AWS] Got IP for ${instanceId}: ${instance.PublicIpAddress}`
    );
    return instance.PublicIpAddress;
  } catch (error) {
    console.error(
      `❌ [AWS] Failed to get IP for instance ${instanceId}:`,
      error
    );
    throw error;
  }
}

export async function tagInstance(
  instanceId: string,
  userId: string
): Promise<void> {
  console.log(`🏷️  [AWS] Tagging instance ${instanceId} with owner: ${userId}`);
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
    console.log(`📡 [AWS] Calling CreateTags for instance: ${instanceId}`);

    await ec2Client.send(command);

    console.log(
      `✅ [AWS] Successfully tagged instance ${instanceId} with owner: ${userId}`
    );
  } catch (error) {
    console.error(`❌ [AWS] Failed to tag instance ${instanceId}:`, error);
    throw error;
  }
}

export async function protectActiveInstances(
  activeInstanceIds: string[]
): Promise<void> {
  if (activeInstanceIds.length === 0) {
    console.log(`ℹ️  [AWS] No instances to protect`);
    return;
  }

  console.log(
    `🛡️  [AWS] Protecting ${activeInstanceIds.length} active instances:`,
    activeInstanceIds
  );
  try {
    const input = {
      InstanceIds: activeInstanceIds,
      AutoScalingGroupName: ASG_NAME,
      ProtectedFromScaleIn: true,
    };

    const command = new SetInstanceProtectionCommand(input);
    console.log(`📡 [AWS] Calling SetInstanceProtection for ASG: ${ASG_NAME}`);

    await autoScalingClient.send(command);

    console.log(
      `✅ [AWS] Successfully protected ${activeInstanceIds.length} active instances`
    );
  } catch (error) {
    console.error(`❌ [AWS] Failed to protect instances:`, error);
    throw error;
  }
}

export async function getCurrentASGCapacity(): Promise<number> {
  console.log(`📊 [AWS] Getting current ASG capacity for: ${ASG_NAME}`);
  try {
    const command = new DescribeAutoScalingGroupsCommand({
      AutoScalingGroupNames: [ASG_NAME],
    });

    console.log(`📡 [AWS] Calling DescribeAutoScalingGroups for: ${ASG_NAME}`);
    const response = await autoScalingClient.send(command);

    const capacity = response.AutoScalingGroups?.[0]?.DesiredCapacity || 0;
    console.log(`✅ [AWS] Current ASG capacity: ${capacity}`);
    return capacity;
  } catch (error) {
    console.error(`❌ [AWS] Failed to get ASG capacity:`, error);
    throw error;
  }
}

export async function updateASGCapacity(
  desiredCapacity: number
): Promise<void> {
  console.log(
    `📈 [AWS] Updating ASG capacity to: ${desiredCapacity} for ASG: ${ASG_NAME}`
  );
  try {
    const input = {
      AutoScalingGroupName: ASG_NAME,
      DesiredCapacity: desiredCapacity,
      HonorCooldown: false,
    };

    const command = new SetDesiredCapacityCommand(input);
    console.log(`📡 [AWS] Calling SetDesiredCapacity for ASG: ${ASG_NAME}`);

    await autoScalingClient.send(command);
    console.log(
      `✅ [AWS] Successfully updated ASG capacity to: ${desiredCapacity}`
    );
  } catch (error) {
    console.error(`❌ [AWS] Failed to update ASG capacity:`, error);
    throw error;
  }
}

export async function safelyTerminateInstance(
  instanceId: string
): Promise<void> {
  console.log(`🔴 [AWS] Safely terminating instance: ${instanceId}`);
  try {
    console.log(
      `📡 [AWS] Calling TerminateInstanceInAutoScalingGroup for: ${instanceId}`
    );
    await autoScalingClient.send(
      new TerminateInstanceInAutoScalingGroupCommand({
        InstanceId: instanceId,
        ShouldDecrementDesiredCapacity: true,
      })
    );
    console.log(`✅ [AWS] Successfully terminated instance: ${instanceId}`);
  } catch (error) {
    console.error(
      `❌ [AWS] Failed to terminate instance ${instanceId}:`,
      error
    );
    throw error;
  }
}

export async function getASGInstancesInfo(): Promise<InstanceInfo[]> {
  console.log(`📋 [AWS] Getting ASG instances info for: ${ASG_NAME}`);
  try {
    // Get instances from ASG
    console.log(`📡 [AWS] Calling DescribeAutoScalingGroups for: ${ASG_NAME}`);
    const asgResponse = await autoScalingClient.send(
      new DescribeAutoScalingGroupsCommand({
        AutoScalingGroupNames: [ASG_NAME],
      })
    );

    const instances = asgResponse.AutoScalingGroups?.[0]?.Instances || [];
    const instanceIds = instances.map((i) => i.InstanceId!).filter(Boolean);

    console.log(
      `📊 [AWS] Found ${instanceIds.length} instances in ASG:`,
      instanceIds
    );

    if (instanceIds.length === 0) {
      console.log(`ℹ️  [AWS] No instances found in ASG`);
      return [];
    }

    // Get instance details
    console.log(
      `📡 [AWS] Calling DescribeInstances for ${instanceIds.length} instances`
    );
    const instancesResponse = await ec2Client.send(
      new DescribeInstancesCommand({
        InstanceIds: instanceIds,
      })
    );

    // Get tags for all instances
    console.log(
      `📡 [AWS] Calling DescribeTags for ${instanceIds.length} instances`
    );
    const tagsResponse = await ec2Client.send(
      new DescribeTagsCommand({
        Filters: [
          { Name: "resource-id", Values: instanceIds },
          { Name: "key", Values: ["Owner"] },
        ],
      })
    );

    // Combine instance info with tags
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

    console.log(
      `✅ [AWS] Retrieved info for ${instancesInfo.length} instances`
    );
    console.log(
      `📊 [AWS] Active instances: ${
        instancesInfo.filter((i) => i.isActive).length
      }`
    );
    console.log(
      `📊 [AWS] Warm spares: ${instancesInfo.filter((i) => !i.isActive).length}`
    );

    return instancesInfo;
  } catch (error) {
    console.error(`❌ [AWS] Failed to get ASG instances info:`, error);
    throw error;
  }
}

export async function removeInstanceProtection(
  instanceIds: string[]
): Promise<void> {
  if (instanceIds.length === 0) return;

  try {
    await autoScalingClient.send(
      new SetInstanceProtectionCommand({
        InstanceIds: instanceIds,
        AutoScalingGroupName: ASG_NAME,
        ProtectedFromScaleIn: false, // ⭐ Remove protection
      })
    );
    console.log(`Removed protection from ${instanceIds.length} instances`);
  } catch (error) {
    console.error("Failed to remove instance protection:", error);
    throw error;
  }
}
