locals {
  production_managed_environment_lines = [
    for line in split("\n", file("${path.module}/../../deploy/ec2/production-managed.env")) :
    trimspace(line)
    if trimspace(line) != "" && !startswith(trimspace(line), "#")
  ]
  production_managed_environment = {
    for line in local.production_managed_environment_lines :
    regex("^([A-Z][A-Z0-9_]*)=(.*)$", line)[0] => regex("^([A-Z][A-Z0-9_]*)=(.*)$", line)[1]
  }
  production_frontend_origin = local.production_managed_environment["FRONTEND_URL"]
  s3_frontend_origins        = distinct(concat([local.production_frontend_origin], var.frontend_origins))
}

resource "aws_s3_bucket" "audio" {
  bucket = var.audio_bucket_name

  tags = {
    Name        = "TrackFusionWeb-Audio"
    Environment = "production"
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_ownership_controls" "audio" {
  bucket = aws_s3_bucket.audio.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "audio" {
  bucket = aws_s3_bucket.audio.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "audio" {
  bucket = aws_s3_bucket.audio.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }

    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_cors_configuration" "audio" {
  bucket = aws_s3_bucket.audio.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "PUT", "HEAD"]
    allowed_origins = local.s3_frontend_origins
    expose_headers  = ["ETag"]
    max_age_seconds = 3600
  }

  lifecycle {
    precondition {
      condition     = can(regex("^https://[^/?#]+$", local.production_frontend_origin))
      error_message = "The production FRONTEND_URL must be an exact HTTPS origin before Terraform can manage S3 CORS."
    }
  }
}
