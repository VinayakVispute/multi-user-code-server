import {
  EC2Client,
  DescribeInstancesCommand,
  TerminateInstancesCommand,
  CreateTagsCommand,
} from "@aws-sdk/client-ec2";
import redis from "../config/redis";
import {
  AutoScalingClient,
  DescribeAutoScalingGroupsCommand,
  SetDesiredCapacityCommand,
} from "@aws-sdk/client-auto-scaling";

interface ApiResponse {
  message: string;
  status: "success" | "error" | "processing";
}
interface SuccessResponse extends ApiResponse {
  success: true;
  data: Record<string, any>;
}
interface ErrorResponse extends ApiResponse {
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

const MAX_MACHINES = Number(process.env.ASG_MAX) ?? 3;

const WARM_SPARE = 1;

const ASG_NAME = process.env.ASG_NAME ?? "temp";

const ec2Client = new EC2Client(awsConfig);
const asgClient = new AutoScalingClient(awsConfig);

export async function ensureCapacity(): Promise<void> {
  const activeUsers = await redis.zcard("ws:pings");
  const desired = Math.min(activeUsers + WARM_SPARE, MAX_MACHINES);

  const { AutoScalingGroups } = await asgClient.send(
    new DescribeAutoScalingGroupsCommand({ AutoScalingGroupNames: [ASG_NAME] })
  );
  const current = AutoScalingGroups?.[0]?.DesiredCapacity ?? 0;

  if (desired > current) {
    await asgClient.send(
      new SetDesiredCapacityCommand({
        AutoScalingGroupName: ASG_NAME,
        DesiredCapacity: desired,
        HonorCooldown: false,
      })
    );
    console.log(`[scale-up] desiredCapacity → ${desired}`);
  }
}

export async function tagInstance(
  instanceId: string,
  owner: string | "UNASSIGNED"
): Promise<void> {
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

async function popWarmSpare(): Promise<string | null> {
  return redis.spop("ws:pool");
}

async function fetchInstanceIpOrTerminate(instanceId: string): Promise<string> {
  const res = await ec2Client.send(
    new DescribeInstancesCommand({ InstanceIds: [instanceId] })
  );
  const inst = res.Reservations?.[0]?.Instances?.[0];
  if (!inst?.PublicIpAddress) {
    // bad box → terminate it so pool stays healthy
    await ec2Client.send(
      new TerminateInstancesCommand({ InstanceIds: [instanceId] })
    );
    throw new Error("Instance metadata missing; terminated");
  }
  return inst.PublicIpAddress;
}

async function persistAllocation(
  userId: string,
  instanceId: string,
  publicIp: string,
  now: number
) {
  const wsKey = `ws:${userId}`;
  await redis
    .multi()
    .hmset(wsKey, {
      instanceId,
      publicIp,
      lastSeen: now.toString(),
      state: "RUNNING",
      ts: now.toString(),
    })
    .set(`inst:${instanceId}`, userId)
    .zadd("ws:pings", now, userId)
    .exec();
}

export async function allocateMachine(
  userId: string
): Promise<SuccessResponse | ErrorResponse> {
  const wsKey = `ws:${userId}`;
  const now = Date.now();

  // A) If already RUNNING, just return it
  const existing = await redis.hgetall(wsKey);
  if (
    existing.instanceId &&
    existing.publicIp &&
    existing.state === "RUNNING"
  ) {
    return {
      success: true,
      message: "Machine already allocated",
      status: "success",
      data: { publicUrl: existing.publicIp },
    };
  }

  try {
    // B) Grab a warm spare (we assume one always exists for now)
    const instanceId = await popWarmSpare();

    if (!instanceId) {
      // TODO: Implement the logic to handle the case when no warm spare is available
      return {
        success: false,
        message: "No warm spare available",
        status: "error",
        error: "No warm spare available",
      };
    }

    // C) Fetch its IP (or auto-terminate on failure)
    const publicIp = await fetchInstanceIpOrTerminate(instanceId);
    // D) Tag it as the user's box
    await tagInstance(instanceId, userId);
    // E) Persist everything + initial ping
    await persistAllocation(userId, instanceId, publicIp, now);
    // F) Upscale ASG if needed
    await ensureCapacity();

    return {
      success: true,
      message: "Machine allocated successfully",
      status: "success",
      data: { instanceId, publicUrl: publicIp },
    };
  } catch (err: any) {
    return {
      success: false,
      message: err.message,
      status: "error",
      error: err.message,
    };
  }
}
