output "api_instance_id" {
  description = "TrackFusionWeb API EC2 instance ID."
  value       = aws_instance.api.id
}

output "api_public_ip" {
  description = "Stable Elastic IPv4 address for the TrackFusionWeb API."
  value       = aws_eip.api.public_ip
}

output "api_dns_a_record" {
  description = "A record to configure manually in IONOS after the Elastic IP is associated."
  value = {
    name  = var.api_domain_name
    type  = "A"
    value = aws_eip.api.public_ip
  }
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

output "github_terraform_plan_role_arn" {
  description = "Read-only GitHub OIDC role used to create encrypted production Terraform plans."
  value       = aws_iam_role.github_terraform_plan.arn
}

output "github_terraform_apply_role_arn" {
  description = "Reviewer-gated GitHub OIDC role used to apply a reviewed Terraform plan."
  value       = aws_iam_role.github_terraform_apply.arn
}

output "production_parameter_kms_key_arn" {
  description = "Customer-managed KMS key that an operator must select when creating production SecureString parameters."
  value       = aws_kms_key.production_parameters.arn
}

output "production_secret_parameter_names" {
  description = "Exact production Parameter Store allowlist. Values are intentionally outside Terraform."
  value       = sort(tolist(local.production_secret_parameter_names))
}

output "monitoring_alert_topic_arn" {
  description = "SNS topic used by the TrackFusionWeb CloudWatch alarms, or null until an alert email is configured."
  value       = try(aws_sns_topic.alerts[0].arn, null)
}
