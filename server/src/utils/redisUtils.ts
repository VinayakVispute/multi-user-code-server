import { WorkspaceInfo } from "../types/index";
import redis from "../lib/redis";
import { IDLE_TIMEOUT_MS } from "../config/awsConfig";
import logger from "./logger";
import { INSTANCE_STATE } from "../lib/enum";

export async function getUserWorkspace(
  userId: string,
  requestId: string
): Promise<WorkspaceInfo | null> {
  const functionName = "getUserWorkspace";
  logger.debug(
    `[${requestId || "system"}] [${functionName}] Getting user workspace`,
    { userId }
  );

  try {
    const wsKey = `ws:${userId}`;
    const userWorkspace = (await redis.hgetall(
      wsKey
    )) as unknown as WorkspaceInfo;

    if (!userWorkspace || Object.keys(userWorkspace).length === 0) {
      logger.debug(
        `[${
          requestId || "system"
        }] [${functionName}] No workspace found for user`,
        { userId }
      );
      return null;
    }

    const workspace = {
      instanceId: userWorkspace.instanceId,
      publicIp: userWorkspace.publicIp,
      lastSeen: userWorkspace.lastSeen,
      subdomain: userWorkspace.subdomain,
      customDomain: userWorkspace.customDomain,
      state: userWorkspace.state as INSTANCE_STATE,
      ts: userWorkspace.ts,
    };

    logger.info(
      `[${requestId || "system"}] [${functionName}] Retrieved user workspace`,
      { userId, instanceId: workspace.instanceId, state: workspace.state }
    );
    return workspace;
  } catch (error) {
    logger.error(
      `[${
        requestId || "system"
      }] [${functionName}] Failed to get user workspace`,
      {
        userId,
        error: error instanceof Error ? error.message : "Unknown error",
      }
    );
    return null;
  }
}

export async function popWarmSpare(requestId: string): Promise<string | null> {
  const functionName = "popWarmSpare";
  logger.debug(
    `[${requestId || "system"}] [${functionName}] Popping warm spare from pool`
  );

  try {
    const instanceId = await redis.spop("ws:pool");

    if (instanceId) {
      logger.info(
        `[${
          requestId || "system"
        }] [${functionName}] Successfully popped warm spare`,
        { instanceId }
      );
    } else {
      logger.debug(
        `[${
          requestId || "system"
        }] [${functionName}] No warm spares available in pool`
      );
    }

    return instanceId;
  } catch (error) {
    logger.error(
      `[${requestId || "system"}] [${functionName}] Failed to pop warm spare`,
      { error: error instanceof Error ? error.message : "Unknown error" }
    );
    return null;
  }
}

export async function setUserWorkspace(
  userId: string,
  workspace: WorkspaceInfo,
  requestId: string
): Promise<void> {
  const functionName = "setUserWorkspace";
  logger.debug(
    `[${requestId || "system"}] [${functionName}] Setting user workspace`,
    { userId, instanceId: workspace.instanceId, state: workspace.state }
  );

  try {
    const wsKey = `ws:${userId}`;
    const instKey = `inst:${workspace.instanceId}`;

    await redis
      .multi()
      .hmset(wsKey, {
        instanceId: workspace.instanceId,
        publicIp: workspace.publicIp,
        subdomain: workspace.subdomain,
        customDomain: workspace.customDomain,
        lastSeen: workspace.lastSeen,
        state: workspace.state,
        ts: workspace.ts,
      })
      .set(`inst:${workspace.instanceId}`, userId)
      .zadd("ws:pings", parseInt(workspace.lastSeen), userId)
      .exec();

    logger.info(
      `[${
        requestId || "system"
      }] [${functionName}] Successfully set user workspace`,
      {
        userId,
        instanceId: workspace.instanceId,
        publicIp: workspace.publicIp,
        state: workspace.state,
      }
    );
  } catch (error) {
    logger.error(
      `[${
        requestId || "system"
      }] [${functionName}] Failed to set user workspace`,
      {
        userId,
        instanceId: workspace.instanceId,
        error: error instanceof Error ? error.message : "Unknown error",
      }
    );
    throw error;
  }
}

export async function getActiveUserCount(requestId: string): Promise<number> {
  const functionName = "getActiveUserCount";
  logger.debug(
    `[${requestId || "system"}] [${functionName}] Getting active user count`
  );

  try {
    const count = await redis.zcard("ws:pings");
    logger.info(
      `[${
        requestId || "system"
      }] [${functionName}] Retrieved active user count`,
      { activeUsers: count }
    );
    return count;
  } catch (error) {
    logger.error(
      `[${
        requestId || "system"
      }] [${functionName}] Failed to get active user count`,
      { error: error instanceof Error ? error.message : "Unknown error" }
    );
    return 0;
  }
}

export async function getUserFromInstance(
  instanceId: string,
  requestId: string
): Promise<string | null> {
  const functionName = "getUserFromInstance";
  logger.debug(
    `[${requestId || "system"}] [${functionName}] Getting user from instance`,
    { instanceId }
  );

  try {
    const instKey = `inst:${instanceId}`;
    const userId = await redis.get(instKey);

    if (userId) {
      logger.info(
        `[${requestId || "system"}] [${functionName}] Found user for instance`,
        { instanceId, userId }
      );
    } else {
      logger.debug(
        `[${
          requestId || "system"
        }] [${functionName}] No user found for instance`,
        { instanceId }
      );
    }

    return userId;
  } catch (error) {
    logger.error(
      `[${
        requestId || "system"
      }] [${functionName}] Failed to get user from instance`,
      {
        instanceId,
        error: error instanceof Error ? error.message : "Unknown error",
      }
    );
    return null;
  }
}

export async function updateUserPing(
  userId: string,
  instanceId: string,
  requestId: string
): Promise<void> {
  const functionName = "updateUserPing";
  logger.debug(
    `[${requestId || "system"}] [${functionName}] Updating user ping`,
    { userId, instanceId }
  );

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

    logger.info(
      `[${
        requestId || "system"
      }] [${functionName}] Successfully updated user ping`,
      { userId, instanceId, lastSeen: now }
    );
  } catch (error) {
    logger.error(
      `[${requestId || "system"}] [${functionName}] Failed to update user ping`,
      {
        userId,
        instanceId,
        error: error instanceof Error ? error.message : "Unknown error",
      }
    );
    throw error;
  }
}

export async function getIdleUsers(requestId: string): Promise<string[]> {
  const functionName = "getIdleUsers";
  const cutoffTime = Date.now() - IDLE_TIMEOUT_MS;
  logger.debug(
    `[${requestId || "system"}] [${functionName}] Getting idle users`,
    { cutoffTime, idleTimeoutMs: IDLE_TIMEOUT_MS }
  );

  try {
    const idleUsers = await redis.zrangebyscore("ws:pings", "-inf", cutoffTime);
    logger.info(
      `[${requestId || "system"}] [${functionName}] Retrieved idle users`,
      { idleUserCount: idleUsers.length, cutoffTime }
    );
    return idleUsers;
  } catch (error) {
    logger.error(
      `[${requestId || "system"}] [${functionName}] Failed to get idle users`,
      {
        cutoffTime,
        error: error instanceof Error ? error.message : "Unknown error",
      }
    );
    return [];
  }
}

export async function removeFromWarmPool(
  instanceId: string,
  requestId: string
): Promise<void> {
  const functionName = "removeFromWarmPool";
  logger.debug(
    `[${
      requestId || "system"
    }] [${functionName}] Removing instance from warm pool`,
    { instanceId }
  );

  try {
    await redis.srem("ws:pool", instanceId);
    logger.info(
      `[${
        requestId || "system"
      }] [${functionName}] Successfully removed instance from warm pool`,
      { instanceId }
    );
  } catch (error) {
    logger.error(
      `[${
        requestId || "system"
      }] [${functionName}] Failed to remove instance from warm pool`,
      {
        instanceId,
        error: error instanceof Error ? error.message : "Unknown error",
      }
    );
    throw error;
  }
}

export async function cleanupUserData(
  userId: string,
  instanceId: string,
  requestId: string
): Promise<void> {
  const functionName = "cleanupUserData";
  logger.debug(
    `[${requestId || "system"}] [${functionName}] Cleaning up user data`,
    { userId, instanceId }
  );

  try {
    const wsKey = `ws:${userId}`;
    const instKey = `inst:${instanceId}`;

    await redis
      .multi()
      .hset(wsKey, "state", "STOPPED")
      .zrem("ws:pings", userId)
      .del(instKey)
      .exec();

    logger.info(
      `[${
        requestId || "system"
      }] [${functionName}] Successfully cleaned up user data`,
      { userId, instanceId }
    );
  } catch (error) {
    logger.error(
      `[${
        requestId || "system"
      }] [${functionName}] Failed to cleanup user data`,
      {
        userId,
        instanceId,
        error: error instanceof Error ? error.message : "Unknown error",
      }
    );
    throw error;
  }
}

export async function getWarmPoolSize(requestId: string): Promise<number> {
  const functionName = "getWarmPoolSize";
  logger.debug(
    `[${requestId || "system"}] [${functionName}] Getting warm pool size`
  );

  try {
    const size = await redis.scard("ws:pool");
    logger.info(
      `[${requestId || "system"}] [${functionName}] Retrieved warm pool size`,
      { warmPoolSize: size }
    );
    return size;
  } catch (error) {
    logger.error(
      `[${
        requestId || "system"
      }] [${functionName}] Failed to get warm pool size`,
      { error: error instanceof Error ? error.message : "Unknown error" }
    );
    return 0;
  }
}

export async function addToWarmPool(
  instanceId: string,
  requestId: string
): Promise<void> {
  const functionName = "addToWarmPool";
  logger.debug(
    `[${requestId || "system"}] [${functionName}] Adding instance to warm pool`,
    { instanceId }
  );

  try {
    await redis.sadd("ws:pool", instanceId);
    logger.info(
      `[${
        requestId || "system"
      }] [${functionName}] Successfully added instance to warm pool`,
      { instanceId }
    );
  } catch (error) {
    logger.error(
      `[${
        requestId || "system"
      }] [${functionName}] Failed to add instance to warm pool`,
      {
        instanceId,
        error: error instanceof Error ? error.message : "Unknown error",
      }
    );
    throw error;
  }
}
