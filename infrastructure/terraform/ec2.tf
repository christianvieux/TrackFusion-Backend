resource "aws_instance" "api" {
  ami                         = var.instance_ami
  instance_type               = var.instance_type
  key_name                    = var.key_name
  subnet_id                   = var.subnet_id
  vpc_security_group_ids      = [aws_security_group.api.id]
  iam_instance_profile        = aws_iam_instance_profile.api.name
  associate_public_ip_address = true
  ebs_optimized               = false
  monitoring                  = false
  source_dest_check           = true

  credit_specification {
    cpu_credits = "standard"
  }

  metadata_options {
    http_endpoint               = "enabled"
    http_protocol_ipv6          = "disabled"
    http_put_response_hop_limit = 1
    http_tokens                 = "required"
    instance_metadata_tags      = "disabled"
  }

  root_block_device {
    delete_on_termination = true
    encrypted             = true
    iops                  = 3000
    throughput            = 125
    volume_size           = 20
    volume_type           = "gp3"

    tags = {
      Name        = "TrackFusionWeb-API-Root"
      Environment = "production"
      Project     = "TrackFusionWeb"
      Component   = "API"
    }
  }

  tags = {
    Name        = "TrackFusionWeb-API-EC2"
    Environment = "production"
  }

  lifecycle {
    prevent_destroy = true
    ignore_changes  = [ami]
  }

  depends_on = [aws_iam_role_policy_attachment.api]
}

