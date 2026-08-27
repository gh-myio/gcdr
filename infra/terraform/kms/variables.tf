variable "aws_region" {
  description = "AWS region for the KMS key. Confirm with whoever owns the AWS account (RFC-0060 Fase 0)."
  type        = string
  default     = "sa-east-1"
}

variable "environment" {
  description = "dev | prod — used to namespace the key alias."
  type        = string

  validation {
    condition     = contains(["dev", "prod"], var.environment)
    error_message = "environment must be \"dev\" or \"prod\"."
  }
}

variable "signer_principal_arn" {
  description = <<-EOT
    ARN of the IAM user or role that the running application (Dokploy
    container — not a Lambda execution role) authenticates as, and that
    should be granted kms:Sign + kms:GetPublicKey on this key. Leave unset
    until that IAM identity is provisioned (RFC-0060 Fase 0, "Fora do
    GCDR") — the key policy falls back to account-root-only access, which
    is not usable by the application.
  EOT
  type    = string
  default = ""
}
