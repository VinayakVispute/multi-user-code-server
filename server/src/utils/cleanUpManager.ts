import { CleanupResult } from "../types";
import {
  getASGInstancesInfo,
  getCurrentASGCapacity,
  protectActiveInstances,
  safelyTerminateInstance,
  updateASGCapacity,
} from "./awsUtils";
import {
  cleanupUserData,
  getActiveUserCount,
  getIdleUsers,
  getUserWorkspace,
  getWarmPoolSize,
  removeFromWarmPool,
} from "./redisUtils";
import { WARM_SPARE_COUNT } from "../config/awsConfig";
import logger from "./logger";

export async function cleanupIdleMachines(
  requestId: string
): Promise<CleanupResult> {
  const functionName = "cleanupIdleMachines";
  logger.info(
    `[${requestId || "system"}] [${functionName}] Starting idle machine cleanup`
  );

  const result: CleanupResult = {
    terminatedInstances: [],
    cleanedUsers: [],
    errors: [],
  };

  try {
    const idleUsers = await getIdleUsers(requestId);

    if (idleUsers.length === 0) {
      logger.debug(
        `[${requestId || "system"}] [${functionName}] No idle users found`
      );
      return result;
    }

    logger.info(
      `[${
        requestId || "system"
      }] [${functionName}] Found idle users to cleanup`,
      { idleUserCount: idleUsers.length }
    );

    for (const userId of idleUsers) {
      try {
        logger.debug(
          `[${requestId || "system"}] [${functionName}] Processing idle user`,
          { userId }
        );

        const workspace = await getUserWorkspace(userId, requestId);
        if (!workspace || !workspace.instanceId) {
          logger.debug(
            `[${
              requestId || "system"
            }] [${functionName}] No workspace or instance found for user`,
            { userId }
          );
          continue;
        }

        const instanceId = workspace.instanceId;

        await removeFromWarmPool(instanceId, requestId);
        await safelyTerminateInstance(instanceId, requestId);
        await cleanupUserData(userId, instanceId, requestId);

        result.terminatedInstances.push(instanceId);
        result.cleanedUsers.push(userId);

        logger.info(
          `[${
            requestId || "system"
          }] [${functionName}] Successfully cleaned up idle user`,
          { userId, instanceId }
        );
      } catch (error) {
        const errorMsg = `Failed to cleanup user ${userId}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`;
        logger.error(
          `[${
            requestId || "system"
          }] [${functionName}] Failed to cleanup idle user`,
          {
            userId,
            error: error instanceof Error ? error.message : "Unknown error",
          }
        );
        result.errors.push(errorMsg);
      }
    }

    logger.info(
      `[${
        requestId || "system"
      }] [${functionName}] Idle machine cleanup completed`,
      {
        terminatedInstances: result.terminatedInstances.length,
        cleanedUsers: result.cleanedUsers.length,
        errors: result.errors.length,
      }
    );
  } catch (error) {
    const errorMsg = `Cleanup process failed: ${
      error instanceof Error ? error.message : "Unknown error"
    }`;
    logger.error(
      `[${requestId || "system"}] [${functionName}] Cleanup process failed`,
      { error: error instanceof Error ? error.message : "Unknown error" }
    );
    result.errors.push(errorMsg);
  }

  return result;
}

export async function safeScaleDown(
  targetCapacity: number,
  requestId: string
): Promise<void> {
  const functionName = "safeScaleDown";
  logger.debug(
    `[${requestId || "system"}] [${functionName}] Starting safe scale down`,
    { targetCapacity }
  );

  try {
    const currentCapacity = await getCurrentASGCapacity(requestId);

    if (targetCapacity >= currentCapacity) {
      logger.debug(
        `[${
          requestId || "system"
        }] [${functionName}] Target capacity is not less than current, no scaling needed`,
        { currentCapacity, targetCapacity }
      );
      return;
    }

    // Get all instances and identify active ones
    const instancesInfo = await getASGInstancesInfo(requestId);
    const activeInstances = instancesInfo
      .filter((instance) => instance.isActive)
      .map((instance) => instance.instanceId);

    logger.debug(
      `[${
        requestId || "system"
      }] [${functionName}] Protecting active instances before scale down`,
      {
        activeInstanceCount: activeInstances.length,
        targetCapacity,
        currentCapacity,
      }
    );

    // Protect active instances
    if (activeInstances.length > 0) {
      await protectActiveInstances(activeInstances, requestId);
    }

    // Scale down - ASG will only terminate unprotected instances
    await updateASGCapacity(targetCapacity, requestId);

    logger.info(
      `[${
        requestId || "system"
      }] [${functionName}] Successfully scaled down capacity`,
      {
        currentCapacity,
        targetCapacity,
        protectedInstances: activeInstances.length,
      }
    );
  } catch (error) {
    logger.error(
      `[${
        requestId || "system"
      }] [${functionName}] Failed to scale down safely`,
      {
        targetCapacity,
        error: error instanceof Error ? error.message : "Unknown error",
      }
    );
    throw error;
  }
}

export async function ensureOptimalWarmSpares(
  requestId: string
): Promise<void> {
  const functionName = "ensureOptimalWarmSpares";
  logger.debug(
    `[${
      requestId || "system"
    }] [${functionName}] Ensuring optimal warm spare count`
  );

  try {
    const activeUsers = await getActiveUserCount(requestId);
    const warmPoolSize = await getWarmPoolSize(requestId);
    const currentCapacity = await getCurrentASGCapacity(requestId);
    const targetCapacity = activeUsers + WARM_SPARE_COUNT;

    logger.debug(
      `[${requestId || "system"}] [${functionName}] Current system state`,
      {
        activeUsers,
        warmPoolSize,
        currentCapacity,
        targetCapacity,
        warmSpareCount: WARM_SPARE_COUNT,
      }
    );

    if (currentCapacity < targetCapacity) {
      // Scale up
      logger.info(
        `[${
          requestId || "system"
        }] [${functionName}] Scaling up to meet demand`,
        { currentCapacity, targetCapacity }
      );
      await updateASGCapacity(targetCapacity, requestId);
    } else if (
      currentCapacity > targetCapacity &&
      warmPoolSize > WARM_SPARE_COUNT
    ) {
      // Too many warm spares, scale down safely
      logger.info(
        `[${
          requestId || "system"
        }] [${functionName}] Too many warm spares, scaling down`,
        {
          currentCapacity,
          targetCapacity,
          warmPoolSize,
          warmSpareCount: WARM_SPARE_COUNT,
        }
      );
      await safeScaleDown(targetCapacity, requestId);
    } else {
      logger.debug(
        `[${requestId || "system"}] [${functionName}] Capacity is optimal`,
        { currentCapacity, targetCapacity, warmPoolSize }
      );
    }
  } catch (error) {
    logger.error(
      `[${
        requestId || "system"
      }] [${functionName}] Failed to ensure optimal warm spares`,
      { error: error instanceof Error ? error.message : "Unknown error" }
    );
    throw error;
  }
}

/**
 * Start periodic cleanup process
 */
export function startCleanupProcess(): NodeJS.Timeout {
  const functionName = "startCleanupProcess";
  logger.info(`[system] [${functionName}] Starting periodic cleanup process`);

  const cleanupInterval = setInterval(async () => {
    const requestId = `cleanup-${Date.now()}`;
    try {
      logger.debug(
        `[${requestId}] [${functionName}] Running periodic cleanup cycle`
      );

      // Clean up idle machines
      const cleanupResult = await cleanupIdleMachines(requestId);

      // Ensure optimal capacity
      await ensureOptimalWarmSpares(requestId);

      logger.info(
        `[${requestId}] [${functionName}] Periodic cleanup cycle completed`,
        {
          terminatedInstances: cleanupResult.terminatedInstances.length,
          cleanedUsers: cleanupResult.cleanedUsers.length,
          errors: cleanupResult.errors.length,
        }
      );
    } catch (error) {
      logger.error(`[${requestId}] [${functionName}] Periodic cleanup error`, {
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }, 60000); // Run every minute

  return cleanupInterval;
}

/**
 * Stop cleanup process
 */
export function stopCleanupProcess(interval: NodeJS.Timeout): void {
  const functionName = "stopCleanupProcess";
  clearInterval(interval);
  logger.info(`[system] [${functionName}] Stopped cleanup process`);
}
