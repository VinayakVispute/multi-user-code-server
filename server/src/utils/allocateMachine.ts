import redis from "../lib/redis";
import {
  CreateTagsCommand,
  DescribeInstancesCommand,
  EC2Client,
} from "@aws-sdk/client-ec2";
import {
  AutoScalingClient,
  DescribeAutoScalingGroupsCommand,
  SetDesiredCapacityCommand,
  CreateOrUpdateTagsCommand,
} from "@aws-sdk/client-auto-scaling";

interface apiResponseObject {
  message: string;
  status: "success" | "error" | "processing";
}

interface successApiResponseObject extends apiResponseObject {
  success: true;
  data: Record<string, any>;
}

interface errorApiResponseObject extends apiResponseObject {
  success: false;
  error: string;
}

export const awsConfig = {
  region: "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
};

const MAX_SIZE_OF_MACHINES = Number(process.env.ASG_MAX) ?? 3;
const WARM_SPARE = 1;
const ASG_NAME = "temp";

const ec2Client = new EC2Client(awsConfig);
const asgClient = new AutoScalingClient(awsConfig);

export async function ensureTheCapacity(): Promise<void> {
  const activePingingUsers = await redis.zcard("ws:pings");
  const desiredMachinesCount = Math.min(
    activePingingUsers + 1 /*new user*/ + WARM_SPARE,
    MAX_SIZE_OF_MACHINES
  );

  const desc = await asgClient.send(
    new DescribeAutoScalingGroupsCommand({ AutoScalingGroupNames: [ASG_NAME] })
  );
  const currentDesiredCapacity =
    desc.AutoScalingGroups?.[0].DesiredCapacity ?? 0;

  if (desiredMachinesCount > currentDesiredCapacity) {
    await asgClient.send(
      new SetDesiredCapacityCommand({
        AutoScalingGroupName: ASG_NAME,
        DesiredCapacity: desiredMachinesCount,
        HonorCooldown: false,
      })
    );
    console.log(`[scale-up] desiredCapacity → ${desiredMachinesCount}`);
  }
}

export async function tagInstanceOwner(
  instanceId: string,
  owner: string | "UNASSIGNED"
) {
  await ec2Client.send(
    new CreateTagsCommand({
      Resources: [instanceId],
      Tags: [
        { Key: "Owner", Value: owner },
        { Key: "WarmSpare", Value: owner === "UNASSIGNED" ? "true" : "false" },
      ],
    })
  );
}

export async function allocateMachine(
  userId: string
): Promise<successApiResponseObject | errorApiResponseObject> {
  const machine = await redis.hgetall(`ws:${userId}`);
  if (machine.instanceId) {
    return {
      success: true,
      message: "Machine was already present",
      status: "success",
      data: {
        publicUrl: machine.publicIp,
      },
    };
  }

  let freeMachineInstanceId = await redis.spop("ws:pool");
  if (!freeMachineInstanceId) {
    // Check if there's room to upscale
    const desc = await asgClient.send(
      new DescribeAutoScalingGroupsCommand({
        AutoScalingGroupNames: [ASG_NAME],
      })
    );
    const currentDesiredCapacity =
      desc.AutoScalingGroups?.[0].DesiredCapacity ?? 0;

    if (currentDesiredCapacity < MAX_SIZE_OF_MACHINES) {
      await asgClient.send(
        new SetDesiredCapacityCommand({
          AutoScalingGroupName: ASG_NAME,
          DesiredCapacity: currentDesiredCapacity + 1,
        })
      );
      return {
        success: false,
        message: "Scaling in progress. Please try again shortly.",
        status: "processing",
        error: "Scaling in progress",
      };
    } else {
      return {
        success: false,
        message: "No free machines and max capacity reached",
        error: "No free machines and max capacity reached",
        status: "error",
      };
    }
  }

  const describeInstancesCommand = new DescribeInstancesCommand({
    InstanceIds: [freeMachineInstanceId],
  });
  const ec2InstanceResponse = await ec2Client.send(describeInstancesCommand);
  const instance = ec2InstanceResponse.Reservations?.[0]?.Instances?.[0];
  const { PublicDnsName, PublicIpAddress, InstanceId } = instance || {};

  if (!PublicDnsName || !PublicIpAddress || !InstanceId) {
    await redis.sadd("ws:pool", freeMachineInstanceId);
    return {
      success: false,
      message: "Failed to retrieve instance details",
      error: "Failed to retrieve instance details",
      status: "error",
    };
  }

  await redis.hset(`ws:${userId}`, {
    instanceId: InstanceId,
    publicIp: PublicIpAddress,
    lastSeen: Date.now(),
    state: "RUNNING",
    ts: Date.now(),
  });

  await tagInstanceOwner(InstanceId, userId);

  await ensureTheCapacity();

  return {
    success: true,
    message: "Machine allocated successfully",
    status: "success",
    data: {
      instanceId: InstanceId,
      publicUrl: PublicDnsName || PublicIpAddress,
    },
  };
}
