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
import { SendCommandCommand } from "@aws-sdk/client-ssm";

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
 * Setup user workspace using symlinks - NO CONTAINER RESTART
*/
export async function setupUserWorkspaceSymlink(instanceId: string, userId: string): Promise<void> {
  console.log(`🔗 Setting up symlink workspace for user ${userId} on instance ${instanceId}`);

  const setupScript = `#!/bin/bash
set -e

USER_ID="${userId}"
EFS_USER_DIR="/mnt/efs/\${USER_ID}"
CONTAINER_WORKSPACE="/tmp/custom-workspace"

echo "🎯 Setting up symlink workspace for user: \${USER_ID}"

# Create user directory on EFS
sudo mkdir -p "\${EFS_USER_DIR}"
sudo chown 1000:1000 "\${EFS_USER_DIR}"  # coder user UID:GID

# Initialize workspace if new user
if [ ! -f "\${EFS_USER_DIR}/.workspace-initialized" ]; then
    echo "🎯 Initializing new workspace for \${USER_ID}..."
    
    # Create directory structure
    sudo -u "#1000" mkdir -p "\${EFS_USER_DIR}"/{projects,temp,bin}
    
    # Create welcome file
    sudo -u "#1000" cat > "\${EFS_USER_DIR}/README.md" << 'EOF'
# Welcome ${userId}!

🎉 This is your persistent workspace powered by AWS EFS.

## What's persistent:
- ✅ All your files and folders
- ✅ VS Code settings and extensions
- ✅ Terminal history and configurations
- ✅ Git repositories and commit history

## Directory Structure:
- \`projects/\` - Your coding projects
- \`temp/\` - Temporary files
- \`bin/\` - Custom scripts and tools

## Getting Started:
1. Open the \`projects\` folder
2. Create a new project: \`mkdir projects/my-awesome-project\`
3. Start coding! Everything is automatically saved.

Your workspace will be exactly the same every time you get a new machine.

Happy coding! 🚀
EOF

    # Create sample project
    sudo -u "#1000" mkdir -p "\${EFS_USER_DIR}/projects/hello-world"
    sudo -u "#1000" cat > "\${EFS_USER_DIR}/projects/hello-world/index.js" << 'EOF'
// Welcome to your persistent workspace!
console.log('Hello from ${userId}!');
console.log('This file will persist across sessions 🎉');

// Try creating more files - they'll all be saved automatically
// Your workspace follows you across different machines!

const message = 'Your persistent development environment is ready!';
console.log(message);
EOF

    # Create .gitconfig if it doesn't exist
    if [ ! -f "\${EFS_USER_DIR}/.gitconfig" ]; then
        sudo -u "#1000" cat > "\${EFS_USER_DIR}/.gitconfig" << 'EOF'
[user]
    name = ${userId}
    email = ${userId}@workspace.local
[init]
    defaultBranch = main
[core]
    editor = code
EOF
    fi
    
    # Mark as initialized
    sudo -u "#1000" touch "\${EFS_USER_DIR}/.workspace-initialized"
    
    echo "✅ Workspace initialized for \${USER_ID}"
else
    echo "📂 Using existing workspace for \${USER_ID}"
fi

# 🎯 KEY: Replace workspace with symlink (NO RESTART NEEDED)
echo "🔗 Creating symlink to user's EFS directory..."

# Get container ID
CONTAINER_ID=\$(docker ps --filter "name=code-server-warm" --format "{{.ID}}")

if [ -n "\$CONTAINER_ID" ]; then
    # Execute inside the running container to set up the symlink
    sudo docker exec -u root \$CONTAINER_ID bash -c "
        echo 'Setting up workspace symlink inside container...'
        
        # Remove the existing workspace directory/symlink
        rm -rf \${CONTAINER_WORKSPACE}
        
        # Create symlink to user's EFS directory
        ln -sf \${EFS_USER_DIR} \${CONTAINER_WORKSPACE}
        
        # Verify symlink
        if [ -L \${CONTAINER_WORKSPACE} ]; then
            echo '✅ Symlink created successfully'
            ls -la \${CONTAINER_WORKSPACE}/
        else
            echo '❌ Failed to create symlink'
            exit 1
        fi
    "
    
    echo "✅ User \${USER_ID} workspace ready - NO RESTART NEEDED!"
    echo "📁 Workspace location: \${CONTAINER_WORKSPACE} -> \${EFS_USER_DIR}"
else
    echo "❌ Container 'code-server-warm' not found"
    exit 1
fi

echo "🎉 Symlink workspace setup complete for \${USER_ID}"
`;

  try {
    const command = new SendCommandCommand({
      InstanceIds: [instanceId],
      DocumentName: "AWS-RunShellScript",
      Parameters: {
        commands: [setupScript]
      },
      TimeoutSeconds: 120
    });

    const response = await ssmClient.send(command);
    console.log(`✅ SSM command sent for symlink setup: ${response.Command?.CommandId}`);

    // Wait a moment for setup to complete
    await new Promise(resolve => setTimeout(resolve, 5000));

  } catch (error) {
    console.error(`Failed to setup workspace via symlink:`, error);
    throw new Error(`Symlink workspace setup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}