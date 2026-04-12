# Infrastructure IaC Reference

This folder contains Terraform assets used to provision external platform dependencies for Filspresso security workflows.

## 1. Current IaC Scope

Active module:

- `terraform/transparency-backend/`

Purpose:

- provision immutable S3-backed transparency anchor storage
- enforce object lock retention semantics
- provide write-only publisher IAM policy for anchoring workflows

## 2. Module File Map (Explicit)

1. `terraform/transparency-backend/main.tf`

- provider and Terraform version constraints
- S3 bucket with object lock enabled
- bucket versioning and KMS encryption
- public access blocking
- noncurrent object lifecycle retention
- IAM write policy for anchor publishers

2. `terraform/transparency-backend/variables.tf`

- defines required inputs and defaults
- validates lock mode (`COMPLIANCE` or `GOVERNANCE`)

3. `terraform/transparency-backend/outputs.tf`

- exports bucket identity and writer-policy ARN

4. `terraform/transparency-backend/README.md`

- usage example and key caveats

## 3. Input Contract Summary

| Variable                     | Required | Meaning                      |
| ---------------------------- | -------- | ---------------------------- |
| `aws_region`                 | yes      | region for provisioning      |
| `bucket_name`                | yes      | globally unique bucket name  |
| `kms_key_arn`                | yes      | KMS key for encryption       |
| `object_lock_mode`           | no       | `COMPLIANCE` or `GOVERNANCE` |
| `default_retention_days`     | no       | default lock retention       |
| `noncurrent_expiration_days` | no       | noncurrent version retention |
| `tags`                       | no       | resource tags                |

## 4. Output Contract Summary

| Output                           | Meaning                                  |
| -------------------------------- | ---------------------------------------- |
| `bucket_name`                    | created bucket name                      |
| `bucket_arn`                     | created bucket ARN                       |
| `transparency_writer_policy_arn` | IAM policy for write-only publisher role |

## 5. Terraform State And Secrets Policy

Commit to Git:

- `.tf` module source files

Do not commit:

- `.terraform/`
- `*.tfstate*`
- `*.tfvars*` containing secrets/environment values

Root `.gitignore` already enforces these patterns.

## 6. Execution Runbook

```bash
cd infrastructure/terraform/transparency-backend
terraform init
terraform fmt
terraform validate
terraform plan -var-file=environment.tfvars
terraform apply -var-file=environment.tfvars
```

Recommended guardrails:

- use remote state backend in shared environments
- enforce `terraform plan` review in CI before apply
- require approval workflow for production apply

## 7. Relationship To Docker And Runtime Services

Terraform assets are provisioning code, not application runtime code.

Implications:

- they should remain tracked in Git
- they should not be copied into app image build contexts
- app containers consume provisioned infrastructure outputs indirectly via env and secret configuration

## 8. Why This Module Matters For Titan V0.74

It supports external assurance controls by enabling:

- immutable anchor retention
- auditable external anchor publication targets
- controlled write principals for anchoring workloads

## 9. Related Docs

- `docs/README.md`
- `security/README.md`
- root `README.md`
