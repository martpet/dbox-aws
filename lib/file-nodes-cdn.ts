import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import { APP_DOMAIN } from "./consts";
import { FileNodesStorage } from "./file-nodes-storage";

const DOWNLOAD_URL_PARAM = "download";

interface Props {
  isProd: boolean;
  fileNodesBucket: s3.Bucket;
  fileNodesBucketCors: FileNodesStorage["bucketCors"];
}

export class FileNodesCdn extends Construct {
  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id);

    const { fileNodesBucket, fileNodesBucketCors, isProd } = props;
    const encodedKey = process.env.AWS_CLOUDFRONT_SIGNER_PUBKEY;

    if (!encodedKey) {
      throw new Error("Missing AWS_CLOUDFRONT_SIGNER_PUBKEY env var");
    }

    const domainName = isProd
      ? `uploads.${APP_DOMAIN}`
      : `uploads.dev.${APP_DOMAIN}`;

    const pubKey = new cloudfront.PublicKey(this, "PubKey", { encodedKey });
    const keyGroup = new cloudfront.KeyGroup(this, "KeyGroup", {
      items: [pubKey],
    });

    const responseHeadersPolicy = new cloudfront.ResponseHeadersPolicy(
      this,
      "RespHeadersPolicy",
      {
        corsBehavior: {
          accessControlAllowCredentials: false,
          accessControlAllowMethods: fileNodesBucketCors.allowedMethods,
          accessControlAllowOrigins: fileNodesBucketCors.allowedOrigins,
          accessControlAllowHeaders: fileNodesBucketCors.allowedHeaders,
          originOverride: true,
        },
        securityHeadersBehavior: {
          contentTypeOptions: { override: true },
        },
        customHeadersBehavior: {
          customHeaders: [
            {
              header: "Cache-Control",
              value: `public, max-age=31536000, immutable`,
              override: true,
            },
            {
              header: "No-Vary-Search", // https://chromestatus.com/feature/5808599110254592
              value: `params, except=("${DOWNLOAD_URL_PARAM}")`,
              override: true,
            },
          ],
        },
      }
    );

    const cachePolicy = new cloudfront.CachePolicy(this, "CachePolicy", {
      queryStringBehavior:
        cloudfront.CacheQueryStringBehavior.allowList(DOWNLOAD_URL_PARAM),
      enableAcceptEncodingBrotli: true,
    });

    const fn = new cloudfront.Function(this, "Function", {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(`
        function handler(event) {
          var req = event.request;
          var resp = event.response;
          var isDownload = req.querystring.${DOWNLOAD_URL_PARAM} && req.querystring.${DOWNLOAD_URL_PARAM}.value;
          if (isDownload) {
            var headers = resp.headers;
            var cdHeader = headers["content-disposition"] && headers["content-disposition"].value;
            if (cdHeader) {
              headers["content-disposition"].value = cdHeader.replace("inline", "attachment");
            }
          }
          return resp;
        }
      `),
    });

    const certificate = new acm.Certificate(this, "Certificate", {
      domainName,
      validation: acm.CertificateValidation.fromDns(),
    });

    new cloudfront.Distribution(this, "Distribution", {
      domainNames: [domainName],
      certificate,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(fileNodesBucket),
        trustedKeyGroups: [keyGroup],
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        responseHeadersPolicy,
        cachePolicy,
        functionAssociations: [
          {
            function: fn,
            eventType: cloudfront.FunctionEventType.VIEWER_RESPONSE,
          },
        ],
      },
    });
  }
}
