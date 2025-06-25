import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

interface Props {
  denoDeployKvBackupUser: iam.User;
}

export class DenoKvBackup extends Construct {
  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id);

    const { denoDeployKvBackupUser } = props;

    const bucket = new s3.Bucket(this, "Bucket");

    bucket.grantWrite(denoDeployKvBackupUser);
  }
}
