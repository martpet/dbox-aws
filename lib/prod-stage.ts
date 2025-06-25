import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { DboxStack } from "./dbox-stack";

export class ProdStage extends cdk.Stage {
  constructor(scope: Construct, id: string) {
    super(scope, id);
    new DboxStack(this, "Dbox");
  }
}
