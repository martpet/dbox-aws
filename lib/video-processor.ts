import { Stack } from "aws-cdk-lib";
import * as events from "aws-cdk-lib/aws-events";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

interface Props {
  fileNodesBucket: s3.Bucket;
  webhookEventTarget: events.IRuleTarget;
  backendGroup: iam.Group;
}

export class VideoProcessor extends Construct {
  policy: iam.Policy;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id);

    const { webhookEventTarget, fileNodesBucket, backendGroup } = props;
    const { region, account } = Stack.of(this);

    backendGroup.addToPolicy(
      new iam.PolicyStatement({
        actions: ["mediaconvert:CreateJob"],
        resources: [`arn:aws:mediaconvert:${region}:${account}:queues/Default`],
      })
    );

    backendGroup.addToPolicy(
      new iam.PolicyStatement({
        actions: ["mediaconvert:CancelJob"],
        resources: [`arn:aws:mediaconvert:${region}:${account}:jobs/*`],
      })
    );

    const mediaConvertRole = new iam.Role(this, "MediaConvertRole", {
      assumedBy: new iam.ServicePrincipal("mediaconvert.amazonaws.com"),
    });

    mediaConvertRole.grantPassRole(backendGroup);
    fileNodesBucket.grantReadWrite(mediaConvertRole);

    new events.Rule(this, "ProgressEventRule", {
      targets: [webhookEventTarget],
      eventPattern: {
        source: ["aws.mediaconvert"],
        detailType: ["MediaConvert Job State Change"],
        detail: { status: ["STATUS_UPDATE"] },
      },
    });

    new events.Rule(this, "CompleteEventRule", {
      targets: [webhookEventTarget],
      eventPattern: {
        source: ["aws.mediaconvert"],
        detailType: ["MediaConvert Job State Change"],
        detail: { status: ["COMPLETE"] },
      },
    });

    new events.Rule(this, "ErrorEventRule", {
      targets: [webhookEventTarget],
      eventPattern: {
        source: ["aws.mediaconvert"],
        detailType: ["MediaConvert Job State Change"],
        detail: { status: ["ERROR"] },
      },
    });
  }
}
