data "aws_iam_policy_document" "ec2_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "api" {
  statement {
    sid    = "TrackFusionAudioObjectAccess"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
    ]
    resources = ["arn:aws:s3:::${var.audio_bucket_name}/*"]
  }

  statement {
    sid       = "ReadAllowlistedProductionParameters"
    effect    = "Allow"
    actions   = ["ssm:GetParameters"]
    resources = local.production_secret_parameter_arns
  }

  statement {
    sid       = "DecryptAllowlistedProductionParameters"
    effect    = "Allow"
    actions   = ["kms:Decrypt"]
    resources = [aws_kms_key.production_parameters.arn]

    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${var.aws_region}.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "kms:EncryptionContext:PARAMETER_ARN"
      values   = local.production_secret_parameter_arns
    }
  }

  # GetParameters does not return the KMS key identifier. This explicit deny
  # makes a successful --with-decryption response proof that every returned
  # SecureString used the dedicated production-parameter key rather than the
  # broadly usable AWS-managed SSM key or another customer key.
  statement {
    sid           = "DenyDecryptOutsideProductionParameterKey"
    effect        = "Deny"
    actions       = ["kms:Decrypt"]
    not_resources = [aws_kms_key.production_parameters.arn]

    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${var.aws_region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_policy" "api" {
  name        = "TrackFusionWeb-API_Policy"
  description = "Grants the API media access plus read/decrypt access to the exact production parameter allowlist."
  policy      = data.aws_iam_policy_document.api.json
}

resource "aws_iam_role" "api" {
  name                 = "TrackFusionWeb-API_Role"
  description          = "Runtime role for TrackFusionWeb media, SSM management, and allowlisted production parameters."
  assume_role_policy   = data.aws_iam_policy_document.ec2_trust.json
  max_session_duration = 3600
}

resource "aws_iam_role_policy_attachment" "api" {
  role       = aws_iam_role.api.name
  policy_arn = aws_iam_policy.api.arn
}

resource "aws_iam_instance_profile" "api" {
  name = "TrackFusionWeb-API_Role"
  role = aws_iam_role.api.name
}
