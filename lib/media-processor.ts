import * as cdk from "aws-cdk-lib";
import { Size } from "aws-cdk-lib";
import * as events from "aws-cdk-lib/aws-events";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { FunctionProps } from "aws-cdk-lib/aws-lambda";
import * as lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";

const SQS_QUEUE_MAX_RECEIVE_COUNT = 3;

type Props = {
  lambdaMemorySize: number;
  lambdaTimeout: number;
  lambdaEphemeralStorageSize?: number;
  sqsVisibilityTimeout: number;
  eventSource: string;
  eventRuleTarget: events.IRuleTarget;
  eventBus: cdk.aws_events.EventBus;
  bucket: s3.Bucket;
  backendGroup: iam.Group;
} & (
  | {
      lambdaPath: string;
      lambdaLayerPath: string;
      lambdaDockerPath?: never;
    }
  | {
      lambdaPath?: never;
      lambdaLayerPath?: never;
      lambdaDockerPath: string;
    }
);

export class MediaProcessor extends Construct {
  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id);

    const {
      lambdaPath,
      lambdaLayerPath,
      lambdaDockerPath,
      lambdaMemorySize,
      lambdaEphemeralStorageSize,
      lambdaTimeout,
      sqsVisibilityTimeout,
      eventBus,
      eventSource,
      eventRuleTarget,
      bucket,
      backendGroup,
    } = props;

    const deadLetterQueue = new sqs.Queue(this, "DeadLetterQueue", {
      retentionPeriod: cdk.Duration.days(14),
    });

    const queue = new sqs.Queue(this, "Queue", {
      visibilityTimeout: cdk.Duration.minutes(sqsVisibilityTimeout),
      deadLetterQueue: {
        queue: deadLetterQueue,
        maxReceiveCount: SQS_QUEUE_MAX_RECEIVE_COUNT,
      },
    });

    let lambdaFn;

    const lambdaProps: Omit<FunctionProps, "code" | "handler"> = {
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.minutes(lambdaTimeout),
      memorySize: lambdaMemorySize,
      ephemeralStorageSize: lambdaEphemeralStorageSize
        ? Size.mebibytes(lambdaEphemeralStorageSize)
        : undefined,
      events: [new lambdaEventSources.SqsEventSource(queue, { batchSize: 1 })],
      environment: {
        SQS_QUEUE_MAX_RECEIVE_COUNT: SQS_QUEUE_MAX_RECEIVE_COUNT.toString(),
        BUCKET_NAME: bucket.bucketName,
        EVENT_BUS_NAME: eventBus.eventBusName,
        EVENT_SOURCE: eventSource,
      },
    };

    if (lambdaPath) {
      const lambdaLayer = new lambda.LayerVersion(this, "LambdaLayer", {
        code: lambda.Code.fromAsset(lambdaLayerPath),
      });
      lambdaFn = new lambda.Function(this, "Lambda", {
        ...lambdaProps,
        handler: "index.handler",
        code: lambda.Code.fromAsset(lambdaPath),
        layers: [lambdaLayer],
      });
    } else {
      lambdaFn = new lambda.DockerImageFunction(this, "Lambda", {
        ...lambdaProps,
        code: lambda.DockerImageCode.fromImageAsset(lambdaDockerPath!),
      });
    }

    new events.Rule(this, "EventRule", {
      targets: [eventRuleTarget],
      eventBus,
      eventPattern: {
        source: [eventSource],
      },
    });

    queue.grantSendMessages(backendGroup);
    bucket.grantReadWrite(lambdaFn);
    eventBus.grantPutEventsTo(lambdaFn);
  }
}
