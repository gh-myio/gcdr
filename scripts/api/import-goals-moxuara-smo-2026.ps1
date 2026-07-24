<#
  Import das metas 2026 do Moxuara (SMO) por device — RFC-0046 Addendum A.

    CAG        -> 3077a33a-8bd2-4f4f-bae4-68c003f20fcf
    Condomínio -> 2c41a66a-1c38-4cc3-9373-c6f1c85f0a6c

  Dry-run por padrão. Para persistir:  .\import-goals-moxuara-smo-2026.ps1 -Confirm

  Token: NÃO passe por parâmetro nem cole no terminal. Defina antes:
      $env:GCDR_TOKEN = (Get-Content C:\caminho\token.txt -Raw).Trim()
#>
param(
    [switch]$Confirm,
    [string]$BaseUrl = 'https://gcdr-api.a.myio-bas.com'
)

$ErrorActionPreference = 'Stop'

if (-not $env:GCDR_TOKEN) {
    Write-Error 'Defina $env:GCDR_TOKEN antes de rodar (leia de arquivo, nao cole no terminal).'
}

$customerId = '84e0370e-636a-4741-9874-504b5e0b3577'
$dryRun     = if ($Confirm) { 'false' } else { 'true' }
$csvDir     = Join-Path $PSScriptRoot '..\..\docs\goals\sa-cavalcante\2026-v2'

$targets = @(
    @{ Nome = 'CAG';        DeviceId = '3077a33a-8bd2-4f4f-bae4-68c003f20fcf'; Csv = 'goals-2026-SMO-CAG-Energy-import.csv' },
    @{ Nome = 'CONDOMINIO'; DeviceId = '2c41a66a-1c38-4cc3-9373-c6f1c85f0a6c'; Csv = 'goals-2026-SMO-CONDOMINIO-Energy-import.csv' }
)

if ($Confirm) {
    Write-Host "*** MODO GRAVACAO (dryRun=false) — as metas serao persistidas ***" -ForegroundColor Yellow
} else {
    Write-Host "Modo dry-run (nada sera gravado)." -ForegroundColor Cyan
}

foreach ($t in $targets) {
    $path = Join-Path $csvDir $t.Csv
    if (-not (Test-Path $path)) { Write-Error "CSV nao encontrado: $path" }

    $csv   = [System.IO.File]::ReadAllText($path, [System.Text.UTF8Encoding]::new($false))
    $linhas = ($csv -split "`n" | Where-Object { $_.Trim() -ne '' }).Count - 1

    $url = "$BaseUrl/api/v1/customers/$customerId/goals/import" +
           "?domain=ENERGY&year=2026&dryRun=$dryRun&deviceId=$($t.DeviceId)"

    Write-Host ""
    Write-Host "=== $($t.Nome) — $linhas buckets ===" -ForegroundColor Green
    Write-Host $url

    $body = @{ csv = $csv } | ConvertTo-Json -Depth 3 -Compress

    try {
        $resp = Invoke-RestMethod -Method Post -Uri $url -Body $body `
            -ContentType 'application/json' `
            -Headers @{ Authorization = "Bearer $($env:GCDR_TOKEN)" }

        $resp | ConvertTo-Json -Depth 8 | Write-Output
    }
    catch {
        Write-Host "FALHOU: $($_.Exception.Message)" -ForegroundColor Red
        if ($_.ErrorDetails.Message) { Write-Host $_.ErrorDetails.Message -ForegroundColor Red }
        throw
    }
}

Write-Host ""
if (-not $Confirm) {
    Write-Host "Dry-run concluido. Revise o preview acima e rode com -Confirm para gravar." -ForegroundColor Cyan
}
