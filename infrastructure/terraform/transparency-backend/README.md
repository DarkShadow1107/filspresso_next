# Transparency Backend Terraform

This module provisions an immutable transparency anchor backend on AWS S3 with object lock enabled.

## Inputs (Summary)

- `aws_region`
- `bucket_name`
- `kms_key_arn`
- `object_lock_mode` (`COMPLIANCE` or `GOVERNANCE`)
- `default_retention_days`
- `noncurrent_expiration_days`
- `tags`

## What it creates

- S3 bucket with object lock enabled
- Bucket versioning
- KMS encryption at rest
- Public access block
- Lifecycle configuration for noncurrent versions
- Write-only IAM policy for anchor publisher role

## Usage

```hcl
module "transparency_backend" {
  source = "./infrastructure/terraform/transparency-backend"

  aws_region              = "eu-central-1"
  bucket_name             = "filspresso-transparency-anchors-prod"
  kms_key_arn             = "arn:aws:kms:eu-central-1:123456789012:key/abcd-1234"
  object_lock_mode        = "COMPLIANCE"
  default_retention_days  = 365
  noncurrent_expiration_days = 3650

  tags = {
    Environment = "prod"
    System      = "filspresso"
  }
}
```

## Important

Object lock requires bucket creation with object_lock_enabled = true and cannot be retrofitted to an existing bucket.

## Outputs

- `bucket_name`
- `bucket_arn`
- `transparency_writer_policy_arn`

## Validation Checklist

```bash
terraform fmt
terraform validate
terraform plan -var-file=environment.tfvars
```

## Security Notes

- Use dedicated KMS key policy boundaries for anchor writer roles.
- Restrict IAM principals using least-privilege attachment to the writer policy.
- Store terraform state remotely with encryption and locking in shared environments.
