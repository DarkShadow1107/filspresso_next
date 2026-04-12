output "bucket_name" {
  value       = aws_s3_bucket.transparency.bucket
  description = "Transparency backend bucket name"
}

output "bucket_arn" {
  value       = aws_s3_bucket.transparency.arn
  description = "Transparency backend bucket ARN"
}

output "transparency_writer_policy_arn" {
  value       = aws_iam_policy.transparency_writer.arn
  description = "IAM policy ARN for write-only anchor publisher role"
}
