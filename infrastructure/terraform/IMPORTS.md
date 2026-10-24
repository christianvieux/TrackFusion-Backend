# Importing the existing TrackFusionWeb resources

Run these commands once after `terraform init`. Imports update Terraform state; they do not recreate the live resources.

```bash
terraform import aws_s3_bucket.audio trackfusionweb-audio.s3bucket-020457827871-us-east-1-an
terraform import aws_s3_bucket_ownership_controls.audio trackfusionweb-audio.s3bucket-020457827871-us-east-1-an
terraform import aws_s3_bucket_public_access_block.audio trackfusionweb-audio.s3bucket-020457827871-us-east-1-an
terraform import aws_s3_bucket_server_side_encryption_configuration.audio trackfusionweb-audio.s3bucket-020457827871-us-east-1-an
terraform import aws_s3_bucket_cors_configuration.audio trackfusionweb-audio.s3bucket-020457827871-us-east-1-an

terraform import aws_iam_policy.api arn:aws:iam::020457827871:policy/TrackFusionWeb-API_Policy
terraform import aws_iam_role.api TrackFusionWeb-API_Role
terraform import aws_iam_role_policy_attachment.api 'TrackFusionWeb-API_Role/arn:aws:iam::020457827871:policy/TrackFusionWeb-API_Policy'
terraform import aws_iam_instance_profile.api TrackFusionWeb-API_Role

terraform import aws_security_group.api sg-025c0401a53f29c10
terraform import aws_vpc_security_group_ingress_rule.ssh sgr-059b1070a11e6a01a
terraform import aws_vpc_security_group_ingress_rule.http sgr-0dbb9719d9d908d72
terraform import aws_vpc_security_group_ingress_rule.https sgr-0f49e350a02591020
terraform import aws_vpc_security_group_egress_rule.all_ipv4 sgr-0f7fc585b00a40e80

terraform import aws_instance.api i-003f490e99fd1054d
```

After all imports, run `terraform plan` and review every action before applying. The EC2 instance and audio bucket have `prevent_destroy` safeguards.
