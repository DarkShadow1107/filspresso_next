terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

resource "aws_s3_bucket" "transparency" {
  bucket              = var.bucket_name
  object_lock_enabled = true

  tags = merge(var.tags, {
    Name    = var.bucket_name
    Purpose = "filspresso-transparency-anchors"
  })
}

resource "aws_s3_bucket_versioning" "transparency" {
  bucket = aws_s3_bucket.transparency.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "transparency" {
  bucket = aws_s3_bucket.transparency.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
      kms_master_key_id = var.kms_key_arn
    }
  }
}

resource "aws_s3_bucket_object_lock_configuration" "transparency" {
  bucket = aws_s3_bucket.transparency.id

  rule {
    default_retention {
      mode = var.object_lock_mode
      days = var.default_retention_days
    }
  }
}

resource "aws_s3_bucket_public_access_block" "transparency" {
  bucket = aws_s3_bucket.transparency.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "transparency" {
  bucket = aws_s3_bucket.transparency.id

  rule {
    id     = "retain-noncurrent-anchor-versions"
    status = "Enabled"

    noncurrent_version_expiration {
      noncurrent_days = var.noncurrent_expiration_days
    }
  }
}

resource "aws_iam_policy" "transparency_writer" {
  name        = "${var.bucket_name}-writer"
  description = "Write-only publisher policy for Filspresso transparency anchors"

  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Effect = "Allow",
        Action = [
          "s3:PutObject",
          "s3:PutObjectRetention",
          "s3:PutObjectTagging"
        ],
        Resource = "${aws_s3_bucket.transparency.arn}/*"
      },
      {
        Effect = "Allow",
        Action = [
          "s3:GetBucketLocation"
        ],
        Resource = aws_s3_bucket.transparency.arn
      }
    ]
  })
}
