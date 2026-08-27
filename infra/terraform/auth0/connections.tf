# RFC-0059 §1 — resolved by var.tenant_model. Do not apply until
# docs/audits/tenant-email-collisions.md has been filled in with real data
# and the decision has stakeholder (Produto/Segurança) sign-off (RFC-0060
# Fase 0.2).

resource "auth0_connection" "single" {
  count    = var.tenant_model == "single" ? 1 : 0
  name     = "gcdr-${var.environment}"
  strategy = "auth0"

  options {
    password_policy        = "good"
    brute_force_protection = true
  }
}

resource "auth0_connection" "per_tenant" {
  for_each = var.tenant_model == "per_tenant" ? toset(var.per_tenant_ids) : toset([])
  name     = "gcdr-${var.environment}-${each.value}"
  strategy = "auth0"

  options {
    password_policy        = "good"
    brute_force_protection = true
  }
}
