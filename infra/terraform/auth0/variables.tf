variable "auth0_domain" {
  description = "Auth0 tenant domain, e.g. myio-dev.us.auth0.com"
  type        = string
}

variable "auth0_management_client_id" {
  description = <<-EOT
    Client ID of the Auth0 Management API M2M application used by Terraform
    to authenticate itself. Created manually in the Auth0 Dashboard
    (RFC-0060 Fase 0, external prerequisite) — Terraform cannot create the
    credentials it authenticates with.
  EOT
  type = string
}

variable "auth0_management_client_secret" {
  description = "Client secret of the Management API M2M application."
  type        = string
  sensitive   = true
}

variable "environment" {
  description = "dev | prod — used to namespace resource names."
  type        = string

  validation {
    condition     = contains(["dev", "prod"], var.environment)
    error_message = "environment must be \"dev\" or \"prod\"."
  }
}

variable "tenant_model" {
  description = <<-EOT
    RFC-0059 §1 decision, resolved by RFC-0060 Fase 0.1/0.2:
      "single"     - one global Auth0 Database Connection, email globally
                      unique (RFC-0059 recommendation).
      "per_tenant" - one Auth0 Connection per GCDR tenant, Auth0
                      Organizations mandatory.
    Defaults to "single" but MUST be confirmed against the real collision
    audit (docs/audits/tenant-email-collisions.md) before the first apply.
  EOT
  type    = string
  default = "single"

  validation {
    condition     = contains(["single", "per_tenant"], var.tenant_model)
    error_message = "tenant_model must be \"single\" or \"per_tenant\"."
  }
}

variable "per_tenant_ids" {
  description = "GCDR tenant UUIDs to create one Connection each for. Only used when tenant_model = \"per_tenant\"."
  type        = list(string)
  default     = []
}

variable "grant_service_api_identifier" {
  description = <<-EOT
    Audience (identifier) for the auth0_resource_server. This is what Fase 4's
    RS256 middleware validates the access token audience against, and what
    the Grant Service (Fase 1, POST /v1/grants) checks in RFC-0059 §5 step 1.
  EOT
  type    = string
  default = "https://gcdr.myio.com.br/api"
}
