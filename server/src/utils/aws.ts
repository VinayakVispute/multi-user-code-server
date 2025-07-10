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
  try {
    const input = {
      InstanceIds: [instanceId],
    };

    const command = new DescribeInstancesCommand(input);

    const response = await ec2Client.send(command);

    const instance = response.Reservations?.[0]?.Instances?.[0];

    if (!instance?.PublicIpAddress) {
      console.warn(`Instance ${instanceId} has no public IP, terminating...`);
      await safelyTerminateInstance(instanceId);
      throw new Error("Instance has no public IP and was terminated");
    }
    return instance.PublicIpAddress;
  } catch (error) {
    console.error(`Failed to get IP for instance ${instanceId}:`, error);
    throw error;
  }
}

export async function tagInstance(
  instanceId: string,
  userId: string
): Promise<void> {
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

    console.log(`Tagged instance ${instanceId} with owner: ${userId}`);
  } catch (error) {
    console.error(`Failed to tag instance ${instanceId}:`, error);
    throw error;
  }
}

export async function protectActiveInstances(
  activeInstanceIds: string[]
): Promise<void> {
  if (activeInstanceIds.length === 0) {
    return;
  }

  try {
    const input = {
      InstanceIds: activeInstanceIds,
      AutoScalingGroupName: ASG_NAME,
      ProtectedFromScaleIn: true,
    };

    const command = new SetInstanceProtectionCommand(input);

    await autoScalingClient.send(command);

    console.log(`Protected ${activeInstanceIds.length} active instances`);
  } catch (error) {
    console.error("Failed to protect instances:", error);
    throw error;
  }
}

export async function getCurrentASGCapacity(): Promise<number> {
  try {
    const command = new DescribeAutoScalingGroupsCommand({
      AutoScalingGroupNames: [ASG_NAME],
    });

    const response = await autoScalingClient.send(command);

    return response.AutoScalingGroups?.[0]?.DesiredCapacity || 0;
  } catch (error) {
    console.error("Failed to get ASG capacity:", error);
    throw error;
  }
}

export async function updateASGCapacity(
  desiredCapacity: number
): Promise<void> {
  try {
    const input = {
      AutoScalingGroupName: ASG_NAME,
      DesiredCapacity: desiredCapacity,
      HonorCooldown: false,
    };

    const command = new SetDesiredCapacityCommand(input);

    await autoScalingClient.send(command);
    console.log(`Updated ASG capacity to: ${desiredCapacity}`);
  } catch (error) {
    console.error("Failed to update ASG capacity:", error);
    throw error;
  }
}

export async function safelyTerminateInstance(
  instanceId: string
): Promise<void> {
  try {
    await autoScalingClient.send(
      new TerminateInstanceInAutoScalingGroupCommand({
        InstanceId: instanceId,
        ShouldDecrementDesiredCapacity: true,
      })
    );
    console.log(`Safely terminated instance: ${instanceId}`);
  } catch (error) {
    console.error(`Failed to terminate instance ${instanceId}:`, error);
    throw error;
  }
}

export async function getASGInstancesInfo(): Promise<InstanceInfo[]> {
  try {
    // Get instances from ASG
    const asgResponse = await autoScalingClient.send(
      new DescribeAutoScalingGroupsCommand({
        AutoScalingGroupNames: [ASG_NAME],
      })
    );

    const instances = asgResponse.AutoScalingGroups?.[0]?.Instances || [];
    const instanceIds = instances.map((i) => i.InstanceId!).filter(Boolean);

    if (instanceIds.length === 0) {
      return [];
    }

    // Get instance details
    const instancesResponse = await ec2Client.send(
      new DescribeInstancesCommand({
        InstanceIds: instanceIds,
      })
    );

    // Get tags for all instances
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

    return instancesInfo;
  } catch (error) {
    console.error("Failed to get ASG instances info:", error);
    throw error;
  }
}
