variable "aws_region" {
  description = "AWS region containing the TrackFusionWeb API resources."
  type        = string
  default     = "us-east-1"
}

variable "aws_account_id" {
  description = "Expected AWS account ID; prevents accidental operations in another account."
  type        = string
  default     = "020457827871"
}

variable "audio_bucket_name" {
  description = "Existing private S3 bucket used for TrackFusionWeb media."
  type        = string
  default     = "trackfusionweb-audio.s3bucket-020457827871-us-east-1-an"
}

variable "instance_ami" {
  description = "Pinned Ubuntu 24.04 AMI used by the imported EC2 instance. Upgrade explicitly."
  type        = string
  default     = "ami-0d6dd9e8265d48906"
}

variable "instance_type" {
  description = "EC2 size for the initial all-in-one API host."
  type        = string
  default     = "t3.small"
}

variable "subnet_id" {
  description = "Existing public subnet for the API instance."
  type        = string
  default     = "subnet-080a5c11707ec23fd"
}

variable "key_name" {
  description = "Existing EC2 key pair used for restricted administrative SSH."
  type        = string
  default     = "AWS_Portfolio_n_Projects_Key_Pair_10.12.2026"
}

variable "developer_ssh_cidr" {
  description = "Single trusted public IPv4 CIDR allowed to SSH, normally x.x.x.x/32."
  type        = string

  validation {
    condition     = can(cidrnetmask(var.developer_ssh_cidr)) && endswith(var.developer_ssh_cidr, "/32")
    error_message = "developer_ssh_cidr must be one IPv4 /32 CIDR."
  }
}

variable "frontend_origins" {
  description = "Exact browser origins allowed to use presigned S3 requests."
  type        = list(string)
  default = [
    "https://trackfusionweb.vercel.app",
    "http://localhost:3000",
    "http://localhost:3001",
  ]
}

variable "github_repository" {
  description = "GitHub owner and repository allowed to request deployment credentials."
  type        = string
  default     = "christianvieux/trackfusionweb-api"

  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.github_repository))
    error_message = "github_repository must use the owner/repository format."
  }
}

variable "github_repository_owner_id" {
  description = "Immutable GitHub ID for the repository owner, used in the OIDC subject."
  type        = string
  default     = "174923870"

  validation {
    condition     = can(regex("^[0-9]+$", var.github_repository_owner_id))
    error_message = "github_repository_owner_id must contain only digits."
  }
}

variable "github_repository_id" {
  description = "Immutable GitHub repository ID used in the OIDC subject."
  type        = string
  default     = "912834143"

  validation {
    condition     = can(regex("^[0-9]+$", var.github_repository_id))
    error_message = "github_repository_id must contain only digits."
  }
}

variable "github_environment" {
  description = "Protected GitHub environment allowed to deploy."
  type        = string
  default     = "production"
}

variable "monitoring_alert_email" {
  description = "Optional email address for CloudWatch alarm notifications. Leave empty until an owner is ready to confirm the SNS subscription."
  type        = string
  default     = ""

  validation {
    condition     = var.monitoring_alert_email == "" || can(regex("^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$", var.monitoring_alert_email))
    error_message = "monitoring_alert_email must be empty or a valid email address."
  }
}

