output "api_instance_id" {
  description = "TrackFusionWeb API EC2 instance ID."
  value       = aws_instance.api.id
}

output "api_public_ip" {
  description = "Ephemeral public IPv4 address; it changes after stop/start."
  value       = aws_instance.api.public_ip
}

output "audio_bucket_name" {
  description = "Private TrackFusionWeb media bucket."
  value       = aws_s3_bucket.audio.id
}

output "api_role_arn" {
  description = "Runtime IAM role attached to the API instance."
  value       = aws_iam_role.api.arn
}

output "github_deploy_role_arn" {
  description = "GitHub Actions OIDC role used for keyless production deployments."
  value       = aws_iam_role.github_deploy.arn
}

output "monitoring_alert_topic_arn" {
  description = "SNS topic used by the TrackFusionWeb CloudWatch alarms, or null until an alert email is configured."
  value       = try(aws_sns_topic.alerts[0].arn, null)
}

