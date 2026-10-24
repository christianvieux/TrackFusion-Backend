resource "aws_iam_role_policy_attachment" "api_ssm" {
  role       = aws_iam_role.api.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

data "aws_iam_policy_document" "github_deploy_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repository}:environment:${var.github_environment}"]
    }
  }
}

resource "aws_ssm_document" "deploy" {
  name            = "TrackFusionWeb-Deploy"
  document_type   = "Command"
  document_format = "JSON"

  content = jsonencode({
    schemaVersion = "2.2"
    description   = "Install a checksum-verified TrackFusionWeb API release from S3"
    parameters = {
      BucketName = {
        type           = "String"
        allowedPattern = "^[a-z0-9.-]+$"
      }
      ObjectKey = {
        type           = "String"
        allowedPattern = "^deployments/[0-9a-f]{40}\\.tar\\.gz$"
      }
      Checksum = {
        type           = "String"
        allowedPattern = "^[0-9a-f]{64}$"
      }
      ReleaseId = {
        type           = "String"
        allowedPattern = "^[0-9a-f]{40}$"
      }
    }
    mainSteps = [
      {
        action = "aws:runShellScript"
        name   = "deploy"
        inputs = {
          timeoutSeconds = "900"
          runCommand = [
            "set -eu",
            "archive='/tmp/trackfusionweb-{{ ReleaseId }}.tar.gz'",
            "staging='/tmp/trackfusionweb-{{ ReleaseId }}'",
            "/usr/local/bin/node /opt/trackfusion/api/scripts/downloadDeployment.js '{{ BucketName }}' '{{ ObjectKey }}' \"$archive\"",
            "printf '%s  %s\\n' '{{ Checksum }}' \"$archive\" | sha256sum --check --strict",
            "install -d -m 0755 \"$staging\"",
            "tar --no-same-owner --no-same-permissions -xzf \"$archive\" -C \"$staging\"",
            "test -f \"$staging/package-lock.json\"",
            "test -f \"$staging/deploy/ec2/configure-app.sh\"",
            "rsync -a --delete --exclude=venv --exclude=node_modules --exclude=uploads \"$staging/\" /opt/trackfusion/api/",
            "bash /opt/trackfusion/api/deploy/ec2/configure-app.sh",
            "curl -fsS http://127.0.0.1/health",
            "rm -f \"$archive\"",
            "rm -rf \"$staging\""
          ]
        }
      }
    ]
  })
}

data "aws_iam_policy_document" "github_deploy" {
  statement {
    sid    = "DeploymentArtifactAccess"
    effect = "Allow"
    actions = [
      "s3:PutObject",
      "s3:DeleteObject",
    ]
    resources = ["arn:aws:s3:::${var.audio_bucket_name}/deployments/*"]
  }

  statement {
    sid     = "RunDeploymentDocument"
    effect  = "Allow"
    actions = ["ssm:SendCommand"]
    resources = [
      "arn:aws:ssm:${var.aws_region}:${var.aws_account_id}:document/TrackFusionWeb-Deploy",
      "arn:aws:ec2:${var.aws_region}:${var.aws_account_id}:instance/${aws_instance.api.id}",
    ]
  }

  statement {
    sid    = "ReadDeploymentResult"
    effect = "Allow"
    actions = [
      "ssm:GetCommandInvocation",
      "ssm:ListCommandInvocations",
    ]
    resources = ["*"]
  }

  statement {
    sid       = "DiscoverDeploymentInstance"
    effect    = "Allow"
    actions   = ["ec2:DescribeInstances"]
    resources = ["*"]
  }
}

resource "aws_iam_policy" "github_deploy" {
  name        = "TrackFusionWeb-GitHub-Deploy_Policy"
  description = "Allows the TrackFusionWeb GitHub workflow to deploy a verified release to the API instance."
  policy      = data.aws_iam_policy_document.github_deploy.json
}

resource "aws_iam_role" "github_deploy" {
  name                 = "TrackFusionWeb-GitHub-Deploy_Role"
  description          = "Short-lived GitHub Actions role for TrackFusionWeb production deployments."
  assume_role_policy   = data.aws_iam_policy_document.github_deploy_trust.json
  max_session_duration = 3600
}

resource "aws_iam_role_policy_attachment" "github_deploy" {
  role       = aws_iam_role.github_deploy.name
  policy_arn = aws_iam_policy.github_deploy.arn
}
