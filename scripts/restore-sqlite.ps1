[CmdletBinding(SupportsShouldProcess)]
param()

$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeSchema = Join-Path $projectRoot 'prisma\schema.prisma'
$sqliteBackup = Join-Path $projectRoot 'prisma\schema.sqlite.prisma'

if (-not (Test-Path -LiteralPath $sqliteBackup)) {
  throw 'Aucune sauvegarde SQLite trouvée dans prisma/schema.sqlite.prisma.'
}

if ($PSCmdlet.ShouldProcess($runtimeSchema, 'restaurer le schéma SQLite')) {
  Copy-Item -LiteralPath $sqliteBackup -Destination $runtimeSchema -Force
  Write-Host 'Schéma SQLite restauré. Remettez DATABASE_URL sur file:./dev.db puis lancez npm run db:generate.'
}
