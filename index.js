import * as core from "@actions/core";
import { ECS, waitUntilTasksStopped } from "@aws-sdk/client-ecs";

const ecs = new ECS();

const main = async () => {
  const cluster = core.getInput("cluster", { required: true });
  const service = core.getInput("service", { required: true });

  const overrideContainer = core.getInput("override-container", {
    required: false,
  });

  try {
    // Get network configuration from aws directly from describe services
    core.debug("Getting information from service...");
    const info = await ecs.describeServices({ cluster, services: [service] });

    if (!info || !info.services[0]) {
      throw new Error(`Could not find service ${service} in cluster ${cluster}`);
    }

    if (!info.services[0].networkConfiguration) {
      throw new Error(`Service ${service} in cluster ${cluster} does not have a network configuration`);
    }

    const taskDefinition = info.services[0].taskDefinition;
    const networkConfiguration = info.services[0].networkConfiguration;
    core.setOutput("task-definition", taskDefinition);

    const overrideContainerCommand = core.getMultilineInput(
      "override-container-command",
      {
        required: false,
      }
    );

    const taskParams = {
      taskDefinition,
      cluster,
      launchType: "FARGATE",
      networkConfiguration,
    };

    if (overrideContainerCommand.length > 0 && !overrideContainer) {
      throw new Error(
        "override-container is required when override-container-command is set"
      );
    }

    if (overrideContainer) {
      if (overrideContainerCommand) {
        taskParams.overrides = {
          containerOverrides: [
            {
              name: overrideContainer,
              command: overrideContainerCommand,
            },
          ],
        };
      } else {
        throw new Error(
          "override-container-command is required when override-container is set"
        );
      }
    }

    core.debug("Running task...");
    let task = await ecs.runTask(taskParams);
    const taskArn = task.tasks[0].taskArn;
    core.setOutput("task-arn", taskArn);

    core.info(
      `Task logs on Amazon ECS console: https://console.aws.amazon.com/ecs/v2/clusters/${cluster}/tasks/${taskArn.split("/").pop()}/logs?region=${process.env.AWS_REGION}`
    );

    core.debug("Waiting for task to finish...");
    await waitUntilTasksStopped({
      client: ecs,
      maxWaitTime: 300, // 5 minutes
    }, {
      cluster,
      tasks: [taskArn],
    });

    core.debug("Checking status of task");
    task = await ecs.describeTasks({ cluster, tasks: [taskArn] });
    const exitCode = task.tasks[0].containers[0].exitCode;

    if (exitCode === 0) {
      core.setOutput("status", "success");
    } else {
      core.setFailed(task.tasks[0].stoppedReason);
    }
  } catch (error) {
    core.setFailed(error);
  }
};

main();
