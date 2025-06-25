import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import { APP_DOMAIN, WEBHOOKS_PATH } from "./consts";

interface Props {
  isProd: boolean;
}

export class Webhook extends Construct {
  eventTarget: events.IRuleTarget;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id);

    const { isProd } = props;
    const secret = new secretsmanager.Secret(this, "Secret");

    const connection = new events.Connection(this, "Connection", {
      authorization: events.Authorization.apiKey(
        "x-api-key",
        secret.secretValue
      ),
    });

    if (isProd) {
      const destination = new events.ApiDestination(this, "Destination", {
        connection,
        endpoint: `https://${APP_DOMAIN}${WEBHOOKS_PATH}`,
        httpMethod: events.HttpMethod.POST,
      });
      this.eventTarget = new targets.ApiDestination(destination);
    } else {
      const fn = new lambda.Function(this, "LambdaProxy", {
        runtime: lambda.Runtime.NODEJS_18_X,
        handler: "index.handler",
        environment: { API_KEY: secret.secretValue.unsafeUnwrap() },
        code: lambda.Code.fromInline(`
          exports.handler = async function(event) {
            const { detail } = event;
            const appUrl = detail.appUrl || detail.userMetadata?.appUrl || detail.data?.object?.metadata?.appUrl;
            if (!appUrl) throw new Error("Missing appUrl");
            const resp = await fetch(appUrl + "${WEBHOOKS_PATH}", {
              body: JSON.stringify(event),
              method: "post",
              headers: { 'x-api-key': process.env.API_KEY }
            })
            if (!resp.ok) {
              throw new Error('response status', resp.status)
            };
          };
        `),
      });
      this.eventTarget = new targets.LambdaFunction(fn);
    }
  }
}
