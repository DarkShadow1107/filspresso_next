package filspresso.authz

default allow = false

default reason = "deny_by_default"

allow {
	input.resource == "admin-api"
	startswith(input.path, "/api/admin/login")
}

allow {
	input.resource == "admin-api"
	startswith(input.path, "/api/admin/mfa/verify")
}

allow {
	input.resource == "admin-api"
	startswith(input.path, "/api/admin/session")
	input.identity.role == "admin"
}

allow {
	input.resource == "admin-api"
	input.identity.role == "admin"
}

allow {
	input.resource == "service-events"
	input.identity.actor_type == "service"
}

allow {
	input.resource == "service-events"
	input.identity.role == "admin"
}

reason = "allowed" {
	allow
}

reason = "admin_role_required" {
	input.resource == "admin-api"
	not allow
}

reason = "service_identity_required" {
	input.resource == "service-events"
	not allow
}
