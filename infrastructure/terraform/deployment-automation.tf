locals {
  terraform_state_bucket = "trackfusionweb-terraform-state-020457827871-us-east-1"
  terraform_state_key    = "trackfusionweb/api/terraform.tfstate"

  production_secret_parameter_names = toset([
    "/trackfusionweb/production/api/SESSION_SECRET",
    "/trackfusionweb/production/api/JWT_SECRET",
    "/trackfusionweb/production/api/DATABASE_URL",
    "/trackfusionweb/production/api/RESEND_API_KEY",
  ])
  production_secret_parameter_arns = toset([
    for name in local.production_secret_parameter_names :
    "arn:aws:ssm:${var.aws_region}:${var.aws_account_id}:parameter${name}"
  ])
}

# Parameter values are intentionally not Terraform resources. Managing a
# SecureString value here would copy plaintext into Terraform state.
resource "aws_kms_key" "production_parameters" {
  description             = "Encrypts the allowlisted TrackFusionWeb production SecureString parameters."
  enable_key_rotation     = true
  deletion_window_in_days = 30

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_kms_alias" "production_parameters" {
  name          = "alias/TrackFusionWeb-Production-Parameters"
  target_key_id = aws_kms_key.production_parameters.key_id
}

# GitHub artifacts are encrypted client-side before upload. The plan job can
# generate a data key but cannot decrypt it; only the reviewer-gated apply role
# can decrypt the data key under the required encryption context.
resource "aws_kms_key" "terraform_plan_artifacts" {
  description             = "Protects encrypted TrackFusionWeb Terraform plan artifacts between GitHub jobs."
  enable_key_rotation     = true
  deletion_window_in_days = 30

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_kms_alias" "terraform_plan_artifacts" {
  name          = "alias/TrackFusionWeb-Terraform-Plans"
  target_key_id = aws_kms_key.terraform_plan_artifacts.key_id
}

data "aws_iam_policy_document" "github_terraform_plan_trust" {
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
      values   = [local.github_oidc_subjects.plan]
    }
  }
}

data "aws_iam_policy_document" "github_terraform_apply_trust" {
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
      values   = [local.github_oidc_subjects.infrastructure]
    }
  }
}

resource "aws_iam_role" "github_terraform_plan" {
  name                 = "TrackFusionWeb-GitHub-Terraform-Plan_Role"
  description          = "Read-only production Terraform planning and encrypted plan creation from GitHub Actions."
  assume_role_policy   = data.aws_iam_policy_document.github_terraform_plan_trust.json
  max_session_duration = 3600
}

resource "aws_iam_role" "github_terraform_apply" {
  name                 = "TrackFusionWeb-GitHub-Terraform-Apply_Role"
  description          = "Reviewer-gated application of a previously encrypted and approved Terraform plan."
  assume_role_policy   = data.aws_iam_policy_document.github_terraform_apply_trust.json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "terraform_state_plan" {
  statement {
    sid       = "ListStatePath"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = ["arn:aws:s3:::${local.terraform_state_bucket}"]

    condition {
      test     = "StringEquals"
      variable = "s3:prefix"
      values   = [local.terraform_state_key]
    }
  }

  statement {
    sid       = "ReadState"
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["arn:aws:s3:::${local.terraform_state_bucket}/${local.terraform_state_key}"]
  }

  statement {
    sid    = "UseStateLock"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
    ]
    resources = ["arn:aws:s3:::${local.terraform_state_bucket}/${local.terraform_state_key}.tflock"]
  }
}

data "aws_iam_policy_document" "terraform_state_apply" {
  statement {
    sid       = "ListStatePath"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = ["arn:aws:s3:::${local.terraform_state_bucket}"]

    condition {
      test     = "StringEquals"
      variable = "s3:prefix"
      values   = [local.terraform_state_key]
    }
  }

  statement {
    sid    = "ReadWriteState"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
    ]
    resources = ["arn:aws:s3:::${local.terraform_state_bucket}/${local.terraform_state_key}"]
  }

  statement {
    sid    = "UseStateLock"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
    ]
    resources = ["arn:aws:s3:::${local.terraform_state_bucket}/${local.terraform_state_key}.tflock"]
  }
}

resource "aws_iam_policy" "terraform_state_plan" {
  name        = "TrackFusionWeb-Terraform-State-Plan_Policy"
  description = "Read production Terraform state and use only its native S3 lockfile."
  policy      = data.aws_iam_policy_document.terraform_state_plan.json
}

resource "aws_iam_policy" "terraform_state_apply" {
  name        = "TrackFusionWeb-Terraform-State-Apply_Policy"
  description = "Read and update production Terraform state while using its native S3 lockfile."
  policy      = data.aws_iam_policy_document.terraform_state_apply.json
}

data "aws_iam_policy_document" "terraform_refresh" {
  statement {
    sid       = "VerifyCaller"
    effect    = "Allow"
    actions   = ["sts:GetCallerIdentity"]
    resources = ["*"]
  }

  statement {
    sid       = "ReadEc2Configuration"
    effect    = "Allow"
    actions   = ["ec2:Describe*"]
    resources = ["*"]
  }

  statement {
    sid    = "ReadMediaBucketConfiguration"
    effect = "Allow"
    actions = [
      "s3:GetAccelerateConfiguration",
      "s3:GetBucket*",
      "s3:GetEncryptionConfiguration",
      "s3:GetLifecycleConfiguration",
      "s3:GetObjectLockConfiguration",
      "s3:GetReplicationConfiguration",
      "s3:ListBucket",
    ]
    resources = ["arn:aws:s3:::${var.audio_bucket_name}"]
  }

  statement {
    sid    = "ReadTrackFusionRoles"
    effect = "Allow"
    actions = [
      "iam:GetRole",
      "iam:ListAttachedRolePolicies",
      "iam:ListRolePolicies",
      "iam:ListRoleTags",
    ]
    resources = ["arn:aws:iam::${var.aws_account_id}:role/TrackFusionWeb-*"]
  }

  statement {
    sid    = "ReadTrackFusionPolicies"
    effect = "Allow"
    actions = [
      "iam:GetPolicy",
      "iam:GetPolicyVersion",
      "iam:ListPolicyTags",
      "iam:ListPolicyVersions",
    ]
    resources = ["arn:aws:iam::${var.aws_account_id}:policy/TrackFusionWeb-*"]
  }

  statement {
    sid    = "ReadTrackFusionInstanceProfile"
    effect = "Allow"
    actions = [
      "iam:GetInstanceProfile",
      "iam:ListInstanceProfileTags",
    ]
    resources = ["arn:aws:iam::${var.aws_account_id}:instance-profile/TrackFusionWeb-*"]
  }

  statement {
    sid    = "ReadGitHubOidcProvider"
    effect = "Allow"
    actions = [
      "iam:GetOpenIDConnectProvider",
      "iam:ListOpenIDConnectProviderTags",
    ]
    resources = [aws_iam_openid_connect_provider.github.arn]
  }

  statement {
    sid    = "ReadDeploymentDocument"
    effect = "Allow"
    actions = [
      "ssm:DescribeDocument",
      "ssm:DescribeDocumentPermission",
      "ssm:GetDocument",
      "ssm:ListTagsForResource",
    ]
    resources = [aws_ssm_document.deploy.arn]
  }

  statement {
    sid    = "ReadMonitoringConfiguration"
    effect = "Allow"
    actions = [
      "cloudwatch:DescribeAlarms",
      "cloudwatch:ListTagsForResource",
      "sns:GetSubscriptionAttributes",
      "sns:GetTopicAttributes",
      "sns:ListSubscriptionsByTopic",
      "sns:ListTagsForResource",
    ]
    resources = ["*"]
  }

  statement {
    sid    = "ReadManagedKeyMetadata"
    effect = "Allow"
    actions = [
      "kms:DescribeKey",
      "kms:GetKeyPolicy",
      "kms:GetKeyRotationStatus",
      "kms:ListResourceTags",
    ]
    resources = [
      aws_kms_key.production_parameters.arn,
      aws_kms_key.terraform_plan_artifacts.arn,
    ]
  }

  # ListAliases does not support resource-level permissions. The provider uses
  # it to refresh only the two alias resources declared by this configuration.
  statement {
    sid       = "ReadManagedKeyAliases"
    effect    = "Allow"
    actions   = ["kms:ListAliases"]
    resources = ["*"]
  }
}

resource "aws_iam_policy" "terraform_refresh" {
  name        = "TrackFusionWeb-Terraform-Refresh_Policy"
  description = "Read only the AWS resource families represented in TrackFusionWeb Terraform state."
  policy      = data.aws_iam_policy_document.terraform_refresh.json
}

data "aws_iam_policy_document" "terraform_plan_encryption" {
  statement {
    sid       = "CreateEncryptedPlanDataKey"
    effect    = "Allow"
    actions   = ["kms:GenerateDataKey"]
    resources = [aws_kms_key.terraform_plan_artifacts.arn]

    condition {
      test     = "StringEquals"
      variable = "kms:EncryptionContext:Repository"
      values   = [var.github_repository]
    }

    condition {
      test     = "StringEquals"
      variable = "kms:EncryptionContext:Purpose"
      values   = ["TerraformPlan"]
    }
  }
}

data "aws_iam_policy_document" "terraform_plan_decryption" {
  statement {
    sid       = "DecryptApprovedPlanDataKey"
    effect    = "Allow"
    actions   = ["kms:Decrypt"]
    resources = [aws_kms_key.terraform_plan_artifacts.arn]

    condition {
      test     = "StringEquals"
      variable = "kms:EncryptionContext:Repository"
      values   = [var.github_repository]
    }

    condition {
      test     = "StringEquals"
      variable = "kms:EncryptionContext:Purpose"
      values   = ["TerraformPlan"]
    }
  }
}

resource "aws_iam_policy" "terraform_plan_encryption" {
  name        = "TrackFusionWeb-Terraform-Plan-Encrypt_Policy"
  description = "Creates data keys for client-side encryption of production Terraform plans."
  policy      = data.aws_iam_policy_document.terraform_plan_encryption.json
}

resource "aws_iam_policy" "terraform_plan_decryption" {
  name        = "TrackFusionWeb-Terraform-Plan-Decrypt_Policy"
  description = "Decrypts data keys only after the production infrastructure approval gate."
  policy      = data.aws_iam_policy_document.terraform_plan_decryption.json
}

data "aws_iam_policy_document" "terraform_apply" {
  statement {
    sid    = "UpdateMediaBucketConfiguration"
    effect = "Allow"
    actions = [
      "s3:PutBucketCORS",
      "s3:PutBucketEncryption",
      "s3:PutBucketOwnershipControls",
      "s3:PutBucketPublicAccessBlock",
      "s3:PutBucketTagging",
    ]
    resources = ["arn:aws:s3:::${var.audio_bucket_name}"]
  }

  statement {
    sid    = "UpdateApiInstance"
    effect = "Allow"
    actions = [
      "ec2:CreateTags",
      "ec2:DeleteTags",
      "ec2:ModifyInstanceAttribute",
      "ec2:ModifyInstanceCreditSpecification",
      "ec2:ModifyInstanceMetadataOptions",
      "ec2:StartInstances",
      "ec2:StopInstances",
    ]
    resources = [aws_instance.api.arn]
  }

  statement {
    sid    = "UpdateApiSecurityGroup"
    effect = "Allow"
    actions = [
      "ec2:AuthorizeSecurityGroupEgress",
      "ec2:AuthorizeSecurityGroupIngress",
      "ec2:CreateTags",
      "ec2:DeleteTags",
      "ec2:ModifySecurityGroupRules",
      "ec2:RevokeSecurityGroupEgress",
      "ec2:RevokeSecurityGroupIngress",
    ]
    resources = [aws_security_group.api.arn]
  }

  statement {
    sid    = "UpdateDeploymentDocument"
    effect = "Allow"
    actions = [
      "ssm:AddTagsToResource",
      "ssm:RemoveTagsFromResource",
      "ssm:UpdateDocument",
      "ssm:UpdateDocumentDefaultVersion",
    ]
    resources = [aws_ssm_document.deploy.arn]
  }

  statement {
    sid    = "UpdateMonitoring"
    effect = "Allow"
    actions = [
      "cloudwatch:PutMetricAlarm",
      "cloudwatch:TagResource",
      "cloudwatch:UntagResource",
      "sns:CreateTopic",
      "sns:SetTopicAttributes",
      "sns:Subscribe",
      "sns:TagResource",
      "sns:UntagResource",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_policy" "terraform_apply" {
  name        = "TrackFusionWeb-Terraform-Apply_Policy"
  description = "Applies approved non-destructive changes to the currently declared infrastructure; IAM and KMS remain bootstrap-only."
  policy      = data.aws_iam_policy_document.terraform_apply.json
}

resource "aws_iam_role_policy_attachment" "terraform_plan_state" {
  role       = aws_iam_role.github_terraform_plan.name
  policy_arn = aws_iam_policy.terraform_state_plan.arn
}

resource "aws_iam_role_policy_attachment" "terraform_plan_refresh" {
  role       = aws_iam_role.github_terraform_plan.name
  policy_arn = aws_iam_policy.terraform_refresh.arn
}

resource "aws_iam_role_policy_attachment" "terraform_plan_encrypt" {
  role       = aws_iam_role.github_terraform_plan.name
  policy_arn = aws_iam_policy.terraform_plan_encryption.arn
}

resource "aws_iam_role_policy_attachment" "terraform_apply_state" {
  role       = aws_iam_role.github_terraform_apply.name
  policy_arn = aws_iam_policy.terraform_state_apply.arn
}

resource "aws_iam_role_policy_attachment" "terraform_apply_refresh" {
  role       = aws_iam_role.github_terraform_apply.name
  policy_arn = aws_iam_policy.terraform_refresh.arn
}

resource "aws_iam_role_policy_attachment" "terraform_apply_changes" {
  role       = aws_iam_role.github_terraform_apply.name
  policy_arn = aws_iam_policy.terraform_apply.arn
}

resource "aws_iam_role_policy_attachment" "terraform_apply_decrypt" {
  role       = aws_iam_role.github_terraform_apply.name
  policy_arn = aws_iam_policy.terraform_plan_decryption.arn
}
