# RFC-0059 / RFC-0060 Fase 0.4 — Auth0 tenant provisioning.
#
# NOTE: written as scaffolding, not yet validated with `terraform init` /
# `terraform validate` (the Terraform CLI isn't available in the environment
# this was authored in). Double-check resource/argument names against the
# current auth0/auth0 provider docs before the first real apply.

terraform {
  required_version = ">= 1.5"

  required_providers {
    auth0 = {
      source  = "auth0/auth0"
      version = "~> 1.0"
    }
  }
}

provider "auth0" {
  domain        = var.auth0_domain
  client_id     = var.auth0_management_client_id
  client_secret = var.auth0_management_client_secret
}
