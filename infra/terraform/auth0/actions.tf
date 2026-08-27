# Injects the GCDR tenant id into the access token as the `tid` custom claim,
# read from app_metadata.gcdr_tenant_id. RFC-0059 §1: "The tid claim is
# injected by an Auth0 Action from app_metadata, but remains authoritative
# only in GCDR." — this Action is a convenience projection, not a source of
# truth.

resource "auth0_action" "inject_tenant_id" {
  name    = "gcdr-inject-tid-${var.environment}"
  runtime = "node18"
  deploy  = true

  supported_triggers {
    id      = "post-login"
    version = "v3"
  }

  code = <<-EOT
    exports.onExecutePostLogin = async (event, api) => {
      const tenantId = event.user.app_metadata && event.user.app_metadata.gcdr_tenant_id;
      if (tenantId) {
        api.accessToken.setCustomClaim('tid', tenantId);
      }
    };
  EOT
}

resource "auth0_trigger_actions" "post_login_flow" {
  trigger = "post-login"

  actions {
    id           = auth0_action.inject_tenant_id.id
    display_name = auth0_action.inject_tenant_id.name
  }
}
