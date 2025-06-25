import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import { APP_DOMAIN, ASSETS_DOMAIN } from "./consts";

interface Props {
  isProd: boolean;
  backendGroup: iam.Group;
}

export class FileNodesStorage extends Construct {
  bucket: s3.Bucket;
  bucketCors: {
    allowedOrigins: string[];
    allowedHeaders: string[];
    allowedMethods: string[];
    exposedHeaders: string[];
  };

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id);

    const { isProd, backendGroup } = props;

    const bucketName = isProd ? "uploads-dbox-im" : "uploads-dev-dbox-im";

    const bucket = new s3.Bucket(this, "Bucket", {
      bucketName,
      enforceSSL: true,
      transferAcceleration: true,
    });

    const allowedOrigins = isProd
      ? [`https://${APP_DOMAIN}`, `https://${ASSETS_DOMAIN}`]
      : ["*"];

    const bucketCors = {
      allowedOrigins,
      allowedHeaders: ["*"],
      allowedMethods: [
        s3.HttpMethods.GET,
        s3.HttpMethods.PUT,
        s3.HttpMethods.POST,
        s3.HttpMethods.DELETE,
        s3.HttpMethods.HEAD,
      ],
      exposedHeaders: ["ETag"],
    };

    bucket.addCorsRule(bucketCors);

    bucket.addLifecycleRule({
      abortIncompleteMultipartUploadAfter: cdk.Duration.days(1),
    });

    bucket.grantReadWrite(backendGroup);

    this.bucket = bucket;
    this.bucketCors = bucketCors;
  }
}
