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
}

resource "aws_iam_policy" "api" {
  name        = "TrackFusionWeb-API_Policy"
  description = "Grants TrackFusionWeb backend access to upload and retrieve audio files from its dedicated S3 bucket."
  policy      = data.aws_iam_policy_document.api.json
}

resource "aws_iam_role" "api" {
  name                 = "TrackFusionWeb-API_Role"
  description          = "Allows TrackFusionWeb on EC2 to access its S3 audio bucket."
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

