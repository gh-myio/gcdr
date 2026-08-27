# See infra/terraform/auth0/backend.tf — same situation, no backend
# provisioned yet. Uncomment once the S3 bucket + DynamoDB lock table (or
# Terraform Cloud workspace) exist.
#
# terraform {
#   backend "s3" {
#     bucket         = "myio-terraform-state"
#     key            = "gcdr/kms/terraform.tfstate"
#     region         = "sa-east-1"
#     dynamodb_table = "myio-terraform-locks"
#     encrypt        = true
#   }
# }
