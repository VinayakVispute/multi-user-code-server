import {
  CreateTagsCommand,
  EC2Client,
  TerminateInstancesCommand,
} from "@aws-sdk/client-ec2";
import redis from "../src/lib/redis";
import { awsConfig, tagInstance } from "./allocateMachine";

async function cleanUpIdealMachines(): Promise<void> {
  const ec2Client = new EC2Client(awsConfig);

  const cutoffTime = Date.now() - 1000 * 60 * 5;
  const idealUsers = await redis.zrangebyscoreBuffer(
    "ws:pings",
    "-inf",
    cutoffTime
  );

  for (const userId in idealUsers) {
    const userWorkSpaceInstanceId = await redis.hget(
      `ws:${userId}`,
      "instanceId"
    );

    if (!userWorkSpaceInstanceId) {
      console.warn(`No instanceId found for user: ${userId}`);
      continue;
    }

    await tagInstance(userWorkSpaceInstanceId, "UNASSIGNED");

    const input = {
      InstanceIds: [userWorkSpaceInstanceId],
    };
    const command = new TerminateInstancesCommand(input);
    const response = await ec2Client.send(command);

    await redis
      .multi()
      .hset(`ws:${userId}`, {
        state: "STOPPED",
      })
      .zrem("ws:pings", userId)
      .del(`inst:${userWorkSpaceInstanceId}`);
  }
}
