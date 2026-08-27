# RFC-0060 Fase 0.4 — remote state backend.
#
# NOT YET PROVISIONED. No S3 bucket / DynamoDB lock table for Terraform state
# exists yet (this repo had zero .tf files before this directory). Before the
# first `terraform init`, someone with AWS access needs to create:
#   - an S3 bucket (versioned, encrypted) to hold state
#   - a DynamoDB table for state locking (partition key: LockID, string)
# — or set up a Terraform Cloud workspace instead. Uncomment and fill in one
# of the two once that infra exists; until then this stays local-state only
# (fine for `plan`, not safe for shared `apply`).
#
# terraform {
#   backend "s3" {
#     bucket         = "myio-terraform-state"
#     key            = "gcdr/auth0/terraform.tfstate"
#     region         = "sa-east-1"
#     dynamodb_table = "myio-terraform-locks"
#     encrypt        = true
#   }
# }
