[CmdletBinding(SupportsShouldProcess)]
param()

$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeSchema = Join-Path $projectRoot 'prisma\schema.prisma'
$supabaseSchema = Join-Path $projectRoot 'prisma\schema.supabase.prisma'
$sqliteBackup = Join-Path $projectRoot 'prisma\schema.sqlite.prisma'

if (-not (Test-Path -LiteralPath $supabaseSchema)) {
  throw 'prisma/schema.supabase.prisma est introuvable.'
}

if (-not (Test-Path -LiteralPath $sqliteBackup)) {
  Copy-Item -LiteralPath $runtimeSchema -Destination $sqliteBackup
}

$schema = Get-Content -LiteralPath $supabaseSchema -Raw
$schema = $schema -replace '(?m)^\s*output\s*=\s*"\.\./generated/supabase"\r?\n', ''
$schema = $schema.Replace('env("SUPABASE_DATABASE_URL")', 'env("DATABASE_URL")')
$schema = $schema.Replace('env("SUPABASE_DIRECT_URL")', 'env("DIRECT_URL")')

if ($PSCmdlet.ShouldProcess($runtimeSchema, 'activer le schéma PostgreSQL Supabase')) {
  Set-Content -LiteralPath $runtimeSchema -Value $schema -Encoding utf8
  Write-Host 'Schéma Supabase activé.'
  Write-Host 'Sauvegarde SQLite conservée dans prisma/schema.sqlite.prisma.'
  Write-Host 'Ajoutez DATABASE_URL (pooler) et DIRECT_URL (direct) dans .env, puis lancez npm run db:generate.'
}
