# RFC-0059 §5 / RFC-0060 Fase 0.3 — proposed alternative to the commented
# CloudFormation resource in serverless.yml. Apply only one of the two — see
# README.md. Not yet validated with `terraform init`/`validate` (no
# Terraform CLI in the environment this was authored in).

terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}
