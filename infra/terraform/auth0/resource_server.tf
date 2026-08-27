# API/audience definition. RS256 access tokens against this audience are what
# Fase 4's GCDR middleware verifies, and what Fase 1's Grant Service
# (POST /v1/grants) accepts as step 1 of RFC-0059 §5.

resource "auth0_resource_server" "gcdr_api" {
  name        = "GCDR API (${var.environment})"
  identifier  = var.grant_service_api_identifier
  signing_alg = "RS256"

  scopes {
    value       = "offline_field"
    description = "Grant Service: allows requesting an offline central grant (RFC-0059 §5)."
  }

  scopes {
    value       = "central:admin"
    description = "Grant Service: required together with offline_field for a 30-day extended offline grant (RFC-0059 §5)."
  }
}
