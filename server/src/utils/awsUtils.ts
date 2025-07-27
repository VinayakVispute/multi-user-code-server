import {
  CreateTagsCommand,
  DescribeInstancesCommand,
  DescribeTagsCommand,
} from "@aws-sdk/client-ec2";
import { ASG_NAME, autoScalingClient, ec2Client, ssmClient } from "../config/awsConfig";
import {
  DescribeAutoScalingGroupsCommand,
  SetDesiredCapacityCommand,
  SetInstanceProtectionCommand,
  TerminateInstanceInAutoScalingGroupCommand,
} from "@aws-sdk/client-auto-scaling";
import { InstanceInfo } from "../types";
import logger from "./logger";
import { GetCommandInvocationCommand, SendCommandCommand } from "@aws-sdk/client-ssm";

export async function getInstanceIP(
  instanceId: string,
  requestId: string
): Promise<string | null> {
  const functionName = "getInstanceIP";
  logger.debug(
    `[${requestId || "system"}] [${functionName}] Getting IP for instance`,
    { instanceId }
  );

  try {
    const input = {
      InstanceIds: [instanceId],
    };
    const command = new DescribeInstancesCommand(input);
    const response = await ec2Client.send(command);
    const instance = response.Reservations?.[0]?.Instances?.[0];

    if (!instance?.PublicIpAddress) {
      logger.error(
        `[${requestId || "system"
        }] [${functionName}] Instance has no public IP, terminating`,
        { instanceId }
      );
      await safelyTerminateInstance(instanceId, requestId);
      throw new Error("Instance has no public IP and was terminated");
    }

    logger.info(
      `[${requestId || "system"
      }] [${functionName}] Successfully retrieved instance IP`,
      { instanceId, publicIp: instance.PublicIpAddress }
    );
    return instance.PublicIpAddress;
  } catch (error) {
    logger.error(
      `[${requestId || "system"}] [${functionName}] Failed to get instance IP`,
      {
        instanceId,
        error: error instanceof Error ? error.message : "Unknown error",
      }
    );
    throw error;
  }
}

export async function tagInstance(
  instanceId: string,
  userId: string,
  requestId: string
): Promise<void> {
  const functionName = "tagInstance";
  logger.debug(
    `[${requestId || "system"}] [${functionName}] Tagging instance`,
    { instanceId, userId }
  );

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

    logger.info(
      `[${requestId || "system"
      }] [${functionName}] Successfully tagged instance`,
      { instanceId, userId, isWarmSpare: userId === "UNASSIGNED" }
    );
  } catch (error) {
    logger.error(
      `[${requestId || "system"}] [${functionName}] Failed to tag instance`,
      {
        instanceId,
        userId,
        error: error instanceof Error ? error.message : "Unknown error",
      }
    );
    throw error;
  }
}

export async function protectActiveInstances(
  activeInstanceIds: string[],
  requestId: string
): Promise<void> {
  const functionName = "protectActiveInstances";

  if (activeInstanceIds.length === 0) {
    logger.debug(
      `[${requestId || "system"}] [${functionName}] No instances to protect`
    );
    return;
  }

  logger.debug(
    `[${requestId || "system"
    }] [${functionName}] Protecting instances from scale-in`,
    { instanceCount: activeInstanceIds.length, instanceIds: activeInstanceIds }
  );

  try {
    const input = {
      InstanceIds: activeInstanceIds,
      AutoScalingGroupName: ASG_NAME,
      ProtectedFromScaleIn: true,
    };
    const command = new SetInstanceProtectionCommand(input);
    await autoScalingClient.send(command);

    logger.info(
      `[${requestId || "system"
      }] [${functionName}] Successfully protected instances`,
      { instanceCount: activeInstanceIds.length, asgName: ASG_NAME }
    );
  } catch (error) {
    logger.error(
      `[${requestId || "system"
      }] [${functionName}] Failed to protect instances`,
      {
        instanceCount: activeInstanceIds.length,
        asgName: ASG_NAME,
        error: error instanceof Error ? error.message : "Unknown error",
      }
    );
    throw error;
  }
}

export async function getCurrentASGCapacity(
  requestId: string
): Promise<number> {
  const functionName = "getCurrentASGCapacity";
  logger.debug(
    `[${requestId || "system"}] [${functionName}] Getting current ASG capacity`,
    { asgName: ASG_NAME }
  );

  try {
    const command = new DescribeAutoScalingGroupsCommand({
      AutoScalingGroupNames: [ASG_NAME],
    });
    const response = await autoScalingClient.send(command);
    const capacity = response.AutoScalingGroups?.[0]?.DesiredCapacity || 0;

    logger.info(
      `[${requestId || "system"}] [${functionName}] Retrieved ASG capacity`,
      { asgName: ASG_NAME, capacity }
    );
    return capacity;
  } catch (error) {
    logger.error(
      `[${requestId || "system"}] [${functionName}] Failed to get ASG capacity`,
      {
        asgName: ASG_NAME,
        error: error instanceof Error ? error.message : "Unknown error",
      }
    );
    throw error;
  }
}

export async function updateASGCapacity(
  desiredCapacity: number,
  requestId: string
): Promise<void> {
  const functionName = "updateASGCapacity";
  logger.debug(
    `[${requestId || "system"}] [${functionName}] Updating ASG capacity`,
    { asgName: ASG_NAME, desiredCapacity }
  );

  try {
    const input = {
      AutoScalingGroupName: ASG_NAME,
      DesiredCapacity: desiredCapacity,
      HonorCooldown: false,
    };
    const command = new SetDesiredCapacityCommand(input);
    await autoScalingClient.send(command);

    logger.info(
      `[${requestId || "system"
      }] [${functionName}] Successfully updated ASG capacity`,
      { asgName: ASG_NAME, desiredCapacity }
    );
  } catch (error) {
    logger.error(
      `[${requestId || "system"
      }] [${functionName}] Failed to update ASG capacity`,
      {
        asgName: ASG_NAME,
        desiredCapacity,
        error: error instanceof Error ? error.message : "Unknown error",
      }
    );
    throw error;
  }
}

export async function safelyTerminateInstance(
  instanceId: string,
  requestId: string
): Promise<void> {
  const functionName = "safelyTerminateInstance";
  logger.debug(
    `[${requestId || "system"}] [${functionName}] Terminating instance`,
    { instanceId, asgName: ASG_NAME }
  );

  try {
    await autoScalingClient.send(
      new TerminateInstanceInAutoScalingGroupCommand({
        InstanceId: instanceId,
        ShouldDecrementDesiredCapacity: true,
      })
    );

    logger.info(
      `[${requestId || "system"
      }] [${functionName}] Successfully terminated instance`,
      { instanceId, asgName: ASG_NAME }
    );
  } catch (error) {
    logger.error(
      `[${requestId || "system"
      }] [${functionName}] Failed to terminate instance`,
      {
        instanceId,
        asgName: ASG_NAME,
        error: error instanceof Error ? error.message : "Unknown error",
      }
    );
    throw error;
  }
}

export async function getASGInstancesInfo(
  requestId: string
): Promise<InstanceInfo[]> {
  const functionName = "getASGInstancesInfo";
  logger.debug(
    `[${requestId || "system"}] [${functionName}] Getting ASG instances info`,
    { asgName: ASG_NAME }
  );

  try {
    const asgResponse = await autoScalingClient.send(
      new DescribeAutoScalingGroupsCommand({
        AutoScalingGroupNames: [ASG_NAME],
      })
    );
    const instances = asgResponse.AutoScalingGroups?.[0]?.Instances || [];
    const instanceIds = instances.map((i) => i.InstanceId!).filter(Boolean);

    if (instanceIds.length === 0) {
      logger.info(
        `[${requestId || "system"
        }] [${functionName}] No instances found in ASG`,
        { asgName: ASG_NAME }
      );
      return [];
    }

    const instancesResponse = await ec2Client.send(
      new DescribeInstancesCommand({
        InstanceIds: instanceIds,
      })
    );
    const tagsResponse = await ec2Client.send(
      new DescribeTagsCommand({
        Filters: [
          { Name: "resource-id", Values: instanceIds },
          { Name: "key", Values: ["Owner"] },
        ],
      })
    );

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

    logger.info(
      `[${requestId || "system"}] [${functionName}] Retrieved instances info`,
      {
        asgName: ASG_NAME,
        totalInstances: instancesInfo.length,
        activeInstances: instancesInfo.filter((i) => i.isActive).length,
        warmSpares: instancesInfo.filter((i) => !i.isActive).length,
      }
    );

    return instancesInfo;
  } catch (error) {
    logger.error(
      `[${requestId || "system"
      }] [${functionName}] Failed to get ASG instances info`,
      {
        asgName: ASG_NAME,
        error: error instanceof Error ? error.message : "Unknown error",
      }
    );
    throw error;
  }
}

export async function removeInstanceProtection(
  instanceIds: string[],
  requestId: string
): Promise<void> {
  const functionName = "removeInstanceProtection";

  if (instanceIds.length === 0) {
    logger.debug(
      `[${requestId || "system"}] [${functionName}] No instances to unprotect`
    );
    return;
  }

  logger.debug(
    `[${requestId || "system"
    }] [${functionName}] Removing protection from instances`,
    { instanceCount: instanceIds.length, instanceIds }
  );

  try {
    await autoScalingClient.send(
      new SetInstanceProtectionCommand({
        InstanceIds: instanceIds,
        AutoScalingGroupName: ASG_NAME,
        ProtectedFromScaleIn: false,
      })
    );

    logger.info(
      `[${requestId || "system"
      }] [${functionName}] Successfully removed protection from instances`,
      { instanceCount: instanceIds.length, asgName: ASG_NAME }
    );
  } catch (error) {
    logger.error(
      `[${requestId || "system"
      }] [${functionName}] Failed to remove protection from instances`,
      {
        instanceCount: instanceIds.length,
        asgName: ASG_NAME,
        error: error instanceof Error ? error.message : "Unknown error",
      }
    );
    throw error;
  }
}



/**
 * Setup user workspace using symlinks - SIMPLIFIED VERSION
 */
export async function setupUserWorkspaceSymlink(instanceId: string, userId: string): Promise<void> {
  console.log(`🔗 Setting up symlink workspace for user ${userId} on instance ${instanceId}`);

  const setupScript = `#!/bin/bash
set -e

USER_ID="${userId}"
EFS_USER_DIR="/mnt/efs/\${USER_ID}"
CONTAINER_WORKSPACE="/tmp/custom-workspace"

echo "======================================"
echo "🎯 Setting up workspace for: \${USER_ID}"
echo "======================================"

# Check EFS mount
if ! mountpoint -q /mnt/efs; then
    echo "❌ EFS not mounted"
    exit 1
fi

# Create and setup EFS directory
echo "📁 Setting up EFS directory..."
sudo mkdir -p "\${EFS_USER_DIR}"
sudo chown -R 1000:1000 "\${EFS_USER_DIR}"
sudo chmod -R 755 "\${EFS_USER_DIR}"

# Initialize workspace if new
if [ ! -f "\${EFS_USER_DIR}/.workspace-initialized" ]; then
    echo "🎯 Initializing workspace..."
    sudo -u "#1000" mkdir -p "\${EFS_USER_DIR}"/{projects,temp,bin}
    
    sudo -u "#1000" cat > "\${EFS_USER_DIR}/README.md" << 'EOF'
# Welcome ${userId}!

🎉 Your persistent workspace is ready!

## Directories:
- projects/ - Your coding projects
- temp/ - Temporary files  
- bin/ - Custom scripts

Happy coding! 🚀
EOF

    sudo -u "#1000" mkdir -p "\${EFS_USER_DIR}/projects/hello-world"
    sudo -u "#1000" echo "console.log('Hello from ${userId}!');" > "\${EFS_USER_DIR}/projects/hello-world/index.js"
    sudo -u "#1000" touch "\${EFS_USER_DIR}/.workspace-initialized"
    echo "✅ Workspace initialized"
fi

# Find container
CONTAINER_ID=\$(docker ps --filter "name=code-server" --format "{{.ID}}" | head -1)
if [ -z "\$CONTAINER_ID" ]; then
    echo "❌ No container found"
    exit 1
fi

echo "✅ Found container: \$CONTAINER_ID"

# 🚀 APPROACH 1: Container restart with volume mount (most reliable)
echo "🔄 Restarting container with user workspace..."

# Get current container info
CONTAINER_NAME=\$(docker inspect --format='{{.Name}}' \$CONTAINER_ID | sed 's/^\\///')
CONTAINER_IMAGE=\$(docker inspect --format='{{.Config.Image}}' \$CONTAINER_ID)
ROUTER_URL=\$(docker inspect --format='{{range .Config.Env}}{{if contains . "ROUTER_URL"}}{{.}}{{end}}{{end}}' \$CONTAINER_ID | cut -d'=' -f2)

echo "Container info: \$CONTAINER_NAME, Image: \$CONTAINER_IMAGE"

# Stop current container
echo "🛑 Stopping current container..."
docker stop \$CONTAINER_ID
docker rm \$CONTAINER_ID

# Start new container with user's workspace mounted directly
echo "🚀 Starting container with user workspace..."
docker run -d \\
    --name \$CONTAINER_NAME \\
    --network=host \\
    --restart unless-stopped \\
    -v /mnt/efs:/mnt/efs \\
    -v "\${EFS_USER_DIR}:\${CONTAINER_WORKSPACE}" \\
    -e ROUTER_URL="\$ROUTER_URL" \\
    \$CONTAINER_IMAGE

# Wait for container to start
sleep 5

# Verify new container
NEW_CONTAINER_ID=\$(docker ps --filter "name=\$CONTAINER_NAME" --format "{{.ID}}")
if [ -n "\$NEW_CONTAINER_ID" ]; then
    echo "✅ New container started: \$NEW_CONTAINER_ID"
    
    # Test workspace access
    echo "🔍 Testing workspace access..."
    if docker exec \$NEW_CONTAINER_ID ls \${CONTAINER_WORKSPACE}/README.md >/dev/null 2>&1; then
        echo "✅ Workspace accessible"
        
        # Test write permissions
        if docker exec \$NEW_CONTAINER_ID touch \${CONTAINER_WORKSPACE}/test-write 2>/dev/null; then
            echo "✅ Write permissions OK"
            docker exec \$NEW_CONTAINER_ID rm -f \${CONTAINER_WORKSPACE}/test-write
        else
            echo "⚠️  Write permissions issue, fixing..."
            # Fix permissions from host
            sudo chown -R 1000:1000 "\${EFS_USER_DIR}"
            echo "✅ Permissions fixed"
        fi
        
        # Show workspace contents
        echo "📁 Workspace contents:"
        docker exec \$NEW_CONTAINER_ID ls -la \${CONTAINER_WORKSPACE}/ | head -5
        
    else
        echo "❌ Workspace not accessible"
        exit 1
    fi
else
    echo "❌ Failed to start new container"
    exit 1
fi

echo "======================================"
echo "🎉 Workspace setup complete!"
echo "📁 User workspace: \${EFS_USER_DIR}"
echo "🐳 Container workspace: \${CONTAINER_WORKSPACE}"
echo "======================================"
`;

  try {
    console.log(`📤 Sending simplified SSM command to instance ${instanceId}...`);

    const command = new SendCommandCommand({
      InstanceIds: [instanceId],
      DocumentName: "AWS-RunShellScript",
      Parameters: {
        commands: [setupScript],
        executionTimeout: ["300"]
      },
      TimeoutSeconds: 300
    });

    const response = await ssmClient.send(command);
    const commandId = response.Command?.CommandId;

    if (!commandId) {
      throw new Error("No command ID received from SSM");
    }

    console.log(`✅ SSM command sent: ${commandId}`);
    await waitForSSMCommand(commandId, instanceId);

  } catch (error) {
    console.error(`❌ Failed to setup workspace:`, error);
    throw new Error(`Workspace setup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Wait for SSM command to complete and check status
 */
async function waitForSSMCommand(commandId: string, instanceId: string): Promise<void> {
  const maxAttempts = 30; // 30 attempts * 10 seconds = 5 minutes max
  let attempts = 0;

  while (attempts < maxAttempts) {
    attempts++;

    try {
      const invocation = await ssmClient.send(new GetCommandInvocationCommand({
        CommandId: commandId,
        InstanceId: instanceId
      }));

      const status = invocation.Status;
      console.log(`⏳ SSM Command status (attempt ${attempts}): ${status}`);

      if (status === 'Success') {
        console.log(`✅ SSM command completed successfully`);
        if (invocation.StandardOutputContent) {
          console.log(`📋 Command output:\n${invocation.StandardOutputContent}`);
        }
        return;
      } else if (status === 'Failed') {
        console.error(`❌ SSM command failed`);
        if (invocation.StandardErrorContent) {
          console.error(`Error output:\n${invocation.StandardErrorContent}`);
        }
        if (invocation.StandardOutputContent) {
          console.log(`Output:\n${invocation.StandardOutputContent}`);
        }
        throw new Error(`SSM command failed: ${invocation.StatusDetails || 'Unknown error'}`);
      } else if (status === 'Cancelled' || status === 'TimedOut') {
        throw new Error(`SSM command was ${status.toLowerCase()}`);
      }

      // Wait 10 seconds before next check
      await new Promise(resolve => setTimeout(resolve, 10000));

    } catch (error) {
      if (error instanceof Error && error.name === 'InvocationDoesNotExist') {
        // Command might still be starting
        console.log(`⏳ Command still initializing... (attempt ${attempts})`);
        await new Promise(resolve => setTimeout(resolve, 5000));
        continue;
      }
      throw error;
    }
  }

  throw new Error(`SSM command timed out after ${maxAttempts * 10} seconds`);
}

/**
 * Debug function to check machine state
 */
export async function debugMachineState(instanceId: string): Promise<void> {
  const debugScript = `#!/bin/bash
echo "🔍 Machine State Debug Report"
echo "=============================="
echo "Instance ID: \$(curl -s http://169.254.169.254/latest/meta-data/instance-id 2>/dev/null || echo 'Unknown')"
echo "Timestamp: \$(date)"
echo ""

echo "🐳 Docker Status:"
docker --version
docker info 2>/dev/null | head -5 || echo "Docker not responding"
echo ""

echo "📦 Containers:"
docker ps -a --format "table {{.Names}}\\t{{.Status}}\\t{{.Image}}" || echo "Cannot list containers"
echo ""

echo "🗂️ EFS Status:"
mount | grep efs || echo "No EFS mounts"
echo ""

echo "📁 EFS Contents:"
ls -la /mnt/efs/ 2>/dev/null | head -10 || echo "Cannot access /mnt/efs"
echo ""

echo "🔧 SSM Agent:"
systemctl status amazon-ssm-agent --no-pager -l | head -10
echo ""

echo "💾 Disk Space:"
df -h | grep -E "(Filesystem|/dev/)" || echo "Cannot check disk space"
echo ""

echo "🔍 Process Info:"
ps aux | grep -E "(code-server|docker)" | head -5 || echo "No relevant processes"
`;

  try {
    const command = new SendCommandCommand({
      InstanceIds: [instanceId],
      DocumentName: "AWS-RunShellScript",
      Parameters: {
        commands: [debugScript]
      },
      TimeoutSeconds: 60
    });

    const response = await ssmClient.send(command);
    console.log(`🔍 Debug command sent: ${response.Command?.CommandId}`);
  } catch (error) {
    console.error(`Failed to send debug command:`, error);
  }
}