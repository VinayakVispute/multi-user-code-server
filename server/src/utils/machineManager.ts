import { MAX_MACHINES, WARM_SPARE_COUNT } from "../config/awsConfig";

import {
  CleanupResult,
  ErrorResponse,
  SuccessResponse,
  WorkspaceInfo,
} from "../types";
import {
  getASGInstancesInfo,
  getCurrentASGCapacity,
  getInstanceIP,
  protectActiveInstances,
  removeInstanceProtection,
  safelyTerminateInstance,
  setupUserWorkspaceSymlink,
  tagInstance,
  updateASGCapacity,
} from "./awsUtils";
import {
  addToWarmPool,
  getActiveUserCount,
  getUserWorkspace,
  getWarmPoolSize,
  popWarmSpare,
  setUserWorkspace,
} from "./redisUtils";
import logger from "./logger";
import { createWorkspaceNginxConfig, generateSubdomain } from "./nginxUtils";
import { INSTANCE_STATE } from "../lib/enum";

export async function ensureCapacity(requestId: string): Promise<void> {
  const functionName = "ensureCapacity";
  logger.debug(
    `[${requestId || "system"}] [${functionName}] Ensuring adequate capacity`
  );

  try {
    const activeUsers = await getActiveUserCount(requestId);
    const desired = Math.min(activeUsers + WARM_SPARE_COUNT, MAX_MACHINES);
    const current = await getCurrentASGCapacity(requestId);

    if (desired > current) {
      logger.info(
        `[${requestId || "system"}] [${functionName}] Scaling up capacity`,
        {
          currentCapacity: current,
          desiredCapacity: desired,
          activeUsers,
          warmSpareCount: WARM_SPARE_COUNT,
        }
      );
      await updateASGCapacity(desired, requestId);
    } else {
      logger.debug(
        `[${requestId || "system"}] [${functionName}] Capacity is adequate`,
        { currentCapacity: current, desiredCapacity: desired, activeUsers }
      );
    }
  } catch (error) {
    logger.error(
      `[${requestId || "system"}] [${functionName}] Failed to ensure capacity`,
      { error: error instanceof Error ? error.message : "Unknown error" }
    );
    throw error;
  }
}

export async function allocateMachine(
  userId: string,
  userName: string,
  requestId: string
): Promise<SuccessResponse | ErrorResponse> {
  const functionName = "allocateMachine";
  logger.info(
    `[${requestId || "system"}] [${functionName}] Starting machine allocation`,
    { userId }
  );

  let shouldRollback = false;
  let instanceId: string | null = null;

  try {
    const now = Date.now();
    const existingWorkspace = await getUserWorkspace(userId, requestId);

    if (
      existingWorkspace?.state === INSTANCE_STATE.RUNNING &&
      existingWorkspace?.publicIp
    ) {
      logger.info(
        `[${requestId || "system"
        }] [${functionName}] Machine already allocated for user`,
        {
          userId,
          instanceId: existingWorkspace.instanceId,
          publicIp: existingWorkspace.publicIp,
        }
      );
      return {
        success: true,
        message: "Machine already allocated",
        status: "success",
        data: {
          instanceId: existingWorkspace.instanceId,
          publicUrl: existingWorkspace.publicIp,
          subdomain: existingWorkspace.subdomain,
          customDomain: existingWorkspace.customDomain,
        },
      };
    }

    instanceId = await popWarmSpare(requestId);
    if (!instanceId) {
      logger.warn(
        `[${requestId || "system"
        }] [${functionName}] No warm spare available, ensuring capacity`,
        { userId }
      );
      await ensureCapacity(requestId);
      return {
        success: false,
        message: "No available machines. Please try again in a moment.",
        status: "processing",
        error: "No warm spare available",
      };
    }

    const publicIp = await getInstanceIP(instanceId, requestId);
    if (!publicIp) {
      logger.error(
        `[${requestId || "system"
        }] [${functionName}] Instance has no public IP`,
        { userId, instanceId }
      );
      throw new Error("Instance has no public IP and was terminated");
    }

    shouldRollback = true;

    await setupUserWorkspaceSymlink(instanceId, userId);



    const subdomain = generateSubdomain(userName, instanceId);
    const httpsUrl = `https://${subdomain}.workspaces.codeclause.tech`;
    await createWorkspaceNginxConfig(subdomain, publicIp);
    await tagInstance(instanceId, userId, requestId);
    await protectActiveInstances([instanceId], requestId);

    const workspace: WorkspaceInfo = {
      instanceId,
      publicIp,
      lastSeen: now.toString(),
      customDomain: httpsUrl,
      subdomain: subdomain,
      state: INSTANCE_STATE.RUNNING,
      ts: now.toString(),
    };

    await setUserWorkspace(userId, workspace, requestId);

    // await ensureCapacity(requestId);

    logger.info(
      `[${requestId || "system"
      }] [${functionName}] Successfully allocated machine`,
      { userId, instanceId, publicIp }
    );
    return {
      success: true,
      message: "Machine allocated successfully",
      status: "success",
      data: { instanceId, publicUrl: httpsUrl, directIp: publicIp },
    };
  } catch (error) {
    logger.error(
      `[${requestId || "system"}] [${functionName}] Machine allocation failed`,
      {
        userId,
        instanceId,
        error: error instanceof Error ? error.message : "Unknown error",
      }
    );

    if (instanceId && shouldRollback) {
      logger.debug(
        `[${requestId || "system"}] [${functionName}] Rolling back allocation`,
        { userId, instanceId }
      );
      try {
        await removeInstanceProtection([instanceId], requestId);
      } catch (e) {
        logger.error(
          `[${requestId || "system"
          }] [${functionName}] Failed to remove protection during rollback`,
          {
            instanceId,
            error: e instanceof Error ? e.message : "Unknown error",
          }
        );
      }
      try {
        await tagInstance(instanceId, "UNASSIGNED", requestId);
      } catch (e) {
        logger.error(
          `[${requestId || "system"
          }] [${functionName}] Failed to retag instance during rollback`,
          {
            instanceId,
            error: e instanceof Error ? e.message : "Unknown error",
          }
        );
      }
      try {
        await addToWarmPool(instanceId, requestId);
      } catch (e) {
        logger.error(
          `[${requestId || "system"
          }] [${functionName}] Failed to return instance to warm pool during rollback`,
          {
            instanceId,
            error: e instanceof Error ? e.message : "Unknown error",
          }
        );
      }
    }

    return {
      success: false,
      message:
        error instanceof Error ? error.message : "Unknown allocation error",
      status: "error",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function getSystemStatus(requestId: string): Promise<{
  activeUsers: number;
  warmSpares: number;
  totalInstances: number;
  asgCapacity: number;
  instanceDetails: any[];
}> {
  const functionName = "getSystemStatus";
  logger.debug(
    `[${requestId || "system"}] [${functionName}] Getting system status`
  );

  try {
    const [activeUsers, warmSpares, asgCapacity, instancesInfo] =
      await Promise.all([
        getActiveUserCount(requestId),
        getWarmPoolSize(requestId),
        getCurrentASGCapacity(requestId),
        getASGInstancesInfo(requestId),
      ]);

    const status = {
      activeUsers,
      warmSpares,
      totalInstances: instancesInfo.length,
      asgCapacity,
      instanceDetails: instancesInfo,
    };

    logger.info(
      `[${requestId || "system"}] [${functionName}] Retrieved system status`,
      {
        activeUsers,
        warmSpares,
        totalInstances: instancesInfo.length,
        asgCapacity,
      }
    );
    return status;
  } catch (error) {
    logger.error(
      `[${requestId || "system"
      }] [${functionName}] Failed to get system status`,
      { error: error instanceof Error ? error.message : "Unknown error" }
    );
    throw error;
  }
}
