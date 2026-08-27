resource "auth0_client" "web_app" {
  # Human-facing PKCE app — "Plane 1" of RFC-0059's diagram.
  name     = "GCDR Web (${var.environment})"
  app_type = "spa"

  jwt_configuration {
    alg = "RS256"
  }
}

resource "auth0_client" "provisioning_service" {
  # M2M client for GCDR's Auth0ProvisioningService (RFC-0059 §3), built in
  # Fase 4. Created here in Fase 0 so the tenant is fully scaffolded, but not
  # consumed by any application code until Fase 4 lands.
  name     = "GCDR Provisioning Service (${var.environment})"
  app_type = "non_interactive"

  jwt_configuration {
    alg = "RS256"
  }
}
