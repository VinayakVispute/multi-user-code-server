import { WorkspaceInfo } from "../types/index";
import redis from "../lib/redis";
import { INSTANCE_STATE } from "../enum";
import { IDLE_TIMEOUT_MS } from "../config/awsConfig";

export async function getUserWorkspace(
  userId: string
): Promise<WorkspaceInfo | null> {
  try {
    const wsKey = `ws:${userId}`;
    const userWorkspace = await redis.hgetall(wsKey);

    if (!userWorkspace) {
      console.log(`No existing instance available for ${userId}`);
      return null;
    }

    return {
      instanceId: userWorkspace.instanceId,
      publicIp: userWorkspace.publicIp,
      lastSeen: userWorkspace.lastSeen,
      state: userWorkspace.state as INSTANCE_STATE,
      ts: userWorkspace.ts,
    };
  } catch (error) {
    console.error(`Failed to get workspace for user ${userId}:`, error);
    return null;
  }
}

export async function popWarmSpare(): Promise<string | null> {
  try {
    return await redis.spop("ws:pool");
  } catch (error) {
    console.error("Failed to pop warm spare:", error);
    return null;
  }
}

export async function setUserWorkspace(
  userId: string,
  workspace: WorkspaceInfo
): Promise<void> {
  try {
    const wsKey = `ws:${userId}`;
    await redis
      .multi()
      .hmset(wsKey, {
        instanceId: workspace.instanceId,
        publicIp: workspace.publicIp,
        lastSeen: workspace.lastSeen,
        state: workspace.state,
        ts: workspace.ts,
      })
      .set(`inst:${workspace.instanceId}`, userId)
      .zadd("ws:pings", parseInt(workspace.lastSeen), userId)
      .exec();
  } catch (error) {
    console.error(`Failed to set workspace for user ${userId}:`, error);
    throw error;
  }
}

export async function getActiveUserCount(): Promise<number> {
  try {
    return await redis.zcard("ws:pings");
  } catch (error) {
    console.error("Failed to get active user count:", error);
    return 0;
  }
}

export async function getUserFromInstance(
  instanceId: string
): Promise<string | null> {
  try {
    return await redis.get(`inst:${instanceId}`);
  } catch (error) {
    console.error(`Failed to get user for instance ${instanceId}:`, error);
    return null;
  }
}

export async function updateUserPing(
  userId: string,
  instanceId: string
): Promise<void> {
  try {
    const now = Date.now();
    const wsKey = `ws:${userId}`;

    await redis
      .multi()
      .hmset(wsKey, {
        lastSeen: now.toString(),
        state: "RUNNING",
      })
      .zadd("ws:pings", now, userId)
      .exec();
  } catch (error) {
    console.error(`Failed to update ping for user ${userId}:`, error);
    throw error;
  }
}

export async function getIdleUsers(): Promise<string[]> {
  try {
    const cutoffTime = Date.now() - IDLE_TIMEOUT_MS;
    return await redis.zrangebyscore("ws:pings", "-inf", cutoffTime);
  } catch (error) {
    console.error("Failed to get idle users:", error);
    return [];
  }
}

export async function removeFromWarmPool(instanceId: string): Promise<void> {
  try {
    await redis.srem("ws:pool", instanceId);
  } catch (error) {
    console.error(`Failed to remove ${instanceId} from warm pool:`, error);
    throw error;
  }
}

export async function cleanupUserData(
  userId: string,
  instanceId: string
): Promise<void> {
  try {
    await redis
      .multi()
      .hset(`ws:${userId}`, "state", "STOPPED")
      .zrem("ws:pings", userId)
      .del(`inst:${instanceId}`)
      .exec();
  } catch (error) {
    console.error(`Failed to cleanup data for user ${userId}:`, error);
    throw error;
  }
}

export async function getWarmPoolSize(): Promise<number> {
  try {
    return await redis.scard("ws:pool");
  } catch (error) {
    console.error("Failed to get warm pool size:", error);
    return 0;
  }
}
