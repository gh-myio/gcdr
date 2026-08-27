output "grant_kms_key_id" {
  description = "Fills GRANT_KMS_KEY_ID in .env.example / dokploy.yml once applied."
  value       = aws_kms_key.grant_signing_key.key_id
}

output "grant_kms_key_arn" {
  value = aws_kms_key.grant_signing_key.arn
}

output "grant_kms_alias" {
  value = aws_kms_alias.grant_signing_key.name
}
