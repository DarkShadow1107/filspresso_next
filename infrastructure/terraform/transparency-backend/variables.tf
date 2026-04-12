variable "aws_region" {
  description = "AWS region for the transparency backend"
  type        = string
}

variable "bucket_name" {
  description = "Globally unique S3 bucket for transparency anchors"
  type        = string
}

variable "kms_key_arn" {
  description = "KMS key ARN used for bucket object encryption"
  type        = string
}

variable "object_lock_mode" {
  description = "Object lock retention mode"
  type        = string
  default     = "COMPLIANCE"

  validation {
    condition     = contains(["COMPLIANCE", "GOVERNANCE"], var.object_lock_mode)
    error_message = "object_lock_mode must be COMPLIANCE or GOVERNANCE"
  }
}

variable "default_retention_days" {
  description = "Default object lock retention in days"
  type        = number
  default     = 365
}

variable "noncurrent_expiration_days" {
  description = "Retention for noncurrent object versions"
  type        = number
  default     = 3650
}

variable "tags" {
  description = "Tags to apply to transparency resources"
  type        = map(string)
  default     = {}
}
