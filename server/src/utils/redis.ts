import { WorkspaceInfo } from "../types/index";
import redis from "../lib/redis";
import { INSTANCE_STATE } from "../enum";
import { IDLE_TIMEOUT_MS } from "../config/awsConfig";

export async function getUserWorkspace(
  userId: string
): Promise<WorkspaceInfo | null> {
  console.log(`🔍 [Redis] Getting workspace for user: ${userId}`);
  try {
    const wsKey = `ws:${userId}`;
    console.log(`📡 [Redis] Calling HGETALL for key: ${wsKey}`);
    const userWorkspace = await redis.hgetall(wsKey);

    if (!userWorkspace || Object.keys(userWorkspace).length === 0) {
      console.log(
        `ℹ️  [Redis] No existing workspace found for user: ${userId}`
      );
      return null;
    }

    const workspace = {
      instanceId: userWorkspace.instanceId,
      publicIp: userWorkspace.publicIp,
      lastSeen: userWorkspace.lastSeen,
      state: userWorkspace.state as INSTANCE_STATE,
      ts: userWorkspace.ts,
    };

    console.log(`✅ [Redis] Found workspace for ${userId}:`, {
      instanceId: workspace.instanceId,
      state: workspace.state,
      lastSeen: workspace.lastSeen,
    });

    return workspace;
  } catch (error) {
    console.error(
      `❌ [Redis] Failed to get workspace for user ${userId}:`,
      error
    );
    return null;
  }
}

export async function popWarmSpare(): Promise<string | null> {
  console.log(`🎯 [Redis] Popping warm spare from pool`);
  try {
    console.log(`📡 [Redis] Calling SPOP for key: ws:pool`);
    const instanceId = await redis.spop("ws:pool");

    if (instanceId) {
      console.log(`✅ [Redis] Popped warm spare: ${instanceId}`);
    } else {
      console.log(`⚠️  [Redis] No warm spare available in pool`);
    }

    return instanceId;
  } catch (error) {
    console.error(`❌ [Redis] Failed to pop warm spare:`, error);
    return null;
  }
}

export async function setUserWorkspace(
  userId: string,
  workspace: WorkspaceInfo
): Promise<void> {
  console.log(`💾 [Redis] Setting workspace for user: ${userId}`);
  console.log(`📊 [Redis] Workspace details:`, {
    instanceId: workspace.instanceId,
    publicIp: workspace.publicIp,
    state: workspace.state,
  });

  try {
    const wsKey = `ws:${userId}`;
    const instKey = `inst:${workspace.instanceId}`;

    console.log(`📡 [Redis] Executing multi-command transaction`);
    console.log(`   - HMSET ${wsKey}`);
    console.log(`   - SET ${instKey} ${userId}`);
    console.log(`   - ZADD ws:pings ${workspace.lastSeen} ${userId}`);

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

    console.log(`✅ [Redis] Successfully set workspace for user: ${userId}`);
  } catch (error) {
    console.error(
      `❌ [Redis] Failed to set workspace for user ${userId}:`,
      error
    );
    throw error;
  }
}

export async function getActiveUserCount(): Promise<number> {
  console.log(`📊 [Redis] Getting active user count`);
  try {
    console.log(`📡 [Redis] Calling ZCARD for key: ws:pings`);
    const count = await redis.zcard("ws:pings");
    console.log(`✅ [Redis] Active user count: ${count}`);
    return count;
  } catch (error) {
    console.error(`❌ [Redis] Failed to get active user count:`, error);
    return 0;
  }
}

export async function getUserFromInstance(
  instanceId: string
): Promise<string | null> {
  console.log(`🔍 [Redis] Getting user for instance: ${instanceId}`);
  try {
    const instKey = `inst:${instanceId}`;
    console.log(`📡 [Redis] Calling GET for key: ${instKey}`);
    const userId = await redis.get(instKey);

    if (userId) {
      console.log(
        `✅ [Redis] Found user for instance ${instanceId}: ${userId}`
      );
    } else {
      console.log(`⚠️  [Redis] No user found for instance: ${instanceId}`);
    }

    return userId;
  } catch (error) {
    console.error(
      `❌ [Redis] Failed to get user for instance ${instanceId}:`,
      error
    );
    return null;
  }
}

export async function updateUserPing(
  userId: string,
  instanceId: string
): Promise<void> {
  console.log(
    `💓 [Redis] Updating ping for user: ${userId}, instance: ${instanceId}`
  );
  try {
    const now = Date.now();
    const wsKey = `ws:${userId}`;

    console.log(`📡 [Redis] Executing multi-command transaction`);
    console.log(`   - HMSET ${wsKey} lastSeen=${now} state=RUNNING`);
    console.log(`   - ZADD ws:pings ${now} ${userId}`);

    await redis
      .multi()
      .hmset(wsKey, {
        lastSeen: now.toString(),
        state: "RUNNING",
      })
      .zadd("ws:pings", now, userId)
      .exec();

    console.log(`✅ [Redis] Successfully updated ping for user: ${userId}`);
  } catch (error) {
    console.error(
      `❌ [Redis] Failed to update ping for user ${userId}:`,
      error
    );
    throw error;
  }
}

export async function getIdleUsers(): Promise<string[]> {
  const cutoffTime = Date.now() - IDLE_TIMEOUT_MS;
  console.log(
    `🕐 [Redis] Getting idle users (cutoff: ${new Date(
      cutoffTime
    ).toISOString()})`
  );

  try {
    console.log(`📡 [Redis] Calling ZRANGEBYSCORE ws:pings -inf ${cutoffTime}`);
    const idleUsers = await redis.zrangebyscore("ws:pings", "-inf", cutoffTime);

    console.log(`📊 [Redis] Found ${idleUsers.length} idle users:`, idleUsers);
    return idleUsers;
  } catch (error) {
    console.error(`❌ [Redis] Failed to get idle users:`, error);
    return [];
  }
}

export async function removeFromWarmPool(instanceId: string): Promise<void> {
  console.log(`🗑️  [Redis] Removing instance from warm pool: ${instanceId}`);
  try {
    console.log(`📡 [Redis] Calling SREM ws:pool ${instanceId}`);
    const removed = await redis.srem("ws:pool", instanceId);

    if (removed > 0) {
      console.log(
        `✅ [Redis] Successfully removed ${instanceId} from warm pool`
      );
    } else {
      console.log(`ℹ️  [Redis] Instance ${instanceId} was not in warm pool`);
    }
  } catch (error) {
    console.error(
      `❌ [Redis] Failed to remove ${instanceId} from warm pool:`,
      error
    );
    throw error;
  }
}

export async function cleanupUserData(
  userId: string,
  instanceId: string
): Promise<void> {
  console.log(
    `🧹 [Redis] Cleaning up data for user: ${userId}, instance: ${instanceId}`
  );
  try {
    const wsKey = `ws:${userId}`;
    const instKey = `inst:${instanceId}`;

    console.log(`📡 [Redis] Executing multi-command transaction`);
    console.log(`   - HSET ${wsKey} state=STOPPED`);
    console.log(`   - ZREM ws:pings ${userId}`);
    console.log(`   - DEL ${instKey}`);

    await redis
      .multi()
      .hset(wsKey, "state", "STOPPED")
      .zrem("ws:pings", userId)
      .del(instKey)
      .exec();

    console.log(`✅ [Redis] Successfully cleaned up data for user: ${userId}`);
  } catch (error) {
    console.error(
      `❌ [Redis] Failed to cleanup data for user ${userId}:`,
      error
    );
    throw error;
  }
}

export async function getWarmPoolSize(): Promise<number> {
  console.log(`📊 [Redis] Getting warm pool size`);
  try {
    console.log(`📡 [Redis] Calling SCARD for key: ws:pool`);
    const size = await redis.scard("ws:pool");
    console.log(`✅ [Redis] Warm pool size: ${size}`);
    return size;
  } catch (error) {
    console.error(`❌ [Redis] Failed to get warm pool size:`, error);
    return 0;
  }
}

export async function addToWarmPool(instanceId: string): Promise<void> {
  console.log(`➕ [Redis] Adding instance to warm pool: ${instanceId}`);
  try {
    console.log(`📡 [Redis] Calling SADD ws:pool ${instanceId}`);
    const added = await redis.sadd("ws:pool", instanceId);

    if (added > 0) {
      console.log(`✅ [Redis] Successfully added ${instanceId} to warm pool`);
    } else {
      console.log(
        `ℹ️  [Redis] Instance ${instanceId} was already in warm pool`
      );
    }
  } catch (error) {
    console.error(
      `❌ [Redis] Failed to add ${instanceId} to warm pool:`,
      error
    );
    throw error;
  }
}
