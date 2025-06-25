import * as cdk from "aws-cdk-lib";
import "source-map-support/register";
import { DevStage } from "../lib/dev-stage";
import { ProdStage } from "../lib/prod-stage";

const app = new cdk.App();

new DevStage(app, "Dev");
new ProdStage(app, "Prod");
