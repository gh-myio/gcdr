data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "grant_signing_key" {
  statement {
    sid    = "AllowAccountRootAdmin"
    effect = "Allow"
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"]
    }
    actions   = ["kms:*"]
    resources = ["*"]
  }

  dynamic "statement" {
    for_each = var.signer_principal_arn != "" ? [1] : []
    content {
      sid    = "AllowGrantServiceSign"
      effect = "Allow"
      principals {
        type        = "AWS"
        identifiers = [var.signer_principal_arn]
      }
      actions   = ["kms:Sign", "kms:GetPublicKey", "kms:DescribeKey"]
      resources = ["*"]
    }
  }
}

resource "aws_kms_key" "grant_signing_key" {
  description              = "GCDR Grant Service central-grant signing key (${var.environment}) — RFC-0059 §5"
  key_usage                = "SIGN_VERIFY"
  customer_master_key_spec = "ECC_NIST_P256"
  deletion_window_in_days  = 30
  policy                   = data.aws_iam_policy_document.grant_signing_key.json

  tags = {
    Project     = "gcdr"
    Environment = var.environment
    Rfc         = "RFC-0059"
  }
}

resource "aws_kms_alias" "grant_signing_key" {
  name          = "alias/gcdr-grant-${var.environment}"
  target_key_id = aws_kms_key.grant_signing_key.key_id
}
