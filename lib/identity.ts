import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

export class Identity extends Construct {
  backendGroup: iam.Group;
  denoDeployKvBackupUser: iam.User;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    const cdkDeploymentGroup = new iam.Group(this, "CdkDeploymentGroup", {
      groupName: "cdk-deployment",
    });

    const backendGroup = new iam.Group(this, "BackendGroup", {
      groupName: "backend",
    });

    const githubUser = new iam.User(this, "GithubUser", {
      userName: "github-user",
    });

    const denoDeployUser = new iam.User(this, "DenoDeployUser", {
      userName: "deno-deploy-user",
    });

    const denoDeployKvBackupUser = new iam.User(this, "DenoDeployKvBackup", {
      userName: "deno-deploy-kv-backup-user",
    });

    cdkDeploymentGroup.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("AdministratorAccess")
    );

    githubUser.addToGroup(cdkDeploymentGroup);
    denoDeployUser.addToGroup(backendGroup);

    this.backendGroup = backendGroup;
    this.denoDeployKvBackupUser = denoDeployKvBackupUser;
  }
}
