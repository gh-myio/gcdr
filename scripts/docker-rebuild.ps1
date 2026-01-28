# =============================================================================
# GCDR Docker Rebuild Script
# =============================================================================
# This script rebuilds the Docker containers with full cache cleanup
# Usage: .\scripts\docker-rebuild.ps1 [options]
#
# Options:
#   -All        Rebuild all services (default: only api)
#   -Clean      Also prune Docker system (dangling images, build cache)
#   -Logs       Show logs after startup
#   -Help       Show this help message
# =============================================================================

param(
    [switch]$All,
    [switch]$Clean,
    [switch]$Logs,
    [switch]$Help
)

# Colors for output
function Write-Step { param($msg) Write-Host "`n[*] $msg" -ForegroundColor Cyan }
function Write-Success { param($msg) Write-Host "[+] $msg" -ForegroundColor Green }
function Write-Warning { param($msg) Write-Host "[!] $msg" -ForegroundColor Yellow }
function Write-Error { param($msg) Write-Host "[-] $msg" -ForegroundColor Red }

# Show help
if ($Help) {
    Write-Host @"

GCDR Docker Rebuild Script
===========================

Usage: .\scripts\docker-rebuild.ps1 [options]

Options:
  -All        Rebuild all services (default: only api)
  -Clean      Also prune Docker system (dangling images, build cache)
  -Logs       Show logs after startup
  -Help       Show this help message

Examples:
  .\scripts\docker-rebuild.ps1              # Rebuild api only
  .\scripts\docker-rebuild.ps1 -All         # Rebuild all services
  .\scripts\docker-rebuild.ps1 -Clean       # Rebuild api + clean Docker cache
  .\scripts\docker-rebuild.ps1 -All -Clean  # Full rebuild + clean
  .\scripts\docker-rebuild.ps1 -Logs        # Rebuild and show logs

"@
    exit 0
}

# Header
Write-Host ""
Write-Host "=============================================" -ForegroundColor Magenta
Write-Host "       GCDR Docker Rebuild Script           " -ForegroundColor Magenta
Write-Host "=============================================" -ForegroundColor Magenta

# Check if docker is running
Write-Step "Checking Docker..."
$dockerRunning = docker info 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Error "Docker is not running. Please start Docker Desktop first."
    exit 1
}
Write-Success "Docker is running"

# Stop containers
Write-Step "Stopping containers..."
docker compose down
if ($LASTEXITCODE -ne 0) {
    Write-Warning "Some containers may not have stopped cleanly"
}
Write-Success "Containers stopped"

# Clean Docker cache if requested
if ($Clean) {
    Write-Step "Cleaning Docker cache..."

    # Remove dangling images
    Write-Host "  Removing dangling images..."
    docker image prune -f

    # Remove build cache
    Write-Host "  Removing build cache..."
    docker builder prune -f

    Write-Success "Docker cache cleaned"
}

# Build
if ($All) {
    Write-Step "Rebuilding ALL services (no cache)..."
    docker compose build --no-cache
} else {
    Write-Step "Rebuilding API service (no cache)..."
    docker compose build --no-cache api
}

if ($LASTEXITCODE -ne 0) {
    Write-Error "Build failed!"
    exit 1
}
Write-Success "Build completed"

# Start containers
Write-Step "Starting containers..."
docker compose up -d
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to start containers"
    exit 1
}
Write-Success "Containers started"

# Wait for health check
Write-Step "Waiting for API to be healthy..."
$maxAttempts = 30
$attempt = 0
$healthy = $false

while ($attempt -lt $maxAttempts -and -not $healthy) {
    Start-Sleep -Seconds 1
    $attempt++

    try {
        $response = Invoke-WebRequest -Uri "http://localhost:3015/health" -UseBasicParsing -TimeoutSec 2 -ErrorAction SilentlyContinue
        if ($response.StatusCode -eq 200) {
            $healthy = $true
        }
    } catch {
        Write-Host "." -NoNewline
    }
}

Write-Host ""
if ($healthy) {
    Write-Success "API is healthy!"
} else {
    Write-Warning "API health check timed out. Check logs with: docker compose logs api"
}

# Show summary
Write-Host ""
Write-Host "=============================================" -ForegroundColor Magenta
Write-Host "              Rebuild Complete              " -ForegroundColor Magenta
Write-Host "=============================================" -ForegroundColor Magenta
Write-Host ""
Write-Host "  API:        http://localhost:3015" -ForegroundColor White
Write-Host "  Health:     http://localhost:3015/health" -ForegroundColor White
Write-Host "  Docs:       http://localhost:3015/docs" -ForegroundColor White
Write-Host "  DB Admin:   http://localhost:3015/admin/db" -ForegroundColor White
Write-Host "  Simulator:  http://localhost:3015/admin/simulator" -ForegroundColor White
Write-Host ""

# Show logs if requested
if ($Logs) {
    Write-Step "Showing logs (Ctrl+C to exit)..."
    docker compose logs -f api
}
