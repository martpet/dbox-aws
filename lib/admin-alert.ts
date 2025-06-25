import * as iam from "aws-cdk-lib/aws-iam";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import { Construct } from "constructs";

interface Props {
  backendGroup: iam.Group;
}

export class AdminAlert extends Construct {
  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id);

    const { backendGroup } = props;

    if (!process.env.SUPER_ADMIN_PHONE) {
      throw new Error("Missing SUPER_ADMIN_PHONE env var");
    }

    if (!process.env.SUPER_ADMIN_EMAIL) {
      throw new Error("Missing SUPER_ADMIN_EMAIL env var");
    }

    const smsTopic = new sns.Topic(this, "SmsTopic");
    const emailTopic = new sns.Topic(this, "EmailTopic");

    smsTopic.grantPublish(backendGroup);
    emailTopic.grantPublish(backendGroup);

    smsTopic.addSubscription(
      new subscriptions.SmsSubscription(process.env.SUPER_ADMIN_PHONE)
    );

    emailTopic.addSubscription(
      new subscriptions.EmailSubscription(process.env.SUPER_ADMIN_EMAIL)
    );
  }
}
